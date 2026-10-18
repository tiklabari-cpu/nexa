/**
 * The behaviour rules a turn's written calls carry (tm 299.1 · SiyahTuş
 * analysis AI-07 §1–§3).
 *
 * Pure: the configuration (`TurnConfig.guidance`, read through
 * `AiConfigSource`) goes in, prompt lines and a record come out.
 *
 *   - **Selection** ({@link selectGuidance}): the agent's active rules whose
 *     scope is every conversation, the procedure the turn is in, or the
 *     conversation's brand; most binding first — priority (1 first), then
 *     category (prohibitions before style). At most
 *     `GUIDANCE_TURN_RULES_MAX` rules and `GUIDANCE_TURN_CHARS_MAX`
 *     characters: the first rule that does not fit and every one after it is
 *     left out, so what goes is always the lowest priority, and the record
 *     says `truncated`.
 *   - **Layers** ({@link renderLayers}): what a written call is told comes in
 *     the fixed order of `PROMPT_LAYERS` — platform locked rules, the
 *     workspace's compliance additions, the step's instruction, these rules,
 *     the persona, the context — and the prompt says the earlier wins. The
 *     platform layers are empty until AI-08 (tm 301) fills them; a layer is a
 *     `{ key, lines }` value, so that task adds lines, not a new mechanism.
 *   - **Style** ({@link personaStyleLayer}, {@link styleWarnings}): how the
 *     player is addressed and whether emoji are used go to the model as
 *     instructions and are checked on the way out, as a warning in the run
 *     log — the output check (AI-08) is where a warning could become a block.
 *     `max_questions_per_message` is not here: the procedure executor applies
 *     it itself (`maxQuestions`).
 */
import {
  GUIDANCE_TURN_CHARS_MAX,
  GUIDANCE_TURN_RULES_MAX,
  PROMPT_LAYERS,
  type GuidanceCategory,
  type GuidanceScope,
  type PersonaStyle,
  type PromptLayerKey,
} from '@siyahtus/types';

/** A behaviour rule as the turn's configuration holds it. */
export interface GuidanceRuleConfig {
  readonly id: string;
  readonly aiAgentId: string;
  readonly body: string;
  readonly category: GuidanceCategory;
  readonly scope: GuidanceScope;
  readonly priority: number;
}

/** Where the turn is: whose rules, in which procedure, for which brand. */
export interface GuidanceSituation {
  readonly aiAgentId: string | null;
  /** The procedure (skill) the written call is for; null on the knowledge path. */
  readonly skillId: string | null;
  /** The conversation's brand; null when not known — brand-scoped rules then stay out. */
  readonly brandId?: string | null;
}

export interface GuidanceSelection {
  readonly rules: readonly GuidanceRuleConfig[];
  /** In scope, but left out by the turn's budget — lowest priorities. */
  readonly dropped: readonly string[];
}

/** What the decision record keeps (`details.guidance`): ids, never the rules' words. */
export interface GuidanceRecord {
  rule_ids: string[];
  /** `guidance_truncated` (AI-07 §2): the rules in scope the budget left out. */
  truncated?: { dropped: number; rule_ids: string[] };
}

/** One layer of a written call's instructions. */
export interface PromptLayer {
  readonly key: PromptLayerKey;
  readonly lines: readonly string[];
}

/** Prohibitions first: a tie in priority is broken towards what must not happen. */
const CATEGORY_RANK: Record<GuidanceCategory, number> = {
  prohibition: 0,
  sensitive: 1,
  clarification: 2,
  communication: 3,
  other: 4,
};

