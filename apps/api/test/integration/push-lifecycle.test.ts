/**
 * A handset's whole life, in order (FR-MOD-13.7 · 13.7-k).
 *
 * `device-tokens.test.ts` proves the endpoints and `push-notifications.test.ts`
 * proves target selection, but both do it a state at a time, and both seed the
 * `device_tokens` rows they reason about through the owner connection. That
 * leaves one thing unproven: that the states *join up*. A registration made by
 * the phone is the row the sender later addresses; a rotation moves delivery to
 * the new address and stops it at the old; a revoke actually reaches the sender
 * rather than only the list endpoint.
 *
 * So the shape here is deliberately different — one conversation, one handset,
 * and a single ordered walk through register → send → refresh → rotate →
 * revoke → refuse, every step driven through HTTP the way the app would drive
 * it. The bug this catches and the per-state suites cannot is a seam: an upsert
 * that returns the right row to the caller while the sender's query keeps
 * reading the old one, a revoke recorded somewhere the target selection does
 * not look. Nothing is seeded through Prisma; if a step is wrong the next step
 * is what notices, which is exactly how it would fail on a real phone.
 *
 * Workspace B is registered throughout and asserted empty after every single
 * step, not once at the end. The cross-tenant claim is the one that has to hold
 * at every moment of the lifecycle — including the moment a token exists in two
 * workspaces at once — and a check only at the end would pass on a delivery
 * that had already been made and then stopped.
 *
 * Run against real Postgres with RLS on, with a real `FilePushProvider` on a
 * temp directory: the spool is partitioned by license, so "did the other tenant
 * hear about this?" is a question about a directory rather than a field.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PrismaClient } from '@prisma/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { grantToken, ownerClient, seedFixtures, type Fixtures } from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';
import { FilePushProvider, type DeliveredPush } from '../../src/services/push/push-provider.js';

describe('handset lifecycle end to end', () => {
  let owner: PrismaClient;
  let server: TestServer;
  let push: FilePushProvider;
  let pushDir: string;
  let fx: Fixtures;

  /** Workspace A's agent — the routing target, so the notified party. */
  let agentToken: string;
  /** Workspace B's agent, who must never hear about any of it. */
  let otherToken: string;

  /** The first address this phone is reachable at… */
  const FIRST_ADDRESS = 'apns-lifecycle-first';
  /** …and the one APNs hands it after a reinstall (13.7-c calls this a refresh). */
  const ROTATED_ADDRESS = 'apns-lifecycle-rotated';
  /** Workspace B's handset, registered for the whole run so "empty" means something. */
  const OTHER_ADDRESS = 'fcm-lifecycle-other-workspace';

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });

  beforeAll(async () => {
    owner = ownerClient();
    pushDir = await mkdtemp(join(tmpdir(), 'nexa-push-life-'));
    push = new FilePushProvider(pushDir);
    server = await startTestServer({}, { push });
  });

  afterAll(async () => {
    await server.close();
    await owner.$disconnect();
    await rm(pushDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    fx = await seedFixtures(owner);
    await clearRateLimits(server.app);
    await rm(pushDir, { recursive: true, force: true });

    // Route everything to a team the agent is on, so the visitor's first
    // message lands on a human — the only case that has a handset to address.
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

    agentToken = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.agentAccountId,
      scopes: ['agents--my:rw'],
    });
    otherToken = await grantToken(owner, {
      licenseId: fx.b.licenseId,
      organizationId: fx.b.organizationId,
      ownerId: fx.b.agentAccountId,
      scopes: ['agents--my:rw'],
    });
  });

  afterEach(async () => {
    await rm(pushDir, { recursive: true, force: true });
  });

  // --- The app's side of the wire --------------------------------------------

  /** `POST /notifications/devices` — what the app calls on launch. */
  const register = (token: string, address: string, platform: 'ios' | 'android' = 'ios') =>
    server.post('/notifications/devices', { token: address, platform }, auth(token));

  /** `DELETE /notifications/devices/:id` — what it calls on sign-out. */
  const revoke = (token: string, deviceId: string) =>
    server.del(`/notifications/devices/${deviceId}`, auth(token));

  const listDevices = async (token: string) => {
    const response = await server.get('/notifications/devices', auth(token));
    expect(response.statusCode).toBe(200);
    return (response.json() as { items: { id: string }[] }).items;
  };

  // --- The visitor's side ----------------------------------------------------

  async function widgetToken() {
    const response = await server.post(
      '/customer/token',
      { organization_id: fx.a.organizationId },
      { origin: `https://${fx.a.trustedDomain}` },
    );
    expect(response.statusCode).toBe(200);
    return (response.json() as { token: string }).token;
  }

  /**
   * One visitor, one conversation, kept for the whole walk.
   *
   * A fresh chat per step would re-run routing each time and make every
   * assertion about assignment as much as about delivery; the same chat
   * continuing is also the ordinary case — a person is being messaged by
   * someone they are already talking to.
   */
  async function visitorWrites(customerToken: string, text: string) {
    const response = await server.post('/customer/chat/events', { text }, auth(customerToken));
    expect([200, 201]).toContain(response.statusCode);
  }

  /**
   * What went out since the last time this was called, and — every single time —
   * the assertion that workspace B's spool is still empty.
   *
   * Draining is what makes each step's claim about *that step*: without it a
   * revoked handset would look like it was still being delivered to, because
   * the deliveries from three steps ago are still lying there.
   */
  async function deliveredThenDrain(): Promise<DeliveredPush[]> {
    const all = await push.delivered();
    expect(await push.delivered(fx.b.licenseId)).toEqual([]);
    expect(all.every((d) => d.license_id === fx.a.licenseId.toString())).toBe(true);
    await rm(pushDir, { recursive: true, force: true });
    return all;
  }

  it('registers, delivers, refreshes, rotates, revokes, and then refuses', async () => {
    // Workspace B's phone exists for the whole run, so "nothing reached the
    // other tenant" is a claim about a registered, reachable device rather than
    // about a workspace that had nowhere to deliver to anyway.
    expect((await register(otherToken, OTHER_ADDRESS, 'android')).statusCode).toBe(201);

    // --- 1. Register ---------------------------------------------------------
    const created = await register(agentToken, FIRST_ADDRESS);
    expect(created.statusCode).toBe(201);
    const device = created.json() as { id: string; platform: string; last_seen_at: string };
    expect(device.platform).toBe('ios');
    // The address is a delivery credential; it is not handed back on any read.
    expect(JSON.stringify(device)).not.toContain(FIRST_ADDRESS);
    expect(await listDevices(agentToken)).toHaveLength(1);

    // --- 2. Deliver ----------------------------------------------------------
    const customer = await widgetToken();
    await visitorWrites(customer, 'my order is late');

    const first = await deliveredThenDrain();
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({
      account_id: fx.a.agentAccountId,
      // The row the *endpoint* created is the row the *sender* addressed. This
      // is the join the per-state suites cannot make: they seed their own rows.
      device_id: device.id,
      token: FIRST_ADDRESS,
      platform: 'ios',
      kind: 'new_chat',
    });
    const chatId = first[0]!.chat_id;
    expect(chatId).toBeTruthy();

    // --- 3. Refresh ----------------------------------------------------------
    // The app re-registers on every launch. The row must move forward, not
    // multiply: a phone opened daily would otherwise collect a row per launch
    // and be buzzed once per row for the same message.
    const refreshed = await register(agentToken, FIRST_ADDRESS);
    expect(refreshed.statusCode).toBe(200);
    expect((refreshed.json() as { id: string }).id).toBe(device.id);
    expect(
      Date.parse((refreshed.json() as { last_seen_at: string }).last_seen_at),
    ).toBeGreaterThanOrEqual(Date.parse(device.last_seen_at));
    expect(await listDevices(agentToken)).toHaveLength(1);

    await visitorWrites(customer, 'any update?');

    const afterRefresh = await deliveredThenDrain();
    // Still exactly one buzz, and it says "message" rather than "new chat" —
    // the conversation is the same one.
    expect(afterRefresh).toHaveLength(1);
    expect(afterRefresh[0]).toMatchObject({
      device_id: device.id,
      token: FIRST_ADDRESS,
      kind: 'message',
      chat_id: chatId,
    });

    // --- 4. Rotate -----------------------------------------------------------
    // APNs/FCM hand out a new address after a reinstall or a restore. The app
    // registers the new one and revokes the old (§C-A31); delivery has to
    // follow, and — the part worth proving — has to *stop* at the old address,
    // which is still a perfectly valid string sitting in the table.
    const rotated = await register(agentToken, ROTATED_ADDRESS);
    expect(rotated.statusCode).toBe(201);
    const newDeviceId = (rotated.json() as { id: string }).id;
    expect(newDeviceId).not.toBe(device.id);
    expect((await revoke(agentToken, device.id)).statusCode).toBe(204);
    expect(await listDevices(agentToken)).toEqual([expect.objectContaining({ id: newDeviceId })]);

    await visitorWrites(customer, 'still waiting');

    const afterRotation = await deliveredThenDrain();
    expect(afterRotation).toHaveLength(1);
    expect(afterRotation[0]).toMatchObject({ device_id: newDeviceId, token: ROTATED_ADDRESS });
    expect(afterRotation.some((d) => d.token === FIRST_ADDRESS)).toBe(false);

    // --- 5. Revoke -----------------------------------------------------------
    expect((await revoke(agentToken, newDeviceId)).statusCode).toBe(204);
    expect(await listDevices(agentToken)).toEqual([]);
    // A second revoke is the shape a retry takes — the app treats a failure as
    // success and drops its local token either way (§C-A31 rule 1).
    expect((await revoke(agentToken, newDeviceId)).statusCode).toBe(404);

    // --- 6. Refuse -----------------------------------------------------------
    await visitorWrites(customer, 'hello?');

    // The row survives as a record that the target existed; delivery does not.
    expect(await deliveredThenDrain()).toEqual([]);
    expect(
      await owner.deviceToken.count({ where: { licenseId: fx.a.licenseId, revokedAt: null } }),
    ).toBe(0);
    expect(await owner.deviceToken.count({ where: { licenseId: fx.a.licenseId } })).toBe(2);
  });

  it('never crosses the tenant boundary, at any step of that walk', async () => {
    // The same walk, compressed, with one physical handset registered in *both*
    // workspaces — the case the license-scoped unique index exists to allow and
    // the one where the token string stops being an identifier. Every step
    // below asks the cross-tenant question again, because the answer has to
    // hold while the row exists in two places at once.
    const shared = 'shared-handset-lifecycle';
    const inA = await register(agentToken, shared);
    const inB = await register(otherToken, shared, 'android');
    expect(inA.statusCode).toBe(201);
    expect(inB.statusCode).toBe(201);
    const idInA = (inA.json() as { id: string }).id;
    const idInB = (inB.json() as { id: string }).id;
    expect(idInA).not.toBe(idInB);

    // Neither workspace can see or revoke the other's row, and both refusals
    // are the same 404 — so the endpoint cannot be used to find out which.
    expect((await revoke(otherToken, idInA)).statusCode).toBe(404);
    expect((await revoke(agentToken, idInB)).statusCode).toBe(404);
    expect(await listDevices(agentToken)).toEqual([expect.objectContaining({ id: idInA })]);
    expect(await listDevices(otherToken)).toEqual([expect.objectContaining({ id: idInB })]);

    const customer = await widgetToken();
    await visitorWrites(customer, 'for workspace A only');

    const delivered = await deliveredThenDrain();
    expect(delivered).toHaveLength(1);
    expect(delivered[0]).toMatchObject({
      license_id: fx.a.licenseId.toString(),
      account_id: fx.a.agentAccountId,
      device_id: idInA,
    });

    // Now A revokes its own row. B's registration of the same address is
    // untouched — a workspace signing out must not silence a colleague's phone
    // in another one — and A stops being delivered to.
    expect((await revoke(agentToken, idInA)).statusCode).toBe(204);
    expect(await listDevices(otherToken)).toEqual([expect.objectContaining({ id: idInB })]);
    expect(
      await owner.deviceToken.count({ where: { licenseId: fx.b.licenseId, revokedAt: null } }),
    ).toBe(1);

    await visitorWrites(customer, 'and nothing after that');
    expect(await deliveredThenDrain()).toEqual([]);
  });
});
