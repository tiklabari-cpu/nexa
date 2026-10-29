/**
 * The per-member daily AI allowance (tm 339.1 · SiyahTuş analysis GV-01):
 * how many AI turns one member may have answered in one conversation day.
 *
 * The daily caps (`ai-daily-budget.ts`) bound what a workspace spends, in
 * tokens; nothing bound what one visitor takes of it. A script on any page
 * that carries the widget could spend the workspace's whole day, and from then
 * until midnight every player waits for a person. So each member gets a share:
 * `security_settings.ai_turns_per_customer_day` turns a day (40 unless the
 * workspace says otherwise; 0 is "no per-member allowance"). The 41st turn is
 * refused before the model is asked and the conversation goes to a person
 * (`ai-responder.ts`).
 *
 * **Counted in Postgres, in one statement.** Like the token caps, and for the
 * same reason: every Redis bucket here fails open (`plugins/rate-limit.ts`),
 * and an allowance that opens when Redis is away is not one. The claim is
 * `INSERT … ON CONFLICT DO UPDATE … WHERE ai_turns < cap RETURNING` — the
 * check and the increment are one row lock, so ten turns at once cannot all
 * slip under the line. A refused claim writes nothing.
 *
 * **Counted at the gate.** A turn is counted when the AI is about to take it,
 * before the model is asked — the count cannot wait for the answer, or every
 * turn in flight would see room. A claimed turn that then turns out to be
 * nothing (the visitor's message answered by another engine meanwhile, a
 * provider failure) stays counted, which errs toward the allowance.
 *
 * **The member's conversation day**, not the UTC day the token caps use: the
 * workspace's day boundary (ID-04, `readDayBoundary`) — the day the member's
 * daily chat is filed under, so "40 a day" means the same day the panel shows.
 */
import { AI_TURNS_PER_CUSTOMER_DAY_DEFAULT, localDayKey } from '@siyahtus/types';
import type { TenantClient } from '../../lib/tenant.js';
import { readDayBoundary } from '../chat/day-boundary.js';

/** What a claim decided. `cap` null: the workspace has no per-member allowance. */
export interface CustomerAiTurnClaim {
  readonly allowed: boolean;
  /** `YYYY-MM-DD`, the workspace's conversation day the turn is counted on. */
  readonly day: string;
  /** The member's turns today, this one included when it was allowed. */
  readonly turns: number;
  readonly cap: number | null;
}

/**
 * The workspace's per-member allowance for a conversation: its brand's
 * security settings, else the default brand's, else the default.
 */
export async function customerAiTurnCap(tx: TenantClient, brandId: string | null): Promise<number> {
  const rows = await tx.securitySettings.findMany({
    where: {
      OR: [...(brandId ? [{ brandId }] : []), { brand: { isDefault: true } }],
    },
    select: { brandId: true, aiTurnsPerCustomerDay: true },
  });
  const own = brandId ? rows.find((row) => row.brandId === brandId) : undefined;
  return (own ?? rows[0])?.aiTurnsPerCustomerDay ?? AI_TURNS_PER_CUSTOMER_DAY_DEFAULT;
}

/**
 * Claim one AI turn for `customerId` on today's conversation day, or refuse it
 * when the member has had the allowance already. Call inside the tenant's
 * transaction; the claim commits with it.
 */
export async function claimCustomerAiTurn(
  tx: TenantClient,
  input: { licenseId: bigint; customerId: string; chatId: string; at?: Date },
): Promise<CustomerAiTurnClaim> {
  const at = input.at ?? new Date();
  const [boundary, chat] = await Promise.all([
    readDayBoundary(tx),
    tx.chat.findUnique({ where: { id: input.chatId }, select: { brandId: true } }),
  ]);
  const day = localDayKey(at, boundary.timezone, boundary.hour);
  const cap = await customerAiTurnCap(tx, chat?.brandId ?? null);
  if (cap <= 0) return { allowed: true, day, turns: 0, cap: null };

  const claimed = await tx.$queryRaw<Array<{ ai_turns: number }>>`
    INSERT INTO ai_customer_daily_usage (license_id, customer_id, day, ai_turns, updated_at)
    VALUES (${input.licenseId}, ${input.customerId}::uuid, ${day}::date, 1, now())
    ON CONFLICT (license_id, customer_id, day) DO UPDATE
      SET ai_turns = ai_customer_daily_usage.ai_turns + 1, updated_at = now()
      WHERE ai_customer_daily_usage.ai_turns < ${cap}
    RETURNING ai_turns`;
  const turns = claimed[0]?.ai_turns;
  if (turns !== undefined) return { allowed: true, day, turns, cap };

  const used = await tx.$queryRaw<Array<{ ai_turns: number }>>`
    SELECT ai_turns FROM ai_customer_daily_usage
    WHERE license_id = ${input.licenseId} AND customer_id = ${input.customerId}::uuid
      AND day = ${day}::date`;
  return { allowed: false, day, turns: used[0]?.ai_turns ?? cap, cap };
}

