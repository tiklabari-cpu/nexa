/**
 * `login`'s three gates added in tm 425 / tm 427, against a stand-in
 * authenticator so each one can be made to fail on its own:
 *
 *   - the principal the credential resolved to must fit the door the socket was
 *     opened at — a visitor at the customer door, a member or a bot at the
 *     agent door — or the login is refused and the socket closed (1008);
 *   - one login at a time: a second `login` sent while the first one's token is
 *     being checked is refused, and the lock is let go on every path;
 *   - the post-login socket caps can refuse an accepted credential (1013).
 *
 * The same paths against real sockets: `test/integration/login-side.test.ts`
 * and `test/integration/customer-socket-limit.test.ts`.
 */
import { performance } from 'node:perf_hooks';
import type { Logger } from 'pino';
import { describe, expect, it, vi } from 'vitest';
import type { WebSocket } from 'ws';
import { principalRevokedEnvelope, type PrincipalRevokedTarget } from '@siyahtus/types';
import type { AuthResult, SocketAuthenticator, SocketPrincipal } from './auth.js';
import { ConnectionRegistry, type Connection } from './connection.js';
import { Dispatcher, SOCKET_LIMIT_CLOSE_CODE, WRONG_SIDE_CLOSE_CODE } from './dispatcher.js';
import type { DecodedRequest } from './protocol.js';
import type { SyncService } from './sync.js';
import type { TypingService } from './typing.js';

const ORG = '11111111-1111-4111-8111-111111111111';

const silentLog = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
} as unknown as Logger;

function principal(kind: SocketPrincipal['kind'], actorId = `${kind}-1`): SocketPrincipal {
  return {
    kind,
    actorId,
    licenseId: '7',
    organizationId: ORG,
    scopes: [],
    groupIds: [],
    unrestricted: false,
    authority: null,
  };
}

function build(
  authenticate: (token: string, organizationId: string, side: string) => Promise<AuthResult>,
  admitLogin?: (connection: Connection, principal: SocketPrincipal) => boolean,
  listen?: (licenseId: string) => Promise<number>,
) {
  const registry = new ConnectionRegistry();
  const onAuthenticated = vi.fn(async () => undefined);
  const authenticateSpy = vi.fn(authenticate);
  const dispatcher = new Dispatcher({
    registry,
    authenticator: { authenticate: authenticateSpy } as unknown as SocketAuthenticator,
    sync: {} as SyncService,
    typing: {} as TypingService,
    log: silentLog,
    onAuthenticated,
    messagesPerSecond: 1_000,
    ...(admitLogin ? { admitLogin } : {}),
    ...(listen ? { listen } : {}),
  });
  const open = (side: 'agent' | 'customer') =>
    registry.add({
      ws: { send: () => undefined, close: () => undefined } as unknown as WebSocket,
      side,
      organizationId: ORG,
    });
  return { registry, dispatcher, onAuthenticated, authenticate: authenticateSpy, open };
}

let requestCounter = 0;
function login(token = 'tok'): DecodedRequest {
  requestCounter += 1;
  return { version: '3.6', request_id: `r${requestCounter}`, action: 'login', payload: { token } };
}

function parse(frame: string): {
  success: boolean;
  payload: { error?: { type: string; message: string; details?: Record<string, unknown> } };
} {
  return JSON.parse(frame) as ReturnType<typeof parse>;
}

