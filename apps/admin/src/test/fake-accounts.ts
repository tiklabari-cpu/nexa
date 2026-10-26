/**
 * The account surface (tm 389.11) for `fake-platform.ts`: a search of two pages, one account
 * with two memberships, and its actions with the server's rules in miniature — enough to see
 * the SPA react. The real rules have their own suite (`platform-accounts.test.ts`).
 */
import { platformRoleHas, type PlatformRole } from '@siyahtus/types';

const NOW = '2026-10-25T10:00:00.000Z';

export const ACCOUNT_ID = '00000000-0000-4000-8000-0000000000b2';

export function accountRow(id: string, name: string, email: string): Record<string, unknown> {
  return {
    id,
    email,
    name,
    created_at: '2026-10-01T00:00:00.000Z',
    email_verified_at: '2026-10-01T00:00:00.000Z',
    platform_suspended_at: null,
    membership_count: 2,
  };
}

export const ACCOUNT_DETAIL = {
  id: ACCOUNT_ID,
  email: 'lead@acme.example',
  name: 'Lead Person',
  created_at: '2026-10-01T00:00:00.000Z',
  email_verified_at: null as string | null,
  last_seen_at: '2026-10-24T09:00:00.000Z',
  last_sign_in_at: '2026-10-24T08:00:00.000Z',
  password_set: true,
  platform_suspended_at: null as string | null,
  platform_suspended_reason: null as string | null,
  two_factor: {
    enabled: true,
    enabled_at: '2026-10-02T00:00:00.000Z' as string | null,
    recovery_codes_left: 8,
  },
  credentials: { sessions: 2, personal_tokens: 1 },
  memberships: [
    {
      license_id: '42',
      organization_name: 'Acme Gaming',
      role: 'team_lead',
      suspended: false,
      awaiting_approval: false,
      license_status: 'trialing',
      sandbox: false,
      two_factor_required: true,
      joined_at: '2026-10-02T00:00:00.000Z',
    },
    {
      license_id: '9',
      organization_name: 'Beta Casino',
      role: 'agent',
      suspended: false,
      awaiting_approval: false,
      license_status: 'active',
      sandbox: false,
      two_factor_required: false,
      joined_at: '2026-10-03T00:00:00.000Z',
    },
  ],
};

export type FakeAccount = typeof ACCOUNT_DETAIL;

const PERMISSIONS: Record<string, string> = {
  'resend-verification': 'accounts.support',
  'force-password-reset': 'accounts.support',
  'revoke-sessions': 'accounts.support',
  'revoke-tokens': 'accounts.support',
  'reset-two-factor': 'accounts.manage',
  suspend: 'accounts.manage',
  unsuspend: 'accounts.manage',
  export: 'accounts.manage',
  erase: 'accounts.manage',
};

type Problem = (
  status: number,
  type: string,
  message?: string,
  details?: Record<string, unknown>,
) => Response;
type Json = (status: number, body: unknown) => Response;

export function handleAccounts(
  method: string,
  path: string,
  body: unknown,
  search: URLSearchParams,
  role: PlatformRole,
  state: { account: FakeAccount | null; soleOwner: boolean },
  json: Json,
  problem: Problem,
): Response | null {
  if (method === 'GET' && path === '/accounts') {
    if (!platformRoleHas(role, 'accounts.read')) return problem(403, 'authorization');
    if (search.get('cursor') === 'page-2') {
      return json(200, {
        data: [accountRow('00000000-0000-4000-8000-0000000000b9', 'Zed', 'zed@acme.example')],
        next_cursor: null,
      });
    }
    if (search.get('q') === 'nobody') return json(200, { data: [], next_cursor: null });
    return json(200, {
      data: [
        accountRow('00000000-0000-4000-8000-0000000000b1', 'Ayşe Kurucu', 'ayse@acme.example'),
        accountRow(ACCOUNT_ID, 'Lead Person', 'lead@acme.example'),
      ],
      next_cursor: 'page-2',
    });
  }
  const match = /^\/accounts\/([^/]+)(?:\/([a-z-]+))?$/.exec(path);
  if (!match) return null;
  if (match[1] !== ACCOUNT_ID || state.account === null) {
    return problem(404, 'not_found', 'Account not found.');
  }
  const account = state.account;
  const action = match[2];
  if (action === undefined) {
    return method === 'GET' ? json(200, { account }) : null;
  }
  const permission = PERMISSIONS[action];
  if (!permission || method !== 'POST') return null;
  if (!platformRoleHas(role, permission)) return problem(403, 'authorization');
  const input = (body ?? {}) as Record<string, unknown>;
  if (typeof input['reason'] !== 'string' || input['reason'].trim().length < 3) {
    return problem(400, 'platform_reason_required');
  }
  let unchanged = false;
  let mail: string | undefined;
  switch (action) {
    case 'resend-verification':
      unchanged = account.email_verified_at !== null;
      if (!unchanged) mail = 'sent';
      break;
    case 'force-password-reset':
      account.credentials = { ...account.credentials, sessions: 0 };
      mail = 'failed';
      break;
    case 'revoke-sessions':
      account.credentials = { ...account.credentials, sessions: 0 };
      break;
    case 'revoke-tokens':
      account.credentials = { sessions: 0, personal_tokens: 0 };
      break;
    case 'reset-two-factor':
      account.two_factor = { enabled: false, enabled_at: null, recovery_codes_left: 0 };
      break;
    case 'suspend':
      account.platform_suspended_at = NOW;
      account.platform_suspended_reason = String(input['reason']);
      break;
    case 'unsuspend':
      account.platform_suspended_at = null;
      account.platform_suspended_reason = null;
      break;
    case 'export':
      return json(200, {
        format: 'siyahtus.account-export.v1',
        generated_at: NOW,
        account: { id: account.id, email: account.email },
        memberships: [],
        personal_tokens: [],
        audit_summary: [],
      });
    case 'erase':
      if (String(input['confirm_email'] ?? '').toLowerCase() !== account.email) {
        return problem(400, 'validation', 'confirm_email does not match.', {
          reason: 'confirm_email_mismatch',
        });
      }
      if (state.soleOwner) {
        return problem(409, 'platform_account_state', 'Founder.', {
          reason: 'account_is_sole_owner',
          license_ids: ['42'],
        });
      }
      state.account = null;
      return json(200, { erased: true, account_id: ACCOUNT_ID, license_ids: ['42', '9'] });
  }
  return json(200, { unchanged, account, ...(mail ? { mail } : {}) });
}
