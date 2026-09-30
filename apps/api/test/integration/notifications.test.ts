/**
 * E-mail notifications for the agent (FR-MOD-13.8, the e-mail channel).
 *
 * A visitor's message reaches the assigned agent over realtime already; the
 * e-mail is the fallback for an agent who is not at their screen. Proven the
 * way `account-lifecycle` proves the reset mail — with a real `FileMailer`
 * pointed at a temp directory, reading the spool back — because a mock's call
 * log would not catch the mail being addressed to nobody.
 *
 * Since tm 256.4 the e-mail is one per chat and assignee per window
 * (`ASSIGNEE_EMAIL_COOLDOWN_MS`) and is sent after the visitor's answer, so
 * every read of the spool waits for `backgroundMail` first — otherwise a "no
 * e-mail" assertion would pass before any e-mail could have been written. Each
 * server pins its window rather than inheriting a developer's `.env`.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PrismaClient } from '@prisma/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ownerClient, seedFixtures, type Fixtures } from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';
import { FileMailer } from '../../src/services/mail/mailer.js';
import { assigneeEmailKey } from '../../src/services/notifications/assignee-email.js';

const FIFTEEN_MINUTES = 900_000;

describe('agent e-mail notifications', () => {
  let owner: PrismaClient;
  let server: TestServer;
  let mailer: FileMailer;
  let mailDir: string;
  let fx: Fixtures;

  beforeAll(async () => {
    owner = ownerClient();
    mailDir = await mkdtemp(join(tmpdir(), 'siyahtus-notify-'));
    mailer = new FileMailer(mailDir);
    server = await startTestServer(
      { ASSIGNEE_EMAIL_COOLDOWN_MS: String(FIFTEEN_MINUTES) },
      { mailer },
    );
  });

  afterAll(async () => {
    await server.close();
    await owner.$disconnect();
    await rm(mailDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    fx = await seedFixtures(owner);
    await clearRateLimits(server.app);
    await rm(mailDir, { recursive: true, force: true });

    // Route everything to a team the agent is on, so the first message is
    // assigned to a human — the only case that has someone to e-mail.
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
  });

  afterEach(async () => {
    await rm(mailDir, { recursive: true, force: true });
  });

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });

  async function widgetToken(on: TestServer = server) {
    const response = await on.post(
      '/customer/token',
      { organization_id: fx.a.organizationId },
      { origin: `https://${fx.a.trustedDomain}` },
    );
    expect(response.statusCode).toBe(200);
    return (response.json() as { token: string }).token;
  }

  /** One visitor message; the chat it landed in. */
  async function write(on: TestServer, token: string, text: string): Promise<string> {
    const response = await on.post('/customer/chat/events', { text }, auth(token));
    expect([200, 201]).toContain(response.statusCode);
    return (response.json() as { chat_id: string }).chat_id;
  }

  /** The assignee e-mails that left — once every send the requests started has finished. */
  async function notifications(on: TestServer = server) {
    await on.app.backgroundMail.settled();
    return (await mailer.outbox()).filter((m) => m.kind === 'notification');
  }

  it('e-mails the assigned agent when a visitor writes in', async () => {
    const token = await widgetToken();

    await write(server, token, 'My order is late');

    const sent = await notifications();
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe(fx.a.agentEmail);
    expect(sent[0]!.subject).toMatch(/new message/i);
  });

  it('e-mails once for five messages inside the window, then again once it has passed (FR-MOD-13.8)', async () => {
    const token = await widgetToken();
    const chatId = await write(server, token, 'one');
    for (const text of ['two', 'three', 'four', 'five']) await write(server, token, text);

    expect(await notifications()).toHaveLength(1);

    // The window is the configured length, on this chat and this assignee.
    const key = assigneeEmailKey(fx.a.licenseId, chatId, fx.a.agentAccountId);
    const remaining = await server.app.redis.pttl(key);
    expect(remaining).toBeGreaterThan(FIFTEEN_MINUTES - 60_000);
    expect(remaining).toBeLessThanOrEqual(FIFTEEN_MINUTES);

    // Fifteen minutes pass. Redis ends the window, so it is Redis that is told.
    await server.app.redis.pexpire(key, 1);
    await new Promise((resolve) => setTimeout(resolve, 20));

    await write(server, token, 'six');
    const sent = await notifications();
    expect(sent).toHaveLength(2);
    expect(sent.every((m) => m.to === fx.a.agentEmail)).toBe(true);
  });

  it('does not e-mail an agent who turned the e-mail channel off (FR-MOD-08.2)', async () => {
    // The whole point of the preference: with it off, the assignment still
    // happens and realtime still fires, but no e-mail goes out.
    await owner.agentMembership.update({
      where: {
        licenseId_agentId: { licenseId: fx.a.licenseId, agentId: fx.a.agentAccountId },
      },
      data: { notifyEmail: false },
    });

    const token = await widgetToken();
    await write(server, token, 'quietly, please');

    expect(await notifications()).toHaveLength(0);
  });

  it('does not spend the window on an agent who had the channel off', async () => {
    // Off while the visitor writes, back on before the next line: the next line
    // is the first e-mail this agent could have had, so it goes out.
    const membership = {
      licenseId_agentId: { licenseId: fx.a.licenseId, agentId: fx.a.agentAccountId },
    };
    await owner.agentMembership.update({ where: membership, data: { notifyEmail: false } });
    const token = await widgetToken();
    await write(server, token, 'while you were away');
    expect(await notifications()).toHaveLength(0);

    await owner.agentMembership.update({ where: membership, data: { notifyEmail: true } });
    await write(server, token, 'are you back?');

    expect(await notifications()).toHaveLength(1);
  });

  it('e-mails only the assignee on the same license, never another tenant', async () => {
    // Tenant B has its own agent with the same defaults; a message routed inside
    // tenant A must never reach them. Proven on the address, since the spool is
    // the one place a cross-tenant leak would surface.
    const token = await widgetToken();
    await write(server, token, 'for A only');

    const sent = await notifications();
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe(fx.a.agentEmail);
    expect(sent.some((m) => m.to === fx.b.agentEmail)).toBe(false);
  });

  describe('with the window off (ASSIGNEE_EMAIL_COOLDOWN_MS=0)', () => {
    let unwindowed: TestServer;

    beforeAll(async () => {
      unwindowed = await startTestServer({ ASSIGNEE_EMAIL_COOLDOWN_MS: '0' }, { mailer });
    });

    afterAll(async () => {
      await unwindowed.close();
    });

    it('e-mails every message, as before the window existed', async () => {
      const token = await widgetToken(unwindowed);
      for (const text of ['one', 'two', 'three']) await write(unwindowed, token, text);

      const sent = await notifications(unwindowed);
      expect(sent).toHaveLength(3);
      expect(sent.every((m) => m.to === fx.a.agentEmail)).toBe(true);
    });

    it('does not e-mail a second time for a retried (idempotent) send', async () => {
      // On the unwindowed server on purpose: with a window, the retry would be
      // quiet whether or not the replay was recognised.
      const token = await widgetToken(unwindowed);
      const message = { text: 'once', idempotency_key: 'notify-dup-key' };

      const first = await unwindowed.post('/customer/chat/events', message, auth(token));
      expect(first.statusCode).toBe(201);

      // Same key, so the message is replayed rather than re-posted — and no
      // second e-mail goes out.
      const replay = await unwindowed.post('/customer/chat/events', message, auth(token));
      expect(replay.statusCode).toBe(200);

      expect(await notifications(unwindowed)).toHaveLength(1);
    });
  });

  describe('with a short window, in real time', () => {
    const WINDOW_MS = 1_000;
    let short: TestServer;

    beforeAll(async () => {
      short = await startTestServer({ ASSIGNEE_EMAIL_COOLDOWN_MS: String(WINDOW_MS) }, { mailer });
    });

    afterAll(async () => {
      await short.close();
    });

    it('e-mails again once the window has run out on its own', async () => {
      // No hand on Redis here: the key has to expire by itself.
      const token = await widgetToken(short);
      await write(short, token, 'first');
      await new Promise((resolve) => setTimeout(resolve, WINDOW_MS + 200));
      await write(short, token, 'after the window');

      expect(await notifications(short)).toHaveLength(2);
    });
  });
});
