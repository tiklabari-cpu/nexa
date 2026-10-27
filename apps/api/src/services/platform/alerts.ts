/**
 * Operator alerts (tm 389.20 · FR-ADMIN-24 · design.md §C): the SiyahTuş team
 * hears about the conditions that need a person without looking at the panel.
 *
 * A scan every five minutes in the platform-api process looks for six
 * conditions and mails the operators who asked for them (`platform_alert_prefs`):
 *
 *   trial_ending             a trial that ends within three days
 *   payment_request_waiting  a crypto payment request waiting 24 hours or more
 *   ai_cap_reached           a workspace at its daily AI allowance
 *   health_red               the health snapshot stale, missing or degraded
 *   audit_chain_broken       the platform audit chain no longer verifies
 *   purge_tomorrow           a workspace whose data is deleted tomorrow
 *
 * **One scan across replicas.** The same Redis lock the other sweeps use
 * (`siyahtus:platform:alerts:lock`), held for the interval's own length. It is
 * not what stops a double mail, though — the dedup claim is: before anything
 * is sent, `SET … NX` on `kind + target + bucket`, so even two scans that both
 * got through (a lock that expired mid-pass) mail each alert once.
 *
 * **Once a day per alert, once an hour for the critical two.** The bucket is
 * the UTC day (24 h key) or, for `health_red` and `audit_chain_broken`, the UTC
 * hour (1 h key): a red dashboard is worth hearing about again before lunch.
 * A claim whose every mail failed is handed back, so the next scan retries.
 * Nothing is claimed when no operator wants the kind — a later opt-in is then
 * not shut out for the day.
 *
 * **Who.** An operator with a saved choice gets exactly the kinds in it; one
 * without gets every kind if they are a superadmin and nothing otherwise. A
 * disabled operator gets nothing whatever they saved.
 *
 * **What the mail says.** Names, ids, counts and times — the platform never
 * carries tenant content (requirements §2).
 *
 * The platform carrier has no daily caps (`createMailer` in
 * `platform-server.ts`), so alerts cannot be swallowed by a workspace's budget
 * or starve it; the volume is bounded by the dedup above.
 */
import type { PrismaClient } from '@prisma/client';
import type { FastifyBaseLogger } from 'fastify';
import type { Redis } from 'ioredis';
import {
  PLATFORM_ALERT_KINDS,
  PLATFORM_CRITICAL_ALERT_KINDS,
  type PlatformAlertKind,
  type PlatformAlertLocale,
  type PlatformRole,
} from '@siyahtus/types';
import { aiDailyCaps, type AiDailyCaps } from '../ai/ai-daily-budget.js';
import { resolveAiCaps, storedCap } from '../ai/ai-caps.js';
import { AI_CAPS_SETTING_KEY, parseDeploymentCaps } from '../ai/ai-settings.js';
import { aiDailyTokensForPlan } from '../billing/subscription-service.js';
import { deliver, type MailOutcome } from '../mail/delivery.js';
import type { Mailer } from '../mail/mailer.js';
import { platformAlertMail, type PlatformAlertMailInput } from '../mail/templates/messages.js';
import { OPS_HEALTH_KEY } from '../ops/health-keys.js';
import { JobLock, lockTtlMs } from '../scheduler/lock.js';
import { parseStored, SNAPSHOT_STALE_AFTER_S } from './dashboard.js';
import type { PlatformAuditLog } from './platform-audit.js';

/** Five minutes: the shortest wait worth an alert, and a scan is a handful of queries. */
export const ALERT_SCAN_INTERVAL_MS = 5 * 60_000;
export const ALERT_LOCK_KEY = 'siyahtus:platform:alerts:lock';
export const ALERT_SENT_PREFIX = 'siyahtus:platform:alerts:sent:';
/** The daily chain check's outcome, so a broken chain is remembered between verifications. */
export const ALERT_CHAIN_KEY = 'siyahtus:platform:alerts:chain';
/** How long a verification stands: the check walks the whole chain, so it runs daily. */
export const ALERT_CHAIN_TTL_S = 24 * 3600;

