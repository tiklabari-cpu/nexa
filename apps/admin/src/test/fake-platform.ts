/**
 * A stand-in for platform-api, as `fetch` (tm 389.6).
 *
 * It answers the paths the shell calls with the shapes `packages/contract/platform/openapi.yaml`
 * documents, keeps the one piece of state a sign-in needs (which token is which stage), and
 * records every request so a test can assert what was — and was not — sent. It is deliberately
 * small: the real server's gates have their own suite (`platform-auth.test.ts`); what is under
 * test here is the SPA's reaction to their answers.
 */
import { platformPermissionsFor, type PlatformRole } from '@siyahtus/types';
import { vi } from 'vitest';

export interface RecordedRequest {
  method: string;
  path: string;
  headers: Headers;
  body: unknown;
}

export interface FakePlatformOptions {
  role?: PlatformRole;
  email?: string;
  region?: 'eu' | 'us';
  /** Whether the operator already has an authenticator (`totp_verify`) or not (`totp_enroll`). */
  enrolled?: boolean;
  /** The one code the server accepts. */
  goodCode?: string;
  /** The one recovery code the server accepts. */
  goodRecoveryCode?: string;
  password?: string;
}

const NOW = '2026-10-25T10:00:00.000Z';

function session(stage: 'password' | 'active'): Record<string, unknown> {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    stage,
    created_at: NOW,
    expires_at: '2026-10-25T18:00:00.000Z',
    last_seen_at: NOW,
    totp_verified_at: stage === 'active' ? NOW : null,
    idle_timeout_s: 900,
    recent_totp_until: stage === 'active' ? '2026-10-25T10:05:00.000Z' : null,
  };
}

function json(status: number, body: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'X-Request-Id': 'req-test' },
  });
}

export function problem(
  status: number,
  type: string,
  message = type,
  details?: Record<string, unknown>,
): Response {
  return json(status, { error: { type, message, request_id: 'req-test', details } });
}

export interface FakePlatform {
  fetch: ReturnType<typeof vi.fn>;
  requests: RecordedRequest[];
  /** Calls made to `path` (any method). */
  calls: (path: string) => RecordedRequest[];
  /** The token currently valid, by stage. */
  tokens: { password: string | null; active: string | null };
  /** Make every later request with the active token a 401 (a session that ended). */
  endSession: () => void;
  /** Answer `path` with a fixed response from now on. */
  override: (method: string, path: string, response: () => Response) => void;
}

