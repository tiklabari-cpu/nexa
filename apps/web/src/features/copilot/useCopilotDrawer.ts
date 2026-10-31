/**
 * What the drawer can do: ask a question (`POST /copilot/ask`) and, beside an
 * open conversation, summarise it or draft a reply (the same two endpoints the
 * inbox panel uses).
 *
 * Every call writes its progress into the drawer store rather than a React
 * Query mutation: the answer has to outlive the component that asked, and the
 * drawer is a history, not a single result.
 */
import { useQueryClient } from '@tanstack/react-query';
import { useLocation } from 'react-router-dom';
import { isAiDailyCap } from '../../lib/api-client.js';
import { useApiClient } from '../../lib/auth-store.js';
import { useLocale } from '../../lib/i18n.js';
import type { CopilotReplyDraft, CopilotSummary } from '../inbox/useCopilot.js';
import { eventsKey } from '../inbox/useInbox.js';
import {
  useCopilotDrawerStore,
  type DrawerAnswerKind,
  type DrawerReason,
  type DrawerSource,
} from './copilotDrawerStore.js';

/** The contract's cap on one question (`copilotAsk`). */
export const ASK_MAX_CHARS = 2000;

export interface CopilotAskAnswer {
  answer: string;
  sources: DrawerSource[];
  kind: DrawerAnswerKind;
  reason?: DrawerReason;
}

function errorOf(error: unknown): 'ai_daily_cap' | 'failed' {
  return isAiDailyCap(error) ? 'ai_daily_cap' : 'failed';
}

export function useCopilotDrawerActions(): {
  ask: (question: string) => Promise<void>;
  summarise: () => Promise<void>;
  draft: () => Promise<void>;
} {
  const api = useApiClient();
  const queryClient = useQueryClient();
  const { locale } = useLocale();
  const { pathname } = useLocation();

  const ask = async (raw: string): Promise<void> => {
    const question = raw.trim();
    if (!question) return;
    const { chat, add, patch } = useCopilotDrawerStore.getState();
    const id = add({ kind: 'ask', question, status: 'pending', chatId: chat?.id ?? null });
    try {
      const answer = await api.post<CopilotAskAnswer>('/copilot/ask', {
        question,
        context: { route: pathname, ...(chat ? { chat_id: chat.id } : {}) },
      });
      patch(id, {
        status: 'done',
        answer: answer.answer,
        answerKind: answer.kind,
        sources: answer.sources,
        ...(answer.reason ? { reason: answer.reason } : {}),
      });
    } catch (error) {
      patch(id, { status: 'error', error: errorOf(error) });
    }
  };

  const summarise = async (): Promise<void> => {
    const { chat, add, patch } = useCopilotDrawerStore.getState();
    if (!chat) return;
    const id = add({ kind: 'summary', question: '', status: 'pending', chatId: chat.id });
    try {
      const result = await api.post<CopilotSummary>(`/copilot/chats/${chat.id}/summary`, {
        language: locale,
      });
      patch(id, {
        status: 'done',
        answer: result.summary,
        noteSaved: result.note_event_id !== null,
      });
      // The note is a new event on the chat — refresh the transcript so it shows.
      void queryClient.invalidateQueries({ queryKey: eventsKey(chat.id) });
      void queryClient.invalidateQueries({ queryKey: ['chats'] });
    } catch (error) {
      patch(id, { status: 'error', error: errorOf(error) });
    }
  };

  const draft = async (): Promise<void> => {
    const { chat, add, patch } = useCopilotDrawerStore.getState();
    if (!chat) return;
    const id = add({ kind: 'draft', question: '', status: 'pending', chatId: chat.id });
    try {
      const result = await api.post<CopilotReplyDraft>(`/copilot/chats/${chat.id}/reply`);
      if (result.draft) {
        patch(id, { status: 'done', answer: result.draft, sources: [] });
      } else if (result.reason === 'ai_daily_cap') {
        patch(id, { status: 'error', error: 'ai_daily_cap' });
      } else {
        // Nothing in the knowledge base matched: an answer with no words.
        patch(id, { status: 'done', answer: '', reason: 'no_answer' });
      }
    } catch (error) {
      patch(id, { status: 'error', error: errorOf(error) });
    }
  };

  return { ask, summarise, draft };
}
