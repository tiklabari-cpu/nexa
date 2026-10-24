/**
 * The widget's risk signals and the human check they ask for (tm 339.2 ·
 * SiyahTuş analysis GV-01) — the third of the four layers that keep a script
 * from spending a workspace's AI: (1) the member's daily AI turns
 * (`customer-ai-quota.ts`), (2) the per-address rate limits
 * (`plugins/rate-limit.ts`), (3) this, (4) the workspace and deployment caps
 * (`ai-daily-budget.ts`).
 *
 * **Two doors.** The widget token mint (`POST /customer/token`), for a visitor
 * this workspace has not signed a member token for, and the message that opens
 * a conversation (`POST /customer/chat/events`). A flagged request without a
 * passing `challenge_token` is answered `403 challenge_required` before it
 * writes anything: the mint opens no customer, the message opens no chat.
 *
 * **Who is never asked.** A visitor whose member token this workspace signed
 * (ID-03 · K4: `identity` `verified`), and a member who passed a check in the
 * last {@link CHALLENGE_PASS_TTL_HOURS} hours (`customers.challenge_passed_at`).
 * And nobody at all while the workspace's mode is `off` or the deployment has
 * no provider (`resolveCaptcha`).
 *
 * **The signals**, generous because Turkish mobile carriers put many players
 * behind one address (CGNAT): new visitors one address opened in one workspace
 * in the last 10 minutes; the visitor's messages in the last minute; the
 * member's AI turns today. In mode `always_on_chat_start` every conversation
 * opening asks, signals or not.
 *
 * **Redis away = no check, never a closed door.** The counters live in Redis,
 * like the rate limits, and fail open the same way: a signal that cannot be
 * read is no signal. The allowance that has to hold without Redis — the
 * member's AI turns — is counted in Postgres. Keys sit under `rl:` so the
 * suites' `clearRateLimits` empties them with the rate limits.
 *
 * **Provider away = conversation yes, AI no.** A verdict the provider could
 * not give (`unavailable`) lets the request through, so a player can always
 * reach a person, and marks the member: the AI does not answer them for
 * {@link AI_WITHHELD_SECONDS} (`isAiWithheld`, read by `ai-responder.ts`).
 */
import {
  CHALLENGE_PASS_TTL_HOURS,
  CAPTCHA_MODE_DEFAULT,
  type CaptchaMode,
  type ChallengeReason,
  type ChallengeRequiredDetails,
  isCaptchaMode,
} from '@siyahtus/types';
import type { Redis } from 'ioredis';
import { randomUUID } from 'node:crypto';
import { ApiError } from '../../lib/api-error.js';
import type { TenantClient } from '../../lib/tenant.js';
import type { CaptchaVerdict, CaptchaVerifier } from './captcha.js';

export interface RiskThresholds {
  /** New visitors per address and workspace per 10 minutes before the next is asked. */
  readonly newCustomersPerIp: number;
  /** Messages per visitor per minute before opening a conversation asks. */
  readonly messagesPerMinute: number;
  /** A member's AI turns today before opening a conversation asks. */
  readonly aiTurnsToday: number;
}

/**
 * What the counters read. Null is "could not be read" (Redis away) or "not a
 * signal at this door" — never risky.
 */
export interface RiskSignals {
  /** New visitors this address opened in the workspace in the window, not counting this one. */
  readonly newCustomersFromIp: number | null;
  /** The visitor's messages in the last minute, this one included. */
  readonly messagesLastMinute: number | null;
  /** The member's AI turns so far today. */
  readonly aiTurnsToday: number | null;
}

/** The window the new-visitor signal counts over. */
export const NEW_CUSTOMER_WINDOW_MS = 10 * 60_000;
/** The window the message signal counts over. */
export const MESSAGE_WINDOW_MS = 60_000;
/** How long an unverifiable visitor goes without AI answers. */
export const AI_WITHHELD_SECONDS = 3600;

/**
 * The first signal over its threshold, or null. Each threshold is the number
 * that is still fine: the 31st new visitor at 30, the 21st message at 20, the
 * member's 21st turn at 20.
 */
export function assessRisk(
  signals: RiskSignals,
  thresholds: RiskThresholds,
): ChallengeReason | null {
  if (
    signals.newCustomersFromIp !== null &&
    signals.newCustomersFromIp >= thresholds.newCustomersPerIp
  ) {
    return 'new_customers_per_ip';
  }
  if (
    signals.messagesLastMinute !== null &&
    signals.messagesLastMinute > thresholds.messagesPerMinute
  ) {
    return 'messages_per_minute';
  }
  if (signals.aiTurnsToday !== null && signals.aiTurnsToday >= thresholds.aiTurnsToday) {
    return 'ai_turns_today';
  }
  return null;
}

/** Whether a pass at `passedAt` still spares the member a check at `now`. */
export function passedRecently(passedAt: Date | null, now: Date = new Date()): boolean {
  if (!passedAt) return false;
  return now.getTime() - passedAt.getTime() < CHALLENGE_PASS_TTL_HOURS * 3_600_000;
}

/**
 * The workspace's mode for a brand: its own security settings, else the
 * default brand's, else the default (`risk`).
 */
