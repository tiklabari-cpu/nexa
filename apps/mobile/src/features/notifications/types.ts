/**
 * Types derived from the contract, not hand-written — same rule the other
 * screens set (`13.7-g`/`-h`/`-i`): a rename in
 * `packages/contract/openapi/openapi.yaml` must turn red in `pnpm -w
 * typecheck` here, not silently drift from a copied interface.
 */
import type { ContractRequestBody, ContractResponseBody } from '../../lib/contract';

export type NotificationPreferences = ContractResponseBody<
  '/agents/me/notification-preferences',
  'get'
>;

/** The `PUT` body — a partial update, at least one channel (the contract requires it). */
export type NotificationPreferencesPatch = ContractRequestBody<
  '/agents/me/notification-preferences',
  'put'
>;
