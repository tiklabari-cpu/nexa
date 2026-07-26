/**
 * Copilot data: the three in-chat assists (FR-MOD-12.3).
 *
 * Each is a mutation, not a query — the agent asks for help, once, on demand.
 * The summary is the one with a side effect on the conversation: it lands as an
 * internal note, so its success invalidates the transcript the same way a sent
 * message does, and the note appears without a manual refresh.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useApiClient } from '../../lib/auth-store.js';
import { eventsKey } from './useInbox.js';

export interface CopilotSummary {
  summary: string;
  note_event_id: string;
}

export interface CopilotReplyDraft {
  draft: string;
  sources: Array<{ name: string; score: number }>;
}

export type EnhanceMode = 'rephrase' | 'friendly' | 'formal' | 'grammar';

export interface CopilotEnhanced {
  text: string;
  mode: EnhanceMode;
}

/** Summarise the conversation into an internal note (12.3 / 02.5). */
export function useCopilotSummary(chatId: string) {
  const api = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<CopilotSummary>(`/copilot/chats/${chatId}/summary`),
    onSuccess: () => {
      // The note is a new event on the chat — refresh the transcript so it shows.
      void queryClient.invalidateQueries({ queryKey: eventsKey(chatId) });
      void queryClient.invalidateQueries({ queryKey: ['chats'] });
    },
  });
}

/** Draft a reply from the copilot knowledge base (12.3). */
export function useCopilotReply(chatId: string) {
  const api = useApiClient();
  return useMutation({
    mutationFn: () => api.post<CopilotReplyDraft>(`/copilot/chats/${chatId}/reply`),
  });
}

/** Rewrite a draft in a chosen register (12.3). */
export function useCopilotEnhance(chatId: string) {
  const api = useApiClient();
  return useMutation({
    mutationFn: (input: { text: string; mode: EnhanceMode }) =>
      api.post<CopilotEnhanced>(`/copilot/chats/${chatId}/enhance`, input),
  });
}
