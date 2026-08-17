/**
 * Types derived from the contract, not hand-written — same rule `13.7-f` set for
 * the inbox: a rename in `packages/contract/openapi/openapi.yaml` must turn red
 * in `pnpm -w typecheck` here, not silently drift from a copied interface.
 */
import type { ContractResponseBody } from '../../lib/contract';

export type Agent = ContractResponseBody<'/agents', 'get'>['items'][number];
export type Group = ContractResponseBody<'/groups', 'get'>['items'][number];
export type AgentWorkSchedule = ContractResponseBody<'/agents/{agentId}/work-schedule', 'get'>;
