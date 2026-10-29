/**
 * The timeline's reads (ID-09 · tm 334.2): `GET /chats/{chatId}/timeline`, paged
 * by the server's cursor, every loaded page kept — the list is not virtualised,
 * so the browser's own find reaches all of it. Nothing is live: a row that lands
 * while the screen is open appears when the page is read again.
 */
import { useMemo } from 'react';
import type { TimelineItem } from '@siyahtus/types';
import { usePagedQuery, type PagedResponse } from '../../lib/paged-query.js';
import { timelineUrl, type TimelineAddress, type TimelineMeta } from './timeline.js';

type TimelineWirePage = PagedResponse<TimelineItem> & Partial<TimelineMeta>;

export function useTimeline(address: TimelineAddress) {
  const query = usePagedQuery<TimelineItem>({
    queryKey: ['timeline', address.chatId, address.threadId, address.kinds.join(',')],
    buildUrl: (pageId) => timelineUrl(address, pageId),
    enabled: address.chatId !== null,
    staleTime: 15_000,
  });
  // The flags describe the whole read and arrive on every page; the first is the one to trust.
  const meta = useMemo<Partial<TimelineMeta>>(() => {
    const first = query.pages[0] as TimelineWirePage | undefined;
    return first
      ? {
          ...(first.audit !== undefined ? { audit: first.audit } : {}),
          ...(first.audit_expired !== undefined ? { audit_expired: first.audit_expired } : {}),
          ...(first.audit_retained_since !== undefined
            ? { audit_retained_since: first.audit_retained_since }
            : {}),
        }
      : {};
  }, [query.pages]);
  return { ...query, meta };
}
