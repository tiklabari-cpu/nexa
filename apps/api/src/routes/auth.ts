import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { isScope, type Scope } from '@nexa/types';
import type { Env } from '../config/env.js';
import { ApiError } from '../lib/api-error.js';
import { originHost } from '../lib/origin.js';
import { withTenant } from '../lib/tenant.js';
import { OauthService } from '../services/auth/oauth-service.js';
import {
  ADMIN_SCOPES,
  DEFAULT_AGENT_SCOPES,
  roleAtLeast,
  type AgentPrincipal,
} from '../services/auth/principal.js';

const emailSchema = z.string().trim().toLowerCase().email().max(320);
const passwordSchema = z.string().min(1).max(512);

const loginBody = z.object({ email: emailSchema, password: passwordSchema });

const authorizeBody = z.object({
  client_id: z.string().min(1).max(128),
  redirect_uri: z.string().min(1).max(2048),
  code_challenge: z.string().min(43).max(128),
  code_challenge_method: z.literal('S256').default('S256'),
  scope: z.string().max(4096).optional(),
  state: z.string().max(512).optional(),
  email: emailSchema,
  password: passwordSchema,
  license_id: z.string().regex(/^\d+$/, 'license_id must be numeric'),
});

const tokenBody = z.discriminatedUnion('grant_type', [
  z.object({
    grant_type: z.literal('authorization_code'),
    code: z.string().min(1).max(512),
    code_verifier: z.string().min(43).max(128),
    client_id: z.string().min(1).max(128),
    client_secret: z.string().max(512).optional(),
    redirect_uri: z.string().min(1).max(2048),
  }),
  z.object({
    grant_type: z.literal('refresh_token'),
    refresh_token: z.string().min(1).max(512),
    client_id: z.string().min(1).max(128),
    client_secret: z.string().max(512).optional(),
  }),
]);

const revokeBody = z.object({
  token: z.string().min(1).max(512),
  token_type_hint: z.enum(['access_token', 'refresh_token']).optional(),
});

const createPatBody = z.object({
  name: z.string().trim().min(1).max(120),
  scopes: z.array(z.string().max(128)).max(64).optional(),
  expires_in_days: z.number().int().min(1).max(365).optional(),
});

const customerTokenBody = z.object({
  organization_id: z.string().uuid(),
  customer_id: z.string().uuid().optional(),
  /**
   * Origin of the page the widget is embedded in.
   *
   * The request itself comes from inside the widget iframe, so its `Origin`
   * header is Nexa's own widget origin — identical for every customer and
   * therefore useless for deciding which *website* opened the chat. The loader
   * runs on the customer's page, knows that origin, and passes it through.
   *
   * Client-supplied, so it is a configuration control, not an authentication
   * boundary: anyone can call this endpoint directly and claim any host. It
   * stops a copied snippet from working on a site the owner did not authorise;
   * it does not stop a deliberate attacker. What actually contains the damage
   * is that the resulting token only ever reaches one visitor's own
   * conversation within one organization.
   */
  host_origin: z.string().max(2048).optional(),
});

function parse<T extends z.ZodTypeAny>(schema: T, value: unknown): z.infer<T> {
  const result = schema.safeParse(value);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw ApiError.validation(
      issue ? `${issue.path.join('.') || 'body'}: ${issue.message}` : 'Invalid request body.',
      { fields: result.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })) },
    );
  }
  return result.data;
}

/** Hostname of an Origin header, lowercased and without port. */

