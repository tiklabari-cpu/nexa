/**
 * The workspace pages' reads and writes (tm 389.9 · FR-ADMIN-08; the actions tm 389.10 ·
 * FR-ADMIN-09). The list and the
 * notes page by keyset ("Load more" asks for the next cursor); every detail tab is its own
 * query, so a tab is fetched when it is opened and a slow one does not hold the others back.
 */
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from '@tanstack/react-query';
import { api } from '../../lib/auth-store.js';
import type {
  PlatformWorkspaceActionResult,
  PlatformWorkspaceOverridesEnvelope,
  PlatformWorkspacePurgeQueue,
  PlatformWorkspaceDetail,
  PlatformWorkspaceList,
  PlatformWorkspaceNote,
  PlatformWorkspaceNoteList,
} from '../../lib/platform-types.js';

export const WORKSPACE_SORTS = [
  'created_desc',
  'created_asc',
  'name_asc',
  'trial_ends_asc',
] as const;
export type WorkspaceSort = (typeof WORKSPACE_SORTS)[number];

export interface WorkspaceFilters {
  q: string;
  status: string;
  plan: string;
  region: string;
  /** `yyyy-mm-dd`, the end of that UTC day; empty for none. */
  trialEndsBefore: string;
  sort: WorkspaceSort;
}

export const EMPTY_FILTERS: WorkspaceFilters = {
  q: '',
  status: '',
  plan: '',
  region: '',
  trialEndsBefore: '',
  sort: 'created_desc',
};

export const WORKSPACE_PAGE_SIZE = 25;

function listQuery(filters: WorkspaceFilters, cursor: string | null): string {
  const params = new URLSearchParams();
  if (filters.q.trim()) params.set('q', filters.q.trim());
  if (filters.status) params.set('status', filters.status);
  if (filters.plan) params.set('plan', filters.plan);
  if (filters.region) params.set('region', filters.region);
  if (filters.trialEndsBefore) {
    params.set('trial_ends_before', `${filters.trialEndsBefore}T23:59:59.999Z`);
  }
  params.set('sort', filters.sort);
  params.set('limit', String(WORKSPACE_PAGE_SIZE));
  if (cursor) params.set('cursor', cursor);
  return params.toString();
}

export function useWorkspaceList(filters: WorkspaceFilters) {
  return useInfiniteQuery({
    queryKey: ['workspaces', 'list', filters],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      api.get<PlatformWorkspaceList>(`/workspaces?${listQuery(filters, pageParam)}`),
    getNextPageParam: (last) => last.next_cursor,
  });
}

export function useWorkspace(licenseId: string): UseQueryResult<PlatformWorkspaceDetail> {
  return useQuery({
    queryKey: ['workspaces', licenseId, 'detail'],
    queryFn: () => api.get<PlatformWorkspaceDetail>(`/workspaces/${licenseId}`),
  });
}

/**
 * One tab's read. Each tab names its own path, so the endpoint audit reads every call the
 * client makes as written (`scripts/audit/endpoint-ui.cjs`).
 */
export function useWorkspaceTab<T>(
  licenseId: string,
  tab: string,
  fetcher: () => Promise<T>,
): UseQueryResult<T> {
  return useQuery({ queryKey: ['workspaces', licenseId, tab], queryFn: fetcher });
}

export function useWorkspaceNotes(licenseId: string) {
  return useInfiniteQuery({
    queryKey: ['workspaces', licenseId, 'notes'],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      api.get<PlatformWorkspaceNoteList>(
        `/workspaces/${licenseId}/notes${pageParam ? `?cursor=${encodeURIComponent(pageParam)}` : ''}`,
      ),
    getNextPageParam: (last) => last.next_cursor,
  });
}

export function useAddNote(licenseId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { body: string; reason: string }) =>
      api.post<PlatformWorkspaceNote>(`/workspaces/${licenseId}/notes`, input),
    onSuccess: () => client.invalidateQueries({ queryKey: ['workspaces', licenseId, 'notes'] }),
  });
}

/** Every scheduled deletion, the soonest first (tm 389.10). */
export function usePurgeQueue(): UseQueryResult<PlatformWorkspacePurgeQueue> {
  return useQuery({
    queryKey: ['workspaces', 'purge-queue'],
    queryFn: () => api.get<PlatformWorkspacePurgeQueue>('/workspaces/purge-queue'),
  });
}

export function useWorkspaceOverrides(
  licenseId: string,
): UseQueryResult<PlatformWorkspaceOverridesEnvelope> {
  return useQuery({
    queryKey: ['workspaces', licenseId, 'overrides'],
    queryFn: () =>
      api.get<PlatformWorkspaceOverridesEnvelope>(`/workspaces/${licenseId}/overrides`),
  });
}

/**
 * One workspace action. The caller hands over the request itself — each action writes its own
 * path, so the endpoint audit reads every call as written (`scripts/audit/endpoint-ui.cjs`).
 * The answer carries the workspace as it now reads, so the detail is written straight into the
 * cache; everything else about workspaces (the tabs, the list, the purge queue) is refetched,
 * because an action can change any of it.
 */
export function useWorkspaceAction(licenseId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (send: () => Promise<PlatformWorkspaceActionResult>) => send(),
    onSuccess: async (result) => {
      client.setQueryData(['workspaces', licenseId, 'detail'], { workspace: result.workspace });
      await client.invalidateQueries({
        predicate: (query) =>
          query.queryKey[0] === 'workspaces' &&
          !(query.queryKey[1] === licenseId && query.queryKey[2] === 'detail'),
      });
    },
  });
}
