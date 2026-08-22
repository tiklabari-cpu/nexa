/**
 * OAuth 2.1 authorization code flow with mandatory PKCE.
 *
 * Deliberate differences from the platform this clones:
 *   - `plain` PKCE is refused; S256 only (OAuth 2.1 §7.5.2).
 *   - Redirect URIs must match a registered value *exactly*. The original
 *     accepted a registered path that was a substring of the request path,
 *     which lets any open redirect or path-traversal quirk on the client's
 *     domain become a code-exfiltration channel.
 *   - Refresh tokens rotate on every use, and reuse of a rotated token revokes
 *     the whole family (OAuth 2.1 §4.3.1).
 *   - Access token lifetime is capped at one hour rather than the eight the
 *     source platform uses.
 */
import type { PrismaClient } from '@prisma/client';
import type { AgentRole } from '@nexa/types';
import { ApiError } from '../../lib/api-error.js';
import {
  constantTimeEqual,
  generateToken,
  hashToken,
  isValidCodeVerifier,
  verifyCodeChallenge,
  verifyPassword,
} from '../../lib/crypto.js';
import { withTenant } from '../../lib/tenant.js';
import { writeAuditEntry } from '../audit/audit-log.js';
import { scopesWithinRole } from './principal.js';
import { TokenService } from './token-service.js';

/** The only failure reasons C6-a2 records — see `#auditTokenFailure`. */
type TokenFailureReason = 'code_replayed' | 'code_expired' | 'pkce_mismatch' | 'refresh_revoked';

export interface OauthConfig {
  accessTokenTtl: number;
  refreshTokenTtl: number;
  authorizationCodeTtl: number;
  /**
   * `AUDIT_CHAIN_SECRET` (NFR-C6 · C6-c). This service writes one audit entry
   * of its own — the token-exchange failure below — outside any request, so it
   * cannot take the chain key off `request.auditContext()` like a route does.
   */
  auditChainSecret: string;
}

export interface OauthClientRecord {
  id: string;
  organization_id: string;
  display_name: string;
  secret_hash: string | null;
  redirect_uris: string[];
  client_type: 'public' | 'confidential';
  scopes: string[];
}

export interface Membership {
  license_id: bigint;
  organization_id: string;
  role: string;
  license_status: string;
  organization_name: string;
  client_id: string | null;
  /**
   * The SSO connection that has closed this workspace's password door, or
   * `null` while passwords still work (NFR-S11 · S11-h).
   *
   * Carried on the membership rather than looked up beside it, because both
   * doors ask the same question: `/auth/login` to say which workspaces can
   * still be entered this way, `/auth/authorize` to refuse the one that cannot.
   * A second lookup is a second chance for the two to disagree, and the shape
   * of that disagreement is a listing screen offering a sign-in the next call
   * rejects.
   */
  sso_enforced_connection_id: string | null;
}

export interface TokenGrant {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
  refresh_token: string;
  scope: string;
  account_id: string;
  license_id: string;
  organization_id: string;
}

/**
 * OAuth error codes are a fixed vocabulary (RFC 6749 §5.2) and clients switch
 * on them, so they travel as `details.oauth_error` rather than being folded
 * into Nexa's own `type` taxonomy.
 */
function oauthError(code: string, message: string): ApiError {
  return new ApiError('authentication', message, { details: { oauth_error: code } });
}

/**
 * Schemes that must never carry an authorization code, listed rather than
 * inferred.
 *
 * `javascript:` and `data:` execute, `file:`/`filesystem:`/`blob:` reach local
 * content, and `intent:` is Android's "send this anywhere" URI — the one that
 * turns a redirect into a hand-off to whatever app the attacker names. The
 * transport schemes below it are here because a redirect is a thing an
 * operating system *opens*, and none of these open anything: a registered
 * `mailto:` would only ever be a mistake or a probe.
 */
const NEVER_A_REDIRECT_SCHEME = new Set([
  // The web schemes are here so that reaching this check *is* the refusal: an
  // `http:` or `https:` candidate that got past the branch above already failed
  // its own rules (plain http off loopback), and must not get a second hearing
  // as though it were a native scheme.
  'http:',
  'https:',
  'javascript:',
  'data:',
  'vbscript:',
  'blob:',
  'file:',
  'filesystem:',
  'about:',
  'intent:',
  'ws:',
  'wss:',
  'ftp:',
  'ftps:',
  'mailto:',
  'tel:',
  'sms:',
]);

