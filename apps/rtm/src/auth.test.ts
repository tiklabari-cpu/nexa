/**
 * The door a socket was opened at decides which credentials it takes (tm 425).
 *
 * What is pinned here is the authenticator's half: a token of the wrong family
 * is refused before it is checked — at the customer door, which is anyone's for
 * a minted token, an opaque string no longer costs a database round trip. The
 * dispatcher checks the resolved principal against the door as well
 * (`dispatcher.test.ts`); the whole path against real sockets is
 * `test/integration/login-side.test.ts`.
 */
import { createHmac } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { principalFitsSide, SocketAuthenticator } from './auth.js';

const SECRET = 'unit-test-customer-token-secret-0123456789';
const ORG = '11111111-1111-4111-8111-111111111111';

/** A database that fails the test if anything reaches it. */
function untouchableDb() {
  const query = vi.fn(() => {
    throw new Error('the database was queried');
  });
  return {
    db: { $queryRaw: query, $transaction: query } as unknown as PrismaClient,
    query,
  };
}

function authenticator(db: PrismaClient): SocketAuthenticator {
  return new SocketAuthenticator(db, SECRET, 'eu', {} as never);
}

function visitorToken(): string {
  const now = Math.floor(Date.now() / 1000);
  const body = Buffer.from(
    JSON.stringify({ sub: 'cust-1', org: ORG, lic: '7', rgn: 'eu', iat: now, exp: now + 600 }),
  ).toString('base64url');
  const signature = createHmac('sha256', SECRET).update(`nxc1.${body}`).digest('base64url');
  return `nxc1.${body}.${signature}`;
}

describe('SocketAuthenticator.authenticate — the door decides the family (tm 425)', () => {
  it('accepts a genuine visitor token at the customer door', async () => {
    const { db } = untouchableDb();
    const result = await authenticator(db).authenticate(visitorToken(), ORG, 'customer');
    expect(result).toMatchObject({ ok: true, principal: { kind: 'customer', actorId: 'cust-1' } });
  });

  it('refuses a genuine visitor token at the agent door (NFR-S3)', async () => {
    const { db } = untouchableDb();
    const result = await authenticator(db).authenticate(`Bearer ${visitorToken()}`, ORG, 'agent');
    expect(result).toEqual({ ok: false, reason: 'side_mismatch' });
  });

  it('refuses any other token at the customer door without asking the database (NFR-S3)', async () => {
    const { db, query } = untouchableDb();
    for (const token of ['Bearer test_0f8fad5b-d9cb-469f-a165-70867728950e', 'pat-like-opaque']) {
      expect(await authenticator(db).authenticate(token, ORG, 'customer')).toEqual({
        ok: false,
        reason: 'side_mismatch',
      });
    }
    expect(query).not.toHaveBeenCalled();
  });

  it('still answers an empty credential as malformed, at either door', async () => {
    const { db } = untouchableDb();
    for (const side of ['agent', 'customer'] as const) {
      expect(await authenticator(db).authenticate('Bearer   ', ORG, side)).toEqual({
        ok: false,
        reason: 'malformed',
      });
    }
  });
});

describe('principalFitsSide (tm 425)', () => {
  it('lets a member and a bot in at the agent door, and a visitor at the customer door — nothing else', () => {
    expect(principalFitsSide('agent', 'agent')).toBe(true);
    expect(principalFitsSide('bot', 'agent')).toBe(true);
    expect(principalFitsSide('customer', 'agent')).toBe(false);

    expect(principalFitsSide('customer', 'customer')).toBe(true);
    expect(principalFitsSide('agent', 'customer')).toBe(false);
    expect(principalFitsSide('bot', 'customer')).toBe(false);
  });
});