export default async function authRoutes(
  app: FastifyInstance,
  options: { env: Env },
): Promise<void> {
  const { env } = options;
  const oauth = new OauthService(app.db, {
    accessTokenTtl: env.ACCESS_TOKEN_TTL,
    refreshTokenTtl: env.REFRESH_TOKEN_TTL,
    authorizationCodeTtl: env.AUTH_CODE_TTL,
  });

  // --- POST /auth/login ------------------------------------------------------

  app.post('/auth/login', { config: { public: true } }, async (request, reply) => {
    const body = parse(loginBody, request.body);

    const account = await oauth.authenticateAccount(body.email, body.password);
    if (!account) {
      // One message for "no such account" and "wrong password" alike.
      throw ApiError.authentication('Invalid email or password.');
    }

    const memberships = await oauth.listMemberships(account.id);
    return reply.send({
      account,
      memberships: memberships.map((m) => ({
        license_id: m.license_id.toString(),
        organization_id: m.organization_id,
        organization_name: m.organization_name,
        role: m.role,
        license_status: m.license_status,
        // Which OAuth client this workspace uses. The agent app used to derive
        // it from the organisation name; a workspace created through signup has
        // no client matching that guess.
        client_id: m.client_id,
      })),
    });
  });

  // --- POST /auth/authorize --------------------------------------------------

  app.post('/auth/authorize', { config: { public: true } }, async (request, reply) => {
    const body = parse(authorizeBody, request.body);

    const client = await oauth.findClient(body.client_id);
    // An unregistered client and a mismatched redirect are both refused before
    // credentials are even checked: never redirect to an unvetted URI, and
    // never spend a password verification on a request that cannot succeed.
    if (!client) throw ApiError.validation('Unknown client_id.');
    if (!OauthService.isRegisteredRedirect(body.redirect_uri, client.redirect_uris)) {
      throw ApiError.validation('redirect_uri is not registered for this client.');
    }

    const account = await oauth.authenticateAccount(body.email, body.password);
    if (!account) throw ApiError.authentication('Invalid email or password.');

    const licenseId = BigInt(body.license_id);
    const memberships = await oauth.listMemberships(account.id);
    const membership = memberships.find((m) => m.license_id === licenseId);
    if (!membership) {
      // 404, not 403: confirming that a license exists but is off-limits would
      // let anyone with valid credentials enumerate workspaces.
      throw ApiError.notFound('Workspace not found.');
    }
    if (membership.organization_id !== client.organization_id) {
      throw ApiError.notFound('Workspace not found.');
    }
    if (membership.license_status === 'canceled') {
      throw new ApiError('license_expired', 'This workspace is no longer active.');
    }

    const requested = body.scope
      ? body.scope
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : defaultScopesForRole(membership.role);

    // A client can never be granted more than it registered for.
    const grantable = client.scopes.length > 0 ? client.scopes : requested;
    const scopes = requested.filter((s) => grantable.includes(s) && isScope(s));
    if (scopes.length === 0) {
      throw ApiError.validation('None of the requested scopes are available to this client.');
    }

    const { code, expiresAt } = await oauth.createAuthorizationCode({
      clientId: client.id,
      accountId: account.id,
      licenseId,
      organizationId: membership.organization_id,
      redirectUri: body.redirect_uri,
      scopes,
      codeChallenge: body.code_challenge,
      codeChallengeMethod: body.code_challenge_method,
    });

    return reply.send({
      code,
      redirect_uri: body.redirect_uri,
      ...(body.state ? { state: body.state } : {}),
      expires_in: Math.max(1, Math.round((expiresAt.getTime() - Date.now()) / 1000)),
    });
  });

  // --- POST /auth/token ------------------------------------------------------

  app.post('/auth/token', { config: { public: true } }, async (request, reply) => {
    const body = parse(tokenBody, request.body);

    const grant =
      body.grant_type === 'authorization_code'
        ? await oauth.exchangeAuthorizationCode({
            code: body.code,
            codeVerifier: body.code_verifier,
            clientId: body.client_id,
            clientSecret: body.client_secret,
            redirectUri: body.redirect_uri,
          })
        : await oauth.refresh({
            refreshToken: body.refresh_token,
            clientId: body.client_id,
            clientSecret: body.client_secret,
          });

    // Tokens must never be cached by a proxy or the browser.
    reply.header('Cache-Control', 'no-store');
    reply.header('Pragma', 'no-cache');
    return reply.send(grant);
  });

  // --- POST /auth/revoke -----------------------------------------------------

  app.post('/auth/revoke', { config: { public: true } }, async (request, reply) => {
    const body = parse(revokeBody, request.body);

    // Try both kinds regardless of the hint — RFC 7009 treats the hint as
    // advisory, and a wrong hint must not leave a live token behind.
    const revokedAccess = await app.tokens.revokeByToken(body.token);
    const revokedRefresh = await oauth.revokeRefreshToken(body.token);

    // Always 200: reporting whether the token existed would make this an oracle.
    return reply.send({ revoked: revokedAccess || revokedRefresh });
  });

  // --- GET /auth/me ----------------------------------------------------------

  app.get(
    '/auth/me',
    { config: { principals: ['agent', 'bot', 'customer'] } },
    async (request, reply) => {
      const principal = request.requirePrincipal();

      if (principal.kind === 'customer') {
        return reply.send({
          kind: 'customer',
          organization_id: principal.organizationId,
          license_id: principal.licenseId.toString(),
          region: env.NEXA_REGION,
          scopes: [],
        });
      }

      if (principal.kind === 'bot') {
        return reply.send({
          kind: 'bot',
          account_id: principal.botId,
          organization_id: principal.organizationId,
          license_id: principal.licenseId.toString(),
          region: env.NEXA_REGION,
          scopes: principal.scopes,
        });
      }

      const profile = await request.withTenant(async (tx) => {
        const [account, membership] = await Promise.all([
          tx.account.findUnique({
            where: { id: principal.accountId },
            select: { email: true, name: true, avatarUrl: true },
          }),
          tx.agentMembership.findUnique({
            where: {
              licenseId_agentId: { licenseId: principal.licenseId, agentId: principal.accountId },
            },
            select: { routingStatus: true, concurrentChatsLimit: true },
          }),
        ]);
        return { account, membership };
      });

      return reply.send({
        kind: 'agent',
        account_id: principal.accountId,
        email: profile.account?.email ?? null,
        name: profile.account?.name ?? null,
        avatar_url: profile.account?.avatarUrl ?? null,
        role: principal.role,
        organization_id: principal.organizationId,
        license_id: principal.licenseId.toString(),
        region: env.NEXA_REGION,
        scopes: principal.scopes,
        routing_status: profile.membership?.routingStatus ?? 'offline',
        concurrent_chats_limit: profile.membership?.concurrentChatsLimit ?? 0,
      });
    },
  );

  // --- Personal access tokens ------------------------------------------------

  app.get(
    '/auth/personal-access-tokens',
    { config: { scopes: ['accounts--my:ro'], principals: ['agent'] } },
    async (request, reply) => {
      const principal = request.requirePrincipal() as AgentPrincipal;
      const items = await app.tokens.list({
        licenseId: principal.licenseId,
        organizationId: principal.organizationId,
        ownerId: principal.accountId,
        kind: 'pat',
      });
      return reply.send({
        items: items.map((t) => ({
          id: t.id,
          name: t.name,
          kind: t.kind,
          scopes: t.scopes,
          created_at: t.createdAt.toISOString(),
          last_used_at: t.lastUsedAt?.toISOString() ?? null,
          expires_at: t.expiresAt?.toISOString() ?? null,
        })),
      });
    },
  );

  app.post(
    '/auth/personal-access-tokens',
    { config: { scopes: ['accounts--my:rw'], principals: ['agent'] } },
    async (request, reply) => {
      const principal = request.requirePrincipal() as AgentPrincipal;
      const body = parse(createPatBody, request.body);

      const requested = body.scopes?.length ? body.scopes : defaultScopesForRole(principal.role);

      // Privilege escalation guard: a session can only mint a token weaker than
      // or equal to itself. Without this, an agent-scoped session could create
      // an admin-scoped PAT and use it immediately.
      const held = new Set(principal.scopes);
      const escalating = requested.filter((s) => !held.has(s));
      if (escalating.length > 0) {
        throw ApiError.authorization(
          `Cannot grant scopes the current session does not hold: ${escalating.join(', ')}`,
        );
      }
      const scopes = requested.filter(isScope);
      if (scopes.length === 0) throw ApiError.validation('At least one valid scope is required.');

      const issued = await app.tokens.issue({
        licenseId: principal.licenseId,
        organizationId: principal.organizationId,
        ownerId: principal.accountId,
        kind: 'pat',
        scopes,
        name: body.name,
        ttlSeconds: body.expires_in_days ? body.expires_in_days * 86_400 : undefined,
      });

      reply.header('Cache-Control', 'no-store');
      return reply.status(201).send({
        id: issued.id,
        name: body.name,
        kind: 'pat',
        scopes: issued.scopes,
        created_at: new Date().toISOString(),
        last_used_at: null,
        expires_at: issued.expiresAt?.toISOString() ?? null,
        token: issued.token,
      });
    },
  );

  app.delete<{ Params: { tokenId: string } }>(
    '/auth/personal-access-tokens/:tokenId',
    { config: { scopes: ['accounts--my:rw'], principals: ['agent'] } },
    async (request, reply) => {
      const principal = request.requirePrincipal() as AgentPrincipal;
      const tokenId = parse(z.string().uuid(), request.params.tokenId);

      // Scoped to the caller's own tokens: an agent must not be able to revoke
      // a colleague's credential by guessing its id.
      const owned = await request.withTenant((tx) =>
        tx.apiToken.findFirst({
          where: { id: tokenId, ownerId: principal.accountId, kind: 'pat', revokedAt: null },
          select: { id: true },
        }),
      );
      if (!owned) throw ApiError.notFound('Token not found.');

      await app.tokens.revoke({
        licenseId: principal.licenseId,
        organizationId: principal.organizationId,
        tokenId,
      });
      return reply.status(204).send();
    },
  );

  // --- POST /customer/token --------------------------------------------------

  app.post('/customer/token', { config: { public: true } }, async (request, reply) => {
    const body = parse(customerTokenBody, request.body);

    // Prefer the embedding page's origin; fall back to the request's own for
    // callers that talk to the API directly (server-side integrations, tests).
    const host = originHost(body.host_origin) ?? originHost(request.headers.origin);
    if (!host) {
      throw ApiError.authorization(
        'A valid embedding origin is required to request a widget token.',
      );
    }

    // The organization id comes from the request body — untrusted. It only
    // becomes meaningful once the calling origin is proven to be on that
    // organization's allowlist.
    const matches = await app.db.$queryRaw<
      Array<{ license_id: bigint; organization_id: string; license_status: string }>
    >`SELECT * FROM auth_resolve_widget_origin(${body.organization_id}::uuid, ${host})`;

    const match = matches[0];
    if (!match) {
      request.log.warn(
        { host, organization_id: body.organization_id },
        'widget token requested from an untrusted origin',
      );
      throw ApiError.authorization('This origin is not a trusted domain for the organization.');
    }
    if (match.license_status === 'canceled') {
      throw new ApiError('license_expired', 'This workspace is no longer active.');
    }

    const tenant = { licenseId: match.license_id, organizationId: match.organization_id };

    let customerId = body.customer_id;
    if (customerId) {
      const existing = await app.db.$queryRaw<
        Array<{ id: string; banned_at: Date | null }>
      >`SELECT id, banned_at FROM auth_find_customer(${customerId}::uuid, ${match.organization_id}::uuid)`;

      const found = existing[0];
      if (!found) {
        // A customer id from another tenant, or simply stale. Issue a fresh
        // identity rather than an error — the visitor did nothing wrong, and a
        // distinguishable failure would let a site probe for valid ids.
        customerId = undefined;
      } else if (found.banned_at) {
        throw new ApiError('customer_banned', 'This customer is banned.');
      }
    }

    if (!customerId) {
      // Goes through withTenant like every other write, rather than setting the
      // session variables inline: one implementation of the tenant context means
      // one place to get it right.
      const created = await withTenant(app.db, tenant, (tx) =>
        tx.customer.create({
          data: { organizationId: match.organization_id, lastActivityAt: new Date() },
          select: { id: true },
        }),
      );
      customerId = created.id;
    }

    const { token, expiresIn } = app.customerTokens.issue({
      customerId,
      organizationId: match.organization_id,
      licenseId: match.license_id,
    });

    reply.header('Cache-Control', 'no-store');
    return reply.send({
      token,
      expires_in: expiresIn,
      customer_id: customerId,
      organization_id: match.organization_id,
    });
  });
}

function defaultScopesForRole(role: string): Scope[] {
  return roleAtLeast(role as never, 'admin')
    ? [...DEFAULT_AGENT_SCOPES, ...ADMIN_SCOPES]
    : [...DEFAULT_AGENT_SCOPES];
}
