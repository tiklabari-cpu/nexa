/**
 * Which conversation, if any, gets credited with a sale (FR-MOD-13.5).
 *
 * Split out as a pure function for the reason `goal-matching.ts` and
 * `spam-filter.ts` are: this rule decides what the Ecommerce report claims a
 * workspace's chat is worth, and a rule that decides money has to be pinnable
 * by a unit test rather than inferred from a query plan. The service around it
 * reads the chats, reads the window and hands the clock in; the decision itself
 * touches nothing.
 *
 * The rule, in full: credit the visitor's most recent conversation that started
 * (or was last picked up) no earlier than `windowDays` before the sale and no
 * later than the sale itself. If there is none, the sale is still recorded —
 * with `attributed: false` — because a shop's total revenue is a fact whether
 * or not chat had anything to do with it, and quietly dropping the orders chat
 * did not influence would make the attributed share look like 100%.
 *
 * Two deliberate exclusions:
 *
 *  - **Nothing after the sale.** A conversation that began *after* the order
 *    cannot have produced it. In normal operation the clock makes this
 *    impossible, but the sale's timestamp is the ingest time and a chat's is
 *    the database's, so a little skew between them is expected — and a support
 *    conversation opened seconds after checkout ("where is my receipt?") is
 *    exactly the case that would otherwise be miscredited as having caused it.
 *
 *  - **Nothing outside the window.** Past the workspace's configured window the
 *    causal claim is not one the report can honestly make. Some sales therefore
 *    end up unattributed on purpose; that is the honest answer, not a gap.
 */

/** A conversation the sale could be credited to. */
export interface AttributionCandidate {
  readonly chatId: string;
  /**
   * When the visitor was last in this conversation.
   *
   * The *later* of the chat's creation and its most recent thread, not the
   * creation alone. In Nexa a returning visitor reopens a thread on an existing
   * chat, so `chats.created_at` can be months old for someone who chatted this
   * morning — attributing on creation would systematically fail to credit the
   * most engaged visitors, which are precisely the ones the report exists to
   * find.
   */
  readonly at: Date;
}

export interface AttributionInput {
  /** The visitor's conversations. Order does not matter — the rule sorts. */
  readonly chats: readonly AttributionCandidate[];
  /** When the sale happened. */
  readonly now: Date;
  /** The workspace's `attribution_window_days`. */
  readonly windowDays: number;
}

export interface Attribution {
  /** The credited conversation, or null when nothing qualifies. */
  readonly chatId: string | null;
  /** Always `chatId !== null` — named separately because it is what the report groups by. */
  readonly attributed: boolean;
}

const UNATTRIBUTED: Attribution = { chatId: null, attributed: false };

const DAY_MS = 86_400_000;

/**
 * Pick the conversation a sale belongs to.
 *
 * The window's far edge is inclusive: a chat exactly `windowDays` old is inside
 * it. A boundary has to fall one way or the other, and this way the setting
 * reads as the workspace wrote it — "7 days" credits a sale seven days later,
 * rather than mysteriously missing it by a millisecond.
 *
 * Ties (two conversations with the same timestamp, which a fixture or a
 * same-transaction pair can produce) resolve on `chatId` descending, so the
 * answer is a function of the input and not of the order rows came back in.
 */
export function resolveAttribution(input: AttributionInput): Attribution {
  const { chats, now, windowDays } = input;

  const saleAt = now.getTime();
  // A non-finite window (a hand-edited row, a NaN that survived a cast) must not
  // widen attribution to everything; it credits nothing, like a zero window.
  if (!Number.isFinite(windowDays) || windowDays <= 0 || !Number.isFinite(saleAt)) {
    return UNATTRIBUTED;
  }

  const cutoff = saleAt - windowDays * DAY_MS;

  let best: AttributionCandidate | null = null;
  let bestAt = 0;

  for (const candidate of chats) {
    const at = candidate.at.getTime();
    if (!Number.isFinite(at)) continue;
    if (at > saleAt || at < cutoff) continue;

    if (best === null || at > bestAt || (at === bestAt && candidate.chatId > best.chatId)) {
      best = candidate;
      bestAt = at;
    }
  }

  return best ? { chatId: best.chatId, attributed: true } : UNATTRIBUTED;
}
