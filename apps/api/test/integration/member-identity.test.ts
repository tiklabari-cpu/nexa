/**
 * Operator-signed member identity — the operator's way in to member
 * recognition (SiyahTuş analysis ID-03 · owner decision K28 · tm 388).
 *
 * The operator's server signs the logged-in member's id with the workspace's
 * identity secret, the page hands it to `siyahtus('identify', …)`, and the
 * widget sends it with `POST /customer/token` as `identity`. Pinned here,
 * against the real server, Postgres and Redis:
 *
 *   - **Off by default, K4 unchanged.** Until the switch is on and a secret
 *     issued, an identity is ignored: the same customer, the same answer, the
 *     refusal counted as `disabled`.
 *   - **A valid signature** makes the visitor the member on every device —
 *     one customer, verified, the same day's conversation; the first time it
 *     takes the browser's own record, never another member's; two devices at
 *     once land on one record; the signed username fills the record and the
 *     pre-chat form stops asking for it.
 *   - **Every refusal is ignored, never answered** — wrong secret, a changed
 *     field, too old, too far ahead, malformed, used before: answered exactly
 *     like no identity, logged with the reason and counted, naming nobody. The
 *     same browser re-sending its own signature is not a replay anyone hears of.
 *   - **Workspaces apart**: the same member id in two workspaces is two people.
 *   - **Rotation**: the replaced secret is accepted for its grace period, not
 *     after; with no grace, not at all.
 *   - **The secret** is shown once — never in a read, the audit trail, the log
 *     or the database in the clear — and only an admin issues it.
 */
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { memberTokenCookieName, SIGNED_IDENTITY_LIMITS } from '@siyahtus/types';
import { withTenant } from '../../src/lib/tenant.js';
import { newIdentitySecret } from '../../src/services/auth/member-identity.js';
import {
  grantToken,
  ownerClient,
  seedFixtures,
  testEnv,
  type Fixtures,
  type TenantFixture,
} from '../helpers/fixtures.js';
import {
  dbSeconds,
  enableSignedIdentity,
  securityAdmin,
  signedIdentity,
  type SignedIdentityPayload,
} from '../helpers/member-identity.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

const APP_URL = process.env['DATABASE_APP_URL'];

interface Minted {
  token: string;
  customer_id: string;
  member_token?: string;
  identity_verified: boolean;
  prechat: { enabled: boolean; fields: Record<string, { visible: boolean; required: boolean }> };
}

