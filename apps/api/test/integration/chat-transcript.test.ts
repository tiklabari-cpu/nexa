/**
 * End-of-chat transcript e-mail (FR-MOD-08.7.4).
 *
 * When a conversation ends a copy is mailed to the human who handled it and to
 * the workspace's forwarding addresses (WG-06 · tm 345) — never to the visitor
 * (K26): the player asks for their copy from the widget
 * (`transcript-request.test.ts`). Proven the way the notification channel is —
 * with a real `FileMailer` pointed at a temp directory, reading the spool back
 * — because the things that must hold are about *who* the mail reaches and
 * *what* it carries:
 *
 *   1. Both an agent-archived close and an idle-timeout close mail the team,
 *      never the visitor, because both go through the one shared close path —
 *      and the conversation's own record is as complete as before.
 *   2. A forwarded copy is the player's (no internal note) unless the workspace
 *      includes notes; each address is mailed on its own, as a `notification`.
 *   3. No assignee or an opted-out agent means that copy is skipped.
 *   4. A close driven in one tenant's context can never mail another tenant's people —
 *      RLS scopes the transcript exactly as it scopes the close.
 */
import { PrismaClient } from '@prisma/client';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { capabilitiesForRole, generateShortId } from '@siyahtus/types';
import { ChatService } from '../../src/services/chat/chat-service.js';
import { FileMailer, type Mailer } from '../../src/services/mail/mailer.js';
import { PermanentMailError } from '../../src/services/mail/mail-error.js';
import type { AgentPrincipal } from '../../src/services/auth/principal.js';
import {
  auditContextFor,
  ownerClient,
  seedDefaultBrand,
  seedFixtures,
  type Fixtures,
  type TenantFixture,
} from '../helpers/fixtures.js';

const APP_URL = process.env['DATABASE_APP_URL'];
const HOUR = 3_600_000;

/** Close needs no cache; the send path's idempotency check is the only user. */
const NO_REDIS = {
  set: async (): Promise<string | null> => null,
  get: async (): Promise<string | null> => null,
};