/** A trial inside this window is reported. */
export const ALERT_TRIAL_DAYS = 3;
/** A payment request this old, still unhandled, is reported. */
export const ALERT_PAYMENT_WAIT_HOURS = 24;
/**
 * A call is refused once its estimate no longer fits, so a workspace's counter
 * stops a little below its cap and never equals it. At or over this share of
 * the cap the allowance counts as reached.
 */
export const ALERT_AI_CAP_RATIO = 0.99;

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

/** What an operator is mailed when they never saved a choice. */
export function defaultAlertKinds(role: string): readonly PlatformAlertKind[] {
  return role === ('superadmin' satisfies PlatformRole) ? PLATFORM_ALERT_KINDS : [];
}

/** The kinds an operator is mailed: their saved choice (names we know), else the role's default. */
export function effectiveAlertKinds(
  role: string,
  prefs: { kinds: readonly string[] } | null,
): PlatformAlertKind[] {
  if (!prefs) return [...defaultAlertKinds(role)];
  return PLATFORM_ALERT_KINDS.filter((kind) => prefs.kinds.includes(kind));
}

export function alertLocale(value: string | null | undefined): PlatformAlertLocale {
  return value === 'tr' ? 'tr' : 'en';
}

/** One condition on one target, found by a scan. */
interface Candidate {
  kind: PlatformAlertKind;
  /** Part of the dedup key: what the condition is about, without a day in it. */
  target: string;
  input: PlatformAlertMailInput;
  /** The admin SPA page for it, relative to its origin. */
  panelPath: string;
}

interface Recipient {
  email: string;
  kinds: ReadonlySet<PlatformAlertKind>;
  locale: PlatformAlertLocale;
}

export interface AlertScanReport {
  /** Conditions found this pass. */
  found: number;
  /** Alerts mailed (at least one recipient reached). */
  mailed: number;
  /** Mails handed to the carrier. */
  mails: number;
  /** Already mailed in this bucket. */
  duplicate: number;
  /** Nobody asked for this kind. */
  unwanted: number;
  /** Every mail of the alert failed; the claim was handed back. */
  failed: number;
  /** Sources that threw — logged, the pass went on without them. */
  source_errors: number;
}

export interface PlatformAlertScannerOptions {
  db: PrismaClient;
  redis: Redis;
  mailer: Mailer;
  audit: Pick<PlatformAuditLog, 'verify'>;
  logger: FastifyBaseLogger;
  /** `ADMIN_APP_URL` — the mail's links. */
  adminOrigin: string;
  /** The tenant API's `AI_DAILY_*` fallback when `ai.caps` is not stored. */
  env: Parameters<typeof aiDailyCaps>[0];
  /** Whether this process runs the timer at all (`env.schedulerEnabled`). */
  enabled: boolean;
  now?: () => number;
}

const dayKey = (at: Date): string => at.toISOString().slice(0, 10).replaceAll('-', '');
const hourKey = (at: Date): string => `${dayKey(at)}${at.toISOString().slice(11, 13)}`;

export class PlatformAlertScanner {
  readonly #options: PlatformAlertScannerOptions;
  readonly #lock: JobLock;
  #timer: NodeJS.Timeout | null = null;
  #inFlight: Promise<unknown> | null = null;
  #stopped = false;

  constructor(options: PlatformAlertScannerOptions) {
    this.#options = options;
    this.#lock = new JobLock(options.redis, () => ALERT_LOCK_KEY);
  }

