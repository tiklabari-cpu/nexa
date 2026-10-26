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

/** The dashboard's three reads (tm 389.8), in the shapes the contract documents. */
export const DASHBOARD_KPIS = {
  generated_at: NOW,
  workspaces: {
    total: 12,
    by_status: { trialing: 5, active: 4, past_due: 1, read_only: 0, canceled: 1, suspended: 1 },
  },
  trials_ending_7d: 3,
  active_operator_sessions: 2,
  pending_payment_requests: 0,
  usage: {
    day: '20261025',
    ai_tokens_today: { llm: 120_345, embedding: 8_000 },
    period: '202610',
    ai_resolutions_month: 41,
    api_calls_month: 15_200,
  },
};

export function dashboardSignups(days: number): Record<string, unknown> {
  const data = Array.from({ length: days }, (_, index) => {
    const at = new Date(Date.UTC(2026, 9, 25) - (days - 1 - index) * 86_400_000);
    return { date: at.toISOString().slice(0, 10), count: index % 7 === 0 ? 2 : 0 };
  });
  return { days, total: data.reduce((sum, point) => sum + point.count, 0), data };
}

export const DASHBOARD_SNAPSHOT = {
  status: 'ok',
  service: 'api',
  version: '0.1.0',
  region: 'eu',
  uptime_s: 3_725,
  dependencies: {
    database: { status: 'up', latency_ms: 1.4 },
    redis: { status: 'up', latency_ms: 0.6 },
  },
  scheduler: {
    enabled: true,
    jobs: [
      {
        name: 'chat_timeout',
        interval_ms: 60_000,
        enabled: true,
        last_run_at: NOW,
        last_status: 'ok',
      },
      { name: 'sla', interval_ms: 60_000, enabled: true, last_run_at: NOW, last_status: 'ok' },
    ],
  },
  event_partitions: {},
  ai_jobs: { pending: 1, running: 0, oldest_age_s: 2.5 },
  providers: { mail: 'file' },
};

export const DASHBOARD_COMPONENTS = [
  ['mail', 'ok', 'file'],
  ['redis', 'ok', '0.6 ms'],
  ['db', 'ok', '1.4 ms'],
  ['scheduler', 'ok', '2 jobs'],
  ['ai_jobs', 'unknown', null],
  ['knowledge_jobs', 'unknown', null],
  ['doc_worker', 'unknown', null],
  ['captcha', 'unknown', null],
  ['geoip', 'not_installed', 'no database file'],
  ['channel_whatsapp', 'unknown', null],
  ['channel_meta', 'unknown', null],
  ['webhooks', 'unknown', null],
].map(([key, state, detail]) => ({
  key,
  state,
  detail,
  updated_at: state === 'unknown' ? null : NOW,
}));

export const DASHBOARD_HEALTH = {
  stale: false,
  generated_at: NOW,
  age_s: 4.2,
  snapshot: DASHBOARD_SNAPSHOT,
  components: DASHBOARD_COMPONENTS,
};

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

/** The workspace surface (tm 389.9): two pages of list, one workspace with every tab. */
export const WORKSPACE_ID = '42';

export function workspaceRow(id: string, name: string): Record<string, unknown> {
  return {
    license_id: id,
    organization_name: name,
    region: 'eu',
    status: 'trialing',
    plan: 'growth',
    trial_ends_at: '2026-11-01T00:00:00.000Z',
    created_at: '2026-10-01T00:00:00.000Z',
    owner_email: `owner-${id}@example.com`,
    member_count: 3,
  };
}

export const WORKSPACE_DETAIL = {
  workspace: {
    license_id: WORKSPACE_ID,
    organization: {
      id: '00000000-0000-4000-8000-000000000042',
      name: 'Acme Gaming',
      region: 'eu',
      timezone: 'Europe/Istanbul',
      sector: 'igaming',
      company_size: null,
      created_at: '2026-10-01T00:00:00.000Z',
    },
    license: {
      status: 'trialing',
      plan: 'growth',
      billing_cycle: 'monthly',
      trial_ends_at: '2026-11-01T00:00:00.000Z',
      suspended_at: null,
      suspended_reason: null,
      purge_scheduled_at: null,
      onboarding_completed_at: null,
      terms_accepted_at: null,
      sandbox_of_license_id: null,
      created_at: '2026-10-01T00:00:00.000Z',
    },
    owner: {
      account_id: '00000000-0000-4000-8000-0000000000b1',
      name: 'Ayşe Kurucu',
      email: 'ayse@acme.example',
      email_verified_at: '2026-10-01T00:00:00.000Z',
    },
    counts: { members: 3, brands: 1, customers: 120, chats: 845, tickets: 12, ai_agents: 2 },
    status_history: [
      {
        action: 'workspace.trial_extended',
        at: '2026-10-20T10:00:00.000Z',
        admin_id: '00000000-0000-4000-8000-0000000000aa',
        reason: 'Asked for more time',
      },
      { action: 'created', at: '2026-10-01T00:00:00.000Z', admin_id: null, reason: null },
    ],
  },
};

