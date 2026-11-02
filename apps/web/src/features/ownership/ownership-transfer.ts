/**
 * What the three ownership-transfer screens share (RL-05 · tm 328.2): the
 * shape the API answers with and the one read they all start from.
 *
 * The screens — Settings › Company "Danger zone", the accept page and the
 * banner every signed-in page carries — are pure consumers of the four
 * endpoints tm 328.1 built (`/ownership-transfers…`); every rule they seem to
 * apply (owner only, 72 hours, who may be offered the workspace) is the
 * server's. This file holds no rule of its own.
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useApiClient } from '../../lib/auth-store.js';

export interface OwnershipTransferParty {
  id: string;
  name: string;
  email: string;
}

export interface OwnershipTransfer {
  id: string;
  state: 'pending' | 'accepted' | 'cancelled' | 'expired';
  from_agent: OwnershipTransferParty;
  to_agent: OwnershipTransferParty;
  created_at: string;
  expires_at: string;
  decided_at: string | null;
  /** The workspace signs members in through an identity provider. */
  sso_enforced: boolean;
}

/** What `POST /ownership-transfers/{id}/accept` says happened to the invoice address. */
export type BillingContactOutcome = 'moved' | 'kept' | 'none';

/** The cache key of the pending transfer — invalidated by every write. */
export const OWNERSHIP_TRANSFER_KEY = ['ownership-transfer', 'current'] as const;

/**
 * The pending transfer, or `null`. One read for all three screens, so a banner
 * and the Danger zone beside it never disagree. The server shows it only to the
 * owner, the admins and the member it is offered to; anyone else reads `null`.
 */
export function useCurrentOwnershipTransfer(): UseQueryResult<OwnershipTransfer | null> {
  const api = useApiClient();
  return useQuery({
    queryKey: OWNERSHIP_TRANSFER_KEY,
    queryFn: async () => {
      const body = await api.get<{ transfer?: OwnershipTransfer | null }>(
        '/ownership-transfers/current',
      );
      // A server (or a stand-in) that answers with anything else reads as
      // "nothing pending" rather than a banner built from a wrong shape.
      return body?.transfer ?? null;
    },
    retry: false,
    staleTime: 60_000,
  });
}

/** The name a party shows under: their name, else the address they sign in with. */
export function partyLabel(party: OwnershipTransferParty): string {
  return party.name.trim() === '' ? party.email : party.name;
}
