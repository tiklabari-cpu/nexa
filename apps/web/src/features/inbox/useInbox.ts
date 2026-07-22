/**
 * Inbox data: the chat list, the open transcript, and the live updates that
 * keep both current.
 *
 * The realtime layer feeds the same React Query cache the fetches write to, so
 * a pushed message and a fetched one are indistinguishable downstream. The
 * alternative — a parallel "live events" list merged at render time — is where
 * duplicate and out-of-order messages come from.
 */
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { RtmClient, type RtmStatus } from '../../lib/realtime.js';
import { useApiClient, useAuth } from '../../lib/auth-store.js';
import type { ChatDetail, ChatEvent, ChatSummary, InboxView } from './types.js';

const RTM_URL = import.meta.env['VITE_RTM_URL'] ?? 'ws://localhost:4001/v1/agent/rtm/ws';

export function chatsKey(view: InboxView): unknown[] {
  return ['chats', view];
}
export function eventsKey(chatId: string): unknown[] {
  return ['events', chatId];
}

export function useChatList(view: InboxView) {
  const api = useApiClient();
  return useQuery({
    queryKey: chatsKey(view),
    queryFn: () => api.get<{ items: ChatSummary[] }>(`/chats?view=${view}&limit=50`),
    // Realtime keeps this fresh; the interval is a safety net for a socket that
    // is down without having noticed yet.
    refetchInterval: 30_000,
  });
}

export function useChat(chatId: string | null) {
  const api = useApiClient();
  return useQuery({
    queryKey: ['chat', chatId],
    queryFn: () => api.get<ChatDetail>(`/chats/${chatId}`),
    enabled: chatId !== null,
  });
}

export function useTranscript(chatId: string | null) {
  const api = useApiClient();
  return useQuery({
    queryKey: eventsKey(chatId ?? ''),
    queryFn: () => api.get<{ items: ChatEvent[] }>(`/chats/${chatId}/events?limit=200`),
    enabled: chatId !== null,
  });
}

export function useSendMessage(chatId: string | null) {
  const api = useApiClient();
  const queryClient = useQueryClient();
  const agent = useAuth((s) => s.agent);

  return useMutation({
    mutationFn: (input: { text: string; recipients: 'all' | 'agents' }) =>
      api.post<ChatEvent>(`/chats/${chatId}/events`, {
        type: 'message',
        text: input.text,
        recipients: input.recipients,
        // Survives a retry after a timeout without sending twice.
        idempotency_key: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      }),

    onMutate: async (input) => {
      if (!chatId) return;
      await queryClient.cancelQueries({ queryKey: eventsKey(chatId) });
      const previous = queryClient.getQueryData<{ items: ChatEvent[] }>(eventsKey(chatId));

      // Optimistic: an agent who sees nothing happen presses enter again.
      const optimistic: ChatEvent = {
        id: `pending-${Date.now()}`,
        chat_id: chatId,
        thread_id: '',
        type: 'message',
        text: input.text,
        author_id: agent?.account_id ?? null,
        author_type: 'agent',
        recipients: input.recipients,
        attachment_url: null,
        properties: { pending: true },
        created_at: new Date().toISOString(),
      };
      queryClient.setQueryData(eventsKey(chatId), {
        items: [...(previous?.items ?? []), optimistic],
      });
      return { previous };
    },

    onError: (_error, _input, context) => {
      // Put the transcript back rather than leaving a message that looks sent.
      if (chatId && context?.previous) {
        queryClient.setQueryData(eventsKey(chatId), context.previous);
      }
    },

    onSettled: () => {
      if (chatId) void queryClient.invalidateQueries({ queryKey: eventsKey(chatId) });
      void queryClient.invalidateQueries({ queryKey: ['chats'] });
    },
  });
}

