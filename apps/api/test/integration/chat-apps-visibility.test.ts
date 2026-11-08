/**
 * `GET /chats/{chatId}/apps` behind the conversation's visibility (tm 420 ·
 * 2026-11-06 audit F03 · NFR-S5).
 *
 * The Details pane reads what the workspace's connected apps hold about a
 * conversation's customer — a help-desk's tickets, a CRM record — so the read
 * is as sensitive as the transcript. It used to check the token's chat scope
 * and then find the chat by id anywhere in the workspace: an agent kept to
 * team A could name a team-B chat id and read that customer's app data. The
 * route now asks the inbox's own rule (`resolveVisibility` +
 * `chatVisibilityFilter`, `services/chat/access.ts`):
 *
 *   - `team` (the default): a chat routed to one of the caller's teams, or one
 *     they are personally in; any other is a 404 that reads exactly like a
 *     made-up id.
 *   - `own`: only the chats the person is in, whatever the token says.
 *   - `none`: refused like every chat read.
 *   - `all` (owner, admin, an all-chats token): every chat of the workspace —
 *     and still nothing of another workspace's.
 *
 * Every read here is paired with `GET /chats/{chatId}` on the same credential
 * (`read`): the two answer alike, so the apps read shows neither more nor
 * less than the transcript it sits beside.
 *
 * The pilot's short answer (no live card → `items: []`, tm 257.18) comes after
 * the rule, so in the pilot too a chat the caller may not see — or one that
 * does not exist — is a 404, not an empty 200.
 */
import type { PrismaClient } from '@prisma/client';
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { defaultScopesForRole, generateShortId, type CapabilityOverride } from '@siyahtus/types';
import {
  grantToken,
  ownerClient,
  seedFixtures,
  type Fixtures,
  type TenantFixture,
} from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

type Headers = Record<string, string>;

interface AppChatData {
  app_id: string;
  fields: Array<{ label: string; value: string }>;
}

/** A mock card: connected, its in-chat data is a deterministic stub about the customer. */
const APP = 'hubspot';
const PILOT = { PILOT_MODE: 'true', PILOT_CONTACT_EMAIL: 'pilot-contact@example.test' };

