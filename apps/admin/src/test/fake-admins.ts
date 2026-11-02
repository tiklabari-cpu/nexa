/**
 * The operator directory, the audit trail and the operator's own security (tm 391) for
 * `fake-platform.ts`: operators and invitations that change the way the server's rules do (a
 * reason on every write, a fresh code for the dangerous ones, the last active superadmin kept),
 * a chain whose entries page by keyset and export by cursor, and the signed-in operator's
 * sessions and recovery sheet. The real rules have their own suites (`platform-admins.test.ts`,
 * `platform-audit.test.ts`); here the question is what the SPA does with the answers.
 */
import { platformPermissionsFor, type PlatformRole } from '@siyahtus/types';

const NOW = '2026-10-26T12:00:00.000Z';

export interface FakeAdmin {
  id: string;
  email: string;
  role: PlatformRole;
  totp_enrolled: boolean;
  totp_enrolled_at: string | null;
  disabled_at: string | null;
  invited_by: string | null;
  created_at: string;
  active_sessions: number;
  last_seen_at: string | null;
}

export interface FakeInvite {
  id: string;
  email: string;
  role: PlatformRole;
  invited_by: string | null;
  created_at: string;
  expires_at: string;
}

export interface FakeAuditEntry {
  chain_seq: string;
  admin_id: string | null;
  action: string;
  target_type: string;
  target_id: string | null;
  license_id: string | null;
  reason: string | null;
  payload: Record<string, unknown>;
  ip: string | null;
  created_at: string;
}

export interface FakeSession {
  id: string;
  stage: 'active';
  created_at: string;
  expires_at: string;
  last_seen_at: string;
  totp_verified_at: string;
  idle_timeout_s: number;
  recent_totp_until: string | null;
  ip: string | null;
  user_agent: string | null;
  current: boolean;
}

export interface FakeAdminsState {
  admins: FakeAdmin[];
  invites: FakeInvite[];
  /** The invitation mail did not go: the answer carries the link instead. */
  mailFails: boolean;
  /** The window of the last authenticator code has closed: a dangerous write is 403. */
  totpStale: boolean;
  /** The trail, newest first. */
  entries: FakeAuditEntry[];
  /** Entries per list page, so a test can reach "Load more" with a few rows. */
  listPageSize: number;
  /** Entries per export page. */
  exportPageSize: number;
  verification: 'clean' | 'broken';
  sessions: FakeSession[];
  /** How many times a recovery sheet was issued on request. */
  sheets: number;
}

export const SELF_ID = '00000000-0000-4000-8000-0000000000aa';
export const OTHER_ID = '00000000-0000-4000-8000-0000000000bb';
export const SUPPORT_ID = '00000000-0000-4000-8000-0000000000cc';

function entry(
  seq: number,
  admin: string | null,
  action: string,
  extra: Partial<FakeAuditEntry> = {},
): FakeAuditEntry {
  return {
    chain_seq: String(seq),
    admin_id: admin,
    action,
    target_type: 'admin',
    target_id: null,
    license_id: null,
    reason: 'Because the runbook says so',
    payload: {},
    ip: '203.0.113.7',
    created_at: `2026-10-26T11:${String(10 + seq).padStart(2, '0')}:00.000Z`,
    ...extra,
  };
}

export function initialAdminsState(email: string, role: PlatformRole): FakeAdminsState {
  return {
    admins: [
      {
        id: SELF_ID,
        email,
        role,
        totp_enrolled: true,
        totp_enrolled_at: NOW,
        disabled_at: null,
        invited_by: null,
        created_at: NOW,
        active_sessions: 2,
        last_seen_at: NOW,
      },
      {
        id: OTHER_ID,
        email: 'second@example.com',
        role: 'support',
        totp_enrolled: true,
        totp_enrolled_at: NOW,
        disabled_at: null,
        invited_by: SELF_ID,
        created_at: NOW,
        active_sessions: 1,
        last_seen_at: NOW,
      },
      {
        id: SUPPORT_ID,
        email: 'gone@example.com',
        role: 'readonly',
        totp_enrolled: false,
        totp_enrolled_at: null,
        disabled_at: '2026-10-20T08:00:00.000Z',
        invited_by: SELF_ID,
        created_at: NOW,
        active_sessions: 0,
        last_seen_at: null,
      },
    ],
    invites: [
      {
        id: '33333333-3333-4333-8333-333333333333',
        email: 'newcomer@example.com',
        role: 'billing',
        invited_by: SELF_ID,
        created_at: NOW,
        expires_at: '2026-10-29T12:00:00.000Z',
      },
    ],
    mailFails: false,
    totpStale: false,
    entries: [
      entry(5, SELF_ID, 'admin.role_changed', { target_id: OTHER_ID }),
      entry(4, OTHER_ID, 'workspace.suspended', {
        target_type: 'workspace',
        target_id: '42',
        license_id: '42',
      }),
      entry(3, SELF_ID, 'billing.credit_granted', {
        target_type: 'credit',
        license_id: '7',
      }),
      entry(2, null, 'admin.sign_in_failed', { reason: null }),
      entry(1, SELF_ID, 'admin.bootstrapped', { reason: null }),
    ],
    listPageSize: 50,
    exportPageSize: 3,
    verification: 'clean',
    sessions: [
      {
        id: '44444444-4444-4444-8444-444444444441',
        stage: 'active',
        created_at: NOW,
        expires_at: '2026-10-26T20:00:00.000Z',
        last_seen_at: NOW,
        totp_verified_at: NOW,
        idle_timeout_s: 900,
        recent_totp_until: NOW,
        ip: '198.51.100.4',
        user_agent: 'Firefox on Linux',
        current: true,
      },
      {
        id: '44444444-4444-4444-8444-444444444442',
        stage: 'active',
        created_at: '2026-10-26T08:00:00.000Z',
        expires_at: '2026-10-26T16:00:00.000Z',
        last_seen_at: '2026-10-26T09:00:00.000Z',
        totp_verified_at: '2026-10-26T08:00:00.000Z',
        idle_timeout_s: 900,
        recent_totp_until: null,
        ip: '192.0.2.99',
        user_agent: 'Safari on macOS',
        current: false,
      },
    ],
    sheets: 0,
  };
}

