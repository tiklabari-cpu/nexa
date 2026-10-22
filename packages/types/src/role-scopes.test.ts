import { describe, expect, it } from 'vitest';
import { AGENT_ROLES, MAX_INVITATION_GROUPS, invitationGroupsProblem } from './domain.js';
import { effectiveScopes, SCOPES } from './scopes.js';
import {
  ADMIN_SCOPES,
  DEFAULT_AGENT_SCOPES,
  ROLE_RANK,
  TEAM_LEAD_SCOPES,
  defaultScopesForRole,
  roleAtLeast,
  scopesWithinRole,
} from './role-scopes.js';

describe('defaultScopesForRole', () => {
  it('gives an agent the agent set and nothing else', () => {
    expect(defaultScopesForRole('agent')).toEqual(DEFAULT_AGENT_SCOPES);
  });

  it('adds the tenant-wide set from admin upwards', () => {
    for (const role of ['admin', 'viceowner', 'owner']) {
      expect(defaultScopesForRole(role)).toEqual([...DEFAULT_AGENT_SCOPES, ...ADMIN_SCOPES]);
    }
  });

  it('gives a Team Lead the Team Lead set — the agent set until its team-bounded checks exist (RL-01)', () => {
    expect(defaultScopesForRole('team_lead')).toEqual(TEAM_LEAD_SCOPES);
    expect(TEAM_LEAD_SCOPES).toEqual(expect.arrayContaining(DEFAULT_AGENT_SCOPES));
    // A caller may push to what it is handed; that must not reach the constant.
    expect(defaultScopesForRole('team_lead')).not.toBe(TEAM_LEAD_SCOPES);
  });

  it('keeps every admin power off a Team Lead: billing, security, AI configuration, the whole workspace (FR-MOD-04.RBAC)', () => {
    const lead = effectiveScopes(defaultScopesForRole('team_lead'));
    for (const scope of [
      'billing_manage',
      'access_rules:rw',
      'access_rules:ro',
      'agents-bot--all:rw',
      'agents-bot--all:ro',
      'agents--all:rw',
      'chats--all:ro',
      'audit_log--all:ro',
      'reports_read',
      'customers.erase:rw',
      'organization--my:rw',
    ]) {
      expect(lead.has(scope), scope).toBe(false);
    }
    // Whatever leading adds later is not borrowed from the admin set.
    for (const scope of TEAM_LEAD_SCOPES) {
      if (!DEFAULT_AGENT_SCOPES.includes(scope)) expect(ADMIN_SCOPES).not.toContain(scope);
    }
  });

  it('treats a role it does not know as the lowest, never a higher one', () => {
    for (const role of ['', 'superadmin', 'Admin', 'vice_owner', 'teamlead']) {
      expect(defaultScopesForRole(role)).toEqual(DEFAULT_AGENT_SCOPES);
    }
  });

  it('lists only scopes the catalogue actually defines', () => {
    // A typo in either list would otherwise sit there granting nothing, or
    // silently drop a real grant when intersected below.
    for (const scope of [...DEFAULT_AGENT_SCOPES, ...TEAM_LEAD_SCOPES, ...ADMIN_SCOPES]) {
      expect(SCOPES).toContain(scope);
    }
    expect(new Set(ADMIN_SCOPES).size).toBe(ADMIN_SCOPES.length);
    expect(new Set(DEFAULT_AGENT_SCOPES).size).toBe(DEFAULT_AGENT_SCOPES.length);
    expect(new Set(TEAM_LEAD_SCOPES).size).toBe(TEAM_LEAD_SCOPES.length);
  });

  it('lets an agent write its own account, and only its own (S11-2FA-j)', () => {
    // The write half is what the four `/auth/2fa/*` endpoints ask for; without
    // it `scopesWithinRole` cut every agent session short of its own second
    // factor while `require_two_factor` refused the sign-in of anyone who had
    // not set one up. Read-only here would reopen that loop.
    expect(DEFAULT_AGENT_SCOPES).toContain('accounts--my:rw');

    // And the bound on it: `--my`, never `--all`. `expandScope` widens `:rw` to
    // `:ro` but never crosses the access axis, so this grants the role nothing
    // aimed at a colleague — which is the only reason it was safe to add.
    const agent = effectiveScopes(defaultScopesForRole('agent'));
    for (const scope of ['accounts--all:ro', 'accounts--all:rw', 'accounts--all:rc']) {
      expect(agent.has(scope)).toBe(false);
    }
    expect(agent.has('accounts--my:ro')).toBe(true);
  });
});

