/**
 * Payment operations' reads and writes (tm 389.18 · FR-ADMIN-14): the crypto request queue,
 * the bank transfers waiting to be matched, the three payment settings the workspaces read, an
 * invoice's PDF and a refund approved as a credit. Every write refreshes everything under
 * `billing` — a confirmed payment moves the subscription and statement lists too.
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
  PlatformBankDetails,
  PlatformCreditEnvelope,
  PlatformIssuerProfile,
  PlatformPaymentProviders,
  PlatformPaymentRequestEnvelope,
  PlatformPaymentRequestList,
  PlatformSwiftPaymentEnvelope,
  PlatformSwiftPaymentList,
} from '../../lib/platform-types.js';

export const PAYMENT_PAGE_SIZE = 25;

/** The crypto queue's filter; `open` is the two the team still has to act on. */
export const REQUEST_FILTERS = [
  'open',
  'requested',
  'address_sent',
  'paid',
  'rejected',
  'canceled',
  'all',
] as const;
export type RequestFilter = (typeof REQUEST_FILTERS)[number];

export const SWIFT_FILTERS = ['pending', 'succeeded', 'failed', 'canceled', 'all'] as const;
export type SwiftFilter = (typeof SWIFT_FILTERS)[number];

function listQuery(state: string, cursor: string | null): string {
  const search = new URLSearchParams({ state, limit: String(PAYMENT_PAGE_SIZE) });
  if (cursor) search.set('cursor', cursor);
  return search.toString();
}

export function usePaymentRequests(state: RequestFilter) {
  return useInfiniteQuery({
    queryKey: ['billing', 'payment-requests', state],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      api.get<PlatformPaymentRequestList>(
        `/billing/payment-requests?${listQuery(state, pageParam)}`,
      ),
    getNextPageParam: (page) => page.next_cursor,
  });
}

export function useSwiftPayments(state: SwiftFilter) {
  return useInfiniteQuery({
    queryKey: ['billing', 'swift-payments', state],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      api.get<PlatformSwiftPaymentList>(`/billing/swift-payments?${listQuery(state, pageParam)}`),
    getNextPageParam: (page) => page.next_cursor,
  });
}

export function useProviders(): UseQueryResult<PlatformPaymentProviders> {
  return useQuery({
    queryKey: ['billing', 'providers'],
    queryFn: () => api.get<PlatformPaymentProviders>('/billing/providers'),
  });
}

export function useBankDetails(): UseQueryResult<PlatformBankDetails> {
  return useQuery({
    queryKey: ['billing', 'bank-details'],
    queryFn: () => api.get<PlatformBankDetails>('/billing/bank-details'),
  });
}

export function useIssuerProfile(): UseQueryResult<PlatformIssuerProfile> {
  return useQuery({
    queryKey: ['billing', 'issuer-profile'],
    queryFn: () => api.get<PlatformIssuerProfile>('/billing/issuer-profile'),
  });
}

/** One write, then everything under `billing` again. */
function useBillingWrite<I, O>(run: (input: I) => Promise<O>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSuccess: () => client.invalidateQueries({ queryKey: ['billing'] }),
  });
}

export function useSendAddress() {
  return useBillingWrite(
    (input: { id: string; network: string; address: string; reason: string }) =>
      api.post<PlatformPaymentRequestEnvelope>(
        `/billing/payment-requests/${input.id}/send-address`,
        { network: input.network, address: input.address, reason: input.reason },
      ),
  );
}

export function useConfirmTxid() {
  return useBillingWrite((input: { id: string; txid: string; reason: string }) =>
    api.post<PlatformPaymentRequestEnvelope>(`/billing/payment-requests/${input.id}/confirm-txid`, {
      txid: input.txid,
      reason: input.reason,
    }),
  );
}

export function useRejectRequest() {
  return useBillingWrite((input: { id: string; reason: string }) =>
    api.post<PlatformPaymentRequestEnvelope>(`/billing/payment-requests/${input.id}/cancel`, {
      reason: input.reason,
    }),
  );
}

export function useMarkSwiftPaid() {
  return useBillingWrite((input: { id: string; reference: string; reason: string }) =>
    api.post<PlatformSwiftPaymentEnvelope>(`/billing/swift-payments/${input.id}/mark-paid`, {
      reference: input.reference,
      reason: input.reason,
    }),
  );
}

export interface ProvidersInput {
  swift_manual: boolean;
  crypto_manual: boolean;
  stripe: boolean;
  reason: string;
}

export function useSaveProviders() {
  return useBillingWrite((input: ProvidersInput) =>
    api.put<PlatformPaymentProviders>('/billing/providers', input),
  );
}

export interface BankDetailsInput {
  beneficiary: string;
  bank_name: string;
  iban: string;
  swift_bic: string;
  bank_address: string | null;
  reason: string;
}

export function useSaveBankDetails() {
  return useBillingWrite((input: BankDetailsInput) =>
    api.put<PlatformBankDetails>('/billing/bank-details', input),
  );
}

export interface IssuerProfileInput {
  legal_name: string;
  address_lines: string[];
  country: string | null;
  tax_office: string | null;
  tax_id: string | null;
  vat_id: string | null;
  email: string | null;
  tax_note: string | null;
  reason: string;
}

export function useSaveIssuerProfile() {
  return useBillingWrite((input: IssuerProfileInput) =>
    api.put<PlatformIssuerProfile>('/billing/issuer-profile', input),
  );
}

export interface RefundInput {
  license_id: string;
  invoice_id: string;
  amount_minor: number;
  reason: string;
}

export function useApproveRefund() {
  return useBillingWrite((input: RefundInput) =>
    api.post<PlatformCreditEnvelope>('/billing/refund-approvals', input),
  );
}

/** One issued statement's stored PDF. */
export function downloadInvoicePdf(invoiceId: string): Promise<Blob> {
  return api.getBlob(`/billing/invoices/${invoiceId}/pdf`);
}
