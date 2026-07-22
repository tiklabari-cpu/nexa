/**
 * Trial expiry and read-only mode (ADR-10).
 *
 * An expired trial makes the workspace **read-only**, not locked. Existing data
 * stays readable and nothing is deleted: a workspace that cannot export its own
 * conversation history has been taken hostage rather than downgraded, and that
 * is both a bad way to treat a customer and, in several jurisdictions, a
 * problem of its own.
 *
 * So: reads succeed, writes are refused with `license_expired`, and the client
 * is told plainly which state it is in. Enforced as a hook rather than per
 * route, because "we forgot to gate that one endpoint" is how a free tier
 * quietly becomes unlimited.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { ApiError } from '../lib/api-error.js';
import { trialState } from '../services/billing/metering.js';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Writes that must keep working in read-only mode.
 *
 * Signing out, revoking a token and reading your own profile are how a customer
 * winds a workspace down cleanly; blocking them turns "please pay" into "you
 * are trapped".
 */
const ALWAYS_ALLOWED = [/^\/api\/v1\/auth\//, /^\/api\/v1\/health/];

declare module 'fastify' {
  interface FastifyContextConfig {
    /** Route stays writable while the licence is read-only. */
    allowWhenReadOnly?: boolean;
  }
}

async function licenseGatePlugin(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', async (request: FastifyRequest) => {
    const principal = request.principal;
    if (!principal) return;
    if (!MUTATING_METHODS.has(request.method)) return;
    if (request.routeOptions.config.allowWhenReadOnly) return;
    if (ALWAYS_ALLOWED.some((pattern) => pattern.test(request.url))) return;

    // Read fresh every time rather than cached. This is a single primary-key
    // lookup, and caching it means an expired trial keeps accepting writes for
    // the length of the TTL — a small saving for a real correctness hole.
    const { access } = await request.withTenant((tx) => trialState(tx, request.tenant()));

    if (access === 'read_only') {
      throw new ApiError(
        'license_expired',
        'This workspace is read-only. Your data is intact and still readable — subscribe to start new conversations.',
        { details: { access: 'read_only' } },
      );
    }
  });
}

export default fp(licenseGatePlugin, { name: 'license-gate', dependencies: ['auth'] });
