/**
 * The AI decision record's one writer (tm 288.2 · SiyahTuş analysis ID-08).
 *
 * Every AI turn leaves one `ai_decision_logs` row saying what the AI decided
 * and on what grounds, so "why did the AI say that to this player?" is
 * answered from a conversation number in minutes rather than by reading
 * stdout. Three rules shape this file:
 *
 *   1. **Never the words.** The record keeps ids, scores, flags and counts —
 *      not the customer's message, the reply or the prompt (ID-08). `details`
 *      is the one free-form column, so the keys text would arrive under are
 *      dropped here at any depth, and the table's CHECK refuses them at the
 *      top level anyway.
 *   2. **A record that cannot be written does not hold the reply back.** The
 *      write fails into one `error` log line and a `null`; it never throws.
 *      The customer's conversation matters more than the paper trail about it.
 *   3. **What arrives is trimmed, not refused.** An id that does not fit its
 *      column is left out, a list is capped, `details` over
 *      `AI_DECISION_DETAILS_MAX_BYTES` is replaced by a note of its size — a
 *      turn with one odd field is still a turn worth recording.
 *
 * The row goes in through the workspace's own tenant client, so row level
 * security decides the licence (`WITH CHECK`): a writer handed the wrong
 * tenant cannot file a decision under somebody else's workspace.
 */
import type { Prisma } from '@prisma/client';
import {
  AI_DECISION_DETAILS_MAX_BYTES,
  AI_DECISIONS,
  isAcceptableRequestId,
  type AiDecision,
} from '@siyahtus/types';
import { type TenantContext, UUID_RE } from '../../lib/tenant.js';
import type { StepDecision } from './conversation/procedure/executor.js';
import {
  describeSideEffects,
  tookTurn,
  turnsTaken,
  type TenantRunner,
  type TurnResult,
} from './conversation/turn.js';

/** What a turn decided, as its caller knows it. Only `decision` is required. */
export interface AiDecisionInput {
  decision: AiDecision;
  /** The day container (panel "Thread ID"). */
  chatId?: string | null;
  /** The connection (panel "Chat ID"). */
  threadId?: string | null;
  customerId?: string | null;
  triggerEventId?: string | null;
  replyEventId?: string | null;
  /** The HTTP request's `request_id`, when a request ran the turn. */
  requestId?: string | null;
  /** The queued job's id, when a job ran it. */
  jobId?: string | null;
  procedureId?: string | null;
  procedureVersion?: number | null;
  step?: string | null;
  knowledgeSourceIds?: readonly string[];
  chunkIds?: readonly string[];
  retrievalScores?: readonly number[];
  guardrailHits?: readonly string[];
  handoffReason?: string | null;
  riskFlags?: readonly string[];
  model?: string | null;
  llmInputTokens?: number;
  llmOutputTokens?: number;
  latencyMs?: number | null;
  errorType?: string | null;
  details?: Record<string, unknown>;
  configVersionId?: string | null;
}

/** Where the writer reports a row it could not write. */
export interface DecisionLogger {
  error(object: Record<string, unknown>, message: string): void;
}

/**
 * The keys conversation text would travel under. Dropped from `details` at
 * any depth; the top-level half is also the table's
 * `ai_decision_logs_details_no_text_check`.
 */
export const DECISION_TEXT_KEYS: ReadonlySet<string> = new Set([
  'text',
  'message',
  'reply',
  'prompt',
  'content',
  'body',
]);

/** The longest list a row keeps — far beyond any real retrieval or guardrail set. */
const MAX_LIST = 50;
/** The longest label (`step`, `model`, a flag) a row keeps. */
const MAX_LABEL = 200;
/** Postgres `INTEGER`. */
const MAX_INT = 2_147_483_647;

const CONVERSATION_ID_RE = /^[A-Za-z0-9_-]{1,12}$/;
const EVENT_ID_RE = /^[A-Za-z0-9_:.-]{1,40}$/;
const JOB_ID_RE = /^[A-Za-z0-9_:.-]{1,128}$/;

/**
 * Turn what the caller knows into the row, without touching the database.
 * Exported for the unit tests; the rules are this file's header.
 */