/** A promise the test settles by hand — the token check "in flight". */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('login: the principal must fit the door (tm 425)', () => {
  it('refuses a visitor at the agent door: answers like any refused credential, closes 1008 after the reply, logs nobody in (NFR-S3)', async () => {
    const { dispatcher, registry, onAuthenticated, open } = build(async () => ({
      ok: true,
      principal: principal('customer'),
    }));
    const connection = open('agent');

    const frame = parse(await dispatcher.dispatch(connection, login()));

    expect(frame.success).toBe(false);
    expect(frame.payload.error).toMatchObject({
      type: 'authentication',
      message: 'Invalid or expired credentials.',
    });
    expect(connection.closeAfterReply).toEqual({
      code: WRONG_SIDE_CLOSE_CODE,
      reason: 'credential not valid for this socket',
    });
    expect(WRONG_SIDE_CLOSE_CODE).toBe(1008);
    expect(connection.closedBy).toBe('login_refused');
    expect(connection.authenticated).toBe(false);
    expect(connection.subscriptions.size).toBe(0);
    expect(registry.actors).toBe(0);
    expect(onAuthenticated).not.toHaveBeenCalled();
  });

  it('refuses a member and a bot at the customer door the same way (NFR-S3)', async () => {
    for (const kind of ['agent', 'bot'] as const) {
      const { dispatcher, open } = build(async () => ({ ok: true, principal: principal(kind) }));
      const connection = open('customer');

      const frame = parse(await dispatcher.dispatch(connection, login()));

      expect(frame.payload.error?.type, kind).toBe('authentication');
      expect(connection.closeAfterReply?.code, kind).toBe(1008);
      expect(connection.authenticated, kind).toBe(false);
    }
  });

  it("answers the authenticator's own side_mismatch the same way, and hands it the socket's door", async () => {
    const { dispatcher, authenticate, open } = build(async () => ({
      ok: false,
      reason: 'side_mismatch',
    }));
    const connection = open('customer');

    const frame = parse(await dispatcher.dispatch(connection, login('Bearer opaque')));

    expect(authenticate).toHaveBeenCalledWith('Bearer opaque', ORG, 'customer');
    expect(frame.payload.error?.type).toBe('authentication');
    expect(connection.closeAfterReply?.code).toBe(1008);
    expect(connection.closedBy).toBe('login_refused');
  });

  it('lets a member and a bot in at the agent door, and a visitor at the customer door', async () => {
    const cases = [
      ['agent', 'agent'],
      ['bot', 'agent'],
      ['customer', 'customer'],
    ] as const;
    for (const [kind, side] of cases) {
      const { dispatcher, registry, open } = build(async () => ({
        ok: true,
        principal: principal(kind),
      }));
      const connection = open(side);

      const frame = parse(await dispatcher.dispatch(connection, login()));

      expect(frame.success, `${kind} at ${side}`).toBe(true);
      expect(connection.authenticated).toBe(true);
      expect(connection.actorType).toBe(kind);
      expect(connection.closeAfterReply).toBeNull();
      expect(registry.actors).toBe(1);
    }
  });

  it('does not close the socket over an ordinary refused credential', async () => {
    const { dispatcher, open } = build(async () => ({ ok: false, reason: 'unknown' }));
    const connection = open('agent');

    const frame = parse(await dispatcher.dispatch(connection, login()));

    expect(frame.payload.error?.type).toBe('authentication');
    expect(connection.closeAfterReply).toBeNull();
    expect(connection.closedBy).toBeNull();
  });
});

describe('login: one at a time (tm 425)', () => {
  it('refuses a second login sent while the first is being checked, then lets the first finish — one identity, one index entry', async () => {
    const first = deferred<AuthResult>();
    const second = deferred<AuthResult>();
    const pending = [first, second];
    const { dispatcher, registry, authenticate, open } = build(() => pending.shift()!.promise);
    const connection = open('agent');

    // Both sent before either is answered — what two frames in one TCP read do.
    const one = dispatcher.dispatch(connection, login('Bearer owner'));
    const two = dispatcher.dispatch(connection, login('Bearer agent'));

    const refused = parse(await two);
    expect(refused.success).toBe(false);
    expect(refused.payload.error).toMatchObject({
      type: 'not_allowed',
      message: 'A login is already in progress on this socket.',
    });
    // The second never reached the authenticator.
    expect(authenticate).toHaveBeenCalledTimes(1);

    first.resolve({ ok: true, principal: principal('agent', 'owner-1') });
    expect(parse(await one).success).toBe(true);
    expect(connection.actorId).toBe('owner-1');
    expect(registry.actors).toBe(1);
    expect(registry.forActor(ORG, 'owner-1')).toEqual([connection]);
    expect(connection.loggingIn).toBe(false);

    // And once logged in, any further login is refused as before.
    const again = parse(await dispatcher.dispatch(connection, login('Bearer agent')));
    expect(again.payload.error).toMatchObject({
      type: 'not_allowed',
      message: 'This socket is already authenticated.',
    });
  });

  it('lets go of the lock when the login is refused, so the socket can log in again', async () => {
    const results: AuthResult[] = [
      { ok: false, reason: 'expired' },
      { ok: true, principal: principal('agent') },
    ];
    const { dispatcher, open } = build(async () => results.shift()!);
    const connection = open('agent');

    expect(parse(await dispatcher.dispatch(connection, login())).success).toBe(false);
    expect(connection.loggingIn).toBe(false);
    expect(parse(await dispatcher.dispatch(connection, login())).success).toBe(true);
  });

  it('lets go of the lock when the token check itself throws', async () => {
    let calls = 0;
    const { dispatcher, open } = build(async () => {
      calls += 1;
      if (calls === 1) throw new Error('database unreachable');
      return { ok: true, principal: principal('agent') };
    });
    const connection = open('agent');

    await expect(dispatcher.dispatch(connection, login())).rejects.toThrow('database unreachable');
    expect(connection.loggingIn).toBe(false);
    expect(parse(await dispatcher.dispatch(connection, login())).success).toBe(true);
  });
});

