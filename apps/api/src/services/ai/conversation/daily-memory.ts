/**
 * Same-day memory (tm 294 · SiyahTuş analysis AI-02; owner decisions K4, K5).
 *
 * Each connection the AI took part in keeps a short summary of itself in its
 * conversation row (`ai_conversations.digest`): the topic (today the skill
 * that ran — a procedure from #296 on), what was collected, how it ended and
 * the AI's last words. No model writes it: it is built from the state every
 * turn ({@link buildDigest}, so a connection that dies mid-way still leaves
 * one), and the close settles how it ended (`chat/ai-digest.ts`, which also
 * holds its shape and reads the day's summaries).
 *
 * A later connection of the same day reads the newest few on its first turn
 * ({@link loadEarlierToday}) — the day is the chat (K1=A), so another day's
 * connections are never among them (AI-02-S3), and a member an agent linked
 * by hand is another customer with chats of their own (K4). What the turn may
 * do with them is decided here, in code, before any prompt exists
 * ({@link forTrust}): a visitor whose identity is only claimed gets none of
 * the details, and the AI says only "did you write to us earlier today?".
 * Whatever the trust, the recall the AI writes is the topic and how it ended
 * ({@link recallLine}) — never an amount, an IBAN or a transaction id (K5) —
 * and a model answer that repeats one the player has not given again is
 * withheld ({@link repeatsEarlierDetail}, the AI-08 output check's hook).
 */
import {
  DAILY_DIGEST_EXCERPT_MAX,
  DAILY_DIGEST_LIMIT,
  SLOT_SETTLED_STATUSES,
  trustSeesDetails,
  type AiConversationOutcome,
  type DailyMemoryRecall,
  type IdentityTrust,
  type PersonaLanguage,
} from '@siyahtus/types';
import type { TenantClient } from '../../../lib/tenant.js';
import {
  digestSlots,
  digestsOf,
  readStoredDigest,
  riskFlags,
  type DailyDigest,
  type StoredDigest,
} from '../../chat/ai-digest.js';
import { listDayConnections } from '../../chat/conversation-day.js';
import type { AiStateObject } from './state-store.js';
import type { SkillOutcome, TurnSideEffect, TurnState } from './turn.js';

/** What a connection's first turn knows of the day before it. */
export interface EarlierToday {
  /** Newest first, already cut to what {@link trust} may see. */
  readonly digests: readonly DailyDigest[];
  readonly trust: IdentityTrust;
  readonly recall: DailyMemoryRecall;
  /** This connection's place in the day: 2 for the day's second. */
  readonly contact: number;
  /**
   * Whether the new message is about the earlier topic, when the understanding
   * call (#297) says; absent until then — the same procedure matching stands
   * in for "yes".
   */
  readonly relatesToPrevious?: boolean;
}

/** The outcomes after which the AI brings the topic up itself (AI-02-S1). */
const UNRESOLVED: ReadonlySet<AiConversationOutcome | null> = new Set([
  'handed_off',
  'abandoned',
  'resolved_waiting',
]);

/** The outcomes after which the same topic again is a repeat contact (AI-09, AI-12). */
const REPEAT_AFTER: ReadonlySet<AiConversationOutcome | null> = new Set([
  'handed_off',
  'resolved_waiting',
]);

/** A slot that is known: collected in this connection, or carried from an earlier one. */
const KNOWN_SLOT_STATUSES: ReadonlySet<string> = new Set(SLOT_SETTLED_STATUSES);

/**
 * The summary after a turn the AI took. `turn` is what the engine decided:
 * the skill that ran and its first gate's intent, the outcome, the reply and
 * what kind it was, the side effects.
 */