/**
 * A private-use URI scheme in the sense of RFC 8252 §7.1 — the phone's way home.
 *
 * `new URL` has already lowercased the scheme and proved it parses, so the only
 * questions left are whether it is one of the schemes that must never be a
 * redirect target, and whether it looks like a scheme at all rather than
 * something that merely parsed (RFC 3986 §3.1).
 */
function isPrivateUseScheme(protocol: string): boolean {
  if (NEVER_A_REDIRECT_SCHEME.has(protocol)) return false;
  return /^[a-z][a-z0-9+.-]*:$/.test(protocol);
}

export class OauthService {
  readonly #tokens: TokenService;

  constructor(
    private readonly db: PrismaClient,
    private readonly config: OauthConfig,
  ) {
    this.#tokens = new TokenService(db);
  }

  // --- Resource owner authentication ---------------------------------------

  /**
   * Verify email + password.
   *
   * Returns null for both "no such account" and "wrong password", and always
   * pays the cost of a password hash, so response timing cannot be used to
   * enumerate registered addresses (FR-MOD-00.1).
   */
  async authenticateAccount(
    email: string,
    password: string,
  ): Promise<{ id: string; email: string; name: string } | null> {
    const rows = await this.db.$queryRaw<
      Array<{ id: string; email: string; name: string; password_hash: string | null }>
    >`SELECT * FROM auth_find_account_for_login(${email}::citext)`;

    const account = rows[0];
    const matches = await verifyPassword(password, account?.password_hash ?? null);
    if (!account || !matches) return null;

    return { id: account.id, email: account.email, name: account.name };
  }

  async listMemberships(accountId: string): Promise<Membership[]> {
    return this.db.$queryRaw<Membership[]>`
      SELECT * FROM auth_list_memberships(${accountId}::uuid)
    `;
  }

  // --- Client + redirect validation ----------------------------------------

  async findClient(clientId: string): Promise<OauthClientRecord | null> {
    const rows = await this.db.$queryRaw<OauthClientRecord[]>`
      SELECT * FROM auth_find_client(${clientId})
    `;
    return rows[0] ?? null;
  }

  /**
   * Exact match against the registered set.
   *
   * Compared as raw strings after a structural sanity check — normalising first
   * (lowercasing, resolving `..`, dropping default ports) is precisely how
   * "close enough" URIs get accepted, and a redirect URI is a security
   * boundary, not a convenience.
   *
   * Three families are admissible, and only because each is a place a Nexa
   * client genuinely runs: `https` (the hosted console), loopback `http` (a
   * developer's Vite server), and a private-use scheme (the phone — RFC 8252
   * §7.1, `@nexa/types` · `MOBILE_REDIRECT_URI`). Everything else is refused
   * *before* the registered set is consulted, so a scheme that could execute
   * (`javascript:`), read a file (`file:`) or hand the code to another app on
   * the device (`intent:`) stays unusable even if one somehow reached the
   * column. The registration surface tenants can reach already refuses
   * anything but `https` and loopback (`partner-app-service.validateRedirectUri`),
   * so today the only custom-scheme rows are the first-party ones a migration
   * writes; this check is what keeps that true if a second registration path is
   * ever opened.
   */
  static isRegisteredRedirect(candidate: string, registered: readonly string[]): boolean {
    let url: URL;
    try {
      url = new URL(candidate);
    } catch {
      return false;
    }
    if (url.hash) return false;
    if (candidate.includes('..')) return false;
    // `https://evil.test@good.test/cb` resolves to `good.test` but reads as
    // `evil.test`; the partner registration surface refuses these for the same
    // reason, so a candidate carrying them cannot match anything anyway.
    if (url.username || url.password) return false;

    const isLoopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
    const isWeb = url.protocol === 'https:' || (url.protocol === 'http:' && isLoopback);
    if (!isWeb && !isPrivateUseScheme(url.protocol)) return false;

    return registered.some((uri) => uri === candidate);
  }

  // --- Authorization code --------------------------------------------------

