/**
 * Right to erasure (GDPR Art. 17 — the second half of NFR-C8).
 *
 * The requirement asks for a "right to erasure API": a targeted, single-subject
 * delete, as opposed to the periodic sweep that ages whole classes of data out.
 * Until tm 241 the word `erasure` appeared in this repo only in two comments.
 *
 * What has to be true for this to be that endpoint rather than a delete button:
 *
 *   1. **It actually erases.** Not a flag, not a rename — the conversations,
 *      the messages inside them, the visit telemetry, the tickets and the
 *      channel identities are gone from the database, asserted by asking the
 *      database, not by reading the response.
 *   2. **It cannot be reached by a reading authority** — NFR-C8's own
 *      "erişim ≠ silme". Its own scope, which `customers:rw` does not imply,
 *      plus `minimumRole: admin`.
 *   3. **It cannot cross a tenant.** Another workspace's customer is a 404, not
 *      a 403 (NFR-S5), and the row stays.
 *   4. **It leaves a trail.** One `data.subject_erased` entry, carrying the
 *      counts and the id — and nothing that was just erased.
 *   5. **It refuses while a conversation is live**, the invariant the sweep
 *      already holds.
 *
 * Negative cases assert the row is UNCHANGED rather than that the response was
 * polite: a refusal that still deleted would pass a status-code-only test.
 */
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildEventId, generateShortId } from '@nexa/types';
import {
  grantToken,
  ownerClient,
  seedFixtures,
  type Fixtures,
  type TenantFixture,
} from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

interface Receipt {
  customer_id: string;
  erased_at: string;
  chats: number;
  threads: number;
  events: number;
  visits: number;
  tickets: number;
  channel_identities: number;
}

