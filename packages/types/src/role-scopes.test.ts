import { describe, expect, it } from 'vitest';
import { effectiveScopes, SCOPES } from './scopes.js';
import {
  ADMIN_SCOPES,
  DEFAULT_AGENT_SCOPES,
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

  it('lists only scopes the catalogue actually defines', () => {
    // A typo in either list would otherwise sit there granting nothing, or
    // silently drop a real grant when intersected below.
    for (const scope of [...DEFAULT_AGENT_SCOPES, ...ADMIN_SCOPES]) {
      expect(SCOPES).toContain(scope);
    }
    expect(new Set(ADMIN_SCOPES).size).toBe(ADMIN_SCOPES.length);
    expect(new Set(DEFAULT_AGENT_SCOPES).size).toBe(DEFAULT_AGENT_SCOPES.length);
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
    for (const role of ['agent', 'admin', 'viceowner', 'owner'] as const) {
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
  it('orders the ladder owner > viceowner > admin > agent', () => {
    expect(roleAtLeast('owner', 'admin')).toBe(true);
    expect(roleAtLeast('viceowner', 'admin')).toBe(true);
    expect(roleAtLeast('admin', 'admin')).toBe(true);
    expect(roleAtLeast('agent', 'admin')).toBe(false);
    expect(roleAtLeast('admin', 'owner')).toBe(false);
  });
});
