import { describe, expect, it } from 'vitest';
import { AGENT_ROLES } from './domain.js';
import { SCOPES } from './scopes.js';
import { ADMIN_SCOPES, defaultScopesForRole, scopesWithinRole } from './role-scopes.js';
import type { CapabilityOverride } from './capabilities.js';
import {
  credentialGrantFor,
  delegableScopes,
  narrowsChatReach,
  scopesForCredential,
  type CredentialGrant,
} from './credential-scopes.js';

const GRANTS: readonly CredentialGrant[] = ['session', 'delegated', 'personal'];
const ROLES = [...AGENT_ROLES, 'not-a-role'];

const set = (role: string, capability: string, value: string): CapabilityOverride => ({
  role,
  capability,
  value,
});

const resolve = (
  grant: CredentialGrant,
  role: string,
  stored: readonly string[],
  overrides: readonly CapabilityOverride[] = [],
) => scopesForCredential({ grant, role, stored, overrides });

/** A small deterministic generator, so a failing list can be reproduced. */
function lists(count: number): string[][] {
  let seed = 325_3;
  const next = () => {
    seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
    return seed / 2_147_483_648;
  };
  const out: string[][] = [];
  for (let i = 0; i < count; i++) {
    out.push(SCOPES.filter(() => next() < 0.3));
  }
  return out;
}

/** Stored lists a credential really carries: every role's set, narrow spellings, noise. */
const STORED: string[][] = [
  ...ROLES.map((role) => defaultScopesForRole(role)),
  ['chats--all:ro', 'chats--access:ro', 'tickets--all:ro'],
  ['reports_read', 'billing_manage', 'chats--access:rw', 'not-a-scope'],
  [],
  ...lists(40),
];

describe('a workspace that never touched the matrix', () => {
  it('resolves every credential exactly as before the matrix: same scopes, same order', () => {
    for (const role of ROLES) {
      for (const stored of STORED) {
        const capped = scopesWithinRole(role as never, stored);
        expect(resolve('session', role, stored), `session ${role}`).toEqual(capped);
        expect(resolve('delegated', role, stored), `delegated ${role}`).toEqual(capped);
        expect(resolve('personal', role, stored), `personal ${role}`).toEqual(stored);
      }
    }
  });

  it('treats overrides the PUT would refuse as no choice at all', () => {
    // Below the floor, Founder-only, Founder column, unknown row, unknown value.
    const refused = [
      set('agent', 'customers.erase', 'on'),
      set('agent', 'settings.permissions', 'on'),
      set('owner', 'reports.view', 'none'),
      set('agent', 'no.such.row', 'on'),
      set('agent', 'reports.view', 'team'),
    ];
    for (const role of ROLES) {
      for (const grant of GRANTS) {
        const stored = defaultScopesForRole(role);
        expect(resolve(grant, role, stored, refused), `${grant} ${role}`).toEqual(
          resolve(grant, role, stored),
        );
      }
    }
  });
});

describe('the matrix takes from a role', () => {
  const agentSet = defaultScopesForRole('agent');
  const noChats = [set('agent', 'chats.view', 'none')];

  it('takes it from every kind of credential at the next resolution (FR-MOD-04.RBAC)', () => {
    for (const grant of GRANTS) {
      const scopes = resolve(grant, 'agent', agentSet, noChats);
      expect(scopes, grant).not.toContain('chats--access:rw');
      expect(scopes, grant).toContain('tickets--access:rw');
    }
  });

  it('takes a narrower spelling of the scope too', () => {
    for (const grant of GRANTS) {
      expect(resolve(grant, 'agent', ['chats--access:ro'], noChats), grant).toEqual([]);
    }
  });

  it("takes a workspace power from an admin's session, partner grant and personal token alike", () => {
    const webhooksOff = [set('admin', 'settings.webhooks', 'off')];
    for (const grant of GRANTS) {
      const scopes = resolve(grant, 'admin', [...ADMIN_SCOPES], webhooksOff);
      expect(scopes, grant).not.toContain('webhooks--all:rw');
      expect(scopes, grant).toContain('reports_read');
    }
  });

  it('gives it back when the Founder switches it on again, without a new credential', () => {
    for (const grant of GRANTS) {
      expect(resolve(grant, 'agent', agentSet, noChats), grant).not.toContain('chats--access:rw');
      expect(resolve(grant, 'agent', agentSet, []), grant).toContain('chats--access:rw');
    }
  });

  it("reads the member's own column only: an admin restriction leaves an agent alone", () => {
    const adminsOnly = [set('admin', 'chats.view', 'team'), set('admin', 'tickets.view', 'none')];
    for (const grant of GRANTS) {
      expect(resolve(grant, 'agent', agentSet, adminsOnly), grant).toEqual(
        resolve(grant, 'agent', agentSet),
      );
    }
  });
});

