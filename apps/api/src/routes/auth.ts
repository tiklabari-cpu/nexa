import type { FastifyInstance, FastifyRequest } from 'fastify';
import { Prisma, type PrismaClient } from '@prisma/client';
import { z } from 'zod';
import {
  isScope,
  normalizeWidgetAppearance,
  servesRegion,
  type WidgetFormField,
  type Region,
  type WidgetAppearance,
} from '@nexa/types';
import type { Env } from '../config/env.js';
import { ApiError } from '../lib/api-error.js';
import { verifyPassword } from '../lib/crypto.js';
import { poweredByFor } from '../lib/entitlements.js';
import { originHost } from '../lib/origin.js';
import { withTenant, type TenantContext } from '../lib/tenant.js';
import type { Mailer } from '../services/mail/mailer.js';
import { isIpBanned } from '../lib/banned-ip.js';
import { CustomFieldService } from '../services/custom-fields/custom-field-service.js';
import {
  writeAuditEntry,
  type AuditContext,
  type AuditEntry,
} from '../services/audit/audit-log.js';
import { OauthService, type Membership } from '../services/auth/oauth-service.js';
import type { IssuedToken } from '../services/auth/token-service.js';
import { badCode, TOTP_ISSUER, TwoFactorService } from '../services/auth/two-factor-service.js';
import {
  NOTIFICATION_PREFERENCE_SELECT,
  serialiseNotificationPreferences,
} from '../services/notifications/preferences.js';
import { markWebsiteConnected } from '../services/websites/website-service.js';
import {
  defaultScopesForRole,
  selfAccountId,
  ENROLLMENT_TICKET_SCOPES,
  type AgentPrincipal,
  type Principal,
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
  /**
   * The second factor, when the account holds one (NFR-S11 · S11-2FA-e).
   *
   * One field for both credentials — a six-digit TOTP code and a
   * `ABCDE-FGHJK` recovery code — because the person typing it is answering one
   * question ("prove it is you"), and a client that had to declare which kind it
   * was sending would be guessing on the user's behalf. The server tries them in
   * that order and records which one worked; nothing about the two shapes
   * overlaps, so neither can be mistaken for the other.
   *
   * Optional here and required by the account, not by the schema: whether a code
   * is needed depends on state the caller cannot see, so a missing one is a
   * refusal that says *what* is missing rather than a validation error.
   */
  code: z.string().trim().min(1).max(64).optional(),
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

/**
 * What the two enrollment endpoints take besides their own payload
 * (NFR-S11 · FR-MOD-00.1 · M-SEC-d2).
 *
 * Optional in the schema and required by the *account*, exactly like
 * `reauthenticateBody`: whether a password is owed depends on state the caller
 * cannot see, so a missing one is a refusal naming what is missing rather than
 * a shape error. Nothing is trimmed — leading and trailing space is part of a
 * password.
 */
const enrollTwoFactorBody = z.object({ password: passwordSchema.optional() });

/** The code the app is showing now, and the proof that this is your account. */
const activateTwoFactorBody = enrollTwoFactorBody.extend({
  code: z.string().trim().min(1).max(32),
});

/**
 * Whose second factor a request is about, for the two endpoints that answer to
 * both a session and an enrollment ticket (S11-2FA-k).
 *
 * The route's `principals` list has already refused every other kind, so this
 * cannot fail in practice — it throws rather than casting because the previous
 * `as AgentPrincipal` was true only for as long as the list said `['agent']`,
 * and the point of this subtask is that the list no longer does.
 */
function requireSelfAccount(principal: Principal): string {
  const accountId = selfAccountId(principal);
  if (!accountId) throw ApiError.notFound('Resource not found.');
  return accountId;
}

/**
 * What made a caller the account holder, for the two endpoints that install a
 * second factor (`proveAccountForEnrollment`).
 */
type EnrollmentProof = 'password' | 'enrollment_ticket' | 'sole_membership';

/**
 * The audit metadata for an enrollment — nothing at all for the ordinary case.
 *
 * Two of the three proofs are worth a marker. `via: 'enrollment_ticket'` tells
 * an enrollment done from the sign-in screen apart from one done from Account
 * Settings: a workspace that has just switched `require_two_factor` on will see
 * a run of these, and "they enrolled from the door they were refused at" is the
 * expected shape; the same marker appearing weeks later, on an account that
 * already had a session, is not. `proof: 'sole_membership'` marks the one branch
 * that installs an account-global credential without the account holder
 * producing a secret of their own (M-SEC-d2) — it is the residual this fix
 * accepts, so it is the one a review has to be able to find.
 *
 * An absent key for the password case rather than `proof: 'password'`, matching
 * the break-glass marker on `auth.login` and for the same reason: a field that
 * is always present is a field every query has to remember to ignore.
 */
function enrollmentProvenance(proof: EnrollmentProof): { metadata?: Record<string, unknown> } {
  switch (proof) {
    case 'enrollment_ticket':
      return { metadata: { via: 'enrollment_ticket' } };
    case 'sole_membership':
      return { metadata: { proof: 'sole_membership' } };
    case 'password':
      return {};
  }
}

/**
 * Re-authentication for the two endpoints that change a live second factor.
 *
 * Both fields are optional *here* because which one is required depends on the
 * account, not on the request — see `reauthenticate`. Nothing is trimmed out of
 * `password`: leading and trailing space is part of a password.
 */
const reauthenticateBody = z.object({
  password: passwordSchema.optional(),
  code: z.string().trim().min(1).max(64).optional(),
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
  options: { env: Env; mailer: Mailer },
): Promise<void> {
  const { env, mailer } = options;
  // Our own widget origin. A token request whose host resolves to this is the
  // hosted Chat page (FR-MOD-08.5.9), exempt from the trusted-domain allowlist.
  const selfHost = originHost(env.WIDGET_BASE_URL);
  const oauth = new OauthService(app.db, {
    accessTokenTtl: env.ACCESS_TOKEN_TTL,
    refreshTokenTtl: env.REFRESH_TOKEN_TTL,
    authorizationCodeTtl: env.AUTH_CODE_TTL,
    auditChainSecret: env.AUDIT_CHAIN_SECRET,
  });
  const twoFactor = new TwoFactorService(app.db);

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

  /**
   * The second-factor gate (NFR-S11 · FR-MOD-00.1 · S11-2FA-e).
   *
   * Called from `/auth/authorize` and nowhere else, for the reason that endpoint
   * already states about single sign-on: this is the call that binds a
   * credential to a workspace and mints the code a session comes from, so it is
   * the only place a gate cannot be routed around. `/auth/login` selects no
   * workspace and a client can reach `/auth/authorize` without ever calling it,
   * which is why the listing endpoint annotates and this one refuses.
   *
   * Three outcomes, and the difference between the second and the third is the
   * whole feature:
   *
   *   **The account holds a factor.** A code is required, whatever the
   *   workspace's policy says. Somebody who has set up an authenticator has
   *   asked for this, and a workspace that has not switched the policy on has
   *   not thereby asked us to ignore it.
   *
   *   **The account holds none and the workspace requires one.** Refused. This
   *   is the branch `security_settings.require_two_factor` never had — until
   *   now the flag was written, read back by the screen that wrote it, and
   *   consulted by nothing on the way in.
   *
   *   **Neither.** Nothing changes, which is what keeps every existing sign-in,
   *   seed account and end-to-end suite working exactly as before.
   *
   * Deliberately *not* applied to the SAML assertion path (`routes/saml.ts`).
   * A federated sign-in is one the identity provider has already vouched for,
   * and MFA, conditional access and device posture are precisely what the
   * workspace bought that provider for; demanding a second Nexa factor on top
   * would be a second, weaker copy of a control the IdP already owns, and would
   * make an enforced-SSO workspace unenterable for anyone whose authenticator
   * broke. A *password* sign-in is not vouched for by anybody, so it is gated —
   * including the owner's break-glass entry into an SSO-enforced workspace,
   * which is the one password door left open and therefore the last one worth
   * leaving single-factor.
   *
   * Refresh-token rotation and personal access tokens are untouched: neither is
   * a sign-in. A refresh presents a credential this gate already vetted when the
   * session was minted, and a PAT is a named credential its holder created on
   * purpose — binding a second factor to it would mean typing a code to run a
   * cron job.
   */
  /**
   * Mint the credential that opens the two enrollment endpoints, and nothing
   * else (NFR-S11 · FR-MOD-00.1 · S11-2FA-k).
   *
   * Every live ticket this account already holds in this workspace is revoked
   * first. That is what makes "single use" true in both directions: a second
   * refused sign-in kills the ticket from the first, so an abandoned attempt
   * cannot be picked up later, and there is never more than one credential
   * outstanding per person per workspace no matter how many times the sign-in
   * is retried. Without it, a password holder could accumulate one ticket per
   * attempt — each individually harmless, collectively a set of credentials
   * with a longer effective life than any one of them.
   *
   * `TokenService.issue` prunes only `oauth` rows (#pruneOldest), by design:
   * that cap is about a browser accumulating sessions. This is the same
   * question with a different answer — not "at most 25", but "at most one".
   *
   * The scope list is `ENROLLMENT_TICKET_SCOPES` because the two endpoints are
   * scope-gated like every other own-account route and the gate has to be
   * satisfiable. It is not what confines the ticket: resolution replaces
   * whatever is stored here with the same constant, and the route's
   * `principals` list is what actually refuses it everywhere else.
   */
  async function mintEnrollmentTicket(
    tenant: { licenseId: bigint; organizationId: string },
    accountId: string,
  ): Promise<IssuedToken> {
    await withTenant(app.db, tenant, (tx) =>
      tx.apiToken.updateMany({
        where: { ownerId: accountId, kind: 'enrollment', revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    );

    return app.tokens.issue({
      licenseId: tenant.licenseId,
      organizationId: tenant.organizationId,
      ownerId: accountId,
      kind: 'enrollment',
      scopes: [...ENROLLMENT_TICKET_SCOPES],
      ttlSeconds: env.TWO_FACTOR_ENROLLMENT_TICKET_TTL,
    });
  }

  async function enforceSecondFactor(
    request: FastifyRequest,
    tenant: { licenseId: bigint; organizationId: string },
    accountId: string,
    membership: Membership,
    code: string | undefined,
  ): Promise<void> {
    const trail = (entry: AuditEntry) =>
      audit(request, tenant, { actorId: accountId, actorType: 'agent' }, entry);
    const target = `account:${accountId}`;

    if (!(await twoFactor.isActive(accountId))) {
      if (!membership.two_factor_required) return;

      // Not `auth.login_failed`. Nothing was wrong with the credential; the
      // workspace changed what it accepts. An admin who has just switched the
      // policy on needs to see who is now shut out, and that is a different
      // list from who is being attacked.
      await trail({ action: 'security.two_factor_enrollment_required', target });

      // The way out of the refusal, handed over with it (S11-2FA-k). Minted
      // here and only here, which is what keeps the three preconditions
      // inseparable from the credential: the password has been verified, the
      // membership resolved against `license_id`, and — one branch up — the
      // account proved to hold no active factor. An account that *does* hold
      // one never reaches this line, so the ticket can never be the way round
      // the code prompt below.
      //
      // Best-effort. If minting fails the refusal still stands and still says
      // why; a client that gets no ticket falls back to what S11-2FA-g always
      // did, which is to point at Account Settings. Turning a failed mint into
      // a 500 would replace a usable dead end with an unusable one.
      let ticket: IssuedToken | null = null;
      try {
        ticket = await mintEnrollmentTicket(tenant, accountId);
      } catch (err) {
        request.log.warn({ err }, 'could not mint two-factor enrollment ticket');
      }

      throw new ApiError(
        'two_factor_required',
        'This workspace requires two-factor authentication. Set it up on your account before signing in.',
        {
          // Named so the client can route to enrollment rather than render a
          // code box nothing will satisfy — the same reasoning as the SSO
          // refusal carrying its connection id. Absent rather than `false` in
          // the ordinary "show me your code" refusal: a field that is always
          // there is a field every reader has to remember to ignore.
          details: {
            enrollment_required: true,
            ...(ticket
              ? {
                  enrollment_ticket: ticket.token,
                  enrollment_ticket_expires_in: env.TWO_FACTOR_ENROLLMENT_TICKET_TTL,
                }
              : {}),
          },
          // There is a bearer credential in this body. Every other response
          // that carries one says so (`/auth/2fa/enroll`, the PAT mint, the
          // SAML assertion path); an error body is not an exception just
          // because it is an error.
          headers: { 'Cache-Control': 'no-store' },
        },
      );
    }

    if (code === undefined) {
      // No audit entry: this is the protocol prompt, not a failed attempt. A
      // client that has not yet been told a code is needed learns it here, and
      // recording that exchange would bury the entries that mean somebody is
      // guessing under the ones that mean somebody is signing in normally.
      throw new ApiError(
        'two_factor_required',
        'Enter the code from your authenticator app, or one of your recovery codes.',
      );
    }

    if (!(await spendChallengeAttempt(request, accountId))) {
      // Deliberately silent in the trail. The attempts that got here already
      // wrote `security.two_factor_challenge_failed`; every request after the
      // budget is gone would add an entry that says nothing new, and an audit
      // log is the one table nothing prunes.
      throw ApiError.tooManyRequests(
        3600,
        'Too many verification attempts. Wait before trying again.',
      );
    }

    // TOTP first, then the recovery sheet. The two shapes cannot be confused —
    // six digits against ten symbols from an alphabet with no digits below two —
    // so the order is about cost, not ambiguity: the common credential is tried
    // first and a recovery code is never spent by a mistyped TOTP.
    if (await twoFactor.verifyTotpCode(accountId, code, Date.now())) return;

    const recovery = await twoFactor.consumeRecoveryCode(accountId, code);
    if (recovery) {
      // Its own entry rather than metadata on `auth.login`, because this is the
      // second factor that is *consumed* by being used. The count is what turns
      // it into a warning somebody can act on before the sheet runs out.
      await trail({
        action: 'security.two_factor_recovery_code_used',
        target,
        metadata: { recovery_codes_remaining: recovery.remaining },
      });
      return;
    }

    // Wrong, expired, or right but already spent — `badCode` gives one answer
    // for all three, and the trail keeps the same discretion: which of them it
    // was is exactly what somebody guessing would like to know.
    await trail({ action: 'security.two_factor_challenge_failed', target });
    throw badCode();
  }

  /**
   * Take one attempt from this account's hourly budget, or report it is empty.
   *
   * Charged per *presentation* rather than per failure, and that ordering is the
   * point: a budget spent only on failures still lets a caller who has exhausted
   * it keep presenting codes, and one of those presentations is eventually
   * right. Charging first means a caller over the limit never reaches the
   * comparison at all. An honest sign-in costs one, and nobody signs in twenty
   * times an hour by hand.
   *
   * Fails open when Redis is unreachable, matching `plugins/rate-limit.ts` and
   * for the same reason: the alternative is that a cache outage locks every
   * two-factor account out of the product, and the password plus a live code is
   * still two credentials. It is logged at error level so the outage is visible
   * rather than inferred.
   */
  async function spendChallengeAttempt(
    request: FastifyRequest,
    accountId: string,
  ): Promise<boolean> {
    try {
      // `rl:` prefixed like every other bucket so the operational tooling that
      // sweeps them — `clearRateLimits` in the test helpers among it — does not
      // have to learn a second naming scheme.
      const decision = await app.rateLimiter.consume(
        `rl:2fa:${accountId}`,
        env.RATE_LIMIT_TWO_FACTOR_PER_HOUR,
        3_600_000,
      );
      return decision.allowed;
    } catch (error) {
      request.log.error({ err: error }, 'two-factor attempt budget unavailable — allowing attempt');
      return true;
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
    // Whether a code will be demanded at `/auth/authorize` (NFR-S11 ·
    // S11-2FA-e). An account fact, not a membership one: one person holds one
    // authenticator and it covers every workspace they belong to, so this sits
    // beside the account rather than being repeated down the list.
    //
    // Not a disclosure worth withholding. The caller has just proved this
    // account's password, and the very next call tells them anyway — the whole
    // purpose of the refusal is to say "now show me a code". What it buys is a
    // sign-in screen that asks for the code in the same breath as the password
    // instead of after a round trip that reads as a failure.
    const twoFactorEnabled = await twoFactor.isActive(account.id);
    return reply.send({
      account: { ...account, two_factor_enabled: twoFactorEnabled },
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
        // Which workspaces have closed the password door (NFR-S11 · S11-h), and
        // where to knock instead.
        //
        // Annotated rather than refused, and this endpoint is deliberately not
        // the enforcement point. It selects no workspace — the comment on
        // `/auth/authorize` already says as much — so it is a directory lookup,
        // not a sign-in, and a gate here would be one a client could simply not
        // call: `/auth/authorize` takes the same email and password and is
        // reached without it. Enforcement lives where the session is minted;
        // what belongs here is the fact that lets the screen offer the right
        // door instead of a password box that will be rejected.
        //
        // Filtering the workspace out of the list was the other option and is
        // worse: to the person it reads as "you have been removed", and it
        // leaves them nothing to click. They have just proved this account's
        // password and this membership, so naming the connection tells them
        // nothing they are not entitled to know.
        sso_enforced_connection_id: m.sso_enforced_connection_id,
        // Which workspaces insist on a second factor (NFR-S11 · S11-2FA-e).
        // The policy alone — read together with `account.two_factor_enabled`
        // above, the pair says which of three things the screen must do: go
        // straight through, ask for a code, or send the person to set one up
        // because this workspace will not let them in without one. One combined
        // boolean could not tell the last two apart.
        two_factor_required: m.two_factor_required,
        // Derived here, not left to the client, because the break-glass rule is
        // a server rule (§C-A17.7) and a copy of it in the UI is a copy that
        // goes stale — showing a password box the API refuses, or hiding one it
        // would have accepted.
        password_login_available: passwordLoginAvailable(m),
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

    // --- SSO enforcement (NFR-S11 · S11-h) ----------------------------------
    //
    // The password was right. This is where it stops being enough: the
    // workspace has said its identity provider is the way in, and a password
    // that still worked would route around the MFA, conditional access and
    // device posture that live there — which is the entire reason the workspace
    // bought SAML.
    //
    // Here rather than at `/auth/login` because this is the sign-in: it is the
    // call that binds a credential to a workspace and mints the code a session
    // comes from. A gate on the listing endpoint would be one this call does
    // not need anybody to have passed.
    //
    // Owners are let through, and every such entry is marked. See §C-A17.7:
    // an enterprise that federates sign-in must still be able to get in when
    // the identity provider cannot answer, and the account able to undo the
    // federation is the one that has to be able to. `admin` is not enough —
    // enforcement is set by `exactRole: 'owner'`, so the door out is held to
    // the same rank as the door in.
    const enforcedConnection = membership.sso_enforced_connection_id;
    if (enforcedConnection !== null && !passwordLoginAvailable(membership)) {
      // The workspace's own trail, under the membership's tenant — trusted,
      // unlike the `license_id` in the body. A refused password against an
      // SSO-only workspace is exactly the signal an admin wants to see: either
      // somebody has not migrated, or a credential that should be inert is
      // being tried.
      await audit(
        request,
        { licenseId, organizationId: membership.organization_id },
        { actorId: account.id, actorType: 'agent' },
        { action: 'auth.login_failed', metadata: { reason: 'sso_enforced' } },
      );
      throw new ApiError(
        'not_allowed',
        'This workspace requires single sign-on. Continue with your identity provider.',
        // Named so a client that came straight here — a saved workspace, a
        // deep link — can still send the person somewhere. Withholding it
        // protects nothing from a caller who has already proved the password
        // and the membership, and costs them the only actionable thing in the
        // refusal.
        { details: { sso_connection_id: enforcedConnection } },
      );
    }

    // --- Two-factor enforcement (NFR-S11 · FR-MOD-00.1 · S11-2FA-e) ---------
    //
    // After the SSO gate above and before anything is minted. After, because a
    // workspace that refuses passwords outright has already answered this
    // request and a rejected password must not also spend a thirty-second code;
    // before, because everything below this line produces a credential.
    await enforceSecondFactor(
      request,
      { licenseId, organizationId: membership.organization_id },
      account.id,
      membership,
      body.code,
    );

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
    //
    // A break-glass sign-in is marked. It is the one password that still opens
    // an SSO-only workspace, so it is the one an incident review has to be able
    // to find — and the residual risk the owner exemption accepts (a phished
    // owner password is still a way in) is bounded by exactly this: it is loud.
    // Ordinary sign-ins keep no metadata at all rather than gaining a `false`
    // that every future query would have to remember to ignore.
    await audit(
      request,
      { licenseId, organizationId: membership.organization_id },
      { actorId: account.id, actorType: 'agent' },
      {
        action: 'auth.login',
        target: `client:${client.id}`,
        ...(enforcedConnection === null
          ? {}
          : { metadata: { break_glass: true, sso_connection_id: enforcedConnection } }),
      },
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
    const revoked = revokedAccess ?? revokedRefresh;

    // Only a token that actually matched something is worth an entry — the
    // response is 200 either way (RFC 7009), so the trail must not become an
    // oracle for which tokens exist.
    if (revoked) {
      await audit(
        request,
        { licenseId: revoked.licenseId, organizationId: revoked.organizationId },
        { actorId: null, actorType: 'system' },
        {
          action: 'auth.token_revoked',
          target: `token:${revoked.id}`,
          metadata: { kind: revokedAccess ? 'access' : 'refresh' },
        },
      );
    }

    return reply.send({ revoked: revoked !== null });
  });

  // --- GET /auth/me ----------------------------------------------------------
  //
  // `region` below is the *workspace's* region (`organizations.region`), for all
  // three principal kinds, carried by the credential that authenticated the
  // request — C4-a's leftover debt, paid here because C4-b is what put a region
  // on the request in the first place. Since the residency gate refuses anything
  // else with 421, this is also always the region this process serves; stating
  // it from the workspace rather than from configuration keeps the field true on
  // its own terms rather than by side effect of a check elsewhere.

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
          region: request.requireRegion(),
          scopes: [],
        });
      }

      if (principal.kind === 'bot') {
        return reply.send({
          kind: 'bot',
          account_id: principal.botId,
          organization_id: principal.organizationId,
          license_id: principal.licenseId.toString(),
          region: request.requireRegion(),
          scopes: principal.scopes,
        });
      }

      // The route's `principals` list has already turned away everything else
      // (a SCIM token, today). Stated here as well so the remaining case is a
      // fact the compiler holds rather than one a reader has to reconstruct from
      // a route config, and so adding a fifth kind fails closed instead of
      // falling into the agent branch below.
      if (principal.kind !== 'agent') throw ApiError.notFound('Resource not found.');

      // The caller's own second factor rides along with the profile rather than
      // getting an endpoint of its own (S11-2FA-d): it is a property of the
      // caller, which is the question this route answers, and the account
      // settings screen (S11-2FA-f) has nowhere else to read "it is on, and
      // three recovery codes are left". Outside the tenant transaction because
      // `account_two_factor` is per-account and reachable only through a
      // SECURITY DEFINER function.
      const [profile, twoFactorStatus] = await Promise.all([
        request.withTenant(async (tx) => {
          const [account, membership, license, organization] = await Promise.all([
            tx.account.findUnique({
              where: { id: principal.accountId },
              select: { email: true, name: true, avatarUrl: true },
            }),
            tx.agentMembership.findUnique({
              where: {
                licenseId_agentId: { licenseId: principal.licenseId, agentId: principal.accountId },
              },
              select: {
                routingStatus: true,
                concurrentChatsLimit: true,
                ...NOTIFICATION_PREFERENCE_SELECT,
              },
            }),
            // The onboarding gate: the shell reads this to decide whether to send a
            // new owner to the first-run wizard, so it rides along with the profile
            // the app already fetches on load rather than costing a second request.
            tx.license.findUnique({
              where: { id: principal.licenseId },
              select: { onboardingCompletedAt: true },
            }),
            // The mobile Settings → Account card's only source for "which
            // workspace" (13.7-r) — a long-lived session has no other request
            // that would carry it (the console reads it once, off `/auth/login`'s
            // membership list, and never needs it again).
            tx.organization.findUnique({
              where: { id: principal.organizationId },
              select: { name: true },
            }),
          ]);
          return { account, membership, license, organization };
        }),
        twoFactor.status(principal.accountId),
      ]);

      return reply.send({
        kind: 'agent',
        account_id: principal.accountId,
        email: profile.account?.email ?? null,
        name: profile.account?.name ?? null,
        avatar_url: profile.account?.avatarUrl ?? null,
        role: principal.role,
        organization_id: principal.organizationId,
        organization_name: profile.organization?.name ?? null,
        license_id: principal.licenseId.toString(),
        region: request.requireRegion(),
        scopes: principal.scopes,
        routing_status: profile.membership?.routingStatus ?? 'offline',
        concurrent_chats_limit: profile.membership?.concurrentChatsLimit ?? 0,
        // All five channels, not just e-mail. The console reads them on load and
        // caches them for the inbox's alerting decision, which runs on every
        // incoming message and cannot afford a fetch; shipping them with the
        // profile it already requests is what keeps that cache honest without a
        // second round trip (13.7-c).
        notification_preferences: serialiseNotificationPreferences(profile.membership),
        onboarding_completed: profile.license?.onboardingCompletedAt != null,
        two_factor: {
          enabled: twoFactorStatus.enabled,
          pending: twoFactorStatus.pending,
          // How many are left, never which ones. The count is what lets the
          // settings screen warn before somebody runs out; the codes themselves
          // were shown once and are not retrievable.
          recovery_codes_remaining: twoFactorStatus.recoveryCodesRemaining,
        },
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

  // --- Two-factor authentication ---------------------------------------------
  //
  // Four endpoints, all on the caller's *own* account: there is no path here to
  // another person's second factor, and no scope that grants one. They follow
  // the personal-access-token family above — authenticated, resource-shaped, and
  // showing a secret exactly once — because that is what a second factor is.
  //
  // Two of them — enroll and activate — also accept an `enrollment` principal:
  // the ticket `/auth/authorize` hands back when it refuses an account that
  // holds no factor in a workspace that demands one (S11-2FA-k). The other two
  // do not, and that split is the whole safety argument. Removing a factor and
  // reprinting a recovery sheet are the operations a stolen credential would
  // want; both re-authenticate, and neither is reachable by a credential minted
  // from a password alone. Adding `'enrollment'` to a third `principals` list
  // would be the way to undo S11-2FA-e, so it is a line somebody has to write
  // on purpose.
  //
  // Brute force: these all sit behind the agent rate-limit bucket (180/min per
  // token) and each requires a session that already belongs to the account being
  // changed, so guessing a TOTP code here means guessing against an account one
  // is already signed in to. The surface where a failure counter genuinely
  // belongs is the login challenge — an unauthenticated caller, one password
  // away — and that endpoint (S11-2FA-e) is where it should land.

  /**
   * Prove the request is the *account holder*, not merely a session on the
   * account (NFR-S11 · FR-MOD-00.1 · M-SEC-d2 · tm 172).
   *
   * A second factor is account-global — `account_two_factor` is keyed
   * `PRIMARY KEY (account_id)`, above the tenant boundary, deliberately, so one
   * person's single secret covers every workspace they belong to. A *session*
   * is not: it is minted by one workspace, and `routes/saml.ts` mints one from
   * an assertion its identity provider signed. tm 157 measured what the two
   * together allow. The chain was five deliberate links — a just-in-time
   * membership gets `agent`, `DEFAULT_AGENT_SCOPES` carries `accounts--my:rw`
   * (tm 152.10), the SAML path is deliberately outside `enforceSecondFactor`,
   * these two endpoints take a plain session, and the factor they write is
   * global — and at the end of it a workspace could install *its own*
   * authenticator as somebody's account-wide second factor and take the ten
   * recovery codes out of the response body. The victim was then refused at
   * every password sign-in everywhere, with no way back: removing a factor
   * needs a session, and a session needs the code the attacker holds.
   *
   * So the rule is the one `DELETE /auth/2fa` already states in the other
   * direction — a stolen session must not be able to remove the control
   * protecting the account it came from, and installing one is the same act
   * pointed the other way. Three branches, in the order of what they prove:
   *
   *   **An `enrollment` ticket.** Minted at `/auth/authorize` one call after
   *   `authenticateAccount` verified the password (S11-2FA-k), single-use, at
   *   most one outstanding, and it opens these two endpoints and nothing else.
   *   It is a password proof, delegated — asking for the password again would
   *   be asking the sign-in screen to carry it forward for no gain.
   *
   *   **A password on the account.** Required, and nothing else will do. This
   *   is the branch that breaks the chain: an assertion proves what an identity
   *   provider is willing to say, and the workspace behind it does not hold the
   *   account's own secret.
   *
   *   **No password, and exactly one workspace.** Allowed. That workspace's
   *   identity provider is the account's *only* authority — it can already act
   *   as this person everywhere they exist — and there is no second workspace
   *   to be shut out of. This is the branch that keeps §D116's loop closed:
   *   refusing here would leave a purely federated account unable to enroll,
   *   which is the "policy shut them out; enrollment shut them out" dead end
   *   `role-scopes.ts` was widened to remove. The moment a second membership
   *   exists it stops being true, and the refusal names the way out — a
   *   password reset proves the inbox and gives the account a secret of its own.
   *
   * Memberships come from `auth_list_memberships`, so suspended ones do not
   * count, and a canceled licence does not either: a workspace nobody can enter
   * is not one somebody can be locked out of. Same reading
   * `auth_two_factor_enforcing_licenses` gives a suspension.
   *
   * Called *before* anything is written, so an unproven caller cannot even
   * replace a pending secret. That costs the 409 an already-enrolled account
   * would otherwise get first — a small and deliberate loss, since confirming
   * the state of a factor to a caller who has not proved the account is itself
   * something to withhold.
   */
  async function proveAccountForEnrollment(
    principal: Principal,
    accountId: string,
    passwordHash: string | null,
    body: { password?: string },
  ): Promise<EnrollmentProof> {
    if (principal.kind === 'enrollment') return 'enrollment_ticket';

    if (passwordHash !== null) {
      if (body.password === undefined) {
        throw ApiError.validation(
          'password: your password is required to set up two-factor authentication.',
          { fields: [{ field: 'password', message: 'Required.' }] },
        );
      }
      if (!(await verifyPassword(body.password, passwordHash))) {
        throw ApiError.authentication('That password is not correct.');
      }
      return 'password';
    }

    const memberships = (await oauth.listMemberships(accountId)).filter(
      (m) => m.license_status !== 'canceled',
    );
    if (memberships.length > 1) {
      throw new ApiError(
        'not_allowed',
        'This account signs in through an identity provider and belongs to more than one workspace. Set a password on it first — otherwise one workspace would be choosing the second factor that guards all of them.',
        // Named so the screen can send somebody to the password-reset flow
        // rather than render a password box the account cannot fill.
        { details: { password_required: true } },
      );
    }
    return 'sole_membership';
  }

  /**
   * Tell the account holder that a second factor now stands in front of their
   * account (M-SEC-d2).
   *
   * The audit entry above records this too, but an audit log is a workspace's
   * trail, read by the workspace — it is exactly the wrong place for the one
   * person who needs to know when the workspace is the party they would want to
   * hear about. The `sole_membership` branch is why: there, an identity
   * provider installs an account-global credential and the account holder
   * produced nothing. This is what makes that branch loud instead of silent.
   * Sent on every activation, not just that one, because "we only mail you when
   * we are suspicious" is a signal an attacker reads too.
   *
   * The workspace is named — an account belongs to several and "from where" is
   * the only part that is actionable. The secret and the recovery codes are
   * not: this goes to a mailbox, and surviving the loss of a mailbox is what a
   * second factor is for.
   *
   * Best-effort, like the audit write beside it. The factor is on; failing the
   * request now would tell the caller it is not.
   */
  async function notifyTwoFactorEnabled(request: FastifyRequest, email: string): Promise<void> {
    try {
      const tenant = request.tenant();
      const organization = await withTenant(app.db, tenant, (tx) =>
        tx.organization.findUnique({
          where: { id: tenant.organizationId },
          select: { name: true },
        }),
      );
      await mailer.send({
        to: email,
        kind: 'notification',
        subject: 'Two-factor authentication is now on for your Nexa account',
        body:
          `Two-factor authentication was just turned on for ${email}, from the ` +
          `workspace "${organization?.name ?? 'Nexa'}". It applies to every ` +
          `workspace this account can sign in to.\n\n` +
          `If this was you, keep your recovery codes somewhere safe — they are ` +
          `the way back in if you lose your authenticator app.\n\n` +
          `If it was not you, somebody else can now decide whether you get in. ` +
          `Turn it off from Account Settings while you are still signed in, and ` +
          `tell an owner of that workspace.`,
      });
    } catch (err) {
      request.log.warn({ err }, 'could not send the two-factor enrollment notice');
    }
  }

  /**
   * Mint a secret. Nothing is enabled until `/auth/2fa/activate` proves the
   * authenticator app and this server agree about the time.
   *
   * Calling this twice before activating replaces the pending secret rather than
   * refusing, so a closed tab or a reset phone halfway through is not a state
   * anybody gets stuck in. Calling it against an *active* factor is refused with
   * 409 — see `auth_two_factor_begin_enrollment`.
   */
  app.post(
    '/auth/2fa/enroll',
    { config: { scopes: ['accounts--my:rw'], principals: ['agent', 'enrollment'] } },
    async (request, reply) => {
      const principal = request.requirePrincipal();
      const accountId = requireSelfAccount(principal);
      const body = parse(enrollTwoFactorBody, request.body ?? {});

      // The label the authenticator app shows under "Nexa". The address rather
      // than the display name: it is what distinguishes two entries for somebody
      // who holds a personal and a work account. Read with the password hash the
      // proof below needs, because both are one row.
      const account = await request.withTenant((tx) =>
        tx.account.findUnique({
          where: { id: accountId },
          select: { email: true, passwordHash: true },
        }),
      );
      if (!account) throw ApiError.notFound('Resource not found.');

      const proof = await proveAccountForEnrollment(
        principal,
        accountId,
        account.passwordHash,
        body,
      );

      const enrollment = await twoFactor.beginEnrollment(accountId, account.email);

      // The secret is deliberately not in the entry: an audit log is read by
      // people who are not its subject, and a TOTP secret in one would be a
      // working second factor sitting in a table designed never to be deleted.
      await audit(
        request,
        request.tenant(),
        {},
        {
          action: 'security.two_factor_enrollment_started',
          target: `account:${accountId}`,
          ...enrollmentProvenance(proof),
        },
      );

      reply.header('Cache-Control', 'no-store');
      return reply.send({
        secret: enrollment.secret,
        otpauth_uri: enrollment.otpauthUri,
        issuer: TOTP_ISSUER,
        account_name: account.email,
      });
    },
  );

  /**
   * Confirm the enrollment and hand over the recovery sheet.
   *
   * This is the only response in the system that carries recovery codes in the
   * clear. Regeneration produces a new sheet; nothing ever re-reads an old one.
   *
   * Proved the same way as `/auth/2fa/enroll` (M-SEC-d2). Gating the first
   * endpoint is what actually breaks the chain — without a secret there is
   * nothing to confirm — but the rule these two obey is "a write to the
   * account's global factor proves the account", and a rule written once for
   * two endpoints is one that cannot drift between them.
   */
  app.post(
    '/auth/2fa/activate',
    { config: { scopes: ['accounts--my:rw'], principals: ['agent', 'enrollment'] } },
    async (request, reply) => {
      const principal = request.requirePrincipal();
      const accountId = requireSelfAccount(principal);
      const body = parse(activateTwoFactorBody, request.body);

      // The address the factor is about to guard, and the hash the proof needs.
      const account = await request.withTenant((tx) =>
        tx.account.findUnique({
          where: { id: accountId },
          select: { email: true, passwordHash: true },
        }),
      );
      if (!account) throw ApiError.notFound('Resource not found.');

      const proof = await proveAccountForEnrollment(
        principal,
        accountId,
        account.passwordHash,
        body,
      );

      const recoveryCodes = await twoFactor.activate(accountId, body.code, Date.now());

      // The ticket is spent by the enrollment it existed for — after the
      // activation, not before, so a wrong code leaves the person able to try
      // again rather than back at a sign-in screen that will refuse them.
      // Nothing needs it afterwards: the session comes from repeating
      // `/auth/authorize` with a code the new factor produces, and the factor
      // now exists.
      if (principal.kind === 'enrollment') {
        await app.tokens.revoke({
          licenseId: principal.licenseId,
          organizationId: principal.organizationId,
          tokenId: principal.tokenId,
        });
      }

      await audit(
        request,
        request.tenant(),
        {},
        {
          action: 'security.two_factor_enabled',
          target: `account:${accountId}`,
          ...enrollmentProvenance(proof),
        },
      );

      await notifyTwoFactorEnabled(request, account.email);

      reply.header('Cache-Control', 'no-store');
      return reply.send({
        enabled: true,
        recovery_codes: recoveryCodes,
        recovery_codes_remaining: recoveryCodes.length,
      });
    },
  );

  /**
   * Turn the second factor off.
   *
   * The password is not ceremony. A session token that has been stolen is
   * exactly the thing that would otherwise be used to remove the control
   * protecting the account it was stolen from, and the whole point of the factor
   * is that the thief does not hold every credential — so removing it asks for
   * one they are least likely to have.
   */
  app.delete(
    '/auth/2fa',
    { config: { scopes: ['accounts--my:rw'], principals: ['agent'] } },
    async (request, reply) => {
      const principal = request.requirePrincipal() as AgentPrincipal;
      const body = parse(reauthenticateBody, request.body ?? {});

      // Checked before the password, for the reason `/auth/authorize` states one
      // gate over: never spend a password verification on a request that cannot
      // succeed. Nothing is leaked by the ordering — the caller is a member of
      // the workspaces being named, and `require_two_factor` is a setting they
      // can already read.
      const enforcing = await twoFactor.enforcingWorkspaces(principal.accountId);
      if (enforcing.length > 0) {
        throw new ApiError(
          'not_allowed',
          `Two-factor authentication is required by ${enforcing
            .map((w) => w.name)
            .join(', ')}. It cannot be turned off while you are a member.`,
          { details: { workspaces: enforcing.map((w) => w.name) } },
        );
      }

      await reauthenticate(request, principal, body);

      if (!(await twoFactor.disable(principal.accountId))) {
        throw ApiError.notFound('Two-factor authentication is not set up on this account.');
      }

      await audit(
        request,
        request.tenant(),
        {},
        { action: 'security.two_factor_disabled', target: `account:${principal.accountId}` },
      );

      return reply.status(204).send();
    },
  );

  /**
   * Issue a new recovery sheet, invalidating the old one whole — unused codes
   * included. Somebody asking for a new sheet is saying the old one is no longer
   * trustworthy, and leaving half of it live would quietly disagree with them.
   */
  app.post(
    '/auth/2fa/recovery-codes',
    { config: { scopes: ['accounts--my:rw'], principals: ['agent'] } },
    async (request, reply) => {
      const principal = request.requirePrincipal() as AgentPrincipal;
      const body = parse(reauthenticateBody, request.body ?? {});

      // Same weight as removing the factor: a fresh sheet is ten standalone
      // second factors, so a stolen session must not be able to print itself
      // one. Refused before re-authentication when there is nothing to protect,
      // which is also what keeps `reauthenticate`'s SSO branch coherent — it
      // proves possession *of* the factor.
      const status = await twoFactor.status(principal.accountId);
      if (!status.enabled) {
        throw new ApiError(
          'two_factor_required',
          'Two-factor authentication is not active on this account.',
        );
      }

      await reauthenticate(request, principal, body);

      const recoveryCodes = await twoFactor.issueRecoveryCodes(principal.accountId);

      await audit(
        request,
        request.tenant(),
        {},
        {
          action: 'security.two_factor_recovery_codes_regenerated',
          target: `account:${principal.accountId}`,
          metadata: { count: recoveryCodes.length },
        },
      );

      reply.header('Cache-Control', 'no-store');
      return reply.send({
        recovery_codes: recoveryCodes,
        recovery_codes_remaining: recoveryCodes.length,
      });
    },
  );

  /**
   * Prove the account holder is still at the keyboard, not merely that a session
   * exists.
   *
   * Normally that means the password, and only the password: a second factor is
   * no use as re-authentication for removing itself, since the phone is one of
   * the things that gets stolen along with a laptop.
   *
   * An account provisioned through SSO has no password at all (`password_hash`
   * is null), and demanding one would leave it able to enable two-factor
   * authentication and never able to switch it off. Those accounts prove
   * possession of the factor instead — a current TOTP code, or a recovery code,
   * which is the credential that exists precisely for when the authenticator is
   * gone. It is a weaker step than a password and it is the strongest one
   * available: there is no other secret held by that account. A TOTP code
   * presented here spends its step like any other, so it cannot be replayed.
   */
  async function reauthenticate(
    request: FastifyRequest,
    principal: AgentPrincipal,
    body: { password?: string; code?: string },
  ): Promise<void> {
    const account = await request.withTenant((tx) =>
      tx.account.findUnique({
        where: { id: principal.accountId },
        select: { passwordHash: true },
      }),
    );
    if (!account) throw ApiError.notFound('Resource not found.');

    if (account.passwordHash !== null) {
      if (body.password === undefined) {
        throw ApiError.validation('password: your password is required for this change.', {
          fields: [{ field: 'password', message: 'Required.' }],
        });
      }
      if (!(await verifyPassword(body.password, account.passwordHash))) {
        throw ApiError.authentication('That password is not correct.');
      }
      return;
    }

    if (body.code === undefined) {
      throw new ApiError(
        'two_factor_required',
        'This account signs in through your identity provider and has no password, so a two-factor or recovery code is required for this change.',
      );
    }

    const now = Date.now();
    if (await twoFactor.verifyTotpCode(principal.accountId, body.code, now)) return;
    if (await twoFactor.consumeRecoveryCode(principal.accountId, body.code)) return;
    throw badCode();
  }

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

    // The workspace's own region, and whether this visitor's address is banned
    // (FR-MOD-08.9.2) — one tenant transaction for both, because the second is
    // a read this route already made and the first is a primary-key lookup
    // alongside it.
    const { region, ipBanned } = await withTenant(app.db, tenant, async (tx) => {
      const organization = await tx.organization.findUnique({
        where: { id: match.organization_id },
        select: { region: true },
      });
      return { region: organization?.region, ipBanned: await isIpBanned(tx, request.ip) };
    });

    // --- Data residency (NFR-C4 · C4-b) --------------------------------------
    // The third door, and the one that has to refuse *first*: everything below
    // writes. A visitor without a `customer_id` gets a row created for them, so
    // minting here for a workspace kept in another region would put that
    // workspace's people in this region's database — the exact thing the
    // guarantee forbids — before the token that carries the mistake is even
    // handed out. Checked before the ban read is acted on for the same reason:
    // "is this visitor banned" is already a question about somebody else's
    // workspace.
    //
    // The region is then signed into the token (`rgn`), so the two doors it can
    // later reach — the REST edge and the RTM `login` — refuse it in the wrong
    // place without a lookup of their own.
    if (!region || !servesRegion(env.NEXA_REGION, region)) {
      request.log.warn(
        { organization_id: match.organization_id, region: region ?? null },
        'widget token requested from the wrong region',
      );
      throw new ApiError('misdirected_request', 'Wrong region for this organization.', {
        ...(region ? { details: { region } } : {}),
      });
    }

    // A banned IP (FR-MOD-08.9.2) is refused a token at all, so a visitor on a
    // blocked address cannot even start a session — clearing cookies or dropping
    // their `customer_id` does not get them a fresh identity. Checked per-license
    // against `SecuritySettings`; no row means nothing is banned.
    if (ipBanned) {
      throw new ApiError('customer_banned', 'This customer is banned.');
    }

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
      // Narrowed once, here: the `organizations_region_check` constraint is what
      // makes it true, and `region.test.ts` reads that constraint back against
      // `REGIONS` so the two cannot drift apart unnoticed.
      region: region as Region,
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
    // themselves from the server as the source of truth. Alongside it, both
    // widget forms (FR-MOD-08.7.7): the fields asked before the chat starts and
    // the ones asked once it ends. Delivered together at mint because the widget
    // has no second fetch — the post-chat form must already be in hand when the
    // conversation closes, which is exactly when a round-trip is least welcome.
    // All best-effort — the widget falls back to the shipped look and no extra
    // fields, so a read failure must never deny a token.
    const [widget, forms] = await Promise.all([
      widgetAppearance(app.db, tenant, request),
      readWidgetForms(app.db, tenant, request),
    ]);

    reply.header('Cache-Control', 'no-store');
    return reply.send({
      token,
      expires_in: expiresIn,
      customer_id: customerId,
      organization_id: match.organization_id,
      widget,
      pre_chat_form: forms.pre_chat,
      post_chat_form: forms.post_chat,
    });
  });
}

/**
 * The widget appearance for a resolved license, or the shipped defaults when it
 * has never been customised or the read fails. Guarded so this never breaks
 * token issuance: the widget renders the default look if `widget` is absent.
 *
 * This is the appearance a *visitor* is served, which makes it the surface the
 * white-label entitlement is actually about (FR-MOD-11.5) — the other two read
 * paths only ever show an admin what a visitor would get. `poweredByFor` reads
 * the licence inside the same transaction, and costs nothing on the common
 * path: branding is only ever *removed* by an explicit `powered_by = false`, so
 * every other workspace skips the query entirely.
 *
 * A failure still falls back to the shipped defaults, which are branded. That
 * direction matters: the safe answer when this cannot tell whether a workspace
 * bought white label is the one that does not give it away.
 */
async function widgetAppearance(
  db: PrismaClient,
  tenant: TenantContext,
  request: FastifyRequest,
): Promise<WidgetAppearance> {
  try {
    const appearance = await withTenant(db, tenant, async (tx) => {
      const row = await tx.widgetSettings.findFirst();
      if (!row) return null;
      return {
        primary_color: row.primaryColor,
        position: row.position as WidgetAppearance['position'],
        theme: row.theme as WidgetAppearance['theme'],
        mobile_fullscreen: row.mobileFullscreen,
        powered_by: await poweredByFor(tx, tenant, row.poweredBy),
      };
    });
    return normalizeWidgetAppearance(appearance);
  } catch (error) {
    request.log.warn({ err: error }, 'failed to read widget appearance');
    return normalizeWidgetAppearance(null);
  }
}

/**
 * Both of the workspace's widget forms (FR-MOD-08.7.7), or empty lists when none
 * are configured or the read fails. One transaction for the pair: they are the
 * same table filtered two ways, and the pre-chat form is on the critical path of
 * opening the panel. Guarded like the appearance so a form lookup never breaks
 * token issuance — the widget simply shows no extra fields.
 */
async function readWidgetForms(
  db: PrismaClient,
  tenant: TenantContext,
  request: FastifyRequest,
): Promise<{ pre_chat: WidgetFormField[]; post_chat: WidgetFormField[] }> {
  try {
    const fields = new CustomFieldService();
    return await withTenant(db, tenant, async (tx) => ({
      pre_chat: await fields.listPreChatForm(tx, tenant),
      post_chat: await fields.listPostChatForm(tx, tenant),
    }));
  } catch (error) {
    request.log.warn({ err: error }, 'failed to read widget forms');
    return { pre_chat: [], post_chat: [] };
  }
}

/**
 * May this membership still be entered with a password (NFR-S11 · S11-h)?
 *
 * The break-glass rule, in one function, used by both the listing endpoint and
 * the sign-in it precedes — so what the screen offers and what the API accepts
 * cannot come apart.
 *
 * A workspace with no enforced connection is simply open. One that has closed
 * the door keeps it open for its `owner`s and nobody else, which is the
 * narrowest exemption that still leaves the workspace recoverable: the owner is
 * the only role that can undo the enforcement (`exactRole: 'owner'` on the
 * write surface), so exempting anyone less would hand a way in to someone who
 * could not fix the outage anyway, and exempting no one would make a broken
 * identity provider terminal.
 *
 * Not a second credential — see §C-A17.7 for why a recovery code lost to this.
 */
function passwordLoginAvailable(membership: {
  role: string;
  sso_enforced_connection_id: string | null;
}): boolean {
  return membership.sso_enforced_connection_id === null || membership.role === 'owner';
}
