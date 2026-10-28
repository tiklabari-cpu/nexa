/**
 * The QA sampler (tm 319.1 · SiyahTuş analysis AI-24 §2) — the scheduler's
 * `qa_sampling` job.
 *
 * Once a day per workspace, at {@link QA_SAMPLING_LOCAL_HOUR}:00 on the
 * workspace's own clock (its conversation-day zone, ID-04), the connections
 * the AI took part in that closed during the previous conversation day are
 * put in the QA queue:
 *
 *   - **at random**, deterministically: a connection is drawn when
 *     {@link qaSampleDraw}`(licence, day, thread_id)` — a hash, not a random
 *     number — is under the workspace's rate (`qa_settings.sample_percent`,
 *     5 % by default, 1–20 %). The same day sampled again draws the same list;
 *   - **every one** in a mandatory category ({@link QA_SAMPLER_MANDATORY_REASONS}):
 *     a risk flag raised in it (AI-27), the player's bad rating of the AI's
 *     own connection, a repeat contact within {@link QA_REPEAT_CONTACT_HOURS}
 *     hours of an earlier AI connection, a guardrail that checked the AI's
 *     draft or recorded a warning (AI-08), a compliance hand-over, a hand-over
 *     card its agent called insufficient (AI-10). The rate does not apply.
 *
 * A connection picked for several reasons is one review carrying them all;
 * its priority is the highest they earn (risk > guardrail > other,
 * {@link qaPriorityOf}) and its due date the soonest — two business days for
 * a risk flag, seven days otherwise. A connection already in the queue (a
 * Team Lead sent it by hand) gains the reasons instead, unless its review is
 * complete. The review keeps a masked excerpt — the AI's part and the first
 * {@link QA_POST_HANDOFF_AGENT_MESSAGES} agent messages after it — so it can
 * be read after the conversation's retention ran out.
 *
 * "AI took part" is an `ai_conversations` row for the connection or a message
 * of the AI's own (`author_id` {@link AI_BOT_ID}): a compliance hand-over on
 * the first message leaves no AI message, but it is the AI's decision QA
 * checks. A rule bot's lines alone are not.
 *
 * A day is sampled once: its `qa_sampling_runs` row is written first in the
 * same transaction (`ON CONFLICT DO NOTHING`), so a second pass — the next
 * tick, another instance — finds it and leaves the day alone, and a pass that
 * fails leaves no mark and is retried. A day missed while the scheduler was
 * down is caught up for {@link QA_SAMPLING_CATCH_UP_DAYS} days.
 */
