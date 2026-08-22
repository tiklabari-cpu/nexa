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
import { ROUTING_STATUSES } from '@nexa/types';
import { RtmClient, type PushHandler, type RtmStatus } from '../../lib/realtime.js';
import { useApiClient, useAuth } from '../../lib/auth-store.js';
import { optimisticCacheUpdate } from '../../lib/optimistic.js';
import { useTypingStore } from './typing.js';
import { useConflictStore, type ConflictAgent } from './conflict.js';
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

/**
 * Read receipt for the open chat (FR-MOD-02.2.2): the newest visible event's
 * timestamp, debounced 1s, becomes `POST /chats/{chatId}/seen`'s `seen_up_to`.
 * The unread badge itself already comes straight from the server
 * (`ChatSummary.unread_count`, derived from this same marker) — the only gap
 * this closes is that nothing ever wrote the marker, so it never moved.
 *
 * `chatId`/`seenUpTo` should be `null` whenever the chat is not actually on
 * screen (no selection, or another pane — e.g. Tickets — covers it): a chat
 * that keeps fetching in the background must not get silently marked "seen".
 */
export function useMarkSeen(chatId: string | null, seenUpTo: string | null): void {
  const api = useApiClient();
  const queryClient = useQueryClient();
  const apiRef = useRef(api);
  apiRef.current = api;

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = useRef<{ chatId: string; seenUpTo: string } | null>(null);

  // Stable across renders — both effects below reach it through refs, not
  // through their own dependency arrays, so a chat switch and an unmount can
  // both flush the exact same in-flight target without duplicating the call.
  const flushRef = useRef<() => void>(() => {});
  flushRef.current = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const target = pendingRef.current;
    if (!target) return;
    pendingRef.current = null;
    void apiRef.current
      .post(`/chats/${target.chatId}/seen`, { seen_up_to: target.seenUpTo })
      .then(() => {
        // Live badge update, not just a reload-survives-it guarantee — the row
        // for this chat reads `unread_count` straight from the list query.
        void queryClient.invalidateQueries({ queryKey: ['chats'] });
      })
      .catch(() => {
        // Best-effort: a dropped request just means the badge clears on the
        // next successful heartbeat instead — nothing here worth surfacing.
      });
  };

  useEffect(() => {
    // Switching chats (or losing the open one) sends whatever was still
    // debouncing for the PREVIOUS chat now, instead of dropping it.
    if (pendingRef.current && pendingRef.current.chatId !== chatId) flushRef.current();

    if (!chatId || !seenUpTo) return;

    pendingRef.current = { chatId, seenUpTo };
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => flushRef.current(), 1_000);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [chatId, seenUpTo]);

  useEffect(() => () => flushRef.current(), []);
}

type SendInput = { text: string; recipients: 'all' | 'agents'; attachmentUrl?: string };

