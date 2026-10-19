/**
 * The guardrails' record of a turn (tm 301.3 · AI-08 §8): one
 * `ai_guardrail_hits` row per hit, bound to the turn by `turn_id` — the id
 * the live adapter mints for the turn's decision record, so the hit log and
 * the decision record (ID-08) name the same turn.
 *
 * The evidence is the player's or the AI's own words, so it is masked before
 * it is written (AI-26: the player's policy for the input, the bot's for a
 * draft) and cut to `GUARDRAIL_QUOTE_MAX` after. Like the decision record, a
 * hit that cannot be written is one error line, never a lost reply: the reply
 * has gone by the time this runs.
 */
import { GUARDRAIL_QUOTE_MAX } from '@siyahtus/types';
import { maskForWrite } from '../../lib/sensitive-mask.js';
import type { TenantContext } from '../../lib/tenant.js';
import type { GuardrailRecord } from './conversation/guardrails/record.js';
import type { TenantRunner } from './conversation/turn.js';
import type { DecisionLogger } from './decision-log.js';

export interface GuardrailHitsInput {
  /** The day container (panel "Thread ID"). */
  chatId: string;
  /** The connection (panel "Chat ID"). */
  threadId: string;
  /** The turn's decision record id. */
  turnId: string;
  record: GuardrailRecord;
}

/** The rows written — 0 when there was nothing to write or the write failed. */
export async function recordGuardrailHits(
  db: TenantRunner,
  tenant: TenantContext,
  input: GuardrailHitsInput,
  log: DecisionLogger,
): Promise<number> {
  const { record } = input;
  if (record.hits.length === 0) return 0;
  const data = record.hits.map((hit) => ({
    licenseId: tenant.licenseId,
    chatId: input.chatId,
    threadId: input.threadId,
    turnId: input.turnId,
    ruleKey: hit.rule_key,
    stage: hit.stage,
    actionTaken: hit.action,
    evidence:
      hit.evidence === null
        ? null
        : (maskForWrite(hit.evidence, hit.stage === 'input' ? 'customer' : 'bot').text ?? '')
            .slice(0, GUARDRAIL_QUOTE_MAX)
            .trim() || null,
    patternIndex: hit.pattern_index,
    catalogVersion: record.catalog_version,
  }));
  try {
    await db((tx) => tx.aiGuardrailHit.createMany({ data }));
    return data.length;
  } catch (error) {
    log.error(
      { err: error, hits: data.length },
      'guardrail hits could not be recorded; the reply is not held back',
    );
    return 0;
  }
}
