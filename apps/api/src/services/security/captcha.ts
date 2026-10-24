/**
 * The provider behind the widget's human check (tm 339.2 · SiyahTuş analysis
 * GV-01): Cloudflare Turnstile, or an offline stand-in for development and
 * the tests. Asked only when the risk signals flag a visitor
 * (`abuse-guard.ts`); a normal visitor never meets it.
 *
 * **Three answers, not two.** `passed` and `failed` are the provider's
 * verdict on the token; `unavailable` is "no verdict" — the provider could
 * not be reached, timed out, answered 5xx or reported its own error. The
 * caller treats it differently from `failed` (GV-01): the visitor still gets
 * their conversation, so a player can always reach a person, but the AI does
 * not answer them, so an outage is not an open door to the workspace's
 * allowance.
 *
 * **Never a boot refusal** (owner, 2026-10-10 — a setting that cannot work
 * never stops the deployment). {@link resolveCaptcha} turns every unusable
 * configuration into "no check" plus a boot warning: `turnstile` without both
 * keys; `mock` in production, where its published token would let anyone
 * through; and a pilot (`PILOT_MODE`) that runs anything but Turnstile.
 *
 * The mock makes no network call at all: it accepts
 * `MOCK_CAPTCHA_PASS_TOKEN`, plays an unreachable provider for
 * `MOCK_CAPTCHA_UNAVAILABLE_TOKEN` and refuses anything else.
 */
import {
  type CaptchaProvider,
  MOCK_CAPTCHA_PASS_TOKEN,
  MOCK_CAPTCHA_SITE_KEY,
  MOCK_CAPTCHA_UNAVAILABLE_TOKEN,
} from '@siyahtus/types';

/** The provider's verdict on one token, or `unavailable` when it gave none. */
export type CaptchaVerdict = 'passed' | 'failed' | 'unavailable';

export interface CaptchaVerifier {
  readonly provider: Exclude<CaptchaProvider, 'none'>;
  /** The public key the widget loads the check with (`details.site_key`). */
  readonly siteKey: string;
  verify(token: string, remoteIp: string | null): Promise<CaptchaVerdict>;
}

/** Turnstile's server-side check. */
export const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/** How long the API waits for Turnstile before calling it unreachable. */
export const TURNSTILE_TIMEOUT_MS = 5_000;

/** Turnstile's own bound on a response token. */
export const CAPTCHA_TOKEN_MAX_LENGTH = 2048;

export class MockCaptchaVerifier implements CaptchaVerifier {
  readonly provider = 'mock' as const;
  readonly siteKey = MOCK_CAPTCHA_SITE_KEY;

  async verify(token: string): Promise<CaptchaVerdict> {
    if (token === MOCK_CAPTCHA_PASS_TOKEN) return 'passed';
    if (token === MOCK_CAPTCHA_UNAVAILABLE_TOKEN) return 'unavailable';
    return 'failed';
  }
}

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export class TurnstileVerifier implements CaptchaVerifier {
  readonly provider = 'turnstile' as const;

  constructor(
    readonly siteKey: string,
    private readonly secret: string,
    private readonly fetchImpl: FetchLike = fetch,
    private readonly timeoutMs: number = TURNSTILE_TIMEOUT_MS,
  ) {}

  async verify(token: string, remoteIp: string | null): Promise<CaptchaVerdict> {
    const body = new URLSearchParams({ secret: this.secret, response: token });
    if (remoteIp) body.set('remoteip', remoteIp);
    let response: Response;
    try {
      response = await this.fetchImpl(TURNSTILE_VERIFY_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      return 'unavailable';
    }
    if (!response.ok) return 'unavailable';
    let answer: { success?: unknown; 'error-codes'?: unknown };
    try {
      answer = (await response.json()) as typeof answer;
    } catch {
      return 'unavailable';
    }
    if (answer.success === true) return 'passed';
    // Turnstile's own trouble, or ours (a wrong secret): no verdict on the
    // visitor either way, so not held against them.
    const codes = Array.isArray(answer['error-codes']) ? answer['error-codes'] : [];
    if (codes.some((code) => code === 'internal-error' || code === 'invalid-input-secret')) {
      return 'unavailable';
    }
    return 'failed';
  }
}

export interface CaptchaEnv {
  NODE_ENV: string;
  PILOT_MODE: boolean;
  CAPTCHA_PROVIDER: CaptchaProvider;
  TURNSTILE_SITE_KEY?: string | undefined;
  TURNSTILE_SECRET_KEY?: string | undefined;
}

/**
 * The verifier this deployment runs, or null when the check is off — and the
 * boot warnings that explain why it is off or weaker than the pilot needs.
 */
export function resolveCaptcha(
  env: CaptchaEnv,
  fetchImpl?: FetchLike,
): { verifier: CaptchaVerifier | null; warnings: string[] } {
  const warnings: string[] = [];
  const production = env.NODE_ENV === 'production';
  let verifier: CaptchaVerifier | null = null;

  if (env.CAPTCHA_PROVIDER === 'turnstile') {
    if (env.TURNSTILE_SITE_KEY && env.TURNSTILE_SECRET_KEY) {
      verifier = new TurnstileVerifier(env.TURNSTILE_SITE_KEY, env.TURNSTILE_SECRET_KEY, fetchImpl);
    } else {
      warnings.push(
        'CAPTCHA_PROVIDER=turnstile needs TURNSTILE_SITE_KEY and TURNSTILE_SECRET_KEY; the widget asks no human check until both are set.',
      );
    }
  } else if (env.CAPTCHA_PROVIDER === 'mock') {
    if (production) {
      warnings.push(
        'CAPTCHA_PROVIDER=mock is not honoured in production (its token is published); the widget asks no human check.',
      );
    } else {
      verifier = new MockCaptchaVerifier();
    }
  }

  if (production && env.PILOT_MODE && verifier?.provider !== 'turnstile') {
    warnings.push(
      'PILOT_MODE=true without a working Turnstile (CAPTCHA_PROVIDER=turnstile plus both keys): a script can open visitors from many addresses without a human check; only the per-member AI allowance and the rate limits hold it.',
    );
  }
  return { verifier, warnings };
}
