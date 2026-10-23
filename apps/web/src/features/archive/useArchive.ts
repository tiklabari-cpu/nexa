/**
 * The Archive screen's reads (AR-01 · tm 335.2). Nothing here is live: a closed
 * conversation appears when the list is read again, so there is no push handler,
 * no poll, and the transcript of a past connection is read once and kept.
 */
import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  DEFAULT_DAY_BOUNDARY,
  hasAnyScope,
  type ArchiveConversation,
  type ArchiveConversationDetail,
  type DayBoundary,
} from '@siyahtus/types';
import type { ApiClientError } from '../../lib/api-client.js';
import { useApiClient, useAuth } from '../../lib/auth-store.js';
import { usePagedQuery, type PagedQueryResult } from '../../lib/paged-query.js';
import { flattenTranscriptPages } from '../inbox/useInbox.js';
import type { ChatEvent } from '../inbox/types.js';
import { filterParams, type ArchiveFilters } from './archive-filters.js';
import { archiveListUrl, archiveTranscriptUrl, type ArchiveScope } from './archive.js';

/** The list's cache namespace; a Reopen refreshes everything under it. */
const ARCHIVE_KEY = 'archive';

/** The list can say it counted up to a cap; `usePagedQuery` only carries the number. */
export interface ArchiveListResult extends PagedQueryResult<ArchiveConversation> {
  /** More than `total` rows exist — the count stopped at the server's cap. */
  totalCapped: boolean;
}

/**
 * Connections, newest end first, paged by the server's keyset cursor. The filters
 * are part of the cache key (as the address spells them), so a changed filter is a
 * new list rather than a refetch of the old one.
 */
export function useArchiveList(
  scope: ArchiveScope,
  filters: ArchiveFilters,
  enabled = true,
): ArchiveListResult {
  const list = usePagedQuery<ArchiveConversation>({
    queryKey: [ARCHIVE_KEY, 'list', scope, filterParams(filters).toString()],
    buildUrl: (pageId) => archiveListUrl(scope, pageId, filters),
    enabled,
  });
  const totalCapped = useMemo(
    () => list.pages.some((page) => (page as { total_capped?: boolean }).total_capped === true),
    [list.pages],
  );
  return { ...list, totalCapped };
}

/**
 * One connection in full. A 404 is an answer (gone, or never the caller's); the
 * app's retry policy already leaves a 4xx alone, so the screen says so at once.
 */
export function useArchiveDetail(threadId: string | null) {
  const api = useApiClient();
  return useQuery({
    queryKey: [ARCHIVE_KEY, 'detail', threadId],
    queryFn: () =>
      api.get<ArchiveConversationDetail>(`/archive/conversations/${encodeURIComponent(threadId!)}`),
    enabled: threadId !== null,
    staleTime: 60_000,
  });
}

/**
 * The messages of one connection, oldest first for reading. Closed connections
 * do not change under the reader, so the pages are kept for the session.
 */
export function useArchiveTranscript(chatId: string | null, threadId: string | null) {
  const query = usePagedQuery<ChatEvent>({
    queryKey: [ARCHIVE_KEY, 'transcript', chatId, threadId],
    buildUrl: (pageId) => archiveTranscriptUrl(chatId ?? '', threadId ?? '', pageId),
    enabled: chatId !== null && threadId !== null,
    staleTime: 5 * 60_000,
  });
  const events = useMemo(() => flattenTranscriptPages(query.pages), [query.pages]);
  return {
    events,
    hasOlder: query.hasNext,
    isLoadingOlder: query.isFetchingNext,
    loadOlder: query.fetchNext,
    isPending: query.isPending,
    isError: query.isError && query.pages.length === 0,
    error: query.error,
    refetch: query.refetch,
  };
}

/** Team names for the rows' team column; a caller who may not read teams gets none. */
export function useTeamNames(): ReadonlyMap<number, string> {
  const api = useApiClient();
  const teams = useQuery({
    queryKey: ['team', 'groups'],
    queryFn: () => api.get<{ items: Array<{ id: number; name: string }> }>('/groups'),
    staleTime: 60_000,
  });
  return useMemo(
    () => new Map((teams.data?.items ?? []).map((team) => [team.id, team.name])),
    [teams.data],
  );
}

/**
 * "Reopen": `POST /chats/{id}/resume` opens a new connection on the conversation
 * and leaves the archived one where it is. The answer is the chat to continue in —
 * today's, when the archived connection belongs to an earlier day.
 */
export function useReopenConnection() {
  const api = useApiClient();
  const queryClient = useQueryClient();
  return useMutation<{ id: string }, ApiClientError | Error, string>({
    mutationFn: (chatId) => api.post<{ id: string }>(`/chats/${encodeURIComponent(chatId)}/resume`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [ARCHIVE_KEY] });
      void queryClient.invalidateQueries({ queryKey: ['chats'] });
    },
  });
}

/** A teammate as `GET /agents` lists them. */
export interface RosterMember {
  id: string;
  name: string | null;
}

/** Teammates for the agent filter; same cache as the takeover dialog and the Team page. */
export function useAgentRoster(enabled: boolean) {
  const api = useApiClient();
  return useQuery({
    queryKey: ['team', 'agents'],
    queryFn: () => api.get<{ items: RosterMember[] }>('/agents'),
    staleTime: 60_000,
    enabled,
  });
}

/** The workspace tag library, with the ids the tag filter and the address carry. */
export function useTagLibrary() {
  const api = useApiClient();
  return useQuery({
    queryKey: ['tag-library'],
    queryFn: () => api.get<{ items: Array<{ id: string; name: string }> }>('/settings/tags'),
    staleTime: 60_000,
  });
}

/** Scopes under which `GET /settings/chat-timeout` — where the day boundary lives — is served. */
const DAY_BOUNDARY_SCOPES = ['access_rules:ro', 'access_rules:rw'] as const;

/**
 * The zone and start hour of the workspace's conversation day (ID-04), which the
 * date presets and "today" are counted in. The setting is served to those who may
 * read access rules; for anyone else — or while it loads — it is the shipped
 * default, so a date preset can sit a day off only for them, around the day's
 * edge. The server reads the real boundary for the range itself either way.
 */
export function useDayBoundary(): DayBoundary {
  const api = useApiClient();
  const scopes = useAuth((s) => s.agent?.scopes);
  const allowed = hasAnyScope(scopes ?? [], DAY_BOUNDARY_SCOPES);
  const settings = useQuery({
    queryKey: ['settings', 'chat-timeout'],
    queryFn: () =>
      api.get<{ day_boundary_timezone?: string; day_boundary_hour?: number }>(
        '/settings/chat-timeout',
      ),
    staleTime: 60_000,
    enabled: allowed,
  });
  const timezone = settings.data?.day_boundary_timezone;
  const hour = settings.data?.day_boundary_hour;
  return useMemo(
    () => ({
      timezone: timezone ?? DEFAULT_DAY_BOUNDARY.timezone,
      hour: hour ?? DEFAULT_DAY_BOUNDARY.hour,
    }),
    [timezone, hour],
  );
}
