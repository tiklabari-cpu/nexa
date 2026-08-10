/**
 * Partner app registration — FR-MOD-09.4 (v2, Could).
 *
 * The write half of `oauth_clients`. Until now the table was only ever *read*:
 * signup inserted one row per organization (the Nexa Agent App) and
 * `POST /auth/authorize` looked clients up through `auth_find_client`. This
 * service lets a workspace admin register their own client — the "build your
 * own app" surface — without touching a single line of the OAuth flow.
 *
 * Everything here is decided by what the existing flow already does, so the
 * three places a mismatch would hide are settled in one file:
 *
 *   1. Secret format. `OauthService.#authenticateClient` verifies with
 *      `constantTimeEqual(hashToken(clientSecret), client.secret_hash)`, so the
 *      stored value must be `hashToken(secret)` — nothing else. Store a bcrypt
 *      digest, or the plaintext, and the client registers cleanly and then
 *      fails at `POST /auth/token` for no visible reason.
 *   2. Redirect URIs. `OauthService.isRegisteredRedirect` compares raw strings
 *      after a structural check and deliberately does not normalise. So neither
 *      does registration: the value is validated and stored verbatim, and a URI
 *      that is not already in canonical form is refused up front rather than
 *      stored as something that can never match.
 *   3. Scopes. `POST /auth/authorize` treats an *empty* `client.scopes` as "no
 *      ceiling" (`client.scopes.length > 0 ? client.scopes : requested`). A
 *      client registered with no scopes would therefore be unbounded, which is
 *      the opposite of what an empty list looks like it means — so at least one
 *      scope is required, and the set is capped by what the caller holds.
 *
 * Isolation is RLS: every query runs inside `withTenant`, and the
 * `oauth_clients_tenant` policy is organization-scoped (USING + WITH CHECK), so
 * another organization's client is invisible to read, update and delete alike
 * (NFR-S4). The route turns "invisible" into 404, never 403 (NFR-S5).
 */
import { effectiveScopes, isScope } from '@nexa/types';
import { ApiError } from '../../lib/api-error.js';
import { generateClientId, generateToken, hashToken } from '../../lib/crypto.js';
import type { TenantClient, TenantContext } from '../../lib/tenant.js';

export const PARTNER_APP_CLIENT_TYPES = ['public', 'confidential'] as const;
export type PartnerAppClientType = (typeof PARTNER_APP_CLIENT_TYPES)[number];

/**
 * Enough for a staging, production and local callback per app, with room to
 * spare. A bound at all matters because the allowlist is scanned on every
 * authorization request.
 */
export const MAX_REDIRECT_URIS = 10;
const MAX_REDIRECT_URI_LENGTH = 2048;

export interface PartnerApp {
  client_id: string;
  display_name: string;
  client_type: PartnerAppClientType;
  redirect_uris: string[];
  scopes: string[];
  created_at: string;
}

/** The register response — an app plus its secret, returned once, if confidential. */
export interface PartnerAppRegistration extends PartnerApp {
  client_secret?: string;
}

/**
 * The rotate response. Unlike registration the secret is not optional here:
 * rotation only applies to a confidential client, so a successful rotation
 * always carries exactly one new secret.
 */
export interface PartnerAppSecretRotation extends PartnerApp {
  client_secret: string;
}

export interface PartnerAppInput {
  displayName: string;
  clientType: PartnerAppClientType;
  redirectUris: string[];
  scopes: string[];
}

export interface PartnerAppPatch {
  displayName?: string;
  redirectUris?: string[];
  scopes?: string[];
}

interface PartnerAppRow {
  id: string;
  displayName: string;
  clientType: string;
  redirectUris: string[];
  scopes: string[];
  createdAt: Date;
}

/** The non-secret columns. `secretHash` is intentionally never selected. */
const SAFE_SELECT = {
  id: true,
  displayName: true,
  clientType: true,
  redirectUris: true,
  scopes: true,
  createdAt: true,
} as const;

/**
 * Validate one redirect URI and return it **unchanged**.
 *
 * Every rule below is either a security boundary or a guarantee that the value
 * can actually match at sign-in time. The URI is never rewritten: the
 * authorization endpoint compares raw strings, so normalising here would
 * produce a stored value that looks right and never matches.
 */
