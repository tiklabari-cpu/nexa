/**
 * Sends the server refused, held until the agent decides what to do with them
 * (FR-MOD-02.3.3 · FR-MOD-02.3.6, "hata retry").
 *
 * Before this existed, a refused send lost the message twice over: the composer
 * had already cleared the text, and `optimisticCacheUpdate.onError` rolled the
 * transcript back to what it held before the guess — so the words the agent
 * typed were gone from both places, with no notice and nothing to press. This
 * store is where they go instead.
 *
 * **Keyed by the idempotency key, not by position.** That key is the message's
 * identity for the whole round trip: it is what the retry replays, what the
 * server deduplicates on, and therefore what says "this failure and that
 * failure are the same message". Recording the same key twice — a retry that
 * failed again — updates the entry in place rather than growing a second row
 * for one message.
 *
 * Kept out of the React Query cache deliberately, and not for the reason
 * `typing.ts` gives. A failed send *is* a fact about the conversation, but it is
 * a fact the server does not have: `onSettled` refetches the transcript after
 * every attempt, and anything living in that cache is replaced by the server's
 * answer within the second. A row that must outlive the refetch cannot live
 * there.
 */
import { create } from 'zustand';
import { ApiClientError, errorMessageKey } from '../../lib/api-client.js';
import type { SendInput } from './types.js';

export interface FailedSend {
  /** Everything needed to send it again, unchanged — the key included. */
  input: SendInput;
  /**
   * Whether trying again can plausibly succeed.
   *
   * `ApiClientError.isRetryable` already draws this line for the whole console
   * (network/5xx/timeout/429 yes, anything we caused no); a second definition
   * here would be one more place for the two to disagree.
   */
  retryable: boolean;
  /** The `common.errors.*` key naming the refusal, resolved through `t()`. */
  errorKey: string;
  failedAt: string;
}

interface FailedSendState {
  /** Per chat id — only chats holding a refused message are present. */
  byChat: Record<string, FailedSend[]>;
  /** A send came back refused; hold it, in the order the attempts were made. */
  record: (chatId: string, input: SendInput, error: unknown) => void;
  /** Drop one message — it went through, or another attempt is now in flight. */
  clear: (chatId: string, idempotencyKey: string) => void;
}

/**
 * One shared empty array for chats with nothing failed.
 *
 * A fresh `[]` per read would be a new identity every render, and the selector
 * below feeds `useSyncExternalStore` — which would then never see the state as
 * unchanged.
 */
const NONE: readonly FailedSend[] = [];

export const useFailedSendStore = create<FailedSendState>((set) => ({
  byChat: {},

  record: (chatId, input, error) =>
    set((state) => {
      const entry: FailedSend = {
        input,
        retryable: error instanceof ApiClientError ? error.isRetryable : false,
        errorKey: errorMessageKey(error),
        failedAt: new Date().toISOString(),
      };
      const current = state.byChat[chatId] ?? [];
      const at = current.findIndex((held) => held.input.idempotencyKey === input.idempotencyKey);
      const next =
        at === -1
          ? [...current, entry]
          : // In place: a retry that failed again is the same message, and it
            // should not jump to the bottom of the transcript on every attempt.
            current.map((held, index) => (index === at ? entry : held));
      return { byChat: { ...state.byChat, [chatId]: next } };
    }),

  clear: (chatId, idempotencyKey) =>
    set((state) => {
      const current = state.byChat[chatId];
      if (!current) return state;
      const next = current.filter((held) => held.input.idempotencyKey !== idempotencyKey);
      if (next.length === current.length) return state;
      const byChat = { ...state.byChat };
      if (next.length === 0) delete byChat[chatId];
      else byChat[chatId] = next;
      return { byChat };
    }),
}));

/** The refused messages waiting in one conversation, oldest attempt first. */
export function useFailedSends(chatId: string | null): readonly FailedSend[] {
  return useFailedSendStore((state) => (chatId ? (state.byChat[chatId] ?? NONE) : NONE));
}
