/**
 * What the panel remembers about event-bound suggested replies (IN-07 · tm 364).
 *
 * Two small facts, kept out of the React Query cache for the reason the typing
 * and Copilot-draft stores are: they are not facts about the conversation but
 * about this tab's session.
 *
 *   - `used`   the occurrences of an event (`ActiveSuggestEvent.key`) whose chips
 *              have been shown and left behind — picked, dismissed, typed over, or
 *              scrolled out of by opening another chat. An event is offered once,
 *              and a dismissed chip does not come back.
 *   - `rated`  the chats a `chat_rated` push arrived for. The push carries no
 *              value (whether this caller may see the vote is the server's call),
 *              so it only says "look again"; the composer reads the value from the
 *              re-read chat.
 */
import { create } from 'zustand';

interface EventSuggestionState {
  used: Record<string, true>;
  rated: Record<string, true>;
  /** These occurrences are done with. */
  consume: (keys: readonly string[]) => void;
  /** The player rated a connection of this chat. */
  markRated: (chatId: string) => void;
}

export const useEventSuggestionStore = create<EventSuggestionState>((set) => ({
  used: {},
  rated: {},
  consume: (keys) =>
    set((state) => {
      const fresh = keys.filter((key) => !state.used[key]);
      if (fresh.length === 0) return state;
      const used = { ...state.used };
      for (const key of fresh) used[key] = true;
      return { used };
    }),
  markRated: (chatId) =>
    set((state) => (state.rated[chatId] ? state : { rated: { ...state.rated, [chatId]: true } })),
}));
