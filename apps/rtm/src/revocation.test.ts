/**
 * The gateway's half of `principal_revoked` (tm 426): which sockets an
 * envelope names, and what applying it does to each — against fake sockets, so
 * every case can be set up on its own. The same against a real gateway and real
 * sockets: `test/integration/principal-revoked.test.ts`.
 */
import type { Logger } from 'pino';
import { describe, expect, it, vi } from 'vitest';
import type { WebSocket } from 'ws';
import { principalRevokedEnvelope, type PrincipalRevokedTarget } from '@siyahtus/types';
import { ConnectionRegistry, type Connection } from './connection.js';
import {
  CREDENTIAL_REVOKED_CLOSE_CODE,
  PrincipalRevocations,
  revocationNames,
  type RevocationSubject,
} from './revocation.js';

const ORG = '11111111-1111-4111-8111-111111111111';
const OTHER_ORG = '22222222-2222-4222-8222-222222222222';

function envelope(target: PrincipalRevokedTarget, licenseId = '7', organizationId = ORG) {
  return principalRevokedEnvelope({ licenseId, organizationId }, target);
}

function subject(overrides: Partial<RevocationSubject> = {}): RevocationSubject {
  return {
    licenseId: '7',
    organizationId: ORG,
    side: 'agent',
    actorId: 'agent-1',
    tokenId: 'token-1',
    ...overrides,
  };
}

describe('revocationNames (tm 426)', () => {
  it('names by token only the socket that logged in with that credential', () => {
    const revoked = envelope({ kind: 'token', tokenId: 'token-1' });
    expect(revocationNames(revoked, subject())).toBe(true);
    // The same member's other session stays.
    expect(revocationNames(revoked, subject({ tokenId: 'token-2' }))).toBe(false);
    expect(revocationNames(revoked, subject({ tokenId: null }))).toBe(false);
  });

  it('names by agent every socket of that member or bot in the licence, whatever credential each used', () => {
    const revoked = envelope({ kind: 'agent', agentId: 'agent-1' });
    expect(revocationNames(revoked, subject())).toBe(true);
    expect(revocationNames(revoked, subject({ tokenId: 'token-2' }))).toBe(true);
    expect(revocationNames(revoked, subject({ actorId: 'agent-2' }))).toBe(false);
  });

  it('names by licence every agent-door socket of the licence', () => {
    const revoked = envelope({ kind: 'license' });
    expect(revocationNames(revoked, subject())).toBe(true);
    expect(revocationNames(revoked, subject({ actorId: 'bot-9', tokenId: 'token-9' }))).toBe(true);
  });

  it('never names a socket of another licence or another organization (NFR-S4)', () => {
    for (const target of [
      { kind: 'token', tokenId: 'token-1' },
      { kind: 'agent', agentId: 'agent-1' },
      { kind: 'license' },
    ] as const) {
      expect(revocationNames(envelope(target, '8'), subject()), target.kind).toBe(false);
      expect(revocationNames(envelope(target, '7', OTHER_ORG), subject()), target.kind).toBe(false);
    }
  });

  it("never names a visitor's socket: a signed token is nothing a revocation can revoke", () => {
    const visitor = subject({ side: 'customer', actorId: 'agent-1', tokenId: null });
    for (const target of [{ kind: 'agent', agentId: 'agent-1' }, { kind: 'license' }] as const) {
      expect(revocationNames(envelope(target), visitor), target.kind).toBe(false);
    }
  });
});

interface FakeSocket {
  closes: Array<{ code: number; reason: string }>;
}