/** Most binding first: priority, then category, then id — the same order every time. */
export function orderGuidance<T extends Pick<GuidanceRuleConfig, 'id' | 'priority' | 'category'>>(
  rules: readonly T[],
): T[] {
  return [...rules].sort(
    (a, b) =>
      a.priority - b.priority ||
      CATEGORY_RANK[a.category] - CATEGORY_RANK[b.category] ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}

export function inScope(scope: GuidanceScope, situation: GuidanceSituation): boolean {
  if ('all' in scope) return true;
  if ('skill_ids' in scope) {
    return situation.skillId !== null && scope.skill_ids.includes(situation.skillId);
  }
  return !!situation.brandId && scope.brand_ids.includes(situation.brandId);
}

/** The rules this situation's written call carries, and the ones its budget left out. */
export function selectGuidance(
  rules: readonly GuidanceRuleConfig[],
  situation: GuidanceSituation,
  limits: { rules: number; chars: number } = {
    rules: GUIDANCE_TURN_RULES_MAX,
    chars: GUIDANCE_TURN_CHARS_MAX,
  },
): GuidanceSelection {
  if (situation.aiAgentId === null) return { rules: [], dropped: [] };
  const candidates = orderGuidance(
    rules.filter(
      (rule) => rule.aiAgentId === situation.aiAgentId && inScope(rule.scope, situation),
    ),
  );
  const kept: GuidanceRuleConfig[] = [];
  let chars = 0;
  for (const rule of candidates) {
    if (kept.length >= limits.rules || chars + rule.body.length > limits.chars) break;
    kept.push(rule);
    chars += rule.body.length;
  }
  return { rules: kept, dropped: candidates.slice(kept.length).map((rule) => rule.id) };
}

export function guidanceRecord(selection: GuidanceSelection): GuidanceRecord | null {
  if (selection.rules.length === 0 && selection.dropped.length === 0) return null;
  return {
    rule_ids: selection.rules.map((rule) => rule.id),
    ...(selection.dropped.length > 0
      ? { truncated: { dropped: selection.dropped.length, rule_ids: [...selection.dropped] } }
      : {}),
  };
}

/** Two calls of one turn (a procedure's compose and its knowledge step) — one record. */
export function mergeGuidanceRecords(
  a: GuidanceRecord | undefined,
  b: GuidanceRecord | null | undefined,
): GuidanceRecord | undefined {
  if (!b) return a;
  if (!a) return b;
  const ruleIds = [...new Set([...a.rule_ids, ...b.rule_ids])];
  const dropped = [
    ...new Set([...(a.truncated?.rule_ids ?? []), ...(b.truncated?.rule_ids ?? [])]),
  ].filter((id) => !ruleIds.includes(id));
  return {
    rule_ids: ruleIds,
    ...(dropped.length > 0 ? { truncated: { dropped: dropped.length, rule_ids: dropped } } : {}),
  };
}

/** The rules as layer 4: one line each, the body flattened to a line. */
export function guidanceLayer(rules: readonly GuidanceRuleConfig[]): PromptLayer {
  return {
    key: 'guidance',
    lines: rules.map((rule) => `- ${rule.body.replace(/\s+/g, ' ').trim()}`),
  };
}

/** The persona's style as part of layer 5 — address form and emoji. */
export function personaStyleLayer(style: PersonaStyle | null | undefined): PromptLayer {
  const lines: string[] = [];
  if (style?.addressForm === 'siz') {
    lines.push('Address the customer formally: in Turkish with "siz", never "sen".');
  } else if (style?.addressForm === 'sen') {
    lines.push('Address the customer informally: in Turkish with "sen", not "siz".');
  }
  if (style?.emoji === 'none') lines.push('Use no emoji.');
  else if (style?.emoji === 'few') lines.push('An emoji or two where it fits; never more.');
  return { key: 'persona', lines };
}

const LAYER_HEADINGS: Record<PromptLayerKey, string> = {
  platform_locked: 'Platform rules (locked):',
  tenant_compliance: "The business's compliance rules:",
  step: "The step's instruction:",
  guidance: "The business's rules for how you behave:",
  persona: 'Persona:',
  context: 'Context:',
};

/**
 * The layers in the fixed order (AI-07 §1), each under its heading, after one
 * line saying the earlier wins; nothing when no layer has a line — a turn
 * with no rules and no style is the prompt it was.
 */
export function renderLayers(layers: readonly PromptLayer[]): string[] {
  const present = PROMPT_LAYERS.flatMap((key) => {
    const lines = layers.filter((layer) => layer.key === key).flatMap((layer) => layer.lines);
    return lines.length > 0 ? [{ key, lines }] : [];
  });
  if (present.length === 0) return [];
  return [
    "Follow these rules, most binding first: platform rules, then the business's compliance rules, then the step's instruction, then the business's rules, then the persona. Where two conflict, the earlier one wins.",
    ...present.flatMap(({ key, lines }) => [LAYER_HEADINGS[key], ...lines]),
  ];
}

const EMOJI = /\p{Extended_Pictographic}/gu;
const FAMILIAR = /(?<!\p{L})(sen|seni|sana|senin|sende|senden|seninle)(?!\p{L})/iu;
const FORMAL = /(?<!\p{L})(siz|sizi|size|sizin|sizde|sizden|sizinle)(?!\p{L})/iu;

/**
 * Where a written message strays from the style (AI-07 §3): `emoji`,
 * `address_form`. A warning for the run log, not a block — the address check
 * reads pronouns only, so it never flags a verb form it cannot judge.
 */
export function styleWarnings(text: string, style: PersonaStyle | null | undefined): string[] {
  if (!style) return [];
  const warnings: string[] = [];
  const emoji = text.match(EMOJI)?.length ?? 0;
  if ((style.emoji === 'none' && emoji > 0) || (style.emoji === 'few' && emoji > 2)) {
    warnings.push('emoji');
  }
  if (
    (style.addressForm === 'siz' && FAMILIAR.test(text)) ||
    (style.addressForm === 'sen' && FORMAL.test(text))
  ) {
    warnings.push('address_form');
  }
  return warnings;
}
