/**
 * The guardrails' prompt layers (tm 301.3 · AI-08 §4, §5 · AI-07 §1): what
 * every written call — the compose call and the knowledge answer — is told
 * first, before the step's instruction, the behaviour rules and the persona.
 *
 *   - `platform_locked`: each locked rule as its one imperative line, in
 *     Turkish unless the reply is to be in another language (then English).
 *     G4's line — no bonus, no promotion, no encouragement to deposit — only
 *     on a conversation that carries a risk flag; on one that does not it
 *     would only make the model shy of answering a bonus question;
 *   - `tenant_compliance`: the workspace's own rules in this call's scope,
 *     whatever their action — a rule that blocks or hands over is said to the
 *     model as well as enforced.
 *
 * The understanding call is not told them: it writes nothing to the player,
 * and the risks it reads are its own schema's (`understand.ts`).
 */
import { PLATFORM_GUARDRAILS, type GuardrailLang, type PersonaLanguage } from '@siyahtus/types';
import type { PromptLayer } from '../guidance.js';
import type { GuardrailRuleConfig } from './config.js';

export interface GuardrailPromptInput {
  readonly answerIn: PersonaLanguage | null;
  /** The conversation carries a risk flag: G4's line goes in. */
  readonly riskFlagged: boolean;
  /** The workspace's rules in this call's scope. */
  readonly workspaceRules: readonly GuardrailRuleConfig[];
}

/** The language a locked line is written in for a reply in `answerIn`. */
export function guardrailLang(answerIn: PersonaLanguage | null): GuardrailLang {
  return answerIn === null || answerIn === 'tr' ? 'tr' : 'en';
}

export function guardrailLayers(input: GuardrailPromptInput): PromptLayer[] {
  const lang = guardrailLang(input.answerIn);
  return [
    {
      key: 'platform_locked',
      lines: PLATFORM_GUARDRAILS.filter(
        (rule) => rule.appliesWhen === 'always' || input.riskFlagged,
      ).map((rule) => `- ${rule.prompt[lang]}`),
    },
    {
      key: 'tenant_compliance',
      lines: input.workspaceRules.map(
        (rule) => `- ${rule.title.trim()}: ${rule.body.replace(/\s+/g, ' ').trim()}`,
      ),
    },
  ];
}
