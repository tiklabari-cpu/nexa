/**
 * Push notifications to an agent's handsets (FR-MOD-13.7 · 13.7-d).
 *
 * The e-mail channel is addressed to something the recipient gave us; a push is
 * addressed to a *row we picked*, which makes target selection the only part of
 * the notification story that can deliver one workspace's customer conversation
 * to another workspace's phone. So the cases that carry their weight here are
 * the refusals: the person who turned push off, the handset that was signed out,
 * and above all the device on the other side of a tenant boundary.
 *
 * Proven with a real `FilePushProvider` on a temp directory, the way
 * `notifications.test.ts` proves the e-mail, because a mock's call log would
 * happily record a push addressed to the wrong device. The spool is partitioned
 * by license, so "did tenant B hear about tenant A's chat?" is asked as "is
 * tenant B's directory empty?" — a question a wrong answer cannot slip past.
 *
 * Run against real Postgres with RLS on: three of the four layers that keep the
 * selection inside one tenant are database behaviour.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PrismaClient } from '@prisma/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { grantToken, ownerClient, seedFixtures, type Fixtures } from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';
import { FileMailer } from '../../src/services/mail/mailer.js';
import { FilePushProvider } from '../../src/services/push/push-provider.js';

describe('agent push notifications', () => {
  let owner: PrismaClient;
  let server: TestServer;
  let push: FilePushProvider;
  let pushDir: string;
  let mailer: FileMailer;
  let mailDir: string;
  let fx: Fixtures;

  /** Workspace A's agent, the routing target and so the notified party. */
  const AGENT_PHONE = 'apns-token-workspace-a-phone';
  /** Workspace B's agent, who must never hear about any of it. */
  const OTHER_PHONE = 'fcm-token-workspace-b-phone';

  beforeAll(async () => {
    owner = ownerClient();
    pushDir = await mkdtemp(join(tmpdir(), 'nexa-push-int-'));
    mailDir = await mkdtemp(join(tmpdir(), 'nexa-push-mail-'));
    push = new FilePushProvider(pushDir);
    mailer = new FileMailer(mailDir);
    server = await startTestServer({}, { push, mailer });
  });

  afterAll(async () => {
    await server.close();
    await owner.$disconnect();
    await rm(pushDir, { recursive: true, force: true });
    await rm(mailDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    fx = await seedFixtures(owner);
    await clearRateLimits(server.app);
    await rm(pushDir, { recursive: true, force: true });
    await rm(mailDir, { recursive: true, force: true });

    // Route everything to a team the agent is on, so the first message is
    // assigned to a human — the only case that has a handset to address.
    const support = await owner.group.create({
      data: { licenseId: fx.a.licenseId, name: 'Support' },
      select: { id: true },
    });
    await owner.groupAgent.create({
      data: {
        licenseId: fx.a.licenseId,
        groupId: support.id,
        agentId: fx.a.agentAccountId,
        priority: 'normal',
      },
    });
    await owner.routingRule.create({
      data: {
        licenseId: fx.a.licenseId,
        kind: 'chat',
        isFallback: true,
        targetGroupId: support.id,
      },
    });

    // One handset per workspace. B's exists purely so that "nothing reached the
    // other tenant" is a claim about a registered, reachable device rather than
    // about a workspace that had nowhere to deliver to anyway.
    await registerDevice(fx.a.licenseId, fx.a.agentAccountId, AGENT_PHONE, 'ios');
    await registerDevice(fx.b.licenseId, fx.b.agentAccountId, OTHER_PHONE, 'android');
  });

  afterEach(async () => {
    await rm(pushDir, { recursive: true, force: true });
    await rm(mailDir, { recursive: true, force: true });
  });

  /** Seeded through the owner connection so revoked and cross-tenant rows are
   * as easy to set up as live ones; the endpoint itself is 13.7-c's test. */
  function registerDevice(
    licenseId: bigint,
    accountId: string,
    token: string,
    platform: 'ios' | 'android',
    revokedAt: Date | null = null,
  ): Promise<{ id: string }> {
    return owner.deviceToken.create({
      data: {
        licenseId,
        accountId,
        token,
        platform,
        revokedAt,
        // A device cannot be revoked before it was registered — the table says
        // so with a CHECK — so a row seeded as already-revoked needs a
        // registration that predates it.
        ...(revokedAt ? { createdAt: new Date(revokedAt.getTime() - 60_000) } : {}),
      },
      select: { id: true },
    });
  }

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });

  async function widgetToken() {
    const response = await server.post(
      '/customer/token',
      { organization_id: fx.a.organizationId },
      { origin: `https://${fx.a.trustedDomain}` },
    );
    expect(response.statusCode).toBe(200);
    return (response.json() as { token: string }).token;
  }

  /** A visitor writes in, which is what routing and the notification hang off. */
  async function visitorWrites(text: string, extra: Record<string, unknown> = {}) {
    const token = await widgetToken();
    const response = await server.post('/customer/chat/events', { text, ...extra }, auth(token));
    return { token, response };
  }

  it('pushes to the assigned agent’s handset when a visitor starts a chat', async () => {
    await visitorWrites('My order is late');

    const delivered = await push.delivered();
    expect(delivered).toHaveLength(1);
    expect(delivered[0]).toMatchObject({
      license_id: fx.a.licenseId.toString(),
      account_id: fx.a.agentAccountId,
      platform: 'ios',
      token: AGENT_PHONE,
      kind: 'new_chat',
    });
    // The payload carries a destination, not the conversation: whatever the
    // visitor typed must not travel through APNs/FCM.
    expect(delivered[0]!.chat_id).toBeTruthy();
    expect(JSON.stringify(delivered[0])).not.toContain('My order is late');
  });

  it('pushes again on a follow-up, and says it is a message rather than a new chat', async () => {
    const { token } = await visitorWrites('one');
    await server.post('/customer/chat/events', { text: 'two' }, auth(token));

    const kinds = (await push.delivered()).map((d) => d.kind).sort();
    expect(kinds).toEqual(['message', 'new_chat']);
  });

  it('does not push twice for a retried (idempotent) send', async () => {
    const token = await widgetToken();
    const first = await server.post(
      '/customer/chat/events',
      { text: 'once', idempotency_key: 'push-dup-key' },
      auth(token),
    );
    expect(first.statusCode).toBe(201);

    // Same key, so the message is replayed rather than re-posted. A second
    // buzz here would be the visitor's flaky connection waking somebody up.
    const replay = await server.post(
      '/customer/chat/events',
      { text: 'once', idempotency_key: 'push-dup-key' },
      auth(token),
    );
    expect(replay.statusCode).toBe(200);

    expect(await push.delivered()).toHaveLength(1);
  });

  it('does not push to an agent who turned the push channel off (FR-MOD-08.2)', async () => {
    await owner.agentMembership.update({
      where: { licenseId_agentId: { licenseId: fx.a.licenseId, agentId: fx.a.agentAccountId } },
      data: { notifyPush: false },
    });

    await visitorWrites('quietly, please');

    expect(await push.delivered()).toEqual([]);
    // …and the e-mail still goes out. The two channels are one preference set,
    // not one decision: silencing the phone is not a request to stop being
    // told at all.
    expect((await mailer.outbox()).filter((m) => m.kind === 'notification')).toHaveLength(1);
  });

  it('does not push when the master switch is off', async () => {
    // `enabled` covers the interruptive channels, and a push is the most
    // interruptive of them. Separate from `notifyPush` because they are
    // different requests and a build honouring only one would pass that test.
    await owner.agentMembership.update({
      where: { licenseId_agentId: { licenseId: fx.a.licenseId, agentId: fx.a.agentAccountId } },
      data: { notifyEnabled: false, notifyPush: true },
    });

    await visitorWrites('shh');

    expect(await push.delivered()).toEqual([]);
  });

  it('still pushes to an agent who turned e-mail off', async () => {
    // The other direction of the same rule — the channel the agent kept must
    // survive the one they dropped.
    await owner.agentMembership.update({
      where: { licenseId_agentId: { licenseId: fx.a.licenseId, agentId: fx.a.agentAccountId } },
      data: { notifyEmail: false },
    });

    await visitorWrites('phone only, thanks');

    expect(await push.delivered()).toHaveLength(1);
    expect((await mailer.outbox()).filter((m) => m.kind === 'notification')).toEqual([]);
  });

  /**
   * Sign a handset out the way the table allows it to be signed out.
   *
   * `revoked_at` and `created_at` are read off two different clocks — this
   * process's for the first, Postgres's for the second (`DEFAULT
   * CURRENT_TIMESTAMP`) — and `device_tokens_revoked_check` compares them. A
   * millisecond of skew in the wrong direction is enough to make
   * `revokedAt: new Date()` a constraint violation, which is what it was on one
   * run of this suite: `revoked_at …44.354Z` against `created_at …44.355Z`
   * (§D87's clock-skew class, tm 129). Deriving the stamp from the row's own
   * `created_at` takes the second clock out of the comparison, so the test
   * fails only for the reason it is about.
   */
  async function revoke(token: string): Promise<void> {
    const rows = await owner.deviceToken.findMany({
      where: { licenseId: fx.a.licenseId, token },
      select: { id: true, createdAt: true },
    });
    for (const row of rows) {
      await owner.deviceToken.update({
        where: { id: row.id },
        data: { revokedAt: new Date(Math.max(Date.now(), row.createdAt.getTime())) },
      });
    }
  }

  it('does not push to a handset that was signed out', async () => {
    await revoke(AGENT_PHONE);

    await visitorWrites('anyone there?');

    expect(await push.delivered()).toEqual([]);
  });

  it('pushes to every live handset the agent has, and only those', async () => {
    await registerDevice(fx.a.licenseId, fx.a.agentAccountId, 'apns-token-a-tablet', 'ios');
    await registerDevice(
      fx.a.licenseId,
      fx.a.agentAccountId,
      'apns-token-a-old-phone',
      'ios',
      new Date(),
    );
    // A colleague in the same workspace. RLS would not exclude them — they share
    // a license — so this is the account-id filter's case.
    await registerDevice(fx.a.licenseId, fx.a.ownerAccountId, 'apns-token-a-colleague', 'ios');

    await visitorWrites('hello');

    const tokens = (await push.delivered()).map((d) => d.token).sort();
    expect(tokens).toEqual([AGENT_PHONE, 'apns-token-a-tablet'].sort());
  });

  it('never reaches a device in another workspace', async () => {
    await visitorWrites('for A only');

    // Asked twice, deliberately. The first is the claim; the second is the one
    // that would still catch a delivery filed under a license nobody expected.
    expect(await push.delivered(fx.b.licenseId)).toEqual([]);
    const all = await push.delivered();
    expect(all).toHaveLength(1);
    expect(all.some((d) => d.token === OTHER_PHONE)).toBe(false);
    expect(all.some((d) => d.account_id === fx.b.agentAccountId)).toBe(false);
    expect(all.every((d) => d.license_id === fx.a.licenseId.toString())).toBe(true);
  });

  it('addresses only this workspace’s row when one handset is registered in two', async () => {
    // The unique index on `device_tokens` is license-scoped precisely so the
    // same phone can belong to a person who works in two workspaces. That makes
    // the token string useless as an identifier and the license the only thing
    // separating the rows — which is why the query names it explicitly rather
    // than trusting the account id.
    const shared = 'shared-handset-token';
    await registerDevice(fx.a.licenseId, fx.a.agentAccountId, shared, 'ios');
    await registerDevice(fx.b.licenseId, fx.b.agentAccountId, shared, 'ios');

    await visitorWrites('one workspace only');

    const delivered = await push.delivered();
    expect(delivered).toHaveLength(2);
    expect(delivered.every((d) => d.license_id === fx.a.licenseId.toString())).toBe(true);
    expect(delivered.every((d) => d.account_id === fx.a.agentAccountId)).toBe(true);
    expect(await push.delivered(fx.b.licenseId)).toEqual([]);
  });

  it('does not push when nobody is assigned', async () => {
    // Nobody in the workspace is taking chats, so the conversation queues.
    // There is no handset to address because there is no person yet — and
    // buzzing everyone for every unassigned visitor is what this avoids.
    await owner.agentMembership.updateMany({
      where: { licenseId: fx.a.licenseId },
      data: { routingStatus: 'not_accepting_chats' },
    });

    await visitorWrites('is anyone home?');

    expect(await push.delivered()).toEqual([]);
  });

  describe('transfer', () => {
    let agentToken: string;

    beforeEach(async () => {
      agentToken = await grantToken(owner, {
        licenseId: fx.a.licenseId,
        organizationId: fx.a.organizationId,
        ownerId: fx.a.agentAccountId,
        scopes: ['chats--all:rw'],
      });
    });

    async function openChat(): Promise<string> {
      const { response } = await visitorWrites('please transfer me');
      expect(response.statusCode).toBe(201);
      return (response.json() as { chat_id: string }).chat_id;
    }

    it('pushes to the colleague a chat is handed to', async () => {
      // The colleague's own handset, registered before the hand-off.
      await registerDevice(fx.a.licenseId, fx.a.ownerAccountId, 'apns-token-a-colleague', 'ios');
      const chatId = await openChat();
      await rm(pushDir, { recursive: true, force: true });

      const response = await server.post(
        `/chats/${chatId}/transfer`,
        { agent_id: fx.a.ownerAccountId, reason: 'manual' },
        auth(agentToken),
      );
      expect(response.statusCode).toBe(200);

      const delivered = await push.delivered();
      expect(delivered).toHaveLength(1);
      expect(delivered[0]).toMatchObject({
        account_id: fx.a.ownerAccountId,
        token: 'apns-token-a-colleague',
        kind: 'assignment',
        chat_id: chatId,
      });
    });

    it('does not push when an agent hands a chat to themselves', async () => {
      const chatId = await openChat();
      await rm(pushDir, { recursive: true, force: true });

      const response = await server.post(
        `/chats/${chatId}/transfer`,
        { agent_id: fx.a.agentAccountId, reason: 'manual' },
        auth(agentToken),
      );
      expect(response.statusCode).toBe(200);

      expect(await push.delivered()).toEqual([]);
    });

    it('does not push when a chat is handed to a team', async () => {
      // A team transfer unassigns; there is nobody to address until routing
      // picks someone, and that pick is not this route's event.
      const team = await owner.group.create({
        data: { licenseId: fx.a.licenseId, name: 'Billing' },
        select: { id: true },
      });
      await owner.groupAgent.create({
        data: {
          licenseId: fx.a.licenseId,
          groupId: team.id,
          agentId: fx.a.ownerAccountId,
          priority: 'normal',
        },
      });
      await registerDevice(fx.a.licenseId, fx.a.ownerAccountId, 'apns-token-a-colleague', 'ios');

      const chatId = await openChat();
      await rm(pushDir, { recursive: true, force: true });

      const response = await server.post(
        `/chats/${chatId}/transfer`,
        { group_id: Number(team.id), reason: 'manual' },
        auth(agentToken),
      );
      expect(response.statusCode).toBe(200);

      expect(await push.delivered()).toEqual([]);
    });
  });
});