type Json = (status: number, body: unknown) => Response;
type Problem = (
  status: number,
  type: string,
  message?: string,
  details?: Record<string, unknown>,
) => Response;

const ADMIN_ACTION = /^\/admins\/([^/]+)\/(role|disable|enable|reset-two-factor|revoke-sessions)$/;
const INVITE_REVOKE = /^\/admins\/invites\/([^/]+)\/revoke$/;

function activeSuperadmins(state: FakeAdminsState): FakeAdmin[] {
  return state.admins.filter((a) => a.role === 'superadmin' && a.disabled_at === null);
}

export function handleAdmins(
  method: string,
  path: string,
  body: unknown,
  search: URLSearchParams,
  role: PlatformRole,
  state: FakeAdminsState,
  json: Json,
  problem: Problem,
): Response | null {
  const can = (permission: string): boolean =>
    (platformPermissionsFor(role) as readonly string[]).includes(permission);
  const input = (body ?? {}) as Record<string, unknown>;
  const reasonOk = typeof input['reason'] === 'string' && input['reason'].trim().length >= 3;

  // --- Operators --------------------------------------------------------------------------
  if (method === 'GET' && path === '/admins') {
    if (!can('admins.read')) return problem(403, 'authorization');
    return json(200, { data: state.admins });
  }
  if (method === 'GET' && path === '/admins/invites') {
    if (!can('admins.read')) return problem(403, 'authorization');
    return json(200, { data: state.invites });
  }

  /** The gate every operator write shares: permission, reason, and (if asked) a fresh code. */
  const gate = (fresh: boolean): Response | null => {
    if (!can('admins.manage')) return problem(403, 'authorization');
    if (!reasonOk) return problem(400, 'platform_reason_required');
    if (fresh && state.totpStale) return problem(403, 'platform_recent_totp_required');
    return null;
  };

  if (method === 'POST' && path === '/admins/invites') {
    const refused = gate(true);
    if (refused) return refused;
    const email = String(input['email'] ?? '')
      .trim()
      .toLowerCase();
    if (state.admins.some((a) => a.email === email)) return problem(409, 'account_exists');
    const invite: FakeInvite = {
      id: `55555555-5555-4555-8555-${String(state.invites.length + 1).padStart(12, '0')}`,
      email,
      role: input['role'] as PlatformRole,
      invited_by: SELF_ID,
      created_at: NOW,
      expires_at: '2026-10-29T12:00:00.000Z',
    };
    state.invites.push(invite);
    return json(201, {
      invite,
      mail: state.mailFails ? 'failed' : 'sent',
      ...(state.mailFails ? { accept_url: 'https://admin.test/invite#token=abc123' } : {}),
    });
  }

  const revoke = INVITE_REVOKE.exec(path);
  if (method === 'POST' && revoke) {
    const refused = gate(false);
    if (refused) return refused;
    const index = state.invites.findIndex((i) => i.id === revoke[1]);
    if (index < 0) return problem(404, 'not_found');
    state.invites.splice(index, 1);
    return new Response(null, { status: 204 });
  }

  const action = ADMIN_ACTION.exec(path);
  if (method === 'POST' && action) {
    const [, id, verb] = action;
    const refused = gate(verb !== 'revoke-sessions');
    if (refused) return refused;
    const target = state.admins.find((a) => a.id === id);
    if (!target) return problem(404, 'not_found');

    const lastOne =
      target.role === 'superadmin' &&
      target.disabled_at === null &&
      activeSuperadmins(state).length === 1;
    if (verb === 'role') {
      if (lastOne && input['role'] !== 'superadmin')
        return problem(409, 'platform_last_superadmin');
      target.role = input['role'] as PlatformRole;
    } else if (verb === 'disable') {
      if (lastOne) return problem(409, 'platform_last_superadmin');
      target.disabled_at = NOW;
      target.active_sessions = 0;
    } else if (verb === 'enable') {
      target.disabled_at = null;
    } else if (verb === 'reset-two-factor') {
      target.totp_enrolled = false;
      target.totp_enrolled_at = null;
      target.active_sessions = 0;
    } else {
      const ended = target.active_sessions;
      target.active_sessions = 0;
      return json(200, { ended });
    }
    return json(200, target);
  }

  // --- The audit trail --------------------------------------------------------------------
  if (path === '/audit' || path === '/audit/export' || path === '/audit/verify') {
    if (!can('audit.read')) return problem(403, 'authorization');
  }

  if (method === 'GET' && path === '/audit') {
    const adminId = search.get('admin_id');
    const action = search.get('action');
    const license = search.get('license_id');
    const from = search.get('from');
    const to = search.get('to');
    const cursor = search.get('cursor');
    const matching = state.entries.filter(
      (e) =>
        (!adminId || e.admin_id === adminId) &&
        (!action || e.action === action) &&
        (!license || e.license_id === license) &&
        (!from || e.created_at >= from) &&
        (!to || e.created_at <= to) &&
        (!cursor || Number(e.chain_seq) < Number(cursor)),
    );
    const limit = Math.min(Number(search.get('limit') ?? 50), state.listPageSize);
    const page = matching.slice(0, limit);
    const last = page[page.length - 1];
    return json(200, {
      data: page,
      next_cursor: matching.length > limit && last ? last.chain_seq : null,
    });
  }

  if (method === 'GET' && path === '/audit/export') {
    const after = Number(search.get('cursor') ?? 0);
    const oldestFirst = [...state.entries].reverse().filter((e) => Number(e.chain_seq) > after);
    const page = oldestFirst.slice(0, state.exportPageSize);
    const last = page[page.length - 1];
    const lines = page.map((e) =>
      JSON.stringify({ ...e, prev_hash: null, hash: 'h' + e.chain_seq }),
    );
    return new Response(lines.length ? lines.join('\n') + '\n' : '', {
      status: 200,
      headers: {
        'content-type': 'application/x-ndjson; charset=utf-8',
        'x-siyahtus-signature': `sig-${page[0]?.chain_seq ?? 'none'}-${last?.chain_seq ?? 'none'}`,
        'x-siyahtus-export-count': String(page.length),
        'x-siyahtus-export-first-seq': page[0]?.chain_seq ?? '',
        'x-siyahtus-export-last-seq': last?.chain_seq ?? '',
        'x-siyahtus-export-has-more': oldestFirst.length > page.length ? 'true' : 'false',
        'x-siyahtus-export-cursor': last ? last.chain_seq : String(after || ''),
        'x-siyahtus-export-chain-ok': 'true',
      },
    });
  }

  if (method === 'POST' && path === '/audit/verify') {
    if (state.verification === 'clean') {
      return json(200, {
        ok: true,
        checked: 5,
        first_seq: '1',
        last_seq: '5',
        head_seq: '5',
        findings: [],
        findings_total: 0,
      });
    }
    return json(200, {
      ok: false,
      checked: 5,
      first_seq: '1',
      last_seq: '5',
      head_seq: '6',
      findings: [
        {
          kind: 'hash_mismatch',
          seq: '3',
          detail: 'The stored hash differs from the recomputed one.',
        },
        { kind: 'head_mismatch', seq: null, detail: 'The chain head is ahead of the last entry.' },
      ],
      findings_total: 2,
    });
  }

  // --- The operator's own security --------------------------------------------------------
  if (method === 'GET' && path === '/auth/sessions') return json(200, { data: state.sessions });
  if (method === 'DELETE' && path === '/auth/sessions') {
    const ended = state.sessions.filter((s) => !s.current).length;
    state.sessions = state.sessions.filter((s) => s.current);
    return json(200, { ended });
  }
  if (method === 'POST' && path === '/auth/recovery/regenerate') {
    if (state.totpStale) return problem(403, 'platform_recent_totp_required');
    state.sheets += 1;
    return json(200, {
      recovery_codes: Array.from({ length: 10 }, (_, i) => `NEW${state.sheets}${i}-ABCDE`),
    });
  }

  return null;
}
