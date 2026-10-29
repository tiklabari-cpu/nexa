import { describe, expect, it } from 'vitest';
import { AGENT_ROLES } from './domain.js';
import { SCOPES, effectiveScopes, expandScope, type Scope } from './scopes.js';
import { OWNER_SCOPES, ROLE_RANK, defaultScopesForRole } from './role-scopes.js';
import {
  CAPABILITIES,
  CAPABILITY_GROUPS,
  CAPABILITY_LEVELS,
  MATRIX_ROLES,
  MEMBER_BASE_SCOPES,
  capabilitiesForRole,
  capabilityAtLeast,
  capabilityChangeProblem,
  capabilityDefinition,
  capabilityLock,
  matrixRoleFor,
  scopesForRole,
  type CapabilityDefinition,
  type CapabilityOverride,
  type MatrixRole,
} from './capabilities.js';

const CATALOGUE = CAPABILITIES as readonly CapabilityDefinition[];

/** Every scope a capability can grant, across its values. */
function grantable(definition: CapabilityDefinition): Set<Scope> {
  return new Set(Object.values(definition.scopes).flat());
}

function sorted(scopes: Iterable<string>): string[] {
  return [...scopes].sort();
}

function def(key: string): CapabilityDefinition {
  const found = capabilityDefinition(key);
  if (!found) throw new Error(`no capability ${key}`);
  return found;
}

const set = (role: string, capability: string, value: string): CapabilityOverride => ({
  role,
  capability,
  value,
});

describe('the capability catalogue', () => {
  // RL-02 kept the first version to 20–30 rows (it shipped 25, tm 325.1); the
  // features that came after add their rows as the catalogue says they must
  // (RL-03's `chats.takeover` was the 31st, tm 326; ID-09's three timeline rows
  // the 32nd–34th, tm 334.1). The ceiling is what keeps
  // the screen readable — raise it as a decision, not to make a test pass.
  it('stays a matrix a Founder can read: 20–35 rows, unique keys, every group used', () => {
    expect(CATALOGUE.length).toBeGreaterThanOrEqual(20);
    expect(CATALOGUE.length).toBeLessThanOrEqual(35);
    const keys = CATALOGUE.map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(new Set(CATALOGUE.map((c) => c.group))).toEqual(new Set(CAPABILITY_GROUPS));
  });

  it('names each row by its key, and no key nests under another in the web catalogue', () => {
    for (const c of CATALOGUE) {
      expect(c.key).toMatch(/^[a-z]+(\.[a-z_]+)+$/);
      expect(c.labelKey).toBe(`permissions.capability.${c.key}`);
      // `a.b` and `a.b.c` would make one i18n path both a string and an object.
      for (const other of CATALOGUE) {
        if (other !== c) expect(other.key.startsWith(`${c.key}.`), `${other.key}`).toBe(false);
      }
    }
  });

  it('spells every value as a switch or as levels in their order, weakest first', () => {
    for (const c of CATALOGUE) {
      if (c.values.includes('on') || c.values.includes('off')) {
        expect(c.values, c.key).toEqual(['off', 'on']);
      } else {
        const order = c.values.map((v) => (CAPABILITY_LEVELS as readonly string[]).indexOf(v));
        expect(
          order.every((i) => i >= 0),
          c.key,
        ).toBe(true);
        expect(order, c.key).toEqual([...order].sort((a, b) => a - b));
        expect(c.values[0], c.key).toBe('none');
      }
    }
  });

  it('grants only scopes the catalogue defines, never on the weakest value, only on values it has', () => {
    for (const c of CATALOGUE) {
      for (const [value, scopes] of Object.entries(c.scopes)) {
        expect(c.values as readonly string[], `${c.key} ${value}`).toContain(value);
        expect(value, c.key).not.toBe(c.values[0]);
        for (const scope of scopes ?? []) expect(SCOPES, `${c.key} ${scope}`).toContain(scope);
      }
    }
    for (const scope of MEMBER_BASE_SCOPES) expect(SCOPES).toContain(scope);
  });

  it('gives every column a default the row allows', () => {
    for (const c of CATALOGUE) {
      expect(Object.keys(c.defaults).sort(), c.key).toEqual([...MATRIX_ROLES].sort());
      for (const role of MATRIX_ROLES) {
        expect(c.values as readonly string[], `${c.key} ${role}`).toContain(c.defaults[role]);
      }
    }
  });
});

