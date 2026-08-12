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
import { decideIpAccess } from '../lib/ip-allowlist.js';
import { UUID_RE, withTenant, type TenantClient, type TenantContext } from '../lib/tenant.js';
import { writeAuditEntry } from '../services/audit/audit-log.js';
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
    /**
     * The brand named by `X-Nexa-Brand`, validated to belong to the caller's
     * license (Multibrand, PRD §5.3). Undefined means license-wide. Resolved once
     * per request and folded into `tenant()`.
     */
    brandId?: string;
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
    /**
     * Caller's membership role must be *exactly* this — a rank ladder does not
     * apply. For an owner-only route the two spellings happen to coincide today
     * (owner is the top rank), and that coincidence is the reason to say which
     * one is meant: a route that only the owner may reach should keep refusing
     * everyone else on the day a rank above owner is added, not silently widen.
     */
    exactRole?: AgentRole;
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
  app.decorateRequest('brandId', undefined);
  app.decorateRequest('requirePrincipal', function (this: FastifyRequest) {
    if (!this.principal) throw ApiError.authentication();
    return this.principal;
  });
  app.decorateRequest('tenant', function (this: FastifyRequest) {
    const context = tenantOf(this.requirePrincipal());
    // A resolved brand narrows every query this request makes to that one brand;
    // its absence leaves the license-wide view untouched.
    return this.brandId ? { ...context, brandId: this.brandId } : context;
  });
  app.decorateRequest('withTenant', function (this: FastifyRequest, fn) {
    return withTenant(app.db, this.tenant(), fn);
  });

  /**
   * Resolve the `X-Nexa-Brand` header to a brand of the caller's license, or
   * undefined when absent (license-wide). The lookup runs under the caller's
   * license context, so RLS makes another license's brand invisible — it comes
   * back as "not found", which is why a foreign or malformed brand id is a 404
   * (un-enumerable, NFR-S5) and never a 403. Only the header case costs a query.
   */
  async function resolveBrand(
    principal: Principal,
    header: string | string[] | undefined,
  ): Promise<string | undefined> {
    const raw = Array.isArray(header) ? header[0] : header;
    if (!raw) return undefined;
    if (!UUID_RE.test(raw)) throw ApiError.notFound('Brand not found.');
    const brand = await withTenant(app.db, tenantOf(principal), (tx) =>
      tx.brand.findFirst({ where: { id: raw }, select: { id: true } }),
    );
    if (!brand) throw ApiError.notFound('Brand not found.');
    return brand.id;
  }

  /**
   * `public: true` short-circuits authentication, so a route that also declares
   * scopes or a minimum role would silently accept anonymous callers — the
   * declaration would read as protected while being wide open. Fail at boot
   * rather than let that combination exist.
   */
  app.addHook('onRoute', (route) => {
    const config = route.config as {
      public?: boolean;
      scopes?: string[];
      minimumRole?: string;
      exactRole?: string;
    };
    if (!config?.public) return;
    if (config.scopes?.length || config.minimumRole || config.exactRole) {
      throw new Error(
        `Route ${route.method} ${route.url} is marked public but declares authorization ` +
          `requirements (scopes/minimumRole/exactRole). A public route cannot enforce them.`,
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

    // --- Brand context (Multibrand, PRD §5.3) -----------------------------
    // `X-Nexa-Brand` scopes the request to one brand of the caller's license, so
    // a brand-scoped table (channels) sees only that brand's rows. Resolved
    // before the IP check below, because that check runs inside `withTenant` and
    // would otherwise carry a half-built context. Brand is an agent/bot concept
    // like scopes — a customer token names none.
    if (principal.kind !== 'customer') {
      request.brandId = await resolveBrand(principal, request.headers['x-nexa-brand']);
    }

    // --- IP allow-list (FR-MOD-08.9.6) ------------------------------------
    // A workspace may restrict its agent/admin surface to a set of source
    // networks. Enforced here — the one authenticated choke point — for the same
    // reason scopes are: a check left to individual handlers is one forgotten
    // call away from a hole. It runs after the principal-kind gate (a customer
    // token has already been turned away from agent routes) and before scope/role,
    // because a request from an excluded address is refused before its permissions
    // are even considered.
    //
    //   - Customer/widget principals are exempt. Their address control is the
    //     deny-list of FR-MOD-08.9.2 (`banned-ip.ts`), enforced at token mint and
    //     the chat edge; an allow-list written for the office network would lock
    //     out every visitor, which is not what "restrict the console" means.
    //   - `public: true` routes (login/authorize/token/revoke) are exempt, so a
    //     workspace that saves a list excluding its own current address can still
    //     sign in, clear it and recover — the list restricts the console, never
    //     bricks it.
    //   - `request.ip` is the proxy-attested address (see `trustProxy` in
    //     server.ts, narrowed to one hop): a client-supplied `X-Forwarded-For`
    //     cannot influence it, so the allow-list cannot be bypassed with a spoofed
    //     header.
    if (principal.kind !== 'customer' && !config.public) {
      // Read fresh on every request, never cached — the call license-gate.ts makes
      // and for the same reason: a cached list keeps admitting an address the
      // workspace just removed for the length of the TTL, which is exactly the
      // window an IP restriction exists to close. When enforcement is off (the
      // common case) this stops at a single indexed lookup before reading entries.
      //
      // license-gate.ts made this choice for a *per-mutation* read; this one runs
      // on *every* authenticated request, so the cost was measured before the same
      // decision was inherited (tm 80.9). The enforcement-off path (the common
      // case) is one indexed settings read in its own short tenant transaction:
      // ~1.1-1.2ms mean, p95 ~2ms on local Postgres. Enforcement-on adds the
      // entries read + match for only ~0.2ms more (~1.3-1.5ms mean, p95 ≤ ~2.5ms) —
      // the BEGIN/set_config/COMMIT dominates, the reads themselves are noise. Both
      // sit comfortably inside the NFR-U/NFR-P budget, so there is nothing to trade
      // the staleness window away for. Numbers + rejected-cache rationale: HANDOFF
      // tm 80.9.
      const denied = await request.withTenant(async (tx) => {
        const settings = await tx.securitySettings.findFirst({
          select: { ipAllowlistEnforced: true },
        });
        if (!settings?.ipAllowlistEnforced) return false;

        const entries = (await tx.ipAllowlistEntry.findMany({ select: { entry: true } })).map(
          (row) => row.entry,
        );
        // An empty list is *no restriction*, not "admit nobody" — `decideIpAccess`
        // owns that rule, and a non-empty-but-unmatchable list still denies.
        if (decideIpAccess({ clientIp: request.ip, entries }) === 'allow') return false;

        // Record the refusal, not the address. The principal kind and the token id
        // (the audit `target`, in the `<kind>:<id>` convention) say who was turned
        // away and with which credential; the raw IP is PII and stays out of the
        // log (NFR-C1/C2) — `ip: null` overrides the context's default of storing
        // it. Written inside this transaction so it commits before the throw below.
        await writeAuditEntry(tx, request.auditContext({ ip: null }), {
          action: 'auth.ip_denied',
          target: `token:${principal.tokenId}`,
          metadata: { principal_kind: principal.kind },
        });
        return true;
      });

      if (denied) {
        throw new ApiError('not_allowed', 'Access from your network is not permitted.');
      }
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

    if (config.exactRole) {
      if (principal.kind !== 'agent' || principal.role !== config.exactRole) {
        throw ApiError.authorization(`This action requires the ${config.exactRole} role.`);
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