describe('login: the post-login socket caps (tm 427)', () => {
  it('refuses a login the caps turn away: 429-style socket_limit_reached, close 1013 after the reply, nobody logged in (NFR-S8)', async () => {
    const admitLogin = vi.fn(() => false);
    const { dispatcher, registry, onAuthenticated, open } = build(
      async () => ({ ok: true, principal: principal('customer') }),
      admitLogin,
    );
    const connection = open('customer');

    const frame = parse(await dispatcher.dispatch(connection, login()));

    expect(frame.success).toBe(false);
    expect(frame.payload.error).toMatchObject({
      type: 'too_many_requests',
      details: { reason: 'socket_limit_reached' },
    });
    // The reason, never the number.
    expect(JSON.stringify(frame)).not.toMatch(/\b5\b|\b50\b|RTM_MAX/);
    expect(connection.closeAfterReply).toEqual({
      code: SOCKET_LIMIT_CLOSE_CODE,
      reason: 'socket limit reached',
    });
    expect(SOCKET_LIMIT_CLOSE_CODE).toBe(1013);
    expect(connection.closedBy).toBe('socket_limit');
    expect(connection.authenticated).toBe(false);
    expect(registry.actors).toBe(0);
    expect(onAuthenticated).not.toHaveBeenCalled();
  });

  it('asks the caps with the connection and the principal, before the socket is marked logged in', async () => {
    const seen: Array<{ authenticated: boolean; kind: string }> = [];
    const { dispatcher, open } = build(
      async () => ({ ok: true, principal: principal('customer') }),
      (connection, who) => {
        seen.push({ authenticated: connection.authenticated, kind: who.kind });
        return true;
      },
    );
    const connection = open('customer');

    expect(parse(await dispatcher.dispatch(connection, login())).success).toBe(true);
    expect(seen).toEqual([{ authenticated: false, kind: 'customer' }]);
  });

  it('is not asked about a credential refused at the door', async () => {
    const admitLogin = vi.fn(() => true);
    const { dispatcher, open } = build(
      async () => ({ ok: true, principal: principal('customer') }),
      admitLogin,
    );

    await dispatcher.dispatch(open('agent'), login());

    expect(admitLogin).not.toHaveBeenCalled();
  });
});