export function createFakePlatform(options: FakePlatformOptions = {}): FakePlatform {
  const role = options.role ?? 'superadmin';
  const email = options.email ?? 'ops@example.com';
  const enrolled = options.enrolled ?? true;
  const goodCode = options.goodCode ?? '123456';
  const goodRecoveryCode = options.goodRecoveryCode ?? 'ABCDE-FGHJK';
  const password = options.password ?? 'correct horse battery staple';

  const tokens: FakePlatform['tokens'] = { password: null, active: null };
  const dead = new Set<string>();
  const overrides = new Map<string, () => Response>();
  const requests: RecordedRequest[] = [];
  let issued = 0;

  const me = (stage: 'active'): Record<string, unknown> => ({
    admin: {
      id: '00000000-0000-4000-8000-0000000000aa',
      email,
      role,
      totp_enrolled_at: NOW,
      created_at: NOW,
    },
    permissions: platformPermissionsFor(role),
    session: session(stage),
    recovery_codes_remaining: 10,
  });

  function stageOf(token: string | null): 'password' | 'active' | null {
    if (token === null || dead.has(token)) return null;
    if (token === tokens.password) return 'password';
    if (token === tokens.active) return 'active';
    return null;
  }

  function handle(method: string, path: string, headers: Headers, body: unknown): Response {
    const override = overrides.get(`${method} ${path}`);
    if (override) return override();

    const bearer = /^Bearer (\S+)$/.exec(headers.get('Authorization') ?? '')?.[1] ?? null;
    const stage = stageOf(bearer);

    if (method === 'GET' && path === '/meta') {
      return json(200, { version: '0.1.0', region: options.region ?? 'eu' });
    }

    if (method === 'POST' && path === '/auth/login') {
      const input = body as { email?: string; password?: string };
      if (input.email !== email || input.password !== password) {
        return problem(401, 'authentication', 'Invalid email or password.');
      }
      issued += 1;
      tokens.password = `pw-token-${issued}`;
      return json(200, {
        token: tokens.password,
        next: enrolled ? 'totp_verify' : 'totp_enroll',
        session: session('password'),
      });
    }

    if (method === 'POST' && path === '/auth/invite/accept') {
      const input = body as { token?: string; password?: string };
      if (input.token !== 'good-invite') return problem(401, 'authentication', 'Invalid invite.');
      issued += 1;
      tokens.password = `pw-token-${issued}`;
      return json(200, {
        token: tokens.password,
        next: 'totp_enroll',
        session: session('password'),
      });
    }

    if (method === 'POST' && path === '/auth/logout') {
      if (stage === null) return problem(401, 'authentication');
      dead.add(bearer!);
      return new Response(null, { status: 204 });
    }

    if (stage === null) return problem(401, 'authentication', 'Sign in to continue.');

    if (method === 'POST' && path === '/auth/totp/enroll') {
      if (stage !== 'password') return problem(403, 'not_allowed');
      return json(200, {
        secret: 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP',
        otpauth_uri: 'otpauth://totp/SiyahTus:ops@example.com?secret=JBSWY3DPEHPK3PXP',
      });
    }

    if (method === 'POST' && path === '/auth/totp/activate') {
      if ((body as { code?: string }).code !== goodCode) return problem(401, 'authentication');
      issued += 1;
      tokens.active = `active-token-${issued}`;
      tokens.password = null;
      return json(200, {
        token: tokens.active,
        session: session('active'),
        recovery_codes: Array.from({ length: 10 }, (_, i) => `CODE${i}-ABCDE`),
      });
    }

    if (method === 'POST' && path === '/auth/totp/verify') {
      const input = body as { code?: string; recovery_code?: string };
      const ok =
        (input.code !== undefined && input.code === goodCode) ||
        (input.recovery_code !== undefined && input.recovery_code === goodRecoveryCode);
      if (!ok) return problem(401, 'authentication');
      issued += 1;
      tokens.active = `active-token-${issued}`;
      tokens.password = null;
      return json(200, {
        token: tokens.active,
        session: session('active'),
        method: input.code !== undefined ? 'totp' : 'recovery_code',
        recovery_codes_remaining: 9,
      });
    }

    if (method === 'POST' && path === '/auth/totp/reverify') {
      if ((body as { code?: string }).code !== goodCode) return problem(401, 'authentication');
      return json(200, { session: session('active') });
    }

    if (method === 'GET' && path === '/auth/me') {
      if (stage === 'password') {
        return problem(403, 'platform_totp_required', 'Finish signing in.', {
          next: enrolled ? 'totp_verify' : 'totp_enroll',
        });
      }
      return json(200, me('active'));
    }

    return problem(404, 'not_found', `${method} ${path}`);
  }

  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost');
    const path = url.pathname.replace(/^\/platform\/v1/, '');
    const method = (init?.method ?? 'GET').toUpperCase();
    const headers = new Headers(init?.headers);
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined;
    requests.push({ method, path, headers, body });
    if (!url.pathname.startsWith('/platform/v1')) return problem(404, 'not_found');
    return handle(method, path, headers, body);
  });

  return {
    fetch: fetchMock,
    requests,
    calls: (path) => requests.filter((request) => request.path === path),
    tokens,
    endSession() {
      for (const token of [tokens.active, tokens.password]) if (token) dead.add(token);
    },
    override(method, path, response) {
      overrides.set(`${method} ${path}`, response);
    },
  };
}