describe('scopesWithinRole', () => {
  it('takes the admin scopes off an agent', () => {
    const granted = ['access_rules:rw', 'chats--all:rw', 'chats--access:rw', 'accounts--my:ro'];
    expect(scopesWithinRole('agent', granted)).toEqual(['chats--access:rw', 'accounts--my:ro']);
  });

  it('takes the admin scopes off a Team Lead, so an admin made one keeps none of them (FR-00-01.E)', () => {
    expect(scopesWithinRole('team_lead', defaultScopesForRole('admin'))).toEqual(TEAM_LEAD_SCOPES);
    expect(scopesWithinRole('team_lead', ['billing_manage', 'chats--all:rw'])).toEqual([]);
  });

  it('leaves the admin set intact for admin and above', () => {
    const granted = defaultScopesForRole('admin');
    expect(scopesWithinRole('admin', granted)).toEqual(granted);
    expect(scopesWithinRole('owner', granted)).toEqual(granted);
  });

  it('keeps a narrower spelling of a scope the role holds', () => {
    // The ceiling reads through the same implication the route gate does. An
    // owner holds `chats--all:rw`, which satisfies `chats--all:ro` everywhere
    // else in the product, so a partner app granted only the read half must not
    // be handed an empty session — refusing the narrower request while allowing
    // the broader one is a spelling test, not a ceiling.
    expect(scopesWithinRole('owner', ['chats--all:ro'])).toEqual(['chats--all:ro']);
    expect(scopesWithinRole('admin', ['access_rules:ro'])).toEqual(['access_rules:ro']);
    // And the same implication does not leak the other way: an agent's
    // `chats--access:rw` never widens to the whole workspace.
    expect(scopesWithinRole('agent', ['chats--all:ro'])).toEqual([]);
    expect(scopesWithinRole('agent', ['chats--access:ro'])).toEqual(['chats--access:ro']);
  });

  it('never returns a scope that was not granted — it intersects, it does not derive', () => {
    // The promotion direction. If this ever returned the role's defaults, an old
    // credential would silently gain authority the moment its holder was
    // promoted, which is the mirror image of the bug it exists to fix.
    for (const role of AGENT_ROLES) {
      const narrowed = scopesWithinRole(role, ['accounts--my:ro']);
      expect(narrowed).toEqual(['accounts--my:ro']);
      expect(scopesWithinRole(role, [])).toEqual([]);
    }
  });

  it('is idempotent, so applying it at mint and again at resolve cannot drift', () => {
    const granted = defaultScopesForRole('owner');
    const once = scopesWithinRole('agent', granted);
    expect(scopesWithinRole('agent', once)).toEqual(once);
  });

  it('preserves the granted order, so a stored list reads back unshuffled', () => {
    const granted = ['chats--access:rw', 'accounts--my:ro', 'tags--groups:ro'];
    expect(scopesWithinRole('agent', granted)).toEqual(granted);
  });

  it('drops a scope the catalogue does not define at all', () => {
    // Defence in depth against a hand-written or migrated token row: the ceiling
    // is a membership test against a known list, so an unknown string cannot
    // pass through a session.
    expect(scopesWithinRole('owner', ['not_a_scope'])).toEqual([]);
  });
});

describe('roleAtLeast', () => {
  it('orders the ladder owner > viceowner > admin > team_lead > agent', () => {
    expect(roleAtLeast('owner', 'admin')).toBe(true);
    expect(roleAtLeast('viceowner', 'admin')).toBe(true);
    expect(roleAtLeast('admin', 'admin')).toBe(true);
    expect(roleAtLeast('agent', 'admin')).toBe(false);
    expect(roleAtLeast('admin', 'owner')).toBe(false);
    expect(roleAtLeast('admin', 'team_lead')).toBe(true);
    expect(roleAtLeast('team_lead', 'agent')).toBe(true);
    expect(roleAtLeast('agent', 'team_lead')).toBe(false);
  });

  it('puts a Team Lead under every admin gate (FR-MOD-04.RBAC)', () => {
    // The `minimumRole: 'admin'` and `roleAtLeast(…, 'admin')` gates predate
    // the role. It ranks below admin, so none of them had to change to refuse it.
    expect(roleAtLeast('team_lead', 'admin')).toBe(false);
    expect(roleAtLeast('team_lead', 'viceowner')).toBe(false);
    expect(roleAtLeast('team_lead', 'owner')).toBe(false);
  });

  it('ranks exactly the roles AGENT_ROLES lists, strictly descending in that order', () => {
    expect(Object.keys(ROLE_RANK).sort()).toEqual([...AGENT_ROLES].sort());
    const ranks = AGENT_ROLES.map((role) => ROLE_RANK[role]);
    for (let i = 1; i < ranks.length; i += 1) expect(ranks[i]!).toBeLessThan(ranks[i - 1]!);
    expect(ROLE_RANK.agent).toBe(0);
  });
});

describe('invitationGroupsProblem (RL-04-S1)', () => {
  const team = (group_id: number, lead = false) => ({ group_id, lead });

  it('asks a Team Lead invitation to lead at least one team (FR-MOD-04.4)', () => {
    expect(invitationGroupsProblem('team_lead', [])).toBe('lead_team_required');
    expect(invitationGroupsProblem('team_lead', [team(1), team(2)])).toBe('lead_team_required');
    expect(invitationGroupsProblem('team_lead', [team(1, true)])).toBeNull();
    // Leading one team and joining another is one invitation (RL-01-S2).
    expect(invitationGroupsProblem('team_lead', [team(1, true), team(2)])).toBeNull();
    expect(invitationGroupsProblem('team_lead', [team(1, true), team(2, true)])).toBeNull();
  });

  it('lets no other role lead a team, and lets every role join teams or none (FR-MOD-04.4)', () => {
    for (const role of ['admin', 'agent'] as const) {
      expect(invitationGroupsProblem(role, [])).toBeNull();
      expect(invitationGroupsProblem(role, [team(1), team(2)])).toBeNull();
      expect(invitationGroupsProblem(role, [team(1), team(2, true)])).toBe(
        'lead_requires_team_lead',
      );
    }
  });

  it('refuses a team named twice, even when the two agree', () => {
    expect(invitationGroupsProblem('agent', [team(3), team(3)])).toBe('duplicate_group');
    expect(invitationGroupsProblem('team_lead', [team(3, true), team(3)])).toBe('duplicate_group');
  });

  it('bounds the list at MAX_INVITATION_GROUPS', () => {
    const many = Array.from({ length: MAX_INVITATION_GROUPS + 1 }, (_, i) => team(i + 1));
    expect(invitationGroupsProblem('agent', many.slice(0, MAX_INVITATION_GROUPS))).toBeNull();
    expect(invitationGroupsProblem('agent', many)).toBe('too_many_groups');
  });
});