import { createHash, randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import {
  AI_BOT_ID,
  PLATFORM_QA_RUBRIC,
  QA_DUE_DAYS,
  QA_EXCERPT_MESSAGES_MAX,
  QA_EXCERPT_TEXT_MAX,
  QA_MANDATORY_HANDOFF_REASONS,
  QA_POST_HANDOFF_AGENT_MESSAGES,
  QA_PRIORITY_RANK,
  QA_REASONS,
  QA_REPEAT_CONTACT_HOURS,
  QA_RISK_DUE_BUSINESS_DAYS,
  QA_SAMPLE_PERCENT_DEFAULT,
  QA_SAMPLER_MANDATORY_REASONS,
  QA_SAMPLING_CATCH_UP_DAYS,
  QA_SAMPLING_LOCAL_HOUR,
  isQaSamplePercent,
  localDayKey,
  localDayStart,
  qaPriorityOf,
  shiftDayKey,
  type DayBoundary,
  type QaExcerptMessage,
  type QaPriority,
  type QaReason,
} from '@siyahtus/types';
import { sensitiveAuthorOf, maskForWrite } from '../../lib/sensitive-mask.js';
import { withTenant, type TenantClient, type TenantContext } from '../../lib/tenant.js';
import { readDayBoundary } from '../chat/day-boundary.js';

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/** A day's sampling may read a thousand connections and their excerpts. */
const SAMPLE_DAY_TIMEOUT_MS = 60_000;

// ---------------------------------------------------------------------------
// Pure parts
// ---------------------------------------------------------------------------

/**
 * Where a connection falls in `[0, 1)` for the day's draw: the first 48 bits
 * of `sha256("<licence>:<day>:<thread_id>")`. Deterministic — the same
 * connection on the same day always draws the same number — and independent
 * across days and workspaces.
 */
export function qaSampleDraw(licenseId: bigint | string, day: string, threadId: string): number {
  const digest = createHash('sha256').update(`${licenseId}:${day}:${threadId}`).digest();
  return digest.readUIntBE(0, 6) / 2 ** 48;
}

/** Drawn at `percent` %: {@link qaSampleDraw} under the rate. */
export function qaSampledAtRandom(
  licenseId: bigint | string,
  day: string,
  threadId: string,
  percent: number,
): boolean {
  return qaSampleDraw(licenseId, day, threadId) < percent / 100;
}

const weekdayFormatters = new Map<string, Intl.DateTimeFormat>();
const hourFormatters = new Map<string, Intl.DateTimeFormat>();

function formatter(
  cache: Map<string, Intl.DateTimeFormat>,
  timezone: string,
  options: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
  let found = cache.get(timezone);
  if (!found) {
    found = new Intl.DateTimeFormat('en-US', { timeZone: timezone, ...options });
    cache.set(timezone, found);
  }
  return found;
}

/** The wall-clock hour (0–23) of `at` in `timezone`. */
export function localHour(at: Date, timezone: string): number {
  const hour = formatter(hourFormatters, timezone, { hour: 'numeric', hourCycle: 'h23' })
    .formatToParts(at)
    .find((part) => part.type === 'hour');
  return Number(hour?.value ?? 0);
}

function isWeekend(at: Date, timezone: string): boolean {
  const day = formatter(weekdayFormatters, timezone, { weekday: 'short' }).format(at);
  return day === 'Sat' || day === 'Sun';
}

/**
 * When a review queued at `from` is due: a risk-flagged one after
 * {@link QA_RISK_DUE_BUSINESS_DAYS} business days — Saturday and Sunday on
 * the workspace's clock do not count —, every other one after
 * {@link QA_DUE_DAYS} days.
 */
export function qaDueAt(from: Date, priority: QaPriority, timezone: string): Date {
  if (priority !== 'risk') return new Date(from.getTime() + QA_DUE_DAYS * DAY_MS);
  let at = from;
  let left = QA_RISK_DUE_BUSINESS_DAYS;
  while (left > 0) {
    at = new Date(at.getTime() + DAY_MS);
    if (!isWeekend(at, timezone)) left -= 1;
  }
  return at;
}

/**
 * The conversation days due for sampling at `now`, oldest first: the previous
 * conversation day once the workspace's clock has reached
 * {@link QA_SAMPLING_LOCAL_HOUR}:00 (the one before it until then), and the
 * {@link QA_SAMPLING_CATCH_UP_DAYS} − 1 days before that. The caller leaves
 * out the days already sampled.
 */
export function qaSamplingDays(now: Date, boundary: DayBoundary): string[] {
  const today = localDayKey(now, boundary.timezone, boundary.hour);
  const latest = shiftDayKey(
    today,
    localHour(now, boundary.timezone) >= QA_SAMPLING_LOCAL_HOUR ? -1 : -2,
  );
  const days: string[] = [];
  for (let back = QA_SAMPLING_CATCH_UP_DAYS - 1; back >= 0; back -= 1) {
    days.push(shiftDayKey(latest, -back));
  }
  return days;
}

/** The flags a connection was read with; true puts it in the queue whatever the draw. */
export type QaMandatoryFlags = Readonly<
  Record<(typeof QA_SAMPLER_MANDATORY_REASONS)[number], boolean>
>;

/** Why the connection is queued, in {@link QA_REASONS} order; empty when it is not. */
export function qaReasonsFor(drawn: boolean, flags: QaMandatoryFlags): QaReason[] {
  const reasons = new Set<QaReason>(drawn ? ['random'] : []);
  for (const reason of QA_SAMPLER_MANDATORY_REASONS) if (flags[reason]) reasons.add(reason);
  return QA_REASONS.filter((reason) => reasons.has(reason));
}

export interface QaExcerptRow {
  id: string;
  author_type: string;
  author_id: string | null;
  text: string | null;
  created_at: Date;
}

/**
 * The review unit's messages (AI-24 §1), oldest first and masked: everything
 * said to the player up to and including the
 * {@link QA_POST_HANDOFF_AGENT_MESSAGES}th message of a person — what the
 * AI did and how the hand-over was taken —, at most
 * {@link QA_EXCERPT_MESSAGES_MAX} messages of {@link QA_EXCERPT_TEXT_MAX}
 * characters.
 */
export function qaExcerptOf(rows: readonly QaExcerptRow[]): QaExcerptMessage[] {
  const excerpt: QaExcerptMessage[] = [];
  let agentMessages = 0;
  for (const row of rows) {
    if (excerpt.length >= QA_EXCERPT_MESSAGES_MAX) break;
    if (agentMessages >= QA_POST_HANDOFF_AGENT_MESSAGES) break;
    const author = sensitiveAuthorOf(row.author_type);
    if (author === null) continue;
    if (author === 'agent') agentMessages += 1;
    excerpt.push({
      event_id: row.id,
      author_type: author,
      is_ai: author === 'bot' && row.author_id === AI_BOT_ID,
      text: maskForWrite(row.text ?? '', author).text.slice(0, QA_EXCERPT_TEXT_MAX),
      created_at: row.created_at.toISOString(),
    });
  }
  return excerpt;
}

/** A connection's masked excerpt ({@link qaExcerptOf}), read from its messages to all. */
export async function readQaExcerpt(
  tx: TenantClient,
  threadId: string,
): Promise<QaExcerptMessage[]> {
  return qaExcerptOf(
    await tx.$queryRaw<QaExcerptRow[]>`
      SELECT id, author_type, author_id, text, created_at FROM events
       WHERE thread_id = ${threadId} AND type = 'message' AND recipients = 'all'
       ORDER BY event_sequence
       LIMIT ${QA_EXCERPT_MESSAGES_MAX}`,
  );
}

// ---------------------------------------------------------------------------
// Settings and rubric
// ---------------------------------------------------------------------------

export interface QaSettingsView {
  samplePercent: number;
  prescoreEnabled: boolean;
  conflictCheck: boolean;
}

/** The workspace's QA settings; no row is the defaults (AI-24-S1/S2). */
export async function readQaSettings(tx: TenantClient): Promise<QaSettingsView> {
  const row = await tx.qaSettings.findFirst({
    select: { samplePercent: true, prescoreEnabled: true, conflictCheck: true },
  });
  const percent = row?.samplePercent;
  return {
    samplePercent: isQaSamplePercent(percent) ? percent : QA_SAMPLE_PERCENT_DEFAULT,
    prescoreEnabled: row?.prescoreEnabled ?? true,
    conflictCheck: row?.conflictCheck ?? true,
  };
}

/**
 * The workspace's active rubric — created as version 1 from
 * {@link PLATFORM_QA_RUBRIC} the first time one is needed. Two callers at once
 * wait on the workspace's rubric lock: the second finds the first's.
 */
export async function ensureActiveQaRubric(
  tx: TenantClient,
  licenseId: bigint,
): Promise<{ id: string; version: number }> {
  const read = () =>
    tx.qaRubric.findFirst({ where: { active: true }, select: { id: true, version: true } });
  const found = await read();
  if (found) return found;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`qa_rubrics:${licenseId}`}))`;
  const raced = await read();
  if (raced) return raced;
  await tx.$executeRaw`
    INSERT INTO qa_rubrics (id, license_id, version, criteria, active)
    SELECT ${randomUUID()}::uuid, ${licenseId}, COALESCE(MAX(version), 0) + 1,
           ${JSON.stringify(PLATFORM_QA_RUBRIC)}::jsonb, true
      FROM qa_rubrics`;
  const made = await read();
  if (!made) throw new Error('qa: the active rubric could not be created');
  return made;
}

// ---------------------------------------------------------------------------
// The pass
// ---------------------------------------------------------------------------

export interface QaDaySample {
  day: string;
  /** False when the day had been sampled already: nothing was read or written. */
  sampled: boolean;
  eligible: number;
  random: number;
  mandatory: number;
  queued: number;
  /** The connections queued, `thread_id` with its reasons. */
  picked: Array<{ threadId: string; reasons: QaReason[] }>;
}

export interface TenantQaSamplingResult {
  licenseId: string;
  days: QaDaySample[];
}

export interface QaSamplingReport {
  startedAt: string;
  finishedAt: string;
  tenants: TenantQaSamplingResult[];
  totals: {
    tenants: number;
    days: number;
    eligible: number;
    random: number;
    mandatory: number;
    queued: number;
  };
}

interface TenantRow {
  license_id: bigint;
  organization_id: string;
}

interface CandidateRow {
  thread_id: string;
  chat_id: string;
  group_id: bigint | null;
  brand_id: string | null;
  config_version_id: string | null;
  risk_flag: boolean;
  low_bsat: boolean;
  repeat_72h: boolean;
  guardrail_scan: boolean;
  mandatory_handoff: boolean;
  handoff_insufficient: boolean;
}

/** The connection aliased `alias` had the AI in it — see the module header. */
export function aiTookPart(alias: string): Prisma.Sql {
  const t = Prisma.raw(alias);
  return Prisma.sql`(
    EXISTS (SELECT 1 FROM ai_conversations a WHERE a.thread_id = ${t}.id)
    OR EXISTS (
      SELECT 1 FROM events e
       WHERE e.thread_id = ${t}.id AND e.author_type = 'bot' AND e.author_id = ${AI_BOT_ID}
         AND e.type = 'message'
    )
  )`;
}

export class QaSampler {
  readonly #db: PrismaClient;

  constructor(db: PrismaClient) {
    this.#db = db;
  }

  async run(options: { now?: Date; signal?: AbortSignal } = {}): Promise<QaSamplingReport> {
    const startedAt = new Date().toISOString();
    const now = options.now ?? new Date();
    const tenants = await this.#db.$queryRaw<TenantRow[]>`
      SELECT license_id, organization_id FROM retention_list_tenants()`;
    const results: TenantQaSamplingResult[] = [];
    for (const tenant of tenants) {
      if (options.signal?.aborted) break;
      const context: TenantContext = {
        licenseId: tenant.license_id,
        organizationId: tenant.organization_id,
      };
      results.push(await this.#sampleTenant(context, now));
    }
    const days = results.flatMap((r) => r.days.filter((d) => d.sampled));
    const sum = (pick: (d: QaDaySample) => number) => days.reduce((n, d) => n + pick(d), 0);
    return {
      startedAt,
      finishedAt: new Date().toISOString(),
      tenants: results,
      totals: {
        tenants: results.length,
        days: days.length,
        eligible: sum((d) => d.eligible),
        random: sum((d) => d.random),
        mandatory: sum((d) => d.mandatory),
        queued: sum((d) => d.queued),
      },
    };
  }

  async #sampleTenant(context: TenantContext, now: Date): Promise<TenantQaSamplingResult> {
    const { boundary, pending } = await withTenant(
      this.#db,
      context,
      async (tx) => {
        const boundary = await readDayBoundary(tx);
        const days = qaSamplingDays(now, boundary);
        const done = await tx.qaSamplingRun.findMany({
          where: { day: { in: days.map((day) => new Date(`${day}T00:00:00.000Z`)) } },
          select: { day: true },
        });
        const sampled = new Set(done.map((row) => row.day.toISOString().slice(0, 10)));
        return { boundary, pending: days.filter((day) => !sampled.has(day)) };
      },
      { readOnly: true },
    );
    const days: QaDaySample[] = [];
    for (const day of pending) {
      days.push(
        await withTenant(this.#db, context, (tx) => sampleQaDay(tx, context, day, now, boundary), {
          timeoutMs: SAMPLE_DAY_TIMEOUT_MS,
        }),
      );
    }
    return { licenseId: context.licenseId.toString(), days };
  }
}

/**
 * Sample one conversation day of the current workspace, in the caller's
 * transaction: marks the day, reads the AI connections that closed in it,
 * queues the drawn and the mandatory ones. A day already marked is left alone
 * (`sampled: false`).
 */
export async function sampleQaDay(
  tx: TenantClient,
  context: TenantContext,
  day: string,
  now: Date,
  boundary: DayBoundary,
): Promise<QaDaySample> {
  const licenseId = context.licenseId;
  const settings = await readQaSettings(tx);
  const nothing: QaDaySample = {
    day,
    sampled: false,
    eligible: 0,
    random: 0,
    mandatory: 0,
    queued: 0,
    picked: [],
  };
  const marked = await tx.$queryRaw<Array<{ day: Date }>>`
    INSERT INTO qa_sampling_runs (license_id, day, sample_percent)
    VALUES (${licenseId}, ${day}::date, ${settings.samplePercent})
    ON CONFLICT (license_id, day) DO NOTHING
    RETURNING day`;
  if (marked.length === 0) return nothing;

  const agent = await tx.aiAgent.findFirst({
    where: { kind: 'ai_agent' },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: { id: true },
  });
  const from = localDayStart(day, boundary.timezone, boundary.hour);
  const to = localDayStart(shiftDayKey(day, 1), boundary.timezone, boundary.hour);
  const candidates = agent
    ? await tx.$queryRaw<CandidateRow[]>`
        SELECT t.id AS thread_id, t.chat_id, t.group_id, c.brand_id::text AS brand_id,
               ac.config_version_id::text AS config_version_id,
               (cardinality(t.risk_flags) > 0
                 OR EXISTS (SELECT 1 FROM risk_flags rf WHERE rf.thread_id = t.id)) AS risk_flag,
               (NOT EXISTS (
                  SELECT 1 FROM events e WHERE e.thread_id = t.id AND e.author_type = 'agent')
                AND COALESCE((
                  SELECT r.value = 'bad' FROM ratings r
                   WHERE r.thread_id = t.id ORDER BY r.created_at DESC LIMIT 1), false)
               ) AS low_bsat,
               EXISTS (
                 SELECT 1 FROM chats pc JOIN threads p ON p.chat_id = pc.id
                  WHERE pc.customer_id = c.customer_id AND p.id <> t.id
                    AND p.closed_at IS NOT NULL
                    AND p.closed_at <= t.created_at
                    AND p.closed_at > t.created_at - make_interval(hours => ${QA_REPEAT_CONTACT_HOURS}::int)
                    AND ${aiTookPart('p')}
               ) AS repeat_72h,
               EXISTS (
                 SELECT 1 FROM ai_guardrail_hits h
                  WHERE h.thread_id = t.id AND (h.stage = 'output' OR h.action_taken = 'warn')
               ) AS guardrail_scan,
               EXISTS (
                 SELECT 1 FROM ai_handoffs ho
                  WHERE ho.thread_id = t.id
                    AND ho.reason_codes && ${[...QA_MANDATORY_HANDOFF_REASONS]}::text[]
               ) AS mandatory_handoff,
               EXISTS (
                 SELECT 1 FROM ai_handoffs ho
                  WHERE ho.thread_id = t.id AND ho.feedback = 'insufficient'
               ) AS handoff_insufficient
          FROM threads t
          JOIN chats c ON c.id = t.chat_id
          LEFT JOIN ai_conversations ac ON ac.thread_id = t.id
         WHERE NOT t.active
           AND t.closed_at >= ${from} AND t.closed_at < ${to}
           AND ${aiTookPart('t')}
         ORDER BY t.id`
    : [];

  const rubric = candidates.length > 0 ? await ensureActiveQaRubric(tx, licenseId) : null;
  const result: QaDaySample = { ...nothing, sampled: true, eligible: candidates.length };
  for (const row of candidates) {
    const drawn = qaSampledAtRandom(licenseId, day, row.thread_id, settings.samplePercent);
    const reasons = qaReasonsFor(drawn, row);
    if (reasons.length === 0) continue;
    if (drawn) result.random += 1;
    if (reasons.some((reason) => reason !== 'random')) result.mandatory += 1;
    const priority = qaPriorityOf(reasons);
    const excerpt = await readQaExcerpt(tx, row.thread_id);
    await tx.$executeRaw`
      INSERT INTO qa_reviews (
        id, license_id, chat_id, thread_id, ai_agent_id, config_version_id, team_id, brand_id,
        reasons, priority, status, sample_day, due_at, rubric_id, excerpt_masked
      ) VALUES (
        ${randomUUID()}::uuid, ${licenseId}, ${row.chat_id}, ${row.thread_id}, ${agent!.id}::uuid,
        ${row.config_version_id}::uuid, ${row.group_id}, ${row.brand_id}::uuid,
        ${reasons}::text[], ${QA_PRIORITY_RANK[priority]},
        ${settings.prescoreEnabled ? 'pending_prescore' : 'ready'}, ${day}::date,
        ${qaDueAt(now, priority, boundary.timezone)}, ${rubric!.id}::uuid,
        ${JSON.stringify(excerpt)}::jsonb
      )
      ON CONFLICT (license_id, thread_id) DO UPDATE SET
        reasons = ARRAY(
          SELECT merged.reason FROM (
            SELECT DISTINCT unnest(qa_reviews.reasons || EXCLUDED.reasons) AS reason
          ) merged
          ORDER BY array_position(${[...QA_REASONS]}::text[], merged.reason)
        ),
        priority = GREATEST(qa_reviews.priority, EXCLUDED.priority),
        due_at = LEAST(qa_reviews.due_at, EXCLUDED.due_at),
        sample_day = COALESCE(qa_reviews.sample_day, EXCLUDED.sample_day),
        updated_at = now()
      WHERE qa_reviews.status <> 'completed'`;
    result.queued += 1;
    result.picked.push({ threadId: row.thread_id, reasons });
  }
  await tx.$executeRaw`
    UPDATE qa_sampling_runs
       SET eligible = ${result.eligible}, random = ${result.random},
           mandatory = ${result.mandatory}, queued = ${result.queued}
     WHERE license_id = ${licenseId} AND day = ${day}::date`;
  return result;
}
