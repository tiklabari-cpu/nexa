/**
 * The workspace's hand-over rules (tm 303.3 · SiyahTuş analysis AI-09; owner
 * decision K9): an ordered list an Admin or the Owner keeps on Playbook › AI
 * Agent › Behaviour › Hand-over (`ai_handoff_rules`, migration
 * `20261019230000_ai_handoff_rules`). Each rule is a trigger, a target team
 * and a priority; the first active rule that matches decides.
 *
 * Two kinds of trigger:
 *
 *   - **firing** — `topic`, `procedure`, `phrase`, `risk_flag`: the rule hands
 *     the conversation over itself, reason `tenant_rule`. A topic, a phrase
 *     and a risk flag are judged on the player's message before any model is
 *     asked; a procedure when the understanding call names it (or it is the
 *     one in progress).
 *   - **routing** — `ai_unresolved`, `player_request`: the AI hands over for
 *     its own reasons (the AI could not solve it; the player asked for a
 *     person); the rule only says where the conversation goes and how urgent
 *     it is.
 *
 * The platform's locked compliance rules (AI-08 G1–G5, G13, G15) head the list
 * on the screen, greyed out ({@link LOCKED_HANDOFF_RULES}). They are the
 * guardrail catalogue's, not rows: nothing a workspace sends turns one off —
 * 400 `handoff_trigger_locked`, as for the locked triggers (tm 303.1).
 *
 * The ready-made examples (K9: "AI çözemedi", "Hesap ve şifre kurtarma",
 * "Para yatırma") are offered, not installed ({@link HANDOFF_RULE_EXAMPLES}):
 * an active "deposit → finance" rule would take every deposit question away
 * from the AI's own deposit procedure without the workspace having asked.
 *
 * A draft table like the rest (ADR-14b §2.12): written through
 * `config-draft.ts`, read by a turn from its configuration (`AiConfigSource`).
 */
import { PLATFORM_GUARDRAILS, type GuardrailId, type GuardrailPriority } from './guardrails.js';
import type { HandoffReason } from './handoff.js';
import { RISK_FLAG_TYPES, type RiskFlagType } from './risk-flags.js';

/** What sets a rule off — see the module header. */
export const HANDOFF_RULE_TRIGGER_TYPES = [
  'topic',
  'procedure',
  'phrase',
  'ai_unresolved',
  'player_request',
  'risk_flag',
] as const;
export type HandoffRuleTriggerType = (typeof HANDOFF_RULE_TRIGGER_TYPES)[number];

/** The triggers that hand over on their own (reason `tenant_rule`). */
export const FIRING_HANDOFF_RULE_TRIGGERS = [
  'topic',
  'procedure',
  'phrase',
  'risk_flag',
] as const satisfies readonly HandoffRuleTriggerType[];

/** The triggers that only route a hand-over the AI makes for its own reasons. */
export const ROUTING_HANDOFF_RULE_TRIGGERS = [
  'ai_unresolved',
  'player_request',
] as const satisfies readonly HandoffRuleTriggerType[];

/**
 * The topics a `topic` rule names. The engine knows each by its words in
 * Turkish and English (`conversation/handoff/rules.ts`); the screen shows
 * their names.
 */
export const HANDOFF_RULE_TOPICS = [
  'deposit',
  'withdrawal',
  'account_recovery',
  'bonus',
  'verification',
] as const;
export type HandoffRuleTopic = (typeof HANDOFF_RULE_TOPICS)[number];

/**
 * The reasons that mean "the AI could not solve it" — what an `ai_unresolved`
 * rule routes. Not the guardrails, not a person asked for, not an upset player.
 */
export const AI_UNRESOLVED_HANDOFF_REASONS = [
  'no_knowledge',
  'not_understood',
  'loop_detected',
  'max_turns',
  'missing_required_info',
  'player_said_unresolved',
  'unsupported_language',
  'ai_failure',
] as const satisfies readonly HandoffReason[];

/** The hand-over's priority (AI-12 §3) — the guardrails' three. */
export type HandoffRulePriority = GuardrailPriority;

export const HANDOFF_RULE_TITLE_MAX = 80;
export const HANDOFF_RULE_PHRASE_MAX = 100;
export const HANDOFF_RULES_PER_AGENT_MAX = 50;

/**
 * A rule's trigger. `value` is the topic, the procedure skill's id, the phrase
 * or the risk flag type; null for `ai_unresolved` and `player_request`.
 */
export type HandoffRuleTrigger =
  | { readonly type: 'topic'; readonly value: HandoffRuleTopic }
  | { readonly type: 'procedure'; readonly value: string }
  | { readonly type: 'phrase'; readonly value: string }
  | { readonly type: 'risk_flag'; readonly value: RiskFlagType }
  | { readonly type: 'ai_unresolved' | 'player_request'; readonly value: null };

/** Where the rule sends the conversation — the procedures' shape (`HandoffTarget`); null: the usual routing. */
export type HandoffRuleTarget = { readonly group_id: number } | { readonly topic: string };

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value);
}

