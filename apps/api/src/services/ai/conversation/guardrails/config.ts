/**
 * What a turn knows of the workspace's guardrails (tm 301.3 · SiyahTuş
 * analysis AI-08): the package's `guardrails` (ADR-14b §2.12), read through
 * `AiConfigSource` like every other part of the configuration — the turn never
 * reads `ai_guardrail_*` itself.
 *
 * The platform's G1–G19 are not here: they are code (`@siyahtus/types`
 * `guardrails.ts`) and apply whatever the configuration says, so a turn whose
 * configuration carries no guardrails — a unit test's, a workspace that never
 * opened the tab — still runs under every locked rule. What a workspace adds is
 * stricter, never looser: its crisis and complaint texts, its judge switch, its
 * extra rules and its forbidden phrases.
 */
import {
  PLATFORM_GUARDRAILS_VERSION,
  type ForbiddenPhraseAction,
  type ForbiddenPhraseMatch,
  type GuardrailCategory,
  type GuardrailRuleAction,
  type GuidanceScope,
} from '@siyahtus/types';
import { inScope, type GuidanceSituation } from '../guidance.js';

/** One agent's `ai_guardrail_settings` row. */
export interface GuardrailAgentSettings {
  readonly aiAgentId: string;
  /** What G3 sends verbatim before its hand-over; null when none is written. */
  readonly crisisText: string | null;
  /** The Founder approved the crisis text as it stands (the record says so; the text goes out either way). */
  readonly crisisApproved: boolean;
  /** The complaint procedure G15 gives before its hand-over. */
  readonly complaintText: string | null;
  /** Whether the judge call (LLM #3) reads risky drafts (AI-08-S3). */
  readonly judgeEnabled: boolean;
}

/** An active `ai_guardrail_rules` row. */
export interface GuardrailRuleConfig {
  readonly id: string;
  readonly aiAgentId: string;
  readonly title: string;
  readonly body: string;
  readonly category: GuardrailCategory;
  readonly action: GuardrailRuleAction;
  readonly scope: GuidanceScope;
}

/** An active `ai_forbidden_phrases` row. */
export interface ForbiddenPhraseConfig {
  readonly id: string;
  readonly aiAgentId: string;
  readonly phrase: string;
  readonly match: ForbiddenPhraseMatch;
  /** Null: every reply. */
  readonly lang: string | null;
  readonly scope: GuidanceScope;
  readonly action: ForbiddenPhraseAction;
}

/** The package's guardrails (ADR-14b §2.12). */
export interface GuardrailConfig {
  /** The catalogue the configuration was read under (`guardrail_catalog_version`). */
  readonly catalogVersion: string;
  readonly settings: readonly GuardrailAgentSettings[];
  readonly rules: readonly GuardrailRuleConfig[];
  readonly phrases: readonly ForbiddenPhraseConfig[];
}

/** A configuration with nothing of the workspace's: the locked catalogue alone. */
export const NO_GUARDRAIL_CONFIG: GuardrailConfig = Object.freeze({
  catalogVersion: PLATFORM_GUARDRAILS_VERSION,
  settings: Object.freeze([]),
  rules: Object.freeze([]),
  phrases: Object.freeze([]),
});

export function guardrailSettingsFor(
  config: GuardrailConfig,
  aiAgentId: string | null,
): GuardrailAgentSettings | null {
  if (aiAgentId === null) return null;
  return config.settings.find((settings) => settings.aiAgentId === aiAgentId) ?? null;
}

/** The agent's rules for this situation — its procedure, its brand once a turn knows it. */
export function guardrailRulesFor(
  config: GuardrailConfig,
  situation: GuidanceSituation,
): GuardrailRuleConfig[] {
  if (situation.aiAgentId === null) return [];
  return config.rules.filter(
    (rule) => rule.aiAgentId === situation.aiAgentId && inScope(rule.scope, situation),
  );
}

/**
 * The agent's forbidden phrases for this situation and reply language: a
 * phrase with no language applies to every reply, one with a language to a
 * reply in it — and to every reply when the language was left to the player's.
 */
export function forbiddenPhrasesFor(
  config: GuardrailConfig,
  situation: GuidanceSituation,
  lang: string | null,
): ForbiddenPhraseConfig[] {
  if (situation.aiAgentId === null) return [];
  return config.phrases.filter(
    (phrase) =>
      phrase.aiAgentId === situation.aiAgentId &&
      inScope(phrase.scope, situation) &&
      (phrase.lang === null || lang === null || phrase.lang === lang),
  );
}
