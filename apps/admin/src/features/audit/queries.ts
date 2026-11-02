/**
 * The Audit page's reads and actions (tm 391 · FR-ADMIN-05/06). The list pages by keyset
 * ("Load more" asks for the next cursor); verify and export are actions, not cached reads — a
 * verification walks the whole chain, an export page is a file.
 *
 * Each call writes its own path where it is made (`scripts/audit/endpoint-ui.cjs` reads every
 * call as written).
 */
import { useInfiniteQuery, useMutation } from '@tanstack/react-query';
import { api } from '../../lib/auth-store.js';
import type {
  PlatformAuditAction,
  PlatformAuditList,
  PlatformAuditVerification,
} from '../../lib/platform-types.js';

export const AUDIT_PAGE_SIZE = 50;

export interface AuditFilter {
  adminId: string;
  action: PlatformAuditAction | '';
  /** A workspace's number, digits only; empty for all. */
  licenseId: string;
  /** `YYYY-MM-DD` (UTC), inclusive; empty for open. */
  from: string;
  to: string;
}

export const EMPTY_AUDIT_FILTER: AuditFilter = {
  adminId: '',
  action: '',
  licenseId: '',
  from: '',
  to: '',
};

export function useAuditEntries(filter: AuditFilter) {
  return useInfiniteQuery({
    queryKey: ['audit', 'list', filter],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams();
      if (filter.adminId) params.set('admin_id', filter.adminId);
      if (filter.action) params.set('action', filter.action);
      if (filter.licenseId) params.set('license_id', filter.licenseId);
      if (filter.from) params.set('from', `${filter.from}T00:00:00.000Z`);
      if (filter.to) params.set('to', `${filter.to}T23:59:59.999Z`);
      params.set('limit', String(AUDIT_PAGE_SIZE));
      if (pageParam) params.set('cursor', pageParam);
      return api.get<PlatformAuditList>(`/audit?${params.toString()}`);
    },
    getNextPageParam: (last) => last.next_cursor,
    staleTime: 0,
  });
}

export function useVerifyChain() {
  return useMutation({
    mutationFn: () => api.post<PlatformAuditVerification>('/audit/verify'),
  });
}

/** What one export page says about itself, read off the response headers. */
export interface ExportPage {
  body: Blob;
  signature: string;
  count: number;
  firstSeq: string;
  lastSeq: string;
  hasMore: boolean;
  /** Where the next page starts; hand it back as `cursor`. */
  cursor: string;
  chainOk: boolean;
}

export async function fetchExportPage(cursor: string): Promise<ExportPage> {
  const { body, headers } = await api.getDownload(
    cursor ? `/audit/export?cursor=${encodeURIComponent(cursor)}` : '/audit/export',
  );
  return {
    body,
    signature: headers.get('x-siyahtus-signature') ?? '',
    count: Number(headers.get('x-siyahtus-export-count') ?? 0),
    firstSeq: headers.get('x-siyahtus-export-first-seq') ?? '',
    lastSeq: headers.get('x-siyahtus-export-last-seq') ?? '',
    hasMore: headers.get('x-siyahtus-export-has-more') === 'true',
    cursor: headers.get('x-siyahtus-export-cursor') ?? '',
    chainOk: headers.get('x-siyahtus-export-chain-ok') === 'true',
  };
}
