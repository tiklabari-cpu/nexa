/**
 * Hand-over to a person (tm 303.1 · SiyahTuş analysis AI-09; owner decision
 * K9): why the AI hands a conversation over, which of those reasons a
 * workspace may switch off, and the per-agent settings the triggers and the
 * hand-over messages are read from (`ai_handoff_settings.triggers`,
 * `.messages`, `.after_hours` — migration `20261019210000_ai_handoff_triggers`).
 *
 * Every hand-over carries one or more reason codes. They are recorded together
 * — the transfer event, the hand-over card (AI-10), the reports (AI-25) — and
 * the most severe of them is the hand-over's `primary_reason`
 * ({@link primaryHandoffReason}).
 *
 * A reason's {@link HandoffReasonInfo.control} says where it is configured:
 *
 *   - `locked`    — always on, shown greyed out with its switch on: the
 *                   compliance guardrails (AI-08 G1–G5, G13, G15, G19), a
 *                   person asked for (G16), and the AI never going silent
 *                   (`ai_failure`, `unsupported_language`, a required answer
 *                   the player refuses). A request that turns one off is
 *                   400 `validation`, `details.reason: handoff_trigger_locked`.
 *                   `abuse` is locked but its warning count is the workspace's.
 *   - `switch`    — a trigger on the settings screen the workspace may turn
 *                   off and tune (AI-09-S2).
 *   - `elsewhere` — fired by something the workspace writes in its own screen:
 *                   a procedure's hand-over step, a hand-over rule (K9,
 *                   `ai_handoff_rules`, tm 303.3), a workspace guardrail rule
 *                   (tm 301), the knowledge base's no-answer policy (AI-06,
 *                   `ai_handoff_settings.no_answer`), the player saying it is
 *                   not resolved (AI-25).
 *
 * The settings are a draft table (ADR-14b `docs/adr/ai-config-versioning.md`
 * §2.12): no publish state, every write through `config-draft.ts`, and a turn
 * reads the triggers and messages from the configuration it is pinned to
 * (`AiConfigSource`, §2.6). The defaults are AI-09-S1/S2: 2 turns not
 * understood, 2 warnings for abuse, 12 turns per procedure.
 */
import type { GuardrailLang } from './guardrails.js';

/**
 * The hand-over reasons, most severe first — the order {@link primaryHandoffReason}
 * picks by and {@link HandoffReasonInfo.rank} numbers.
 *
 * Two of them are not in AI-09's list but are already handed over with:
 * `risk_flag` (an active risk flag that keeps the AI out, tm 302.2) and
 * `guardrail_workspace_rule` (a workspace guardrail rule blocking a reply,
 * tm 301.3). `tenant_rule` is a K9 hand-over rule, `player_said_unresolved`
 * the player answering "no" to "is it resolved?" (AI-25).
 */
export const HANDOFF_REASONS = [
  'guardrail_self_harm',
  'guardrail_minor',
  'guardrail_rg',
  'risk_flag',
  'guardrail_account_security',
  'guardrail_complaint',
  'guardrail_output_block',
  'guardrail_workspace_rule',
  'abuse',
  'player_request',
  'tenant_rule',
  'procedure_rule',
  'missing_required_info',
  'repeat_same_day',
  'negative_sentiment',
  'player_said_unresolved',
  'no_knowledge',
  'not_understood',
  'loop_detected',
  'max_turns',
  'unsupported_language',
  'ai_failure',
] as const;
export type HandoffReason = (typeof HANDOFF_REASONS)[number];

export function isHandoffReason(value: unknown): value is HandoffReason {
  return (HANDOFF_REASONS as readonly unknown[]).includes(value);
}

/** Where a reason is configured — see the module header. */
export const HANDOFF_REASON_CONTROLS = ['locked', 'switch', 'elsewhere'] as const;
export type HandoffReasonControl = (typeof HANDOFF_REASON_CONTROLS)[number];

/**
 * When in a turn the trigger is judged (AI-09 §1): `understand` — right after
 * the understanding call, before the executor; `procedure` — after the
 * executor; `output` — after the reply is composed (AI-08); `system` — whenever
 * the AI cannot answer at all.
 */
export const HANDOFF_REASON_STAGES = ['understand', 'procedure', 'output', 'system'] as const;
export type HandoffReasonStage = (typeof HANDOFF_REASON_STAGES)[number];

export interface HandoffReasonInfo {
  /** 1 is the most severe; a hand-over's primary reason is its lowest rank. */
  readonly rank: number;
  readonly control: HandoffReasonControl;
  readonly stage: HandoffReasonStage;
}

