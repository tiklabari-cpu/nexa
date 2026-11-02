/**
 * Event-bound suggested replies (IN-07 · tm 364).
 *
 * A saved reply can be bound to something that happens in a conversation: it
 * starts, it is handed to this agent, the player stays silent, the player rates
 * it. This module is the pure half — it reads the transcript the panel already
 * holds and says which of those events are *active right now*; the composer
 * turns the active ones into chips. Nothing here fetches, nothing sends: a chip
 * only ever fills the reply box, exactly as a Copilot draft does.
 *
 * **Detected in the client, on purpose.** The server stores which reply is bound
 * to which event (`canned_responses.suggest_on`) and nothing else. "The agent
 * has not spoken yet", "the last system line handed the chat to me" and "the
 * player has been quiet for three minutes" are facts about what *this* agent
 * sees right now, and a timer that fires at the moment they become true is
 * cheaper in the panel than a scheduled job that would have to guess whether
 * anybody is looking.
 *
 * **The events**
 *   - `chat_started`      no human agent has written to the player yet, and the
 *                         player has said something.
 *   - `chat_transferred`  the newest system line is a hand-over to this agent,
 *                         and nobody has written since.
 *   - `customer_idle`     the newest message the player can see is an agent's and
 *                         `idleSeconds` have passed with no answer.
 *   - `rated_good|bad`    the player rated the connection (the `chat_rated` push
 *                         told the panel; the value comes from the re-read chat,
 *                         whose rating this agent may not be allowed to see — then
 *                         there is no value and no chip).
 *
 * Every active event carries a `key` that names *this occurrence* (the transfer
 * line's id, the agent message the silence follows, the vote's time). The
 * composer remembers the keys it has shown or the agent has dismissed, so an
 * event is offered once — a dismissed chip stays gone.
 */
import {
  EVENT_SUGGESTION_MAX_CHIPS,
  type CannedCategory,
  type RatingValue,
  type SuggestEvent,
} from '@siyahtus/types';

/** The part of a transcript event this module reads. */
export interface EventTurn {
  id: string;
  type: 'message' | 'system_message' | 'rich_message' | 'file' | 'filled_form';
  author_type: 'agent' | 'customer' | 'bot' | 'system';
  recipients: 'all' | 'agents';
  created_at: string;
  properties?: Record<string, unknown>;
}

/** An event that is active, and the occurrence it is. */
export interface ActiveSuggestEvent {
  event: SuggestEvent;
  key: string;
}

export interface DetectInput {
  /** The signed-in agent's account id. */
  agentId: string | null;
  /** The connection's current assignee, if any. */
  assigneeId: string | null;
  /** The transcript, oldest first. */
  turns: readonly EventTurn[];
  /** Whether the chat can be answered at all. */
  active: boolean;
  /** Seconds of silence that make the player idle. */
  idleSeconds: number;
  /** Now, in epoch ms (a parameter so a test does not depend on the clock). */
  now: number;
  /**
   * The player's vote on this connection, when the `chat_rated` push told the
   * panel about it and this caller may see it; otherwise null.
   */
  rating: { value: RatingValue; key: string } | null;
}

/** A message the player can see: not a note, not a system line. */
function isVisibleMessage(turn: EventTurn): boolean {
  return (
    turn.recipients === 'all' && turn.type !== 'system_message' && turn.author_type !== 'system'
  );
}

function isHumanAgentMessage(turn: EventTurn): boolean {
  return isVisibleMessage(turn) && turn.author_type === 'agent';
}

/** The order events win a place in the row: a verdict first, then the quiet, the hand-over, the start. */
const EVENT_PRIORITY: readonly SuggestEvent[] = [
  'rated_bad',
  'rated_good',
  'customer_idle',
  'chat_transferred',
  'chat_started',
];

/**
 * The index of the newest turn matching `test`, or -1. A manual loop: the
 * transcript can run to thousands of events and this runs on every render.
 */
function lastIndexWhere(turns: readonly EventTurn[], test: (turn: EventTurn) => boolean): number {
  for (let i = turns.length - 1; i >= 0; i -= 1) {
    if (test(turns[i]!)) return i;
  }
  return -1;
}

/** The transfer line's target, if it names one: `{ agent_id }` or `{ group_id }`. */
function transferTarget(turn: EventTurn): { agentId: string | null } | null {
  const props = turn.properties;
  if (!props || props['system_event'] !== 'chat_transferred') return null;
  const agentId = props['agent_id'];
  return { agentId: typeof agentId === 'string' ? agentId : null };
}

