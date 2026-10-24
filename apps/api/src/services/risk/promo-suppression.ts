/**
 * Promotions and a flagged player (tm 350 · SiyahTuş analysis EN-01): the
 * campaign engine's reading of the risk flags — who is shown no campaign, and
 * the sends it holds back.
 *
 * The rule itself is `@siyahtus/types`' `promoSuppressionReason` (locked
 * responsible-gaming types always, fraud and a formal complaint as the
 * workspace's `risk_flag_settings` says); this file only gathers its inputs:
 *
 *   - **Whose flags.** Every active flag on the player, of either scope and
 *     raised in any conversation, and on every record an agent linked to them
 *     as the same person (`customer_identity_links`, ID-03): one flagged
 *     record keeps the whole linked set from promotions (EN-01 "Kapsam"). The
 *     workspace is the company: brands share it, so a flag raised on one
 *     brand's widget holds on all of them (EN-01 karar 3). A visitor nobody
 *     recognised is a new customer and carries no flag — the protection is as
 *     strong as ID-03's recognition (task assumption).
 *   - **Fail-closed** ({@link guardedPromoSuppression}): unlike the campaign
 *     engine's best-effort paths, a read that fails answers "suppressed" to
 *     the caller that asked — under a savepoint, so the failure does not take
 *     the caller's transaction (the widget's poll) down with it.
 *   - **Once suppressed, always** ({@link suppressPendingSends}): a held-back
 *     send keeps `suppressed_at` and is never delivered, even once the flag is
 *     cleared — the unique (campaign, customer) pair keeps it the campaign's
 *     only send to that player.
 */
import type { Prisma } from '@prisma/client';
import {
  PROMO_POLICY_DEFAULTS,
  blocksPromotions,
  isRiskFlagType,
  promoSuppressionReason,
  type PromoPolicy,
  type RiskFlagType,
} from '@siyahtus/types';
import type { TenantClient } from '../../lib/tenant.js';

/** The workspace's promotion policy; the defaults when it never saved one. */
export async function readPromoPolicy(tx: TenantClient): Promise<PromoPolicy> {
  const row = await tx.riskFlagSettings.findFirst({
    select: { promoBlockFraud: true, promoBlockComplaint: true },
  });
  if (!row) return PROMO_POLICY_DEFAULTS;
  return { fraud_suspected: row.promoBlockFraud, complaint_formal: row.promoBlockComplaint };
}

/**
 * The active flag types on each of `customerIds` and on the records linked to
 * it — one query, walking the links to their end (a chain A–B–C is one
 * person). RLS keeps both tables to the caller's workspace and organization.
 */
async function activeFlagTypes(
  tx: TenantClient,
  customerIds: readonly string[],
): Promise<Map<string, RiskFlagType[]>> {
  const rows = await tx.$queryRaw<Array<{ origin: string; types: string[] }>>`
    WITH RECURSIVE linked(origin, id) AS (
      SELECT c, c FROM unnest(${[...customerIds]}::uuid[]) AS c
      UNION
      SELECT linked.origin,
             CASE WHEN l.customer_a_id = linked.id THEN l.customer_b_id ELSE l.customer_a_id END
        FROM linked
        JOIN customer_identity_links l
          ON (l.customer_a_id = linked.id OR l.customer_b_id = linked.id)
         AND l.unlinked_at IS NULL
    )
    SELECT linked.origin::text AS origin, array_agg(DISTINCT f.type) AS types
      FROM linked
      JOIN risk_flags f ON f.customer_id = linked.id AND f.status = 'active'
     GROUP BY linked.origin`;
  return new Map(rows.map((row) => [row.origin, row.types.filter(isRiskFlagType)]));
}

/**
 * Which of `customerIds` are kept from promotions, and by which flag type
 * (`promoSuppressionReason`). Absent from the map: shown campaigns. Throws
 * when the flags cannot be read — callers go through
 * {@link guardedPromoSuppression}.
 */
