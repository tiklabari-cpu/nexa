/**
 * Types derived from the contract, not hand-written — same rule `13.7-g` set for
 * Customers and `13.7-m`/`-n` followed for Team/Playbook: a rename in
 * `packages/contract/openapi/openapi.yaml` must turn red in `pnpm -w typecheck`
 * here, not silently drift from a copied interface. The web `BillingPage`'s
 * hand-written `types.ts` is not imported — it lives in a workspace Metro
 * cannot reach and it is not the source of truth anyway.
 */
import type { ContractResponseBody } from '../../lib/contract';

export type Subscription = ContractResponseBody<'/billing/subscription', 'get'>;
export type Usage = ContractResponseBody<'/billing/usage', 'get'>;
export type Invoice = ContractResponseBody<'/billing/invoices', 'get'>['invoices'][number];
export type Entitlements = ContractResponseBody<'/billing/entitlements', 'get'>;
