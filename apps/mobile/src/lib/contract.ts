/**
 * The mobile app's binding to the OpenAPI contract.
 *
 * §D96 chose to host mobile inside this monorepo for exactly one reason: so the
 * phone reads the *same* generated types as the server and the web app instead
 * of a hand-copied duplicate that drifts. That promise is only worth something
 * if it is enforced, so nothing here is decorative — every helper below is a
 * compile-time assertion that a path, a method, a body or a response still
 * matches `packages/contract/openapi/openapi.yaml`. Rename an endpoint in the
 * spec and `pnpm -w typecheck` goes red in this workspace, before a screen is
 * ever opened.
 *
 * The import is deliberately the `./types` subpath rather than the package
 * root. The root entry also exports a document loader built on `node:fs` and
 * `import.meta.url` — neither of which exists inside a Metro bundle, and whose
 * mere presence in the module graph would drag `@types/node` into a
 * `tsc` run for a phone. `./types` is the generated contract and nothing else,
 * and being type-only it erases at build time.
 */
import type { paths } from '@nexa/contract/types';

/** Every path the contract declares. */
export type ContractPath = keyof paths & string;

/** HTTP methods openapi-typescript emits per path entry. */
export type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete';

/** The methods a given path actually declares — `never` for the ones it does not. */
export type ContractMethod<P extends ContractPath> = {
  [M in HttpMethod]: paths[P][M] extends { responses: unknown } ? M : never;
}[HttpMethod];

type Operation<P extends ContractPath, M extends ContractMethod<P>> = paths[P][M];

type JsonOf<T> = T extends { content: { 'application/json': infer B } } ? B : never;

/** The JSON body a request must send, or `never` where the contract declares none. */
export type ContractRequestBody<P extends ContractPath, M extends ContractMethod<P>> =
  Operation<P, M> extends { requestBody?: infer R } ? JsonOf<NonNullable<R>> : never;

/**
 * The JSON body a successful response carries. Only 2xx is modelled: a non-2xx
 * is thrown as an `ApiClientError` (ADR-06) and never reaches a caller as data.
 */
export type ContractResponseBody<P extends ContractPath, M extends ContractMethod<P>> =
  Operation<P, M> extends { responses: infer R }
    ? JsonOf<R[Extract<keyof R, 200 | 201 | 202>]>
    : never;

/** The query string a path accepts, or `never` where it takes none. */
export type ContractQuery<P extends ContractPath, M extends ContractMethod<P>> =
  Operation<P, M> extends { parameters: { query?: infer Q } } ? NonNullable<Q> : never;

/**
 * Identity at runtime, a checkpoint at compile time.
 *
 * Screens land in `13.7-e`…`-j`; each of them will name endpoints as string
 * literals. Passing them through here means a literal that the contract no
 * longer declares is a type error at the call site rather than a 404 discovered
 * on a device.
 */
export function contractPath<P extends ContractPath>(path: P): P {
  return path;
}

/**
 * The four surfaces FR-MOD-13.7 names — Inbox, AI, CRM, Reports — the parity
 * modules paid off since (Team `13.7-m`, Playbook `13.7-n`, Billing
 * `13.7-o`), the shell they hang off (`13.7-w`), plus the liveness probe this
 * bootstrap exercises. The registry exists so the parity matrix `13.7-k` has
 * to check is anchored in the contract from the first window: each entry is
 * verified to exist by `tsc`, and a spec rename cannot quietly leave a surface
 * pointing at nothing.
 *
 * The `auth*` entries were the last to arrive, and their absence was of a
 * piece with §D111: the phone had spoken this exact five-endpoint sequence
 * since `13.7-b` and no screen called any of it, so there was nothing for the
 * matrix to anchor. `13.7-p`…`-r` gave them callers and `13.7-w` gave them a
 * row — the way in and the way out, held to the same contract check as the
 * surfaces they open.
 */
export const MOBILE_ENDPOINTS = {
  health: contractPath('/health'),
  authLogin: contractPath('/auth/login'),
  authAuthorize: contractPath('/auth/authorize'),
  authToken: contractPath('/auth/token'),
  authMe: contractPath('/auth/me'),
  authRevoke: contractPath('/auth/revoke'),
  chats: contractPath('/chats'),
  customers: contractPath('/customers'),
  reportsOverview: contractPath('/reports/overview'),
  copilotChatSummary: contractPath('/copilot/chats/{chatId}/summary'),
  copilotChatReply: contractPath('/copilot/chats/{chatId}/reply'),
  agents: contractPath('/agents'),
  agentWorkSchedule: contractPath('/agents/{agentId}/work-schedule'),
  groups: contractPath('/groups'),
  skills: contractPath('/skills'),
  skill: contractPath('/skills/{skillId}'),
  skillRuns: contractPath('/skills/{skillId}/runs'),
  copilotKnowledge: contractPath('/copilot/knowledge'),
  billingSubscription: contractPath('/billing/subscription'),
  billingUsage: contractPath('/billing/usage'),
  billingInvoices: contractPath('/billing/invoices'),
  billingEntitlements: contractPath('/billing/entitlements'),
} as const satisfies Record<string, ContractPath>;

export type MobileEndpointKey = keyof typeof MOBILE_ENDPOINTS;