/**
 * When the player's silence becomes idle: the epoch ms at which `idleSeconds`
 * have passed since the agent's last visible message, or null when the newest
 * visible message is not an agent's (the player spoke last, or nobody did).
 * The composer sets a timer for this instant; {@link detectActiveEvents} says
 * whether it has passed.
 */
export function idleDueAt(turns: readonly EventTurn[], idleSeconds: number): number | null {
  const lastIndex = lastIndexWhere(turns, isVisibleMessage);
  if (lastIndex < 0) return null;
  const last = turns[lastIndex]!;
  if (last.author_type !== 'agent') return null;
  const at = Date.parse(last.created_at);
  return Number.isNaN(at) ? null : at + idleSeconds * 1000;
}

/** The events that are active right now, in the order they are offered. */
export function detectActiveEvents(input: DetectInput): ActiveSuggestEvent[] {
  if (!input.active || input.agentId === null) return [];
  const { turns } = input;
  const active = new Map<SuggestEvent, string>();

  const lastAgentIndex = lastIndexWhere(turns, isHumanAgentMessage);

  // chat_started: the player wrote, and no person has answered yet. A player
  // who has not written has nothing to be answered; a bot's greeting does not
  // count as an agent having started.
  const firstCustomer = turns.find(
    (turn) => isVisibleMessage(turn) && turn.author_type === 'customer',
  );
  if (lastAgentIndex < 0 && firstCustomer) {
    active.set('chat_started', `started:${firstCustomer.id}`);
  }

  // chat_transferred: the newest hand-over line is to this agent — by name, or to
  // their team and the connection is theirs — and nobody has written since.
  const transferIndex = lastIndexWhere(turns, (turn) => transferTarget(turn) !== null);
  if (transferIndex >= 0 && lastAgentIndex < transferIndex) {
    const transfer = turns[transferIndex]!;
    const target = transferTarget(transfer)!;
    const toMe =
      target.agentId !== null
        ? target.agentId === input.agentId
        : input.assigneeId === input.agentId;
    if (toMe) active.set('chat_transferred', `transferred:${transfer.id}`);
  }

  // customer_idle: the agent spoke last and the player has been quiet long enough.
  const due = idleDueAt(turns, input.idleSeconds);
  if (due !== null && input.now >= due) {
    const lastVisible = turns[lastIndexWhere(turns, isVisibleMessage)]!;
    active.set('customer_idle', `idle:${lastVisible.id}`);
  }

  if (input.rating) {
    active.set(input.rating.value === 'good' ? 'rated_good' : 'rated_bad', input.rating.key);
  }

  return EVENT_PRIORITY.filter((event) => active.has(event)).map((event) => ({
    event,
    key: active.get(event)!,
  }));
}

/** A saved reply as this module reads it. */
export interface EventReply {
  id: string;
  shortcut: string;
  text: string;
  suggest_on?: readonly SuggestEvent[];
  suggest_order?: number;
  category?: CannedCategory;
}

/** A reply chosen for an active event. */
export interface EventPick {
  reply: EventReply;
  event: ActiveSuggestEvent;
}

/**
 * The replies to offer for the active events: those bound to an active event,
 * the active events in their order, a reply's own `suggest_order` inside one
 * event, then its shortcut. A reply bound to two active events appears once
 * (under the first). A promotion reply is left out while the player is kept
 * from promotions (EN-01) — the one place a suggestion must be silent however
 * the workspace bound it. At most `limit` (four) are returned.
 */
export function pickEventReplies(
  replies: readonly EventReply[],
  active: readonly ActiveSuggestEvent[],
  options: { promoSuppressed: boolean; limit?: number },
): EventPick[] {
  const limit = options.limit ?? EVENT_SUGGESTION_MAX_CHIPS;
  const picks: EventPick[] = [];
  const taken = new Set<string>();
  for (const event of active) {
    const bound = replies
      .filter(
        (reply) =>
          (reply.suggest_on ?? []).includes(event.event) &&
          !taken.has(reply.id) &&
          !(options.promoSuppressed && reply.category === 'promotion'),
      )
      .sort(
        (a, b) =>
          (a.suggest_order ?? 0) - (b.suggest_order ?? 0) || a.shortcut.localeCompare(b.shortcut),
      );
    for (const reply of bound) {
      if (picks.length >= limit) return picks;
      taken.add(reply.id);
      picks.push({ reply, event });
    }
  }
  return picks;
}