interface Settings {
  signed_identity: {
    enabled: boolean;
    active: boolean;
    secret: {
      version: number;
      created_at: string;
      previous_version: number | null;
      previous_valid_until: string | null;
    } | null;
    recent: { days: number; verified: number; refused: Record<string, number> } | null;
  };
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

const IGNORED = 'signed identity refused; ignored';

describe('operator-signed member identity (ID-03 · K28)', () => {
  let server: TestServer;
  let owner: PrismaClient;
  let app: PrismaClient;
  let fx: Fixtures;
  const sink = new LineSink();
  let nextUser = 1;
  /** A member id no other test signed, so no replay record is shared. */
  const freshUser = () => `player-${Date.now().toString(36)}-${nextUser++}`;

  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

  function mint(
    tenant: TenantFixture,
    body: Record<string, unknown> = {},
    headers: Record<string, string> = {},
  ) {
    return server.post(
      '/customer/token',
      { organization_id: tenant.organizationId, ...body },
      { origin: `https://${tenant.trustedDomain}`, ...headers },
    );
  }

  async function minted(
    tenant: TenantFixture,
    body: Record<string, unknown> = {},
    headers: Record<string, string> = {},
  ): Promise<Minted> {
    const response = await mint(tenant, body, headers);
    expect(response.statusCode, response.body).toBe(200);
    return response.json() as Minted;
  }

  async function sign(
    secret: string,
    fields: { userId: string; username?: string; email?: string; ts?: number },
  ): Promise<SignedIdentityPayload> {
    return signedIdentity(secret, { ...fields, ts: fields.ts ?? (await dbSeconds(owner)) });
  }

  /** The reasons of the identity refusals logged since `from`. */
  function ignored(from: number): string[] {
    return sink.lines
      .slice(from)
      .map((line) => JSON.parse(line) as { msg?: string; reason?: string })
      .filter((line) => line.msg === IGNORED)
      .map((line) => line.reason!);
  }

  async function settings(tenant: TenantFixture): Promise<Settings> {
    const response = await server.get(
      '/settings/member-recognition',
      bearer(await securityAdmin(owner, tenant)),
    );
    expect(response.statusCode, response.body).toBe(200);
    return response.json() as Settings;
  }

  async function customer(id: string) {
    return owner.customer.findUniqueOrThrow({
      where: { id },
      select: {
        organizationId: true,
        platformUserId: true,
        identityVerifiedAt: true,
        username: true,
        usernameVerified: true,
        email: true,
      },
    });
  }

  beforeAll(async () => {
    owner = ownerClient();
    app = new PrismaClient({ datasourceUrl: APP_URL });
    server = await startTestServer(
      { LOG_LEVEL: 'warn' },
      { logStream: sink as unknown as NodeJS.WritableStream },
    );
  });

  afterAll(async () => {
    await server.close();
    await app.$disconnect();
    await owner.$disconnect();
  });

  beforeEach(async () => {
    fx = await seedFixtures(owner);
    await clearRateLimits(server.app);
    // The outcome counts this file asserts live in Redis per licence and day,
    // and `seedFixtures` hands out the same licence ids every time — so an
    // identity signed for workspace A by an earlier file in the same run
    // (`captcha-challenge.test.ts` signs one) was counted here as well. Found
    // when a new file reshuffled the shards and put the two together (tm 407).
    const stats = await server.app.redis.keys('member-identity:stats:*');
    if (stats.length > 0) await server.app.redis.del(...stats);
  });

  // ==========================================================================
  // Off by default
  // ==========================================================================

  describe('off by default (K4 unchanged)', () => {
    it('ignores an identity while the workspace has not turned it on: the same customer, the same answer, counted', async () => {
      const first = await minted(fx.a);
      // Signed correctly, with a secret this workspace never issued — there is
      // nothing to check it against, and nothing changes.
      const identity = await sign(newIdentitySecret(), { userId: freshUser() });
      const from = sink.lines.length;

      const plain = await minted(fx.a, { member_token: first.member_token });
      const withIdentity = await minted(fx.a, { member_token: first.member_token, identity });

      expect(withIdentity.customer_id).toBe(first.customer_id);
      expect(plain.customer_id).toBe(first.customer_id);
      expect(Object.keys(withIdentity).sort()).toEqual(Object.keys(plain).sort());
      expect(withIdentity.identity_verified).toBe(false);
      expect(withIdentity.prechat).toEqual(plain.prechat);
      expect(ignored(from)).toEqual(['disabled']);
      expect(await customer(first.customer_id)).toMatchObject({
        platformUserId: null,
        identityVerifiedAt: null,
        usernameVerified: false,
      });

      const view = await settings(fx.a);
      expect(view.signed_identity).toMatchObject({ enabled: false, active: false, secret: null });
      expect(view.signed_identity.recent).toMatchObject({ days: 7, verified: 0 });
      expect(view.signed_identity.recent!.refused['disabled']).toBe(1);
    });

    it('still ignores it with the switch on and no secret issued', async () => {
      const admin = bearer(await securityAdmin(owner, fx.a));
      const on = await server.patch(
        '/settings/member-recognition',
        { signed_identity_enabled: true },
        admin,
      );
      expect(on.statusCode, on.body).toBe(200);
      expect((on.json() as Settings).signed_identity).toMatchObject({
        enabled: true,
        active: false,
        secret: null,
      });

      const from = sink.lines.length;
      const visit = await minted(fx.a, {
        identity: await sign(newIdentitySecret(), { userId: freshUser() }),
      });
      expect(visit.identity_verified).toBe(false);
      expect(ignored(from)).toEqual(['disabled']);
    });
  });

  // ==========================================================================
  // A valid signature
  // ==========================================================================

  describe('a valid signature', () => {
    it('makes the visitor the member on every device: one verified customer and the same day’s conversation', async () => {
      const secret = await enableSignedIdentity(server, owner, fx.a);
      const userId = freshUser();

      const phone = await minted(fx.a, {
        identity: await sign(secret, { userId, username: 'ayse_k', email: 'ayse@example.test' }),
      });
      expect(phone.identity_verified).toBe(true);
      const record = await customer(phone.customer_id);
      expect(record).toMatchObject({
        platformUserId: userId,
        username: 'ayse_k',
        usernameVerified: true,
        email: 'ayse@example.test',
      });
      expect(record.identityVerifiedAt).toBeInstanceOf(Date);

      const opened = await server.post(
        '/customer/chat/events',
        { text: 'Yatırımım görünmüyor' },
        bearer(phone.token),
      );
      expect(opened.statusCode, opened.body).toBe(201);
      const chatId = (opened.json() as { chat_id: string }).chat_id;

      // Another device, no member token of its own: a fresh signature for the
      // same member is the same customer, and the day's conversation with it.
      const laptop = await minted(fx.a, { identity: await sign(secret, { userId }) });
      expect(laptop.customer_id).toBe(phone.customer_id);
      expect(laptop.identity_verified).toBe(true);
      const again = await server.post(
        '/customer/chat/events',
        { text: 'Bilgisayardan yazıyorum' },
        bearer(laptop.token),
      );
      expect(again.statusCode, again.body).toBe(201);
      expect((again.json() as { chat_id: string }).chat_id).toBe(chatId);
      // A signature without a username leaves the signed one in place.
      expect(await customer(phone.customer_id)).toMatchObject({
        username: 'ayse_k',
        usernameVerified: true,
      });
      expect(
        await owner.customer.count({
          where: { organizationId: fx.a.organizationId, platformUserId: userId },
        }),
      ).toBe(1);

      expect((await settings(fx.a)).signed_identity.recent?.verified).toBe(2);
    });

    it('the first time, takes the browser’s own record — and never another member’s', async () => {
      const secret = await enableSignedIdentity(server, owner, fx.a);
      const anonymous = await minted(fx.a);
      const first = freshUser();

      const signedIn = await minted(fx.a, {
        member_token: anonymous.member_token,
        identity: await sign(secret, { userId: first }),
      });
      expect(signedIn.customer_id).toBe(anonymous.customer_id);
      expect((await customer(anonymous.customer_id)).platformUserId).toBe(first);

      // The same browser, another member signing in (a shared computer): their
      // own record, and the first member's keeps its id.
      const second = freshUser();
      const other = await minted(fx.a, {
        member_token: signedIn.member_token,
        identity: await sign(secret, { userId: second }),
      });
      expect(other.customer_id).not.toBe(anonymous.customer_id);
      expect((await customer(other.customer_id)).platformUserId).toBe(second);
      expect((await customer(anonymous.customer_id)).platformUserId).toBe(first);

      // The browser's token now names the second member.
      const back = await minted(fx.a, { member_token: other.member_token });
      expect(back.customer_id).toBe(other.customer_id);
      expect(back.identity_verified).toBe(true);
    });

    it('stops the pre-chat form asking a member for the username the operator signed, and a typed one does not replace it (WG-01)', async () => {
      const secret = await enableSignedIdentity(server, owner, fx.a);
      const signed = await minted(fx.a, {
        identity: await sign(secret, { userId: freshUser(), username: 'imzali_ad' }),
      });
      expect(signed.prechat.fields['username']).toEqual({ visible: false, required: false });

      const opened = await server.post(
        '/customer/chat/events',
        { text: 'Merhaba', username: 'yazilan_ad', name: 'Ayşe' },
        bearer(signed.token),
      );
      expect(opened.statusCode, opened.body).toBe(201);
      expect(await customer(signed.customer_id)).toMatchObject({
        username: 'imzali_ad',
        usernameVerified: true,
      });

      // Without a signed username the brand's form is the form.
      const plain = await minted(fx.a, { identity: await sign(secret, { userId: freshUser() }) });
      expect(plain.prechat.fields['username']).toMatchObject({ visible: true });
    });

    it('lands two devices signing in at once on one record', async () => {
      const secret = await enableSignedIdentity(server, owner, fx.a);
      const userId = freshUser();
      const now = await dbSeconds(owner);
      const [a, b] = await Promise.all([
        minted(fx.a, { identity: signedIdentity(secret, { userId, ts: now }) }),
        minted(fx.a, { identity: signedIdentity(secret, { userId, ts: now - 1 }) }),
      ]);
      expect(a.customer_id).toBe(b.customer_id);
      expect(
        await owner.customer.count({
          where: { organizationId: fx.a.organizationId, platformUserId: userId },
        }),
      ).toBe(1);
    });

    it('tells a banned member they are banned — they proved who they are', async () => {
      const secret = await enableSignedIdentity(server, owner, fx.a);
      const userId = freshUser();
      const member = await minted(fx.a, { identity: await sign(secret, { userId }) });
      await owner.customer.update({
        where: { id: member.customer_id },
        data: { bannedAt: new Date() },
      });
      const again = await mint(fx.a, {
        identity: await sign(secret, { userId, ts: (await dbSeconds(owner)) - 2 }),
      });
      expect(again.statusCode).toBe(403);
      expect(again.json()).toMatchObject({ error: { type: 'customer_banned' } });
    });
  });

  // ==========================================================================
  // Refusals
  // ==========================================================================

  describe('every refusal is ignored, never answered', () => {
    it('answers a wrong, changed, stale, early, malformed or replayed identity exactly like none — logged and counted, naming nobody (NFR-S2)', async () => {
      const secret = await enableSignedIdentity(server, owner, fx.a);
      const browser = await minted(fx.a);
      const baseline = await minted(fx.a, { member_token: browser.member_token });
      const userId = freshUser();
      const now = await dbSeconds(owner);

      const used = signedIdentity(secret, { userId, ts: now });
      // Spent once, by another browser — the next presentation is a replay.
      expect((await minted(fx.a, { identity: used })).identity_verified).toBe(true);

      const changed = { ...signedIdentity(secret, { userId, username: 'ali', ts: now }) };
      changed.username = 'veli';
      const cases: Array<[string, unknown]> = [
        ['bad_signature', signedIdentity(newIdentitySecret(), { userId, ts: now })],
        ['bad_signature', changed],
        [
          'expired',
          signedIdentity(secret, { userId, ts: now - SIGNED_IDENTITY_LIMITS.maxAgeSeconds - 5 }),
        ],
        [
          'future',
          signedIdentity(secret, {
            userId,
            ts: now + SIGNED_IDENTITY_LIMITS.maxFutureSkewSeconds + 30,
          }),
        ],
        ['malformed', { user_id: userId, ts: now }],
        ['malformed', 'not-an-object'],
        ['replayed', used],
      ];

      const from = sink.lines.length;
      for (const [reason, identity] of cases) {
        const response = await mint(fx.a, { member_token: browser.member_token, identity });
        expect(response.statusCode, reason).toBe(200);
        const body = response.json() as Minted;
        expect(body.customer_id, reason).toBe(browser.customer_id);
        expect(body.identity_verified, reason).toBe(false);
        expect(Object.keys(body).sort(), reason).toEqual(Object.keys(baseline).sort());
      }
      expect(ignored(from)).toEqual(cases.map(([reason]) => reason));
      expect(await customer(browser.customer_id)).toMatchObject({ platformUserId: null });

      // The lines say why, never who: no member id, no signature, no secret.
      const logged = sink.lines.slice(from).join('\n');
      expect(logged).not.toContain(userId);
      expect(logged).not.toContain(used.user_hash);
      expect(logged).not.toContain(secret);

      const refused = (await settings(fx.a)).signed_identity.recent!.refused;
      expect(refused).toMatchObject({
        bad_signature: 2,
        expired: 1,
        future: 1,
        malformed: 2,
        replayed: 1,
      });
    });

    it('lets the same browser send its own signature again without a refusal — a re-mint in the page that used it', async () => {
      const secret = await enableSignedIdentity(server, owner, fx.a);
      const identity = await sign(secret, { userId: freshUser() });
      const first = await minted(fx.a, { identity });
      const from = sink.lines.length;
      const again = await minted(fx.a, { member_token: first.member_token, identity });
      expect(again.customer_id).toBe(first.customer_id);
      expect(again.identity_verified).toBe(true);
      expect(ignored(from)).toEqual([]);
    });

    it('keeps workspaces apart: the same member id is two people, and one workspace’s signature verifies nothing in another', async () => {
      const secretA = await enableSignedIdentity(server, owner, fx.a);
      const secretB = await enableSignedIdentity(server, owner, fx.b);
      const userId = freshUser();

      const inA = await minted(fx.a, { identity: await sign(secretA, { userId }) });
      const inB = await minted(fx.b, { identity: await sign(secretB, { userId }) });
      expect(inA.identity_verified && inB.identity_verified).toBe(true);
      expect(inB.customer_id).not.toBe(inA.customer_id);
      expect((await customer(inA.customer_id)).organizationId).toBe(fx.a.organizationId);
      expect((await customer(inB.customer_id)).organizationId).toBe(fx.b.organizationId);

      // A's signature at B's widget: B checks it against B's secret.
      const from = sink.lines.length;
      const crossed = await minted(fx.b, {
        identity: await sign(secretA, { userId: freshUser() }),
      });
      expect(crossed.identity_verified).toBe(false);
      expect(ignored(from)).toEqual(['bad_signature']);
    });
  });

  // ==========================================================================
  // Rotation
  // ==========================================================================

  describe('rotation', () => {
    it('accepts the replaced secret through its grace period, not after it, and not at all with no grace', async () => {
      const first = await enableSignedIdentity(server, owner, fx.a);
      const admin = bearer(await securityAdmin(owner, fx.a));

      const rotated = await server.post(
        '/settings/member-recognition/identity-secret',
        { grace_period_seconds: 86_400 },
        admin,
      );
      expect(rotated.statusCode, rotated.body).toBe(200);
      const second = (rotated.json() as { identity_secret: string }).identity_secret;
      expect(second).not.toBe(first);
      const view = rotated.json() as Settings;
      expect(view.signed_identity.secret).toMatchObject({ version: 2, previous_version: 1 });
      expect(view.signed_identity.secret!.previous_valid_until).not.toBeNull();

      // Inside the window both secrets sign members in.
      expect(
        (await minted(fx.a, { identity: await sign(first, { userId: freshUser() }) }))
          .identity_verified,
      ).toBe(true);
      expect(
        (await minted(fx.a, { identity: await sign(second, { userId: freshUser() }) }))
          .identity_verified,
      ).toBe(true);

      // The window closes (the database's clock): the old secret is refused.
      await owner.$executeRaw`
        UPDATE member_identity_secrets
        SET previous_secret_valid_until = clock_timestamp() - interval '1 second'
        WHERE license_id = ${fx.a.licenseId}`;
      let from = sink.lines.length;
      expect(
        (await minted(fx.a, { identity: await sign(first, { userId: freshUser() }) }))
          .identity_verified,
      ).toBe(false);
      expect(ignored(from)).toEqual(['bad_signature']);
      expect((await settings(fx.a)).signed_identity.secret).toMatchObject({
        version: 2,
        previous_version: null,
        previous_valid_until: null,
      });

      // An emergency rotation retires the current secret at once.
      const third = await server.post(
        '/settings/member-recognition/identity-secret',
        { grace_period_seconds: 0 },
        admin,
      );
      expect(third.statusCode, third.body).toBe(200);
      from = sink.lines.length;
      expect(
        (await minted(fx.a, { identity: await sign(second, { userId: freshUser() }) }))
          .identity_verified,
      ).toBe(false);
      expect(ignored(from)).toEqual(['bad_signature']);
      expect((third.json() as Settings).signed_identity.secret).toMatchObject({
        version: 3,
        previous_version: null,
      });
    });

    it('refuses a grace period outside 0–30 days', async () => {
      await enableSignedIdentity(server, owner, fx.a);
      const admin = bearer(await securityAdmin(owner, fx.a));
      for (const grace of [-1, 30 * 86_400 + 1, 1.5]) {
        const response = await server.post(
          '/settings/member-recognition/identity-secret',
          { grace_period_seconds: grace },
          admin,
        );
        expect(response.statusCode, String(grace)).toBe(400);
      }
    });
  });

  // ==========================================================================
  // The secret
  // ==========================================================================

  describe('the secret', () => {
    it('is shown once: never in a read, the audit trail, the log, or the database in the clear (NFR-S2)', async () => {
      const admin = bearer(await securityAdmin(owner, fx.a));
      const issued = await server.post('/settings/member-recognition/identity-secret', {}, admin);
      expect(issued.statusCode, issued.body).toBe(200);
      expect(issued.headers['cache-control']).toBe('no-store');
      const secret = (issued.json() as { identity_secret: string }).identity_secret;
      expect(secret).toMatch(/^sti_[A-Za-z0-9_-]{43}$/);
      // Issuing does not switch it on.
      expect((issued.json() as Settings).signed_identity).toMatchObject({
        enabled: false,
        active: false,
        secret: { version: 1, previous_version: null },
      });

      const read = await server.get('/settings/member-recognition', admin);
      expect(read.body).not.toContain(secret);

      const entry = await owner.auditLogEntry.findFirstOrThrow({
        where: { licenseId: fx.a.licenseId, action: 'member_identity_secret.rotated' },
      });
      expect(entry.metadata).toEqual({
        version: 1,
        previous_version: null,
        grace_period_seconds: 0,
        request_id: expect.any(String),
      });
      expect(JSON.stringify(entry.metadata)).not.toContain(secret);
      expect(entry.target).not.toContain(secret);

      const row = await owner.memberIdentitySecret.findUniqueOrThrow({
        where: { licenseId: fx.a.licenseId },
      });
      expect(row.secretCiphertext).toMatch(/^v1:/);
      expect(row.secretCiphertext).not.toContain(secret.slice(4));

      // A member signed in with it: still nowhere in the log.
      await server.patch('/settings/member-recognition', { signed_identity_enabled: true }, admin);
      const identity = await sign(secret, { userId: freshUser() });
      expect((await minted(fx.a, { identity })).identity_verified).toBe(true);
      const logged = sink.lines.join('\n');
      expect(logged).not.toContain(secret);
      expect(logged).not.toContain(identity.user_hash);
    });

    it('is an admin’s to issue and the switch an admin’s to turn, with access_rules:rw — audited with before and after', async () => {
      const agent = bearer(
        await grantToken(owner, {
          licenseId: fx.a.licenseId,
          organizationId: fx.a.organizationId,
          ownerId: fx.a.agentAccountId,
          scopes: ['access_rules:rw'],
        }),
      );
      const readOnly = bearer(
        await grantToken(owner, {
          licenseId: fx.a.licenseId,
          organizationId: fx.a.organizationId,
          ownerId: fx.a.ownerAccountId,
          scopes: ['access_rules:ro'],
        }),
      );
      for (const headers of [agent, readOnly]) {
        expect(
          (await server.post('/settings/member-recognition/identity-secret', {}, headers))
            .statusCode,
        ).toBe(403);
        expect(
          (
            await server.patch(
              '/settings/member-recognition',
              { signed_identity_enabled: true },
              headers,
            )
          ).statusCode,
        ).toBe(403);
      }
      expect(await owner.memberIdentitySecret.count({ where: { licenseId: fx.a.licenseId } })).toBe(
        0,
      );

      const admin = bearer(await securityAdmin(owner, fx.a));
      const on = await server.patch(
        '/settings/member-recognition',
        { signed_identity_enabled: true },
        admin,
      );
      expect(on.statusCode).toBe(200);
      const entry = await owner.auditLogEntry.findFirstOrThrow({
        where: { licenseId: fx.a.licenseId, action: 'settings.security_updated' },
        orderBy: { createdAt: 'desc' },
      });
      expect(entry.metadata).toMatchObject({
        resource: 'member_recognition',
        fields: ['signed_identity_enabled'],
        signed_identity_before: false,
        signed_identity_after: true,
      });
    });

    it('lives under row-level security: one licence never reads another’s, and the app role cannot delete it', async () => {
      await enableSignedIdentity(server, owner, fx.a);
      await enableSignedIdentity(server, owner, fx.b);
      const tenantA = { licenseId: fx.a.licenseId, organizationId: fx.a.organizationId };
      const visible = await withTenant(app, tenantA, (tx) =>
        tx.memberIdentitySecret.findMany({ select: { licenseId: true } }),
      );
      expect(visible).toEqual([{ licenseId: fx.a.licenseId }]);
      await expect(
        withTenant(
          app,
          tenantA,
          (tx) =>
            tx.$executeRaw`DELETE FROM member_identity_secrets WHERE license_id = ${fx.a.licenseId}`,
        ),
      ).rejects.toThrow(/permission denied/i);
      const policies = await owner.$queryRaw<Array<{ policyname: string }>>`
        SELECT policyname FROM pg_policies WHERE tablename = 'member_identity_secrets'`;
      expect(policies).toEqual([{ policyname: 'member_identity_secrets_tenant' }]);
    });

    it('refuses a raw secret or a half-kept previous slot at the database', async () => {
      await enableSignedIdentity(server, owner, fx.a);
      await expect(
        owner.$executeRaw`UPDATE member_identity_secrets SET secret_ciphertext = 'sti_raw'
          WHERE license_id = ${fx.a.licenseId}`,
      ).rejects.toThrow(/member_identity_secrets_sealed_check/);
      await expect(
        owner.$executeRaw`UPDATE member_identity_secrets SET previous_secret_version = 0
          WHERE license_id = ${fx.a.licenseId}`,
      ).rejects.toThrow(/member_identity_secrets_previous_check/);
      await expect(
        owner.$executeRaw`UPDATE customers SET platform_user_id = 'x'
          WHERE id = ${fx.a.customerId}::uuid`,
      ).rejects.toThrow(/customers_platform_identity_check/);
    });
  });

  it('keeps the member token cookie path: an identity at the cookie-carrying browser still verifies', async () => {
    const secret = await enableSignedIdentity(server, owner, fx.a);
    const first = await minted(fx.a);
    const cookie = `${memberTokenCookieName(fx.a.organizationId)}=${first.member_token}`;
    const signedIn = await minted(
      fx.a,
      { identity: await sign(secret, { userId: freshUser() }) },
      { cookie },
    );
    expect(signedIn.customer_id).toBe(first.customer_id);
    expect(signedIn.identity_verified).toBe(true);
    // The cookie carried the run on: no token in the body.
    expect(signedIn.member_token).toBeUndefined();
    expect(testEnv().CUSTOMER_TOKEN_SECRET.length).toBeGreaterThanOrEqual(32);
  });
});
