/**
 * The Billing page's reads and writes (tm 389.12 · FR-ADMIN-12). Each section is its own
 * query, so a slow revenue read does not hold the subscription list back; the three lists page
 * by keyset ("Load more" asks for the next cursor). A credit or a subscription by hand
 * refreshes everything under `billing` — the totals they move are on several sections.
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
  PlatformBillingPackages,
  PlatformBillingPlanList,
  PlatformCreditEnvelope,
  PlatformCreditList,
  PlatformInvoiceList,
  PlatformRevenue,
  PlatformSubscriptionList,
  PlatformWorkspaceActionResult,
} from '../../lib/platform-types.js';

export const BILLING_PAGE_SIZE = 25;
export const REVENUE_MONTHS = 12;

export interface SubscriptionFilters {
  plan: string;
  status: string;
  pastDue: boolean;
}

export const EMPTY_SUBSCRIPTION_FILTERS: SubscriptionFilters = {
  plan: '',
  status: '',
  pastDue: false,
};

function query(params: Record<string, string | undefined>, cursor: string | null): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value) search.set(key, value);
  search.set('limit', String(BILLING_PAGE_SIZE));
  if (cursor) search.set('cursor', cursor);
  return search.toString();
}

export function usePlans(): UseQueryResult<PlatformBillingPlanList> {
  return useQuery({
    queryKey: ['billing', 'plans'],
    queryFn: () => api.get<PlatformBillingPlanList>('/billing/plans'),
  });
}

export function usePackages(): UseQueryResult<PlatformBillingPackages> {
  return useQuery({
    queryKey: ['billing', 'packages'],
    queryFn: () => api.get<PlatformBillingPackages>('/billing/packages'),
  });
}

export function useRevenue(): UseQueryResult<PlatformRevenue> {
  return useQuery({
    queryKey: ['billing', 'revenue', REVENUE_MONTHS],
    queryFn: () => api.get<PlatformRevenue>(`/billing/revenue?months=${REVENUE_MONTHS}`),
  });
}

export function useSubscriptions(filters: SubscriptionFilters) {
  return useInfiniteQuery({
    queryKey: ['billing', 'subscriptions', filters],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      api.get<PlatformSubscriptionList>(
        `/billing/subscriptions?${query(
          {
            plan: filters.plan || undefined,
            status: filters.status || undefined,
            past_due: filters.pastDue ? 'true' : undefined,
          },
          pageParam,
        )}`,
      ),
    getNextPageParam: (page) => page.next_cursor,
  });
}

export function useInvoices(licenseId: string) {
  return useInfiniteQuery({
    queryKey: ['billing', 'invoices', licenseId],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      api.get<PlatformInvoiceList>(
        `/billing/invoices?${query({ license_id: licenseId || undefined }, pageParam)}`,
      ),
    getNextPageParam: (page) => page.next_cursor,
  });
}

export function useCredits(open: boolean) {
  return useInfiniteQuery({
    queryKey: ['billing', 'credits', open],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      api.get<PlatformCreditList>(
        `/billing/credits?${query({ open: open ? 'true' : undefined }, pageParam)}`,
      ),
    getNextPageParam: (page) => page.next_cursor,
  });
}

export interface CreditInput {
  license_id: string;
  amount_minor: number;
  currency: string;
  reason: string;
}

export interface ManualSubscriptionInput {
  license_id: string;
  plan: string;
  period_end: string;
  seats?: number;
  reason: string;
}

export function useGrantCredit() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: CreditInput) => api.post<PlatformCreditEnvelope>('/billing/credits', input),
    onSuccess: () => client.invalidateQueries({ queryKey: ['billing'] }),
  });
}

export function useManualSubscription() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: ManualSubscriptionInput) =>
      api.post<PlatformWorkspaceActionResult>('/billing/manual-subscription', input),
    onSuccess: () =>
      Promise.all([
        client.invalidateQueries({ queryKey: ['billing'] }),
        client.invalidateQueries({ queryKey: ['workspaces'] }),
      ]),
  });
}

/** One issued statement's CSV. */
export function downloadInvoice(invoiceId: string): Promise<Blob> {
  return api.getBlob(`/billing/invoices/${invoiceId}/download`);
}
