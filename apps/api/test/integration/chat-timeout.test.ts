/**
 * Chat timeout sweep (FR-MOD-08.7.3): idle, "dead" conversations auto-close.
 *
 * The properties are checked the way the feature is specified — a positive
 * window closes what has gone quiet, and nothing else:
 *
 *   1. A chat idle past its window is closed: thread archived, chat deactivated,
 *      a system close event recorded and flagged as a timeout.
 *   2. The window is a floor, not a hint. A chat that saw activity inside the
 *      window survives, whether the activity was a fresh event on an old thread
 *      or the thread simply being young.
 *   3. A workspace that never enabled a timeout — no row, or a non-positive value
 *      that should never have been stored — is never swept.
 *   4. One tenant's sweep can never reach another's chats. RLS is the guarantee,
 *      tested directly: a close driven in A's context against B's chat id closes
 *      nothing.
 *   5. It is idempotent: a second sweep finds the closed chat inactive and does
 *      nothing.
 *   6. A timed-out chat with no human reply is billed as an AI resolution, exactly
 *      as a hand-archived one is (ADR-09).
 */
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { generateShortId } from '@nexa/types';
import { ChatService } from '../../src/services/chat/chat-service.js';
import { ChatTimeoutSweeper, type ChatTimeoutReport } from '../../src/services/chat/chat-timeout.js';
import {
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

describe('chat timeout sweep (FR-MOD-08.7.3)', () => {
  let owner: PrismaClient;
  let appRole: PrismaClient;
  let fx: Fixtures;
  let seq = 0;

  const ctx = (t: TenantFixture) => ({ licenseId: t.licenseId, organizationId: t.organizationId });
  const chats = () => new ChatService(appRole, NO_REDIS);
  const sweeper = () => new ChatTimeoutSweeper(appRole, chats());

  const nextId = (prefix: string, width: number): string => {
    seq += 1;
    return prefix + String(seq).padStart(width - 1, '0');
  };

  const tenantResult = (report: ChatTimeoutReport, t: TenantFixture) =>
    report.tenants.find((r) => r.licenseId === t.licenseId.toString());
  const chatActive = async (id: string) =>
    (await owner.chat.findUnique({ where: { id } }))?.active ?? null;

  // A fresh customer per active chat: the one-active-chat-per-customer invariant
  // means a tenant can hold only one at a time otherwise.
  async function newCustomer(t: TenantFixture): Promise<string> {
    const customer = await owner.customer.create({
      data: { organizationId: t.organizationId, name: `c${nextId('', 8)}` },
      select: { id: true },
    });
    return customer.id;
  }

  async function configureTimeout(t: TenantFixture, seconds: number | null): Promise<void> {
    // inbox_settings is keyed by (license, brand) now — write the default brand's
    // row, the one the brandless sweep resolves to via RLS.
    const brand = await owner.brand.findFirstOrThrow({
      where: { licenseId: t.licenseId, isDefault: true },
      select: { id: true },
    });
    await owner.inboxSettings.upsert({
      where: { licenseId_brandId: { licenseId: t.licenseId, brandId: brand.id } },
      create: { licenseId: t.licenseId, brandId: brand.id, chatTimeoutSeconds: seconds },
      update: { chatTimeoutSeconds: seconds },
    });
  }

  // Seeding runs as the owner (RLS-exempt) so a scenario can place a chat with
  // exactly the last-activity time it wants to probe the boundary with.
  async function seedActiveChat(
    t: TenantFixture,
    lastActivityAt: Date,
    options: { customerId?: string } = {},
  ): Promise<{ chatId: string; threadId: string }> {
    const customerId = options.customerId ?? (await newCustomer(t));
    const chatId = generateShortId();
    await owner.chat.create({
      data: {
        id: chatId,
        licenseId: t.licenseId,
        customerId,
        active: true,
        createdAt: lastActivityAt,
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
        createdAt: lastActivityAt,
      },
    });
    return { chatId, threadId };
  }

  async function seedEvent(
    t: TenantFixture,
    chatId: string,
    threadId: string,
    createdAt: Date,
    authorType = 'customer',
  ): Promise<void> {
    await owner.event.create({
      data: {
        id: nextId('e', 40),
        threadId,
        chatId,
        licenseId: t.licenseId,
        type: 'message',
        authorType,
        text: 'msg',
        createdAt,
      },
    });
  }

  beforeAll(async () => {
    if (!APP_URL) throw new Error('DATABASE_APP_URL must be set');
    owner = ownerClient();
    appRole = new PrismaClient({ datasourceUrl: APP_URL });
  });

  afterAll(async () => {
    await Promise.all([owner.$disconnect(), appRole.$disconnect()]);
  });

  beforeEach(async () => {
    fx = await seedFixtures(owner);
    // configureTimeout() writes each license's default brand inbox_settings row.
    await Promise.all([
      seedDefaultBrand(owner, fx.a.licenseId),
      seedDefaultBrand(owner, fx.b.licenseId),
    ]);
    seq = 0;
  });

  // ==========================================================================
  // Closes what is past the window; keeps the rest
  // ==========================================================================

  it('closes an idle chat once its window has passed', async () => {
    const now = new Date();
    await configureTimeout(fx.a, 3600);
    const { chatId, threadId } = await seedActiveChat(fx.a, new Date(now.getTime() - 2 * HOUR));

    const report = await sweeper().run({ now });
    expect(tenantResult(report, fx.a)?.closed).toBe(1);

    const chat = await owner.chat.findUnique({ where: { id: chatId } });
    const thread = await owner.thread.findUnique({ where: { id: threadId } });
    expect(chat?.active).toBe(false);
    expect(thread?.active).toBe(false);
    expect(thread?.closedAt).not.toBeNull();

    // The close is recorded as a system event, flagged as a timeout so a
    // transcript shows *why* it ended.
    const closeEvent = await owner.event.findFirst({
      where: { threadId, authorType: 'system' },
      orderBy: { createdAt: 'desc' },
    });
    expect(closeEvent?.properties).toMatchObject({
      system_event: 'chat_deactivated',
      reason: 'timeout',
    });
  });

  it('leaves a chat that saw activity inside the window', async () => {
    const now = new Date();
    await configureTimeout(fx.a, 3600);

    // Old thread, but a message a minute ago — last activity is what counts.
    const chatted = await seedActiveChat(fx.a, new Date(now.getTime() - 5 * HOUR));
    await seedEvent(fx.a, chatted.chatId, chatted.threadId, new Date(now.getTime() - 60_000));

    // And a brand-new thread with no events at all.
    const young = await seedActiveChat(fx.a, new Date(now.getTime() - 60_000));

    const report = await sweeper().run({ now });
    expect(tenantResult(report, fx.a)?.closed).toBe(0);
    expect(await chatActive(chatted.chatId)).toBe(true);
    expect(await chatActive(young.chatId)).toBe(true);
  });

  // ==========================================================================
  // Only when enabled, only with a positive window
  // ==========================================================================

  it('never sweeps a workspace that has not enabled a timeout', async () => {
    const now = new Date();
    // fx.a: no inbox_settings row at all.
    const { chatId } = await seedActiveChat(fx.a, new Date(now.getTime() - 10 * HOUR));

    const report = await sweeper().run({ now });
    expect(tenantResult(report, fx.a)?.timeoutSeconds).toBeNull();
    expect(tenantResult(report, fx.a)?.closed).toBe(0);
    expect(await chatActive(chatId)).toBe(true);
  });

  it('skips a stored window that is not positive rather than closing everything', async () => {
    const now = new Date();
    // A zero window can only get here by bypassing the endpoint; the sweep's own
    // guard is what stops it from closing every live chat.
    await configureTimeout(fx.a, 0);
    const { chatId } = await seedActiveChat(fx.a, new Date(now.getTime() - 10 * HOUR));

    const report = await sweeper().run({ now });
    expect(tenantResult(report, fx.a)?.closed).toBe(0);
    expect(await chatActive(chatId)).toBe(true);
  });

  // ==========================================================================
  // Cross-tenant isolation (mandatory negative test)
  // ==========================================================================

  it('a timeout close in one tenant cannot reach an identical chat in another', async () => {
    const now = new Date();
    const cutoff = new Date(now.getTime() - HOUR);
    const inA = await seedActiveChat(fx.a, new Date(now.getTime() - 2 * HOUR));
    const inB = await seedActiveChat(fx.b, new Date(now.getTime() - 2 * HOUR));

    // Drive the close for B's chat id, but in A's context. RLS — not a WHERE
    // clause — must keep it out of B: the chat is invisible, so nothing closes.
    expect(await chats().deactivateByTimeout(ctx(fx.a), inB.chatId, cutoff)).toBeNull();
    expect(await chatActive(inB.chatId)).toBe(true);

    // A's own chat still closes through its own context.
    expect(await chats().deactivateByTimeout(ctx(fx.a), inA.chatId, cutoff)).not.toBeNull();
    expect(await chatActive(inA.chatId)).toBe(false);
  });

  it('spares a chat whose last activity is newer than the cutoff (a reply mid-sweep)', async () => {
    const now = new Date();
    const chat = await seedActiveChat(fx.a, new Date(now.getTime() - 3 * HOUR));
    // A reply landed 30 minutes ago — after a one-hour cutoff.
    await seedEvent(fx.a, chat.chatId, chat.threadId, new Date(now.getTime() - 30 * 60_000));

    const cutoff = new Date(now.getTime() - HOUR);
    expect(await chats().deactivateByTimeout(ctx(fx.a), chat.chatId, cutoff)).toBeNull();
    expect(await chatActive(chat.chatId)).toBe(true);
  });

  // ==========================================================================
  // Idempotent
  // ==========================================================================

  it('is idempotent — a second sweep closes nothing new', async () => {
    const now = new Date();
    await configureTimeout(fx.a, 3600);
    await seedActiveChat(fx.a, new Date(now.getTime() - 2 * HOUR));

    expect((await sweeper().run({ now })).totals.closed).toBe(1);
    expect((await sweeper().run({ now })).totals.closed).toBe(0);
  });

  // ==========================================================================
  // Billing parity (ADR-09)
  // ==========================================================================

  it('counts a timed-out chat with no human reply as an AI resolution', async () => {
    const now = new Date();
    await configureTimeout(fx.a, 3600);
    await seedActiveChat(fx.a, new Date(now.getTime() - 2 * HOUR));

    await sweeper().run({ now });

    const usage = await owner.usageRecord.findFirst({
      where: { licenseId: fx.a.licenseId, metric: 'ai_resolutions' },
    });
    expect(Number(usage?.quantity ?? 0n)).toBe(1);
  });
});