export function useSendMessage(chatId: string | null) {
  const api = useApiClient();
  const queryClient = useQueryClient();
  const agent = useAuth((s) => s.agent);

  // The optimistic transcript update, through the one shared helper every other
  // optimistic mutation uses: append the pending message now, roll the whole
  // list back if the send fails, reconcile with the server once settled
  // (FR-EK-A.2). The chat list shows last-message and time, so it settles too.
  const optimistic = optimisticCacheUpdate<{ items: ChatEvent[] }, SendInput>({
    queryClient,
    queryKey: eventsKey(chatId ?? ''),
    update: (current, input) => ({
      items: [
        ...(current?.items ?? []),
        {
          // An agent who sees nothing happen presses enter again — show the
          // message immediately, marked pending until the server confirms it.
          id: `pending-${Date.now()}`,
          chat_id: chatId ?? '',
          thread_id: '',
          type: 'message',
          text: input.text,
          author_id: agent?.account_id ?? null,
          author_type: 'agent',
          recipients: input.recipients,
          attachment_url: input.attachmentUrl ?? null,
          properties: { pending: true },
          created_at: new Date().toISOString(),
        },
      ],
    }),
    invalidateKeys: [['chats']],
  });

  return useMutation({
    mutationFn: (input: SendInput) =>
      api.post<ChatEvent>(`/chats/${chatId}/events`, {
        type: 'message',
        text: input.text,
        recipients: input.recipients,
        ...(input.attachmentUrl ? { attachment_url: input.attachmentUrl } : {}),
        // Survives a retry after a timeout without sending twice.
        idempotency_key: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      }),
    // No open chat means no transcript to touch; skip straight to the request.
    onMutate: (input) =>
      chatId ? optimistic.onMutate(input) : Promise.resolve({ previous: undefined }),
    onError: optimistic.onError,
    onSettled: optimistic.onSettled,
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
    // Supervisor seizure (FR-MOD-08.6.3) — role-gated at the route; this mutation
    // just calls it. A losing race surfaces as `takeover_conflict` (409) on
    // `.error`, left for the caller to render rather than swallowed here.
    takeover: useMutation({
      mutationFn: (reason?: string) =>
        api.post(`/chats/${chatId}/takeover`, reason ? { reason } : undefined),
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
export function useRealtime(onPush?: PushHandler): RtmStatus {
  const queryClient = useQueryClient();
  const accessToken = useAuth((s) => s.accessToken);
  const organizationId = useAuth((s) => s.agent?.organization_id);
  const [status, setStatus] = useState<RtmStatus>('offline');
  const clientRef = useRef<RtmClient | null>(null);

  // Held in a ref so a new callback identity each render does not tear down and
  // rebuild the socket — the connection outlives any one render.
  const onPushRef = useRef(onPush);
  onPushRef.current = onPush;

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
        'incoming_typing_indicator',
        'incoming_sneak_peek',
        'agent_conflict_warning',
      ],
      onStatusChange: setStatus,
      onPush: (action, payload) => {
        applyPush(queryClient, action, payload);
        onPushRef.current?.(action, payload);
      },
    });

    clientRef.current = client;
    // The composer sends the agent's own typing through this; wired here because
    // the socket outlives any one component that wants to emit.
    useTypingStore.getState().setEmitter((chatId, isTyping) => client.sendTyping(chatId, isTyping));
    client.connect();
    return () => {
      useTypingStore.getState().setEmitter(() => {});
      client.disconnect();
    };
  }, [accessToken, organizationId, queryClient]);

  return status;
}

