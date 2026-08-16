/**
 * Types derived from the contract, not hand-written — same rule `13.7-g`/`-h`
 * set for Customers/Reports: a rename in
 * `packages/contract/openapi/openapi.yaml` must turn red in `pnpm -w
 * typecheck` here, not silently drift from a copied interface.
 */
import type { ContractResponseBody } from '../../lib/contract';

export type CopilotSummary = ContractResponseBody<'/copilot/chats/{chatId}/summary', 'post'>;
export type CopilotReplyDraft = ContractResponseBody<'/copilot/chats/{chatId}/reply', 'post'>;
