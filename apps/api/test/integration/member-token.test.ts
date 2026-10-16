/**
 * Member tokens — who a widget's `POST /customer/token` speaks for
 * (SiyahTuş analysis ID-03 · owner decision K4 · tm 287.2).
 *
 * A returning visitor is recognised by the member token the server signed for
 * their browser and nothing else: not by the bare `customer_id` (whoever
 * learned a member's id could open their conversation with it), not by a typed
 * username. The token is checked signature → expiry → licence → revocation
 * list; anything refused is a new anonymous visitor, answered exactly like a
 * first visit and logged with the licence and the reason.
 *
 * Pinned here, against the real server and database:
 *
 *   - **Recognition and sliding renewal.** The same browser is the same member
 *     — and, the same day, the same Thread ID — through the body copy or the
 *     partitioned cookie; every visit re-signs.
 *   - **Every refusal looks like a first visit**: a bare id, a forged or edited
 *     token, an expired one, another licence's, a revoked one, a retired key.
 *   - **Revocation by run start.** A revocation refuses a member's tokens and
 *     every re-signing of them, including one signed after it from a run that
 *     began before it.
 *   - **Rotation**: the replaced key is accepted for its grace period and its
 *     members are moved onto the new key; after it, refused.
 *   - **The transition**: a customer from before member tokens trades their id
 *     in once, inside the window — never twice, never two requests at once.
 *   - **The licence's controls** (Settings › Security › Member recognition and
 *     forgetting one member) — role, scope, audit, tenant isolation.
 *   - **One cookie per workspace, and sign-out** (tm 287.3): a visit reads and
 *     renews only its own workspace's cookie; `DELETE /customer/token` expires
 *     every member cookie the browser sent and revokes nothing.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MEMBER_TOKEN_COOKIE, MEMBER_TOKEN_TTL, memberTokenCookieName } from '@siyahtus/types';
import {
  MEMBER_TOKEN_FORMAT,
  MemberTokenCodec,
  type MemberTokenClaims,
} from '../../src/services/auth/member-token.js';
import {
  grantToken,
  ownerClient,
  seedFixtures,
  testEnv,
  type Fixtures,
  type TenantFixture,
} from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

/** What the mint answers, as far as these tests read it. */
interface Minted {
  token: string;
  customer_id: string;
  member_token?: string;
  member_token_expires_at: string;
}

/** Collects the lines pino writes, so assertions are on the log itself. */
class LineSink {
  readonly lines: string[] = [];
  write(chunk: string): boolean {
    this.lines.push(chunk);
    return true;
  }
  end(): void {}
  on(): void {}
  once(): void {}
  emit(): boolean {
    return false;
  }
}

const REFUSED = 'member credential refused; answered as a new visitor';

/** The claims inside a member token (the test reads, it never trusts). */
function claimsOf(token: string): MemberTokenClaims {
  return JSON.parse(Buffer.from(token.split('.')[2]!, 'base64url').toString('utf8'));
}

