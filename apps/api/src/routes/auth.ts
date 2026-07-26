import type { FastifyInstance, FastifyRequest } from 'fastify';
import { Prisma, type PrismaClient } from '@prisma/client';
import { z } from 'zod';
import {
  isScope,
  normalizeWidgetAppearance,
  type PreChatFormField,
  type Scope,
  type WidgetAppearance,
} from '@nexa/types';
import type { Env } from '../config/env.js';
import { ApiError } from '../lib/api-error.js';
import { originHost } from '../lib/origin.js';
import { withTenant, type TenantContext } from '../lib/tenant.js';
import { CustomFieldService } from '../services/custom-fields/custom-field-service.js';
import {
  writeAuditEntry,
  type AuditContext,
  type AuditEntry,
} from '../services/audit/audit-log.js';
import { OauthService } from '../services/auth/oauth-service.js';
import { markWebsiteConnected } from '../services/websites/website-service.js';
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
  // Our own widget origin. A token request whose host resolves to this is the
  // hosted Chat page (FR-MOD-08.5.9), exempt from the trusted-domain allowlist.
  const selfHost = originHost(env.WIDGET_BASE_URL);
  const oauth = new OauthService(app.db, {
    accessTokenTtl: env.ACCESS_TOKEN_TTL,
    refreshTokenTtl: env.REFRESH_TOKEN_TTL,
    authorizationCodeTtl: env.AUTH_CODE_TTL,
  });

  /**
   * Best-effort audit write. Authentication and credential management must not
   * fail because the trail could not be written, so unlike the config-change
   * handlers — which write the entry inside the action's own transaction and
   * roll back together — this logs and swallows. The normal path still records;
   * only a genuine write failure is dropped, and it is logged where it happened.
   */
  async function audit(
    request: FastifyRequest,
    tenant: { licenseId: bigint; organizationId: string },
    overrides: Partial<AuditContext>,
    entry: AuditEntry,
  ): Promise<void> {
    try {
      await withTenant(app.db, tenant, (tx) =>
        writeAuditEntry(
          tx,
          request.auditContext({ licenseId: tenant.licenseId, ...overrides }),
          entry,
        ),
      );
    } catch (err) {
      request.log.warn({ err, action: entry.action }, 'audit write failed');
    }
  }

  /**
   * Records a failed sign-in against the *registered client's* organization —
   * trusted data — rather than the `license_id` in the request body, which is
   * attacker-controlled and could otherwise plant an entry in an unrelated
   * workspace's log. The attempted address is deliberately not stored: it is
   * unverified and belongs to whoever was typed, not the workspace.
   */
  async function recordLoginFailure(
    request: FastifyRequest,
    organizationId: string,
  ): Promise<void> {
    try {
      const rows = await app.db.$queryRaw<Array<{ license_id: bigint; organization_id: string }>>`
        SELECT license_id, organization_id FROM auth_resolve_organization_license(${organizationId}::uuid)`;
      const license = rows[0];
      if (!license) return;
      await audit(
        request,
        { licenseId: license.license_id, organizationId: license.organization_id },
        { actorId: null, actorType: 'system' },
        { action: 'auth.login_failed', metadata: { reason: 'invalid_credentials' } },
      );
    } catch (err) {
      request.log.warn({ err }, 'failed to record login failure in audit log');
    }
  }

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
    if (!account) {
      await recordLoginFailure(request, client.organization_id);
      throw ApiError.authentication('Invalid email or password.');
    }

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

    // A password was verified and bound to this workspace — the audit-meaningful
    // "signed in". `/auth/login` lists a person's workspaces but selects none,
    // so it is not the sign-in event and is not recorded here.
    await audit(
      request,
      { licenseId, organizationId: membership.organization_id },
      { actorId: account.id, actorType: 'agent' },
      { action: 'auth.login', target: `client:${client.id}` },
    );

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
        const [account, membership, license] = await Promise.all([
          tx.account.findUnique({
            where: { id: principal.accountId },
            select: { email: true, name: true, avatarUrl: true },
          }),
          tx.agentMembership.findUnique({
            where: {
              licenseId_agentId: { licenseId: principal.licenseId, agentId: principal.accountId },
            },
            select: { routingStatus: true, concurrentChatsLimit: true, notifyEmail: true },
          }),
          // The onboarding gate: the shell reads this to decide whether to send a
          // new owner to the first-run wizard, so it rides along with the profile
          // the app already fetches on load rather than costing a second request.
          tx.license.findUnique({
            where: { id: principal.licenseId },
            select: { onboardingCompletedAt: true },
          }),
        ]);
        return { account, membership, license };
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
        notify_email: profile.membership?.notifyEmail ?? true,
        onboarding_completed: profile.license?.onboardingCompletedAt != null,
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

      // The scopes it can act with are the security-relevant part; the token
      // itself is never written anywhere but the response.
      await audit(
        request,
        request.tenant(),
        {},
        {
          action: 'pat.created',
          target: `token:${issued.id}`,
          metadata: { scopes: issued.scopes },
        },
      );

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

      await audit(
        request,
        request.tenant(),
        {},
        {
          action: 'pat.revoked',
          target: `token:${tokenId}`,
        },
      );

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

    // The organization id comes from the request body — untrusted. For an embed
    // it only becomes meaningful once the calling origin is proven to be on that
    // organization's allowlist. The one exception is our own hosted Chat page
    // (FR-MOD-08.5.9): a page we serve, on our own origin, is a public chat link
    // by design, so it resolves the licence directly instead of the allowlist —
    // see the decision recorded in PLAN.md §C.
    const isChatPage = selfHost !== null && host === selfHost;
    const matches = await app.db.$queryRaw<
      Array<{ license_id: bigint; organization_id: string; license_status: string }>
    >(
      isChatPage
        ? Prisma.sql`SELECT * FROM auth_resolve_organization_license(${body.organization_id}::uuid)`
        : Prisma.sql`SELECT * FROM auth_resolve_widget_origin(${body.organization_id}::uuid, ${host})`,
    );

    const match = matches[0];
    if (!match) {
      request.log.warn(
        { host, organization_id: body.organization_id, isChatPage },
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

    // The widget just proved it is live on this origin, so a website added for
    // this domain (FR-MOD-08.5.2) becomes Connected here — the earliest reliable
    // server-side signal. Best-effort: a failure must not deny the visitor a
    // token, and a domain tracked only as a trusted domain matches nothing.
    try {
      await withTenant(app.db, tenant, (tx) => markWebsiteConnected(tx, host));
    } catch (error) {
      request.log.warn({ err: error, host }, 'failed to mark website connected');
    }

    // The widget's appearance (FR-MOD-11.7), so the hosted Chat page — which has
    // no snippet to bake it into — and any embed running a stale snippet theme
    // themselves from the server as the source of truth. Alongside it, the
    // pre-chat form (FR-MOD-08.7.7): the fields the widget asks before the chat
    // starts. Both best-effort — the widget falls back to the shipped look and no
    // extra fields, so a read failure must never deny a token.
    const [widget, preChatForm] = await Promise.all([
      widgetAppearance(app.db, tenant, request),
      readPreChatForm(app.db, tenant, request),
    ]);

    reply.header('Cache-Control', 'no-store');
    return reply.send({
      token,
      expires_in: expiresIn,
      customer_id: customerId,
      organization_id: match.organization_id,
      widget,
      pre_chat_form: preChatForm,
    });
  });
}

