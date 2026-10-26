/**
 * "Enter as the customer" — what an operator signed in as a member may do
 * (tm 389.15 · FR-ADMIN-21 · docs/platform-admin/design.md §G).
 *
 * The principal is the member's own (`token-service.ts`): their role, the
 * workspace's matrix, nothing more — so every scope, role and capability gate
 * already answers as it would for them. This hook adds the session's terms on
 * top, for a principal that carries `impersonation`:
 *
 *   - **Its window.** Past `endsAt` the credential is refused with the same
 *     401 as any expired token. `auth_resolve_token` already folds the window
 *     into the token's expiry; this is the second, independent refusal.
 *   - **The forbidden paths, in every mode.** A write to a route in
 *     `IMPERSONATION_FORBIDDEN_PATHS` (`@siyahtus/types`) — passwords, second
 *     factors, credentials, security, payment, the subscription, the BAA,
 *     erasure, the sandbox, new access, new data egress — answers 403
 *     `impersonation_forbidden_path` with `details.category`. So does a write
 *     nobody has classified (fail closed; `impersonation-gate.test.ts` holds
 *     every contract operation to a verdict).
 *   - **Read-only.** In a `read_only` session every other write answers 403
 *     `impersonation_read_only` — except leaving: signing out and ending the
 *     session (`IMPERSONATION_EXIT_PATHS`).
 *
 * `onRequest`, registered right after `auth`, so a refused write never parses
 * its body. Matched on the route pattern (`routeOptions.url`), never the raw
 * URL — a query string, a trailing slash or a percent-encoded letter cannot
 * walk past it, and HEAD is GET. A request that matched no route answers 404
 * as it would anyway.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { impersonationWriteVerdict, type ImpersonationMode } from '@siyahtus/types';
import { ApiError } from '../lib/api-error.js';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const API_PREFIX = '/api/v1';

export type ImpersonationRefusal =
  | { type: 'impersonation_forbidden_path'; category: string }
  | { type: 'impersonation_read_only' }
  | null;

/**
 * Whether a session in `mode` may make this request — exported for its unit
 * test, which runs it over every operation of the tenant contract.
 */
export function impersonationRefusal(
  mode: ImpersonationMode,
  method: string,
  routeUrl: string | undefined,
): ImpersonationRefusal {
  if (routeUrl === undefined || !MUTATING_METHODS.has(method)) return null;
  const path = routeUrl.startsWith(API_PREFIX) ? routeUrl.slice(API_PREFIX.length) : routeUrl;
  const decision = impersonationWriteVerdict(path);
  switch (decision.verdict) {
    case 'exit':
      return null;
    case 'forbidden':
      return { type: 'impersonation_forbidden_path', category: decision.category };
    case 'unclassified':
      return { type: 'impersonation_forbidden_path', category: 'unclassified' };
    case 'allowed':
      return mode === 'read_only' ? { type: 'impersonation_read_only' } : null;
  }
}

async function impersonationGatePlugin(app: FastifyInstance): Promise<void> {
  app.addHook('onRequest', async (request: FastifyRequest) => {
    const principal = request.principal;
    if (principal?.kind !== 'agent' || !principal.impersonation) return;
    const { mode, endsAt } = principal.impersonation;

    if (endsAt.getTime() <= Date.now()) throw ApiError.invalidToken();

    const refusal = impersonationRefusal(mode, request.method, request.routeOptions.url);
    if (refusal === null) return;
    if (refusal.type === 'impersonation_read_only') {
      throw new ApiError(
        'impersonation_read_only',
        'This is a read-only support session: nothing can be changed from it.',
      );
    }
    throw new ApiError(
      'impersonation_forbidden_path',
      'A support session cannot do this on a member’s behalf.',
      { details: { category: refusal.category } },
    );
  });
}

export default fp(impersonationGatePlugin, {
  name: 'impersonation-gate',
  dependencies: ['auth'],
});