  async createAuthorizationCode(input: {
    clientId: string;
    accountId: string;
    licenseId: bigint;
    organizationId: string;
    redirectUri: string;
    scopes: string[];
    codeChallenge: string;
    codeChallengeMethod: string;
  }): Promise<{ code: string; expiresAt: Date }> {
    if (input.codeChallengeMethod !== 'S256') {
      throw oauthError(
        'invalid_request',
        'code_challenge_method must be S256; OAuth 2.1 does not permit plain.',
      );
    }
    if (!input.codeChallenge || input.codeChallenge.length < 43) {
      throw oauthError('invalid_request', 'code_challenge is required and must be a S256 digest.');
    }

    const code = generateToken();
    const expiresAt = new Date(Date.now() + this.config.authorizationCodeTtl * 1000);

    await withTenant(
      this.db,
      { licenseId: input.licenseId, organizationId: input.organizationId },
      (tx) =>
        tx.oauthAuthorizationCode.create({
          data: {
            codeHash: hashToken(code),
            clientId: input.clientId,
            accountId: input.accountId,
            licenseId: input.licenseId,
            organizationId: input.organizationId,
            redirectUri: input.redirectUri,
            scopes: input.scopes,
            codeChallenge: input.codeChallenge,
            codeChallengeMethod: 'S256',
            expiresAt,
          },
        }),
    );

    return { code, expiresAt };
  }