describe('the matrix lends a role more than its default set', () => {
  const agentSet = defaultScopesForRole('agent');
  const reports = [set('agent', 'reports.view', 'all')];

  it('reaches a sign-in session that never had it, without signing in again', () => {
    expect(resolve('session', 'agent', agentSet, reports)).toEqual([...agentSet, 'reports_read']);
  });

  it('reaches a session as the whole level: every chat, not just the scope name', () => {
    const scopes = resolve('session', 'agent', agentSet, [set('agent', 'chats.view', 'all')]);
    expect(scopes).toContain('chats--all:rw');
    expect(scopes.filter((s) => s === 'chats--access:rw')).toHaveLength(1);
  });

  it('never widens a partner grant or a personal token past its own list (FR-MOD-04.RBAC)', () => {
    expect(resolve('delegated', 'agent', agentSet, reports)).toEqual(agentSet);
    expect(resolve('personal', 'agent', agentSet, reports)).toEqual(agentSet);
  });

  it('takes the loan back from a session, and from a partner grant that held it', () => {
    const minted = [...agentSet, 'reports_read'];
    expect(resolve('session', 'agent', minted, [])).not.toContain('reports_read');
    expect(resolve('delegated', 'agent', minted, [])).not.toContain('reports_read');
  });

  it('cannot be minted into a personal token: the loan is not delegable', () => {
    expect(delegableScopes('agent').has('reports_read')).toBe(false);
    expect(delegableScopes('agent').has('chats--all:rw')).toBe(false);
    expect(delegableScopes('agent').has('chats--access:ro')).toBe(true);
    expect(delegableScopes('admin').has('reports_read')).toBe(true);
  });
});

describe('a role change on an open credential (SEC-2 · tm 146)', () => {
  it('narrows a session at once on demotion, as before', () => {
    const minted = defaultScopesForRole('admin');
    const scopes = resolve('session', 'agent', minted);
    expect(scopes).not.toContain('access_rules:rw');
    expect(scopes).toContain('chats--access:rw');
  });

  it('does not widen a session minted before a promotion', () => {
    const minted = defaultScopesForRole('agent');
    expect(resolve('session', 'admin', minted)).toEqual(minted);
  });

  it("lets only the matrix's loan to the new column cross a promotion", () => {
    const minted = defaultScopesForRole('agent');
    const lent = [set('team_lead', 'reports.view', 'all')];
    expect(resolve('session', 'team_lead', minted, lent)).toEqual([...minted, 'reports_read']);
  });

  it('leaves a personal token minted by an admin to the role gates after a demotion, as tm 146 did', () => {
    const minted = defaultScopesForRole('admin');
    expect(resolve('personal', 'agent', minted)).toEqual(minted);
  });
});

describe('K7: billing became the Founder’s (tm 325.5)', () => {
  // What an admin or vice owner was minted with before the change: the old
  // admin set, `billing_manage` in it.
  const before = [...defaultScopesForRole('admin'), 'billing_manage'];

  it('takes billing from an admin’s and a vice owner’s open session and partner grant at the next resolution (FR-MOD-04.RBAC)', () => {
    for (const role of ['admin', 'viceowner']) {
      for (const grant of ['session', 'delegated'] as const) {
        const scopes = resolve(grant, role, before);
        expect(scopes, `${grant} ${role}`).not.toContain('billing_manage');
        // Reading the bill is `reports.view`'s, and it stays.
        expect(scopes, `${grant} ${role}`).toContain('reports_read');
      }
    }
  });

  it('leaves it on an admin’s earlier personal token — the billing routes’ owner gate refuses it', () => {
    // A personal token loses only what the matrix takes from the role's
    // default set, and `billing_manage` is no longer in it: the route's
    // `exactRole: 'owner'` is the bar (`routes/reports.ts`).
    expect(resolve('personal', 'admin', before)).toContain('billing_manage');
    expect(delegableScopes('admin').has('billing_manage')).toBe(false);
  });

  it('keeps it on every credential of the owner', () => {
    for (const grant of GRANTS) {
      expect(resolve(grant, 'owner', defaultScopesForRole('owner')), grant).toContain(
        'billing_manage',
      );
    }
    expect(delegableScopes('owner').has('billing_manage')).toBe(true);
  });
});