describe('chat transcript e-mail (FR-MOD-08.7.4)', () => {
  let owner: PrismaClient;
  let appRole: PrismaClient;
  let mailer: FileMailer;
  let mailDir: string;
  let fx: Fixtures;
  let seq = 0;

  const ctx = (t: TenantFixture) => ({ licenseId: t.licenseId, organizationId: t.organizationId });
  const chats = () => new ChatService(appRole, NO_REDIS, undefined, undefined, undefined, mailer);

  const nextId = (prefix: string, width: number): string => {
    seq += 1;
    return prefix + String(seq).padStart(width - 1, '0');
  };

  /** The trail entry the archive writes (FR-MOD-02.8) — asserted in `audit-log.test.ts`. */
  const audit = (t: TenantFixture) =>
    auditContextFor(t, { actorId: t.agentAccountId, actorType: 'agent' });

  const agent = (t: TenantFixture): AgentPrincipal => ({
    kind: 'agent',
    accountId: t.agentAccountId,
    licenseId: t.licenseId,
    organizationId: t.organizationId,
    role: 'agent',
    capabilities: capabilitiesForRole('agent', []),
    // The unrestricted scope, so the archive sees the chat without a group ACL.
    scopes: ['chats--all:rw', 'chats--all:ro'],
    tokenId: 'test-token',
    tokenKind: 'pat',
  });

  interface SeedOptions {
    customerEmail?: string | null;
    assigneeId?: string | null;
    internalNote?: boolean;
    at?: Date;
    /** The widget language recorded when the chat opened (WG-02). */
    customerLocale?: string | null;
  }

  // Seeds as the owner (RLS-exempt) so a scenario can place a chat, its assignee
  // and a fixed last-activity time exactly where it wants them.
  async function seedChat(
    t: TenantFixture,
    options: SeedOptions = {},
  ): Promise<{ chatId: string; threadId: string }> {
    const at = options.at ?? new Date();
    const customer = await owner.customer.create({
      data: {
        organizationId: t.organizationId,
        name: 'Vic',
        email: options.customerEmail === undefined ? 'visitor@example.test' : options.customerEmail,
        locale: options.customerLocale ?? null,
      },
      select: { id: true },
    });

    const chatId = generateShortId();
    await owner.chat.create({
      data: {
        id: chatId,
        licenseId: t.licenseId,
        customerId: customer.id,
        active: true,
        createdAt: at,
      },
    });
    const threadId = generateShortId();
    await owner.thread.create({
      data: {
        id: threadId,
        chatId,
        licenseId: t.licenseId,
        active: true,
        closedAt: null,
        assigneeId: options.assigneeId ?? null,
        createdAt: at,
      },
    });

    const assigneeId = options.assigneeId ?? t.agentAccountId;
    await owner.event.create({
      data: {
        id: nextId('e', 40),
        threadId,
        chatId,
        licenseId: t.licenseId,
        type: 'message',
        authorType: 'customer',
        text: 'My order is late',
        recipients: 'all',
        createdAt: at,
      },
    });
    if (options.assigneeId !== null) {
      await owner.event.create({
        data: {
          id: nextId('e', 40),
          threadId,
          chatId,
          licenseId: t.licenseId,
          type: 'message',
          authorType: 'agent',
          authorId: assigneeId,
          text: 'Let me check on that',
          recipients: 'all',
          createdAt: new Date(at.getTime() + 1_000),
        },
      });
    }
    if (options.internalNote) {
      await owner.event.create({
        data: {
          id: nextId('e', 40),
          threadId,
          chatId,
          licenseId: t.licenseId,
          type: 'message',
          authorType: 'agent',
          authorId: assigneeId,
          text: 'VIP — refund pre-approved',
          recipients: 'agents',
          createdAt: new Date(at.getTime() + 2_000),
        },
      });
    }
    return { chatId, threadId };
  }

  // Every closing copy is a `notification`; a `chat_transcript` here would be
  // the visitor's copy, which a close no longer sends (K26).
  const notifications = async () =>
    (await mailer.outbox()).filter(
      (m) => m.kind === 'notification' || m.kind === 'chat_transcript',
    );

  /** The workspace's forwarding settings (WG-06), on the default brand. */
  async function forwardTo(t: TenantFixture, to: string[], includeNotes = false): Promise<void> {
    const brand = await seedDefaultBrand(owner, t.licenseId);
    await owner.inboxSettings.upsert({
      where: { licenseId_brandId: { licenseId: t.licenseId, brandId: brand } },
      create: {
        licenseId: t.licenseId,
        brandId: brand,
        transcriptForwardTo: to,
        transcriptForwardIncludeNotes: includeNotes,
      },
      update: { transcriptForwardTo: to, transcriptForwardIncludeNotes: includeNotes },
    });
  }

  beforeAll(async () => {
    if (!APP_URL) throw new Error('DATABASE_APP_URL must be set');
    owner = ownerClient();
    appRole = new PrismaClient({ datasourceUrl: APP_URL });
    mailDir = await mkdtemp(join(tmpdir(), 'siyahtus-transcript-'));
    mailer = new FileMailer(mailDir);
  });

  afterAll(async () => {
    await Promise.all([owner.$disconnect(), appRole.$disconnect()]);
    await rm(mailDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    fx = await seedFixtures(owner);
    seq = 0;
    await rm(mailDir, { recursive: true, force: true });
  });

  afterEach(async () => {
    await rm(mailDir, { recursive: true, force: true });
  });

  // ==========================================================================
  // Both close paths send a transcript
  // ==========================================================================

  it('never mails the visitor at close, mails the assignee everything (K26 · FR-MOD-08.7.4)', async () => {
    const { chatId } = await seedChat(fx.a, {
      assigneeId: fx.a.agentAccountId,
      internalNote: true,
    });

    await chats().deactivate(ctx(fx.a), agent(fx.a), chatId, audit(fx.a));

    const mails = await notifications();
    expect(mails.map((m) => `${m.kind} → ${m.to}`)).toEqual([`notification → ${fx.a.agentEmail}`]);
    // The team copy carries everything, including the note.
    expect(mails[0]!.body).toContain('My order is late');
    expect(mails[0]!.body).toContain('refund pre-approved');
  });

  it("keeps the conversation's own record whole: events, archive, timeline (K26 regression)", async () => {
    const { chatId, threadId } = await seedChat(fx.a, {
      assigneeId: fx.a.agentAccountId,
      internalNote: true,
    });

    await chats().deactivate(ctx(fx.a), agent(fx.a), chatId, audit(fx.a));

    // Nothing the close used to keep is lost now that the visitor is not
    // mailed: the three seeded lines (note included) and the close's own
    // event are on the connection, the chat is archived, the thread ended.
    const events = await owner.event.findMany({
      where: { threadId },
      orderBy: { createdAt: 'asc' },
      select: { text: true, recipients: true, type: true },
    });
    expect(events.filter((e) => e.type === 'message').map((e) => e.text)).toEqual([
      'My order is late',
      'Let me check on that',
      'VIP — refund pre-approved',
    ]);
    const chat = await owner.chat.findUnique({ where: { id: chatId }, select: { active: true } });
    const thread = await owner.thread.findUnique({
      where: { id: threadId },
      select: { active: true, closedAt: true },
    });
    expect(chat?.active).toBe(false);
    expect(thread?.active).toBe(false);
    expect(thread?.closedAt).not.toBeNull();
    const trail = await owner.auditLogEntry.findMany({
      where: { licenseId: fx.a.licenseId, target: `chat:${chatId}` },
      select: { action: true },
    });
    expect(trail.map((e) => e.action)).toContain('chat.archived');
  });

  it("forwards the player's copy to each address on its own, no note, as internal mail (WG-06)", async () => {
    await forwardTo(fx.a, ['arsiv@sirket.test', 'uyum@sirket.test']);
    const { chatId } = await seedChat(fx.a, {
      assigneeId: fx.a.agentAccountId,
      internalNote: true,
    });

    await chats().deactivate(ctx(fx.a), agent(fx.a), chatId, audit(fx.a));

    const mails = await notifications();
    expect(mails.map((m) => `${m.kind} → ${m.to}`).sort()).toEqual(
      [
        `notification → ${fx.a.agentEmail}`,
        'notification → arsiv@sirket.test',
        'notification → uyum@sirket.test',
      ].sort(),
    );
    for (const to of ['arsiv@sirket.test', 'uyum@sirket.test']) {
      const copy = mails.find((m) => m.to === to)!;
      expect(copy.body).toContain('Let me check on that');
      expect(copy.body).not.toContain('refund pre-approved');
    }
    expect(mails.some((m) => m.to === 'visitor@example.test')).toBe(false);
  });

  it("forwards the team's copy, notes marked, when the workspace includes them (WG-06)", async () => {
    await forwardTo(fx.a, ['arsiv@sirket.test'], true);
    const { chatId } = await seedChat(fx.a, { assigneeId: null, internalNote: true });

    await chats().deactivate(ctx(fx.a), agent(fx.a), chatId, audit(fx.a));

    const mails = await notifications();
    expect(mails.map((m) => m.to)).toEqual(['arsiv@sirket.test']);
    expect(mails[0]!.body).toContain('refund pre-approved');
  });

  it('still mails the assignee when a forwarding address is refused, and still closes (tm 255.4)', async () => {
    await forwardTo(fx.a, ['arsiv@sirket.test']);
    const { chatId } = await seedChat(fx.a, { assigneeId: fx.a.agentAccountId });
    const refusing: Mailer = {
      send: async (message) => {
        if (message.to === 'arsiv@sirket.test') {
          throw new PermanentMailError({ code: 'rejected', phase: 'rcpt_to', smtpCode: 550 });
        }
        await mailer.send(message);
      },
    };
    const service = new ChatService(appRole, NO_REDIS, undefined, undefined, undefined, refusing);

    await expect(
      service.deactivate(ctx(fx.a), agent(fx.a), chatId, audit(fx.a)),
    ).resolves.toBeDefined();

    expect((await notifications()).map((m) => m.to)).toEqual([fx.a.agentEmail]);
    const closed = await owner.chat.findUnique({ where: { id: chatId }, select: { active: true } });
    expect(closed?.active).toBe(false);
  });

  it('mails the team, not the visitor, when the idle-timeout sweep closes the chat (K26)', async () => {
    const now = new Date();
    const { chatId } = await seedChat(fx.a, {
      assigneeId: fx.a.agentAccountId,
      at: new Date(now.getTime() - 2 * HOUR),
    });

    const closed = await chats().deactivateByTimeout(
      ctx(fx.a),
      chatId,
      new Date(now.getTime() - HOUR),
      auditContextFor(fx.a),
    );
    expect(closed).not.toBeNull();

    const mails = await notifications();
    expect(mails.map((m) => m.to)).toEqual([fx.a.agentEmail]);
  });

  // ==========================================================================
  // Who is skipped
  // ==========================================================================

  it('mails nobody for an AI-only chat with no assignee and no forwarding', async () => {
    const { chatId } = await seedChat(fx.a, { assigneeId: null });

    await chats().deactivate(ctx(fx.a), agent(fx.a), chatId, audit(fx.a));

    expect(await notifications()).toEqual([]);
  });

  it('skips the team copy for an assignee who turned the e-mail channel off (FR-MOD-08.2)', async () => {
    await owner.agentMembership.update({
      where: { licenseId_agentId: { licenseId: fx.a.licenseId, agentId: fx.a.agentAccountId } },
      data: { notifyEmail: false },
    });

    const { chatId } = await seedChat(fx.a, { assigneeId: fx.a.agentAccountId });
    await chats().deactivate(ctx(fx.a), agent(fx.a), chatId, audit(fx.a));

    expect(await notifications()).toEqual([]);
  });

  // ==========================================================================
  // Cross-tenant isolation (mandatory negative test)
  // ==========================================================================

  it('a close in one tenant never mails another tenant a transcript', async () => {
    const now = new Date();
    const inB = await seedChat(fx.b, {
      assigneeId: fx.b.agentAccountId,
      at: new Date(now.getTime() - 2 * HOUR),
    });

    // Drive B's chat id, but in A's context. RLS makes the chat invisible, so
    // nothing closes — and, critically, nothing is mailed to B's agent or B's
    // visitor.
    const closed = await chats().deactivateByTimeout(
      ctx(fx.a),
      inB.chatId,
      new Date(now.getTime() - HOUR),
      auditContextFor(fx.a),
    );
    expect(closed).toBeNull();

    const mails = await notifications();
    expect(mails.some((m) => m.to === fx.b.agentEmail)).toBe(false);
    expect(mails).toHaveLength(0);
  });
});