export async function promoSuppressionOf(
  tx: TenantClient,
  customerIds: readonly string[],
  policy?: PromoPolicy,
): Promise<Map<string, RiskFlagType>> {
  const suppressed = new Map<string, RiskFlagType>();
  if (customerIds.length === 0) return suppressed;
  const types = await activeFlagTypes(tx, customerIds);
  if (types.size === 0) return suppressed;
  const rules = policy ?? (await readPromoPolicy(tx));
  for (const [customerId, flagTypes] of types) {
    const reason = promoSuppressionReason(
      flagTypes.map((type) => ({ type })),
      rules,
    );
    if (reason !== null) suppressed.set(customerId, reason);
  }
  return suppressed;
}

export type PromoSuppressionReader = typeof promoSuppressionOf;

const SAVEPOINT = 'promo_suppression_read';

/**
 * {@link promoSuppressionOf}, fail-closed: `null` when the flags could not be
 * read — the caller then shows nothing and writes nothing it would regret.
 * Under a savepoint, so a failed statement rolls back to here and the
 * caller's transaction goes on (Postgres refuses every statement after an
 * error otherwise). `read` is the seam the tests use to make the read fail.
 */
export async function guardedPromoSuppression(
  tx: TenantClient,
  customerIds: readonly string[],
  read: PromoSuppressionReader = promoSuppressionOf,
): Promise<Map<string, RiskFlagType> | null> {
  await tx.$executeRawUnsafe(`SAVEPOINT ${SAVEPOINT}`);
  try {
    const result = await read(tx, customerIds);
    await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${SAVEPOINT}`);
    return result;
  } catch {
    await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT ${SAVEPOINT}`);
    await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${SAVEPOINT}`);
    return null;
  }
}

/**
 * Hold back every send still owed to `customerId` and the records linked to
 * it, in the caller's transaction — what a raised flag does to the campaigns
 * already queued for the player (EN-01: "AI-27 bir bayrak koyduğunda o
 * oyuncunun bekleyen gönderimleri aynı işlemde bastırılır"). Returns how many.
 */
export async function suppressPendingSends(
  tx: TenantClient,
  input: { licenseId: bigint; customerId: string; reason: RiskFlagType; now: Date },
): Promise<number> {
  return tx.$executeRaw`
    WITH RECURSIVE linked(id) AS (
      SELECT ${input.customerId}::uuid
      UNION
      SELECT CASE WHEN l.customer_a_id = linked.id THEN l.customer_b_id ELSE l.customer_a_id END
        FROM linked
        JOIN customer_identity_links l
          ON (l.customer_a_id = linked.id OR l.customer_b_id = linked.id)
         AND l.unlinked_at IS NULL
    )
    UPDATE campaign_sends s
       SET suppressed_at = ${input.now}, suppressed_reason = ${input.reason}
     WHERE s.license_id = ${input.licenseId}
       AND s.customer_id IN (SELECT id FROM linked)
       AND s.delivered_at IS NULL
       AND s.suppressed_at IS NULL`;
}

/**
 * What a flag just raised does to the player's queued campaigns: if its type
 * keeps them from promotions under the workspace's policy, their owed sends
 * are held back in the raise's own transaction. Returns how many.
 */
export async function suppressSendsForRaisedFlag(
  tx: TenantClient,
  flag: { licenseId: bigint; customerId: string | null; type: string },
  now: Date,
): Promise<number> {
  if (flag.customerId === null || !isRiskFlagType(flag.type)) return 0;
  // The locked types decide without the settings row.
  const policy = blocksPromotions(flag.type, { fraud_suspected: false, complaint_formal: false })
    ? null
    : await readPromoPolicy(tx);
  if (policy !== null && !blocksPromotions(flag.type, policy)) return 0;
  return suppressPendingSends(tx, {
    licenseId: flag.licenseId,
    customerId: flag.customerId,
    reason: flag.type,
    now,
  });
}

/** The columns a held-back send is written with (fire paths). */
export function suppressedSendData(
  reason: RiskFlagType,
  now: Date,
): Pick<Prisma.CampaignSendCreateManyInput, 'suppressedAt' | 'suppressedReason'> {
  return { suppressedAt: now, suppressedReason: reason };
}