/**
 * The widget appearance for a resolved license, or the shipped defaults when it
 * has never been customised or the read fails. Guarded so this never breaks
 * token issuance: the widget renders the default look if `widget` is absent.
 */
async function widgetAppearance(
  db: PrismaClient,
  tenant: TenantContext,
  request: FastifyRequest,
): Promise<WidgetAppearance> {
  try {
    const row = await withTenant(db, tenant, (tx) => tx.widgetSettings.findFirst());
    return normalizeWidgetAppearance(
      row
        ? {
            primary_color: row.primaryColor,
            position: row.position as WidgetAppearance['position'],
            theme: row.theme as WidgetAppearance['theme'],
            mobile_fullscreen: row.mobileFullscreen,
            powered_by: row.poweredBy,
          }
        : null,
    );
  } catch (error) {
    request.log.warn({ err: error }, 'failed to read widget appearance');
    return normalizeWidgetAppearance(null);
  }
}

/**
 * The workspace's pre-chat form fields (FR-MOD-08.7.7), or an empty list when
 * none are configured or the read fails. Guarded like the appearance so a form
 * lookup never breaks token issuance — the widget simply shows no extra fields.
 */
async function readPreChatForm(
  db: PrismaClient,
  tenant: TenantContext,
  request: FastifyRequest,
): Promise<PreChatFormField[]> {
  try {
    const fields = new CustomFieldService();
    return await withTenant(db, tenant, (tx) => fields.listPreChatForm(tx, tenant));
  } catch (error) {
    request.log.warn({ err: error }, 'failed to read pre-chat form');
    return [];
  }
}

function defaultScopesForRole(role: string): Scope[] {
  return roleAtLeast(role as never, 'admin')
    ? [...DEFAULT_AGENT_SCOPES, ...ADMIN_SCOPES]
    : [...DEFAULT_AGENT_SCOPES];
}