describe('floors and locks', () => {
  it('keeps every role below a floor at the weakest value by default (FR-MOD-04.RBAC)', () => {
    for (const c of CATALOGUE) {
      for (const role of MATRIX_ROLES) {
        if (ROLE_RANK[role] < ROLE_RANK[c.floorRole]) {
          expect(c.defaults[role], `${c.key} ${role}`).toBe(c.values[0]);
        }
      }
    }
  });

  it('gives the Founder every capability, at its strongest', () => {
    for (const c of CATALOGUE) expect(c.defaults.owner, c.key).toBe(c.values.at(-1));
  });

  it('never gives a lower role more than a higher one by default', () => {
    const byRank = [...MATRIX_ROLES].sort((a, b) => ROLE_RANK[b] - ROLE_RANK[a]);
    for (const c of CATALOGUE) {
      const strength = byRank.map((role) => c.values.indexOf(c.defaults[role]));
      expect(strength, c.key).toEqual([...strength].sort((a, b) => b - a));
    }
  });

  it('makes a Founder-only row exactly a row floored at owner, whose scope only the owner holds', () => {
    for (const c of CATALOGUE) {
      expect(c.ownerOnly === true, c.key).toBe(c.floorRole === 'owner');
      if (!c.ownerOnly) continue;
      // The route gate (`exactRole: 'owner'`) is what enforces it. A scope
      // here (`billing.manage`'s) is the owner's alone — `OWNER_SCOPES` — so
      // no other role's set, nor the locked cell, can carry it.
      for (const scope of grantable(c)) {
        expect(OWNER_SCOPES, `${c.key} ${scope}`).toContain(scope);
        for (const role of AGENT_ROLES) {
          if (role === 'owner') continue;
          expect(effectiveScopes(defaultScopesForRole(role)).has(scope), `${role} ${scope}`).toBe(
            false,
          );
        }
      }
    }
  });

  it('floors the platform-safety rows: erasure, bans, data leaving the workspace, self-widening (FR-MOD-04.RBAC)', () => {
    for (const key of [
      'customers.erase',
      'customers.ban',
      'reports.schedule',
      'settings.webhooks',
      'settings.channels',
      'logs.audit.export',
      'logs.audit.view',
      'team.invite',
      'team.members.manage',
      'team.groups.manage',
      'settings.security',
      'ai.config.publish',
    ]) {
      expect(ROLE_RANK[def(key).floorRole], key).toBeGreaterThanOrEqual(ROLE_RANK.admin);
    }
    for (const key of [
      'settings.sso',
      'settings.permissions',
      'ai.guardrails.edit',
      'billing.manage',
    ]) {
      expect(def(key).ownerOnly, key).toBe(true);
    }
  });

  it('lets no row a Team Member can be given carry a scope that reaches other members, security or egress (FR-MOD-04.RBAC)', () => {
    // By scope rather than by row name, so a row added later with one of
    // these scopes and a low floor goes red here.
    const adminOnly = new Set<string>([
      'accounts--all:rw',
      'agents--all:rw',
      'groups--all:rw',
      'access_rules:rw',
      'organization--my:rw',
      'channels--all:rw',
      'webhooks--all:rw',
      'reports_manage',
      'audit_log--all:ro',
      'audit_log--export:ro',
      'customers.ban:rw',
      'customers.erase:rw',
      'billing_manage',
    ]);
    for (const c of CATALOGUE) {
      if (ROLE_RANK[c.floorRole] >= ROLE_RANK.admin) continue;
      for (const scope of grantable(c)) {
        const implied = expandScope(scope);
        expect(
          implied.filter((s) => adminOnly.has(s)),
          `${c.key} ${scope}`,
        ).toEqual([]);
      }
    }
  });

  it('locks the Founder column whole, then Founder-only rows, then cells below the floor', () => {
    for (const c of CATALOGUE) expect(capabilityLock(c, 'owner'), c.key).toBe('owner_column');
    expect(capabilityLock(def('settings.sso'), 'admin')).toBe('owner_only');
    expect(capabilityLock(def('settings.sso'), 'agent')).toBe('owner_only');
    expect(capabilityLock(def('customers.erase'), 'team_lead')).toBe('below_floor');
    expect(capabilityLock(def('customers.erase'), 'admin')).toBeNull();
    expect(capabilityLock(def('reports.view'), 'agent')).toBeNull();
  });
});

