/**
 * The AI page's reads and the one write (tm 389.19 · FR-ADMIN-23). One query per catalogue, so a
 * failing read blanks only its own tab. Each call writes its path where it is made
 * (`scripts/audit/endpoint-ui.cjs` reads every call as written).
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
  PlatformCompliancePack,
  PlatformCrisisTextDrafts,
  PlatformCrisisTextDraftsRequest,
  PlatformGuardrailCatalog,
  PlatformQaRubric,
  PlatformTemplateCatalog,
  PlatformTemplateInstallList,
  PlatformToolCatalog,
} from '../../lib/platform-types.js';

export const INSTALLS_PAGE_SIZE = 25;

/** The catalogues are code: they change with a deploy, not while the page is open. */
const CATALOG = { staleTime: 5 * 60_000 } as const;

export function useGuardrailCatalog(): UseQueryResult<PlatformGuardrailCatalog> {
  return useQuery({
    queryKey: ['ai-catalogs', 'guardrails'],
    queryFn: () => api.get<PlatformGuardrailCatalog>('/ai-catalogs/guardrails'),
    ...CATALOG,
  });
}

export function useTemplateCatalog(): UseQueryResult<PlatformTemplateCatalog> {
  return useQuery({
    queryKey: ['ai-catalogs', 'templates'],
    queryFn: () => api.get<PlatformTemplateCatalog>('/ai-catalogs/templates'),
    ...CATALOG,
  });
}

export function useTemplateInstalls() {
  return useInfiniteQuery({
    queryKey: ['ai-catalogs', 'template-installs'],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ limit: String(INSTALLS_PAGE_SIZE) });
      if (pageParam) params.set('cursor', pageParam);
      return api.get<PlatformTemplateInstallList>(
        `/ai-catalogs/templates/installs?${params.toString()}`,
      );
    },
    getNextPageParam: (last) => last.next_cursor,
    staleTime: 0,
  });
}

export function useCompliancePack(): UseQueryResult<PlatformCompliancePack> {
  return useQuery({
    queryKey: ['ai-catalogs', 'compliance-pack'],
    queryFn: () => api.get<PlatformCompliancePack>('/ai-catalogs/compliance-pack'),
    ...CATALOG,
  });
}

export function useQaRubric(): UseQueryResult<PlatformQaRubric> {
  return useQuery({
    queryKey: ['ai-catalogs', 'qa-rubric'],
    queryFn: () => api.get<PlatformQaRubric>('/ai-catalogs/qa-rubric'),
    ...CATALOG,
  });
}

export function useToolCatalog(): UseQueryResult<PlatformToolCatalog> {
  return useQuery({
    queryKey: ['ai-catalogs', 'tools'],
    queryFn: () => api.get<PlatformToolCatalog>('/ai-catalogs/tools'),
    ...CATALOG,
  });
}

const DRAFTS_KEY = ['ai-catalogs', 'crisis-text-drafts'] as const;

export function useCrisisTextDrafts(): UseQueryResult<PlatformCrisisTextDrafts> {
  return useQuery({
    queryKey: DRAFTS_KEY,
    queryFn: () => api.get<PlatformCrisisTextDrafts>('/ai-catalogs/crisis-text-drafts'),
    staleTime: 0,
  });
}

export function useSaveCrisisTextDrafts() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: PlatformCrisisTextDraftsRequest) =>
      api.put<PlatformCrisisTextDrafts>('/ai-catalogs/crisis-text-drafts', body),
    onSuccess: (saved) => client.setQueryData(DRAFTS_KEY, saved),
  });
}