export function validateRedirectUri(raw: string): string {
  const reject = (why: string): never => {
    throw ApiError.validation(`redirect_uri ${JSON.stringify(raw)} is not acceptable: ${why}`);
  };

  if (raw.length > MAX_REDIRECT_URI_LENGTH) return reject('longer than 2048 characters');

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    // Catches relative URIs (`/callback`) too — a redirect target must be absolute.
    return reject('it is not an absolute URI');
  }

  // A fragment is never sent to the server and cannot be matched, and a
  // registered `#` is how a fragment-injection trick gets a foothold.
  // Checked on the raw string because `new URL('…/cb#')` reports an empty hash.
  if (raw.includes('#')) return reject('it contains a fragment');
  // Mirrors `OauthService.isRegisteredRedirect`, which refuses any candidate
  // containing `..` — a registered one could therefore never match.
  if (raw.includes('..')) return reject('it contains a path traversal segment');
  // Wildcards are not a feature: matching is exact, so a `*` would only ever be
  // a stored value that never matches — or an invitation to add prefix matching
  // later, which is how open redirects are born.
  if (raw.includes('*')) return reject('wildcards are not supported; matching is exact');
  // `https://evil.test@good.test/cb` reads as `good.test` to a human and
  // resolves to `good.test` — but the credentials make phishing-grade URLs
  // trivial, and the SSRF guard refuses them on the webhook side for the same
  // reason.
  if (url.username || url.password) return reject('it embeds credentials');
  if (!url.hostname) return reject('it has no host');

  // https only, with the loopback exception the authorization endpoint already
  // makes so that local development works at all.
  const isLoopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopback)) {
    return reject('only https is allowed (http is permitted on localhost for development)');
  }

  // The last rule is the one that prevents silent breakage rather than attack:
  // sign-in compares the raw string a client sends against this stored value, and
  // an OAuth library sends the canonical form. `https://a.test:443/cb` and
  // `https://A.test/cb` would be stored as written and never match anything.
  const canonical = url.toString();
  if (canonical !== raw) {
    return reject(
      `it is not in canonical form and would never match; register ${JSON.stringify(canonical)} instead`,
    );
  }

  return raw;
}

export function validateRedirectUris(raw: string[]): string[] {
  if (raw.length === 0) throw ApiError.validation('At least one redirect_uri is required.');
  if (raw.length > MAX_REDIRECT_URIS) {
    throw ApiError.validation(`At most ${MAX_REDIRECT_URIS} redirect_uris are allowed.`);
  }

  const uris = raw.map(validateRedirectUri);
  if (new Set(uris).size !== uris.length) {
    throw ApiError.validation('redirect_uris must not contain duplicates.');
  }
  return uris;
}

/**
 * The scope ceiling: a session can only register a client weaker than or equal
 * to itself. Without it, an admin session could mint a client carrying scopes
 * nobody in the workspace holds, and then use it — privilege escalation with an
 * OAuth client as the laundering step (NFR-S5).
 *
 * Measured against the caller's *effective* scopes rather than the literal
 * strings on their token, because `chats--all:rw` genuinely confers
 * `chats--all:ro`; refusing to grant a client the narrower of two scopes the
 * caller already holds would be a false rejection, not a security property.
 */
export function narrowScopes(requested: string[], held: readonly string[]): string[] {
  const available = effectiveScopes(held);
  const escalating = requested.filter((s) => !available.has(s));
  if (escalating.length > 0) {
    throw ApiError.authorization(
      `Cannot grant scopes the current session does not hold: ${escalating.join(', ')}`,
    );
  }

  const scopes = requested.filter(isScope);
  if (scopes.length === 0) {
    throw ApiError.validation(
      'At least one valid scope is required; a client with no scopes is unbounded, not restricted.',
    );
  }
  return [...new Set(scopes)];
}

/**
 * A fresh client secret: 256 bits of entropy behind a recognisable prefix, so a
 * value that ends up in a log line or a paste is identifiable as a Nexa client
 * secret rather than an opaque blob nobody thinks to revoke. One function
 * because registration and rotation must mint the *same* shape — a rotation
 * that produced a differently-formed secret would still authenticate, and the
 * inconsistency would only surface much later, in whatever reads the prefix.
 */
function mintClientSecret(): string {
  return `nxcs_${generateToken(32)}`;
}

export class PartnerAppService {
  async list(tx: TenantClient): Promise<PartnerApp[]> {
    // RLS narrows to the caller's organization; oldest-first gives a stable
    // order (and puts the workspace's own sign-in client first, where it is).
    const rows = await tx.oauthClient.findMany({
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: SAFE_SELECT,
    });
    return rows.map((row) => this.serialise(row));
  }

  async get(tx: TenantClient, clientId: string): Promise<PartnerApp | null> {
    // `findFirst`, not `findUnique`: under RLS both are scoped, but `findFirst`
    // keeps the shape identical to the update/delete paths below.
    const row = await tx.oauthClient.findFirst({ where: { id: clientId }, select: SAFE_SELECT });
    return row ? this.serialise(row) : null;
  }