describe('the owner’s K7 defaults (tm 325.5)', () => {
  const at = (role: string) => capabilitiesForRole(role, []);

  it('keeps an Ekip Üyesi to their own teams’ chats, never the workspace’s (FR-MOD-04.RBAC)', () => {
    expect(at('agent')['chats.view']).toBe('team');
    const held = effectiveScopes(scopesForRole('agent', []));
    expect(held.has('chats--access:rw')).toBe(true);
    expect(held.has('chats--all:ro')).toBe(false);
  });

  it('shows an Ekip Lideri their own teams’ reports and never every team’s (FR-MOD-04.RBAC)', () => {
    // `team` is the K7 default once the level exists (#368); until then the
    // only levels are `none` and `all`, and `all` would be every team's.
    const expected = def('reports.view').values.includes('team') ? 'team' : 'none';
    expect(at('team_lead')['reports.view']).toBe(expected);
    expect(scopesForRole('team_lead', [])).not.toContain('reports_read');
  });

  it('lets an Ekip Lideri take over in the teams they lead, and never an Ekip Üyesi (RL-03 · FR-MOD-04.RBAC)', () => {
    expect(at('owner')['chats.takeover']).toBe('all');
    expect(at('admin')['chats.takeover']).toBe('all');
    expect(at('team_lead')['chats.takeover']).toBe('team');
    expect(at('agent')['chats.takeover']).toBe('none');
    // A checked row: it moves no scope, so the role sets stay what they were.
    expect(def('chats.takeover').scopes).toEqual({});
    // RL-03-S3: the Founder may open every team to a lead, never takeover to a member.
    expect(capabilityChangeProblem(set('team_lead', 'chats.takeover', 'all'))).toBeNull();
    expect(capabilityChangeProblem(set('agent', 'chats.takeover', 'team'))).toBe('below_floor');
    expect(capabilitiesForRole('agent', [set('agent', 'chats.takeover', 'all')])).toMatchObject({
      'chats.takeover': 'none',
    });
  });

  it('opens the timeline to each role as ID-09-S1/S2/S3 say, and the unmasked export to the Founder alone', () => {
    // S1: own conversations, the lead's teams, everyone's for Yönetici and Kurucu.
    expect(at('owner')['timeline.view']).toBe('all');
    expect(at('admin')['timeline.view']).toBe('all');
    expect(at('team_lead')['timeline.view']).toBe('team');
    expect(at('agent')['timeline.view']).toBe('own');
    // S2: exporting is Yönetici and Kurucu, and never below them.
    expect(at('admin')['timeline.export']).toBe('on');
    expect(at('team_lead')['timeline.export']).toBe('off');
    expect(capabilityChangeProblem(set('team_lead', 'timeline.export', 'on'))).toBe('below_floor');
    // S3: unmasked is the Founder's, in a row nobody can unlock.
    expect(at('owner')['timeline.export_unmasked']).toBe('on');
    expect(at('admin')['timeline.export_unmasked']).toBe('off');
    expect(capabilityChangeProblem(set('admin', 'timeline.export_unmasked', 'on'))).toBe('locked');
    // Checked rows: the role sets stay what they were.
    for (const key of ['timeline.view', 'timeline.export', 'timeline.export_unmasked']) {
      expect(def(key).scopes, key).toEqual({});
    }
  });

  it('lets a Yönetici read billing and not change it, in a cell the Founder cannot unlock (FR-MOD-04.RBAC)', () => {
    for (const role of ['admin', 'viceowner']) {
      expect(at(role)['billing.manage'], role).toBe('off');
      // Reading the bill is `reports_read` (`BILLING_READ_SCOPES`).
      expect(at(role)['reports.view'], role).toBe('all');
      expect(scopesForRole(role, []), role).not.toContain('billing_manage');
    }
    expect(capabilityLock(def('billing.manage'), 'admin')).toBe('owner_only');
    expect(capabilityChangeProblem(set('admin', 'billing.manage', 'on'))).toBe('locked');
    expect(scopesForRole('admin', [set('admin', 'billing.manage', 'on')])).not.toContain(
      'billing_manage',
    );
    expect(at('owner')['billing.manage']).toBe('on');
    expect(scopesForRole('owner', [])).toContain('billing_manage');
  });

  it('leaves the matrix to the Kurucu alone (FR-MOD-04.RBAC)', () => {
    for (const role of ['admin', 'viceowner', 'team_lead', 'agent']) {
      expect(at(role)['settings.permissions'], role).toBe('off');
    }
    for (const role of ['admin', 'team_lead', 'agent']) {
      expect(capabilityChangeProblem(set(role, 'settings.permissions', 'on')), role).toBe('locked');
    }
    expect(at('owner')['settings.permissions']).toBe('on');
  });
});