export function toDecisionRow(
  licenseId: bigint,
  input: AiDecisionInput,
): Prisma.AiDecisionLogUncheckedCreateInput {
  if (!(AI_DECISIONS as readonly string[]).includes(input.decision)) {
    // A caller's typo, not a turn's oddity: the type already forbids it, so
    // reaching here means a cast. Refused rather than filed under a guess.
    throw new TypeError(`unknown AI decision "${String(input.decision)}"`);
  }
  return {
    licenseId,
    decision: input.decision,
    chatId: matching(input.chatId, CONVERSATION_ID_RE),
    threadId: matching(input.threadId, CONVERSATION_ID_RE),
    customerId: matching(input.customerId, UUID_RE),
    triggerEventId: matching(input.triggerEventId, EVENT_ID_RE),
    replyEventId: matching(input.replyEventId, EVENT_ID_RE),
    requestId: isAcceptableRequestId(input.requestId) ? input.requestId : null,
    jobId: matching(input.jobId, JOB_ID_RE),
    procedureId: matching(input.procedureId, UUID_RE),
    procedureVersion:
      input.procedureVersion != null && Number.isInteger(input.procedureVersion)
        ? clamp(input.procedureVersion, 1, MAX_INT)
        : null,
    step: label(input.step),
    knowledgeSourceIds: uuids(input.knowledgeSourceIds),
    chunkIds: uuids(input.chunkIds),
    retrievalScores: (input.retrievalScores ?? [])
      .filter((score) => Number.isFinite(score))
      .slice(0, MAX_LIST),
    guardrailHits: labels(input.guardrailHits),
    handoffReason: label(input.handoffReason),
    riskFlags: labels(input.riskFlags),
    model: label(input.model),
    llmInputTokens: count(input.llmInputTokens) ?? 0,
    llmOutputTokens: count(input.llmOutputTokens) ?? 0,
    latencyMs: count(input.latencyMs),
    errorType: label(input.errorType),
    details: boundedDetails(input.details) as Prisma.InputJsonObject,
    configVersionId: matching(input.configVersionId, UUID_RE),
  };
}

/**
 * Record one AI turn. Resolves to the row's id, or `null` when it could not be
 * written — logged, never thrown (rule 2).
 */
export async function recordAiDecision(
  db: TenantRunner,
  tenant: TenantContext,
  input: AiDecisionInput,
  log: DecisionLogger,
): Promise<string | null> {
  try {
    const data = toDecisionRow(tenant.licenseId, input);
    const row = await db((tx) => tx.aiDecisionLog.create({ data, select: { id: true } }));
    return row.id;
  } catch (error) {
    log.error(
      { err: error, decision: input.decision },
      'ai decision could not be recorded; the reply is not held back',
    );
    return null;
  }
}

/**
 * What a turn decided, as the record spells it — or `null` when no skill ran
 * (no intent matched), which is not an AI turn: the message never reached the
 * AI and the conversation is a human's exactly as it would be without one.
 *
 * Ids, counts and labels only. The run log's `detail` strings are left out on
 * purpose: they quote tag names, fields and source titles an admin wrote, and
 * on a `request_info` step the field the customer was asked for.
 *
 * A procedure turn (tm 296.6 · AI-03 KAYIT) also files every step decision —
 * the turn's number on the connection and, per step, `step_id`, `type`,
 * `cond_result` and `detail` — with the hash of the definition it ran on.
 * Those details name only what the validator holds to a key pattern (step,
 * slot and template keys, reason and outcome codes); a tag, the one label
 * written freely, arrives quoted and is left out as `"…"` (see
 * {@link stepRecords}).
 */
export function skillDecision(
  turn: TurnResult,
): Omit<
  AiDecisionInput,
  'chatId' | 'threadId' | 'customerId' | 'requestId' | 'triggerEventId'
> | null {
  if (!tookTurn(turn)) return null;
  const decisions = turn.decisions;

  const decision: AiDecision = decisions.capped
    ? 'cap_reached'
    : decisions.outcome === 'handed_off'
      ? 'handoff'
      : decisions.outcome === 'skipped'
        ? 'silent'
        : decisions.replyKind === 'question'
          ? 'asked'
          : 'answered';

  const failure = decisions.failure;
  return {
    decision,
    procedureId: decisions.skillId,
    // A procedure turn stopped on the last step it decided; the log's last line
    // can be the compose call or the offer to go back to a set-aside topic.
    step: decisions.trace?.at(-1)?.step_id ?? decisions.log.at(-1)?.step ?? null,
    handoffReason:
      decision !== 'handoff'
        ? null
        : failure
          ? `${failure.provider}_failure`
          : // A procedure names its own reason (tm 296.3): its step's `reason_code`,
            // `max_turns`, `procedure_condition`, `slot_refused`.
            (decisions.handoffReason ??
            (describeSideEffects(turn.sideEffects).transferTo ? 'transfer_to_team' : null)),
    errorType: failure ? `${failure.provider}:${failure.kind}` : null,
    llmInputTokens: decisions.usage.llmInputTokens,
    llmOutputTokens: decisions.usage.llmOutputTokens,
    details: withTrace(
      {
        outcome: decisions.outcome,
        steps: decisions.log.map((entry) => entry.step),
        failed_steps: decisions.log.filter((entry) => !entry.ok).map((entry) => entry.step),
        embedding_tokens: decisions.usage.embeddingTokens,
        ...(decisions.capped ? { cap_scope: decisions.capped.scope } : {}),
        ...(failure ? { transient: failure.transient } : {}),
        ...(decisions.understood ? { understood: decisions.understood } : {}),
      },
      turn,
    ),
  };
}

