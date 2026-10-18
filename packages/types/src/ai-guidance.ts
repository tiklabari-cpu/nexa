/**
 * The AI's behaviour rules and the persona's three style settings (tm 299.1 ·
 * SiyahTuş analysis AI-07).
 *
 * A behaviour rule is one plain sentence a workspace writes for its AI ("Ödeme
 * sorunlarında yöntemi, tutarı ve saati öğrenmeden çözüm önerme."), kept with a
 * category, a scope (every conversation, some procedures, some brands) and a
 * priority. The turn picks the rules in scope and writes them into the prompt
 * of every call that writes the player's message, in a fixed place in the
 * layer order (`PROMPT_LAYERS`): below the platform's locked rules and the
 * step's own instruction, above the persona.
 *
 * The style settings live in the agent's `persona` JSON beside
 * `answerLength`, `clarifyThresholds` and the rest, so no column is needed:
 * how the player is addressed (`siz` / `sen`), whether emoji are used, and how
 * many questions one message may ask — the last one applied by the procedure
 * executor itself, not asked of the model.
 */
import { DEFAULT_MAX_QUESTIONS_PER_MESSAGE } from './slots.js';

/** What a rule is about — the editor groups by it; the turn orders by it after priority. */
export const GUIDANCE_CATEGORIES = [
  'communication',
  'clarification',
  'sensitive',
  'prohibition',
  'other',
] as const;
export type GuidanceCategory = (typeof GUIDANCE_CATEGORIES)[number];

/** A rule's body, in characters (AI-07): one or two sentences, never a manual. */
export const GUIDANCE_BODY_MAX = 600;
export const GUIDANCE_TITLE_MAX = 120;
/** A rule's priority: 1 goes first; a tie is broken by category. */
export const GUIDANCE_PRIORITY_MIN = 1;
export const GUIDANCE_PRIORITY_MAX = 1000;
export const DEFAULT_GUIDANCE_PRIORITY = 100;
/** A scope names at most this many procedures or brands. */
export const GUIDANCE_SCOPE_IDS_MAX = 50;
/** The rules one agent may hold — beyond this the prompt stops being read whole. */
export const GUIDANCE_RULES_PER_AGENT_MAX = 200;

/** What one turn's prompt carries at most (AI-07 §2); the lowest priorities give way. */
export const GUIDANCE_TURN_RULES_MAX = 30;
export const GUIDANCE_TURN_CHARS_MAX = 6000;

/** The title the agent's old `instruction` text moves under (migration 20261019120000). */
export const GUIDANCE_GENERAL_TITLE = 'Genel talimat';

/**
 * Where a rule applies: every conversation, the turns of some procedures
 * (skill ids), or the conversations of some brands. One of the three.
 */
export type GuidanceScope = { all: true } | { skill_ids: string[] } | { brand_ids: string[] };

/** The scope a rule gets when none is given. */
export const GUIDANCE_SCOPE_ALL: GuidanceScope = Object.freeze({ all: true }) as GuidanceScope;

/**
 * A stored scope read back, or `null` for one that is none of the three — a
 * rule with a broken scope applies nowhere rather than everywhere.
 */
export function readGuidanceScope(raw: unknown): GuidanceScope | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const entries = Object.entries(raw as Record<string, unknown>);
  if (entries.length !== 1) return null;
  const [key, value] = entries[0] as [string, unknown];
  if (key === 'all') return value === true ? { all: true } : null;
  if (key !== 'skill_ids' && key !== 'brand_ids') return null;
  if (!Array.isArray(value) || value.length === 0) return null;
  if (!value.every((id): id is string => typeof id === 'string' && id.length > 0)) return null;
  return key === 'skill_ids' ? { skill_ids: [...value] } : { brand_ids: [...value] };
}

/**
 * The layers of a written call's instructions, the most binding first (AI-07
 * §1). Where two conflict the earlier wins, and the prompt says so.
 *
 *   1. `platform_locked`   — the platform's locked rules (AI-08, tm 301);
 *   2. `tenant_compliance` — the workspace's compliance additions (AI-08);
 *   3. `step`              — the active procedure step's instruction (AI-03);
 *   4. `guidance`          — the behaviour rules in scope (this module);
 *   5. `persona`           — tone, length, address form, emoji;
 *   6. `context`           — the conversation's state, the day's summaries, passages.
 */
export const PROMPT_LAYERS = [
  'platform_locked',
  'tenant_compliance',
  'step',
  'guidance',
  'persona',
  'context',
] as const;
export type PromptLayerKey = (typeof PROMPT_LAYERS)[number];

/** How the AI addresses the player (Turkish `siz` is formal, `sen` familiar). */
export const ADDRESS_FORMS = ['siz', 'sen'] as const;
export type AddressForm = (typeof ADDRESS_FORMS)[number];

/** Whether the AI's messages carry emoji: none, or a few where they fit. */
export const EMOJI_USES = ['none', 'few'] as const;
export type EmojiUse = (typeof EMOJI_USES)[number];

export const MAX_QUESTIONS_PER_MESSAGE_MIN = 1;
export const MAX_QUESTIONS_PER_MESSAGE_MAX = 3;

/** The persona's style settings; null is "not set". */
export interface PersonaStyle {
  addressForm: AddressForm | null;
  emoji: EmojiUse | null;
  /** 1–3; null: {@link DEFAULT_MAX_QUESTIONS_PER_MESSAGE}. */
  maxQuestionsPerMessage: number | null;
}

export const NO_PERSONA_STYLE: Readonly<PersonaStyle> = Object.freeze({
  addressForm: null,
  emoji: null,
  maxQuestionsPerMessage: null,
});

/**
 * The style settings from the agent's `persona` JSON (`addressForm`, `emoji`,
 * `maxQuestionsPerMessage`). Anything outside the closed sets reads as unset.
 */
export function readPersonaStyle(persona: unknown): PersonaStyle {
  if (!persona || typeof persona !== 'object' || Array.isArray(persona)) {
    return { ...NO_PERSONA_STYLE };
  }
  const json = persona as Record<string, unknown>;
  const address = json['addressForm'];
  const emoji = json['emoji'];
  const max = json['maxQuestionsPerMessage'];
  return {
    addressForm: (ADDRESS_FORMS as readonly unknown[]).includes(address)
      ? (address as AddressForm)
      : null,
    emoji: (EMOJI_USES as readonly unknown[]).includes(emoji) ? (emoji as EmojiUse) : null,
    maxQuestionsPerMessage:
      typeof max === 'number' &&
      Number.isInteger(max) &&
      max >= MAX_QUESTIONS_PER_MESSAGE_MIN &&
      max <= MAX_QUESTIONS_PER_MESSAGE_MAX
        ? max
        : null,
  };
}

/** How many questions one message may ask under this style. */
export function maxQuestionsOf(style: PersonaStyle | null | undefined): number {
  return style?.maxQuestionsPerMessage ?? DEFAULT_MAX_QUESTIONS_PER_MESSAGE;
}