describe('scope ownership — one row per scope', () => {
  it('lets no two rows grant the same scope, and keeps the base set out of every row', () => {
    const owner = new Map<Scope, string>();
    for (const scope of MEMBER_BASE_SCOPES) owner.set(scope, 'base');
    for (const c of CATALOGUE) {
      for (const scope of grantable(c)) {
        expect(owner.get(scope), `${scope} in ${c.key}`).toBeUndefined();
      }
      for (const scope of grantable(c)) owner.set(scope, c.key);
    }
  });

  it('lets no row, nor the base set, imply a scope another row grants — switching a row off removes its authority', () => {
    const sources: Array<[string, Set<Scope>]> = [
      ['base', new Set(MEMBER_BASE_SCOPES)],
      ...CATALOGUE.map((c): [string, Set<Scope>] => [c.key, grantable(c)]),
    ];
    for (const [name, scopes] of sources) {
      const implied = new Set([...scopes].flatMap((s) => expandScope(s)));
      for (const c of CATALOGUE) {
        if (c.key === name) continue;
        for (const scope of grantable(c)) {
          expect(implied.has(scope), `${name} implies ${scope} of ${c.key}`).toBe(false);
        }
      }
    }
  });
});

describe('scopesForRole with no overrides — today, cell for cell', () => {
  it('reproduces every role set exactly (FR-MOD-04.RBAC)', () => {
    for (const role of AGENT_ROLES) {
      expect(sorted(scopesForRole(role, [])), role).toEqual(sorted(defaultScopesForRole(role)));
    }
  });

  it('gives a role it does not know the Ekip Üyesi set, never a higher one', () => {
    for (const role of ['', 'superadmin', 'Admin', 'vice_owner', 'teamlead']) {
      expect(sorted(scopesForRole(role, [])), role).toEqual(sorted(defaultScopesForRole('agent')));
    }
  });

  it('agrees after implication too, which is what a route gate reads', () => {
    for (const role of AGENT_ROLES) {
      expect(sorted(effectiveScopes(scopesForRole(role, []))), role).toEqual(
        sorted(effectiveScopes(defaultScopesForRole(role))),
      );
    }
  });

  it('resolves every capability to its default', () => {
    for (const role of AGENT_ROLES) {
      const values = capabilitiesForRole(role, []);
      for (const c of CATALOGUE) {
        expect(values[c.key as keyof typeof values], `${role} ${c.key}`).toBe(
          c.defaults[matrixRoleFor(role)],
        );
      }
    }
  });
});

