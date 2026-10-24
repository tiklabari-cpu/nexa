/**
 * The human check's providers (tm 339.2 · GV-01): the offline mock, Turnstile
 * over a stubbed fetch — no test reaches Cloudflare — and the configuration
 * that turns either on, which never refuses the boot.
 */
import { describe, expect, it, vi } from 'vitest';
import { MOCK_CAPTCHA_PASS_TOKEN, MOCK_CAPTCHA_UNAVAILABLE_TOKEN } from '@siyahtus/types';
import {
  MockCaptchaVerifier,
  resolveCaptcha,
  TURNSTILE_VERIFY_URL,
  TurnstileVerifier,
  type CaptchaEnv,
} from './captcha.js';

const answer = (body: unknown, status = 200) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status }));

describe('the mock provider', () => {
  it('accepts its pass token, plays an unreachable provider for its other one, refuses the rest', async () => {
    const mock = new MockCaptchaVerifier();
    expect(await mock.verify(MOCK_CAPTCHA_PASS_TOKEN)).toBe('passed');
    expect(await mock.verify(MOCK_CAPTCHA_UNAVAILABLE_TOKEN)).toBe('unavailable');
    expect(await mock.verify('anything-else')).toBe('failed');
  });
});

describe('Turnstile', () => {
  it('posts the secret, the token and the address to siteverify and reads success', async () => {
    const fetch = answer({ success: true });
    const turnstile = new TurnstileVerifier('site', 'secret', fetch);
    expect(await turnstile.verify('tok', '203.0.113.9')).toBe('passed');
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(TURNSTILE_VERIFY_URL);
    expect(init.method).toBe('POST');
    expect(Object.fromEntries(init.body as URLSearchParams)).toEqual({
      secret: 'secret',
      response: 'tok',
      remoteip: '203.0.113.9',
    });
  });

  it('calls a refused token failed', async () => {
    const turnstile = new TurnstileVerifier(
      'site',
      'secret',
      answer({ success: false, 'error-codes': ['invalid-input-response'] }),
    );
    expect(await turnstile.verify('tok', null)).toBe('failed');
  });

  it("gives no verdict when it cannot: a network error, a 5xx, a body that is not JSON, its own or the secret's error", async () => {
    const cases = [
      vi.fn(async () => {
        throw new TypeError('fetch failed');
      }),
      answer({}, 503),
      vi.fn(async () => new Response('<html>', { status: 200 })),
      answer({ success: false, 'error-codes': ['internal-error'] }),
      answer({ success: false, 'error-codes': ['invalid-input-secret'] }),
    ];
    for (const fetch of cases) {
      expect(await new TurnstileVerifier('site', 'secret', fetch).verify('tok', null)).toBe(
        'unavailable',
      );
    }
  });
});

describe('resolveCaptcha — never a boot refusal', () => {
  const env = (over: Partial<CaptchaEnv>): CaptchaEnv => ({
    NODE_ENV: 'development',
    PILOT_MODE: false,
    CAPTCHA_PROVIDER: 'mock',
    ...over,
  });

  it('runs the mock outside production, and Turnstile with both keys', () => {
    expect(resolveCaptcha(env({}))).toMatchObject({ warnings: [] });
    expect(resolveCaptcha(env({})).verifier?.provider).toBe('mock');
    const turnstile = resolveCaptcha(
      env({
        CAPTCHA_PROVIDER: 'turnstile',
        TURNSTILE_SITE_KEY: 'site',
        TURNSTILE_SECRET_KEY: 'secret',
        NODE_ENV: 'production',
        PILOT_MODE: true,
      }),
    );
    expect(turnstile.verifier).toMatchObject({ provider: 'turnstile', siteKey: 'site' });
    expect(turnstile.warnings).toEqual([]);
  });

  it('leaves the check off with a warning: Turnstile without a key, the mock in production', () => {
    const keyless = resolveCaptcha(
      env({ CAPTCHA_PROVIDER: 'turnstile', TURNSTILE_SITE_KEY: 'site' }),
    );
    expect(keyless.verifier).toBeNull();
    expect(keyless.warnings).toEqual([expect.stringContaining('TURNSTILE_SECRET_KEY')]);

    const mockInProduction = resolveCaptcha(env({ NODE_ENV: 'production' }));
    expect(mockInProduction.verifier).toBeNull();
    expect(mockInProduction.warnings).toEqual([expect.stringContaining('not honoured')]);
  });

  it('warns a pilot that runs without Turnstile, and asks nothing with none', () => {
    const pilot = resolveCaptcha(
      env({ NODE_ENV: 'production', PILOT_MODE: true, CAPTCHA_PROVIDER: 'none' }),
    );
    expect(pilot.verifier).toBeNull();
    expect(pilot.warnings).toEqual([expect.stringContaining('PILOT_MODE=true')]);
    expect(resolveCaptcha(env({ CAPTCHA_PROVIDER: 'none' }))).toEqual({
      verifier: null,
      warnings: [],
    });
  });
});