export const HANDOFF_REASON_INFO: Readonly<Record<HandoffReason, HandoffReasonInfo>> =
  Object.freeze({
    guardrail_self_harm: { rank: 1, control: 'locked', stage: 'understand' },
    guardrail_minor: { rank: 2, control: 'locked', stage: 'understand' },
    guardrail_rg: { rank: 3, control: 'locked', stage: 'understand' },
    risk_flag: { rank: 4, control: 'locked', stage: 'understand' },
    guardrail_account_security: { rank: 5, control: 'locked', stage: 'understand' },
    guardrail_complaint: { rank: 6, control: 'locked', stage: 'understand' },
    guardrail_output_block: { rank: 7, control: 'locked', stage: 'output' },
    guardrail_workspace_rule: { rank: 8, control: 'elsewhere', stage: 'output' },
    abuse: { rank: 9, control: 'locked', stage: 'understand' },
    player_request: { rank: 10, control: 'locked', stage: 'understand' },
    tenant_rule: { rank: 11, control: 'elsewhere', stage: 'understand' },
    procedure_rule: { rank: 12, control: 'elsewhere', stage: 'procedure' },
    missing_required_info: { rank: 13, control: 'locked', stage: 'procedure' },
    repeat_same_day: { rank: 14, control: 'switch', stage: 'procedure' },
    negative_sentiment: { rank: 15, control: 'switch', stage: 'understand' },
    player_said_unresolved: { rank: 16, control: 'elsewhere', stage: 'procedure' },
    no_knowledge: { rank: 17, control: 'elsewhere', stage: 'procedure' },
    not_understood: { rank: 18, control: 'switch', stage: 'understand' },
    loop_detected: { rank: 19, control: 'switch', stage: 'understand' },
    max_turns: { rank: 20, control: 'switch', stage: 'procedure' },
    unsupported_language: { rank: 21, control: 'locked', stage: 'understand' },
    ai_failure: { rank: 22, control: 'locked', stage: 'system' },
  });

/** The reasons a workspace cannot turn off (control `locked`). */
export const LOCKED_HANDOFF_REASONS = [
  'guardrail_self_harm',
  'guardrail_minor',
  'guardrail_rg',
  'risk_flag',
  'guardrail_account_security',
  'guardrail_complaint',
  'guardrail_output_block',
  'abuse',
  'player_request',
  'missing_required_info',
  'unsupported_language',
  'ai_failure',
] as const satisfies readonly HandoffReason[];
export type LockedHandoffReason = (typeof LOCKED_HANDOFF_REASONS)[number];

export function isLockedHandoffReason(value: unknown): value is LockedHandoffReason {
  return (LOCKED_HANDOFF_REASONS as readonly unknown[]).includes(value);
}

/** The triggers the settings screen switches (control `switch`). */
export const SWITCHABLE_HANDOFF_TRIGGERS = [
  'not_understood',
  'negative_sentiment',
  'loop_detected',
  'max_turns',
  'repeat_same_day',
] as const satisfies readonly HandoffReason[];
export type SwitchableHandoffTrigger = (typeof SWITCHABLE_HANDOFF_TRIGGERS)[number];

/** `details.reason` of the 400 a request turning a locked trigger off gets. */
export const HANDOFF_TRIGGER_LOCKED_REASON = 'handoff_trigger_locked';

/**
 * The one primary reason of a hand-over: the most severe of its reasons, or
 * null for none. Unknown codes rank after every known one, in their order.
 */