describe('scopesForRole with the workspace’s choices', () => {
  it('gives the Ekip Üyesi reports when the Founder opens them, and only that', () => {
    const overrides = [set('agent', 'reports.view', 'all')];
    const scopes = scopesForRole('agent', overrides);
    expect(scopes).toContain('reports_read');
    expect(sorted(scopes)).toEqual(sorted([...defaultScopesForRole('agent'), 'reports_read']));
    expect(capabilitiesForRole('agent', overrides)['reports.view']).toBe('all');
    // The same workspace's Team Lead is untouched: a row is one column.
    expect(scopesForRole('team_lead', overrides)).not.toContain('reports_read');
  });

  it('removes exactly a row’s scopes when it is switched off for Yönetici', () => {
    const base = new Set(scopesForRole('admin', []));
    for (const c of CATALOGUE) {
      if (capabilityLock(c, 'admin') !== null) continue;
      const off = new Set(scopesForRole('admin', [set('admin', c.key, c.values[0]!)]));
      const lost = [...base].filter((s) => !off.has(s));
      expect(sorted(lost), c.key).toEqual(sorted(c.scopes[c.defaults.admin] ?? []));
      expect(
        [...off].every((s) => base.has(s)),
        c.key,
      ).toBe(true);
    }
  });

  it('masks a player’s contact details by a checked switch that moves no scope (tm 325.6)', () => {
    const row = def('customers.contact.view');
    expect(row.group).toBe('customers');
    expect(row.values).toEqual(['off', 'on']);
    expect(grantable(row).size).toBe(0);
    // Today's behaviour for everyone: every role saw both fields before the matrix.
    for (const role of MATRIX_ROLES) expect(row.defaults[role], role).toBe('on');
    for (const role of ['admin', 'team_lead', 'agent'] as const) {
      const off = [set(role, 'customers.contact.view', 'off')];
      expect(capabilityChangeProblem(off[0]!), role).toBeNull();
      expect(capabilitiesForRole(role, off)['customers.contact.view'], role).toBe('off');
      expect(sorted(scopesForRole(role, off)), role).toEqual(sorted(scopesForRole(role, [])));
    }
    // The Founder column stays on: the cell is locked.
    expect(
      capabilitiesForRole('owner', [set('owner', row.key, 'off')])['customers.contact.view'],
    ).toBe('on');
  });

  it('narrows chat visibility by level: all → team → own → none', () => {
    const at = (level: string) => scopesForRole('admin', [set('admin', 'chats.view', level)]);
    expect(at('all')).toContain('chats--all:rw');
    expect(at('team')).toContain('chats--access:rw');
    expect(at('team')).not.toContain('chats--all:rw');
    // `own` holds the team level's scopes; the narrowing is the server check's.
    expect(sorted(at('own'))).toEqual(sorted(at('team')));
    expect(capabilitiesForRole('admin', [set('admin', 'chats.view', 'own')])['chats.view']).toBe(
      'own',
    );
    expect(at('none').some((s) => s.startsWith('chats--'))).toBe(false);
  });

  it('cannot unlock a cell: the Founder column, a Founder-only row, a cell below its floor (FR-MOD-04.RBAC)', () => {
    expect(scopesForRole('owner', [set('owner', 'chats.view', 'none')])).toContain('chats--all:rw');
    expect(capabilitiesForRole('admin', [set('admin', 'settings.sso', 'on')])['settings.sso']).toBe(
      'off',
    );
    expect(scopesForRole('agent', [set('agent', 'customers.erase', 'on')])).not.toContain(
      'customers.erase:rw',
    );
    expect(scopesForRole('team_lead', [set('team_lead', 'billing.manage', 'on')])).not.toContain(
      'billing_manage',
    );
    expect(scopesForRole('team_lead', [set('team_lead', 'team.invite', 'on')])).not.toContain(
      'accounts--all:rw',
    );
  });

  it('ignores a stored row the PUT would refuse', () => {
    const agentDefault = sorted(scopesForRole('agent', []));
    for (const row of [
      set('agent', 'reports.view', 'team'), // a level the row does not have
      set('agent', 'reports.view', 'on'),
      set('agent', 'customers.edit', 'true'),
      set('agent', 'tickets.view', 'own'),
      set('agent', 'billing.view', 'on'), // no such capability
      set('agent', 'chats.view', 'ALL'),
    ]) {
      expect(sorted(scopesForRole('agent', [row])), JSON.stringify(row)).toEqual(agentDefault);
    }
  });

  it('reads the Yönetici column for a remaining vice owner, so a restriction on admins reaches it', () => {
    const overrides = [set('admin', 'settings.webhooks', 'off')];
    expect(scopesForRole('viceowner', overrides)).not.toContain('webhooks--all:rw');
    // A row stored under `viceowner` is not a column and changes nothing.
    expect(scopesForRole('viceowner', [set('viceowner', 'settings.webhooks', 'off')])).toContain(
      'webhooks--all:rw',
    );
  });

  it('reads the Ekip Üyesi column for a role it does not know', () => {
    expect(matrixRoleFor('superadmin')).toBe('agent');
    expect(scopesForRole('superadmin', [set('agent', 'reports.view', 'all')])).toContain(
      'reports_read',
    );
    expect(scopesForRole('superadmin', [set('admin', 'reports.view', 'all')])).not.toContain(
      'reports_read',
    );
  });
});

