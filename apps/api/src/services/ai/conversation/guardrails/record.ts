/**
 * What a turn's guardrails did, as the turn returns it (tm 301.3 · AI-08 §8,
 * §9): every hit — whose rule, at which stage, what the turn did about it and
 * the words that set it off — the catalogue version the turn ran under, and
 * the risk flags it raised.
 *
 * The turn writes nothing (`turn.ts`). The live adapter files each hit as an
 * `ai_guardrail_hits` row bound to the turn (`turn_id`, the decision record's
 * id) with its evidence masked (AI-26), and the decision record keeps the rule
 * keys and actions — never the evidence: the record holds no words (ID-08).
 */
import {
  GUARDRAIL_QUOTE_MAX,
  guardrailHitRuleKey,
  type GuardrailHitAction,
  type GuardrailHitRule,
  type GuardrailStage,
} from '@siyahtus/types';

export interface GuardrailHitRecord {
  /** `G3`, `rule:<uuid>` or `phrase:<uuid>` (`guardrailHitRuleKey`). */
  readonly rule_key: string;
  readonly stage: GuardrailStage;
  readonly action: GuardrailHitAction;
  /** The player's or the draft's own words, at most `GUARDRAIL_QUOTE_MAX`; unmasked until written. */
  readonly evidence: string | null;
  /** The lexicon pattern that matched (AI-24's upkeep); null for a signal, a phrase or the judge. */
  readonly pattern_index: number | null;
}

export interface GuardrailRecord {
  /** `PLATFORM_GUARDRAILS_VERSION` — every turn records the one it ran under (AI-08 §9). */
  readonly catalog_version: string;
  readonly hits: readonly GuardrailHitRecord[];
  /** The risk flags the turn raised on the conversation (`signals.risk_flags`, AI-27). */
  readonly risk_flags: readonly string[];
}

export function guardrailHit(
  rule: GuardrailHitRule,
  stage: GuardrailStage,
  action: GuardrailHitAction,
  evidence: string | null = null,
  patternIndex: number | null = null,
): GuardrailHitRecord {
  const quote = evidence?.trim().slice(0, GUARDRAIL_QUOTE_MAX) || null;
  return {
    rule_key: guardrailHitRuleKey(rule),
    stage,
    action,
    evidence: quote,
    pattern_index: patternIndex,
  };
}

/** Two parts of one turn — the input scan and a written call — as one record. */
export function mergeGuardrailRecords(
  a: GuardrailRecord | undefined,
  b: GuardrailRecord | null | undefined,
): GuardrailRecord | undefined {
  if (!a && !b) return undefined;
  const hits: GuardrailHitRecord[] = [];
  for (const hit of [...(a?.hits ?? []), ...(b?.hits ?? [])]) {
    if (!hits.some((kept) => sameHit(kept, hit))) hits.push(hit);
  }
  return {
    catalog_version: (a ?? b)!.catalog_version,
    hits,
    risk_flags: [...new Set([...(a?.risk_flags ?? []), ...(b?.risk_flags ?? [])])],
  };
}

/** One row per rule, stage and action: a phrase twice in a draft is one hit. */
function sameHit(a: GuardrailHitRecord, b: GuardrailHitRecord): boolean {
  return a.rule_key === b.rule_key && a.stage === b.stage && a.action === b.action;
}

/** What the decision record keeps (`details.guardrails`): keys and actions, no words. */
export function guardrailDetails(record: GuardrailRecord): Record<string, unknown> {
  return {
    catalog_version: record.catalog_version,
    ...(record.hits.length > 0
      ? {
          hits: record.hits.map((hit) => ({
            rule_key: hit.rule_key,
            stage: hit.stage,
            action: hit.action,
          })),
        }
      : {}),
  };
}

/** The rule keys the record's `guardrail_hits` column lists, once each. */
export function guardrailHitKeys(record: GuardrailRecord | undefined): string[] {
  return record ? [...new Set(record.hits.map((hit) => hit.rule_key))] : [];
}
