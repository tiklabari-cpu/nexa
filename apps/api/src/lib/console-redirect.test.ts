/**
 * The console callback a deployment registers, derived from `WEB_APP_URL`
 * (tm 255.17 · PLAN §D189).
 *
 * The SQL side of the same rule is exercised against a real database in
 * `test/integration/console-redirect.test.ts`; this file holds the pure half
 * and the one thing that ties the two together — the pattern written twice.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseEnv } from '../config/env.js';
import { OauthService } from '../services/auth/oauth-service.js';
import {
  CONSOLE_REDIRECT_PATTERN,
  consoleRedirectUri,
  DEV_CONSOLE_REDIRECT,
} from './console-redirect.js';

const MIGRATION = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../prisma/migrations/20260925120000_console_redirect_from_config/migration.sql',
);

describe('consoleRedirectUri', () => {
  it.each([
    ['the pilot panel', 'https://panel.example.com', 'https://panel.example.com/auth/callback'],
    ['a trailing slash', 'https://panel.example.com/', 'https://panel.example.com/auth/callback'],
    // The panel sends `${window.location.origin}/auth/callback`, so a path on
    // `WEB_APP_URL` (there for links in mail) must not leak into the callback.
    ['a path', 'https://example.com/panel/', 'https://example.com/auth/callback'],
    [
      'an explicit port',
      'https://panel.example.com:8443',
      'https://panel.example.com:8443/auth/callback',
    ],
    [
      'a default port, dropped the way origin drops it',
      'https://panel.example.com:443',
      'https://panel.example.com/auth/callback',
    ],
    [
      'upper case, lowered the way origin lowers it',
      'HTTPS://Panel.Example.COM',
      'https://panel.example.com/auth/callback',
    ],
    ['the development stack', 'http://localhost:5173', DEV_CONSOLE_REDIRECT],
    [
      'the pilot rehearsal (tm 255.15)',
      'http://localhost:15173',
      'http://localhost:15173/auth/callback',
    ],
    ['loopback by address', 'http://127.0.0.1:5173', 'http://127.0.0.1:5173/auth/callback'],
  ])('derives the callback from %s', (_label, webAppUrl, expected) => {
    expect(consoleRedirectUri(webAppUrl)).toBe(expected);
  });

  it.each([
    ['plain http on a public host', 'http://panel.example.com'],
    ['plain http on a LAN address', 'http://192.168.1.20:5173'],
    ['a non-web scheme', 'nexa://auth'],
    ['an IPv6 literal', 'https://[::1]:5173'],
    ['not a URL at all', 'panel.example.com'],
  ])('refuses %s', (_label, webAppUrl) => {
    expect(consoleRedirectUri(webAppUrl)).toBeNull();
  });

  it('only ever produces a value the authorize check itself accepts', () => {
    // A derived callback the redirect check refuses would register fine and
    // then fail every sign-in — the exact failure this module exists to end.
    for (const webAppUrl of [
      'https://panel.example.com',
      'https://panel.example.com:8443/x',
      'http://localhost:15173',
      'http://127.0.0.1:5173',
    ]) {
      const uri = consoleRedirectUri(webAppUrl)!;
      expect(OauthService.isRegisteredRedirect(uri, [uri]), uri).toBe(true);
    }
  });
});

describe('the rule is written once in TypeScript and once in SQL — and they agree', () => {
  it('uses the same pattern as auth_console_redirect_admissible', () => {
    const sql = readFileSync(MIGRATION, 'utf8');
    const match = /p_redirect ~ '([^']+)'/.exec(sql);
    expect(match, 'migration no longer holds the pattern where this test looks').not.toBeNull();
    // A JavaScript regex literal escapes `/`; a POSIX one in SQL does not.
    expect(match![1]).toBe(CONSOLE_REDIRECT_PATTERN.source.replaceAll('\\/', '/'));
  });

  it('defaults auth_signup to the development callback, the value it wrote before', () => {
    const sql = readFileSync(MIGRATION, 'utf8');
    expect(sql).toContain(`p_console_redirect  TEXT DEFAULT '${DEV_CONSOLE_REDIRECT}'`);
  });
});

describe('env.consoleRedirectUri', () => {
  const BASE: NodeJS.ProcessEnv = {
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://nexa:nexa@127.0.0.1:5432/nexa',
    REDIS_URL: 'redis://127.0.0.1:6379',
    JWT_SIGNING_KEY: 'dev-only-jwt-signing-key-at-least-32-chars',
    WEBHOOK_HMAC_SEED: 'dev-only-webhook-hmac-seed-at-least-32-chars',
    CUSTOMER_TOKEN_SECRET: 'dev-only-customer-token-secret-32-chars',
    UPLOAD_SIGNING_KEY: 'dev-only-upload-signing-key-at-least-32-chars',
    AUDIT_CHAIN_SECRET: 'dev-only-audit-chain-secret-at-least-32-chars',
  };

  it('is the development callback when WEB_APP_URL is left at its default', () => {
    expect(parseEnv(BASE).consoleRedirectUri).toBe(DEV_CONSOLE_REDIRECT);
  });

  it("follows the deployment's WEB_APP_URL", () => {
    expect(parseEnv({ ...BASE, WEB_APP_URL: 'https://panel.example.com' }).consoleRedirectUri).toBe(
      'https://panel.example.com/auth/callback',
    );
  });

  it('falls back to the development callback outside production rather than refusing to boot', () => {
    // A LAN address set for links in mail: the panel on localhost keeps working.
    expect(parseEnv({ ...BASE, WEB_APP_URL: 'http://192.168.1.20:5173' }).consoleRedirectUri).toBe(
      DEV_CONSOLE_REDIRECT,
    );
  });
});
