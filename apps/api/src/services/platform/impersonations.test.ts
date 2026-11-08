/**
 * Which impersonation sessions an operator's role may hold (tm 430) — the
 * rule a role change ends sessions by. It must say exactly what opening a
 * session asks for (`routes/platform/support.ts`: `support.impersonate`, and
 * `support.impersonate_full` too for `full`), or a demotion would keep a
 * session the new role could not have opened, or end one it could.
 */
import { describe, expect, it } from 'vitest';
import { IMPERSONATION_MODES, PLATFORM_ROLES, platformRoleHas } from '@siyahtus/types';
import { impersonationModesBeyond, mayHoldImpersonation } from './impersonations.js';

describe('mayHoldImpersonation', () => {
  it('holds a mode exactly when the role could open a session in it', () => {
    for (const role of PLATFORM_ROLES) {
      for (const mode of IMPERSONATION_MODES) {
        const couldOpen =
          platformRoleHas(role, 'support.impersonate') &&
          (mode === 'read_only' || platformRoleHas(role, 'support.impersonate_full'));
        expect(mayHoldImpersonation(role, mode), `${role} × ${mode}`).toBe(couldOpen);
      }
    }
  });

  it('names what each role may not hold: nothing for a superadmin, full for support, both below', () => {
    expect(impersonationModesBeyond('superadmin')).toEqual([]);
    expect(impersonationModesBeyond('support')).toEqual(['full']);
    expect(impersonationModesBeyond('billing')).toEqual(['read_only', 'full']);
    expect(impersonationModesBeyond('readonly')).toEqual(['read_only', 'full']);
  });

  it('holds nothing for a role this build does not know', () => {
    expect(impersonationModesBeyond('owner')).toEqual(['read_only', 'full']);
    expect(mayHoldImpersonation('', 'read_only')).toBe(false);
  });
});
