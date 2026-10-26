/**
 * "Enter as the customer", the workspace console's half (tm 389.15 ·
 * FR-ADMIN-21 · docs/platform-admin/design.md §G).
 *
 *   POST /auth/impersonation/exchange   public, `rl:impersonation:<ip>`   handoff code → token
 *   POST /auth/impersonation/end        the impersonation token itself    the banner's "End session"
 *
 * The root panel opened a session on one member and handed the operator's
 * browser a one-time code (`/auth/impersonate#code=…`). The console brings it
 * here; `auth_consume_impersonation_handoff` spends it and mints an ordinary
 * bearer token of the member, kind `impersonation`, bounded by the session —
 * neither plaintext reaches a query, only their digests. Every refusal (spent,
 * late, unknown, a member who is no longer one) is the same 401: the caller
 * learns nothing about which.
 *
 * There is no refresh token and no renewal. The token dies with the session —
 * its window, the root panel's "End", or this route — because
 * `auth_resolve_token` reads the session's end and window as the token's own.
 * What the token may do on the way is `plugins/impersonation-gate.ts`'s.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ApiError } from '../lib/api-error.js';
import { readCredential } from '../lib/credential.js';
import { generateToken, hashToken } from '../lib/crypto.js';
import { writeAuditEntry } from '../services/audit/audit-log.js';

const exchangeBody = z.object({ code: z.string().min(1).max(128) });

interface ConsumedHandoff {
  token_id: string;
  session_id: string;
  license_id: bigint;
  organization_id: string;
  account_id: string;
  admin_id: string;
  mode: string;
  ends_at: Date;
}

interface EndedSession {
  session_id: string;
  license_id: bigint;
  account_id: string;
  admin_id: string;
  ended: boolean;
}

export default async function impersonationRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/auth/impersonation/exchange',
    { config: { public: true, impersonationRateLimit: true } },
    async (request, reply) => {
      const parsed = exchangeBody.safeParse(request.body);
      if (!parsed.success) throw ApiError.validation('`code` is required.');

      // Generated here and stored only as its digest by the function, like
      // every other bearer token (I2): the plaintext exists in this response.
      const token = generateToken();
      const [handoff] = await app.db.$queryRaw<ConsumedHandoff[]>`
        SELECT * FROM auth_consume_impersonation_handoff(
          ${hashToken(parsed.data.code)}, ${hashToken(token)})`;
      if (!handoff) {
        request.log.info('impersonation handoff refused');
        throw ApiError.authentication(
          'This link is no longer valid. Open a new session from the root panel.',
        );
      }

      request.log.info(
        {
          license_id: handoff.license_id.toString(),
          impersonation_session_id: handoff.session_id,
          platform_admin_id: handoff.admin_id,
        },
        'impersonation session entered',
      );
      const expiresIn = Math.max(0, Math.floor((handoff.ends_at.getTime() - Date.now()) / 1000));
      return reply.header('cache-control', 'no-store').send({
        access_token: token,
        token_type: 'Bearer',
        expires_in: expiresIn,
        account_id: handoff.account_id,
        license_id: handoff.license_id.toString(),
        organization_id: handoff.organization_id,
        impersonation: {
          session_id: handoff.session_id,
          mode: handoff.mode,
          ends_at: handoff.ends_at.toISOString(),
        },
      });
    },
  );

  // Open to the agent principal only, and of those to an impersonation token:
  // a member's own session asking is a route that does not exist for them.
  app.post(
    '/auth/impersonation/end',
    { config: { principals: ['agent'] } },
    async (request, reply) => {
      const principal = request.requirePrincipal();
      if (principal.kind !== 'agent' || !principal.impersonation) {
        throw ApiError.notFound('Resource not found.');
      }
      // The credential that authenticated this request — the one `auth.ts` just
      // resolved — is what proves which session is being ended.
      const presented = readCredential(request)?.value ?? '';
      const [session] = await app.db.$queryRaw<EndedSession[]>`
        SELECT * FROM auth_end_impersonation(${hashToken(presented)})`;
      if (!session || session.session_id !== principal.impersonation.sessionId) {
        throw ApiError.notFound('Resource not found.');
      }

      // The workspace's half of the record, as the operator, for the member —
      // the platform chain is the root panel's to write, and the session row
      // says it was ended from here (`end_reason: ended_in_workspace`).
      if (session.ended) {
        await request.withTenant((tx) =>
          writeAuditEntry(tx, request.auditContext(), {
            action: 'platform.impersonation_ended',
            target: `impersonation:${session.session_id}`,
            metadata: { via: 'workspace', mode: principal.impersonation!.mode },
          }),
        );
      }
      return reply.header('cache-control', 'no-store').send({ ended: session.ended });
    },
  );
}
