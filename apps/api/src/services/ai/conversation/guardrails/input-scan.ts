/**
 * The input scan (tm 301.3 · AI-08 §1–§3): the player's message read against
 * the locked catalogue's input lexicons before any model is asked — so a
 * model outage, a misreading or a cap cannot let "kendimi öldüreceğim"
 * through — and the understanding call's risk signals read against the rules
 * they name.
 *
 * Two ways a rule triggers, and they add up (AI-08 §2, "kaçırmamak öncelikli"):
 *
 *   - **the lexicon alone**, for the rules whose false positive costs a
 *     hand-over and whose miss costs the player — G1, G3, G5 — and those whose
 *     words are the request itself — G6, G16 (`lexiconAlone`). G19's words
 *     are the request too, but it warns before it hands over
 *     (`warningsBeforeHandoff`), so it is returned apart;
 *   - **the understanding call's signal alone**, for every rule that lists it
 *     (`understandRisks`): G1, G2, G3, G5, G13, G15.
 *
 * A lexicon match of a rule that does not act on it alone — G2, G13, G15
 * without the signal — is evidence: recorded, never acted on.
 *
 * Pure: the text and the reading go in, the triggers come out.
 */
import {
  GUARDRAIL_PRIORITIES,
  PLATFORM_GUARDRAILS,
  UNDERSTAND_RISK_FLAGS,
  scanGuardrails,
  type GuardrailId,
  type GuardrailMatch,
  type GuardrailUnderstandRisk,
  type PlatformGuardrail,
} from '@siyahtus/types';

/** A rule the turn must act on, and what set it off. */
export interface GuardrailTrigger {
  readonly rule: PlatformGuardrail;
  /** Its lexicon's matches in the player's message, in text order. */
  readonly matches: readonly GuardrailMatch[];
  /** The understanding call's signals that named it. */
  readonly signals: readonly GuardrailUnderstandRisk[];
  /** The understanding call's quote of the player's words, when a signal named it. */
  readonly signalQuote: string | null;
}

export interface InputScan {
  /** Every lexicon match in the message, in text order. */
  readonly matches: readonly GuardrailMatch[];
  /** The rules the lexicon alone sets off, G19 aside. */
  readonly triggered: readonly GuardrailTrigger[];
  /** G19's matches: insults and threats, warned about before a hand-over. */
  readonly abuse: readonly GuardrailMatch[];
}

/** The understanding call's risk signals, as far as a turn holds them. */
export interface RiskSignals {
  readonly risk?: Readonly<
    Record<string, { readonly flag: boolean; readonly evidence_quote?: string | null } | undefined>
  >;
}

const ABUSE: GuardrailId = 'G19';

export function scanInput(text: string): InputScan {
  const matches = scanGuardrails(text, 'input');
  const triggered = PLATFORM_GUARDRAILS.flatMap((rule): GuardrailTrigger[] => {
    if (!rule.lexiconAlone || rule.id === ABUSE) return [];
    const own = matches.filter((match) => match.rule === rule.id);
    return own.length > 0 ? [{ rule, matches: own, signals: [], signalQuote: null }] : [];
  });
  return { matches, triggered, abuse: matches.filter((match) => match.rule === ABUSE) };
}

/**
 * The rules the understanding call's signals set off (AI-08 §2): each with
 * the signals that named it, their quote, and its own lexicon matches beside
 * them as evidence.
 */
export function signalTriggers(
  understanding: object | null | undefined,
  scan: InputScan,
): GuardrailTrigger[] {
  // A handed-in understanding (a test's, a simulation's) may carry no signals.
  const risk = (understanding as RiskSignals | null | undefined)?.risk;
  if (!risk) return [];
  return PLATFORM_GUARDRAILS.flatMap((rule): GuardrailTrigger[] => {
    const signals = rule.understandRisks.filter((name) => risk[name]?.flag === true);
    if (signals.length === 0) return [];
    const quote =
      signals.map((name) => risk[name]?.evidence_quote?.trim() || null).find(Boolean) ?? null;
    return [
      {
        rule,
        matches: scan.matches.filter((match) => match.rule === rule.id),
        signals,
        signalQuote: quote,
      },
    ];
  });
}

/** Triggers from both sources, one per rule, in catalogue order. */
export function mergeTriggers(
  ...lists: ReadonlyArray<readonly GuardrailTrigger[]>
): GuardrailTrigger[] {
  const byRule = new Map<GuardrailId, GuardrailTrigger>();
  for (const trigger of lists.flat()) {
    const kept = byRule.get(trigger.rule.id);
    byRule.set(
      trigger.rule.id,
      kept
        ? {
            rule: kept.rule,
            matches: kept.matches.length > 0 ? kept.matches : trigger.matches,
            signals: [...new Set([...kept.signals, ...trigger.signals])],
            signalQuote: kept.signalQuote ?? trigger.signalQuote,
          }
        : trigger,
    );
  }
  return PLATFORM_GUARDRAILS.flatMap((rule) => byRule.get(rule.id) ?? []);
}

/**
 * The trigger the hand-over follows — its target, priority and reason:
 * self-harm first (its crisis text goes out whatever else is true), then the
 * most urgent, then the catalogue's order.
 */
export function leadingTrigger(triggers: readonly GuardrailTrigger[]): GuardrailTrigger | null {
  const rank = (trigger: GuardrailTrigger) =>
    trigger.rule.tenantText === 'crisis' ? -1 : GUARDRAIL_PRIORITIES.indexOf(trigger.rule.priority);
  return [...triggers].sort((a, b) => rank(a) - rank(b))[0] ?? null;
}

/** The risk flags the triggers raise (AI-27's names): the rule's own, and each signal's. */
export function raisedRiskFlags(triggers: readonly GuardrailTrigger[]): string[] {
  const flags = triggers.flatMap((trigger) => [
    ...(trigger.rule.riskFlag ? [trigger.rule.riskFlag] : []),
    ...trigger.signals.map((signal) => UNDERSTAND_RISK_FLAGS[signal]),
  ]);
  return [...new Set(flags)];
}

/** The words that set a trigger off: the first lexicon match, else the signal's quote. */
export function triggerEvidence(trigger: GuardrailTrigger): {
  quote: string | null;
  pattern: number | null;
} {
  const first = trigger.matches[0];
  return first
    ? { quote: first.quote, pattern: first.pattern }
    : { quote: trigger.signalQuote, pattern: null };
}