  async exchangeAuthorizationCode(input: {
    code: string;
    codeVerifier: string;
    clientId: string;
    clientSecret?: string;
    redirectUri: string;
  }): Promise<TokenGrant> {
    const client = await this.#authenticateClient(input.clientId, input.clientSecret);

    if (!isValidCodeVerifier(input.codeVerifier)) {
      throw oauthError(
        'invalid_grant',
        'code_verifier must be 43-128 unreserved characters (RFC 7636 §4.1).',
      );
    }

    const rows = await this.db.$queryRaw<
      Array<{
        client_id: string;
        account_id: string;
        license_id: bigint;
        organization_id: string;
        redirect_uri: string;
        scopes: string[];
        code_challenge: string;
        expires_at: Date;
        was_already_consumed: boolean;
      }>
    >`SELECT * FROM auth_consume_authorization_code(${hashToken(input.code)})`;

    const record = rows[0];
    if (!record) throw oauthError('invalid_grant', 'Authorization code is invalid.');

    if (record.was_already_consumed) {
      // Replay: either the code leaked or the client double-submitted. Both are
      // handled the same way — assume compromise and revoke what it produced
      // (OAuth 2.1 §4.1.3).
      await this.#revokeTokensForAccount(
        record.license_id,
        record.organization_id,
        record.account_id,
      );
      await this.#auditTokenFailure(
        record.license_id,
        record.organization_id,
        'authorization_code',
        'code_replayed',
        client.id,
      );
      throw oauthError('invalid_grant', 'Authorization code has already been used.');
    }

    if (record.expires_at.getTime() <= Date.now()) {
      await this.#auditTokenFailure(
        record.license_id,
        record.organization_id,
        'authorization_code',
        'code_expired',
        client.id,
      );
      throw oauthError('invalid_grant', 'Authorization code has expired.');
    }
    // Guards against a code minted for one client being redeemed by another.
    if (record.client_id !== client.id) {
      throw oauthError('invalid_grant', 'Authorization code was issued to a different client.');
    }
    if (record.redirect_uri !== input.redirectUri) {
      throw oauthError('invalid_grant', 'redirect_uri does not match the authorization request.');
    }
    if (!verifyCodeChallenge(input.codeVerifier, record.code_challenge)) {
      await this.#auditTokenFailure(
        record.license_id,
        record.organization_id,
        'authorization_code',
        'pkce_mismatch',
        client.id,
      );
      throw oauthError('invalid_grant', 'code_verifier does not match the code_challenge.');
    }

    return this.#issueGrant({
      clientId: client.id,
      accountId: record.account_id,
      licenseId: record.license_id,
      organizationId: record.organization_id,
      scopes: record.scopes,
    });
  }

  // --- Refresh -------------------------------------------------------------

  async refresh(input: {
    refreshToken: string;
    clientId: string;
    clientSecret?: string;
  }): Promise<TokenGrant> {
    const client = await this.#authenticateClient(input.clientId, input.clientSecret);

    const rows = await this.db.$queryRaw<
      Array<{
        id: string;
        client_id: string;
        account_id: string;
        license_id: bigint;
        organization_id: string;
        scopes: string[];
        family_id: string;
        replaced_by_id: string | null;
        expires_at: Date;
        revoked_at: Date | null;
      }>
    >`SELECT * FROM auth_resolve_refresh_token(${hashToken(input.refreshToken)})`;

    const record = rows[0];
    if (!record) throw oauthError('invalid_grant', 'Refresh token is invalid.');

    if (record.replaced_by_id || record.revoked_at) {
      // A token that was already rotated is being presented again — the
      // signature of a stolen refresh token. Refusing this one request is not
      // enough, because the thief may hold newer ones: kill the whole family.
      await this.db.$queryRaw`SELECT auth_revoke_refresh_family(${record.family_id}::uuid)`;
      await this.#auditTokenFailure(
        record.license_id,
        record.organization_id,
        'refresh_token',
        'refresh_revoked',
        client.id,
      );
      throw oauthError(
        'invalid_grant',
        'Refresh token has already been used; the token family has been revoked.',
      );
    }
    if (record.expires_at.getTime() <= Date.now()) {
      throw oauthError('invalid_grant', 'Refresh token has expired.');
    }
    if (record.client_id !== client.id) {
      throw oauthError('invalid_grant', 'Refresh token was issued to a different client.');
    }

    return this.#issueGrant({
      clientId: client.id,
      accountId: record.account_id,
      licenseId: record.license_id,
      organizationId: record.organization_id,
      scopes: record.scopes,
      familyId: record.family_id,
      rotatesFromId: record.id,
    });
  }

  /**
   * Resolve and revoke by presented refresh token, returning what was revoked
   * — the tenant and token id `/auth/revoke` needs to record
   * `auth.token_revoked` (C6-a2). `null` when nothing matches, matching
   * `revokeByToken`'s contract on the access-token side.
   */
  async revokeRefreshToken(
    refreshToken: string,
  ): Promise<{ id: string; licenseId: bigint; organizationId: string } | null> {
    const rows = await this.db.$queryRaw<
      Array<{ id: string; family_id: string; license_id: bigint; organization_id: string }>
    >`
      SELECT id, family_id, license_id, organization_id
        FROM auth_resolve_refresh_token(${hashToken(refreshToken)})
    `;
    const record = rows[0];
    if (!record) return null;
    await this.db.$queryRaw`SELECT auth_revoke_refresh_family(${record.family_id}::uuid)`;
    return { id: record.id, licenseId: record.license_id, organizationId: record.organization_id };
  }

  // --- Internals -----------------------------------------------------------

  /**
   * The role this account holds in this workspace right now, for the scope
   * ceiling above.
   *
   * Fails closed. A membership that has been removed, suspended or is still
   * awaiting approval yields `agent` — the least authority — rather than
   * whatever the credential used to carry. Such a grant is refused outright on
   * the next request anyway (`token-service.resolve` answers
   * `membership_missing`), so this is not the gate; it is the answer given to a
   * question that must not be allowed to fall back to "whatever was asked for".
   */
  async #currentRole(
    licenseId: bigint,
    organizationId: string,
    accountId: string,
  ): Promise<AgentRole> {
    const role = await withTenant(this.db, { licenseId, organizationId }, async (tx) => {
      const membership = await tx.agentMembership.findUnique({
        where: { licenseId_agentId: { licenseId, agentId: accountId } },
        select: { role: true, suspended: true, awaitingApproval: true },
      });
      if (!membership || membership.suspended || membership.awaitingApproval) return null;
      return membership.role as AgentRole;
    });
    return role ?? 'agent';
  }

  async #authenticateClient(clientId: string, clientSecret?: string): Promise<OauthClientRecord> {
    const client = await this.findClient(clientId);
    if (!client) throw oauthError('invalid_client', 'Unknown client.');

    if (client.client_type === 'confidential') {
      if (!clientSecret || !client.secret_hash) {
        throw oauthError('invalid_client', 'Client authentication is required.');
      }
      if (!constantTimeEqual(hashToken(clientSecret), client.secret_hash)) {
        throw oauthError('invalid_client', 'Client authentication failed.');
      }
    }
    return client;
  }

  async #issueGrant(input: {
    clientId: string;
    accountId: string;
    licenseId: bigint;
    organizationId: string;
    scopes: string[];
    familyId?: string;
    rotatesFromId?: string;
  }): Promise<TokenGrant> {
    const familyId = input.familyId ?? crypto.randomUUID();

    // Re-derive the ceiling from the role the account holds *now* (SEC-2, tm
    // 146). Both grants funnel through here, so both are covered by one read:
    // the authorization-code exchange, where the code was minted moments ago
    // and the role has barely had time to move, and the refresh rotation, where
    // it has had thirty days — and where copying `record.scopes` forward
    // verbatim is what let a demoted admin keep an admin session for as long as
    // their client kept refreshing.
    //
    // `token-service.resolve` applies the same ceiling on every request, so
    // this is not what makes the session safe; what it makes is the *record*
    // honest. The scope list on the row, the `scope` in this response and the
    // one carried into the next rotation now say what the credential can
    // actually do, rather than what it could do when its family began.
    const scopes = scopesWithinRole(
      await this.#currentRole(input.licenseId, input.organizationId, input.accountId),
      input.scopes,
    );

    const access = await this.#tokens.issue({
      licenseId: input.licenseId,
      organizationId: input.organizationId,
      ownerId: input.accountId,
      kind: 'oauth',
      scopes,
      clientId: input.clientId,
      familyId,
      ttlSeconds: this.config.accessTokenTtl,
    });

    const refreshToken = generateToken();
    await withTenant(
      this.db,
      { licenseId: input.licenseId, organizationId: input.organizationId },
      async (tx) => {
        const created = await tx.oauthRefreshToken.create({
          data: {
            tokenHash: hashToken(refreshToken),
            clientId: input.clientId,
            accountId: input.accountId,
            licenseId: input.licenseId,
            organizationId: input.organizationId,
            scopes,
            familyId,
            expiresAt: new Date(Date.now() + this.config.refreshTokenTtl * 1000),
          },
          select: { id: true },
        });

        // Link the old token to its successor in the same transaction as the
        // successor's creation: if this failed separately, the old token would
        // stay usable and rotation would be decorative.
        if (input.rotatesFromId) {
          await tx.oauthRefreshToken.update({
            where: { id: input.rotatesFromId },
            data: { replacedById: created.id, revokedAt: new Date() },
          });
        }
      },
    );

    return {
      access_token: access.token,
      token_type: 'Bearer',
      expires_in: this.config.accessTokenTtl,
      refresh_token: refreshToken,
      scope: scopes.join(','),
      account_id: input.accountId,
      license_id: input.licenseId.toString(),
      organization_id: input.organizationId,
    };
  }

  /**
   * Best-effort audit write for the four `/auth/token` failures C6-a2 records
   * (C1): each is reached only after the record that failed was read back from
   * the database, so the tenant is trusted data, never the caller's own
   * `client_id`/`code`/`refresh_token`. Swallows its own failure — like
   * `recordLoginFailure` (`routes/auth.ts`) — so a trail write can never mask
   * the real `oauthError` the caller is about to see.
   */
  async #auditTokenFailure(
    licenseId: bigint,
    organizationId: string,
    grantType: 'authorization_code' | 'refresh_token',
    reason: TokenFailureReason,
    clientId: string,
  ): Promise<void> {
    try {
      await withTenant(this.db, { licenseId, organizationId }, (tx) =>
        writeAuditEntry(
          tx,
          {
            licenseId,
            chainSecret: this.config.auditChainSecret,
            actorId: null,
            actorType: 'system',
          },
          {
            action: 'auth.token_exchange_failed',
            target: `client:${clientId}`,
            metadata: { grant_type: grantType, reason },
          },
        ),
      );
    } catch {
      // Best-effort: the caller's `oauthError` is the response that matters.
    }
  }

  async #revokeTokensForAccount(
    licenseId: bigint,
    organizationId: string,
    accountId: string,
  ): Promise<void> {
    await withTenant(this.db, { licenseId, organizationId }, async (tx) => {
      await tx.apiToken.updateMany({
        where: { ownerId: accountId, kind: 'oauth', revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await tx.oauthRefreshToken.updateMany({
        where: { accountId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    });
  }
}