function setup() {
  const registry = new ConnectionRegistry();
  const info = vi.fn();
  const log = { info, debug: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as Logger;
  const revocations = new PrincipalRevocations(registry, log);
  const sockets = new Map<string, FakeSocket>();

  function open(side: 'agent' | 'customer', organizationId = ORG): Connection {
    const fake: FakeSocket = { closes: [] };
    const ws = {
      close: (code: number, reason: string) => fake.closes.push({ code, reason }),
    } as unknown as WebSocket;
    const connection = registry.add({ ws, side, organizationId });
    sockets.set(connection.id, fake);
    return connection;
  }

  function loggedIn(
    actorId: string,
    options: {
      side?: 'agent' | 'customer';
      tokenId?: string | null;
      licenseId?: string;
      organizationId?: string;
    } = {},
  ): Connection {
    const connection = open(options.side ?? 'agent', options.organizationId ?? ORG);
    registry.authenticate(connection.id, {
      licenseId: options.licenseId ?? '7',
      actorId,
      actorType: options.side === 'customer' ? 'customer' : 'agent',
      tokenId: options.tokenId === undefined ? `${actorId}-token` : options.tokenId,
    });
    return connection;
  }

  const closesOf = (connection: Connection) => sockets.get(connection.id)!.closes;
  return { registry, revocations, info, open, loggedIn, closesOf };
}

describe('PrincipalRevocations.apply (tm 426)', () => {
  it('closes with 4401 every logged-in socket the envelope names, and records why (NFR-S2)', () => {
    const { revocations, loggedIn, closesOf } = setup();
    const tab = loggedIn('agent-1', { tokenId: 'session-1' });
    const phone = loggedIn('agent-1', { tokenId: 'session-2' });
    const colleague = loggedIn('agent-2');

    expect(revocations.apply(envelope({ kind: 'agent', agentId: 'agent-1' }))).toBe(2);

    for (const closed of [tab, phone]) {
      expect(closesOf(closed)).toEqual([
        { code: CREDENTIAL_REVOKED_CLOSE_CODE, reason: 'credential revoked' },
      ]);
      expect(closed.closedBy).toBe('credential_revoked');
    }
    expect(CREDENTIAL_REVOKED_CLOSE_CODE).toBe(4401);
    expect(closesOf(colleague)).toEqual([]);
    expect(colleague.closedBy).toBeNull();
  });

  it('closes by token only the socket of that credential', () => {
    const { revocations, loggedIn, closesOf } = setup();
    const signedOut = loggedIn('agent-1', { tokenId: 'session-1' });
    const stillSignedIn = loggedIn('agent-1', { tokenId: 'session-2' });

    expect(revocations.apply(envelope({ kind: 'token', tokenId: 'session-1' }))).toBe(1);
    expect(closesOf(signedOut)).toHaveLength(1);
    expect(closesOf(stillSignedIn)).toEqual([]);
  });

  it("closes by licence the licence's agent-door sockets and no visitor's, nor another licence's", () => {
    const { revocations, loggedIn, closesOf } = setup();
    const member = loggedIn('agent-1');
    const bot = loggedIn('bot-1');
    const visitor = loggedIn('customer-1', { side: 'customer', tokenId: null });
    const otherLicence = loggedIn('agent-1', { licenseId: '8', organizationId: OTHER_ORG });

    expect(revocations.apply(envelope({ kind: 'license' }))).toBe(2);
    expect(closesOf(member)).toHaveLength(1);
    expect(closesOf(bot)).toHaveLength(1);
    expect(closesOf(visitor)).toEqual([]);
    expect(closesOf(otherLicence)).toEqual([]);
  });

  it('records the envelope on every socket of the organization whose login is in flight, and on no other', () => {
    const { revocations, open, closesOf } = setup();
    const midLogin = open('agent');
    midLogin.loggingIn = true;
    const idle = open('agent');
    const elsewhere = open('agent', OTHER_ORG);
    elsewhere.loggingIn = true;
    const revoked = envelope({ kind: 'license' });

    expect(revocations.apply(revoked)).toBe(0);

    expect(midLogin.revokedDuringLogin).toEqual([revoked]);
    expect(closesOf(midLogin)).toEqual([]);
    expect(idle.revokedDuringLogin).toEqual([]);
    expect(elsewhere.revokedDuringLogin).toEqual([]);
  });

  it('closes a socket marked logged in even while its login is still finishing', () => {
    const { revocations, loggedIn, closesOf } = setup();
    // `onAuthenticated` is awaited after the socket was marked logged in.
    const finishing = loggedIn('agent-1');
    finishing.loggingIn = true;

    expect(revocations.apply(envelope({ kind: 'agent', agentId: 'agent-1' }))).toBe(1);
    expect(closesOf(finishing)).toHaveLength(1);
    expect(finishing.revokedDuringLogin).toEqual([]);
  });

  it('leaves alone a socket the gateway is closing already: one close frame, the first reason', () => {
    const { revocations, loggedIn, closesOf } = setup();
    const slow = loggedIn('agent-1');
    slow.closedBy = 'slow_consumer';
    const revoked = loggedIn('agent-2');

    expect(revocations.apply(envelope({ kind: 'license' }))).toBe(1);
    expect(revocations.apply(envelope({ kind: 'license' }))).toBe(0);

    expect(closesOf(slow)).toEqual([]);
    expect(slow.closedBy).toBe('slow_consumer');
    expect(closesOf(revoked)).toHaveLength(1);
  });

  it('logs one line per envelope, with ids and the count — nothing a credential carried', () => {
    const { revocations, loggedIn, info } = setup();
    loggedIn('agent-1', { tokenId: 'session-1' });

    revocations.apply(envelope({ kind: 'token', tokenId: 'session-1' }));

    expect(info).toHaveBeenCalledTimes(1);
    expect(info).toHaveBeenCalledWith(
      {
        license_id: '7',
        organization_id: ORG,
        target: 'token',
        token_id: 'session-1',
        sockets_closed: 1,
      },
      'rtm closed the sockets of a revoked credential',
    );
  });

  it('survives a socket that throws on close', () => {
    const { registry, revocations } = setup();
    const connection = registry.add({
      ws: {
        close: () => {
          throw new Error('already gone');
        },
      } as unknown as WebSocket,
      side: 'agent',
      organizationId: ORG,
    });
    registry.authenticate(connection.id, { licenseId: '7', actorId: 'agent-1', tokenId: 't' });

    expect(revocations.apply(envelope({ kind: 'license' }))).toBe(1);
    expect(connection.closedBy).toBe('credential_revoked');
  });
});
