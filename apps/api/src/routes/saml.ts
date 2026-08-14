/**
 * SAML service-provider endpoints (NFR-S11 · S11-d).
 *
 * Two routes complete the federation the previous subtasks built: one starts a
 * login by sending the browser to the workspace's identity provider, the other
 * receives what comes back and turns it into a session.
 *
 * ## Why "verify" and "sign in" are one piece of work
 *
 * `saml.ts` (S11-b) decides whether an assertion may be believed. Deciding
 * *which account* a believed assertion is, and whether that account may be
 * created on the spot, is a separate and larger question — it is an
 * authorization decision, and it is the one this file owns. Splitting it from
 * the verification would leave a released state in which an assertion can be
 * proven genuine but the rule for the account it maps to is written nowhere:
 * the safe behaviour for "verified but unknown person" (refuse? provision? with
 * which role?) would be whatever the next window happened to choose.
 *
 * ## No second way to mint a session
 *
 * The ACS does **not** issue tokens. It ends exactly where `POST /auth/authorize`
 * ends — with a single-use authorization code — and the browser redeems it at
 * `/auth/token` like any other sign-in, so `OauthService#issueGrant` stays the
 * only code path in the product that mints an access token. A second issuing
 * path would be a second place for rotation, family revocation and scope
 * ceilings to drift out of agreement. It also keeps the PKCE verifier with the
 * browser that started the login, so an assertion replayed into somebody else's
 * session cannot complete one.
 *
 * That is the shape of `/login`: it takes `client_id`, `redirect_uri` and
 * `code_challenge` — the same three things `/auth/authorize` takes — parks them
 * server-side under a relay handle, and picks them back up when the IdP answers.
 * Nothing security-relevant travels through the IdP except an opaque id.
 */
import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { isScope } from '@nexa/types';
import type { Env } from '../config/env.js';
import { ApiError } from '../lib/api-error.js';
import { activePreviousCertificate, readSsoAttributeMapping } from '../lib/sso-connection.js';
import { createRedisReplayGuard, verifySamlResponse, type SamlRejection } from '../lib/saml.js';
import {
  buildAuthnRequest,
  resolveSsoIdentity,
  ssoAcsUrl,
  ssoEntityId,
  type SsoIdentityRejection,
} from '../lib/saml-sp.js';
import { withTenant } from '../lib/tenant.js';
import { writeAuditEntry, type AuditEntry } from '../services/audit/audit-log.js';
import { OauthService } from '../services/auth/oauth-service.js';
import { defaultScopesForRole } from './auth.js';

/**
 * How long a started login may sit unfinished.
 *
 * Long enough for somebody to be walked through a password, a push
 * notification and a hardware key at the identity provider; short enough that
 * the window in which a stolen relay handle is worth anything closes on its
 * own. Ten minutes is what the major IdPs default their own request lifetime to.
 */
export const SAML_REQUEST_TTL_SECONDS = 600;

/**
 * The role a just-in-time provisioned membership gets: the least this product
 * has. A workspace that wants somebody to administer it promotes them, and that
 * promotion then survives every later sign-in (see the provisioning resolver).
 */
const JIT_ROLE = 'agent';

const connectionParams = z.object({ connectionId: z.string().uuid() });

/**
 * The same three fields `POST /auth/authorize` takes, for the same reasons —
 * see the file header. `state` is stored rather than forwarded to the IdP: the
 * client gets its own value back untouched, and the IdP never sees it.
 */
const loginQuery = z.object({
  client_id: z.string().min(1).max(128),
  redirect_uri: z.string().min(1).max(2048),
  code_challenge: z.string().min(43).max(128),
  code_challenge_method: z.literal('S256').default('S256'),
  state: z.string().max(512).optional(),
});

/**
 * The HTTP-POST binding: `SAMLResponse` is base64, `RelayState` is whatever we
 * sent on the way out. Both bounded here — the endpoint is unauthenticated, and
 * the verifier's own size ceiling should not be the first thing to meet a
 * payload sized to be expensive.
 */
const acsBody = z.object({
  SAMLResponse: z.string().min(1).max(1_048_576),
  RelayState: z.string().max(256).optional(),
});

/** What `/login` parks under a relay handle for `/acs` to pick up. */
interface PendingAuthnRequest {
  /** `AuthnRequest/@ID`, which the assertion must echo as `InResponseTo`. */
  requestId: string;
  connectionId: string;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  state?: string;
}

/** A connection as `auth_find_sso_connection` returns it. */
interface SsoConnectionRow {
  id: string;
  license_id: bigint;
  organization_id: string;
  license_status: string;
  idp_entity_id: string;
  idp_sso_url: string;
  idp_certificate_pem: string;
  previous_certificate_pem: string | null;
  previous_certificate_expires_at: Date | null;
  attribute_mapping: unknown;
  allow_idp_initiated: boolean;
  enabled: boolean;
}

