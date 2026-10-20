/**
 * The hand-over card's reads and its one write (tm 304.2 · AI-10).
 *
 * The Details panel draws the newest card from the chat itself
 * (`latest_ai_handoff`, no second request); a transcript line asks for the
 * day's cards, since an earlier connection's card is not the newest. A new
 * card — the AI handing over while the agent watches — arrives as
 * `ai_handoff_created` (`useInbox.ts`), which re-reads both.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AiHandoffCardView, AiHandoffFeedback } from '@siyahtus/types';
import { useApiClient } from '../../lib/auth-store.js';
import {
  chatAiHandoffsKey,
  withJudgedCard,
  withJudgedCardInPage,
  type AiHandoffPage,
} from './handoffCard.js';
import type { ChatDetail } from './types.js';

/** `GET /chats/{chatId}/ai-handoffs`: every card the AI wrote in the chat's day. */
export function useChatAiHandoffs(chatId: string) {
  const api = useApiClient();
  return useQuery({
    queryKey: chatAiHandoffsKey(chatId),
    queryFn: () => api.get<AiHandoffPage>(`/chats/${chatId}/ai-handoffs`),
    staleTime: 30_000,
  });
}

/**
 * `POST /ai-handoffs/{handoffId}/feedback`: the agent's verdict on a card
 * (AI-10-S2, optional). The server keeps one per card, the last click's, and
 * answers with the card — which replaces it wherever the console holds it.
 */
export function useAiHandoffFeedback(chatId: string) {
  const api = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { handoffId: string; value: AiHandoffFeedback; reason?: string }) =>
      api.post<AiHandoffCardView>(`/ai-handoffs/${input.handoffId}/feedback`, {
        value: input.value,
        ...(input.reason ? { reason: input.reason } : {}),
      }),
    onSuccess: (card) => {
      queryClient.setQueryData<ChatDetail>(['chat', chatId], (chat) => withJudgedCard(chat, card));
      queryClient.setQueryData<AiHandoffPage>(chatAiHandoffsKey(chatId), (page) =>
        withJudgedCardInPage(page, card),
      );
    },
  });
}
