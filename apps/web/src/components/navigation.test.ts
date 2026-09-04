/**
 * `isNavVisible` — the rail's authority-based hide (FR-MOD-01.2).
 *
 * Before this, `scope` existed only on Developers; every other `NavDestination`
 * was unconditionally offered regardless of what the caller could actually
 * open, and `AppShell.tsx`'s `IconRail` never even filtered `MODULES` through
 * it. This file is the two-way proof CONVENTIONS §1's testStrategy asks for:
 * a principal holding a scope sees the door, one that does not holds does not.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_AGENT_SCOPES, defaultScopesForRole } from '@nexa/types';
import { NAV_DESTINATIONS, isNavVisible } from './navigation.js';

describe('isNavVisible (FR-MOD-01.2)', () => {
  // What an ordinary agent's default session (`DEFAULT_AGENT_SCOPES`,
  // role-scopes.ts) can and cannot reach. Derived from each destination's own
  // backing route rather than guessed — see the `scope` comment on each entry
  // in `navigation.ts` for the route it mirrors.
  const EXPECTED_FOR_AGENT: Record<string, boolean> = {
    '/app/home': false, // routes/home.ts: reports_read, admin-only
    '/app/inbox': true, // chats--access:rw implies chats--access:ro
    '/app/customers': true, // customers:ro is in DEFAULT_AGENT_SCOPES directly
    '/app/team': true, // agents--my:rw implies agents--my:ro
    '/app/playbook': false, // agents-bot--all:*, admin-only
    '/app/reports': false, // reports_read, admin-only
    '/app/billing': false, // billing_manage/billing_admin/reports_read, admin-only
    '/app/settings': true, // tags--groups:ro is in DEFAULT_AGENT_SCOPES directly
    '/app/developers': false, // access_rules:rw, admin-only
  };

  it('matches the measured visibility for every destination against an agent session', () => {
    for (const dest of NAV_DESTINATIONS) {
      const expected = EXPECTED_FOR_AGENT[dest.to];
      expect(expected, `${dest.to} is missing from EXPECTED_FOR_AGENT`).not.toBeUndefined();
      expect(isNavVisible(dest, DEFAULT_AGENT_SCOPES)).toBe(expected);
    }
  });

  it('hides at least one destination from an ordinary agent — the bug this closes', () => {
    // Before this task every `NavDestination` but Developers had no `scope` at
    // all, so this was unconditionally true for the whole rail.
    expect(Object.values(EXPECTED_FOR_AGENT).some((visible) => !visible)).toBe(true);
  });

  it('opens every destination for an owner/admin session', () => {
    const scopes = defaultScopesForRole('admin');
    for (const dest of NAV_DESTINATIONS) {
      expect(isNavVisible(dest, scopes)).toBe(true);
    }
  });

  it('offers no destination to a caller holding no scopes at all', () => {
    // A PAT narrowed away from every default scope — the "sees nothing" case
    // the gate exists for, not merely an untested edge.
    for (const dest of NAV_DESTINATIONS) {
      expect(isNavVisible(dest, [])).toBe(false);
    }
  });

  it('leaves no destination unscoped, so every hide above is deliberate', () => {
    for (const dest of NAV_DESTINATIONS) {
      expect(dest.scope?.length, `${dest.to} carries no scope`).toBeGreaterThan(0);
    }
  });
});
