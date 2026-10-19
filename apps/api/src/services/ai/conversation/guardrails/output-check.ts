/**
 * The output check (tm 301.3 · AI-08 §6): every draft read against the locked
 * catalogue's output lexicons and the workspace's forbidden phrases before it
 * is sent. Deterministic — no model: "kontrol ettim", "hesabınıza geçti",
 * "garanti", a time promise with no "genellikle", a request for the player's
 * password, a VPN, an AML check named, "ben bir insanım"; on a risk-flagged
 * conversation, a bonus or "yatırın" too (G4).
 *
 * What it finds is either a **violation** — the draft is written once more
 * with the rule named (`guardrailRewriteNote`), and a second draft that still
 * breaks one is not sent (the safe text and a hand-over, `GUARDRAIL_OUTPUT_
 * BLOCK_REASON`) — or a **warning**: a phrase the workspace set to `warn`,
 * recorded and sent. The persona's address form and emoji are warnings of the
 * same kind, already in the run log (`styleWarnings`, AI-07 §3).
 *
 * G14 lets through what the workspace's access information itself says (K13);
 * that setting is AI-13's (#310) and no workspace has it yet, so every
 * address, mirror and VPN line is a violation — and the hand-over that follows
 * is "no access information: a person answers".
 */
import {
  PLATFORM_GUARDRAILS,
  compileForbiddenPhrase,
  matchForbiddenPhrases,
  platformGuardrail,
  scanGuardrails,
  type CompiledForbiddenPhrase,
  type GuardrailHitRule,
  type GuardrailId,
} from '@siyahtus/types';
import type { ForbiddenPhraseConfig } from './config.js';

/** Something a draft must not say, in the draft's own words. */
export interface OutputViolation {
  readonly rule: GuardrailHitRule;
  readonly quote: string;
  /** The lexicon pattern that matched; null for a phrase or the judge. */
  readonly pattern: number | null;
  /** The rule as the rewrite is told it. */
  readonly note: string;
}

export interface OutputCheck {
  /** Rewritten once, then not sent. */
  readonly violations: readonly OutputViolation[];
  /** Recorded and sent. */
  readonly warnings: readonly OutputViolation[];
}

export const CLEAN_OUTPUT: OutputCheck = Object.freeze({
  violations: Object.freeze([]),
  warnings: Object.freeze([]),
});

export interface OutputCheckInput {
  /** The conversation carries a risk flag: G4's promotion ban applies (AI-08 §4). */
  readonly riskFlagged: boolean;
  /** The workspace's forbidden phrases in this turn's scope and language. */
  readonly phrases: readonly ForbiddenPhraseConfig[];
}

/** Every rule with an output lexicon; G4's only on a risk-flagged conversation. */
function outputRules(riskFlagged: boolean): GuardrailId[] {
  return PLATFORM_GUARDRAILS.filter(
    (rule) => rule.output !== null && (rule.appliesWhen === 'always' || riskFlagged),
  ).map((rule) => rule.id);
}

export function checkOutput(text: string, input: OutputCheckInput): OutputCheck {
  if (text.trim() === '') return CLEAN_OUTPUT;
  const violations: OutputViolation[] = [];
  const warnings: OutputViolation[] = [];

  const seen = new Set<GuardrailId>();
  for (const match of scanGuardrails(text, 'output', { rules: outputRules(input.riskFlagged) })) {
    // One violation per rule: the rewrite is told the rule once, with its first quote.
    if (seen.has(match.rule)) continue;
    seen.add(match.rule);
    violations.push({
      rule: { source: 'platform', id: match.rule },
      quote: match.quote,
      pattern: match.pattern,
      note: `${platformGuardrail(match.rule).prompt.en} (it said: "${match.quote}")`,
    });
  }

  const compiled = input.phrases.map((phrase) => ({ phrase, run: compiledPhrase(phrase) }));
  const runnable = compiled.filter(
    (entry): entry is { phrase: ForbiddenPhraseConfig; run: CompiledForbiddenPhrase } =>
      entry.run !== null,
  );
  for (const hit of matchForbiddenPhrases(
    text,
    runnable.map((entry) => entry.run),
  )) {
    const { phrase } = runnable[hit.index]!;
    const found: OutputViolation = {
      rule: { source: 'phrase', id: phrase.id },
      quote: hit.quote,
      pattern: null,
      note: `The business does not allow "${hit.quote}" in a reply.`,
    };
    if (phrase.action === 'block') violations.push(found);
    else warnings.push(found);
  }
  return { violations, warnings };
}

/** What the one rewrite is told (AI-08 §8): the rules the draft broke, and to write it again. */
export function guardrailRewriteNote(violations: readonly OutputViolation[]): string {
  return [
    'Your previous draft broke these rules. Write it again so that it breaks none of them, and say nothing it does not need:',
    ...violations.map((violation) => `- ${violation.note}`),
  ].join('\n');
}

/**
 * A phrase compiled once per process: the same rows are read on every turn,
 * and a pattern's dialect check is not free. A phrase the dialect refuses —
 * the API never stores one — matches nothing.
 */
const COMPILED = new Map<string, CompiledForbiddenPhrase | null>();
const COMPILED_MAX = 4_000;

function compiledPhrase(phrase: ForbiddenPhraseConfig): CompiledForbiddenPhrase | null {
  const key = `${phrase.match}\u0000${phrase.phrase}`;
  if (COMPILED.has(key)) return COMPILED.get(key) ?? null;
  if (COMPILED.size >= COMPILED_MAX) COMPILED.clear();
  const compiled = compileForbiddenPhrase(phrase.phrase, phrase.match);
  COMPILED.set(key, compiled);
  return compiled;
}
