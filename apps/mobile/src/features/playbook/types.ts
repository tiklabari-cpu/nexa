/**
 * Types derived from the contract, not hand-written — same rule `13.7-f` set for
 * the inbox: a rename in `packages/contract/openapi/openapi.yaml` must turn red
 * in `pnpm -w typecheck` here, not silently drift from a copied interface.
 */
import type { ContractResponseBody } from '../../lib/contract';

export type Skill = ContractResponseBody<'/skills', 'get'>['items'][number];
export type SkillDetail = ContractResponseBody<'/skills/{skillId}', 'get'>;
export type SkillRun = ContractResponseBody<'/skills/{skillId}/runs', 'get'>['items'][number];
export type KnowledgeSource = ContractResponseBody<'/copilot/knowledge', 'get'>['items'][number];