export function primaryHandoffReason(reasons: readonly string[]): string | null {
  let best: string | null = null;
  let bestRank = Number.POSITIVE_INFINITY;
  for (const reason of reasons) {
    const rank = isHandoffReason(reason)
      ? HANDOFF_REASON_INFO[reason].rank
      : HANDOFF_REASONS.length + 1;
    if (rank < bestRank) {
      best = reason;
      bestRank = rank;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Triggers (`ai_handoff_settings.triggers`).
// ---------------------------------------------------------------------------

/**
 * The workspace's triggers, as the engine and the API read them:
 *
 *   - `not_understood` — `turns` in a row the AI could not tell what the player
 *     wants; then it asks once "shall I pass you to an agent?" (`ask_first`)
 *     or hands over.
 *   - `negative_sentiment` — an angry player, or `consecutive` negative turns
 *     in a row; `ask_first` asks before handing over.
 *   - `abuse` — after `warnings` calm warnings (G19). Locked: no switch.
 *   - `loop_detected` — the same bot question twice in a row, or the same
 *     player message three times.
 *   - `max_turns` — `turns` AI turns in one procedure (AI-03).
 *   - `repeat_same_day` — the same problem again the same day (AI-02): the
 *     diagnosis is skipped, only missing required answers are asked, then a
 *     person.
 */
export interface HandoffTriggers {
  not_understood: { enabled: boolean; turns: number; ask_first: boolean };
  negative_sentiment: { enabled: boolean; consecutive: number; ask_first: boolean };
  abuse: { warnings: number };
  loop_detected: { enabled: boolean };
  max_turns: { enabled: boolean; turns: number };
  repeat_same_day: { enabled: boolean };
}

/** The bounds of each count — the route's validation and the reader's clamp. */
export const HANDOFF_TRIGGER_BOUNDS = Object.freeze({
  not_understood_turns: Object.freeze({ min: 1, max: 10 }),
  negative_sentiment_consecutive: Object.freeze({ min: 1, max: 10 }),
  abuse_warnings: Object.freeze({ min: 1, max: 5 }),
  max_turns: Object.freeze({ min: 2, max: 50 }),
});

/**
 * AI-09-S1/S2: two turns not understood (asked about once), two negative
 * turns (handed over without asking — the player is already upset), two
 * warnings, twelve turns.
 */
export const DEFAULT_HANDOFF_TRIGGERS: Readonly<HandoffTriggers> = Object.freeze({
  not_understood: Object.freeze({ enabled: true, turns: 2, ask_first: true }),
  negative_sentiment: Object.freeze({ enabled: true, consecutive: 2, ask_first: false }),
  abuse: Object.freeze({ warnings: 2 }),
  loop_detected: Object.freeze({ enabled: true }),
  max_turns: Object.freeze({ enabled: true, turns: 12 }),
  repeat_same_day: Object.freeze({ enabled: true }),
}) as Readonly<HandoffTriggers>;

/** A change to the triggers: any trigger, any field; the rest keep their value. */
export type HandoffTriggersChange = {
  [K in keyof HandoffTriggers]?: Partial<HandoffTriggers[K]>;
};

function objectOf(raw: unknown): Record<string, unknown> {
  return raw !== null && typeof raw === 'object' && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {};
}

function boolOr(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function countOr(value: unknown, fallback: number, bounds: { min: number; max: number }): number {
  return typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= bounds.min &&
    value <= bounds.max
    ? value
    : fallback;
}

/**
 * The stored `triggers` as the engine and the API read them: every trigger,
 * the default where the row has none or something out of bounds. Null (no
 * row, or never set) is the defaults.
 */
export function readHandoffTriggers(raw: unknown): HandoffTriggers {
  const stored = objectOf(raw);
  const d = DEFAULT_HANDOFF_TRIGGERS;
  const b = HANDOFF_TRIGGER_BOUNDS;
  const notUnderstood = objectOf(stored['not_understood']);
  const negative = objectOf(stored['negative_sentiment']);
  const abuse = objectOf(stored['abuse']);
  const maxTurns = objectOf(stored['max_turns']);
  return {
    not_understood: {
      enabled: boolOr(notUnderstood['enabled'], d.not_understood.enabled),
      turns: countOr(notUnderstood['turns'], d.not_understood.turns, b.not_understood_turns),
      ask_first: boolOr(notUnderstood['ask_first'], d.not_understood.ask_first),
    },
    negative_sentiment: {
      enabled: boolOr(negative['enabled'], d.negative_sentiment.enabled),
      consecutive: countOr(
        negative['consecutive'],
        d.negative_sentiment.consecutive,
        b.negative_sentiment_consecutive,
      ),
      ask_first: boolOr(negative['ask_first'], d.negative_sentiment.ask_first),
    },
    abuse: { warnings: countOr(abuse['warnings'], d.abuse.warnings, b.abuse_warnings) },
    loop_detected: {
      enabled: boolOr(objectOf(stored['loop_detected'])['enabled'], d.loop_detected.enabled),
    },
    max_turns: {
      enabled: boolOr(maxTurns['enabled'], d.max_turns.enabled),
      turns: countOr(maxTurns['turns'], d.max_turns.turns, b.max_turns),
    },
    repeat_same_day: {
      enabled: boolOr(objectOf(stored['repeat_same_day'])['enabled'], d.repeat_same_day.enabled),
    },
  };
}

/** The stored triggers with a change over them, field by field. */
export function mergeHandoffTriggers(
  stored: unknown,
  change: HandoffTriggersChange,
): HandoffTriggers {
  const current = readHandoffTriggers(stored);
  const next = { ...current } as Record<keyof HandoffTriggers, object>;
  for (const key of Object.keys(current) as (keyof HandoffTriggers)[]) {
    const fields = change[key];
    if (!fields) continue;
    const defined = Object.fromEntries(
      Object.entries(fields).filter(([, value]) => value !== undefined),
    );
    next[key] = { ...current[key], ...defined };
  }
  // Read back through the reader so nothing out of bounds is ever stored.
  return readHandoffTriggers(next);
}

// ---------------------------------------------------------------------------
// Messages (`ai_handoff_settings.messages`) and after hours (`.after_hours`).
// ---------------------------------------------------------------------------

/**
 * The reasons a hand-over message is written for — every reason but
 * `no_knowledge`, whose sentence is AI-06's `no_answer.text` (tm 298) on the
 * same row: one sentence, one place.
 */
export const HANDOFF_MESSAGE_REASONS = [
  'guardrail_self_harm',
  'guardrail_minor',
  'guardrail_rg',
  'risk_flag',
  'guardrail_account_security',
  'guardrail_complaint',
  'guardrail_output_block',
  'guardrail_workspace_rule',
  'abuse',
  'player_request',
  'tenant_rule',
  'procedure_rule',
  'missing_required_info',
  'repeat_same_day',
  'negative_sentiment',
  'player_said_unresolved',
  'not_understood',
  'loop_detected',
  'max_turns',
  'unsupported_language',
  'ai_failure',
] as const satisfies readonly HandoffReason[];
export type HandoffMessageReason = (typeof HANDOFF_MESSAGE_REASONS)[number];

/** The longest hand-over message or after-hours text (the route and the column's CHECK). */
export const HANDOFF_MESSAGE_MAX = 500;

/**
 * What the player is told as the AI hands over, by reason, when the workspace
 * wrote nothing of its own — said as written, no model (AI-09 §4). They make
 * no promise of time or outcome: the output guardrails pass them
 * (`handoff.test.ts`). G3's crisis text (AI-08) goes before its message.
 */
export const DEFAULT_HANDOFF_MESSAGES: Readonly<
  Record<HandoffMessageReason, Readonly<Record<GuardrailLang, string>>>
> = Object.freeze({
  guardrail_self_harm: Object.freeze({
    tr: 'Sizi bir temsilcimize aktarıyorum.',
    en: 'I am passing you to one of our agents.',
  }),
  guardrail_minor: Object.freeze({
    tr: 'Sizi bir temsilcimize aktarıyorum.',
    en: 'I am passing you to one of our agents.',
  }),
  guardrail_rg: Object.freeze({
    tr: 'Bu konuda size destek olabilecek ekibimize aktarıyorum.',
    en: 'I am passing you to the team that can support you with this.',
  }),
  risk_flag: Object.freeze({
    tr: 'Sizi bir temsilcimize aktarıyorum.',
    en: 'I am passing you to one of our agents.',
  }),
  guardrail_account_security: Object.freeze({
    tr: 'Hesabınızın güvenliği için sizi yetkili ekibimize aktarıyorum.',
    en: 'For your account’s security I am passing you to the team that handles this.',
  }),
  guardrail_complaint: Object.freeze({
    tr: 'Şikâyetinizi ilgili ekibimize iletiyor, sizi bir temsilcimize aktarıyorum.',
    en: 'I am passing your complaint to the team that handles it, along with you.',
  }),
  guardrail_output_block: Object.freeze({
    tr: 'Sizi bir temsilcimize aktarıyorum.',
    en: 'I am passing you to one of our agents.',
  }),
  guardrail_workspace_rule: Object.freeze({
    tr: 'Sizi bir temsilcimize aktarıyorum.',
    en: 'I am passing you to one of our agents.',
  }),
  abuse: Object.freeze({
    tr: 'Görüşmenizi bir temsilcimize aktarıyorum.',
    en: 'I am passing this conversation to one of our agents.',
  }),
  player_request: Object.freeze({
    tr: 'Sizi bir temsilcimize aktarıyorum.',
    en: 'I am passing you to one of our agents.',
  }),
  tenant_rule: Object.freeze({
    tr: 'Talebinizi ilgili ekibimize aktarıyorum.',
    en: 'I am passing your request to the team that handles it.',
  }),
  procedure_rule: Object.freeze({
    tr: 'Talebinizi ilgili ekibimize aktarıyorum.',
    en: 'I am passing your request to the team that handles it.',
  }),
  missing_required_info: Object.freeze({
    tr: 'Bu bilgi olmadan devam edemiyorum. Sizi bir temsilcimize aktarıyorum.',
    en: 'I cannot go on without this information. I am passing you to one of our agents.',
  }),
  repeat_same_day: Object.freeze({
    tr: 'Bugün bu konuda yeniden yazdığınızı görüyorum. Sizi doğrudan bir temsilcimize aktarıyorum.',
    en: 'I can see you have written about this already today. I am passing you straight to one of our agents.',
  }),
  negative_sentiment: Object.freeze({
    tr: 'Yaşadığınız durum için üzgünüm. Sizi bir temsilcimize aktarıyorum.',
    en: 'I am sorry about this. I am passing you to one of our agents.',
  }),
  player_said_unresolved: Object.freeze({
    tr: 'Sorununuz çözülmediği için sizi bir temsilcimize aktarıyorum.',
    en: 'As this is not resolved yet, I am passing you to one of our agents.',
  }),
  not_understood: Object.freeze({
    tr: 'Size daha iyi yardımcı olabilmesi için sizi bir temsilcimize aktarıyorum.',
    en: 'I am passing you to one of our agents so they can help you better.',
  }),
  loop_detected: Object.freeze({
    tr: 'Size daha iyi yardımcı olabilmesi için sizi bir temsilcimize aktarıyorum.',
    en: 'I am passing you to one of our agents so they can help you better.',
  }),
  max_turns: Object.freeze({
    tr: 'Size daha iyi yardımcı olabilmesi için sizi bir temsilcimize aktarıyorum.',
    en: 'I am passing you to one of our agents so they can help you better.',
  }),
  unsupported_language: Object.freeze({
    tr: 'Size bir temsilcimiz yardımcı olacak.',
    en: 'One of our agents will help you.',
  }),
  ai_failure: Object.freeze({
    tr: 'Size bir temsilcimiz yardımcı olacak.',
    en: 'One of our agents will help you.',
  }),
});

/**
 * The workspace's own message per reason, said as written in place of the
 * default; null where it wrote none.
 */
export type HandoffMessages = Record<HandoffMessageReason, string | null>;

function textOrNull(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text === '' ? null : text.slice(0, HANDOFF_MESSAGE_MAX);
}

/** The stored `messages`: every reason, null where the row has none (or nothing usable). */
export function readHandoffMessages(raw: unknown): HandoffMessages {
  const stored = objectOf(raw);
  const messages = {} as HandoffMessages;
  for (const reason of HANDOFF_MESSAGE_REASONS) messages[reason] = textOrNull(stored[reason]);
  return messages;
}

/** The stored messages with a change over them; null goes back to the default. */
export function mergeHandoffMessages(
  stored: unknown,
  change: Partial<Record<HandoffMessageReason, string | null>>,
): HandoffMessages {
  const messages = readHandoffMessages(stored);
  for (const reason of HANDOFF_MESSAGE_REASONS) {
    const value = change[reason];
    if (value !== undefined) messages[reason] = textOrNull(value);
  }
  return messages;
}

/** The stored form of the messages: only the ones written, so a default can change later. */
export function storedHandoffMessages(messages: HandoffMessages): Record<string, string> {
  const stored: Record<string, string> = {};
  for (const reason of HANDOFF_MESSAGE_REASONS) {
    const text = messages[reason];
    if (text !== null) stored[reason] = text;
  }
  return stored;
}

/**
 * What the player is told for a reason: the workspace's message, or the
 * default in `lang`. `no_knowledge` is not here — its sentence is
 * `no_answer.text`.
 */
export function handoffMessage(
  messages: HandoffMessages,
  reason: HandoffMessageReason,
  lang: GuardrailLang,
): string {
  return messages[reason] ?? DEFAULT_HANDOFF_MESSAGES[reason][lang];
}

/**
 * What the player is told when the hand-over lands where nobody is accepting
 * chats (AI-12 §4): the workspace's text — where it may say when the team is
 * back — or the default. The conversation waits in the team's queue either way.
 */
export interface HandoffAfterHours {
  text: string | null;
}

export const DEFAULT_HANDOFF_AFTER_HOURS_TEXT: Readonly<Record<GuardrailLang, string>> =
  Object.freeze({
    tr: 'Ekibimiz şu anda müsait değil. Mesajınız sırada; ekibimiz döndüğünde size yazacak.',
    en: 'Our team is not available right now. Your message is in the queue; the team will write to you when they are back.',
  });

export function readHandoffAfterHours(raw: unknown): HandoffAfterHours {
  return { text: textOrNull(objectOf(raw)['text']) };
}