/**
 * A procedure turn's details: the base, the turn, the step decisions and the
 * hash. The trace gives way before the base does — entries are let go, the
 * earliest first, until the whole fits `AI_DECISION_DETAILS_MAX_BYTES`, so a
 * long turn never has its outcome replaced by a size note. A single-message
 * turn's details are the base, as they always were.
 */
function withTrace(base: Record<string, unknown>, turn: TurnResult): Record<string, unknown> {
  const { trace, procedureHash } = turn.decisions;
  if (!trace) return base;
  const head = {
    ...base,
    turn: turnsTaken(turn.nextState),
    ...(procedureHash ? { procedure_hash: procedureHash } : {}),
  };
  for (let keep = Math.min(trace.length, MAX_TRACE_STEPS); ; keep -= 1) {
    const details = { ...head, ...stepRecords(trace, keep) };
    if (
      keep === 0 ||
      Buffer.byteLength(JSON.stringify(details), 'utf8') <= AI_DECISION_DETAILS_MAX_BYTES
    ) {
      return details;
    }
  }
}

/** The most step decisions one row keeps: past the inner-step limit with room to spare. */
export const MAX_TRACE_STEPS = 24;
/** The longest step `detail` one row keeps. */
const MAX_TRACE_DETAIL = 120;

/**
 * A procedure turn's step decisions as the record keeps them (ID-08): the last
 * `keep` of them — where the turn ended matters most — each `detail` within
 * {@link MAX_TRACE_DETAIL} characters, and how many earlier ones were let go.
 * Quoted text — a tag's name, the one label an admin writes freely — becomes
 * `"…"`.
 */
export function stepRecords(
  trace: readonly StepDecision[],
  keep = MAX_TRACE_STEPS,
): {
  trace: StepDecision[];
  trace_dropped?: number;
} {
  const kept = trace.slice(Math.max(0, trace.length - keep)).map((entry) => ({
    step_id: entry.step_id.slice(0, MAX_LABEL),
    type: entry.type,
    cond_result: entry.cond_result,
    detail: entry.detail.replace(/"[^"]*"/g, '"…"').slice(0, MAX_TRACE_DETAIL),
  }));
  return trace.length > kept.length
    ? { trace: kept, trace_dropped: trace.length - kept.length }
    : { trace: kept };
}

/**
 * `details` without conversation text and within the column's ceiling. A
 * value that is not a plain object becomes `{}`; one over the ceiling becomes
 * a note of how large it was, so the row still says something was there.
 */
export function boundedDetails(
  details: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!isPlainObject(details)) return {};
  const clean = withoutText(details) as Record<string, unknown>;
  const bytes = Buffer.byteLength(JSON.stringify(clean), 'utf8');
  return bytes <= AI_DECISION_DETAILS_MAX_BYTES ? clean : { truncated: true, bytes };
}

function withoutText(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutText);
  if (!isPlainObject(value)) {
    // JSON has no bigint, and a bigint is what this codebase's ids are; a
    // string keeps the digits a number would lose. Anything else JSON cannot
    // hold (a function, a symbol, `undefined`) is dropped by the serialiser.
    return typeof value === 'bigint' ? value.toString() : value;
  }
  const out: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value)) {
    if (DECISION_TEXT_KEYS.has(key.toLowerCase())) continue;
    out[key] = withoutText(inner);
  }
  return out;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value) as unknown;
  return proto === Object.prototype || proto === null;
}

function matching(value: string | null | undefined, pattern: RegExp): string | null {
  return typeof value === 'string' && pattern.test(value) ? value : null;
}

function label(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, MAX_LABEL) : null;
}

function labels(values: readonly string[] | undefined): string[] {
  return (values ?? [])
    .map((value) => label(value))
    .filter((value): value is string => value !== null)
    .slice(0, MAX_LIST);
}

function uuids(values: readonly string[] | undefined): string[] {
  return (values ?? []).filter((value) => UUID_RE.test(value)).slice(0, MAX_LIST);
}

function count(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return clamp(Math.round(value), 0, MAX_INT);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
