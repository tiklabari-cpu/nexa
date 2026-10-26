/**
 * The account pages' reads and writes (tm 389.11 · FR-ADMIN-11). The search pages by keyset
 * ("Load more" asks for the next cursor); the detail is one query, and every action answers
 * with the account as it now reads, written straight into the cache.
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
  PlatformAccountActionResult,
  PlatformAccountDetail,
  PlatformAccountList,
} from '../../lib/platform-types.js';

export const ACCOUNT_PAGE_SIZE = 25;

export function useAccountSearch(q: string) {
  return useInfiniteQuery({
    queryKey: ['accounts', 'list', q],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams();
      if (q) params.set('q', q);
      params.set('limit', String(ACCOUNT_PAGE_SIZE));
      if (pageParam) params.set('cursor', pageParam);
      return api.get<PlatformAccountList>(`/accounts?${params.toString()}`);
    },
    getNextPageParam: (last) => last.next_cursor,
  });
}

export function useAccount(accountId: string): UseQueryResult<PlatformAccountDetail> {
  return useQuery({
    queryKey: ['accounts', accountId, 'detail'],
    queryFn: () => api.get<PlatformAccountDetail>(`/accounts/${accountId}`),
  });
}

/**
 * One account action. The caller hands over the request itself — each action writes its own
 * path, so the endpoint audit reads every call as written (`scripts/audit/endpoint-ui.cjs`).
 * The list is refetched afterwards (a suspension shows there), and so are the workspaces, whose
 * member tabs name the person.
 */
export function useAccountAction(accountId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (send: () => Promise<PlatformAccountActionResult>) => send(),
    onSuccess: async (result) => {
      client.setQueryData(['accounts', accountId, 'detail'], { account: result.account });
      await client.invalidateQueries({
        predicate: (query) =>
          (query.queryKey[0] === 'accounts' && query.queryKey[1] === 'list') ||
          query.queryKey[0] === 'workspaces',
      });
    },
  });
}

/** After an erasure: the account is gone from every cache. */
export function useForgetAccount() {
  const client = useQueryClient();
  return (accountId: string) => {
    client.removeQueries({ queryKey: ['accounts', accountId] });
    void client.invalidateQueries({
      predicate: (query) => query.queryKey[0] === 'accounts' || query.queryKey[0] === 'workspaces',
    });
  };
}
