/**
 * The root panel's announcement and maintenance mode (tm 389.13 ·
 * FR-ADMIN-15), read from `GET /deployment/notice`.
 *
 * Anonymous like `/deployment`, and answered in maintenance mode too — it is
 * how the panel learns it is in maintenance. Polled once a minute, and asked
 * again at once when any request is refused with `maintenance`
 * (`main.tsx`), so the full-page message appears without a reload. A failed
 * read shows nothing rather than a stale banner: the notice is a courtesy,
 * the API enforces maintenance on its own.
 */
import { queryOptions, useQuery } from '@tanstack/react-query';
import type { DeploymentNotice } from '@siyahtus/types';
import { ApiClient } from './api-client.js';

export const NOTICE_QUERY_KEY = ['deployment', 'notice'] as const;

export const noticeQuery = queryOptions({
  queryKey: NOTICE_QUERY_KEY,
  queryFn: () => new ApiClient().get<DeploymentNotice>('/deployment/notice'),
  staleTime: 30_000,
  refetchInterval: 60_000,
  retry: false,
});

/** The notice, or nothing to show — never a half-read answer. */
export function useNotice(): DeploymentNotice {
  const data = useQuery(noticeQuery).data;
  return {
    announcement: data?.announcement ?? null,
    maintenance: data?.maintenance ?? null,
  };
}