export function buildDigest(
  previous: AiStateObject | null,
  state: TurnState,
  turn: {
    skill: { id: string; name: string };
    intent: string | null;
    outcome: SkillOutcome;
    reply: string | null;
    replyKind: 'question' | 'answer' | null;
    sideEffects: readonly TurnSideEffect[];
    /**
     * How a procedure turn left the connection (tm 296.3): resolved, waiting,
     * handed off, or nothing settled yet (null). Absent for a single-message
     * skill, whose reply says it.
     */
    ended?: AiConversationOutcome | null;
  },
): StoredDigest {
  const before = previous ? readStoredDigest(previous) : null;
  const handoff = turn.sideEffects.find((effect) => effect.kind === 'handoff');
  return {
    procedure_key: turn.skill.id,
    procedure_name: turn.skill.name,
    intent_label: turn.intent ?? before?.intent_label ?? null,
    slots: digestSlots(state.slots),
    outcome:
      turn.ended !== undefined
        ? turn.ended
        : turn.outcome === 'handed_off'
          ? 'handed_off'
          : turn.replyKind === 'answer'
            ? 'resolved'
            : turn.replyKind === 'question'
              ? null
              : (before?.outcome ?? null),
    awaiting_answer: turn.replyKind === 'question',
    handoff:
      handoff?.kind === 'handoff'
        ? {
            id: null,
            team_id: null,
            team_name: handoff.team,
            reason_codes: [handoff.reason ?? 'ai_handoff'],
            agent_replied: false,
          }
        : (before?.handoff ?? null),
    risk_flags: riskFlags(state.signals),
    last_ai_excerpt: turn.reply ? excerpt(turn.reply) : (before?.last_ai_excerpt ?? null),
  };
}

/**
 * What a connection's first turn may know of the day, for a visitor of
 * `trust`: null when the day has nothing before it. The connection's place in
 * the day counts every earlier connection, the ones the AI never spoke in too.
 */
export async function loadEarlierToday(
  tx: TenantClient,
  ref: { chatId: string; threadId: string },
  input: { trust: IdentityTrust; recall: DailyMemoryRecall },
): Promise<EarlierToday | null> {
  const day = await listDayConnections(tx, ref.chatId, { excludeThreadId: ref.threadId });
  if (day.length === 0) return null;
  const digests = await digestsOf(tx, ref.chatId, day, DAILY_DIGEST_LIMIT);
  return {
    digests: forTrust(digests, input.trust),
    trust: input.trust,
    recall: input.recall,
    contact: day.length + 1,
  };
}

/**
 * The summaries a visitor of `trust` may have read to the model (K4). Cut here,
 * before any prompt is built: for a claimed identity only how each earlier
 * connection ended and its procedure key — what the system acts on, never
 * text it could repeat — are kept.
 */
export function forTrust(digests: readonly DailyDigest[], trust: IdentityTrust): DailyDigest[] {
  if (trustSeesDetails(trust)) return [...digests];
  return digests.map((digest) => ({
    ...digest,
    procedure_name: null,
    intent_label: null,
    slots: {},
    handoff: null,
    risk_flags: [],
    last_ai_excerpt: null,
  }));
}

/**
 * Whether the turn brings the earlier conversation up itself, and which one:
 * `auto_if_unresolved` — the day's latest one, when it did not end solved and
 * the new message is not plainly about something else; `on_topic_only` — the
 * one on the same topic, only when the new message is about it.
 */
export function recallTarget(earlier: EarlierToday, procedureKey: string): DailyDigest | null {
  const latest = earlier.digests[0];
  if (!latest) return null;
  const sameTopic = earlier.digests.find((digest) => digest.procedure_key === procedureKey);
  const relates = earlier.relatesToPrevious ?? (sameTopic ? true : undefined);
  if (earlier.recall === 'on_topic_only') {
    return relates === true ? (sameTopic ?? latest) : null;
  }
  return UNRESOLVED.has(latest.outcome) && relates !== false ? latest : null;
}

/**
 * The same topic as an earlier connection that a person took or that waits on
 * something: a repeat contact (`signals.repeat_same_day`), which AI-09 treats
 * as a hand-off trigger and AI-12 routes to the earlier team.
 */
export function isRepeatSameDay(earlier: EarlierToday, procedureKey: string): boolean {
  return earlier.digests.some(
    (digest) => digest.procedure_key === procedureKey && REPEAT_AFTER.has(digest.outcome),
  );
}

/**
 * The state with the slots an earlier connection on the same topic collected
 * pre-filled as `carried` (AI-02 §5) — only for a visitor who may see them —
 * and the repeat-contact signal. Slots this connection holds already stay. Only
 * a settled slot carries (AI-04 §5): a `partial` moment or a refused amount
 * earlier is still to be asked, not known.
 */