describe('member tokens (ID-03 · K4)', () => {
  let server: TestServer;
  let owner: PrismaClient;
  let fx: Fixtures;
  const sink = new LineSink();
  const codec = new MemberTokenCodec(testEnv().CUSTOMER_TOKEN_SECRET);

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });
  const origin = (tenant: TenantFixture) => ({ origin: `https://${tenant.trustedDomain}` });

  async function mint(
    tenant: TenantFixture,
    body: Record<string, unknown> = {},
    headers: Record<string, string> = {},
  ) {
    return server.post(
      '/customer/token',
      { organization_id: tenant.organizationId, ...body },
      { ...origin(tenant), ...headers },
    );
  }

  /** A visitor's first load: a new customer, and the member token for its browser. */
  async function firstVisit(tenant: TenantFixture = fx.a): Promise<Minted> {
    const response = await mint(tenant);
    expect(response.statusCode).toBe(200);
    return response.json() as Minted;
  }

  async function returning(
    tenant: TenantFixture,
    memberToken: string,
    via: 'body' | 'cookie' = 'body',
  ): Promise<Minted> {
    const response =
      via === 'body'
        ? await mint(tenant, { member_token: memberToken })
        : await mint(
            tenant,
            {},
            { cookie: `${memberTokenCookieName(tenant.organizationId)}=${memberToken}` },
          );
    expect(response.statusCode).toBe(200);
    return response.json() as Minted;
  }

  /** The refusals logged since `from`, as parsed lines. */
  function refusals(from: number): Array<{ license_id: string; reason: string; source: string }> {
    return sink.lines
      .slice(from)
      .map((line) => JSON.parse(line) as { msg?: string } & Record<string, string>)
      .filter((line) => line.msg === REFUSED) as Array<{
      license_id: string;
      reason: string;
      source: string;
    }>;
  }

  async function dbNow(): Promise<number> {
    const [row] = await owner.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`;
    return row!.now.getTime();
  }

  /** A token signed with the licence's real key, carrying whatever claims a test needs. */
  async function forge(
    tenant: TenantFixture,
    claims: Partial<MemberTokenClaims> & { sub: string },
  ): Promise<string> {
    const row = await owner.memberTokenKey.findUniqueOrThrow({
      where: { licenseId: tenant.licenseId },
    });
    const key = codec.openKey(tenant.licenseId, row.keyVersion, row.keyCiphertext);
    const now = await dbNow();
    return codec.sign(
      {
        lic: tenant.licenseId.toString(),
        did: 'test-device',
        oat: now,
        iat: now,
        exp: now + 3_600_000,
        ver: MEMBER_TOKEN_FORMAT,
        ...claims,
      },
      key,
      row.keyVersion,
    );
  }

  async function admin(tenant: TenantFixture, scopes = ['access_rules:rw', 'customers:rw']) {
    return grantToken(owner, {
      licenseId: tenant.licenseId,
      organizationId: tenant.organizationId,
      ownerId: tenant.ownerAccountId,
      scopes,
    });
  }

  beforeAll(async () => {
    owner = ownerClient();
    server = await startTestServer(
      { LOG_LEVEL: 'warn' },
      { logStream: sink as unknown as NodeJS.WritableStream },
    );
  });

  afterAll(async () => {
    await server.close();
    await owner.$disconnect();
  });

  beforeEach(async () => {
    fx = await seedFixtures(owner);
    await clearRateLimits(server.app);
  });

  // ==========================================================================
  // First visit and recognition
  // ==========================================================================

  describe('recognition', () => {
    it('signs a first visit a member token, in the body and in a partitioned cookie (NFR-S1 · NFR-S2)', async () => {
      const before = await dbNow();
      const response = await mint(fx.a);
      expect(response.statusCode).toBe(200);
      const body = response.json() as Minted;

      expect(body.member_token).toMatch(/^nxm1\.1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
      // Sliding lifetime from this visit: the default 30 days.
      const expires = Date.parse(body.member_token_expires_at);
      expect(expires - before).toBeGreaterThanOrEqual(MEMBER_TOKEN_TTL.defaultSeconds * 1000);
      expect(expires - before).toBeLessThan(MEMBER_TOKEN_TTL.defaultSeconds * 1000 + 60_000);

      // The cookie: kept per embedding site, sent to this endpoint alone, never
      // shown to a page script.
      expect(response.headers['set-cookie']).toBe(
        `${memberTokenCookieName(fx.a.organizationId)}=${body.member_token}; ` +
          `Max-Age=${MEMBER_TOKEN_TTL.defaultSeconds}; ` +
          'Path=/api/v1/customer/token; Secure; HttpOnly; SameSite=None; Partitioned',
      );
      expect(response.headers['cache-control']).toBe('no-store');

      const claims = claimsOf(body.member_token!);
      expect(claims).toMatchObject({
        sub: body.customer_id,
        lic: fx.a.licenseId.toString(),
        ver: MEMBER_TOKEN_FORMAT,
      });
      expect(claims.oat).toBe(claims.iat);
      expect(claims.exp).toBe(Date.parse(body.member_token_expires_at));

      // The licence's key was made by this first mint — sealed, never in the clear.
      const key = await owner.memberTokenKey.findUniqueOrThrow({
        where: { licenseId: fx.a.licenseId },
      });
      expect(key.keyVersion).toBe(1);
      expect(key.keyCiphertext).toMatch(/^v1:/);
      expect(key.previousKeyVersion).toBeNull();
    });

    it('brings the same browser back as the same member, re-signed each visit (sliding)', async () => {
      const from = sink.lines.length;
      const first = await firstVisit();
      const second = await returning(fx.a, first.member_token!);

      expect(second.customer_id).toBe(first.customer_id);
      expect(second.member_token).not.toBe(first.member_token);
      // The browser's number and the start of its run survive the re-signing;
      // the signature and the deadline are new.
      const [a, b] = [claimsOf(first.member_token!), claimsOf(second.member_token!)];
      expect(b.did).toBe(a.did);
      expect(b.oat).toBe(a.oat);
      expect(b.iat).toBeGreaterThanOrEqual(a.iat);
      expect(b.exp).toBeGreaterThanOrEqual(a.exp);
      expect(refusals(from)).toEqual([]);
    });

    it('puts the same browser, back the same day, on the same customer and the same Thread ID', async () => {
      const first = await firstVisit();
      const opened = await server.post(
        '/customer/chat/events',
        { text: 'Hello' },
        auth(first.token),
      );
      expect(opened.statusCode).toBe(201);
      const chatId = (opened.json() as { chat_id: string }).chat_id;
      // The visitor ends the conversation and leaves.
      expect(
        (await server.post('/customer/chat/close', undefined, auth(first.token))).statusCode,
      ).toBe(204);

      const back = await returning(fx.a, first.member_token!);
      expect(back.customer_id).toBe(first.customer_id);
      const again = await server.post(
        '/customer/chat/events',
        { text: 'Me again' },
        auth(back.token),
      );
      expect(again.statusCode).toBe(201);
      expect((again.json() as { chat_id: string }).chat_id).toBe(chatId);
      expect(await owner.thread.count({ where: { chatId } })).toBe(2);
    });

    it('recognises the member from the cookie, and leaves the token out of the body', async () => {
      const first = await firstVisit();
      const response = await mint(
        fx.a,
        {},
        { cookie: `${memberTokenCookieName(fx.a.organizationId)}=${first.member_token}` },
      );
      expect(response.statusCode).toBe(200);
      const body = response.json() as Minted;

      expect(body.customer_id).toBe(first.customer_id);
      // The token lives where no script reads it; the cookie is renewed.
      expect(body).not.toHaveProperty('member_token');
      expect(String(response.headers['set-cookie'])).toMatch(
        new RegExp(`^${memberTokenCookieName(fx.a.organizationId)}=nxm1\\.1\\.`),
      );
      expect(body.member_token_expires_at).toBeTruthy();
    });

    it('lets the cookie win when the body carries another member', async () => {
      const alice = await firstVisit();
      const bob = await firstVisit();
      const response = await mint(
        fx.a,
        { member_token: bob.member_token },
        { cookie: `other=1; ${memberTokenCookieName(fx.a.organizationId)}=${alice.member_token}` },
      );
      expect((response.json() as Minted).customer_id).toBe(alice.customer_id);
    });
  });

  // ==========================================================================
  // One cookie per workspace, and the host page's sign-out (tm 287.3)
  // ==========================================================================

  describe('the cookie per workspace (tm 287.3)', () => {
    it("reads and renews only its own workspace's cookie — another's survives a visit untouched (NFR-S2)", async () => {
      // Two workspaces on one site — every hosted Chat page shares the widget's
      // own — so one browser sends both cookies to both.
      const atA = await firstVisit(fx.a);
      const atB = await firstVisit(fx.b);
      const both =
        `${memberTokenCookieName(fx.b.organizationId)}=${atB.member_token}; ` +
        `${memberTokenCookieName(fx.a.organizationId)}=${atA.member_token}`;

      const from = sink.lines.length;
      const backAtA = await mint(fx.a, {}, { cookie: both });
      const backAtB = await mint(fx.b, {}, { cookie: both });

      expect((backAtA.json() as Minted).customer_id).toBe(atA.customer_id);
      expect((backAtB.json() as Minted).customer_id).toBe(atB.customer_id);
      // Each answer renews its own cookie and names no other: B's visit cannot
      // overwrite A's member with B's.
      expect(backAtA.headers['set-cookie']).toMatch(
        new RegExp(`^${memberTokenCookieName(fx.a.organizationId)}=nxm1\\.`),
      );
      expect(backAtB.headers['set-cookie']).toMatch(
        new RegExp(`^${memberTokenCookieName(fx.b.organizationId)}=nxm1\\.`),
      );
      // The other workspace's token was never even read, so nothing was refused.
      expect(refusals(from)).toEqual([]);
    });

    it('treats a cookie under another name — the old shared one, or another workspace’s — as no cookie', async () => {
      const member = await firstVisit(fx.a);
      const from = sink.lines.length;

      for (const name of [MEMBER_TOKEN_COOKIE, memberTokenCookieName(fx.b.organizationId)]) {
        const response = await mint(fx.a, {}, { cookie: `${name}=${member.member_token}` });
        const body = response.json() as Minted;
        expect(body.customer_id, name).not.toBe(member.customer_id);
        // A new visitor, handed a token of their own in the body.
        expect(body.member_token, name).toMatch(/^nxm1\./);
      }
      expect(refusals(from)).toEqual([]);
    });
  });

  describe('sign-out: DELETE /customer/token (tm 287.3)', () => {
    it("expires every workspace's member cookie the browser sent, with the attributes it was set with, and nothing else", async () => {
      const a = memberTokenCookieName(fx.a.organizationId);
      const b = memberTokenCookieName(fx.b.organizationId);
      const response = await server.del('/customer/token', {
        ...origin(fx.a),
        cookie: `other=1; ${a}=nxm1.1.x.y; ${MEMBER_TOKEN_COOKIE}=old; ${b}=nxm1.1.z.w; ${a}=dup`,
      });

      expect(response.statusCode).toBe(204);
      expect(response.body).toBe('');
      expect(response.headers['cache-control']).toBe('no-store');
      const attributes =
        'Max-Age=0; Path=/api/v1/customer/token; Secure; HttpOnly; SameSite=None; Partitioned';
      expect(response.headers['set-cookie']).toEqual([
        `${a}=; ${attributes}`,
        `${b}=; ${attributes}`,
      ]);
    });

    it('answers the same 204 with no cookie to expire, and revokes nothing — a copy kept elsewhere still works', async () => {
      const member = await firstVisit(fx.a);

      const response = await server.del('/customer/token', origin(fx.a));
      expect(response.statusCode).toBe(204);
      expect(response.headers['set-cookie']).toBeUndefined();

      // Stateless: forgetting is the browser's, revoking is an agent's.
      const back = await mint(fx.a, {
        member_token: member.member_token,
      });
      expect((back.json() as Minted).customer_id).toBe(member.customer_id);
    });
  });

  // ==========================================================================
  // Refusals — every one answered like a first visit
  // ==========================================================================

  describe('refusals', () => {
    /** The shape of a first visit's answer, to hold every refusal against. */
    async function firstVisitShape(): Promise<string[]> {
      return Object.keys((await mint(fx.a)).json() as object).sort();
    }

    it('reaches nobody with a bare customer_id — a new visitor, the shape of a first visit, logged (NFR-S5)', async () => {
      const member = await firstVisit();
      await server.post(
        '/customer/chat/events',
        { text: 'My account number is 42' },
        auth(member.token),
      );
      const shape = await firstVisitShape();
      const from = sink.lines.length;

      const response = await mint(fx.a, { customer_id: member.customer_id });
      expect(response.statusCode).toBe(200);
      const intruder = response.json() as Minted;
      expect(intruder.customer_id).not.toBe(member.customer_id);
      expect(Object.keys(intruder).sort()).toEqual(shape);

      // Nothing of the member's conversation reaches the intruder.
      const chat = await server.get('/customer/chat', auth(intruder.token));
      expect(JSON.stringify(chat.json())).not.toContain('account number');

      expect(refusals(from)).toEqual([
        expect.objectContaining({
          license_id: fx.a.licenseId.toString(),
          reason: 'not_adoptable',
          source: 'customer_id',
        }),
      ]);
    });

    it('refuses an edited or forged token as a new visitor, and logs why — never the token', async () => {
      const member = await firstVisit();
      const shape = await firstVisitShape();
      const [prefix, kid, body, signature] = member.member_token!.split('.') as [
        string,
        string,
        string,
        string,
      ];
      const otherCustomer = (await firstVisit()).customer_id;
      const edited = Buffer.from(
        JSON.stringify({ ...claimsOf(member.member_token!), sub: otherCustomer }),
      ).toString('base64url');
      const flipped = `${signature.slice(0, -2)}${signature.endsWith('AA') ? 'BB' : 'AA'}`;

      const from = sink.lines.length;
      for (const token of [
        `${prefix}.${kid}.${edited}.${signature}`, // the claims changed, the signature kept
        `${prefix}.${kid}.${body}.${flipped}`, // the signature changed
        'nxm1.1.garbage', // not a token at all
      ]) {
        const answer = await mint(fx.a, { member_token: token });
        expect(answer.statusCode).toBe(200);
        const refused = answer.json() as Minted;
        expect([member.customer_id, otherCustomer]).not.toContain(refused.customer_id);
        expect(Object.keys(refused).sort()).toEqual(shape);
      }

      expect(refusals(from).map((line) => line.reason)).toEqual([
        'bad_signature',
        'bad_signature',
        'malformed',
      ]);
      const written = sink.lines.slice(from).join('\n');
      expect(written).not.toContain(signature);
      expect(written).not.toContain(body);
    });

    it('refuses an expired token', async () => {
      const member = await firstVisit();
      const now = await dbNow();
      const expired = await forge(fx.a, {
        sub: member.customer_id,
        oat: now - 10_000,
        iat: now - 10_000,
        exp: now - 1,
      });
      const from = sink.lines.length;

      const answer = (await mint(fx.a, { member_token: expired })).json() as Minted;
      expect(answer.customer_id).not.toBe(member.customer_id);
      expect(refusals(from).map((line) => line.reason)).toEqual(['expired']);
    });

    it("never lets another licence's member token in (NFR-S4)", async () => {
      // A member of B presented to A's widget: A's key never signed it.
      const theirs = await firstVisit(fx.b);
      // And one signed with A's own key but naming B's licence — the licence
      // check, apart from the key.
      await firstVisit(fx.a);
      const misfiled = await forge(fx.a, {
        sub: theirs.customer_id,
        lic: fx.b.licenseId.toString(),
      });
      const from = sink.lines.length;

      for (const token of [theirs.member_token!, misfiled]) {
        const answer = (await mint(fx.a, { member_token: token })).json() as Minted;
        expect(answer.customer_id).not.toBe(theirs.customer_id);
      }
      expect(refusals(from).map((line) => line.reason)).toEqual([
        'bad_signature',
        'license_mismatch',
      ]);
      // B's member is untouched and still B's.
      expect((await returning(fx.b, theirs.member_token!)).customer_id).toBe(theirs.customer_id);
      expect(
        await owner.customer.count({
          where: { id: theirs.customer_id, organizationId: fx.b.organizationId },
        }),
      ).toBe(1);
    });

    it('answers a member whose record is gone as a new visitor', async () => {
      const member = await firstVisit();
      await owner.customer.delete({ where: { id: member.customer_id } });
      const from = sink.lines.length;

      const answer = (await mint(fx.a, { member_token: member.member_token })).json() as Minted;
      expect(answer.customer_id).not.toBe(member.customer_id);
      expect(refusals(from).map((line) => line.reason)).toEqual(['customer_gone']);
    });
  });

  // ==========================================================================
  // Revocation and rotation
  // ==========================================================================

  describe('revocation', () => {
    it("refuses one member's tokens and every re-signing of them; others stay (NFR-S2)", async () => {
      const alice = await firstVisit();
      const resigned = await returning(fx.a, alice.member_token!);
      const bob = await firstVisit();

      const response = await server.post(
        `/customers/${alice.customer_id}/revoke-member-tokens`,
        undefined,
        auth(await admin(fx.a)),
      );
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        customer_id: alice.customer_id,
        revoked_at: expect.any(String),
      });

      const from = sink.lines.length;
      for (const token of [alice.member_token!, resigned.member_token!]) {
        expect((await returning(fx.a, token)).customer_id).not.toBe(alice.customer_id);
      }
      expect(refusals(from).map((line) => line.reason)).toEqual(['revoked', 'revoked']);
      expect((await returning(fx.a, bob.member_token!)).customer_id).toBe(bob.customer_id);

      const [entry] = await owner.auditLogEntry.findMany({
        where: { licenseId: fx.a.licenseId, action: 'member_tokens.revoked' },
      });
      expect(entry).toMatchObject({
        target: `customer:${alice.customer_id}`,
        actorId: fx.a.ownerAccountId,
        metadata: expect.objectContaining({ scope: 'customer' }),
      });
      expect(
        await owner.memberTokenRevocation.findFirstOrThrow({
          where: { customerId: alice.customer_id },
        }),
      ).toMatchObject({ licenseId: fx.a.licenseId, revokedBy: fx.a.ownerAccountId });
    });

    it('refuses a token signed after a revocation when its run began before it', async () => {
      // The race a mint can lose: it read the token before the revocation
      // committed and re-signed it after. The re-signed token carries the run's
      // start, and that is what the revocation is compared against.
      const member = await firstVisit();
      const runStart = claimsOf(member.member_token!).oat;
      await server.post(
        `/customers/${member.customer_id}/revoke-member-tokens`,
        undefined,
        auth(await admin(fx.a)),
      );
      const now = await dbNow();
      const resignedLate = await forge(fx.a, {
        sub: member.customer_id,
        did: claimsOf(member.member_token!).did,
        oat: runStart,
        iat: now,
        exp: now + 3_600_000,
      });

      expect((await returning(fx.a, resignedLate)).customer_id).not.toBe(member.customer_id);
    });

    it('lets the browser that was forgotten start again, and recognises it from then on', async () => {
      const member = await firstVisit();
      await server.post(
        `/customers/${member.customer_id}/revoke-member-tokens`,
        undefined,
        auth(await admin(fx.a)),
      );
      const fresh = await returning(fx.a, member.member_token!);
      expect(fresh.customer_id).not.toBe(member.customer_id);
      expect((await returning(fx.a, fresh.member_token!)).customer_id).toBe(fresh.customer_id);
    });

    it('forgets every returning visitor at once (revoke-all)', async () => {
      const alice = await firstVisit();
      const bob = await firstVisit();

      const response = await server.post(
        '/settings/member-recognition/revoke-all',
        undefined,
        auth(await admin(fx.a)),
      );
      expect(response.statusCode).toBe(200);
      const view = response.json() as { tokens_revoked_before: string | null };
      expect(view.tokens_revoked_before).toEqual(expect.any(String));

      for (const member of [alice, bob]) {
        expect((await returning(fx.a, member.member_token!)).customer_id).not.toBe(
          member.customer_id,
        );
      }
      // A visitor after it starts fresh and is recognised when they return.
      const later = await firstVisit();
      expect((await returning(fx.a, later.member_token!)).customer_id).toBe(later.customer_id);

      const [entry] = await owner.auditLogEntry.findMany({
        where: { licenseId: fx.a.licenseId, action: 'member_tokens.revoked' },
      });
      expect(entry?.metadata).toMatchObject({ scope: 'all' });
    });

    it("leaves another licence's members alone (NFR-S4)", async () => {
      const ours = await firstVisit(fx.a);
      const theirs = await firstVisit(fx.b);
      await server.post(
        '/settings/member-recognition/revoke-all',
        undefined,
        auth(await admin(fx.b)),
      );

      expect((await returning(fx.a, ours.member_token!)).customer_id).toBe(ours.customer_id);
      expect((await returning(fx.b, theirs.member_token!)).customer_id).not.toBe(
        theirs.customer_id,
      );
    });
  });

  describe('rotation', () => {
    it('accepts the replaced key through its grace period, moving members onto the new key (NFR-S2)', async () => {
      const member = await firstVisit();
      const rotated = await server.post(
        '/settings/member-recognition/rotate-key',
        { grace_period_seconds: 3600 },
        auth(await admin(fx.a)),
      );
      expect(rotated.statusCode).toBe(200);
      const view = rotated.json() as {
        key: { version: number; previous_version: number | null; previous_valid_until: string };
      };
      expect(view.key).toMatchObject({ version: 2, previous_version: 1 });
      // Never the key, in any form.
      expect(JSON.stringify(view)).not.toMatch(/v1:|ciphertext/);

      const back = await returning(fx.a, member.member_token!);
      expect(back.customer_id).toBe(member.customer_id);
      expect(back.member_token).toMatch(/^nxm1\.2\./);

      // Once the window closes, a token the old key signed is refused.
      await owner.memberTokenKey.update({
        where: { licenseId: fx.a.licenseId },
        data: { previousKeyValidUntil: new Date(Date.now() - 86_400_000) },
      });
      const from = sink.lines.length;
      expect((await returning(fx.a, member.member_token!)).customer_id).not.toBe(
        member.customer_id,
      );
      expect(refusals(from).map((line) => line.reason)).toEqual(['key_retired']);
      // The member who came back in time is still recognised.
      expect((await returning(fx.a, back.member_token!)).customer_id).toBe(member.customer_id);

      const [entry] = await owner.auditLogEntry.findMany({
        where: { licenseId: fx.a.licenseId, action: 'member_token_key.rotated' },
      });
      expect(entry?.metadata).toMatchObject({
        version: 2,
        previous_version: 1,
        grace_period_seconds: 3600,
      });
    });

    it('retires the old key at once with a grace of 0 — the emergency rotation', async () => {
      const member = await firstVisit();
      const response = await server.post(
        '/settings/member-recognition/rotate-key',
        { grace_period_seconds: 0 },
        auth(await admin(fx.a)),
      );
      expect((response.json() as { key: unknown }).key).toMatchObject({
        version: 2,
        previous_version: null,
        previous_valid_until: null,
      });
      const from = sink.lines.length;
      expect((await returning(fx.a, member.member_token!)).customer_id).not.toBe(
        member.customer_id,
      );
      expect(refusals(from).map((line) => line.reason)).toEqual(['unknown_key']);
    });

    it('rotates with the default 7-day grace when no body is sent, and drops the oldest key on a second rotation', async () => {
      const member = await firstVisit();
      const token = await admin(fx.a);
      const first = await server.post(
        '/settings/member-recognition/rotate-key',
        undefined,
        auth(token),
      );
      const firstView = first.json() as { key: { previous_valid_until: string } };
      const grace = Date.parse(firstView.key.previous_valid_until) - (await dbNow());
      expect(grace).toBeGreaterThan(7 * 86_400_000 - 120_000);
      expect(grace).toBeLessThanOrEqual(7 * 86_400_000);

      await server.post('/settings/member-recognition/rotate-key', undefined, auth(token));
      // Version 1 is gone: the one previous slot now holds version 2.
      expect((await returning(fx.a, member.member_token!)).customer_id).not.toBe(
        member.customer_id,
      );
    });

    it('creates the first key on a rotation before any visitor came', async () => {
      const response = await server.post(
        '/settings/member-recognition/rotate-key',
        undefined,
        auth(await admin(fx.a)),
      );
      expect((response.json() as { key: unknown }).key).toMatchObject({
        version: 1,
        previous_version: null,
      });
      const member = await firstVisit();
      expect(member.member_token).toMatch(/^nxm1\.1\./);
    });

    it('replaces a key that no longer opens, and its members start again', async () => {
      const member = await firstVisit();
      // What a changed CUSTOMER_TOKEN_SECRET looks like from here: the stored
      // key is sealed under something else.
      const other = new MemberTokenCodec('a-different-customer-token-secret-0123456789');
      await owner.memberTokenKey.update({
        where: { licenseId: fx.a.licenseId },
        data: { keyCiphertext: other.sealKey(fx.a.licenseId, 1, Buffer.alloc(32, 7)) },
      });

      const answer = await returning(fx.a, member.member_token!);
      expect(answer.customer_id).not.toBe(member.customer_id);
      expect(answer.member_token).toMatch(/^nxm1\.2\./);
      expect(
        sink.lines.some((line) => line.includes('signing key could not be opened; replaced it')),
      ).toBe(true);
      expect((await returning(fx.a, answer.member_token!)).customer_id).toBe(answer.customer_id);
    });
  });

  // ==========================================================================
  // The transition: a bare id from before member tokens, traded in once
  // ==========================================================================

  describe('the transition from the bare customer_id', () => {
    async function openWindow(customerId: string, interval = "interval '1 hour'") {
      await owner.$executeRawUnsafe(
        `UPDATE customers SET member_adoptable_until = clock_timestamp() + ${interval} WHERE id = $1::uuid`,
        customerId,
      );
    }

    it('trades the id of a customer from before member tokens in once, inside the window (NFR-S5)', async () => {
      await openWindow(fx.a.customerId);

      const adopted = (await mint(fx.a, { customer_id: fx.a.customerId })).json() as Minted;
      expect(adopted.customer_id).toBe(fx.a.customerId);
      expect(adopted.member_token).toBeTruthy();
      expect(
        (await owner.customer.findUniqueOrThrow({ where: { id: fx.a.customerId } }))
          .memberAdoptableUntil,
      ).toBeNull();

      // Never twice: the id alone reaches nobody now, the token does.
      const again = (await mint(fx.a, { customer_id: fx.a.customerId })).json() as Minted;
      expect(again.customer_id).not.toBe(fx.a.customerId);
      expect((await returning(fx.a, adopted.member_token!)).customer_id).toBe(fx.a.customerId);
    });

    it('refuses the id once the window has closed', async () => {
      await openWindow(fx.a.customerId, "interval '-1 second'");
      const answer = (await mint(fx.a, { customer_id: fx.a.customerId })).json() as Minted;
      expect(answer.customer_id).not.toBe(fx.a.customerId);
    });

    it('lets one of two requests racing for the same id win, never both', async () => {
      await openWindow(fx.a.customerId);
      const answers = await Promise.all([
        mint(fx.a, { customer_id: fx.a.customerId }),
        mint(fx.a, { customer_id: fx.a.customerId }),
        mint(fx.a, { customer_id: fx.a.customerId }),
      ]);
      const reached = answers.filter(
        (answer) => (answer.json() as Minted).customer_id === fx.a.customerId,
      );
      expect(answers.map((answer) => answer.statusCode)).toEqual([200, 200, 200]);
      expect(reached).toHaveLength(1);
    });

    it("never adopts another organization's customer (NFR-S4)", async () => {
      await openWindow(fx.b.customerId);
      const answer = (await mint(fx.a, { customer_id: fx.b.customerId })).json() as Minted;
      expect(answer.customer_id).not.toBe(fx.b.customerId);
      // B's window is still open for B's own widget.
      expect(
        (await owner.customer.findUniqueOrThrow({ where: { id: fx.b.customerId } }))
          .memberAdoptableUntil,
      ).not.toBeNull();
    });

    it("closes a member's window when their tokens are revoked, and everyone's on revoke-all", async () => {
      await openWindow(fx.a.customerId);
      const second = await owner.customer.create({
        data: { organizationId: fx.a.organizationId },
        select: { id: true },
      });
      await openWindow(second.id);
      const token = await admin(fx.a);

      await server.post(
        `/customers/${fx.a.customerId}/revoke-member-tokens`,
        undefined,
        auth(token),
      );
      expect(
        ((await mint(fx.a, { customer_id: fx.a.customerId })).json() as Minted).customer_id,
      ).not.toBe(fx.a.customerId);

      await server.post('/settings/member-recognition/revoke-all', undefined, auth(token));
      expect(
        ((await mint(fx.a, { customer_id: second.id })).json() as Minted).customer_id,
      ).not.toBe(second.id);
    });

    it('lays the window on the customers that exist at deploy time only — never a channel customer, never a new one', async () => {
      // Replays the migration inside a transaction that is thrown away, so the
      // column's "fast default" is seen doing what the migration relies on.
      const sql = readFileSync(
        join(
          process.cwd(),
          'prisma',
          'migrations',
          '20261016090000_member_adoption',
          'migration.sql',
        ),
        'utf8',
      )
        .split('\n')
        .filter((line) => !line.trimStart().startsWith('--'))
        .join('\n');
      const statements = sql
        .split(';')
        .map((statement) => statement.trim())
        .filter(Boolean);
      expect(statements).toHaveLength(3);

      const channelCustomer = await owner.customer.create({
        data: { organizationId: fx.a.organizationId },
        select: { id: true },
      });
      await owner.channelIdentity.create({
        data: {
          licenseId: fx.a.licenseId,
          channelType: 'email',
          externalId: 'reader@example.test',
          customerId: channelCustomer.id,
        },
      });

      class RolledBack extends Error {}
      let seen: Record<string, Date | null> = {};
      await owner
        .$transaction(async (tx) => {
          await tx.$executeRawUnsafe('ALTER TABLE customers DROP COLUMN member_adoptable_until');
          for (const statement of statements) await tx.$executeRawUnsafe(statement);
          const created = await tx.customer.create({
            data: { organizationId: fx.a.organizationId },
            select: { id: true },
          });
          const rows = await tx.$queryRaw<Array<{ id: string; until: Date | null; now: Date }>>`
            SELECT id, member_adoptable_until AS until, now() AS now FROM customers
            WHERE id IN (${fx.a.customerId}::uuid, ${channelCustomer.id}::uuid, ${created.id}::uuid)`;
          seen = Object.fromEntries(rows.map((row) => [row.id, row.until]));
          const now = rows[0]!.now.getTime();
          expect(seen[fx.a.customerId]!.getTime() - now).toBe(30 * 86_400_000);
          expect(seen[channelCustomer.id]).toBeNull();
          expect(seen[created.id]).toBeNull();
          throw new RolledBack();
        })
        .catch((error: unknown) => {
          if (!(error instanceof RolledBack)) throw error;
        });
      expect(Object.keys(seen)).toHaveLength(3);
    });
  });

  // ==========================================================================
  // A banned member
  // ==========================================================================

  describe('a banned member', () => {
    it('is refused when their token names them; a bare id never says so', async () => {
      const member = await firstVisit();
      await owner.customer.update({
        where: { id: member.customer_id },
        data: { bannedAt: new Date() },
      });

      const refused = await mint(fx.a, { member_token: member.member_token });
      expect(refused.statusCode).toBe(403);
      expect((refused.json() as { error: { type: string } }).error.type).toBe('customer_banned');

      // The id alone reaches nobody — banned or not, it reads as a first visit.
      const probe = await mint(fx.a, { customer_id: member.customer_id });
      expect(probe.statusCode).toBe(200);
    });

    it('keeps the window of a banned customer closed to adoption, and unspent', async () => {
      await owner.customer.update({
        where: { id: fx.a.customerId },
        data: { bannedAt: new Date() },
      });
      await owner.$executeRaw`
        UPDATE customers SET member_adoptable_until = clock_timestamp() + interval '1 hour'
        WHERE id = ${fx.a.customerId}::uuid`;

      const refused = await mint(fx.a, { customer_id: fx.a.customerId });
      expect(refused.statusCode).toBe(403);
      // Rolled back with the refusal: the adoption did not happen.
      expect(
        (await owner.customer.findUniqueOrThrow({ where: { id: fx.a.customerId } }))
          .memberAdoptableUntil,
      ).not.toBeNull();
    });
  });

  // ==========================================================================
  // Settings › Security › Member recognition
  // ==========================================================================

  describe('settings', () => {
    it('reads the defaults, and reading creates nothing — not even a key', async () => {
      const response = await server.get('/settings/member-recognition', auth(await admin(fx.a)));
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        token_ttl_seconds: MEMBER_TOKEN_TTL.defaultSeconds,
        possible_matches_enabled: true,
        key: null,
        tokens_revoked_before: null,
        updated_at: null,
      });
      expect(await owner.memberTokenKey.count()).toBe(0);
      expect(await owner.memberRecognitionSettings.count()).toBe(0);
    });

    it('changes the lifetime, which the next visit is signed for; audited with both values', async () => {
      const token = await admin(fx.a);
      const response = await server.patch(
        '/settings/member-recognition',
        { token_ttl_seconds: MEMBER_TOKEN_TTL.minSeconds, possible_matches_enabled: false },
        auth(token),
      );
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        token_ttl_seconds: MEMBER_TOKEN_TTL.minSeconds,
        possible_matches_enabled: false,
        updated_at: expect.any(String),
      });

      const before = await dbNow();
      const minted = await mint(fx.a);
      const expires = Date.parse((minted.json() as Minted).member_token_expires_at);
      expect(expires - before).toBeGreaterThanOrEqual(MEMBER_TOKEN_TTL.minSeconds * 1000);
      expect(expires - before).toBeLessThan(MEMBER_TOKEN_TTL.minSeconds * 1000 + 60_000);
      expect(String(minted.headers['set-cookie'])).toContain(
        `Max-Age=${MEMBER_TOKEN_TTL.minSeconds};`,
      );

      const [entry] = await owner.auditLogEntry.findMany({
        where: { licenseId: fx.a.licenseId, action: 'settings.security_updated' },
      });
      expect(entry?.metadata).toMatchObject({
        resource: 'member_recognition',
        fields: ['token_ttl_seconds', 'possible_matches_enabled'],
        ttl_seconds_before: MEMBER_TOKEN_TTL.defaultSeconds,
        ttl_seconds_after: MEMBER_TOKEN_TTL.minSeconds,
        possible_matches_before: true,
        possible_matches_after: false,
      });
    });

    it.each([
      [{ token_ttl_seconds: MEMBER_TOKEN_TTL.minSeconds - 1 }],
      [{ token_ttl_seconds: MEMBER_TOKEN_TTL.maxSeconds + 1 }],
      [{ token_ttl_seconds: 90_000.5 }],
      [{}],
    ])('refuses %j', async (body) => {
      const response = await server.patch(
        '/settings/member-recognition',
        body,
        auth(await admin(fx.a)),
      );
      expect(response.statusCode).toBe(400);
    });

    it.each([[-1], [30 * 86_400 + 1]])('refuses a grace period of %d seconds', async (grace) => {
      const response = await server.post(
        '/settings/member-recognition/rotate-key',
        { grace_period_seconds: grace },
        auth(await admin(fx.a)),
      );
      expect(response.statusCode).toBe(400);
    });

    it('refuses an agent-role holder even with the scopes, and a reader on the writes (NFR-S3)', async () => {
      const agent = await grantToken(owner, {
        licenseId: fx.a.licenseId,
        organizationId: fx.a.organizationId,
        ownerId: fx.a.agentAccountId,
        scopes: ['access_rules:rw'],
      });
      const reader = await admin(fx.a, ['access_rules:ro']);

      expect((await server.get('/settings/member-recognition', auth(agent))).statusCode).toBe(403);
      expect((await server.get('/settings/member-recognition', auth(reader))).statusCode).toBe(200);
      for (const [method, path] of [
        ['patch', '/settings/member-recognition'],
        ['post', '/settings/member-recognition/rotate-key'],
        ['post', '/settings/member-recognition/revoke-all'],
      ] as const) {
        for (const token of [agent, reader]) {
          const response =
            method === 'patch'
              ? await server.patch(path, { possible_matches_enabled: false }, auth(token))
              : await server.post(path, undefined, auth(token));
          expect(response.statusCode).toBe(403);
        }
      }
      expect(await owner.memberTokenRevocation.count()).toBe(0);
      expect(await owner.memberTokenKey.count()).toBe(0);
    });

    it('shows each licence only its own key and revocations (NFR-S4)', async () => {
      await firstVisit(fx.b);
      await server.post(
        '/settings/member-recognition/revoke-all',
        undefined,
        auth(await admin(fx.b)),
      );

      const ours = await server.get('/settings/member-recognition', auth(await admin(fx.a)));
      expect(ours.json()).toMatchObject({ key: null, tokens_revoked_before: null });
    });
  });

  describe("forgetting one member's browsers", () => {
    it("answers 404 for another organization's customer, and changes nothing there (NFR-S4 · NFR-S5)", async () => {
      const theirs = await firstVisit(fx.b);
      const response = await server.post(
        `/customers/${theirs.customer_id}/revoke-member-tokens`,
        undefined,
        auth(await admin(fx.a)),
      );
      expect(response.statusCode).toBe(404);
      expect(await owner.memberTokenRevocation.count()).toBe(0);
      expect((await returning(fx.b, theirs.member_token!)).customer_id).toBe(theirs.customer_id);
    });

    it('needs customers:rw (NFR-S3)', async () => {
      const member = await firstVisit();
      const reader = await admin(fx.a, ['customers:ro']);
      const response = await server.post(
        `/customers/${member.customer_id}/revoke-member-tokens`,
        undefined,
        auth(reader),
      );
      expect(response.statusCode).toBe(403);
      expect((await returning(fx.a, member.member_token!)).customer_id).toBe(member.customer_id);
    });

    it('refuses a customer token outright', async () => {
      const member = await firstVisit();
      const response = await server.post(
        `/customers/${member.customer_id}/revoke-member-tokens`,
        undefined,
        auth(member.token),
      );
      expect([401, 403, 404]).toContain(response.statusCode);
      expect(await owner.memberTokenRevocation.count()).toBe(0);
    });
  });
});
