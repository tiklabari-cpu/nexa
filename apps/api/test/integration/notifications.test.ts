/**
 * E-mail notifications for the agent (FR-MOD-13.8, the e-mail channel).
 *
 * A visitor's message reaches the assigned agent over realtime already; the
 * e-mail is the fallback for an agent who is not at their screen. Proven the
 * way `account-lifecycle` proves the reset mail — with a real `FileMailer`
 * pointed at a temp directory, reading the spool back — because a mock's call
 * log would not catch the mail being addressed to nobody.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PrismaClient } from '@prisma/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ownerClient, seedFixtures, type Fixtures } from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';
import { FileMailer } from '../../src/services/mail/mailer.js';

describe('agent e-mail notifications', () => {
  let owner: PrismaClient;
  let server: TestServer;
  let mailer: FileMailer;
  let mailDir: string;
  let fx: Fixtures;

  beforeAll(async () => {
    owner = ownerClient();
    mailDir = await mkdtemp(join(tmpdir(), 'nexa-notify-'));
    mailer = new FileMailer(mailDir);
    server = await startTestServer({}, { mailer });
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

  async function widgetToken() {
    const response = await server.post(
      '/customer/token',
      { organization_id: fx.a.organizationId },
      { origin: `https://${fx.a.trustedDomain}` },
    );
    expect(response.statusCode).toBe(200);
    return (response.json() as { token: string }).token;
  }

  it('e-mails the assigned agent when a visitor writes in', async () => {
    const token = await widgetToken();

    await server.post('/customer/chat/events', { text: 'My order is late' }, auth(token));

    const outbox = await mailer.outbox();
    const notifications = outbox.filter((m) => m.kind === 'notification');
    expect(notifications).toHaveLength(1);
    expect(notifications[0]!.to).toBe(fx.a.agentEmail);
    expect(notifications[0]!.subject).toMatch(/new message/i);
  });

  it('e-mails again on a follow-up message', async () => {
    const token = await widgetToken();

    await server.post('/customer/chat/events', { text: 'one' }, auth(token));
    await server.post('/customer/chat/events', { text: 'two' }, auth(token));

    const notifications = (await mailer.outbox()).filter((m) => m.kind === 'notification');
    expect(notifications).toHaveLength(2);
    expect(notifications.every((m) => m.to === fx.a.agentEmail)).toBe(true);
  });

  it('does not e-mail a second time for a retried (idempotent) send', async () => {
    const token = await widgetToken();

    const first = await server.post(
      '/customer/chat/events',
      {
        text: 'once',
        idempotency_key: 'notify-dup-key',
      },
      auth(token),
    );
    expect(first.statusCode).toBe(201);

    // Same key, so the message is replayed rather than re-posted — and no
    // second e-mail goes out.
    const replay = await server.post(
      '/customer/chat/events',
      {
        text: 'once',
        idempotency_key: 'notify-dup-key',
      },
      auth(token),
    );
    expect(replay.statusCode).toBe(200);

    const notifications = (await mailer.outbox()).filter((m) => m.kind === 'notification');
    expect(notifications).toHaveLength(1);
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
    await server.post('/customer/chat/events', { text: 'quietly, please' }, auth(token));

    const notifications = (await mailer.outbox()).filter((m) => m.kind === 'notification');
    expect(notifications).toHaveLength(0);
  });

  it('e-mails only the assignee on the same license, never another tenant', async () => {
    // Tenant B has its own agent with the same defaults; a message routed inside
    // tenant A must never reach them. Proven on the address, since the spool is
    // the one place a cross-tenant leak would surface.
    const token = await widgetToken();
    await server.post('/customer/chat/events', { text: 'for A only' }, auth(token));

    const notifications = (await mailer.outbox()).filter((m) => m.kind === 'notification');
    expect(notifications).toHaveLength(1);
    expect(notifications[0]!.to).toBe(fx.a.agentEmail);
    expect(notifications.some((m) => m.to === fx.b.agentEmail)).toBe(false);
  });
});
