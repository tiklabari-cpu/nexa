/**
 * The risk-flag reads and writes the inbox shares (tm 302.3 · AI-27): the
 * header's chips and the Details panel's Risk section both ask for the same
 * two lists, so they share one cache entry each.
 *
 * A raise or a clear — by this agent or any other — comes back as a
 * `risk_flag_raised` / `risk_flag_cleared` push (`useInbox.ts`), which
 * invalidates `RISK_FLAGS_KEY`; a flag the AI raised on a turn shows the same
 * way, without a reload.
 *
 * The lists are asked for without a `limit`: a conversation holds at most one
 * active flag per type (ten) and a player a handful of member flags, so the
 * server's default page is the whole answer.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useApiClient } from '../../lib/auth-store.js';
import type { RiskFlagType } from '@siyahtus/types';
import {
  RISK_FLAGS_KEY,
  activeFlagsOf,
  chatRiskFlagsKey,
  customerRiskFlagsKey,
  type RiskFlagItem,
  type RiskFlagPage,
} from './riskFlags.js';

const STALE_MS = 15_000;

/**
 * A conversation's active flags and its player's active member flags, merged
 * (`activeFlagsOf`). `failed` is true when neither list could be read — the
 * caller may lack the read scope — so a screen can say so rather than show
 * "no flags" for a conversation it could not check.
 */
export function useActiveRiskFlags(
  chatId: string | null,
  customerId: string | null,
): { flags: RiskFlagItem[]; pending: boolean; failed: boolean } {
  const api = useApiClient();
  const chat = useQuery({
    queryKey: chatRiskFlagsKey(chatId ?? ''),
    queryFn: () => api.get<RiskFlagPage>(`/risk-flags?chat_id=${chatId}&status=active`),
    enabled: chatId !== null,
    staleTime: STALE_MS,
  });
  const member = useQuery({
    queryKey: customerRiskFlagsKey(customerId ?? ''),
    queryFn: () => api.get<RiskFlagPage>(`/customers/${customerId}/risk-flags?status=active`),
    enabled: customerId !== null,
    staleTime: STALE_MS,
  });
  const flags = activeFlagsOf(chat.data?.items ?? [], member.data?.items ?? []);
  return {
    flags,
    pending: chat.isPending || (customerId !== null && member.isPending),
    failed: chat.isError && (customerId === null || member.isError),
  };
}

/** `POST /chats/{chatId}/risk-flags`: flag the open conversation. */
export function useRaiseRiskFlag(chatId: string) {
  const api = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { type: RiskFlagType; note?: string }) =>
      api.post<RiskFlagItem>(`/chats/${chatId}/risk-flags`, input),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: RISK_FLAGS_KEY }),
  });
}

/** `DELETE /risk-flags/{flagId}`: clear a flag, with the reason the server requires. */
export function useClearRiskFlag() {
  const api = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ flagId, reason }: { flagId: string; reason: string }) =>
      api.request<RiskFlagItem>('DELETE', `/risk-flags/${flagId}`, { reason }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: RISK_FLAGS_KEY }),
  });
}
