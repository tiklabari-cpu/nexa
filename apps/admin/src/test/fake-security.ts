/**
 * The Security surface (tm 389.16) for `fake-platform.ts`: a blocklist that adds and lifts entries
 * the way the server does (normalising a value, refusing a duplicate and a malformed value, a
 * reason on every write, who may write), and fixed counters. The real rules have their own suite
 * (`platform-security.test.ts`); here the question is what the SPA does with the answers.
 */
import { platformRoleHas, type PlatformRole } from '@siyahtus/types';

const NOW = '2026-10-26T12:00:00.000Z';

export interface FakeBlocklistEntry {
  id: string;
  kind: 'email' | 'domain' | 'ip';
  value: string;
  reason: string | null;
  created_by: string | null;
  created_by_email: string | null;
  created_at: string;
}

export interface FakeSecurityState {
  blocklist: FakeBlocklistEntry[];
  /** Entries per page, so a test can reach "Load more" with a few rows. */
  pageSize: number;
  failedLogins: 'busy' | 'quiet' | 'redis_down';
  abuse: 'busy' | 'not_installed';
}

export function initialSecurityState(): FakeSecurityState {
  return {
    blocklist: [
      {
        id: '11111111-1111-4111-8111-111111111111',
        kind: 'domain',
        value: 'burner.test',
        reason: 'Disposable mailbox provider',
        created_by: '22222222-2222-4222-8222-222222222222',
        created_by_email: 'ops@example.com',
        created_at: '2026-10-25T09:00:00.000Z',
      },
      {
        id: '11111111-1111-4111-8111-111111111112',
        kind: 'ip',
        value: '203.0.113.0/24',
        reason: 'Sign-up flood',
        created_by: null,
        created_by_email: null,
        created_at: '2026-10-24T09:00:00.000Z',
      },
    ],
    pageSize: 25,
    failedLogins: 'busy',
    abuse: 'busy',
  };
}

const FAILED_LOGINS_BUSY = {
  generated_at: NOW,
  hours: 24,
  since: '2026-10-25T12:00:00.000Z',
  tenant: {
    live: {
      status: 'available',
      window_seconds: 60,
      limit: 60,
      addresses_total: 2,
      locked_total: 1,
      addresses: [
        { ip: '198.51.100.2', failures: 60, locked: true },
        { ip: '198.51.100.1', failures: 3, locked: false },
      ],
      truncated: false,
    },
    history: {
      total: 7,
      by_ip: [
        { key: '198.51.100.2', count: 5 },
        { key: '198.51.100.1', count: 2 },
      ],
      by_workspace: [{ key: '1001', count: 7 }],
    },
  },
  operator: { sign_in_failed: 2, totp_failed: 1, by_ip: [{ key: '203.0.113.9', count: 3 }] },
};

const ABUSE_BUSY = {
  generated_at: NOW,
  invites: {
    status: 'available',
    limit_per_day: 50,
    workspaces_at_limit: 1,
    workspaces: [{ key: '1001', count: 50 }],
  },
  widget_quota: {
    status: 'available',
    day: '2026-10-26',
    members_at_cap: 4,
    workspaces_affected: 1,
    workspaces: [{ key: '1002', count: 4 }],
  },
  widget_challenge: {
    status: 'not_available',
    component: { key: 'captcha', state: 'ok', detail: 'mock provider', updated_at: NOW },
  },
};

type Json = (status: number, body: unknown) => Response;
type Problem = (
  status: number,
  type: string,
  message?: string,
  details?: Record<string, unknown>,
) => Response;

let nextId = 0;

/** What the server stores for a value, or null when it is not one of its kind. */
function normalise(kind: string, raw: string): string | null {
  const value = raw.trim().toLowerCase();
  if (kind === 'email') return /^[^@\s]+@[^@\s]+$/.test(value) ? value : null;
  if (kind === 'domain') {
    const domain = value.replace(/^(@|\*\.)/, '');
    return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain) ? domain : null;
  }
  if (kind === 'ip')
    return /^[0-9a-f.:]+(\/\d{1,3})?$/.test(value) && value.length > 2 ? value : null;
  return null;
}