/** Everything a refusal may name in the audit trail. */
type LoginRejection =
  | SamlRejection
  | SsoIdentityRejection
  /** `RelayState` named a request we have no record of, or one for another connection. */
  | 'unknown_relay_state'
  /** The client that started the login is gone, or registers no usable scope. */
  | 'client_unavailable'
  /** No membership this person may sign in with — suspended, or awaiting approval. */
  | 'membership_not_active';

function parse<T extends z.ZodTypeAny>(schema: T, value: unknown): z.infer<T> {
  const result = schema.safeParse(value);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw ApiError.validation(
      issue ? `${issue.path.join('.') || 'request'}: ${issue.message}` : 'Invalid request.',
    );
  }
  return result.data;
}

export default async function samlRoutes(
  app: FastifyInstance,
  options: {
    env: Env;
    /** `API_BASE_URL` + the version prefix — the base every SP URL is built on. */
    apiBase: string;
  },
): Promise<void> {
  const { env, apiBase } = options;
  const oauth = new OauthService(app.db, {
    accessTokenTtl: env.ACCESS_TOKEN_TTL,
    refreshTokenTtl: env.REFRESH_TOKEN_TTL,
    authorizationCodeTtl: env.AUTH_CODE_TTL,
  });

  /**
   * The identity provider posts an HTML form, so the response arrives as
   * `application/x-www-form-urlencoded` — the one place in this API that is not
   * JSON. Registered inside this plugin, so it applies to these two routes and
   * changes nothing about how the rest of the API reads a body.
   *
   * `URLSearchParams` rather than a dependency: it is the WHATWG parser Node
   * already ships, it does not invent the `a[b]=c` nesting a query-string
   * library would, and the two fields read below are flat strings.
   */
  app.addContentTypeParser(
    'application/x-www-form-urlencoded',
    { parseAs: 'string' },
    (_request, body, done) => {
      try {
        done(null, Object.fromEntries(new URLSearchParams(body as string)));
      } catch (error) {
        done(error as Error, undefined);
      }
    },
  );

  /**
   * The connection this request is about, or a 404.
   *
   * Both endpoints are unauthenticated, so this read cannot run under a tenant
   * context — it goes through a SECURITY DEFINER resolver (see the migration).
   * Everything downstream takes its tenant from the row this returns and never
   * from anything the caller sent.
   *
   * Missing, disabled and belonging-to-a-canceled-workspace are all "not
   * found": a connection id is a URL somebody may paste anywhere, and the
   * difference between "no such connection" and "that workspace has SSO turned
   * off" is not something an anonymous caller should be able to measure.
   */
  async function findConnection(connectionId: string): Promise<SsoConnectionRow> {
    const rows = await app.db.$queryRaw<SsoConnectionRow[]>`
      SELECT * FROM auth_find_sso_connection(${connectionId}::uuid)`;
    const row = rows[0];
    if (!row || !row.enabled || row.license_status === 'canceled') {
      throw ApiError.notFound('Single sign-on is not available for this connection.');
    }
    return row;
  }

  /**
   * Audit under the connection's own license.
   *
   * Best-effort, for the same reason `/auth/login`'s is: a sign-in must not fail
   * because the trail could not be written. The tenant is the connection's, so
   * an entry can never land in a workspace the caller merely named.
   */
  async function audit(
    request: FastifyRequest,
    connection: SsoConnectionRow,
    entry: AuditEntry,
    actorId: string | null = null,
  ): Promise<void> {
    try {
      await withTenant(
        app.db,
        { licenseId: connection.license_id, organizationId: connection.organization_id },
        (tx) =>
          writeAuditEntry(
            tx,
            request.auditContext({
              licenseId: connection.license_id,
              actorId,
              actorType: actorId ? 'agent' : 'system',
            }),
            entry,
          ),
      );
    } catch (err) {
      request.log.warn({ err, action: entry.action }, 'audit write failed');
    }
  }

  /**
   * Record a refusal and throw.
   *
   * The reason is written to the trail but never returned. A caller learning
   * that its assertion failed on `audience_mismatch` rather than
   * `invalid_signature` is being told which half of the forgery to fix; the
   * workspace's own admins read the same reason in the audit log, where the
   * information is useful and the reader is already trusted.
   */
  async function refuse(
    request: FastifyRequest,
    connection: SsoConnectionRow,
    reason: LoginRejection,
  ): Promise<never> {
    await audit(request, connection, {
      action: 'auth.sso_login_failed',
      target: `sso_connection:${connection.id}`,
      metadata: { reason },
    });
    throw ApiError.authentication('Single sign-on failed.');
  }

  function relayKey(relayState: string): string {
    return `saml:relay:${relayState}`;
  }

  /**
   * Read a pending request and spend it in the same breath.
   *
   * The `DEL` result decides it, not the `GET`: two submissions of one captured
   * response both read the record, and only the one whose delete removed it may
   * continue. A read-then-use would let both through — the same race the
   * assertion replay guard closes a layer down, and it matters here too, because
   * this is what stops one AuthnRequest from authorising two sessions.
   */
  async function consumeRelay(relayState: string): Promise<PendingAuthnRequest | null> {
    const key = relayKey(relayState);
    const raw = await app.redis.get(key);
    if (raw === null) return null;
    if ((await app.redis.del(key)) !== 1) return null;
    try {
      return JSON.parse(raw) as PendingAuthnRequest;
    } catch {
      return null;
    }
  }

  // --- GET /auth/saml/:connectionId/login ------------------------------------

  app.get<{ Params: { connectionId: string } }>(
    '/auth/saml/:connectionId/login',
    { config: { public: true } },
    async (request, reply) => {
      const { connectionId } = parse(connectionParams, request.params);
      const query = parse(loginQuery, request.query);

      const connection = await findConnection(connectionId);

      // The client and the redirect are settled here, before the browser leaves
      // for the IdP, and the accepted values are then held server-side. By the
      // time a code exists there is nothing left to validate, so the redirect
      // carrying it cannot be pointed anywhere: an unregistered `redirect_uri`
      // fails at the start of the login rather than at the end, with a
      // credential already in hand.
      const client = await oauth.findClient(query.client_id);
      if (!client || client.organization_id !== connection.organization_id) {
        // One message for "no such client" and "a client of another workspace":
        // a connection id is public enough, the client registry is not.
        throw ApiError.validation('Unknown client_id.');
      }
      if (!OauthService.isRegisteredRedirect(query.redirect_uri, client.redirect_uris)) {
        throw ApiError.validation('redirect_uri is not registered for this client.');
      }

      const relayState = `_${randomUUID().replace(/-/g, '')}`;
      const authn = buildAuthnRequest({
        idpSsoUrl: connection.idp_sso_url,
        spEntityId: ssoEntityId(apiBase, connection.id),
        acsUrl: ssoAcsUrl(apiBase, connection.id),
        relayState,
        issueInstant: new Date(),
      });

      const pending: PendingAuthnRequest = {
        requestId: authn.id,
        connectionId: connection.id,
        clientId: client.id,
        redirectUri: query.redirect_uri,
        codeChallenge: query.code_challenge,
        ...(query.state === undefined ? {} : { state: query.state }),
      };
      // Redis rather than a table: this is a ten-minute correlation record, not
      // a credential and not something anybody audits. It expires on its own, it
      // is consumed atomically, and losing the lot to a restart costs exactly one
      // retried sign-in. The assertion replay guard already lives here, so the
      // whole SAML exchange has one piece of infrastructure behind it, not two.
      await app.redis.set(
        relayKey(relayState),
        JSON.stringify(pending),
        'EX',
        SAML_REQUEST_TTL_SECONDS,
      );

      reply.header('Cache-Control', 'no-store');
      return reply.redirect(authn.redirectUrl, 302);
    },
  );

  // --- POST /auth/saml/:connectionId/acs -------------------------------------

  app.post<{ Params: { connectionId: string } }>(
    '/auth/saml/:connectionId/acs',
    { config: { public: true } },
    async (request, reply) => {
      const { connectionId } = parse(connectionParams, request.params);
      const body = parse(acsBody, request.body);

      const connection = await findConnection(connectionId);

      // A relay handle we do not recognise is refused rather than treated as an
      // unsolicited login. Falling through would let anybody downgrade a
      // solicited exchange — one bound to a specific AuthnRequest — into the
      // unbound flow simply by mangling the field.
      const pending = body.RelayState ? await consumeRelay(body.RelayState) : null;
      if (body.RelayState && pending?.connectionId !== connection.id) {
        return refuse(request, connection, 'unknown_relay_state');
      }

      const now = new Date();
      const overlap = activePreviousCertificate(
        {
          previousCertificatePem: connection.previous_certificate_pem,
          previousCertificateExpiresAt: connection.previous_certificate_expires_at,
        },
        now,
      );

      const verification = await verifySamlResponse(
        body.SAMLResponse,
        {
          idpEntityId: connection.idp_entity_id,
          // Per connection, so an assertion minted for one workspace names that
          // workspace and is refused by every other — even when two workspaces
          // federate the same identity provider.
          spEntityId: ssoEntityId(apiBase, connection.id),
          acsUrl: ssoAcsUrl(apiBase, connection.id),
          // The overlap is read through `activePreviousCertificate`, so a lapsed
          // rotation window is simply not in this list (§C-A17.1).
          certificates: overlap
            ? [connection.idp_certificate_pem, overlap.pem]
            : [connection.idp_certificate_pem],
          inResponseTo: pending?.requestId ?? null,
          allowIdpInitiated: connection.allow_idp_initiated,
        },
        now,
        // Scoped to the connection, so one workspace's traffic can neither
        // observe nor exhaust another's assertion ids.
        createRedisReplayGuard(app.redis, connection.id),
      );
      if (!verification.ok) return refuse(request, connection, verification.reason);

      // --- Unsolicited (IdP-initiated) ---------------------------------------
      // The assertion is genuine, but no AuthnRequest of ours is behind it, so
      // there is no client, no redirect and — the part that matters — no PKCE
      // verifier held by any browser. Minting a code here would mean issuing one
      // nobody proved they asked for, which is the flow OAuth 2.1 removed.
      //
      // The login is therefore *converted* rather than completed: the browser is
      // sent to the app, which immediately starts an ordinary SP-initiated login
      // with its own verifier. The person still has a session at the IdP, so the
      // second leg is silent and they land where the tile promised. Nothing is
      // recorded — no session was granted and no account was even resolved, and
      // an entry claiming a sign-in would misreport the trail (§C-A17.6).
      if (!pending) {
        reply.header('Cache-Control', 'no-store');
        return reply.redirect(
          `${env.WEB_APP_URL}/login?sso=${encodeURIComponent(connection.id)}`,
          302,
        );
      }

      const identity = resolveSsoIdentity(
        verification.assertion,
        readSsoAttributeMapping(connection.attribute_mapping),
      );
      if (!identity.ok) return refuse(request, connection, identity.reason);

      // Re-read rather than trusting the handle: a client deleted between the
      // start of the login and the response must not still be able to receive a
      // code, and its registered scope ceiling has to be the one in force now.
      const client = await oauth.findClient(pending.clientId);
      if (!client || client.organization_id !== connection.organization_id) {
        return refuse(request, connection, 'client_unavailable');
      }

      // Just-in-time provisioning. The resolver leaves an existing account and
      // an existing membership exactly as they are, so this cannot rename
      // somebody, cannot clear a password and cannot undo a suspension or a
      // promotion — all it can add is a membership in the workspace whose own
      // identity provider just vouched for the address.
      const [provisioned] = await app.db.$queryRaw<
        Array<{ account_id: string; account_created: boolean; membership_created: boolean }>
      >`SELECT * FROM auth_provision_sso_account(
          ${connection.license_id}, ${identity.identity.email}::citext,
          ${identity.identity.name}, ${JIT_ROLE})`;
      if (!provisioned) return refuse(request, connection, 'membership_not_active');

      // The one rule for "may this person sign in to this workspace", reused
      // rather than restated: `auth_list_memberships` already filters out
      // suspended and unapproved memberships, so a deprovisioned teammate whose
      // IdP still vouches for them finds no membership here and is refused.
      const memberships = await oauth.listMemberships(provisioned.account_id);
      const membership = memberships.find((m) => m.license_id === connection.license_id);
      if (!membership) return refuse(request, connection, 'membership_not_active');

      const requested = defaultScopesForRole(membership.role);
      // An empty registered set means "no ceiling" — the same reading
      // `/auth/authorize` gives it.
      const grantable = client.scopes.length > 0 ? client.scopes : requested;
      const scopes = requested.filter((s) => grantable.includes(s) && isScope(s));
      if (scopes.length === 0) return refuse(request, connection, 'client_unavailable');

      const { code } = await oauth.createAuthorizationCode({
        clientId: client.id,
        accountId: provisioned.account_id,
        licenseId: connection.license_id,
        organizationId: connection.organization_id,
        redirectUri: pending.redirectUri,
        scopes,
        codeChallenge: pending.codeChallenge,
        codeChallengeMethod: 'S256',
      });

      await audit(
        request,
        connection,
        {
          action: 'auth.sso_login',
          target: `sso_connection:${connection.id}`,
          // Flags and names only. The assertion's attributes are the person's
          // own data, and the certificate that verified them is already recorded
          // by fingerprint on the configuration entries.
          metadata: {
            client_id: client.id,
            role: membership.role,
            jit_provisioned: provisioned.membership_created,
            account_created: provisioned.account_created,
          },
        },
        provisioned.account_id,
      );

      // The authorization response, in the shape every OAuth client already
      // handles. `redirect_uri` was matched against the client's registered set
      // before the browser left for the IdP and has been server-side ever since,
      // so nothing in the exchange could have moved it.
      const target = new URL(pending.redirectUri);
      target.searchParams.append('code', code);
      if (pending.state !== undefined) target.searchParams.append('state', pending.state);

      reply.header('Cache-Control', 'no-store');
      return reply.redirect(target.toString(), 302);
    },
  );
}