export const WORKSPACE_MEMBERS = {
  data: [
    {
      account_id: '00000000-0000-4000-8000-0000000000b1',
      name: 'Ayşe Kurucu',
      email: 'ayse@acme.example',
      role: 'owner',
      suspended: false,
      two_factor_enabled: true,
      joined_at: '2026-10-01T00:00:00.000Z',
      last_seen_at: null,
    },
    {
      account_id: '00000000-0000-4000-8000-0000000000b2',
      name: 'Lead Person',
      email: 'lead@acme.example',
      role: 'team_lead',
      suspended: false,
      two_factor_enabled: false,
      joined_at: '2026-10-02T00:00:00.000Z',
      last_seen_at: null,
    },
  ],
};

export const SUPPORT_MATCH = {
  data: [{ kind: 'thread_id', license_id: WORKSPACE_ID, organization_name: 'Acme Gaming' }],
};

function handleWorkspaces(
  method: string,
  path: string,
  body: unknown,
  search: URLSearchParams,
  notes: Array<Record<string, unknown>>,
  role: PlatformRole,
): Response | null {
  if (method === 'GET' && path === '/workspaces') {
    if (search.get('cursor') === 'page-2') {
      return json(200, { data: [workspaceRow('7', 'Zeta Bets')], next_cursor: null });
    }
    if (search.get('q') === 'nothing') return json(200, { data: [], next_cursor: null });
    return json(200, {
      data: [workspaceRow(WORKSPACE_ID, 'Acme Gaming'), workspaceRow('9', 'Beta Casino')],
      next_cursor: 'page-2',
    });
  }
  if (method === 'GET' && path === '/support/lookup') {
    return search.get('q') === 'TJ1H8CFKRV'
      ? json(200, SUPPORT_MATCH)
      : problem(404, 'not_found', 'Nothing matches that identifier.');
  }
  const match = /^\/workspaces\/([^/]+)(\/.*)?$/.exec(path);
  if (method === 'GET' && path.startsWith('/audit/workspaces/')) {
    return json(200, {
      items: [
        {
          id: '00000000-0000-4000-8000-0000000000c1',
          action: 'billing.subscription_updated',
          actor_id: null,
          actor_type: 'agent',
          target: null,
          metadata: {},
          ip: null,
          created_at: '2026-10-20T10:00:00.000Z',
        },
      ],
    });
  }
  if (!match) return null;
  if (match[1] !== WORKSPACE_ID) return problem(404, 'not_found', 'Workspace not found.');
  const tab = match[2] ?? '';
  if (method === 'GET') {
    switch (tab) {
      case '':
        return json(200, WORKSPACE_DETAIL);
      case '/members':
        return json(200, WORKSPACE_MEMBERS);
      case '/brands':
        return json(200, {
          data: [
            {
              id: '00000000-0000-4000-8000-0000000000d1',
              name: 'Acme',
              slug: 'acme',
              is_default: true,
              created_at: '2026-10-01T00:00:00.000Z',
            },
          ],
        });
      case '/notes':
        return json(200, { data: [...notes].reverse(), next_cursor: null });
      case '/impersonations':
        return json(200, { data: [] });
      case '/ai-summary':
        return json(200, { ai_agents: { total: 2, active: 1 } });
      case '/invoices/202609/download':
        return new Response('item,amount_cents\r\nSeats,9900\r\n', {
          status: 200,
          headers: { 'Content-Type': 'text/csv; charset=utf-8' },
        });
      case '/invoices':
        return json(200, {
          invoices: [
            {
              number: 'SIYAHTUS-202609',
              period: '202609',
              period_label: 'September 2026',
              period_start: '2026-09-01T00:00:00.000Z',
              period_end: '2026-10-01T00:00:00.000Z',
              issued_at: '2026-09-30T00:00:00.000Z',
              origin: 'issued',
              status: 'paid',
              currency: 'usd',
              line_items: [{ description: 'Seats', amount_cents: 9900 }],
              subtotal_cents: 9900,
              total_cents: 9900,
            },
          ],
        });
      default:
        return null;
    }
  }
  if (method === 'POST' && tab === '/notes') {
    if (role !== 'superadmin' && role !== 'support') return problem(403, 'authorization');
    const input = body as { body?: string; reason?: string };
    if (!input.reason || input.reason.trim().length < 3) {
      return problem(400, 'platform_reason_required');
    }
    const note = {
      id: `00000000-0000-4000-8000-${String(notes.length + 1).padStart(12, '0')}`,
      license_id: WORKSPACE_ID,
      admin_id: '00000000-0000-4000-8000-0000000000aa',
      admin_email: 'ops@example.com',
      body: input.body,
      created_at: NOW,
    };
    notes.push(note);
    return json(201, note);
  }
  return null;
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
  const notes: Array<Record<string, unknown>> = [];
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

  function handle(
    method: string,
    path: string,
    headers: Headers,
    body: unknown,
    search: URLSearchParams,
  ): Response {
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

    if (method === 'GET' && path === '/dashboard/kpis') return json(200, DASHBOARD_KPIS);
    if (method === 'GET' && path === '/dashboard/signups') {
      return json(200, dashboardSignups(Number(search.get('days') ?? 30)));
    }
    if (method === 'GET' && path === '/dashboard/health') return json(200, DASHBOARD_HEALTH);

    const workspaceResponse = handleWorkspaces(method, path, body, search, notes, role);
    if (workspaceResponse) return workspaceResponse;

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
    return handle(method, path, headers, body, url.searchParams);
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
