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
import { TokenService } from './token-service.js';

export interface OauthConfig {
  accessTokenTtl: number;
  refreshTokenTtl: number;
  authorizationCodeTtl: number;
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
    if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
      return false;
    }
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
      throw oauthError('invalid_grant', 'Authorization code has already been used.');
    }

    if (record.expires_at.getTime() <= Date.now()) {
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

  async revokeRefreshToken(refreshToken: string): Promise<boolean> {
    const rows = await this.db.$queryRaw<Array<{ family_id: string }>>`
      SELECT family_id FROM auth_resolve_refresh_token(${hashToken(refreshToken)})
    `;
    const family = rows[0]?.family_id;
    if (!family) return false;
    await this.db.$queryRaw`SELECT auth_revoke_refresh_family(${family}::uuid)`;
    return true;
  }

  // --- Internals -----------------------------------------------------------

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

    const access = await this.#tokens.issue({
      licenseId: input.licenseId,
      organizationId: input.organizationId,
      ownerId: input.accountId,
      kind: 'oauth',
      scopes: input.scopes,
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
            scopes: input.scopes,
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
      scope: input.scopes.join(','),
      account_id: input.accountId,
      license_id: input.licenseId.toString(),
      organization_id: input.organizationId,
    };
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