/**
 * The stored trigger as the engine reads it, or null when it reads as none the
 * API writes (the CHECKs hold the type; the value is the route's).
 */
export function readHandoffRuleTrigger(
  type: string,
  value: string | null,
): HandoffRuleTrigger | null {
  switch (type) {
    case 'topic':
      return oneOf(value, HANDOFF_RULE_TOPICS) ? { type, value } : null;
    case 'risk_flag':
      return oneOf(value, RISK_FLAG_TYPES) ? { type, value } : null;
    case 'procedure':
    case 'phrase':
      return value !== null && value.trim() !== '' ? { type, value } : null;
    case 'ai_unresolved':
    case 'player_request':
      return { type, value: null };
    default:
      return null;
  }
}

/** The stored target columns as one target, or null for the usual routing. */
export function readHandoffRuleTarget(
  groupId: bigint | number | null,
  topic: string | null,
): HandoffRuleTarget | null {
  if (groupId !== null) return { group_id: Number(groupId) };
  if (topic !== null) return { topic };
  return null;
}

// ---------------------------------------------------------------------------
// The ready-made examples (K9).
// ---------------------------------------------------------------------------

export interface HandoffRuleExample {
  readonly key: 'ai_unresolved' | 'account_recovery' | 'deposit';
  readonly title: Readonly<Record<'tr' | 'en', string>>;
  readonly trigger: HandoffRuleTrigger;
  readonly target: HandoffRuleTarget | null;
  readonly priority: HandoffRulePriority;
}

/**
 * K9's three. The targets are routing topics (ADR-08a's queue roles), so they
 * reach whichever team the workspace routes the topic to.
 */
export const HANDOFF_RULE_EXAMPLES: readonly HandoffRuleExample[] = Object.freeze([
  Object.freeze({
    key: 'ai_unresolved',
    title: Object.freeze({ tr: 'AI çözemedi', en: 'The AI could not solve it' }),
    trigger: Object.freeze({ type: 'ai_unresolved', value: null }),
    target: null,
    priority: 'normal',
  }),
  Object.freeze({
    key: 'account_recovery',
    title: Object.freeze({ tr: 'Hesap ve şifre kurtarma', en: 'Account and password recovery' }),
    trigger: Object.freeze({ type: 'topic', value: 'account_recovery' }),
    target: Object.freeze({ topic: 'kyc_risk' }),
    priority: 'high',
  }),
  Object.freeze({
    key: 'deposit',
    title: Object.freeze({ tr: 'Para yatırma', en: 'Deposits' }),
    trigger: Object.freeze({ type: 'topic', value: 'deposit' }),
    target: Object.freeze({ topic: 'finance' }),
    priority: 'high',
  }),
] as const satisfies readonly HandoffRuleExample[]);

// ---------------------------------------------------------------------------
// The locked rows (K9: G1–G5, G13, G15).
// ---------------------------------------------------------------------------

/** The compliance guardrails K9 names as the list's locked rules. */
export const LOCKED_HANDOFF_RULE_IDS = [
  'G1',
  'G2',
  'G3',
  'G4',
  'G5',
  'G13',
  'G15',
] as const satisfies readonly GuardrailId[];
export type LockedHandoffRuleId = (typeof LOCKED_HANDOFF_RULE_IDS)[number];

export function isLockedHandoffRuleId(value: unknown): value is LockedHandoffRuleId {
  return oneOf(value, LOCKED_HANDOFF_RULE_IDS);
}

/** A locked row as the list shows it — always on, never moved. */
export interface LockedHandoffRule {
  readonly id: LockedHandoffRuleId;
  readonly title: Readonly<Record<'tr' | 'en', string>>;
  /** The guardrail's hand-over reason; null for G4, which blocks bonus talk and hands nothing over. */
  readonly reason: HandoffReason | null;
  readonly target: HandoffRuleTarget | null;
  readonly priority: HandoffRulePriority;
}

// Marked side-effect free so a bundle that never shows the list — the widget's
// loader imports `@siyahtus/types` for one helper — drops it (bundle-size.test).
/*@__NO_SIDE_EFFECTS__*/
function lockedRules(): readonly LockedHandoffRule[] {
  return Object.freeze(
    LOCKED_HANDOFF_RULE_IDS.map((id) => {
      const rule = PLATFORM_GUARDRAILS.find((guardrail) => guardrail.id === id);
      if (!rule) throw new Error(`guardrail ${id} is not in the catalogue`);
      return Object.freeze({
        id,
        title: rule.title,
        reason: rule.handoffReason,
        target: rule.target ? Object.freeze({ topic: rule.target }) : null,
        priority: rule.priority,
      });
    }),
  );
}

/** The locked rows, read off the guardrail catalogue so the two never disagree. */
export const LOCKED_HANDOFF_RULES: readonly LockedHandoffRule[] = lockedRules();
