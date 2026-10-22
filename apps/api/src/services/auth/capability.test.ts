import { describe, expect, it } from 'vitest';
import { capabilitiesForRole } from '@siyahtus/types';
import { ApiError } from '../../lib/api-error.js';
import { hasCapability, requireCapability } from './capability.js';
import type { Principal } from './principal.js';

function agent(role: 'owner' | 'admin' | 'agent', overrides = [] as never[]): Principal {
  return {
    kind: 'agent',
    accountId: '11111111-1111-1111-1111-111111111111',
    licenseId: 1n,
    organizationId: '22222222-2222-2222-2222-222222222222',
    role,
    scopes: [],
    capabilities: capabilitiesForRole(role, overrides),
    tokenId: 'tok',
    tokenKind: 'oauth',
  };
}

const bot: Principal = {
  kind: 'bot',
  botId: 'bot-1',
  licenseId: 1n,
  organizationId: '22222222-2222-2222-2222-222222222222',
  scopes: ['chats--all:rw'],
  tokenId: 'tok',
  tokenKind: 'bot',
};

describe('hasCapability / requireCapability (RL-02 · tm 325.3)', () => {
  it("reads the member's resolved value, above the weakest by default (FR-MOD-04.RBAC)", () => {
    expect(hasCapability(agent('agent'), 'chats.view')).toBe(true);
    expect(hasCapability(agent('agent'), 'reports.view')).toBe(false);
    expect(hasCapability(agent('admin'), 'reports.view')).toBe(true);
  });

  it('compares a level against the minimum asked for', () => {
    expect(hasCapability(agent('agent'), 'chats.view', 'team')).toBe(true);
    expect(hasCapability(agent('agent'), 'chats.view', 'all')).toBe(false);
    expect(hasCapability(agent('owner'), 'chats.view', 'all')).toBe(true);
  });

  it("follows the workspace's stored choice, not the default", () => {
    const own = capabilitiesForRole('agent', [
      { role: 'agent', capability: 'chats.view', value: 'own' },
    ]);
    const narrowed: Principal = { ...agent('agent'), capabilities: own } as Principal;
    expect(hasCapability(narrowed, 'chats.view')).toBe(true);
    expect(hasCapability(narrowed, 'chats.view', 'team')).toBe(false);
  });

  it('answers no for anything that is not a member: a capability belongs to a role', () => {
    expect(hasCapability(bot, 'chats.view')).toBe(false);
  });

  it('refuses with 403 and names the capability', () => {
    expect(() => requireCapability(agent('admin'), 'reports.view')).not.toThrow();
    try {
      requireCapability(agent('agent'), 'reports.view');
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      const apiError = error as ApiError;
      expect(apiError.type).toBe('authorization');
      expect(apiError.details).toEqual({
        reason: 'capability_required',
        capability: 'reports.view',
      });
    }
  });
});