export function useChatAction(chatId: string | null) {
  const api = useApiClient();
  const queryClient = useQueryClient();

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['chats'] });
    void queryClient.invalidateQueries({ queryKey: ['chat', chatId] });
    if (chatId) void queryClient.invalidateQueries({ queryKey: eventsKey(chatId) });
  };

  return {
    archive: useMutation({
      mutationFn: () => api.post(`/chats/${chatId}/deactivate`),
      onSuccess: invalidate,
    }),
    reopen: useMutation({
      mutationFn: () => api.post(`/chats/${chatId}/resume`),
      onSuccess: invalidate,
    }),
    tag: useMutation({
      mutationFn: (tag: string) => api.post(`/chats/${chatId}/tags`, { tag }),
      onSuccess: invalidate,
    }),
    untag: useMutation({
      mutationFn: (tag: string) => api.delete(`/chats/${chatId}/tags/${encodeURIComponent(tag)}`),
      onSuccess: invalidate,
    }),
  };
}

/**
 * Opens the realtime connection and folds pushes into the query cache.
 *
 * Kept in one place so there is a single definition of "a new event arrived",
 * whether it came from a push, a reconnect replay, or a refetch.
 */
export function useRealtime(): RtmStatus {
  const queryClient = useQueryClient();
  const accessToken = useAuth((s) => s.accessToken);
  const organizationId = useAuth((s) => s.agent?.organization_id);
  const [status, setStatus] = useState<RtmStatus>('offline');
  const clientRef = useRef<RtmClient | null>(null);

  useEffect(() => {
    if (!accessToken || !organizationId) return;

    const client = new RtmClient({
      url: RTM_URL,
      organizationId,
      getToken: () => accessToken,
      pushes: [
        'incoming_chat',
        'incoming_event',
        'chat_deactivated',
        'chat_transferred',
        'routing_status_set',
      ],
      onStatusChange: setStatus,
      onPush: (action, payload) => applyPush(queryClient, action, payload),
    });

    clientRef.current = client;
    client.connect();
    return () => client.disconnect();
  }, [accessToken, organizationId, queryClient]);

  return status;
}

function applyPush(
  queryClient: QueryClient,
  action: string,
  payload: Record<string, unknown>,
): void {
  switch (action) {
    case 'incoming_event': {
      const chatId = payload['chat_id'];
      const event = payload['event'] as ChatEvent | undefined;
      if (typeof chatId !== 'string' || !event) return;

      queryClient.setQueryData<{ items: ChatEvent[] }>(eventsKey(chatId), (current) => {
        if (!current) return current;
        // Deduplicate by id: a push and a refetch can both deliver the same
        // event, and the optimistic placeholder is replaced by its real one.
        if (current.items.some((e) => e.id === event.id)) return current;
        const withoutPending = current.items.filter(
          (e) => !(e.properties?.['pending'] === true && e.text === event.text),
        );
        return { items: [...withoutPending, event] };
      });

      void queryClient.invalidateQueries({ queryKey: ['chats'] });
      return;
    }

    case 'incoming_chat':
    case 'chat_deactivated':
    case 'chat_transferred':
    case 'chat_unfollowed':
    case 'chat_appeared':
      void queryClient.invalidateQueries({ queryKey: ['chats'] });
      return;

    case 'sync_truncated': {
      // The gap was too large to replay; refetch rather than showing a
      // transcript with an invisible hole in it.
      const chatId = payload['chat_id'];
      if (typeof chatId === 'string') {
        void queryClient.invalidateQueries({ queryKey: eventsKey(chatId) });
      }
      return;
    }

    default:
      return;
  }
}

/** Live per-view counts for the sidebar. */
export function useViewCounts(): Record<InboxView, number | undefined> {
  const all = useChatList('all');
  const mine = useChatList('my');
  const queued = useChatList('queued');
  const unassigned = useChatList('unassigned');
  const archived = useChatList('archived');

  return useMemo(
    () => ({
      all: all.data?.items.length,
      my: mine.data?.items.length,
      queued: queued.data?.items.length,
      unassigned: unassigned.data?.items.length,
      archived: archived.data?.items.length,
    }),
    [all.data, mine.data, queued.data, unassigned.data, archived.data],
  );
}
