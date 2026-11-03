/**
 * Custom panel secrets and context tokens (KN-05 · K29 · tm 379).
 *
 * **The secret.** Each panel has its own HMAC key, generated here and shown to
 * the admin once (create, rotate). It is kept AES-256-GCM sealed
 * (`lib/credential-cipher.ts`) under a key-encryption key derived from
 * `CUSTOMER_TOKEN_SECRET` — the member-token keys' pattern
 * (`member-token.ts`), with its own HKDF label so the two never share a key —
 * and bound by its additional data to the licence and the panel: a ciphertext
 * copied onto another row does not open. A database dump alone signs nothing.
 *
 * **The token.** A standard HS256 JWT, so the operator's server verifies it
 * with any JWT library and the secret string as the key — nothing SiyahTuş-
 * specific to install. {@link verifyPanelContextToken} is the reference
 * verifier (the tests use it, and the settings screen's instructions describe
 * what it checks): signature, `alg`, issuer, audience and the five-minute
 * expiry. It is not called on any request path: the console never takes a
 * token back.
 */
import { createHmac, hkdfSync, randomBytes, randomUUID } from 'node:crypto';
import {
  CUSTOM_PANEL_TOKEN_ISSUER,
  CUSTOM_PANEL_TOKEN_TTL_SECONDS,
  customPanelAudience,
  type CustomPanelTokenClaims,
  type CustomPanelTokenDelivery,
} from '@siyahtus/types';
import { decryptCredential, encryptCredential } from '../../lib/credential-cipher.js';
import { constantTimeEqual } from '../../lib/crypto.js';

const KEK_INFO = 'siyahtus/custom-panel/secret-encryption/v1';

/** A secret's prefix — lets a secret scanner recognise one that leaked into a repository. */
export const PANEL_SECRET_PREFIX = 'stp_';

/** 256 bits of key material, written as the string the operator stores. */
export function newPanelSecret(): string {
  return `${PANEL_SECRET_PREFIX}${randomBytes(32).toString('base64url')}`;
}

/** The additional data that binds a sealed secret to its licence and panel. */
export function panelSecretAad(licenseId: bigint, panelId: string): string {
  return `custom-panel:${licenseId.toString()}:${panelId}`;
}

export class PanelSecretCodec {
  /** Hex, the form `credential-cipher.ts` takes. */
  readonly #kek: string;

  constructor(customerTokenSecret: string) {
    if (customerTokenSecret.length < 32) {
      throw new Error('CUSTOMER_TOKEN_SECRET must be at least 32 characters.');
    }
    this.#kek = Buffer.from(
      hkdfSync('sha256', customerTokenSecret, Buffer.alloc(0), KEK_INFO, 32),
    ).toString('hex');
  }

  seal(licenseId: bigint, panelId: string, secret: string): string {
    return encryptCredential(secret, this.#kek, panelSecretAad(licenseId, panelId));
  }

  /**
   * Throws `CredentialDecryptError` for anything that does not open: another
   * row's ciphertext, edited bytes, a changed `CUSTOMER_TOKEN_SECRET`.
   */
  open(licenseId: bigint, panelId: string, sealed: string): string {
    return decryptCredential(sealed, this.#kek, panelSecretAad(licenseId, panelId));
  }
}

const HEADER = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' }), 'utf8').toString(
  'base64url',
);

function signature(secret: string, signingInput: string): string {
  return createHmac('sha256', Buffer.from(secret, 'utf8'))
    .update(signingInput, 'utf8')
    .digest('base64url');
}

export interface PanelTokenInput {
  panelId: string;
  delivery: CustomPanelTokenDelivery;
  organizationId: string;
  licenseId: bigint;
  chatId: string;
  threadId: string | null;
  agentId: string;
  /** Omitted: the token says nothing about the player (a `link` token, or a masked role). */
  player?: { username: string | null; usernameVerified: boolean };
  now?: Date;
}

/** Sign a context token. `exp` is always `iat` + {@link CUSTOM_PANEL_TOKEN_TTL_SECONDS}. */
export function signPanelContextToken(
  secret: string,
  input: PanelTokenInput,
): { token: string; claims: CustomPanelTokenClaims } {
  const iat = Math.floor((input.now ?? new Date()).getTime() / 1000);
  const claims: CustomPanelTokenClaims = {
    iss: CUSTOM_PANEL_TOKEN_ISSUER,
    aud: customPanelAudience(input.panelId),
    iat,
    exp: iat + CUSTOM_PANEL_TOKEN_TTL_SECONDS,
    jti: randomUUID(),
    delivery: input.delivery,
    org_id: input.organizationId,
    license_id: input.licenseId.toString(),
    panel_id: input.panelId,
    chat_id: input.chatId,
    thread_id: input.threadId,
    agent_id: input.agentId,
    // A link token never names the player, whatever the caller passed.
    ...(input.player && input.delivery === 'frame'
      ? {
          player: {
            username: input.player.username,
            username_verified: input.player.usernameVerified,
          },
        }
      : {}),
  };
  const body = Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url');
  const signingInput = `${HEADER}.${body}`;
  return { token: `${signingInput}.${signature(secret, signingInput)}`, claims };
}

export type PanelTokenRefusal = 'malformed' | 'signature' | 'issuer' | 'audience' | 'expired';

/**
 * The reference verifier — what the operator's server does with the token.
 * The signature is checked before anything in the body is believed; `alg`
 * must be `HS256` (a token claiming `none` is not unsigned, it is refused).
 */
export function verifyPanelContextToken(
  token: string,
  secret: string,
  expected: { panelId: string; now?: Date },
): { ok: true; claims: CustomPanelTokenClaims } | { ok: false; reason: PanelTokenRefusal } {
  const parts = token.split('.');
  if (parts.length !== 3) return { ok: false, reason: 'malformed' };
  const [header, body, presented] = parts as [string, string, string];
  let parsedHeader: unknown;
  try {
    parsedHeader = JSON.parse(Buffer.from(header, 'base64url').toString('utf8'));
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (
    typeof parsedHeader !== 'object' ||
    parsedHeader === null ||
    (parsedHeader as { alg?: unknown }).alg !== 'HS256'
  ) {
    return { ok: false, reason: 'malformed' };
  }
  if (!constantTimeEqual(presented, signature(secret, `${header}.${body}`))) {
    return { ok: false, reason: 'signature' };
  }
  let claims: CustomPanelTokenClaims;
  try {
    claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as CustomPanelTokenClaims;
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (claims.iss !== CUSTOM_PANEL_TOKEN_ISSUER) return { ok: false, reason: 'issuer' };
  if (claims.aud !== customPanelAudience(expected.panelId)) {
    return { ok: false, reason: 'audience' };
  }
  const now = Math.floor((expected.now ?? new Date()).getTime() / 1000);
  if (typeof claims.exp !== 'number' || now >= claims.exp) return { ok: false, reason: 'expired' };
  return { ok: true, claims };
}