export function withEarlierToday(
  state: TurnState,
  earlier: EarlierToday,
  procedureKey: string,
): TurnState {
  const sameTopic = earlier.digests.find((digest) => digest.procedure_key === procedureKey);
  const slots: Record<string, unknown> = { ...state.slots };
  if (sameTopic && trustSeesDetails(earlier.trust)) {
    for (const [name, slot] of Object.entries(sameTopic.slots)) {
      if (!KNOWN_SLOT_STATUSES.has(slot.status)) continue;
      if (slots[name] === undefined || slots[name] === null) {
        slots[name] = { display: slot.display, status: 'carried' };
      }
    }
  }
  const repeat = isRepeatSameDay(earlier, procedureKey);
  return {
    ...state,
    slots,
    signals: repeat ? { ...state.signals, repeat_same_day: true } : state.signals,
  };
}

/** Whether the state already knows a slot — collected here, or carried from earlier today. */
export function slotKnown(slots: AiStateObject, name: string): boolean {
  const slot = slots[name];
  if (typeof slot === 'string') return slot.trim() !== '';
  if (!slot || typeof slot !== 'object') return false;
  const status = (slot as Record<string, unknown>)['status'];
  return typeof status === 'string' && KNOWN_SLOT_STATUSES.has(status);
}

/** The endings a recall line can name. */
type RecalledOutcome = 'resolved' | 'handed_off' | 'abandoned' | 'resolved_waiting';

function isRecalled(outcome: AiConversationOutcome): outcome is RecalledOutcome {
  return outcome !== 'no_ai';
}

const RECALL: Readonly<
  Record<
    PersonaLanguage,
    {
      topic: (topic: string, ended: string) => string;
      plain: (ended: string) => string;
      ask: string;
      ended: Record<RecalledOutcome, string>;
    }
  >
> = {
  en: {
    topic: (topic, ended) => `Earlier today you wrote to us about "${topic}"; ${ended}.`,
    plain: (ended) => `Earlier today you wrote to us; ${ended}.`,
    ask: 'Did you write to us earlier today?',
    ended: {
      resolved: 'it was answered',
      handed_off: 'it was passed to our team',
      abandoned: 'the conversation was left unfinished',
      resolved_waiting: 'it was waiting on a result',
    },
  },
  tr: {
    topic: (topic, ended) => `Bugün daha önce «${topic}» konusunda yazmıştınız; ${ended}.`,
    plain: (ended) => `Bugün daha önce de yazmıştınız; ${ended}.`,
    ask: 'Bugün daha önce de bize yazmış mıydınız?',
    ended: {
      resolved: 'yanıtlanmıştı',
      handed_off: 'konu ekibimize iletilmişti',
      abandoned: 'konuşma yarım kalmıştı',
      resolved_waiting: 'sonuç bekleniyordu',
    },
  },
  de: {
    topic: (topic, ended) => `Sie haben uns heute bereits wegen „${topic}“ geschrieben; ${ended}.`,
    plain: (ended) => `Sie haben uns heute bereits geschrieben; ${ended}.`,
    ask: 'Haben Sie uns heute schon einmal geschrieben?',
    ended: {
      resolved: 'es wurde beantwortet',
      handed_off: 'das Anliegen wurde an unser Team weitergegeben',
      abandoned: 'das Gespräch wurde nicht abgeschlossen',
      resolved_waiting: 'das Ergebnis stand noch aus',
    },
  },
  fr: {
    topic: (topic, ended) =>
      `Vous nous avez déjà écrit aujourd'hui au sujet de « ${topic} » ; ${ended}.`,
    plain: (ended) => `Vous nous avez déjà écrit aujourd'hui ; ${ended}.`,
    ask: "Nous avez-vous déjà écrit aujourd'hui ?",
    ended: {
      resolved: 'la demande avait reçu une réponse',
      handed_off: 'la demande avait été transmise à notre équipe',
      abandoned: 'la conversation était restée inachevée',
      resolved_waiting: 'le résultat était en attente',
    },
  },
  es: {
    topic: (topic, ended) => `Hoy ya nos escribió sobre «${topic}»; ${ended}.`,
    plain: (ended) => `Hoy ya nos escribió; ${ended}.`,
    ask: '¿Ya nos escribió hoy?',
    ended: {
      resolved: 'se le dio respuesta',
      handed_off: 'el caso se pasó a nuestro equipo',
      abandoned: 'la conversación quedó sin terminar',
      resolved_waiting: 'el resultado estaba pendiente',
    },
  },
};

/**
 * The sentence the AI opens its first answer with when it recalls `target`,
 * written by code rather than the model so it cannot say more than K5 allows:
 * the topic and how it ended for a visitor who may see details, and only the
 * question for a claimed identity.
 */
