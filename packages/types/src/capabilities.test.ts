import { describe, expect, it } from 'vitest';
import { AGENT_ROLES } from './domain.js';
import { SCOPES, effectiveScopes, expandScope, type Scope } from './scopes.js';
import { ROLE_RANK, defaultScopesForRole } from './role-scopes.js';
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
  it('stays a first version a Founder can read: 20–30 rows, unique keys, every group used', () => {
    expect(CATALOGUE.length).toBeGreaterThanOrEqual(20);
    expect(CATALOGUE.length).toBeLessThanOrEqual(30);
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

  it('makes a Founder-only row exactly a row floored at owner, and lets it grant no scope', () => {
    for (const c of CATALOGUE) {
      expect(c.ownerOnly === true, c.key).toBe(c.floorRole === 'owner');
      // The route gate (`exactRole: 'owner'`) is what enforces it; a scope here
      // would sit in the owner's session and nobody else's, which is what the
      // default set already gives the owner.
      if (c.ownerOnly) expect(grantable(c).size, c.key).toBe(0);
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
      'billing.manage',
    ]) {
      expect(ROLE_RANK[def(key).floorRole], key).toBeGreaterThanOrEqual(ROLE_RANK.admin);
    }
    for (const key of ['settings.sso', 'settings.permissions', 'ai.guardrails.edit']) {
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
    const overrides = [set('admin', 'billing.manage', 'off')];
    expect(scopesForRole('viceowner', overrides)).not.toContain('billing_manage');
    // A row stored under `viceowner` is not a column and changes nothing.
    expect(scopesForRole('viceowner', [set('viceowner', 'billing.manage', 'off')])).toContain(
      'billing_manage',
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
    expect(capabilityChangeProblem(set('admin', 'billing.manage', 'off'))).toBeNull();
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