describe('capabilityChangeProblem — the PUT’s validation', () => {
  it('accepts a change inside the row, at or above its floor', () => {
    expect(capabilityChangeProblem(set('agent', 'reports.view', 'all'))).toBeNull();
    expect(capabilityChangeProblem(set('admin', 'settings.webhooks', 'off'))).toBeNull();
    expect(capabilityChangeProblem(set('team_lead', 'chats.view', 'own'))).toBeNull();
  });

  it('refuses giving a capability below its floor with below_floor (FR-MOD-04.RBAC)', () => {
    expect(capabilityChangeProblem(set('agent', 'customers.erase', 'on'))).toBe('below_floor');
    expect(capabilityChangeProblem(set('team_lead', 'settings.webhooks', 'on'))).toBe(
      'below_floor',
    );
  });

  it('refuses changing a locked cell, and lets its own value through as a no-op', () => {
    expect(capabilityChangeProblem(set('owner', 'chats.view', 'team'))).toBe('locked');
    expect(capabilityChangeProblem(set('admin', 'settings.permissions', 'on'))).toBe('locked');
    expect(capabilityChangeProblem(set('agent', 'settings.sso', 'on'))).toBe('locked');
    expect(capabilityChangeProblem(set('admin', 'billing.manage', 'on'))).toBe('locked');
    expect(capabilityChangeProblem(set('owner', 'chats.view', 'all'))).toBeNull();
    expect(capabilityChangeProblem(set('admin', 'settings.permissions', 'off'))).toBeNull();
    expect(capabilityChangeProblem(set('agent', 'customers.erase', 'off'))).toBeNull();
  });

  it('refuses what the matrix does not have', () => {
    expect(capabilityChangeProblem(set('viceowner', 'reports.view', 'all'))).toBe('unknown_role');
    expect(capabilityChangeProblem(set('Admin', 'reports.view', 'all'))).toBe('unknown_role');
    expect(capabilityChangeProblem(set('agent', 'reports.export', 'on'))).toBe(
      'unknown_capability',
    );
    expect(capabilityChangeProblem(set('agent', 'reports.view', 'team'))).toBe('invalid_value');
    expect(capabilityChangeProblem(set('agent', 'customers.edit', 'true'))).toBe('invalid_value');
  });

  it('agrees with the resolution: what it accepts takes effect, what it refuses does not', () => {
    for (const c of CATALOGUE) {
      for (const role of MATRIX_ROLES as readonly MatrixRole[]) {
        for (const value of c.values) {
          const row = set(role, c.key, value);
          const resolved = capabilitiesForRole(role, [row])[c.key as CapabilityKeyOf];
          if (capabilityChangeProblem(row) === null)
            expect(resolved, JSON.stringify(row)).toBe(value);
          else expect(resolved, JSON.stringify(row)).toBe(c.defaults[role]);
        }
      }
    }
  });
});

type CapabilityKeyOf = keyof ReturnType<typeof capabilitiesForRole>;

describe('capabilityAtLeast', () => {
  it('reads a switch as on, and a level against the one asked for', () => {
    expect(capabilityAtLeast('customers.edit', 'on')).toBe(true);
    expect(capabilityAtLeast('customers.edit', 'off')).toBe(false);
    expect(capabilityAtLeast('chats.view', 'own')).toBe(true);
    expect(capabilityAtLeast('chats.view', 'none')).toBe(false);
    expect(capabilityAtLeast('chats.view', 'team', 'team')).toBe(true);
    expect(capabilityAtLeast('chats.view', 'own', 'team')).toBe(false);
    expect(capabilityAtLeast('chats.view', 'all', 'team')).toBe(true);
  });

  it('refuses what it cannot read', () => {
    expect(capabilityAtLeast('reports.export', 'on')).toBe(false);
    expect(capabilityAtLeast('reports.view', undefined)).toBe(false);
    expect(capabilityAtLeast('reports.view', 'all', 'team')).toBe(false);
    expect(capabilityAtLeast('reports.view', 'team')).toBe(false);
  });
});