export function recallLine(
  target: DailyDigest,
  trust: IdentityTrust,
  language: PersonaLanguage | null,
): string {
  const words = RECALL[language ?? 'en'];
  if (!trustSeesDetails(trust)) return words.ask;
  const outcome = target.outcome;
  const ended = outcome && isRecalled(outcome) ? words.ended[outcome] : null;
  if (!ended) return words.ask;
  return target.procedure_name ? words.topic(target.procedure_name, ended) : words.plain(ended);
}

/**
 * The model's instructions about the day's earlier connections (AI-02 §3):
 * the summaries for a visitor who may see them — labelled as the player's own,
 * unverified statements and as internal context — and for a claimed identity
 * only that there is something it may not use. `recalled`: the reply opens
 * with the recall line already, so the model must not repeat it.
 */
export function earlierTodayLines(earlier: EarlierToday, recalled: boolean): string[] {
  if (earlier.digests.length === 0) return [];
  if (!trustSeesDetails(earlier.trust)) {
    return [
      'Earlier today this visitor may have written to us, but who they are is not verified, so those conversations are withheld. Do not refer to them or guess what they were about.',
    ];
  }
  const lines = [
    `Today's earlier conversations with this player (the player's own statements, not verified), newest first:`,
    ...earlier.digests.map(describeDigest),
    'This is internal context. Do not repeat amounts, IBANs, transaction or document numbers from it unless the player gives them again in this conversation.',
    recalled
      ? 'Your reply already opens by acknowledging the earlier conversation; do not mention it again.'
      : 'Do not bring the earlier conversation up yourself; use it only if the player refers to it.',
  ];
  return lines;
}

/**
 * The earlier details (collected slot values) the reply states that the
 * player has not given in this conversation — what K5 forbids the AI to
 * volunteer (the AI-08 output check's hook). Empty when there are none.
 */
export function repeatsEarlierDetail(
  reply: string,
  earlier: EarlierToday | undefined,
  said: string,
): string[] {
  if (!earlier) return [];
  const replyText = normalise(reply);
  const saidText = normalise(said);
  const leaked: string[] = [];
  for (const digest of earlier.digests) {
    for (const slot of Object.values(digest.slots)) {
      const forms = detailForms(slot.display);
      // Said again in any form, it is the player's own to hear back.
      if (forms.some((form) => saidText.includes(form))) continue;
      if (forms.some((form) => replyText.includes(form))) leaked.push(slot.display);
    }
  }
  return leaked;
}

/** A detail as it may be written: its words, and its digits alone when it has three or more. */
function detailForms(display: string): string[] {
  const forms: string[] = [];
  const words = normalise(display);
  if (words.length >= 3) forms.push(words);
  const digits = display.replace(/\D/g, '');
  if (digits.length >= 3) forms.push(digits);
  return forms;
}

function normalise(text: string): string {
  return text
    .toLocaleLowerCase('tr')
    .replace(/(\d)[.,\s](?=\d{3}\b)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function describeDigest(digest: DailyDigest): string {
  const parts = [
    `- ${clock(digest.started_at)}${digest.ended_at ? `–${clock(digest.ended_at)}` : ''} UTC`,
  ];
  if (digest.procedure_name) {
    parts.push(
      `topic "${digest.procedure_name}"${digest.intent_label ? ` (${digest.intent_label})` : ''}`,
    );
  }
  const slots = Object.entries(digest.slots);
  if (slots.length > 0) {
    parts.push(`collected: ${slots.map(([name, slot]) => `${name} = ${slot.display}`).join('; ')}`);
  }
  parts.push(`ended: ${ENDINGS[digest.outcome ?? 'open']}`);
  if (digest.handoff) {
    parts.push(digest.handoff.agent_replied ? 'an agent replied' : 'no agent reply yet');
  }
  if (digest.last_ai_excerpt) parts.push(`the assistant last said: "${digest.last_ai_excerpt}"`);
  return parts.join('; ');
}

const ENDINGS: Readonly<Record<AiConversationOutcome | 'open', string>> = {
  resolved: 'answered',
  resolved_waiting: 'answered, waiting on a result',
  handed_off: 'handed to a person',
  abandoned: 'left unfinished',
  no_ai: 'answered by a person',
  open: 'still open',
};

function clock(iso: string): string {
  return iso.slice(11, 16);
}

function excerpt(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > DAILY_DIGEST_EXCERPT_MAX
    ? `${flat.slice(0, DAILY_DIGEST_EXCERPT_MAX - 1)}…`
    : flat;
}