describe('GET /chats/{chatId}/apps follows the conversation’s visibility (tm 420)', () => {
  let owner: PrismaClient;
  let server: TestServer;
  let pilot: TestServer;
  let fx: Fixtures;
  let seq = 0;

  /** The Founder's narrow token for the permission matrix (tm 325.2). */
  let founder: Headers;
  /** fx.a's agent (`team`), member of Support only. */
  let agent: Headers;
  /** The same agent with a token minted for every chat. */
  let agentAllToken: Headers;
  let ownerA: Headers;
  let ownerB: Headers;

  /** Routed to Support, the agent's team; the agent is not in it. */
  let supportChat: string;
  /** Routed to Sales; the agent is neither in the team nor in the chat. */
  let salesChat: string;
  /** Routed to Sales, but the agent is in it (transferred, joined). */
  let joinedChat: string;
  /** Routed to no team at all. */
  let unroutedChat: string;

  const bearer = (token: string): Headers => ({ authorization: `Bearer ${token}` });

  beforeAll(async () => {
    owner = ownerClient();
    [server, pilot] = await Promise.all([startTestServer(), startTestServer(PILOT)]);
  });

  afterAll(async () => {
    await Promise.all([server.close(), pilot.close()]);
    await owner.$disconnect();
  });

  beforeEach(async () => {
    fx = await seedFixtures(owner);
    seq = 0;
    // `seedFixtures` hands the next test the same licence ids; a matrix cached
    // for the workspace before must not answer for this one.
    server.app.permissionMatrix.cache.invalidate();
    pilot.app.permissionMatrix.cache.invalidate();
    await Promise.all([clearRateLimits(server.app), clearRateLimits(pilot.app)]);

    const token = (t: TenantFixture, ownerId: string, scopes: string[]) =>
      grantToken(owner, {
        licenseId: t.licenseId,
        organizationId: t.organizationId,
        ownerId,
        scopes,
      });
    founder = bearer(await token(fx.a, fx.a.ownerAccountId, ['access_rules:rw']));
    agent = bearer(await token(fx.a, fx.a.agentAccountId, defaultScopesForRole('agent')));
    agentAllToken = bearer(await token(fx.a, fx.a.agentAccountId, ['chats--all:rw']));
    ownerA = bearer(await token(fx.a, fx.a.ownerAccountId, defaultScopesForRole('owner')));
    ownerB = bearer(await token(fx.b, fx.b.ownerAccountId, defaultScopesForRole('owner')));

    const support = await group(fx.a, 'Support');
    const sales = await group(fx.a, 'Sales');
    await owner.groupAgent.create({
      data: { licenseId: fx.a.licenseId, groupId: support, agentId: fx.a.agentAccountId },
    });
    supportChat = await chat(fx.a, support);
    salesChat = await chat(fx.a, sales);
    joinedChat = await chat(fx.a, sales, fx.a.agentAccountId);
    unroutedChat = await chat(fx.a, null);

    // A connected card: on an ordinary deployment every chat above has data to leak.
    await owner.appInstallation.create({
      data: { licenseId: fx.a.licenseId, appId: APP, externalAccount: 'acct_visibility' },
    });
  });

  afterEach(async () => {
    // A matrix change mails the admins beside its response; the next reset
    // must not truncate under it.
    await Promise.all([server.app.backgroundMail.settled(), pilot.app.backgroundMail.settled()]);
  });

  async function group(t: TenantFixture, name: string): Promise<bigint> {
    return (
      await owner.group.create({ data: { licenseId: t.licenseId, name }, select: { id: true } })
    ).id;
  }

  /** An open conversation routed to `groupId` (or to none), with `participant` in it. */
  async function chat(
    t: TenantFixture,
    groupId: bigint | null,
    participant?: string,
  ): Promise<string> {
    seq += 1;
    const customer = await owner.customer.create({
      data: {
        organizationId: t.organizationId,
        name: `Visitor ${seq}`,
        email: `visitor-${seq}@example.test`,
      },
      select: { id: true },
    });
    const chatId = generateShortId();
    await owner.chat.create({
      data: { id: chatId, licenseId: t.licenseId, customerId: customer.id, active: true },
    });
    await owner.thread.create({
      data: { id: generateShortId(), chatId, licenseId: t.licenseId, active: true },
    });
    if (groupId !== null) await owner.chatAccess.create({ data: { chatId, groupId } });
    if (participant) {
      await owner.chatUser.create({ data: { chatId, userId: participant, userType: 'agent' } });
    }
    return chatId;
  }

  async function put(changes: CapabilityOverride[]): Promise<void> {
    const res = await server.put(
      '/settings/permissions',
      { changes, reason: 'Vardiya düzeni değişti' },
      founder,
    );
    expect(res.statusCode, res.body).toBe(200);
  }

  /**
   * The apps read, after asserting the transcript read on the same credential
   * answers with the same status — the rule is the transcript's, not a copy.
   */
  async function read(
    auth: Headers,
    chatId: string,
    on: TestServer = server,
  ): Promise<LightMyRequestResponse> {
    const apps = await on.get(`/chats/${chatId}/apps`, auth);
    const transcript = await on.get(`/chats/${chatId}`, auth);
    expect(apps.statusCode, `apps ${apps.body} · transcript ${transcript.body}`).toBe(
      transcript.statusCode,
    );
    return apps;
  }

  /** The connected card's data about this chat's customer. */
  async function expectShown(auth: Headers, chatId: string): Promise<void> {
    const res = await read(auth, chatId);
    expect(res.statusCode, res.body).toBe(200);
    const items = (res.json() as { items: AppChatData[] }).items;
    expect(items.map((item) => item.app_id)).toStrictEqual([APP]);
    expect(items[0]!.fields.length).toBeGreaterThan(0);
  }

  /** A 404 that cannot be told from a chat id nobody ever issued (NFR-S5). */
  async function expectAbsent(
    auth: Headers,
    chatId: string,
    on: TestServer = server,
  ): Promise<void> {
    const res = await read(auth, chatId, on);
    expect(res.statusCode, res.body).toBe(404);
    const madeUp = await on.get(`/chats/${generateShortId()}/apps`, auth);
    expect(madeUp.statusCode, madeUp.body).toBe(404);
    const shape = (r: LightMyRequestResponse) => {
      const { type, message } = (r.json() as { error: { type: string; message: string } }).error;
      return { type, message };
    };
    expect(shape(res)).toStrictEqual(shape(madeUp));
    expect(shape(res).type).toBe('not_found');
    expect(res.body).not.toContain(APP);
  }

  it('team: reads its own team’s and its joined conversations, and not another team’s — absent, like a made-up id (NFR-S5 · FR-MOD-04.RBAC)', async () => {
    await expectShown(agent, supportChat);
    await expectShown(agent, joinedChat);
    await expectAbsent(agent, salesChat);
    await expectAbsent(agent, unroutedChat);
  });

  it('own: only the conversations the person is in, even on a token minted for every chat (FR-MOD-04.RBAC · NFR-S5)', async () => {
    // The all-chats token reads everything while the role is at `team`…
    await expectShown(agentAllToken, salesChat);

    await put([{ role: 'agent', capability: 'chats.view', value: 'own' }]);
    for (const auth of [agent, agentAllToken]) {
      await expectShown(auth, joinedChat);
      await expectAbsent(auth, supportChat);
      await expectAbsent(auth, salesChat);
    }
  });

  it('none: refused like the transcript, whatever the token (FR-MOD-04.RBAC)', async () => {
    await put([{ role: 'agent', capability: 'chats.view', value: 'none' }]);
    for (const auth of [agent, agentAllToken]) {
      for (const chatId of [supportChat, joinedChat]) {
        const res = await read(auth, chatId);
        expect(res.statusCode, res.body).toBe(403);
        expect(res.body).not.toContain(APP);
      }
    }
  });

  it('all: the owner and an admin read every conversation of the workspace', async () => {
    const { passwordHash } = await owner.account.findUniqueOrThrow({
      where: { id: fx.a.ownerAccountId },
      select: { passwordHash: true },
    });
    const adminAccount = await owner.account.create({
      data: { email: `admin-${fx.a.licenseId}@example.test`, name: 'Admin', passwordHash },
      select: { id: true },
    });
    await owner.agentMembership.create({
      data: {
        licenseId: fx.a.licenseId,
        agentId: adminAccount.id,
        role: 'admin',
        routingStatus: 'accepting_chats',
      },
    });
    const admin = bearer(
      await grantToken(owner, {
        licenseId: fx.a.licenseId,
        organizationId: fx.a.organizationId,
        ownerId: adminAccount.id,
        scopes: defaultScopesForRole('admin'),
      }),
    );
    for (const auth of [ownerA, admin]) {
      for (const chatId of [supportChat, salesChat, joinedChat, unroutedChat]) {
        await expectShown(auth, chatId);
      }
    }
  });

  it('another workspace’s conversation is absent, even to its unrestricted owner (NFR-S5)', async () => {
    await expectAbsent(ownerB, supportChat);
    const theirs = await chat(fx.b, null);
    await expectAbsent(ownerA, theirs);
  });

  it('a bot is held to the same rule: its teams on a team-level token, every chat on an all-chats one', async () => {
    const bot = await owner.aiAgent.create({
      data: { licenseId: fx.a.licenseId, name: 'Bot', kind: 'ai_agent', active: true },
      select: { id: true },
    });
    const botToken = async (scopes: string[]) =>
      bearer(
        await grantToken(owner, {
          licenseId: fx.a.licenseId,
          organizationId: fx.a.organizationId,
          ownerId: bot.id,
          scopes,
          kind: 'bot',
        }),
      );
    const teamBot = await botToken(['chats--access:ro']);
    await expectAbsent(teamBot, salesChat);
    await expectAbsent(teamBot, supportChat);
    await expectShown(await botToken(['chats--all:ro']), salesChat);
  });

  it('pilot: the empty answer comes after the rule — a conversation the caller may not see, or none at all, is still a 404', async () => {
    const shownEmpty = async (auth: Headers, chatId: string): Promise<void> => {
      const res = await read(auth, chatId, pilot);
      expect(res.statusCode, res.body).toBe(200);
      // No live card on this deployment: no stub data about a real customer (tm 257.18).
      expect(res.json()).toStrictEqual({ items: [] });
    };
    await shownEmpty(agent, supportChat);
    await shownEmpty(agent, joinedChat);
    await shownEmpty(ownerA, salesChat);
    await expectAbsent(agent, salesChat, pilot);
    await expectAbsent(ownerB, supportChat, pilot);
  });
});