/** Exported for `useInbox.test.ts` — a push handler has no other way in. */
export function applyPush(
  queryClient: QueryClient,
  action: string,
  payload: Record<string, unknown>,
): void {
  switch (action) {
    case 'incoming_event': {
      const chatId = payload['chat_id'];
      const event = payload['event'] as ChatEvent | undefined;
      if (typeof chatId !== 'string' || !event) return;

      // A message from the visitor is the end of the draft it was previewing —
      // drop the sneak-peek so the real message is not shadowed by a stale one.
      if (event.author_type === 'customer') useTypingStore.getState().clear(chatId);

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

    case 'incoming_typing_indicator': {
      // The visitor's on/off state (FR-MOD-02.9). Agent-authored indicators are
      // the agent's own reflection; only a visitor's is worth showing here.
      const chatId = payload['chat_id'];
      const indicator = payload['typing_indicator'] as
        { is_typing?: unknown; author_type?: unknown } | undefined;
      if (typeof chatId !== 'string' || !indicator) return;
      if (indicator.author_type !== 'customer') return;
      useTypingStore.getState().noteCustomer(chatId, indicator.is_typing === true, null);
      return;
    }

    case 'incoming_sneak_peek': {
      // A preview of the visitor's in-progress message (FR-MOD-11.8).
      const chatId = payload['chat_id'];
      const peek = payload['sneak_peek'] as { text?: unknown; author_type?: unknown } | undefined;
      if (typeof chatId !== 'string' || !peek) return;
      if (peek.author_type !== 'customer') return;
      useTypingStore
        .getState()
        .noteCustomer(chatId, true, typeof peek.text === 'string' ? peek.text : null);
      return;
    }

    case 'agent_conflict_warning': {
      // Two or more agents composing a reply at once (FR-MOD-08.6.3). Same
      // pattern as `incoming_typing_indicator`: validate the payload, then
      // hand it to the store — no query cache involved.
      const chatId = payload['chat_id'];
      const rawAgents = payload['agents'];
      const detectedAt = payload['detected_at'];
      if (
        typeof chatId !== 'string' ||
        !Array.isArray(rawAgents) ||
        typeof detectedAt !== 'string'
      ) {
        return;
      }
      const agents: ConflictAgent[] = [];
      for (const entry of rawAgents) {
        const record = entry as Record<string, unknown> | null;
        const agentId = record?.['agent_id'];
        const since = record?.['since'];
        // One malformed member makes the whole warning untrustworthy — drop it
        // rather than show a conflict with a blank agent in it.
        if (typeof agentId !== 'string' || typeof since !== 'string') return;
        agents.push({ agentId, since });
      }
      useConflictStore.getState().note(chatId, agents, detectedAt);
      return;
    }

    case 'routing_status_set': {
      // Presence (FR-MOD-01.1.4). This action has been subscribed to since the
      // socket existed and until now landed in `default:` — nothing consumed
      // it. The shell's avatar group reads the licence roster from the shared
      // `['agents']` key, so folding the push into that cache is the whole of
      // what makes presence live; no new RTM action was opened for it.
      //
      // Written in place rather than invalidated: the push already carries the
      // new value, and a refetch would spend a request to learn what it just
      // said — on every teammate's screen, every time anyone flips their
      // availability.
      const agentId = payload['agent_id'];
      const status = payload['status'];
      if (typeof agentId !== 'string' || typeof status !== 'string') return;
      if (!(ROUTING_STATUSES as readonly string[]).includes(status)) return;

      queryClient.setQueryData<{ items: Array<{ id: string; routing_status: string }> }>(
        ['agents'],
        (current) =>
          current && {
            items: current.items.map((agent) =>
              agent.id === agentId ? { ...agent, routing_status: status } : agent,
            ),
          },
      );
      return;
    }

    case 'chat_deactivated':
      // A closed conversation cannot still be "typing" — or conflicted.
      if (typeof payload['chat_id'] === 'string') {
        useTypingStore.getState().clear(payload['chat_id']);
        useConflictStore.getState().clear(payload['chat_id']);
      }
      void queryClient.invalidateQueries({ queryKey: ['chats'] });
      return;

    case 'incoming_chat':
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
  // The AI Agents group (PRD 02.1.2): AI-handled conversations, kept out of the
  // human queue, and the AI resolutions ("Solved") counter.
  const ai = useChatList('ai');
  const aiSolved = useChatList('ai_solved');

  return useMemo(
    () => ({
      all: all.data?.items.length,
      my: mine.data?.items.length,
      queued: queued.data?.items.length,
      unassigned: unassigned.data?.items.length,
      archived: archived.data?.items.length,
      ai: ai.data?.items.length,
      ai_solved: aiSolved.data?.items.length,
    }),
    [all.data, mine.data, queued.data, unassigned.data, archived.data, ai.data, aiSolved.data],
  );
}

/** One connected channel, as the `/channels` list reports it (FR-MOD-08.5.4-.6). */
export interface ConnectedChannel {
  type: string;
  status: string;
  address: string | null;
  connected: boolean;
  created_at: string;
}

/**
 * The workspace's connected channels, for the inbox Views group (FR-MOD-02.1.4).
 * Gated on `enabled`: only owners/admins hold the `channels--all` scope, so the
 * inbox passes `false` for an ordinary agent and the request never fires (it
 * would only 403). Channel connections change rarely, so this is cached longer
 * than the live chat lists.
 */
export function useConnectedChannels(enabled: boolean) {
  const api = useApiClient();
  return useQuery({
    queryKey: ['channels'],
    queryFn: () => api.get<{ items: ConnectedChannel[] }>('/channels'),
    enabled,
    staleTime: 60_000,
  });
}