describe('what a credential can never do', () => {
  const restrictive = [
    set('agent', 'chats.view', 'own'),
    set('agent', 'reports.view', 'all'),
    set('agent', 'customers.edit', 'on'),
    set('admin', 'settings.webhooks', 'off'),
    set('admin', 'chats.view', 'team'),
    set('team_lead', 'tickets.view', 'all'),
  ];

  it('keeps partner grants and personal tokens inside their own lists, whatever the matrix says', () => {
    for (const role of ROLES) {
      for (const stored of STORED) {
        for (const grant of ['delegated', 'personal'] as const) {
          for (const scope of resolve(grant, role, stored, restrictive)) {
            expect(stored, `${grant} ${role} ${scope}`).toContain(scope);
          }
        }
      }
    }
  });

  it('gives a session nothing beyond its list and what the matrix lends its role', () => {
    for (const role of ROLES) {
      const lent = resolve('session', role, [], restrictive);
      for (const stored of STORED) {
        for (const scope of resolve('session', role, stored, restrictive)) {
          expect(stored.includes(scope) || lent.includes(scope), `${role} ${scope}`).toBe(true);
        }
      }
    }
  });
});

describe('credentialGrantFor', () => {
  it('follows the matrix live only for the sign-in client', () => {
    expect(credentialGrantFor('oauth', true)).toBe('session');
    expect(credentialGrantFor('oauth', false)).toBe('delegated');
    expect(credentialGrantFor('pat', false)).toBe('personal');
    expect(credentialGrantFor('pat', true)).toBe('personal');
  });

  it('gives a kind it does not know the strictest rule', () => {
    expect(credentialGrantFor('bot', true)).toBe('delegated');
    expect(credentialGrantFor('something-new', true)).toBe('delegated');
  });

  it('reads an impersonation token by its own rule, whatever the client (tm 389.15)', () => {
    expect(credentialGrantFor('impersonation', false)).toBe('impersonation');
    expect(credentialGrantFor('impersonation', true)).toBe('impersonation');
  });
});

describe('an operator signed in as a member (tm 389.15)', () => {
  const sorted = (scopes: readonly string[]) => [...scopes].sort();

  it('holds exactly what the member’s role holds now, whatever the row stores', () => {
    for (const role of AGENT_ROLES) {
      for (const stored of STORED) {
        expect(sorted(resolve('impersonation', role, stored))).toEqual(
          sorted(defaultScopesForRole(role)),
        );
      }
    }
  });

  it('follows the matrix both ways, like the member would', () => {
    const reports = [set('agent', 'reports.view', 'all')];
    expect(resolve('impersonation', 'agent', [], reports)).toContain('reports_read');
    const webhooksOff = resolve(
      'impersonation',
      'admin',
      [],
      [set('admin', 'settings.webhooks', 'off')],
    );
    expect(webhooksOff).not.toContain('webhooks--all:rw');
    expect(webhooksOff).toContain('reports_read');
  });

  it('never reaches past the member’s role — an agent is not an admin', () => {
    expect(sorted(resolve('impersonation', 'agent', ADMIN_SCOPES))).toEqual(
      sorted(defaultScopesForRole('agent')),
    );
  });
});

describe('narrowsChatReach', () => {
  it('keeps own and none to assigned or joined chats; team and all are left to the scopes', () => {
    expect(narrowsChatReach('own')).toBe(true);
    expect(narrowsChatReach('none')).toBe(true);
    expect(narrowsChatReach('team')).toBe(false);
    expect(narrowsChatReach('all')).toBe(false);
    expect(narrowsChatReach(undefined)).toBe(false);
  });
});