describe('right to erasure (NFR-C8 · GDPR Art. 17)', () => {
  let server: TestServer;
  let owner: PrismaClient;
  let fx: Fixtures;
  let eraseToken: string;
  let seq = 0;

  beforeAll(async () => {
    owner = ownerClient();
    server = await startTestServer();
  });

  afterAll(async () => {
    await server.close();
    await owner.$disconnect();
  });

  beforeEach(async () => {
    fx = await seedFixtures(owner);
    seq = 0;
    await clearRateLimits(server.app);
    eraseToken = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['customers.erase:rw'],
    });
  });

  /**
   * A person with a history: one closed conversation carrying two messages, a
   * visit, a ticket and a channel identity. Everything an erasure has to reach,
   * planted as the owner so the shape is exact.
   */
  async function seedSubject(
    t: TenantFixture,
    options: { activeChat?: boolean } = {},
  ): Promise<{ customerId: string; chatId: string; threadId: string; ticketId: string }> {
    seq += 1;
    const suffix = String(seq).padStart(3, '0');
    const customer = await owner.customer.create({
      data: {
        organizationId: t.organizationId,
        name: `Subject ${suffix}`,
        email: `subject-${suffix}-${Date.now()}@example.test`,
      },
      select: { id: true },
    });

    const active = options.activeChat ?? false;
    const chatId = generateShortId();
    await owner.chat.create({
      data: { id: chatId, licenseId: t.licenseId, customerId: customer.id, active },
    });
    // A real short id, because `buildEventId` validates it — an event id that
    // did not parse would also break the generated `event_sequence` column.
    const threadId = generateShortId();
    await owner.thread.create({
      data: {
        id: threadId,
        chatId,
        licenseId: t.licenseId,
        active,
        closedAt: active ? null : new Date(),
        eventSequence: 2,
      },
    });
    await owner.event.createMany({
      data: [1, 2].map((n) => ({
        id: buildEventId(threadId, n),
        threadId,
        chatId,
        licenseId: t.licenseId,
        type: 'message',
        text: `message ${n}`,
        authorType: 'customer',
        authorId: customer.id,
      })),
    });

    await owner.visit.create({
      data: { licenseId: t.licenseId, customerId: customer.id, ip: '198.51.100.7' },
    });
    const ticketId = generateShortId();
    await owner.ticket.create({
      data: {
        id: ticketId,
        licenseId: t.licenseId,
        customerId: customer.id,
        subject: `Refund for order ${suffix}`,
      },
    });
    await owner.channelIdentity.create({
      data: {
        licenseId: t.licenseId,
        customerId: customer.id,
        channelType: 'sms',
        externalId: `+1555000${suffix}`,
      },
    });

    return { customerId: customer.id, chatId, threadId, ticketId };
  }

  const erase = (customerId: string, token = eraseToken) =>
    server.post(`/customers/${customerId}/erase`, undefined, {
      authorization: `Bearer ${token}`,
    });

  // ==========================================================================
  // It actually erases
  // ==========================================================================

  describe('the subject and everything identifying them is gone', () => {
    it('removes the contact, their conversation, its messages, telemetry, tickets and identities', async () => {
      const subject = await seedSubject(fx.a);

      const response = await erase(subject.customerId);

      expect(response.statusCode).toBe(200);
      const receipt = response.json() as Receipt;
      expect(receipt).toMatchObject({
        customer_id: subject.customerId,
        chats: 1,
        threads: 1,
        events: 2,
        visits: 1,
        tickets: 1,
        channel_identities: 1,
      });

      // Asked of the database as the owner — RLS off, so nothing can be
      // "missing" merely because a policy hid it.
      expect(await owner.customer.count({ where: { id: subject.customerId } })).toBe(0);
      expect(await owner.chat.count({ where: { id: subject.chatId } })).toBe(0);
      expect(await owner.thread.count({ where: { id: subject.threadId } })).toBe(0);
      expect(await owner.event.count({ where: { chatId: subject.chatId } })).toBe(0);
      expect(await owner.visit.count({ where: { customerId: subject.customerId } })).toBe(0);
      expect(await owner.channelIdentity.count({ where: { customerId: subject.customerId } })).toBe(
        0,
      );
    });

    it('deletes the ticket rather than unlinking it — its subject line is the person’s own words', async () => {
      // The FK is `ON DELETE SET NULL`, so doing nothing would leave a ticket
      // titled "Refund for order 001" in the grid with a null customer. That is
      // the failure nobody would find: the contact is gone from the directory,
      // so no one goes looking for what is left behind.
      const subject = await seedSubject(fx.a);

      await erase(subject.customerId);

      expect(await owner.ticket.count({ where: { id: subject.ticketId } })).toBe(0);
    });

    it('leaves a tracked sale standing, unlinked — accounting is not a statement about the person', async () => {
      // Art. 17(3)'s carve-out, and the schema's `SET NULL` already implements
      // it. Pinned so a later "erase everything that mentions them" does not
      // quietly rewrite revenue an invoice was based on.
      const subject = await seedSubject(fx.a);
      const sale = await owner.trackedSale.create({
        data: {
          licenseId: fx.a.licenseId,
          customerId: subject.customerId,
          externalOrderId: `order-${Date.now()}`,
          amountCents: 4900,
          currency: 'USD',
        },
        select: { id: true },
      });

      await erase(subject.customerId);

      const after = await owner.trackedSale.findUnique({
        where: { id: sale.id },
        select: { customerId: true, amountCents: true },
      });
      expect(after?.amountCents).toBe(4900);
      expect(after?.customerId).toBeNull();
    });

    it('touches nobody else’s record', async () => {
      const erased = await seedSubject(fx.a);
      const bystander = await seedSubject(fx.a);

      await erase(erased.customerId);

      expect(await owner.customer.count({ where: { id: bystander.customerId } })).toBe(1);
      expect(await owner.chat.count({ where: { id: bystander.chatId } })).toBe(1);
      expect(await owner.event.count({ where: { chatId: bystander.chatId } })).toBe(2);
    });

    it('is a 404 the second time — there is nothing left to erase', async () => {
      const subject = await seedSubject(fx.a);

      expect((await erase(subject.customerId)).statusCode).toBe(200);
      expect((await erase(subject.customerId)).statusCode).toBe(404);
      // And the retry writes no second entry: one erasure, one record.
      expect(
        await owner.auditLogEntry.count({
          where: { licenseId: fx.a.licenseId, action: 'data.subject_erased' },
        }),
      ).toBe(1);
    });
  });

  // ==========================================================================
  // The trail (NFR-S12)
  // ==========================================================================

  describe('the audit entry is the receipt, and carries nothing that was erased', () => {
    it('records one entry with the id, the actor and the counts', async () => {
      const subject = await seedSubject(fx.a);

      await erase(subject.customerId);

      const entries = await owner.auditLogEntry.findMany({
        where: { licenseId: fx.a.licenseId, action: 'data.subject_erased' },
      });
      expect(entries).toHaveLength(1);
      expect(entries[0]?.target).toBe(`customer:${subject.customerId}`);
      expect(entries[0]?.actorId).toBe(fx.a.ownerAccountId);
      expect(entries[0]?.metadata).toMatchObject({
        chats: 1,
        threads: 1,
        events: 2,
        visits: 1,
        tickets: 1,
        channel_identities: 1,
      });
    });

    it('never copies the name, e-mail or a message into the append-only log', async () => {
      // The entry outlives the request and the retention window. Writing any of
      // the erased data into it would undo the erasure while recording that it
      // was honoured — which is worse than not recording it at all.
      const subject = await seedSubject(fx.a);
      const before = await owner.customer.findUniqueOrThrow({
        where: { id: subject.customerId },
        select: { name: true, email: true },
      });

      await erase(subject.customerId);

      const entry = await owner.auditLogEntry.findFirstOrThrow({
        where: { licenseId: fx.a.licenseId, action: 'data.subject_erased' },
      });
      // The WHOLE row, not a chosen field — the point is that nothing anywhere
      // on it carries the erased data, including a column somebody adds later.
      // `licenseId` is a bigint, which `JSON.stringify` refuses, so it is
      // widened rather than skipped: dropping it would be the first step toward
      // a scan that quietly skips whatever it cannot serialise.
      const serialised = JSON.stringify(entry, (_key, value) =>
        typeof value === 'bigint' ? value.toString() : value,
      );
      expect(serialised).not.toContain(before.name!);
      expect(serialised).not.toContain(before.email!);
      expect(serialised).not.toContain('message 1');
    });
  });

  // ==========================================================================
  // "erişim ≠ silme" — authority
  // ==========================================================================

  describe('a reading authority cannot erase', () => {
    it('refuses full customer read/write, which does not imply the erasure scope', async () => {
      const subject = await seedSubject(fx.a);
      const token = await grantToken(owner, {
        licenseId: fx.a.licenseId,
        organizationId: fx.a.organizationId,
        ownerId: fx.a.ownerAccountId,
        scopes: ['customers:rw', 'customers.ban:rw'],
      });

      const response = await erase(subject.customerId, token);

      expect(response.statusCode).toBe(403);
      // UNCHANGED, not merely refused.
      expect(await owner.customer.count({ where: { id: subject.customerId } })).toBe(1);
      expect(await owner.chat.count({ where: { id: subject.chatId } })).toBe(1);
    });

    it('refuses an agent-role credential holding the scope', async () => {
      // The role gate, read fresh on every request (tm 146). An agent works the
      // inbox; answering the workspace's compliance post is an admin's job.
      const subject = await seedSubject(fx.a);
      const token = await grantToken(owner, {
        licenseId: fx.a.licenseId,
        organizationId: fx.a.organizationId,
        ownerId: fx.a.agentAccountId,
        scopes: ['customers.erase:rw'],
      });

      expect((await erase(subject.customerId, token)).statusCode).toBe(403);
      expect(await owner.customer.count({ where: { id: subject.customerId } })).toBe(1);
    });

    it('is unreachable without a credential', async () => {
      const subject = await seedSubject(fx.a);

      const response = await server.post(`/customers/${subject.customerId}/erase`);

      expect(response.statusCode).toBe(401);
      expect(await owner.customer.count({ where: { id: subject.customerId } })).toBe(1);
    });
  });

  // ==========================================================================
  // Cross-tenant (NFR-S4 / NFR-S5)
  // ==========================================================================

  describe('one workspace cannot erase another’s customer', () => {
    it('answers 404 — not 403 — and leaves the row standing', async () => {
      // 404 rather than 403 so an id cannot be probed for existence: a 403
      // would confirm the uuid names somebody real in another workspace.
      const inB = await seedSubject(fx.b);

      const response = await erase(inB.customerId);

      expect(response.statusCode).toBe(404);
      expect(await owner.customer.count({ where: { id: inB.customerId } })).toBe(1);
      expect(await owner.chat.count({ where: { id: inB.chatId } })).toBe(1);
      expect(await owner.event.count({ where: { chatId: inB.chatId } })).toBe(2);
      expect(
        await owner.auditLogEntry.count({
          where: { action: 'data.subject_erased' },
        }),
      ).toBe(0);
    });
  });

  // ==========================================================================
  // The live-conversation refusal
  // ==========================================================================

  describe('a live conversation is closed first', () => {
    it('refuses with a reason, and deletes nothing', async () => {
      // The same invariant the sweep holds — it only ever prunes a thread that
      // is closed. Erasing a chat two open sockets are holding would reach the
      // visitor as a broken widget rather than as anything anyone chose.
      const subject = await seedSubject(fx.a, { activeChat: true });

      const response = await erase(subject.customerId);

      expect(response.statusCode).toBe(403);
      expect(
        (response.json() as { error: { details?: Record<string, unknown> } }).error.details,
      ).toMatchObject({ reason: 'active_chat', active_chats: 1 });
      expect(await owner.customer.count({ where: { id: subject.customerId } })).toBe(1);
      expect(await owner.chat.count({ where: { id: subject.chatId } })).toBe(1);
      expect(await owner.ticket.count({ where: { id: subject.ticketId } })).toBe(1);
    });

    it('succeeds once the conversation is closed', async () => {
      const subject = await seedSubject(fx.a, { activeChat: true });
      await owner.chat.update({ where: { id: subject.chatId }, data: { active: false } });
      await owner.thread.update({
        where: { id: subject.threadId },
        data: { active: false, closedAt: new Date() },
      });

      expect((await erase(subject.customerId)).statusCode).toBe(200);
      expect(await owner.customer.count({ where: { id: subject.customerId } })).toBe(0);
    });
  });
});
