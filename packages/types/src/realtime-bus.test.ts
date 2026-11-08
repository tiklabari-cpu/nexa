import { describe, expect, it } from 'vitest';
import {
  AGENT_COMPOSING_TTL_SECONDS,
  composerStateKey,
  isBusEnvelope,
  principalRevokedEnvelope,
  readPrincipalRevoked,
} from './realtime-bus.js';
import { RTM_PUSH_ACTIONS } from './rtm.js';

describe('composerStateKey', () => {
  it('scopes the key by licence id so the same chat id never collides across tenants', () => {
    expect(composerStateKey('1', 'ABC')).not.toBe(composerStateKey('2', 'ABC'));
  });

  it('is stable for the same licence and chat id', () => {
    expect(composerStateKey('1', 'ABC')).toBe(composerStateKey('1', 'ABC'));
  });
});

describe('AGENT_COMPOSING_TTL_SECONDS', () => {
  it('is a positive number of seconds', () => {
    expect(AGENT_COMPOSING_TTL_SECONDS).toBeGreaterThan(0);
  });
});

describe('RTM_PUSH_ACTIONS', () => {
  it('carries a push action for the multi-agent conflict warning', () => {
    expect(RTM_PUSH_ACTIONS).toContain('agent_conflict_warning');
  });

  it("carries the real-time traffic board's visitor signal (FR-MOD-03.1.1)", () => {
    // The gateway only forwards — and a client may only subscribe to — an action
    // in this list (`apps/rtm/src/dispatcher.ts`'s `extractPushes`), so dropping
    // it here would silence the board without failing anything on either side of
    // the socket.
    expect(RTM_PUSH_ACTIONS).toContain('traffic_visitor_updated');
  });

  it('carries the AI mode change the inbox badge follows (AI-11)', () => {
    expect(RTM_PUSH_ACTIONS).toContain('chat_ai_mode_changed');
  });
});

describe('principal_revoked on the bus (tm 426)', () => {
  const tenant = { licenseId: 7n, organizationId: '11111111-1111-4111-8111-111111111111' };

  it('builds an envelope for the licence channel that is no push', () => {
    const envelope = principalRevokedEnvelope(tenant, { kind: 'token', tokenId: 't-1' }, 1_000);
    expect(envelope).toEqual({
      v: 1,
      type: 'principal_revoked',
      licenseId: '7',
      organizationId: tenant.organizationId,
      target: { kind: 'token', tokenId: 't-1' },
      at: 1_000,
    });
    // A gateway that predates it must not mistake it for something to deliver.
    expect(isBusEnvelope(JSON.parse(JSON.stringify(envelope)))).toBe(false);
  });

  it('reads back each of the three targets as built', () => {
    for (const target of [
      { kind: 'token', tokenId: 't-1' },
      { kind: 'agent', agentId: 'a-1' },
      { kind: 'license' },
    ] as const) {
      const sent = principalRevokedEnvelope(tenant, target);
      expect(readPrincipalRevoked(JSON.parse(JSON.stringify(sent)))).toEqual(sent);
    }
  });

  it('keeps only the target fields it knows', () => {
    const read = readPrincipalRevoked({
      ...principalRevokedEnvelope(tenant, { kind: 'license' }),
      target: { kind: 'license', agentId: 'stray' },
      extra: true,
    });
    expect(read).toMatchObject({ target: { kind: 'license' } });
    expect(read).not.toHaveProperty('extra');
    expect((read as { target: object }).target).not.toHaveProperty('agentId');
  });

  it('is null for a push and for anything that does not say it is a revocation', () => {
    const push = {
      v: 1,
      licenseId: '7',
      organizationId: tenant.organizationId,
      action: 'incoming_event',
      audience: { allAgents: true },
      payload: {},
      at: 1,
    };
    expect(readPrincipalRevoked(push)).toBeNull();
    expect(readPrincipalRevoked(null)).toBeNull();
    expect(readPrincipalRevoked('principal_revoked')).toBeNull();
    expect(readPrincipalRevoked({ type: 'settings.changed' })).toBeNull();
  });

  it('is malformed when it says it is a revocation but cannot be read', () => {
    const good = principalRevokedEnvelope(tenant, { kind: 'agent', agentId: 'a-1' });
    for (const broken of [
      { ...good, v: 2 },
      { ...good, licenseId: 7 },
      { ...good, licenseId: '' },
      { ...good, organizationId: undefined },
      { ...good, at: '1' },
      { ...good, target: undefined },
      { ...good, target: { kind: 'agent' } },
      { ...good, target: { kind: 'agent', agentId: '' } },
      { ...good, target: { kind: 'token', tokenId: 5 } },
      { ...good, target: { kind: 'everyone' } },
    ]) {
      expect(readPrincipalRevoked(broken), JSON.stringify(broken)).toBe('malformed');
    }
  });
});