  start(): void {
    if (!this.#options.enabled || this.#timer !== null || this.#stopped) return;
    // A minute in: a platform-api that starts with the tenant API must not
    // report its still-missing health snapshot as red.
    this.#schedule(60_000);
  }

  async stop(): Promise<void> {
    this.#stopped = true;
    if (this.#timer !== null) clearTimeout(this.#timer);
    this.#timer = null;
    await this.#inFlight?.catch(() => undefined);
  }

  #schedule(delayMs: number): void {
    if (this.#stopped) return;
    this.#timer = setTimeout(() => {
      this.#timer = null;
      this.#inFlight = this.tick().finally(() => {
        this.#inFlight = null;
        this.#schedule(ALERT_SCAN_INTERVAL_MS);
      });
    }, delayMs);
    this.#timer.unref();
  }

  /** One timer tick: the lock, then a pass. Public for tests. */
  async tick(): Promise<AlertScanReport | 'skipped' | 'failed'> {
    try {
      const token = await this.#lock.acquire(ALERT_LOCK_KEY, lockTtlMs(ALERT_SCAN_INTERVAL_MS));
      if (token === null) return 'skipped';
      return await this.runAlertScanOnce();
    } catch (error) {
      this.#options.logger.warn(
        { err: error, event: 'platform.alert_scan_failed' },
        'alert scan failed',
      );
      return 'failed';
    }
  }

  /** One pass, lock or no lock — what a tick does once it holds the lock. */
  async runAlertScanOnce(): Promise<AlertScanReport> {
    const { logger } = this.#options;
    const now = new Date((this.#options.now ?? Date.now)());
    const report: AlertScanReport = {
      found: 0,
      mailed: 0,
      mails: 0,
      duplicate: 0,
      unwanted: 0,
      failed: 0,
      source_errors: 0,
    };

    const sources: Array<[string, () => Promise<Candidate[]>]> = [
      ['trial_ending', () => this.#trialsEnding(now)],
      ['payment_request_waiting', () => this.#paymentsWaiting(now)],
      ['ai_cap_reached', () => this.#aiCapsReached(now)],
      ['health_red', () => this.#healthRed(now)],
      ['audit_chain_broken', () => this.#auditChain()],
      ['purge_tomorrow', () => this.#purgesTomorrow(now)],
    ];
    const candidates: Candidate[] = [];
    for (const [name, source] of sources) {
      try {
        candidates.push(...(await source()));
      } catch (error) {
        report.source_errors += 1;
        logger.warn(
          { err: error, event: 'platform.alert_source_failed', alert_kind: name },
          'alert source failed',
        );
      }
    }
    report.found = candidates.length;
    if (candidates.length === 0) return report;

    const recipients = await this.#recipients();
    for (const candidate of candidates) {
      const wanting = recipients.filter((r) => r.kinds.has(candidate.kind));
      if (wanting.length === 0) {
        report.unwanted += 1;
        continue;
      }
      const critical = PLATFORM_CRITICAL_ALERT_KINDS.includes(candidate.kind);
      const key = `${ALERT_SENT_PREFIX}${candidate.kind}:${candidate.target}:${critical ? hourKey(now) : dayKey(now)}`;
      const claimed = await this.#options.redis.set(key, '1', 'EX', critical ? 3600 : 86_400, 'NX');
      if (claimed !== 'OK') {
        report.duplicate += 1;
        continue;
      }
      const outcomes = await Promise.all(wanting.map((r) => this.#send(candidate, r)));
      const reached = outcomes.filter((o) => o.status !== 'failed').length;
      report.mails += reached;
      if (reached === 0) {
        // Nobody was told: give the claim back so the next scan tries again.
        await this.#options.redis.del(key).catch(() => undefined);
        report.failed += 1;
        logger.warn(
          { event: 'platform.alert_unsent', alert_kind: candidate.kind, target: candidate.target },
          'platform alert could not be mailed to anyone',
        );
        continue;
      }
      report.mailed += 1;
      logger.info(
        {
          event: 'platform.alert_sent',
          alert_kind: candidate.kind,
          target: candidate.target,
          recipients: reached,
        },
        'platform alert mailed',
      );
    }
    return report;
  }

  async #send(candidate: Candidate, recipient: Recipient): Promise<MailOutcome> {
    const { adminOrigin, mailer } = this.#options;
    return deliver(mailer, {
      to: recipient.email,
      licenseId: null,
      kind: 'platform_alert',
      ...platformAlertMail(
        { locale: recipient.locale, appUrl: adminOrigin },
        candidate.input,
        `${adminOrigin.replace(/\/$/, '')}${candidate.panelPath}`,
      ),
    });
  }

  async #recipients(): Promise<Recipient[]> {
    const admins = await this.#options.db.platformAdmin.findMany({
      where: { disabledAt: null },
      select: { email: true, role: true, alertPrefs: { select: { kinds: true, locale: true } } },
    });
    return admins.map((admin) => ({
      email: admin.email,
      kinds: new Set(effectiveAlertKinds(admin.role, admin.alertPrefs)),
      locale: alertLocale(admin.alertPrefs?.locale),
    }));
  }

  // --- The six conditions ------------------------------------------------------

  async #trialsEnding(now: Date): Promise<Candidate[]> {
    const until = new Date(now.getTime() + ALERT_TRIAL_DAYS * DAY_MS);
    const rows = await this.#options.db.$queryRaw<
      Array<{ id: bigint; name: string; trial_ends_at: Date }>
    >`
      SELECT l.id, o.name, l.trial_ends_at FROM licenses l
      JOIN organizations o ON o.id = l.organization_id
      WHERE l.sandbox_of_license_id IS NULL AND l.status = 'trialing'
        AND l.trial_ends_at > ${now} AND l.trial_ends_at <= ${until}
      ORDER BY l.trial_ends_at, l.id LIMIT 200`;
    return rows.map((row) => ({
      kind: 'trial_ending',
      target: row.id.toString(),
      panelPath: `/workspaces/${row.id}`,
      input: {
        kind: 'trial_ending',
        workspaceName: row.name,
        workspaceId: row.id.toString(),
        endsAt: row.trial_ends_at,
      },
    }));
  }

  /**
   * The manual crypto payment queue (tm 382/389.18). The table is looked up,
   * not assumed — the dashboard does the same: this ships before the queue.
   */
  async #paymentsWaiting(now: Date): Promise<Candidate[]> {
    const { db } = this.#options;
    const present = await db.$queryRaw<Array<{ present: boolean }>>`
      SELECT to_regclass('public.crypto_payment_requests') IS NOT NULL AS present`;
    if (!present[0]?.present) return [];
    const before = new Date(now.getTime() - ALERT_PAYMENT_WAIT_HOURS * HOUR_MS);
    const rows = await db.$queryRaw<
      Array<{ id: string; license_id: bigint; name: string; created_at: Date }>
    >`
      SELECT r.id::text AS id, r.license_id, o.name, r.created_at
      FROM crypto_payment_requests r
      JOIN licenses l ON l.id = r.license_id
      JOIN organizations o ON o.id = l.organization_id
      WHERE r.status IN ('pending', 'requested') AND r.created_at <= ${before}
      ORDER BY r.created_at, r.id LIMIT 200`;
    return rows.map((row) => ({
      kind: 'payment_request_waiting',
      target: row.id,
      panelPath: '/billing',
      input: {
        kind: 'payment_request_waiting',
        workspaceName: row.name,
        workspaceId: row.license_id.toString(),
        requestedAt: row.created_at,
        waitingHours: Math.floor((now.getTime() - row.created_at.getTime()) / HOUR_MS),
      },
    }));
  }

  async #deploymentCaps(): Promise<AiDailyCaps> {
    const row = await this.#options.db.platformSetting.findUnique({
      where: { key: AI_CAPS_SETTING_KEY },
      select: { value: true },
    });
    return parseDeploymentCaps(row?.value) ?? aiDailyCaps(this.#options.env);
  }

  async #aiCapsReached(now: Date): Promise<Candidate[]> {
    const { db } = this.#options;
    const day = dayKey(now);
    const [rows, deployment] = await Promise.all([
      db.$queryRaw<
        Array<{
          id: bigint;
          name: string;
          plan: string;
          meter: 'llm' | 'embedding';
          spent: bigint;
          llm_cap: bigint | null;
          embedding_cap: bigint | null;
        }>
      >`
        SELECT l.id, o.name, l.plan, u.meter, (u.used + u.reserved) AS spent,
               l.ai_daily_llm_tokens_cap AS llm_cap,
               l.ai_daily_embedding_tokens_cap AS embedding_cap
        FROM ai_daily_usage u
        JOIN licenses l ON l.id = u.license_id
        JOIN organizations o ON o.id = l.organization_id
        WHERE u.day = ${day} AND u.license_id IS NOT NULL AND u.meter IN ('llm', 'embedding')
          AND l.sandbox_of_license_id IS NULL AND u.used + u.reserved > 0
        ORDER BY l.id, u.meter`,
      this.#deploymentCaps(),
    ]);
    const candidates: Candidate[] = [];
    for (const row of rows) {
      const caps = resolveAiCaps(
        {
          override: { llm: storedCap(row.llm_cap), embedding: storedCap(row.embedding_cap) },
          plan: aiDailyTokensForPlan(row.plan),
        },
        deployment,
      );
      const cap = caps.workspace[row.meter];
      const spent = Number(row.spent);
      if (cap < 1 || spent < cap * ALERT_AI_CAP_RATIO) continue;
      candidates.push({
        kind: 'ai_cap_reached',
        target: `${row.id}:${row.meter}`,
        panelPath: '/usage',
        input: {
          kind: 'ai_cap_reached',
          workspaceName: row.name,
          workspaceId: row.id.toString(),
          meter: row.meter,
          used: spent,
          cap,
        },
      });
    }
    return candidates;
  }

  async #healthRed(now: Date): Promise<Candidate[]> {
    const stored = parseStored(await this.#options.redis.get(OPS_HEALTH_KEY));
    const candidate = (
      input: Extract<PlatformAlertMailInput, { kind: 'health_red' }>,
    ): Candidate[] => [
      { kind: 'health_red', target: input.reason, panelPath: '/dashboard', input },
    ];
    if (stored === null) {
      return candidate({
        kind: 'health_red',
        reason: 'stale',
        ageSeconds: null,
        detail: 'no snapshot',
      });
    }
    const ageS = Math.max(0, (now.getTime() - Date.parse(stored.generated_at)) / 1000);
    if (ageS > SNAPSHOT_STALE_AFTER_S) {
      return candidate({
        kind: 'health_red',
        reason: 'stale',
        ageSeconds: ageS,
        detail: 'snapshot too old',
      });
    }
    if (stored.health.status !== 'ok') {
      const down = Object.entries(stored.health.dependencies ?? {})
        .filter(([, dependency]) => dependency?.status !== 'up')
        .map(([name]) => name);
      return candidate({
        kind: 'health_red',
        reason: 'degraded',
        ageSeconds: ageS,
        detail: down.length > 0 ? `${down.join(', ')} down` : 'see the health view',
      });
    }
    return [];
  }

  /**
   * The platform chain, verified once a day. The outcome is kept (Redis, 24 h),
   * so a broken chain keeps being reported between verifications; a failed
   * verification is run once more before it is believed, since an entry written
   * between the walk and the head read looks like a missing tail.
   */
  async #auditChain(): Promise<Candidate[]> {
    const { redis, audit } = this.#options;
    let state = await redis.get(ALERT_CHAIN_KEY);
    if (state === null) {
      let result = await audit.verify();
      if (!result.ok) result = await audit.verify();
      state = JSON.stringify({
        ok: result.ok,
        findings: result.findings_total,
        first_seq: result.findings[0]?.seq ?? result.first_seq,
        checked: result.checked,
      });
      await redis.set(ALERT_CHAIN_KEY, state, 'EX', ALERT_CHAIN_TTL_S);
    }
    const parsed = JSON.parse(state) as {
      ok: boolean;
      findings: number;
      first_seq: string | null;
      checked: number;
    };
    if (parsed.ok) return [];
    return [
      {
        kind: 'audit_chain_broken',
        target: 'platform_chain',
        panelPath: '/audit',
        input: {
          kind: 'audit_chain_broken',
          findings: parsed.findings,
          firstSeq: parsed.first_seq,
          checked: parsed.checked,
        },
      },
    ];
  }

  /** Workspaces whose scheduled deletion falls on the next UTC calendar day. */
  async #purgesTomorrow(now: Date): Promise<Candidate[]> {
    const tomorrow = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1),
    );
    const dayAfter = new Date(tomorrow.getTime() + DAY_MS);
    const rows = await this.#options.db.$queryRaw<
      Array<{ id: bigint; name: string; purge_scheduled_at: Date }>
    >`
      SELECT l.id, o.name, l.purge_scheduled_at FROM licenses l
      JOIN organizations o ON o.id = l.organization_id
      WHERE l.purge_scheduled_at >= ${tomorrow} AND l.purge_scheduled_at < ${dayAfter}
      ORDER BY l.purge_scheduled_at, l.id LIMIT 200`;
    return rows.map((row) => ({
      kind: 'purge_tomorrow',
      target: row.id.toString(),
      panelPath: `/workspaces/${row.id}`,
      input: {
        kind: 'purge_tomorrow',
        workspaceName: row.name,
        workspaceId: row.id.toString(),
        purgeAt: row.purge_scheduled_at,
      },
    }));
  }
}
