/**
 * Custom panel secrets and context tokens (KN-05 · tm 379): the token is a
 * plain HS256 JWT that lives five minutes and names one panel, and a sealed
 * secret opens only on the row it was written for.
 */
import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { CUSTOM_PANEL_TOKEN_TTL_SECONDS, customPanelAudience } from '@siyahtus/types';
import { CredentialDecryptError } from '../../lib/credential-cipher.js';
import {
  PANEL_SECRET_PREFIX,
  PanelSecretCodec,
  newPanelSecret,
  signPanelContextToken,
  verifyPanelContextToken,
  type PanelTokenInput,
} from './panel-token.js';

const PANEL = '6f1d3c1e-0b7a-4e57-9d55-1f1f2b0e9a01';
const OTHER_PANEL = '0c2e8a44-5d4b-4b55-8a2e-3a7c9d1e2f00';
const NOW = new Date('2026-11-03T10:00:00Z');

const input = (overrides: Partial<PanelTokenInput> = {}): PanelTokenInput => ({
  panelId: PANEL,
  delivery: 'frame',
  organizationId: 'a6a8f1f4-6c64-4bb2-8f0c-6b3f6fa2b2a1',
  licenseId: 42n,
  chatId: 'CHAT123ABC',
  threadId: 'THR456DEF',
  agentId: '9b1b8a4c-7d55-4a2e-b4c1-0a8f2c3d4e5f',
  player: { username: 'ayse_1987', usernameVerified: false },
  now: NOW,
  ...overrides,
});

const at = (seconds: number): Date => new Date(NOW.getTime() + seconds * 1000);

describe('custom panel context tokens', () => {
  const secret = newPanelSecret();

  it('is an HS256 JWT any library can verify with the secret string as its key', () => {
    const { token } = signPanelContextToken(secret, input());
    const [header, body, sig] = token.split('.') as [string, string, string];
    expect(JSON.parse(Buffer.from(header, 'base64url').toString())).toEqual({
      alg: 'HS256',
      typ: 'JWT',
    });
    // The signature is plain HMAC-SHA256 over `header.body` with the secret's UTF-8 bytes.
    expect(sig).toBe(
      createHmac('sha256', Buffer.from(secret, 'utf8'))
        .update(`${header}.${body}`)
        .digest('base64url'),
    );
  });

  it('names the conversation, the panel and the agent, and the player on a frame token', () => {
    const { claims } = signPanelContextToken(secret, input());
    expect(claims).toMatchObject({
      iss: 'siyahtus',
      aud: customPanelAudience(PANEL),
      delivery: 'frame',
      license_id: '42',
      panel_id: PANEL,
      chat_id: 'CHAT123ABC',
      thread_id: 'THR456DEF',
      player: { username: 'ayse_1987', username_verified: false },
    });
    expect(claims.jti).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('lives five minutes: valid a second before, refused from the fifth minute on', () => {
    const { token, claims } = signPanelContextToken(secret, input());
    expect(claims.exp - claims.iat).toBe(CUSTOM_PANEL_TOKEN_TTL_SECONDS);
    expect(CUSTOM_PANEL_TOKEN_TTL_SECONDS).toBe(300);
    expect(verifyPanelContextToken(token, secret, { panelId: PANEL, now: at(299) }).ok).toBe(true);
    expect(verifyPanelContextToken(token, secret, { panelId: PANEL, now: at(300) })).toEqual({
      ok: false,
      reason: 'expired',
    });
    expect(verifyPanelContextToken(token, secret, { panelId: PANEL, now: at(3600) })).toEqual({
      ok: false,
      reason: 'expired',
    });
  });

  it('is refused by another panel, under another secret, and once edited', () => {
    const { token } = signPanelContextToken(secret, input());
    expect(verifyPanelContextToken(token, secret, { panelId: OTHER_PANEL, now: NOW })).toEqual({
      ok: false,
      reason: 'audience',
    });
    expect(verifyPanelContextToken(token, newPanelSecret(), { panelId: PANEL, now: NOW })).toEqual({
      ok: false,
      reason: 'signature',
    });
    const [header, body, sig] = token.split('.') as [string, string, string];
    const claims = JSON.parse(Buffer.from(body, 'base64url').toString()) as Record<string, unknown>;
    const edited = Buffer.from(JSON.stringify({ ...claims, chat_id: 'OTHERCHAT1' })).toString(
      'base64url',
    );
    expect(
      verifyPanelContextToken(`${header}.${edited}.${sig}`, secret, { panelId: PANEL, now: NOW }),
    ).toEqual({ ok: false, reason: 'signature' });
  });

  it('refuses an unsigned "alg: none" token rather than reading it', () => {
    const { token } = signPanelContextToken(secret, input());
    const [, body] = token.split('.') as [string, string, string];
    const none = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    expect(
      verifyPanelContextToken(`${none}.${body}.`, secret, { panelId: PANEL, now: NOW }),
    ).toEqual({ ok: false, reason: 'malformed' });
    expect(verifyPanelContextToken('not-a-token', secret, { panelId: PANEL })).toEqual({
      ok: false,
      reason: 'malformed',
    });
  });

  it('never names the player on a link token, whatever the caller passed', () => {
    const { token, claims } = signPanelContextToken(secret, input({ delivery: 'link' }));
    expect(claims.player).toBeUndefined();
    expect(Buffer.from(token.split('.')[1]!, 'base64url').toString()).not.toContain('ayse_1987');
  });

  it('carries no player when the caller passes none (a masked role)', () => {
    const { claims } = signPanelContextToken(secret, input({ player: undefined }));
    expect('player' in claims).toBe(false);
  });
});

describe('custom panel secrets', () => {
  const codec = new PanelSecretCodec('x'.repeat(48));

  it('are 256 random bits behind a recognisable prefix', () => {
    const a = newPanelSecret();
    const b = newPanelSecret();
    expect(a.startsWith(PANEL_SECRET_PREFIX)).toBe(true);
    expect(a.length).toBe(PANEL_SECRET_PREFIX.length + 43);
    expect(a).not.toBe(b);
  });

  it('open only on the licence and panel they were sealed for', () => {
    const secret = newPanelSecret();
    const sealed = codec.seal(42n, PANEL, secret);
    expect(sealed).not.toContain(secret);
    expect(codec.open(42n, PANEL, sealed)).toBe(secret);
    expect(() => codec.open(42n, OTHER_PANEL, sealed)).toThrow(CredentialDecryptError);
    expect(() => codec.open(43n, PANEL, sealed)).toThrow(CredentialDecryptError);
    expect(() => new PanelSecretCodec('y'.repeat(48)).open(42n, PANEL, sealed)).toThrow(
      CredentialDecryptError,
    );
  });

  it('refuses a short key-encryption secret', () => {
    expect(() => new PanelSecretCodec('short')).toThrow(/at least 32/);
  });
});