export function handleSecurity(
  method: string,
  path: string,
  body: unknown,
  search: URLSearchParams,
  role: PlatformRole,
  state: FakeSecurityState,
  json: Json,
  problem: Problem,
): Response | null {
  if (!path.startsWith('/security/')) return null;

  if (method === 'GET') {
    if (!platformRoleHas(role, 'security.read')) return problem(403, 'authorization');
    switch (path) {
      case '/security/blocklist': {
        const kind = search.get('kind');
        const q = (search.get('q') ?? '').toLowerCase();
        const cursor = Number(search.get('cursor') ?? '0');
        const matching = state.blocklist.filter(
          (row) => (!kind || row.kind === kind) && (!q || row.value.includes(q)),
        );
        const page = matching.slice(cursor, cursor + state.pageSize);
        const more = cursor + state.pageSize < matching.length;
        return json(200, {
          data: page,
          next_cursor: more ? String(cursor + state.pageSize) : null,
        });
      }
      case '/security/failed-logins': {
        const hours = Number(search.get('hours') ?? '24');
        if (state.failedLogins === 'quiet') {
          return json(200, {
            ...FAILED_LOGINS_BUSY,
            hours,
            tenant: {
              live: {
                ...FAILED_LOGINS_BUSY.tenant.live,
                addresses_total: 0,
                locked_total: 0,
                addresses: [],
              },
              history: { total: 0, by_ip: [], by_workspace: [] },
            },
            operator: { sign_in_failed: 0, totp_failed: 0, by_ip: [] },
          });
        }
        if (state.failedLogins === 'redis_down') {
          return json(200, {
            ...FAILED_LOGINS_BUSY,
            hours,
            tenant: {
              ...FAILED_LOGINS_BUSY.tenant,
              live: {
                ...FAILED_LOGINS_BUSY.tenant.live,
                status: 'unavailable',
                addresses_total: 0,
                locked_total: 0,
                addresses: [],
              },
            },
          });
        }
        return json(200, { ...FAILED_LOGINS_BUSY, hours });
      }
      case '/security/signups-by-ip':
        return json(200, {
          status: 'not_available',
          days: Number(search.get('days') ?? '7'),
          reason: 'Sign-ups do not record the address they came from.',
          data: [],
        });
      case '/security/abuse-counters':
        if (state.abuse === 'not_installed') {
          return json(200, {
            ...ABUSE_BUSY,
            widget_quota: {
              status: 'not_installed',
              day: '2026-10-26',
              members_at_cap: 0,
              workspaces_affected: 0,
              workspaces: [],
            },
          });
        }
        return json(200, ABUSE_BUSY);
      case '/security/impersonations':
        return json(200, {
          data: [
            {
              id: '33333333-3333-4333-8333-333333333333',
              license_id: '1001',
              organization_name: 'Acme Oyun',
              account_id: '44444444-4444-4444-8444-444444444444',
              account_email: 'agent@acme.test',
              admin_id: '22222222-2222-4222-8222-222222222222',
              admin_email: 'ops@example.com',
              mode: 'read_only',
              started_at: '2026-10-26T11:00:00.000Z',
              ends_at: '2026-10-26T11:30:00.000Z',
              ended_at: '2026-10-26T11:10:00.000Z',
              end_reason: 'ended_by_operator',
              active: false,
            },
            {
              id: '33333333-3333-4333-8333-333333333334',
              license_id: '1002',
              organization_name: null,
              account_id: '44444444-4444-4444-8444-444444444445',
              account_email: 'lead@beta.test',
              admin_id: '22222222-2222-4222-8222-222222222222',
              admin_email: 'ops@example.com',
              mode: 'full',
              started_at: '2026-10-26T11:50:00.000Z',
              ends_at: '2026-10-26T12:20:00.000Z',
              ended_at: null,
              end_reason: null,
              active: true,
            },
          ].filter((row) => search.get('active') !== 'true' || row.active),
          next_cursor: null,
        });
      default:
        return null;
    }
  }

  const input = (body ?? {}) as { reason?: string; kind?: string; value?: string };
  const needReason = (): Response | null =>
    !input.reason || input.reason.trim().length < 3
      ? problem(400, 'platform_reason_required')
      : null;

  if (method === 'POST' && path === '/security/blocklist') {
    if (!platformRoleHas(role, 'security.manage')) return problem(403, 'authorization');
    const missing = needReason();
    if (missing) return missing;
    const value = normalise(input.kind ?? '', input.value ?? '');
    if (value === null) {
      return problem(400, 'validation', 'invalid value', {
        reason: 'invalid_value',
        kind: input.kind,
      });
    }
    if (state.blocklist.some((row) => row.kind === input.kind && row.value === value)) {
      return problem(400, 'validation', 'duplicate', {
        reason: 'already_listed',
        kind: input.kind,
      });
    }
    nextId += 1;
    const entry: FakeBlocklistEntry = {
      id: `55555555-5555-4555-8555-${String(nextId).padStart(12, '0')}`,
      kind: input.kind as FakeBlocklistEntry['kind'],
      value,
      reason: input.reason!.trim(),
      created_by: '22222222-2222-4222-8222-222222222222',
      created_by_email: 'ops@example.com',
      created_at: NOW,
    };
    state.blocklist.unshift(entry);
    return json(201, entry);
  }

  const lift = /^\/security\/blocklist\/([^/]+)$/.exec(path);
  if (method === 'DELETE' && lift) {
    if (!platformRoleHas(role, 'security.manage')) return problem(403, 'authorization');
    const missing = needReason();
    if (missing) return missing;
    const index = state.blocklist.findIndex((row) => row.id === lift[1]);
    if (index < 0) return problem(404, 'not_found');
    state.blocklist.splice(index, 1);
    return new Response(null, { status: 204 });
  }
  return null;
}