  /**
   * Register a client and return its secret exactly once.
   *
   * The secret exists only for a confidential client — a public one
   * authenticates with PKCE, and the database agrees: `oauth_clients_secret_
   * required_check` demands a hash for a confidential client and the OAuth flow
   * ignores one on a public client.
   */
  async register(
    tx: TenantClient,
    tenant: TenantContext,
    input: PartnerAppInput,
  ): Promise<PartnerAppRegistration> {
    // 128 bits of hex. Randomly generated rather than derived from the
    // organization or the name, so a client id reveals nothing about the
    // workspace behind it and cannot be guessed from one.
    const clientId = generateClientId();
    const secret = input.clientType === 'confidential' ? mintClientSecret() : undefined;

    const row = await tx.oauthClient.create({
      data: {
        id: clientId,
        organizationId: tenant.organizationId,
        displayName: input.displayName,
        clientType: input.clientType,
        redirectUris: input.redirectUris,
        scopes: input.scopes,
        // The one format that matters: `#authenticateClient` compares
        // `hashToken(presented)` against this column.
        secretHash: secret ? hashToken(secret) : null,
      },
      select: SAFE_SELECT,
    });

    return { ...this.serialise(row), ...(secret ? { client_secret: secret } : {}) };
  }

  /**
   * Scoped update rather than update-by-id: `updateMany` under RLS touches
   * nothing when the id belongs to another organization, so the route answers
   * 404 instead of silently editing a stranger's client.
   */
  async update(tx: TenantClient, clientId: string, patch: PartnerAppPatch): Promise<number> {
    const { count } = await tx.oauthClient.updateMany({
      where: { id: clientId },
      data: {
        ...(patch.displayName !== undefined ? { displayName: patch.displayName } : {}),
        ...(patch.redirectUris !== undefined ? { redirectUris: patch.redirectUris } : {}),
        ...(patch.scopes !== undefined ? { scopes: patch.scopes } : {}),
      },
    });
    return count;
  }

  /**
   * Re-key a confidential client: mint a new secret, store its hash, return the
   * plaintext exactly once. The old secret stops working the moment this
   * commits — `#authenticateClient` compares against the single `secret_hash`
   * column, so there is no overlap window in which both are valid. That is the
   * point: rotation exists because a secret leaked, and a grace period would
   * leave the leaked one usable for the length of it.
   *
   * Returns null when the id matches nothing the caller may see — another
   * organization's client reads as null under RLS, which the route turns into
   * 404 rather than 403 (NFR-S5). A public client is refused outright: it has no
   * secret to rotate (the schema's `oauth_clients_secret_required_check` and
   * OAuth 2.1 both say so), and silently minting one would leave a credential
   * the token endpoint never asks for and nobody knows exists.
   */
  async rotateSecret(
    tx: TenantClient,
    clientId: string,
  ): Promise<PartnerAppSecretRotation | null> {
    const existing = await tx.oauthClient.findFirst({
      where: { id: clientId },
      select: SAFE_SELECT,
    });
    if (!existing) return null;
    if (existing.clientType !== 'confidential') {
      throw ApiError.validation(
        'A public client has no secret to rotate; it authenticates with PKCE alone.',
      );
    }

    const secret = mintClientSecret();
    // `updateMany`, like the other writes: the RLS predicate is part of the
    // statement, so a row outside the tenant cannot be re-keyed even if the
    // read above somehow returned one.
    const { count } = await tx.oauthClient.updateMany({
      where: { id: clientId },
      data: { secretHash: hashToken(secret) },
    });
    if (count === 0) return null;

    return { ...this.serialise(existing), client_secret: secret };
  }

  /**
   * Same reasoning as `update`. Cascades take the client's authorization codes
   * and refresh tokens with it, so removal really does end its access rather
   * than leaving a redeemable grant behind.
   */
  async remove(tx: TenantClient, clientId: string): Promise<number> {
    const { count } = await tx.oauthClient.deleteMany({ where: { id: clientId } });
    return count;
  }

  /**
   * The organization's own sign-in client — the one `auth_list_memberships`
   * hands to the agent app, defined there as the oldest client of the
   * organization. It lives in this same table, so without asking, a partner
   * surface would happily let an admin delete the row every member of the
   * workspace logs in through. Reads and writes both go through here rather
   * than guessing from the id format.
   *
   * Returns null for an organization with no clients at all, in which case
   * nothing is protected — correct, because there is no sign-in client to break.
   */
  async firstPartyClientId(tx: TenantClient): Promise<string | null> {
    const row = await tx.oauthClient.findFirst({
      // Matches `auth_list_memberships`' `ORDER BY c.created_at LIMIT 1`, with
      // `id` added only to break a tie deterministically.
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true },
    });
    return row?.id ?? null;
  }

  serialise(row: PartnerAppRow): PartnerApp {
    return {
      client_id: row.id,
      display_name: row.displayName,
      client_type: row.clientType as PartnerAppClientType,
      redirect_uris: row.redirectUris,
      scopes: row.scopes,
      created_at: row.createdAt.toISOString(),
    };
  }
}
