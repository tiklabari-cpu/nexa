/**
 * Work a visitor's message sets off that their response must not wait for
 * (tm 256.10).
 *
 * A message from the widget is answered — by a rule bot or the AI Agent — and
 * its assignee is told about it. All of that used to run inside the visitor's
 * own request, so the send waited out the model: embedding up to
 * `EMBEDDING_TIMEOUT_MS` (10 s) plus completion up to `LLM_TIMEOUT_MS` (20 s),
 * with the widget's send button locked for the whole of it. The message is
 * committed before any of that starts, so nothing in the response depends on
 * it; it is the conversation that does.
 *
 * Three properties this keeps that a plain fire-and-forget would lose:
 *
 * - **Order, per chat.** Jobs under one key run one at a time, in the order
 *   they were handed in. The held request used to give this for free — the
 *   widget cannot send again until its send returns — and without it a second
 *   message could be answered before the first, or a rule's transfer could
 *   land under an AI reply still being written for the message before it.
 *   Different chats do not wait for each other.
 * - **A bound.** The held request was also the backpressure: one visitor, one
 *   model call at a time. A key holding {@link FollowUps.maxPerKey} jobs
 *   refuses the next one, and the caller leaves that message for a human —
 *   the outcome every other failure on this path already has. A person typing
 *   cannot reach the bound while one answer is being written; a script can.
 * - **A drain.** The in-flight set is tracked, so a graceful shutdown waits
 *   for it ({@link FollowUps.settled}, wired to `onClose` before the stores
 *   close) instead of dropping an answer the visitor was already told is
 *   coming, and a test can wait for "what that message set off".
 *
 * Not durable, on purpose and like `BackgroundMail`: a process that dies with
 * a job queued loses it. The message itself is committed, and the
 * conversation is left as it would be with no automation at all — unanswered,
 * in the inbox, for a human. A job is never retried, so nothing here can
 * answer a message twice.
 */

/** Jobs one key may hold — the running one included — before the next is refused. */
export const MAX_FOLLOW_UPS_PER_KEY = 20;

export class FollowUps {
  readonly maxPerKey: number;
  readonly #onError: (error: unknown, key: string) => void;
  /** The last job handed in per key — what the next one for that key waits on. */
  readonly #tails = new Map<string, Promise<void>>();
  /** Jobs per key not yet finished, the running one included. */
  readonly #depth = new Map<string, number>();
  readonly #pending = new Set<Promise<void>>();

  constructor(options: {
    /** A job that threw. Jobs are expected to handle their own failures; this is the backstop. */
    onError: (error: unknown, key: string) => void;
    maxPerKey?: number;
  }) {
    this.#onError = options.onError;
    this.maxPerKey = options.maxPerKey ?? MAX_FOLLOW_UPS_PER_KEY;
  }

  /**
   * Run `job` after every job already handed in under `key` has finished, and
   * never before a later turn of the event loop — the caller's response is
   * written first. Returns false, and runs nothing, when `key` already holds
   * {@link maxPerKey} jobs.
   */
  enqueue(key: string, job: () => Promise<void>): boolean {
    const depth = this.#depth.get(key) ?? 0;
    if (depth >= this.maxPerKey) return false;
    this.#depth.set(key, depth + 1);

    const previous = this.#tails.get(key) ?? Promise.resolve();
    const run: Promise<void> = previous
      .then(() => new Promise<void>((resolve) => setImmediate(resolve)))
      .then(job)
      .catch((error: unknown) => {
        try {
          this.#onError(error, key);
        } catch {
          // A logging failure must not become an unhandled rejection, nor
          // stop the next job for this key from running.
        }
      })
      .finally(() => {
        this.#pending.delete(run);
        const left = (this.#depth.get(key) ?? 1) - 1;
        if (left > 0) this.#depth.set(key, left);
        else this.#depth.delete(key);
        // Only when nothing was queued behind it: a later job's tail is the
        // one the next caller must wait on.
        if (this.#tails.get(key) === run) this.#tails.delete(key);
      });
    this.#tails.set(key, run);
    this.#pending.add(run);
    return true;
  }

  /** Jobs handed in and not yet finished, across every key. */
  get size(): number {
    return this.#pending.size;
  }

  /** Resolves once every job handed in so far — and any handed in meanwhile — has finished. */
  async settled(): Promise<void> {
    while (this.#pending.size > 0) {
      await Promise.all([...this.#pending]);
    }
  }
}
