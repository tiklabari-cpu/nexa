/**
 * "Enter as the customer" in the fake platform API (tm 389.15): start, list, read and end,
 * with the server's gates — `support.impersonate`, `full` for a superadmin only, a reason on
 * every write — so the SPA's tests see the refusals they have to show. The real rules and
 * both audit trails have their own suite (`platform-impersonation.test.ts`).
 */
import { platformRoleHas } from '@siyahtus/types';

const NOW = '2026-10-26T12:00:00.000Z';
const ENDS = '2026-10-26T12:30:00.000Z';

export interface FakeImpersonationState {
  sessions: Array<Record<string, unknown>>;
  /** The one workspace the fake knows, and who may be entered as in it. */
  workspace: { id: string; members: ReadonlyArray<{ account_id: string; email: string }> };
}

export function initialImpersonationState(
  workspace: FakeImpersonationState['workspace'],
): FakeImpersonationState {
  return { sessions: [], workspace };
}

type Json = (status: number, body: unknown) => Response;
type Problem = (
  status: number,
  type: string,
  message?: string,
  details?: Record<string, unknown>,
) => Response;

export function handleImpersonations(
  method: string,
  path: string,
  body: unknown,
  search: URLSearchParams,
  role: string,
  state: FakeImpersonationState,
  json: Json,
  problem: Problem,
): Response | null {
  if (path === '/support/impersonations' && method === 'GET') {
    const active = search.get('active') === 'true';
    const rows = state.sessions.filter((row) => !active || row['active'] === true);
    return json(200, { data: [...rows].reverse(), next_cursor: null });
  }

  if (path === '/support/impersonations' && method === 'POST') {
    if (!platformRoleHas(role, 'support.impersonate')) return problem(403, 'authorization');
    const input = body as {
      license_id?: string;
      account_id?: string;
      mode?: string;
      reason?: string;
    };
    if (!input.reason || input.reason.trim().length < 3) {
      return problem(400, 'platform_reason_required');
    }
    if (input.mode === 'full' && !platformRoleHas(role, 'support.impersonate_full')) {
      return problem(403, 'authorization');
    }
    const member = state.workspace.members.find((m) => m.account_id === input.account_id);
    if (input.license_id !== state.workspace.id || !member) return problem(404, 'not_found');
    const session = {
      id: `00000000-0000-4000-8000-${String(state.sessions.length + 1).padStart(12, '0')}`,
      license_id: state.workspace.id,
      organization_name: 'Acme Gaming',
      account_id: member.account_id,
      account_email: member.email,
      admin_id: '00000000-0000-4000-8000-0000000000aa',
      admin_email: 'ops@example.com',
      mode: input.mode ?? 'read_only',
      started_at: NOW,
      ends_at: ENDS,
      ended_at: null,
      end_reason: null,
      active: true,
    };
    state.sessions.push(session);
    return json(201, {
      impersonation: session,
      handoff_url: 'http://localhost:5173/auth/impersonate#code=one-time-code',
      handoff_expires_at: '2026-10-26T12:01:00.000Z',
      mail: 'sent',
    });
  }

  const one = /^\/support\/impersonations\/([^/]+)(\/end)?$/.exec(path);
  if (!one) return null;
  const session = state.sessions.find((row) => row['id'] === one[1]);
  if (!session) return problem(404, 'not_found');
  if (method === 'GET' && !one[2]) return json(200, { impersonation: session });
  if (method === 'POST' && one[2]) {
    if (!platformRoleHas(role, 'support.impersonate')) return problem(403, 'authorization');
    const input = body as { reason?: string };
    if (!input.reason || input.reason.trim().length < 3) {
      return problem(400, 'platform_reason_required');
    }
    const unchanged = session['active'] !== true;
    if (!unchanged) {
      Object.assign(session, { active: false, ended_at: NOW, end_reason: 'ended_by_operator' });
    }
    return json(200, { unchanged, impersonation: session });
  }
  return null;
}