export async function readCaptchaMode(
  tx: TenantClient,
  brandId: string | null | undefined,
): Promise<CaptchaMode> {
  const rows = await tx.securitySettings.findMany({
    where: { OR: [...(brandId ? [{ brandId }] : []), { brand: { isDefault: true } }] },
    select: { brandId: true, captchaMode: true },
  });
  const own = brandId ? rows.find((row) => row.brandId === brandId) : undefined;
  const mode = (own ?? rows[0])?.captchaMode;
  return isCaptchaMode(mode) ? mode : CAPTCHA_MODE_DEFAULT;
}

/** What the door does with a request once the check, if any, is settled. */
export type ChallengeOutcome = 'clear' | 'passed' | 'withhold';

interface Log {
  warn(object: Record<string, unknown>, message: string): void;
}

export class AbuseGuard {
  constructor(
    private readonly redis: Redis,
    /** Null: the deployment asks no check (`resolveCaptcha`). */
    readonly verifier: CaptchaVerifier | null,
    readonly thresholds: RiskThresholds,
  ) {}

  /** Whether any check can be asked at all; the mode `off` is the workspace's half. */
  asks(mode: CaptchaMode): boolean {
    return this.verifier !== null && mode !== 'off';
  }

  /** New visitors this address opened in the workspace in the window. Null: unreadable. */
  async newCustomersFromIp(licenseId: bigint, ip: string, log: Log): Promise<number | null> {
    return this.#window(newCustomerKey(licenseId, ip), NEW_CUSTOMER_WINDOW_MS, false, log);
  }

  /** Count a visitor the mint just opened against its address. Best-effort. */
  async recordNewCustomer(licenseId: bigint, ip: string, log: Log): Promise<void> {
    await this.#window(newCustomerKey(licenseId, ip), NEW_CUSTOMER_WINDOW_MS, true, log);
  }

  /** Count one message of the visitor's; the minute's count, this one included. */
  async recordMessage(licenseId: bigint, customerId: string, log: Log): Promise<number | null> {
    return this.#window(messageKey(licenseId, customerId), MESSAGE_WINDOW_MS, true, log);
  }

  /**
   * The provider's verdict on the visitor's token, when there is a reason to
   * ask and a token to ask about; null otherwise (nothing to verify).
   */
  async verdictFor(
    reason: ChallengeReason | null,
    token: string | undefined,
    ip: string | null,
  ): Promise<CaptchaVerdict | null> {
    if (!reason || !token || !this.verifier) return null;
    return this.verifier.verify(token, ip);
  }

  /**
   * Settle a flagged request: through with a pass, through without AI when the
   * provider gave no verdict, and otherwise `challenge_required` — with the
   * reason it was flagged for, or `challenge_failed` for a refused token.
   */
  decide(reason: ChallengeReason, verdict: CaptchaVerdict | null, log: Log): ChallengeOutcome {
    if (verdict === 'passed') return 'passed';
    if (verdict === 'unavailable') {
      log.warn(
        { event: 'captcha.unavailable', reason },
        'the human check could not be verified; letting the visitor through without ai',
      );
      return 'withhold';
    }
    const asked = verdict === 'failed' ? 'challenge_failed' : reason;
    log.warn({ event: 'captcha.challenge', reason: asked }, 'visitor asked for a human check');
    throw this.challengeRequired(asked);
  }

  challengeRequired(reason: ChallengeReason): ApiError {
    const verifier = this.verifier!;
    const details: ChallengeRequiredDetails = {
      reason,
      provider: verifier.provider,
      site_key: verifier.siteKey,
    };
    return new ApiError('challenge_required', 'Confirm you are a person to continue.', {
      details: { ...details },
    });
  }

  /** The provider could not check this member: the AI does not answer them for a while. */
  async withholdAi(licenseId: bigint, customerId: string, log: Log): Promise<void> {
    try {
      await this.redis.set(withheldKey(licenseId, customerId), '1', 'EX', AI_WITHHELD_SECONDS);
    } catch (error) {
      log.warn({ err: error }, 'could not mark the unverified visitor; the ai may answer them');
    }
  }

  /** Whether the AI holds back from this member. False when it cannot be read. */
  async isAiWithheld(licenseId: bigint, customerId: string): Promise<boolean> {
    try {
      return (await this.redis.exists(withheldKey(licenseId, customerId))) === 1;
    } catch {
      return false;
    }
  }

  /** A sliding window over a sorted set: trim, optionally add, count. Null when Redis fails. */
  async #window(key: string, windowMs: number, record: boolean, log: Log): Promise<number | null> {
    const now = Date.now();
    try {
      const pipeline = this.redis.multi().zremrangebyscore(key, 0, now - windowMs);
      if (record) pipeline.zadd(key, now, randomUUID()).pexpire(key, windowMs);
      pipeline.zcard(key);
      const results = await pipeline.exec();
      const last = results?.[results.length - 1];
      if (!last || last[0]) throw last?.[0] ?? new Error('no reply');
      return Number(last[1]);
    } catch (error) {
      log.warn({ err: error }, 'abuse signal unavailable; no human check asked on it');
      return null;
    }
  }
}

function newCustomerKey(licenseId: bigint, ip: string): string {
  return `rl:risk:newcust:${licenseId}:${ip}`;
}

function messageKey(licenseId: bigint, customerId: string): string {
  return `rl:risk:msg:${licenseId}:${customerId}`;
}

function withheldKey(licenseId: bigint, customerId: string): string {
  return `rl:risk:noai:${licenseId}:${customerId}`;
}

declare module 'fastify' {
  interface FastifyInstance {
    /** The widget's risk signals and human check (tm 339.2); `buildServer` decorates it. */
    abuseGuard: AbuseGuard;
  }
}
