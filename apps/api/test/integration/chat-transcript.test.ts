/**
 * End-of-chat transcript e-mail (FR-MOD-08.7.4).
 *
 * When a conversation ends a copy is mailed to the visitor and to the human who
 * handled it. Proven the way the notification channel is — with a real
 * `FileMailer` pointed at a temp directory, reading the spool back — because the
 * things that must hold are about *who* the mail reaches and *what* it carries:
 *
 *   1. Both an agent-archived close and an idle-timeout close send a transcript,
 *      because both go through the one shared close path.
 *   2. The visitor's copy never carries an internal note; the team's copy does.
 *   3. No address, no assignee, or an opted-out agent means that copy is skipped.
 *   4. A close driven in one tenant's context can never mail another's people —
 *      RLS scopes the transcript exactly as it scopes the close.
 */
import { PrismaClient } from '@prisma/client';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { generateShortId } from '@nexa/types';
import { ChatService } from '../../src/services/chat/chat-service.js';
import { FileMailer } from '../../src/services/mail/mailer.js';
import type { AgentPrincipal } from '../../src/services/auth/principal.js';
import { ownerClient, seedFixtures, type Fixtures, type TenantFixture } from '../helpers/fixtures.js';

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

  const agent = (t: TenantFixture): AgentPrincipal => ({
    kind: 'agent',
    accountId: t.agentAccountId,
    licenseId: t.licenseId,
    organizationId: t.organizationId,
    role: 'agent',
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
      },
      select: { id: true },
    });

    const chatId = generateShortId();
    await owner.chat.create({
      data: { id: chatId, licenseId: t.licenseId, customerId: customer.id, active: true, createdAt: at },
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

  const notifications = async () =>
    (await mailer.outbox()).filter((m) => m.kind === 'notification');

  beforeAll(async () => {
    if (!APP_URL) throw new Error('DATABASE_APP_URL must be set');
    owner = ownerClient();
    appRole = new PrismaClient({ datasourceUrl: APP_URL });
    mailDir = await mkdtemp(join(tmpdir(), 'nexa-transcript-'));
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

  it('mails the visitor and the assignee when an agent archives the chat', async () => {
    const { chatId } = await seedChat(fx.a, {
      assigneeId: fx.a.agentAccountId,
      internalNote: true,
    });

    await chats().deactivate(ctx(fx.a), agent(fx.a), chatId);

    const mails = await notifications();
    const toCustomer = mails.find((m) => m.to === 'visitor@example.test');
    const toTeam = mails.find((m) => m.to === fx.a.agentEmail);

    expect(toCustomer).toBeDefined();
    expect(toTeam).toBeDefined();

    // The visitor sees the conversation but never the internal note.
    expect(toCustomer!.subject).toMatch(/your chat transcript/i);
    expect(toCustomer!.body).toContain('My order is late');
    expect(toCustomer!.body).toContain('Let me check on that');
    expect(toCustomer!.body).not.toContain('refund pre-approved');

    // The team copy carries everything, including the note.
    expect(toTeam!.body).toContain('refund pre-approved');
  });

  it('mails a transcript when the idle-timeout sweep closes the chat', async () => {
    const now = new Date();
    const { chatId } = await seedChat(fx.a, {
      assigneeId: fx.a.agentAccountId,
      at: new Date(now.getTime() - 2 * HOUR),
    });

    const closed = await chats().deactivateByTimeout(
      ctx(fx.a),
      chatId,
      new Date(now.getTime() - HOUR),
    );
    expect(closed).not.toBeNull();

    const mails = await notifications();
    expect(mails.some((m) => m.to === 'visitor@example.test')).toBe(true);
    expect(mails.some((m) => m.to === fx.a.agentEmail)).toBe(true);
  });

  // ==========================================================================
  // Who is skipped
  // ==========================================================================

  it('skips the visitor copy when we captured no address, still mails the team', async () => {
    const { chatId } = await seedChat(fx.a, {
      customerEmail: null,
      assigneeId: fx.a.agentAccountId,
    });

    await chats().deactivate(ctx(fx.a), agent(fx.a), chatId);

    const mails = await notifications();
    expect(mails).toHaveLength(1);
    expect(mails[0]!.to).toBe(fx.a.agentEmail);
  });

  it('skips the team copy for an AI-only chat with no assignee, still mails the visitor', async () => {
    const { chatId } = await seedChat(fx.a, { assigneeId: null });

    await chats().deactivate(ctx(fx.a), agent(fx.a), chatId);

    const mails = await notifications();
    expect(mails).toHaveLength(1);
    expect(mails[0]!.to).toBe('visitor@example.test');
  });

  it('skips the team copy for an assignee who turned the e-mail channel off (FR-MOD-08.2)', async () => {
    await owner.agentMembership.update({
      where: { licenseId_agentId: { licenseId: fx.a.licenseId, agentId: fx.a.agentAccountId } },
      data: { notifyEmail: false },
    });

    const { chatId } = await seedChat(fx.a, { assigneeId: fx.a.agentAccountId });
    await chats().deactivate(ctx(fx.a), agent(fx.a), chatId);

    const mails = await notifications();
    expect(mails.map((m) => m.to)).toEqual(['visitor@example.test']);
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
    );
    expect(closed).toBeNull();

    const mails = await notifications();
    expect(mails.some((m) => m.to === fx.b.agentEmail)).toBe(false);
    expect(mails).toHaveLength(0);
  });
});
