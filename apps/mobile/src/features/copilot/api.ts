/**
 * The two requests the Copilot screen makes, kept apart the same way
 * `features/reports/api.ts` is: path literals live here, not in the
 * component, so a screen — and a test of one — can hand in a plain object
 * instead of a real session and a real fetch.
 *
 * Only the two assists KAPSAM names — summary and reply — are wired.
 * `/copilot/chats/{chatId}/enhance` and `/copilot/bi` are the console's
 * (13.7-i KAPSAM excludes them); `/copilot/knowledge*` is skill/knowledge
 * management, explicitly out of scope for mobile.
 */
import type { SessionApiClient } from '../../api/client';
import type { CopilotReplyDraft, CopilotSummary } from './types';

export interface CopilotApi {
  summarise(chatId: string, signal?: AbortSignal): Promise<CopilotSummary>;
  draftReply(chatId: string, signal?: AbortSignal): Promise<CopilotReplyDraft>;
}

export function createCopilotApi(client: SessionApiClient): CopilotApi {
  return {
    summarise(chatId, signal) {
      return client.request('post', '/copilot/chats/{chatId}/summary', {
        params: { chatId },
        ...(signal ? { signal } : {}),
      });
    },

    draftReply(chatId, signal) {
      return client.request('post', '/copilot/chats/{chatId}/reply', {
        params: { chatId },
        ...(signal ? { signal } : {}),
      });
    },
  };
}
