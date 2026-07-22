/**
 * Authentication and authorization.
 *
 * Routes are authenticated by default. A route becomes public only by opting in
 * with `config: { public: true }` — the opposite default would mean a forgotten
 * annotation silently exposes an endpoint, and that mistake is invisible in
 * review.
 *
 * Scope and role requirements are declared per route in `config` and enforced
 * here, so the check cannot be skipped by forgetting to call a helper inside
 * the handler.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { hasAnyScope, type AgentRole } from '@nexa/types';
import type { Env } from '../config/env.js';
import { ApiError } from '../lib/api-error.js';
import { withTenant, type TenantClient, type TenantContext } from '../lib/tenant.js';
import { CustomerTokenService } from '../services/auth/customer-token.js';
import { roleAtLeast, tenantOf, type Principal } from '../services/auth/principal.js';
import { TokenService } from '../services/auth/token-service.js';

declare module 'fastify' {
  interface FastifyInstance {
    tokens: TokenService;
    customerTokens: CustomerTokenService;
  }

  interface FastifyRequest {
    /** Present on every authenticated request; absent on public routes. */
    principal?: Principal;
    /** Throws rather than returning undefined — handlers should not null-check. */
    requirePrincipal: () => Principal;
    tenant: () => TenantContext;
    /** Run a query with this request's tenant context established. */
    withTenant: <T>(fn: (tx: TenantClient) => Promise<T>) => Promise<T>;
  }

  interface FastifyContextConfig {
    /** Opt out of authentication. Use sparingly and deliberately. */
    public?: boolean;
    /** Caller needs at least one of these scopes. */
    scopes?: string[];
    /** Caller's membership role must be at least this. */
    minimumRole?: AgentRole;
    /** Which principal kinds may call this route. Defaults to agent + bot. */
    principals?: Array<Principal['kind']>;
  }
}

const DEFAULT_PRINCIPALS: Array<Principal['kind']> = ['agent', 'bot'];

/**
 * Reads `Authorization`.
 *
 * Supports `Bearer <token>` (OAuth access token, bot token or customer token)
 * and `Basic base64(account_id:pat)` — the personal access token scheme from
 * v2-03 §1.4, which server integrations expect.
 */
function readCredential(
  request: FastifyRequest,
): { scheme: 'bearer' | 'basic'; value: string } | null {
  const header = request.headers.authorization;
  if (!header) return null;

  const separator = header.indexOf(' ');
  if (separator < 0) return null;

  const scheme = header.slice(0, separator).toLowerCase();
  const value = header.slice(separator + 1).trim();
  if (!value) return null;

  if (scheme === 'bearer') return { scheme: 'bearer', value };
  if (scheme === 'basic') {
    let decoded: string;
    try {
      decoded = Buffer.from(value, 'base64').toString('utf8');
    } catch {
      return null;
    }
    const colon = decoded.indexOf(':');
    if (colon < 0) return null;
    // The account id half is informational; the PAT is what is verified.
    return { scheme: 'basic', value: decoded.slice(colon + 1) };
  }
  return null;
}

async function authPlugin(app: FastifyInstance, options: { env: Env }): Promise<void> {
  const { env } = options;

  const tokens = new TokenService(app.db);
  const customerTokens = new CustomerTokenService(
    env.CUSTOMER_TOKEN_SECRET,
    env.CUSTOMER_TOKEN_TTL,
  );

  app.decorate('tokens', tokens);
  app.decorate('customerTokens', customerTokens);

  app.decorateRequest('principal', undefined);
  app.decorateRequest('requirePrincipal', function (this: FastifyRequest) {
    if (!this.principal) throw ApiError.authentication();
    return this.principal;
  });
  app.decorateRequest('tenant', function (this: FastifyRequest) {
    return tenantOf(this.requirePrincipal());
  });
  app.decorateRequest('withTenant', function (this: FastifyRequest, fn) {
    return withTenant(app.db, this.tenant(), fn);
  });

  /**
   * `public: true` short-circuits authentication, so a route that also declares
   * scopes or a minimum role would silently accept anonymous callers — the
   * declaration would read as protected while being wide open. Fail at boot
   * rather than let that combination exist.
   */
  app.addHook('onRoute', (route) => {
    const config = route.config as { public?: boolean; scopes?: string[]; minimumRole?: string };
    if (!config?.public) return;
    if (config.scopes?.length || config.minimumRole) {
      throw new Error(
        `Route ${route.method} ${route.url} is marked public but declares authorization ` +
          `requirements (scopes/minimumRole). A public route cannot enforce them.`,
      );
    }
  });

  app.addHook('onRequest', async (request) => {
    const config = request.routeOptions.config;
    const credential = readCredential(request);

    if (!credential) {
      if (config.public) return;
      throw ApiError.authentication('Authorization header is required.');
    }

    const principal = await resolvePrincipal();
    if (!principal) {
      if (config.public) return; // a bad token on a public route is simply ignored
      throw ApiError.authentication();
    }

    request.principal = principal;

    // --- Principal kind ---------------------------------------------------
    const allowed = config.principals ?? DEFAULT_PRINCIPALS;
    if (!allowed.includes(principal.kind)) {
      // I4: a customer token reaching an agent route is a boundary violation,
      // not a permission shortfall. 404 rather than 403 so the widget-facing
      // surface cannot be used to map the agent API.
      throw ApiError.notFound('Resource not found.');
    }

    // --- Region (ADR-12) --------------------------------------------------
    const requestedRegion = request.headers['x-region'];
    if (typeof requestedRegion === 'string' && requestedRegion !== env.NEXA_REGION) {
      throw new ApiError('misdirected_request', 'Wrong region for this organization.', {
        details: { region: env.NEXA_REGION },
      });
    }

    // --- Scopes -----------------------------------------------------------
    // Scopes are an agent/bot concept — a customer token has none by design.
    // For a customer, the route's `principals` list *is* the authorization
    // decision, and it has already been enforced above. Applying an agent scope
    // check here would make every customer-reachable route unreachable.
    if (config.scopes?.length && principal.kind !== 'customer') {
      if (!hasAnyScope(principal.scopes, config.scopes)) {
        throw ApiError.authorization(
          `This token is missing the required scope (one of: ${config.scopes.join(', ')}).`,
        );
      }
    }

    // --- Role -------------------------------------------------------------
    if (config.minimumRole) {
      if (principal.kind !== 'agent' || !roleAtLeast(principal.role, config.minimumRole)) {
        throw ApiError.authorization(`This action requires the ${config.minimumRole} role.`);
      }
    }

    async function resolvePrincipal(): Promise<Principal | null> {
      // Customer tokens carry a recognisable prefix, so the common case costs
      // one string comparison instead of a database round-trip.
      if (credential!.scheme === 'bearer' && credential!.value.startsWith('nxc1.')) {
        const verification = customerTokens.verify(credential!.value);
        if (!verification.ok) {
          request.log.debug({ reason: verification.reason }, 'customer token rejected');
          return null;
        }
        return verification.principal;
      }

      const resolution = await tokens.resolve(credential!.value);
      if (!resolution.ok) {
        // The precise reason is logged but never returned: telling a caller
        // that a token is "expired" rather than "unknown" confirms it was real.
        request.log.debug({ reason: resolution.reason }, 'token rejected');
        return null;
      }

      if (resolution.principal.kind !== 'customer') {
        tokens.touch(resolution.principal.tokenId);
      }
      return resolution.principal;
    }
  });
}

export default fp(authPlugin, { name: 'auth', dependencies: ['database'] });