/**
 * Add what a claimed turn cost to the member's row, for the record. Decides
 * nothing; a turn on a workspace without a per-member allowance has no row.
 */
export async function addCustomerAiTokens(
  tx: TenantClient,
  input: { licenseId: bigint; customerId: string; day: string; tokens: number },
): Promise<void> {
  const tokens = Math.max(0, Math.ceil(input.tokens));
  if (tokens === 0) return;
  await tx.$executeRaw`
    UPDATE ai_customer_daily_usage
    SET llm_tokens = llm_tokens + ${BigInt(tokens)}, updated_at = now()
    WHERE license_id = ${input.licenseId} AND customer_id = ${input.customerId}::uuid
      AND day = ${input.day}::date`;
}

/**
 * The member's AI turns so far on today's conversation day — one of the
 * widget's risk signals (tm 339.2 · GV-01). Reads, never counts.
 */
export async function customerAiTurnsToday(
  tx: TenantClient,
  input: { licenseId: bigint; customerId: string; at?: Date },
): Promise<number> {
  const boundary = await readDayBoundary(tx);
  const day = localDayKey(input.at ?? new Date(), boundary.timezone, boundary.hour);
  const rows = await tx.$queryRaw<Array<{ ai_turns: number }>>`
    SELECT ai_turns FROM ai_customer_daily_usage
    WHERE license_id = ${input.licenseId} AND customer_id = ${input.customerId}::uuid
      AND day = ${day}::date`;
  return rows[0]?.ai_turns ?? 0;
}

/**
 * Whether the member has a turn of today's allowance left — the claim's
 * question, read only (WG-09: an AI the member has used up is no AI for the
 * widget's availability). `brandId` is the brand a conversation opened now
 * would carry. True when the workspace has no per-member allowance.
 */
export async function customerHasAiTurnLeft(
  tx: TenantClient,
  input: { licenseId: bigint; customerId: string; brandId: string | null; at?: Date },
): Promise<boolean> {
  const cap = await customerAiTurnCap(tx, input.brandId);
  if (cap <= 0) return true;
  return (await customerAiTurnsToday(tx, input)) < cap;
}

/** What the usage screen shows of the per-member allowance (tm 339.3). */
export interface CustomerAiQuotaToday {
  /** `YYYY-MM-DD`, the workspace's conversation day the counts are for. */
  readonly day: string;
  /** The allowance in force (the default brand's); null = no per-member allowance. */
  readonly cap: number | null;
  /** Members the AI has answered at least once today. */
  readonly membersWithAi: number;
  /** Of those, how many have used the whole allowance — their next turn goes to a person. */
  readonly membersAtCap: number;
}

/**
 * Today's per-member AI use, counted — never any member's identity or text.
 * Reads only: nothing here claims a turn.
 */
export async function customerAiQuotaToday(
  tx: TenantClient,
  input: { licenseId: bigint; at?: Date },
): Promise<CustomerAiQuotaToday> {
  const boundary = await readDayBoundary(tx);
  const day = localDayKey(input.at ?? new Date(), boundary.timezone, boundary.hour);
  const cap = await customerAiTurnCap(tx, null);
  const rows = await tx.$queryRaw<Array<{ members: number; at_cap: number }>>`
    SELECT count(*)::int AS members,
           count(*) FILTER (WHERE ${cap}::int > 0 AND ai_turns >= ${cap}::int)::int AS at_cap
    FROM ai_customer_daily_usage
    WHERE license_id = ${input.licenseId} AND day = ${day}::date`;
  return {
    day,
    cap: cap > 0 ? cap : null,
    membersWithAi: rows[0]?.members ?? 0,
    membersAtCap: rows[0]?.at_cap ?? 0,
  };
}
