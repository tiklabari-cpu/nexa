/**
 * Redirect matching, on its own.
 *
 * This is the check that decides where an authorization code is allowed to go,
 * so it is worth testing away from a database: every case below is a way the
 * rule could be loosened by accident, and none of them need a tenant to be
 * wrong.
 *
 * Three families are legal — the hosted console, a developer's loopback server,
 * and the phone's private-use scheme (RFC 8252 §7.1 · 13.7-b). Everything else
 * is refused before the registered set is even consulted.
 */
import { describe, expect, it } from 'vitest';
import { MOBILE_REDIRECT_URI } from '@nexa/types';
import { OauthService } from './oauth-service.js';

const HTTPS = 'https://console.example.test/auth/callback';
const LOOPBACK = 'http://localhost:5173/auth/callback';
const REGISTERED = [HTTPS, LOOPBACK, MOBILE_REDIRECT_URI];

const matches = (candidate: string, registered: readonly string[] = REGISTERED) =>
  OauthService.isRegisteredRedirect(candidate, registered);

describe('isRegisteredRedirect', () => {
  describe('accepts the three places a Nexa client actually runs', () => {
    it.each([HTTPS, LOOPBACK, MOBILE_REDIRECT_URI])('%s', (uri) => {
      expect(matches(uri)).toBe(true);
    });

    it('accepts the loopback address as well as the name', () => {
      expect(matches('http://127.0.0.1:5173/cb', ['http://127.0.0.1:5173/cb'])).toBe(true);
    });
  });

  describe('matches exactly, never nearly', () => {
    it.each([
      ['a different path', 'https://console.example.test/auth/callback2'],
      ['a trailing slash', 'https://console.example.test/auth/callback/'],
      ['a different case', 'https://Console.example.test/auth/callback'],
      ['an explicit default port', 'https://console.example.test:443/auth/callback'],
      ['an added query', 'https://console.example.test/auth/callback?next=/x'],
      ['a traversal back to a registered path', 'https://console.example.test/x/../auth/callback'],
      ['a fragment', 'https://console.example.test/auth/callback#'],
      ['nothing at all', 'not a uri'],
    ])('refuses %s', (_label, candidate) => {
      expect(matches(candidate)).toBe(false);
    });

    it('refuses a native scheme that merely resembles the registered one', () => {
      expect(matches('nexa://auth/callback2')).toBe(false);
      expect(matches('nexa-evil://auth/callback')).toBe(false);
      // The host segment is part of the string, so another app's `nexa://`
      // target is a different URI and not a match.
      expect(matches('nexa://attacker/callback')).toBe(false);
    });

    it('refuses credentials smuggled into an otherwise registered URI', () => {
      expect(matches('https://evil.test@console.example.test/auth/callback')).toBe(false);
    });
  });

  describe('refuses schemes that must never receive a code', () => {
    // Each of these is *registered* in the set it is matched against, so the
    // only thing standing between them and an authorization code is the scheme
    // check itself. Tenants cannot register these today
    // (`partner-app-service.validateRedirectUri` refuses anything but https and
    // loopback) — this is what keeps that true if a second registration path is
    // ever opened.
    it.each([
      'javascript:alert(1)',
      'data:text/html,<script>1</script>',
      'vbscript:msgbox',
      'file:///etc/passwd',
      'about:blank',
      'intent://scan#Intent;scheme=zxing;end',
      'ws://console.example.test/cb',
      'wss://console.example.test/cb',
      'ftp://console.example.test/cb',
      'mailto:someone@example.test',
      'tel:+15551234',
    ])('refuses %s even when registered', (candidate) => {
      expect(matches(candidate, [candidate])).toBe(false);
    });

    it('refuses a non-https scheme pointed at loopback', () => {
      // The old rule admitted any scheme whose host happened to be `localhost`.
      expect(matches('ftp://localhost/cb', ['ftp://localhost/cb'])).toBe(false);
    });

    it('refuses plain http anywhere but loopback', () => {
      expect(matches('http://console.example.test/cb', ['http://console.example.test/cb'])).toBe(
        false,
      );
    });
  });

  it('refuses everything when nothing is registered', () => {
    expect(matches(HTTPS, [])).toBe(false);
    expect(matches(MOBILE_REDIRECT_URI, [])).toBe(false);
  });
});
