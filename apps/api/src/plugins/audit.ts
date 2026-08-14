/**
 * Request-scoped audit context.
 *
 * Decorates the request with `auditContext`, which reads the acting principal,
 * the request id and the caller's IP once so route handlers do not reassemble
 * them at every `writeAuditEntry` call. Public (pre-auth) routes have no
 * principal — login and password reset — so those callers pass the tenant and
 * actor explicitly through `overrides`.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import type { AuditActorType, AuditContext } from '../services/audit/audit-log.js';

function actorOf(request: FastifyRequest): { actorId: string | null; actorType: AuditActorType } {
  const principal = request.principal;
  if (!principal) return { actorId: null, actorType: 'system' };
  if (principal.kind === 'agent') return { actorId: principal.accountId, actorType: 'agent' };
  if (principal.kind === 'bot') return { actorId: principal.botId, actorType: 'bot' };
  // A SCIM provisioning connector (NFR-S11) names no person and is not a bot in
  // this product's sense — `bot` means an AI agent of the workspace. It is an
  // external system acting on the workspace's own instruction, which is what
  // `system` already means here. Which *credential* acted is recorded by the
  // entry itself (S11-f writes the token into the target), not by pretending the
  // token is an account id.
  if (principal.kind === 'scim') return { actorId: null, actorType: 'system' };
  return { actorId: principal.customerId, actorType: 'customer' };
}

declare module 'fastify' {
  interface FastifyRequest {
    /**
     * Build the audit context for this request. `overrides` fill in what a
     * pre-auth route knows but the principal cannot supply (tenant, actor).
     */
    auditContext: (overrides?: Partial<AuditContext>) => AuditContext;
  }
}

async function auditPlugin(app: FastifyInstance): Promise<void> {
  app.decorateRequest(
    'auditContext',
    function (this: FastifyRequest, overrides: Partial<AuditContext> = {}): AuditContext {
      const { actorId, actorType } = actorOf(this);
      return {
        // `as bigint` documents the contract: an authenticated route has a
        // principal licence; a public one must pass `licenseId` in overrides.
        // `writeAuditEntry` throws if neither holds, so a missing tenant fails
        // loudly rather than writing an orphan row.
        licenseId: (overrides.licenseId ?? this.principal?.licenseId) as bigint,
        actorId: overrides.actorId !== undefined ? overrides.actorId : actorId,
        actorType: overrides.actorType ?? actorType,
        requestId: overrides.requestId !== undefined ? overrides.requestId : this.id,
        ip: overrides.ip !== undefined ? overrides.ip : (this.ip ?? null),
      };
    },
  );
}

export default fp(auditPlugin, { name: 'audit', dependencies: ['auth'] });