describe('login: a revocation heard while the credential was being read (tm 426)', () => {
  function revoked(target: PrincipalRevokedTarget, organizationId = ORG) {
    return principalRevokedEnvelope({ licenseId: '7', organizationId }, target);
  }

  /** Logs `kind` in at `side` with the token check held open while `during` runs. */
  async function loginAcross(
    during: (connection: Connection) => void,
    kind: SocketPrincipal['kind'] = 'agent',
    side: 'agent' | 'customer' = 'agent',
  ) {
    const check = deferred<AuthResult>();
    const built = build(() => check.promise);
    const connection = built.open(side);
    const answer = built.dispatcher.dispatch(connection, login());
    expect(connection.loggingIn).toBe(true);
    during(connection);
    check.resolve({ ok: true, principal: { ...principal(kind), tokenId: 'token-1' } });
    return { ...built, connection, frame: parse(await answer) };
  }

  it('refuses the login a revocation named — as a refused credential, nobody logged in — and keeps the socket open (NFR-S2)', async () => {
    for (const target of [
      { kind: 'token', tokenId: 'token-1' },
      { kind: 'agent', agentId: 'agent-1' },
      { kind: 'license' },
    ] as const) {
      const { frame, connection, registry, onAuthenticated } = await loginAcross((socket) => {
        socket.revokedDuringLogin.push(revoked(target));
      });

      expect(frame.success, target.kind).toBe(false);
      expect(frame.payload.error).toMatchObject({
        type: 'authentication',
        message: 'Invalid or expired credentials.',
      });
      expect(connection.authenticated).toBe(false);
      expect(registry.actors).toBe(0);
      expect(onAuthenticated).not.toHaveBeenCalled();
      // A refused credential, not a refused door: the client decides.
      expect(connection.closeAfterReply).toBeNull();
      expect(connection.loggingIn).toBe(false);
      expect(connection.revokedDuringLogin).toEqual([]);
    }
  });

  it('lets the login through when what it heard names somebody else', async () => {
    for (const envelope of [
      revoked({ kind: 'token', tokenId: 'token-2' }),
      revoked({ kind: 'agent', agentId: 'agent-2' }),
      principalRevokedEnvelope({ licenseId: '8', organizationId: ORG }, { kind: 'license' }),
    ]) {
      const { frame, connection } = await loginAcross((socket) => {
        socket.revokedDuringLogin.push(envelope);
      });

      expect(frame.success, JSON.stringify(envelope.target)).toBe(true);
      expect(connection.tokenId).toBe('token-1');
      expect(connection.revokedDuringLogin).toEqual([]);
    }
  });

  it("never refuses a visitor's login over one: a signed token is nothing a revocation names", async () => {
    const { frame } = await loginAcross(
      (socket) => {
        socket.revokedDuringLogin.push(revoked({ kind: 'license' }));
      },
      'customer',
      'customer',
    );

    expect(frame.success).toBe(true);
  });

  it('starts every login with nothing heard', async () => {
    const { dispatcher, open } = build(async () => ({ ok: true, principal: principal('agent') }));
    const connection = open('agent');
    // Left over from a login before — the dispatcher empties it as it starts.
    connection.revokedDuringLogin.push(revoked({ kind: 'license' }));

    expect(parse(await dispatcher.dispatch(connection, login())).success).toBe(true);
  });
});

describe('login: listening to the licence before the login finishes (tm 426)', () => {
  it('reads the credential again when the subscription was confirmed after the first read began, and goes by the second read', async () => {
    const reads: AuthResult[] = [
      { ok: true, principal: { ...principal('agent'), tokenId: 'token-1' } },
      { ok: false, reason: 'revoked' },
    ];
    const listen = vi.fn(async () => performance.now());
    const { dispatcher, authenticate, open, registry } = build(
      async () => reads.shift()!,
      undefined,
      listen,
    );
    const connection = open('agent');

    const frame = parse(await dispatcher.dispatch(connection, login()));

    expect(listen).toHaveBeenCalledWith('7');
    expect(authenticate).toHaveBeenCalledTimes(2);
    expect(frame.payload.error?.type).toBe('authentication');
    expect(connection.authenticated).toBe(false);
    expect(registry.actors).toBe(0);
  });

  it('reads it once when the subscription was confirmed before the read began', async () => {
    const confirmed = performance.now();
    const listen = vi.fn(async () => confirmed);
    const { dispatcher, authenticate, open } = build(
      async () => ({ ok: true, principal: principal('agent') }),
      undefined,
      listen,
    );

    expect(parse(await dispatcher.dispatch(open('agent'), login())).success).toBe(true);
    expect(listen).toHaveBeenCalledTimes(1);
    expect(authenticate).toHaveBeenCalledTimes(1);
  });

  it('listens before the socket is marked logged in', async () => {
    const order: string[] = [];
    const { dispatcher, open, onAuthenticated } = build(
      async () => ({ ok: true, principal: principal('bot') }),
      undefined,
      async () => {
        order.push('listen');
        return 0;
      },
    );
    onAuthenticated.mockImplementation(async () => {
      order.push('logged in');
    });

    expect(parse(await dispatcher.dispatch(open('agent'), login())).success).toBe(true);
    expect(order).toEqual(['listen', 'logged in']);
  });

  it('does not listen for a visitor, a refused credential, or a credential at the wrong door', async () => {
    const cases: Array<[AuthResult, 'agent' | 'customer']> = [
      [{ ok: true, principal: principal('customer') }, 'customer'],
      [{ ok: false, reason: 'unknown' }, 'agent'],
      [{ ok: true, principal: principal('customer') }, 'agent'],
    ];
    for (const [result, side] of cases) {
      const listen = vi.fn(async () => performance.now());
      const { dispatcher, authenticate, open } = build(async () => result, undefined, listen);

      await dispatcher.dispatch(open(side), login());

      expect(listen, JSON.stringify(result)).not.toHaveBeenCalled();
      expect(authenticate).toHaveBeenCalledTimes(1);
    }
  });
});
