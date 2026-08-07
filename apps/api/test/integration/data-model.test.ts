/**
 * Data model invariants.
 *
 * These assert the rules the database enforces on its own, independently of any
 * application code. That distinction matters: an invariant checked only in a
 * service is one concurrent request away from being violated, and the resulting
 * corruption — two active chats, a thread that is both open and closed — is
 * permanent and hard to detect after the fact.
 *
 * Attacks and races first; the happy path only proves the schema is usable.
 */
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { generateShortId, buildEventId, DEFAULT_WORK_SCHEDULE } from '@nexa/types';
import { withTenant } from '../../src/lib/tenant.js';
import { ownerClient, seedFixtures, type Fixtures } from '../helpers/fixtures.js';

const APP_URL = process.env['DATABASE_APP_URL'];

describe('data model invariants', () => {
  let owner: PrismaClient;
  let app: PrismaClient;
  let fx: Fixtures;

  beforeAll(() => {
    owner = ownerClient();
    app = new PrismaClient({ datasourceUrl: APP_URL });
  });

  afterAll(async () => {
    await Promise.all([owner.$disconnect(), app.$disconnect()]);
  });

  beforeEach(async () => {
    fx = await seedFixtures(owner);
  });

  /** Create a chat with one open thread, as the application would. */
  async function openChat(tenant = fx.a, customerId = fx.a.customerId) {
    const chatId = generateShortId();
    const threadId = generateShortId();
    await owner.chat.create({
      data: { id: chatId, licenseId: tenant.licenseId, customerId, active: true },
    });
    await owner.thread.create({
      data: { id: threadId, chatId, licenseId: tenant.licenseId, active: true },
    });
    return { chatId, threadId };
  }

  // =========================================================================
  // The one-active-chat rule
  // =========================================================================

  describe('one active chat per license + customer', () => {
    it('refuses a second active chat for the same customer', async () => {
      await openChat();
      await expect(
        owner.chat.create({
          data: {
            id: generateShortId(),
            licenseId: fx.a.licenseId,
            customerId: fx.a.customerId,
            active: true,
          },
        }),
      ).rejects.toThrow(/uq_one_active_chat|Unique constraint/i);
    });

    it('holds against a concurrent race, not just a sequential check', async () => {
      // The realistic failure: a visitor double-clicks and two `start_chat`
      // requests interleave. An application-level "does one exist?" check would
      // let both through — only a database constraint stops this.
      const attempts = Array.from({ length: 8 }, () =>
        owner.chat
          .create({
            data: {
              id: generateShortId(),
              licenseId: fx.a.licenseId,
              customerId: fx.a.customerId,
              active: true,
            },
          })
          .then(
            () => 'created' as const,
            () => 'rejected' as const,
          ),
      );

      const results = await Promise.all(attempts);
      expect(results.filter((r) => r === 'created')).toHaveLength(1);
    });

    it('allows a new chat once the previous one is closed', async () => {
      const { chatId } = await openChat();
      await owner.chat.update({ where: { id: chatId }, data: { active: false } });

      await expect(
        owner.chat.create({
          data: {
            id: generateShortId(),
            licenseId: fx.a.licenseId,
            customerId: fx.a.customerId,
            active: true,
          },
        }),
      ).resolves.toBeDefined();
    });

    it('allows any number of closed chats for the same customer', async () => {
      for (let i = 0; i < 3; i++) {
        await owner.chat.create({
          data: {
            id: generateShortId(),
            licenseId: fx.a.licenseId,
            customerId: fx.a.customerId,
            active: false,
          },
        });
      }
      expect(
        await owner.chat.count({ where: { customerId: fx.a.customerId, active: false } }),
      ).toBe(3);
    });

    it('scopes the rule to a license, not globally', async () => {
      // The same person contacting two different workspaces must be able to
      // have an open conversation with each.
      const shared = await owner.customer.create({
        data: { organizationId: fx.a.organizationId, name: 'Shared' },
        select: { id: true },
      });
      await owner.chat.create({
        data: {
          id: generateShortId(),
          licenseId: fx.a.licenseId,
          customerId: shared.id,
          active: true,
        },
      });

      const otherLicense = await owner.license.create({
        data: { organizationId: fx.a.organizationId },
        select: { id: true },
      });
      await expect(
        owner.chat.create({
          data: {
            id: generateShortId(),
            licenseId: otherLicense.id,
            customerId: shared.id,
            active: true,
          },
        }),
      ).resolves.toBeDefined();
    });
  });

  // =========================================================================
  // Thread invariants
  // =========================================================================

  describe('threads', () => {
    it('refuses a second active thread on one chat', async () => {
      const { chatId } = await openChat();
      await expect(
        owner.thread.create({
          data: { id: generateShortId(), chatId, licenseId: fx.a.licenseId, active: true },
        }),
      ).rejects.toThrow(/uq_one_active_thread|Unique constraint/i);
    });

    it('allows a new thread after the previous one closes — this is "resume"', async () => {
      const { chatId, threadId } = await openChat();
      await owner.thread.update({
        where: { id: threadId },
        data: { active: false, closedAt: new Date() },
      });

      await expect(
        owner.thread.create({
          data: { id: generateShortId(), chatId, licenseId: fx.a.licenseId, active: true },
        }),
      ).resolves.toBeDefined();
    });

    it('refuses an active thread that carries a closed timestamp', async () => {
      const { chatId } = await openChat(fx.b, fx.b.customerId);
      await expect(
        owner.thread.create({
          data: {
            id: generateShortId(),
            chatId,
            licenseId: fx.b.licenseId,
            active: true,
            closedAt: new Date(),
          },
        }),
      ).rejects.toThrow(/threads_closed_consistency_check/i);
    });

    it('refuses a closed thread with no closed timestamp', async () => {
      const { chatId } = await openChat(fx.b, fx.b.customerId);
      await expect(
        owner.thread.create({
          data: { id: generateShortId(), chatId, licenseId: fx.b.licenseId, active: false },
        }),
      ).rejects.toThrow(/threads_closed_consistency_check/i);
    });

    it('refuses a negative queue position', async () => {
      const { chatId } = await openChat(fx.b, fx.b.customerId);
      await expect(
        owner.thread.create({
          data: {
            id: generateShortId(),
            chatId,
            licenseId: fx.b.licenseId,
            active: true,
            queuePosition: -1,
          },
        }),
      ).rejects.toThrow(/threads_queue_position_check/i);
    });
  });

  // =========================================================================
  // Events: partitioning and constraints
  // =========================================================================

  describe('events', () => {
    async function addEvent(
      overrides: Partial<{
        type: string;
        authorType: string;
        recipients: string;
        createdAt: Date;
      }> = {},
    ) {
      const { chatId, threadId } = await openChat();
      return owner.event.create({
        data: {
          id: buildEventId(threadId, 1),
          threadId,
          chatId,
          licenseId: fx.a.licenseId,
          type: overrides.type ?? 'message',
          text: 'hello',
          authorType: overrides.authorType ?? 'customer',
          recipients: overrides.recipients ?? 'all',
          ...(overrides.createdAt ? { createdAt: overrides.createdAt } : {}),
        },
      });
    }

    it.each([
      ['type', { type: 'telepathy' }, /events_type_check/i],
      ['author_type', { authorType: 'ghost' }, /events_author_type_check/i],
      ['recipients', { recipients: 'everyone' }, /events_recipients_check/i],
    ])('rejects an invalid %s', async (_label, overrides, pattern) => {
      await expect(addEvent(overrides)).rejects.toThrow(pattern);
    });

    it('routes a row into the partition for its month', async () => {
      const created = await addEvent();
      const [row] = await owner.$queryRaw<Array<{ partition: string }>>`
        SELECT tableoid::regclass::text AS partition
        FROM events WHERE id = ${created.id}
      `;
      const expected = `events_${created.createdAt.toISOString().slice(0, 7).replace('-', '_')}`;
      expect(row?.partition).toBe(expected);
    });

    it('prunes partitions when a query is bounded by time', async () => {
      // The whole reason for partitioning: a transcript query must not touch
      // years of history. If pruning stops working this stays green
      // functionally while getting quietly slower forever — so assert the plan.
      const [plan] = await owner.$queryRaw<Array<{ 'QUERY PLAN': string }>>`
        EXPLAIN (FORMAT TEXT)
        SELECT * FROM events
        WHERE license_id = ${fx.a.licenseId}
          AND created_at >= now() - INTERVAL '2 days'
      `;
      expect(JSON.stringify(plan)).not.toMatch(/events_2027_01/);
    });

    it('creates a missing partition on demand', async () => {
      const future = new Date(Date.UTC(2029, 4, 15));
      const name = `events_2029_05`;

      const before = await owner.$queryRaw<Array<{ exists: boolean }>>`
        SELECT to_regclass(${`public.${name}`}) IS NOT NULL AS exists
      `;
      expect(before[0]?.exists).toBe(false);

      await owner.$queryRaw`SELECT events_ensure_partition(${future}::timestamptz)`;

      const after = await owner.$queryRaw<Array<{ exists: boolean }>>`
        SELECT to_regclass(${`public.${name}`}) IS NOT NULL AS exists
      `;
      expect(after[0]?.exists).toBe(true);

      await owner.$executeRawUnsafe(`DROP TABLE IF EXISTS ${name}`);
    });

    it('is idempotent when the partition already exists', async () => {
      const when = new Date();
      await expect(
        owner.$queryRaw`SELECT events_ensure_partition(${when}::timestamptz)`,
      ).resolves.toBeDefined();
      await expect(
        owner.$queryRaw`SELECT events_ensure_partition(${when}::timestamptz)`,
      ).resolves.toBeDefined();
    });

    it('keeps a far-future row instead of losing it', async () => {
      // Clock skew or a bad import must not throw away a customer's message.
      // The DEFAULT partition catches anything outside the rolling window.
      const created = await addEvent({ createdAt: new Date(Date.UTC(2098, 0, 1)) });
      const [row] = await owner.$queryRaw<Array<{ partition: string }>>`
        SELECT tableoid::regclass::text AS partition FROM events WHERE id = ${created.id}
      `;
      expect(row?.partition).toBe('events_default');
    });

    it('orders events within a thread by sequence, not by timestamp', async () => {
      const { chatId, threadId } = await openChat();
      const sameInstant = new Date();

      for (const sequence of [1, 2, 3, 10, 11]) {
        await owner.event.create({
          data: {
            id: buildEventId(threadId, sequence),
            threadId,
            chatId,
            licenseId: fx.a.licenseId,
            type: 'message',
            text: `#${sequence}`,
            authorType: 'customer',
            // Identical timestamps: bulk imports and fast typing both do this.
            createdAt: sameInstant,
          },
        });
      }

      const events = await owner.event.findMany({
        where: { threadId },
        orderBy: { id: 'asc' },
        select: { id: true },
      });
      // Lexical ordering puts _10 before _2 — which is exactly why the
      // application sorts on the parsed sequence rather than the raw id.
      expect(events.map((e) => e.id.split('_')[1])).toEqual(['1', '10', '11', '2', '3']);
    });
  });

  // =========================================================================
  // channel_messages(license_id, chat_id) index (07.5-c · NFR-P2)
  // =========================================================================

  describe('channel messages', () => {
    it('has an index the channel dimension join can use, not a sequential scan', async () => {
      // The reports breakdown's channel dimension (07.5-d) filters this table by
      // (license_id, chat_id). A handful of seeded rows is too small for the
      // planner to ever prefer an index scan on cost alone, so seqscan is
      // disabled for the plan to prove the index — not the row count — is what
      // makes this query cheap.
      const { chatId } = await openChat();
      await owner.channelMessage.create({
        data: {
          licenseId: fx.a.licenseId,
          channelType: 'whatsapp',
          direction: 'inbound',
          externalId: 'wamid.explain-test',
          chatId,
          text: 'hello',
        },
      });

      const [plan] = await owner.$transaction(async (tx) => {
        await tx.$executeRawUnsafe('SET LOCAL enable_seqscan = off');
        return tx.$queryRaw<Array<{ 'QUERY PLAN': string }>>`
          EXPLAIN (FORMAT TEXT)
          SELECT * FROM channel_messages
          WHERE license_id = ${fx.a.licenseId} AND chat_id = ${chatId}
        `;
      });
      expect(JSON.stringify(plan)).not.toMatch(/Seq Scan/);
      expect(JSON.stringify(plan)).toMatch(/channel_messages_license_id_chat_id_idx/);
    });
  });

  // =========================================================================
  // Tenant isolation on the new tables
  // =========================================================================

  describe('row level security', () => {
    it('covers every tenant table', async () => {
      const rows = await app.$queryRaw<Array<{ tablename: string; rowsecurity: boolean }>>`
        SELECT tablename, rowsecurity FROM pg_tables
        WHERE schemaname = 'public'
          AND tablename <> '_prisma_migrations'
          AND tablename NOT LIKE 'events\\_%'
      `;
      const unprotected = rows.filter((r) => !r.rowsecurity).map((r) => r.tablename);
      expect(unprotected).toEqual([]);
      expect(rows.length).toBeGreaterThan(30);
    });

    it("hides another tenant's chats, threads and events", async () => {
      const mine = await openChat(fx.a, fx.a.customerId);
      const theirs = await openChat(fx.b, fx.b.customerId);
      for (const { chatId, threadId, licenseId } of [
        { ...mine, licenseId: fx.a.licenseId },
        { ...theirs, licenseId: fx.b.licenseId },
      ]) {
        await owner.event.create({
          data: {
            id: buildEventId(threadId, 1),
            threadId,
            chatId,
            licenseId,
            type: 'message',
            text: 'hello',
            authorType: 'customer',
          },
        });
      }

      const visible = await withTenant(
        app,
        { licenseId: fx.a.licenseId, organizationId: fx.a.organizationId },
        async (tx) => ({
          chats: await tx.chat.findMany({ select: { id: true } }),
          threads: await tx.thread.findMany({ select: { id: true } }),
          events: await tx.event.findMany({ select: { chatId: true } }),
        }),
      );

      expect(visible.chats.map((c) => c.id)).toEqual([mine.chatId]);
      expect(visible.threads.map((t) => t.id)).toEqual([mine.threadId]);
      expect(visible.events.every((e) => e.chatId === mine.chatId)).toBe(true);
    });

    it('hides chat_users and chat_access, which have no license column', async () => {
      // These inherit visibility through their chat, which is the kind of
      // indirect policy that is easy to get wrong.
      const theirs = await openChat(fx.b, fx.b.customerId);
      await owner.chatUser.create({
        data: { chatId: theirs.chatId, userId: fx.b.agentAccountId, userType: 'agent' },
      });
      await owner.chatAccess.create({ data: { chatId: theirs.chatId, groupId: 1n } });

      const visible = await withTenant(
        app,
        { licenseId: fx.a.licenseId, organizationId: fx.a.organizationId },
        async (tx) => ({
          users: await tx.chatUser.count(),
          access: await tx.chatAccess.count(),
        }),
      );
      expect(visible).toEqual({ users: 0, access: 0 });
    });

    it('refuses to write an event into another tenant', async () => {
      const theirs = await openChat(fx.b, fx.b.customerId);
      await expect(
        withTenant(app, { licenseId: fx.a.licenseId, organizationId: fx.a.organizationId }, (tx) =>
          tx.event.create({
            data: {
              id: buildEventId(theirs.threadId, 99),
              threadId: theirs.threadId,
              chatId: theirs.chatId,
              licenseId: fx.b.licenseId,
              type: 'message',
              text: 'injected',
              authorType: 'agent',
            },
          }),
        ),
      ).rejects.toThrow(/row-level security/i);
    });

    it('keeps the audit log append-only', async () => {
      // An actor who can edit the audit log can erase what they did.
      await withTenant(
        app,
        { licenseId: fx.a.licenseId, organizationId: fx.a.organizationId },
        (tx) =>
          tx.auditLogEntry.create({
            data: { licenseId: fx.a.licenseId, action: 'agent.login', actorType: 'agent' },
          }),
      );

      await expect(
        withTenant(app, { licenseId: fx.a.licenseId, organizationId: fx.a.organizationId }, (tx) =>
          tx.auditLogEntry.updateMany({ data: { action: 'nothing.happened' } }),
        ),
      ).rejects.toThrow(/permission denied|policy/i);

      await expect(
        withTenant(app, { licenseId: fx.a.licenseId, organizationId: fx.a.organizationId }, (tx) =>
          tx.auditLogEntry.deleteMany({}),
        ),
      ).rejects.toThrow(/permission denied|policy/i);
    });
  });

  // =========================================================================
  // Agent expertise (skill-based routing — FR-MOD-08.6.3)
  // =========================================================================

  describe('agent expertise', () => {
    it('has RLS enabled and a tenant policy on both tables', async () => {
      // The KK for 08.6.3-a: the catalogue exists, is protected, and carries a
      // policy — the same shape "covers every tenant table" asserts in bulk,
      // named here so a regression points straight at this slice.
      const security = await owner.$queryRaw<Array<{ relname: string; enabled: boolean }>>`
        SELECT relname, relrowsecurity AS enabled FROM pg_class
        WHERE relname IN ('expertise', 'agent_expertise')
        ORDER BY relname
      `;
      expect(security).toEqual([
        { relname: 'agent_expertise', enabled: true },
        { relname: 'expertise', enabled: true },
      ]);

      const policies = await owner.$queryRaw<Array<{ tablename: string; policyname: string }>>`
        SELECT tablename, policyname FROM pg_policies
        WHERE tablename IN ('expertise', 'agent_expertise')
        ORDER BY tablename
      `;
      expect(policies).toEqual([
        { tablename: 'agent_expertise', policyname: 'agent_expertise_tenant' },
        { tablename: 'expertise', policyname: 'expertise_tenant' },
      ]);
    });

    it('keeps an expertise slug unique per license — a re-seed cannot duplicate it', async () => {
      // What makes the demo seed idempotent at the catalogue level: the same
      // (license, slug) can exist once, so running the seed twice can never add
      // a fourth area. The same slug under a *different* license is fine.
      await owner.expertise.create({
        data: { licenseId: fx.a.licenseId, name: 'Billing', slug: 'billing' },
      });
      await expect(
        owner.expertise.create({
          data: { licenseId: fx.a.licenseId, name: 'Billing again', slug: 'billing' },
        }),
      ).rejects.toThrow(/unique|duplicate/i);

      // Same slug, other tenant: allowed, because the key is (license, slug).
      await expect(
        owner.expertise.create({
          data: { licenseId: fx.b.licenseId, name: 'Billing', slug: 'billing' },
        }),
      ).resolves.toBeDefined();
    });

    it("hides another tenant's expertise and assignments", async () => {
      const mine = await owner.expertise.create({
        data: { licenseId: fx.a.licenseId, name: 'Onboarding', slug: 'onboarding' },
        select: { id: true },
      });
      const theirs = await owner.expertise.create({
        data: { licenseId: fx.b.licenseId, name: 'Onboarding', slug: 'onboarding' },
        select: { id: true },
      });
      await owner.agentExpertise.create({
        data: { licenseId: fx.a.licenseId, agentId: fx.a.ownerAccountId, expertiseId: mine.id },
      });
      await owner.agentExpertise.create({
        data: { licenseId: fx.b.licenseId, agentId: fx.b.ownerAccountId, expertiseId: theirs.id },
      });

      const visible = await withTenant(
        app,
        { licenseId: fx.a.licenseId, organizationId: fx.a.organizationId },
        async (tx) => ({
          expertise: await tx.expertise.findMany({ select: { id: true } }),
          links: await tx.agentExpertise.findMany({ select: { expertiseId: true } }),
        }),
      );
      expect(visible.expertise.map((e) => e.id)).toEqual([mine.id]);
      expect(visible.links.map((l) => l.expertiseId)).toEqual([mine.id]);
    });

    it('drops an expertise together with its assignments (composite FK cascade)', async () => {
      const area = await owner.expertise.create({
        data: { licenseId: fx.a.licenseId, name: 'Technical', slug: 'technical' },
        select: { id: true },
      });
      await owner.agentExpertise.create({
        data: { licenseId: fx.a.licenseId, agentId: fx.a.agentAccountId, expertiseId: area.id },
      });

      await owner.expertise.delete({
        where: { licenseId_id: { licenseId: fx.a.licenseId, id: area.id } },
      });

      const orphans = await owner.agentExpertise.count({
        where: { licenseId: fx.a.licenseId, expertiseId: area.id },
      });
      expect(orphans).toBe(0);
    });
  });

  // =========================================================================
  // Work scheduler (staffing — PRD §5.3-Vardiya)
  // =========================================================================

  describe('work scheduler', () => {
    /** The plan `normalizeWorkSchedule` produces for a single working Monday. */
    const oneDay = [{ day: 'monday', start: '09:00', end: '18:00', enabled: true }];

    it('has RLS enabled and a tenant policy on both tables', async () => {
      // The KK-derived isolation clause for WORKSCHED-b: the tables exist, are
      // protected, and carry a policy. Asserted here by name so a regression
      // points straight at this slice rather than at the bulk sweep.
      const security = await owner.$queryRaw<Array<{ relname: string; enabled: boolean }>>`
        SELECT relname, relrowsecurity AS enabled FROM pg_class
        WHERE relname IN ('work_schedules', 'agent_presence_events')
        ORDER BY relname
      `;
      expect(security).toEqual([
        { relname: 'agent_presence_events', enabled: true },
        { relname: 'work_schedules', enabled: true },
      ]);

      const policies = await owner.$queryRaw<Array<{ tablename: string; policyname: string }>>`
        SELECT tablename, policyname FROM pg_policies
        WHERE tablename IN ('work_schedules', 'agent_presence_events')
        ORDER BY tablename
      `;
      expect(policies).toEqual([
        { tablename: 'agent_presence_events', policyname: 'agent_presence_events_tenant' },
        { tablename: 'work_schedules', policyname: 'work_schedules_tenant' },
      ]);
    });

    it('indexes presence history by license, agent and time', async () => {
      // Every reader of this table asks the same question — one agent's
      // transitions inside one workspace over a window. Without the index that
      // becomes a sequential scan over an append-only log that only ever grows,
      // so the forecast gets slower every day it runs.
      const [index] = await owner.$queryRaw<Array<{ indexdef: string }>>`
        SELECT indexdef FROM pg_indexes
        WHERE tablename = 'agent_presence_events'
          AND indexname = 'agent_presence_events_license_id_agent_id_changed_at_idx'
      `;
      expect(index?.indexdef).toMatch(/license_id.*agent_id.*changed_at/s);
    });

    it('refuses a schedule that is not a JSON array', async () => {
      // A `{"monday": …}` object would pass Prisma's `Json` type and only fail
      // later, inside whichever reader called `.map()` on it.
      await expect(
        owner.$executeRaw`
          INSERT INTO work_schedules (license_id, agent_id, timezone, schedule, updated_at)
          VALUES (${fx.a.licenseId}, ${fx.a.agentAccountId}::uuid, 'UTC',
                  '{"monday":"09:00"}'::jsonb, now())
        `,
      ).rejects.toThrow(/work_schedules_schedule_is_array_check/i);
    });

    it('refuses a presence status outside the routing domain', async () => {
      // The forecast counts statuses. An unrecognised one would either be
      // dropped or, worse, counted as available — over-reporting coverage.
      await expect(
        owner.agentPresenceEvent.create({
          data: {
            licenseId: fx.a.licenseId,
            agentId: fx.a.agentAccountId,
            status: 'on_holiday',
          },
        }),
      ).rejects.toThrow(/agent_presence_events_status_check/i);

      for (const status of ['accepting_chats', 'not_accepting_chats', 'offline']) {
        await expect(
          owner.agentPresenceEvent.create({
            data: { licenseId: fx.a.licenseId, agentId: fx.a.agentAccountId, status },
          }),
        ).resolves.toBeDefined();
      }
    });

    it('holds one plan per agent per license, and lets the same agent differ across licenses', async () => {
      // The key is (license, agent) like agent_memberships: an agent working in
      // two workspaces is rostered independently in each, but cannot have two
      // conflicting plans in the same one.
      await owner.workSchedule.create({
        data: {
          licenseId: fx.a.licenseId,
          agentId: fx.a.agentAccountId,
          timezone: 'Europe/Istanbul',
          schedule: oneDay,
        },
      });
      await expect(
        owner.workSchedule.create({
          data: { licenseId: fx.a.licenseId, agentId: fx.a.agentAccountId, schedule: oneDay },
        }),
      ).rejects.toThrow(/unique constraint/i);

      // The same account, rostered under the other license: a different row.
      await owner.agentMembership.create({
        data: { licenseId: fx.b.licenseId, agentId: fx.a.agentAccountId, role: 'agent' },
      });
      await expect(
        owner.workSchedule.create({
          data: {
            licenseId: fx.b.licenseId,
            agentId: fx.a.agentAccountId,
            timezone: 'Europe/Berlin',
            schedule: oneDay,
          },
        }),
      ).resolves.toBeDefined();
    });

    it('round-trips a plan through Prisma with the timezone default applied', async () => {
      // The happy path, last: the models are usable and the column default
      // matches DEFAULT_WORK_SCHEDULE.timezone value-for-value.
      const saved = await owner.workSchedule.create({
        data: { licenseId: fx.a.licenseId, agentId: fx.a.ownerAccountId, schedule: oneDay },
      });
      expect(saved.timezone).toBe(DEFAULT_WORK_SCHEDULE.timezone);
      expect(saved.schedule).toEqual(oneDay);

      const event = await owner.agentPresenceEvent.create({
        data: {
          licenseId: fx.a.licenseId,
          agentId: fx.a.ownerAccountId,
          status: 'accepting_chats',
        },
      });
      expect(event.changedAt).toBeInstanceOf(Date);
    });

    it('takes rosters and presence history with the license (onDelete cascade)', async () => {
      // Both tables are tenant data: erasing a workspace must not leave its
      // agents' working patterns behind (NFR-C9).
      await owner.workSchedule.create({
        data: { licenseId: fx.b.licenseId, agentId: fx.b.agentAccountId, schedule: oneDay },
      });
      await owner.agentPresenceEvent.create({
        data: { licenseId: fx.b.licenseId, agentId: fx.b.agentAccountId, status: 'offline' },
      });

      await owner.license.delete({ where: { id: fx.b.licenseId } });

      expect(await owner.workSchedule.count({ where: { licenseId: fx.b.licenseId } })).toBe(0);
      expect(await owner.agentPresenceEvent.count({ where: { licenseId: fx.b.licenseId } })).toBe(
        0,
      );
    });
  });

  // =========================================================================
  // Brands (Multibrand — PRD §5.3 / NFR-S4)
  // =========================================================================

  describe('brands', () => {
    it('holds exactly one default brand per license — a second default is rejected', async () => {
      // The migration backfill and the seed give every license exactly one
      // default brand; the partial unique index is what guarantees a second can
      // never be added, however the race is run.
      await owner.brand.create({
        data: { licenseId: fx.a.licenseId, name: 'Default', slug: 'default', isDefault: true },
      });
      const defaults = await owner.brand.count({
        where: { licenseId: fx.a.licenseId, isDefault: true },
      });
      expect(defaults).toBe(1);

      await expect(
        owner.brand.create({
          data: { licenseId: fx.a.licenseId, name: 'Second', slug: 'second', isDefault: true },
        }),
      ).rejects.toThrow(/unique constraint/i);
    });

    it('allows more than one non-default brand for a license', async () => {
      // Only the default is capped at one; a license may carry many brands.
      await owner.brand.createMany({
        data: [
          { licenseId: fx.a.licenseId, name: 'Default', slug: 'default', isDefault: true },
          { licenseId: fx.a.licenseId, name: 'Acme EU', slug: 'acme-eu' },
          { licenseId: fx.a.licenseId, name: 'Acme US', slug: 'acme-us' },
        ],
      });
      const count = await owner.brand.count({ where: { licenseId: fx.a.licenseId } });
      expect(count).toBe(3);
    });

    it('scopes slug uniqueness to a license, not globally', async () => {
      await owner.brand.create({
        data: { licenseId: fx.a.licenseId, name: 'Default', slug: 'default', isDefault: true },
      });
      // Same slug under a different license is fine — the constraint is per-license.
      await owner.brand.create({
        data: { licenseId: fx.b.licenseId, name: 'Default', slug: 'default', isDefault: true },
      });
      // A duplicate slug within the same license is not.
      await expect(
        owner.brand.create({ data: { licenseId: fx.a.licenseId, name: 'Dup', slug: 'default' } }),
      ).rejects.toThrow(/unique constraint/i);
    });

    it('is removed when its license is deleted (onDelete cascade)', async () => {
      await owner.brand.create({
        data: { licenseId: fx.b.licenseId, name: 'Default', slug: 'default', isDefault: true },
      });
      await owner.license.delete({ where: { id: fx.b.licenseId } });
      const remaining = await owner.brand.count({ where: { licenseId: fx.b.licenseId } });
      expect(remaining).toBe(0);
    });
  });

  // =========================================================================
  // Referential integrity
  // =========================================================================

  describe('cascades', () => {
    it('removes the whole conversation tree with the organization', async () => {
      const { chatId, threadId } = await openChat();
      await owner.event.create({
        data: {
          id: buildEventId(threadId, 1),
          threadId,
          chatId,
          licenseId: fx.a.licenseId,
          type: 'message',
          text: 'hi',
          authorType: 'customer',
        },
      });

      await owner.organization.delete({ where: { id: fx.a.organizationId } });

      expect(await owner.chat.count({ where: { id: chatId } })).toBe(0);
      expect(await owner.thread.count({ where: { id: threadId } })).toBe(0);
      expect(await owner.event.count({ where: { chatId } })).toBe(0);
      // The other tenant is untouched.
      expect(await owner.license.count({ where: { id: fx.b.licenseId } })).toBe(1);
    });

    it('keeps a ticket when the chat it came from is deleted', async () => {
      // A ticket outlives its source conversation — losing the ticket because
      // the chat was purged would drop work the team still owes the customer.
      const { chatId } = await openChat();
      const ticketId = generateShortId();
      await owner.ticket.create({
        data: {
          id: ticketId,
          licenseId: fx.a.licenseId,
          customerId: fx.a.customerId,
          sourceChatId: chatId,
          subject: 'Refund',
        },
      });

      await owner.chat.delete({ where: { id: chatId } });

      const ticket = await owner.ticket.findUnique({ where: { id: ticketId } });
      expect(ticket).not.toBeNull();
      expect(ticket?.sourceChatId).toBeNull();
    });
  });

  // =========================================================================
  // pgvector
  // =========================================================================

  describe('knowledge retrieval', () => {
    it('finds the nearest chunk by cosine distance', async () => {
      const aiAgent = await owner.aiAgent.create({
        data: { licenseId: fx.a.licenseId, name: 'Helper', kind: 'ai_agent' },
        select: { id: true },
      });
      const source = await owner.knowledgeSource.create({
        data: {
          aiAgentId: aiAgent.id,
          licenseId: fx.a.licenseId,
          type: 'article',
          name: 'Refund policy',
        },
        select: { id: true },
      });

      // Three orthogonal unit vectors — the nearest neighbour is unambiguous.
      const vectors = [
        { text: 'refunds take 5 days', axis: 0 },
        { text: 'we ship worldwide', axis: 1 },
        { text: 'opening hours are 9-5', axis: 2 },
      ];
      for (const { text, axis } of vectors) {
        const embedding = Array.from({ length: 1536 }, (_, i) => (i === axis ? 1 : 0));
        await owner.$executeRawUnsafe(
          `INSERT INTO knowledge_chunks (id, source_id, license_id, chunk_text, embedding, position)
           VALUES (gen_random_uuid(), $1::uuid, $2::bigint, $3, $4::vector, $5)`,
          source.id,
          fx.a.licenseId.toString(),
          text,
          `[${embedding.join(',')}]`,
          axis,
        );
      }

      const query = `[${Array.from({ length: 1536 }, (_, i) => (i === 1 ? 1 : 0)).join(',')}]`;
      const nearest = await owner.$queryRawUnsafe<Array<{ chunk_text: string }>>(
        `SELECT chunk_text FROM knowledge_chunks
         WHERE license_id = $1::bigint
         ORDER BY embedding <=> $2::vector
         LIMIT 1`,
        fx.a.licenseId.toString(),
        query,
      );
      expect(nearest[0]?.chunk_text).toBe('we ship worldwide');
    });

    it('rejects an embedding of the wrong dimension', async () => {
      const aiAgent = await owner.aiAgent.create({
        data: { licenseId: fx.a.licenseId, name: 'Helper', kind: 'ai_agent' },
        select: { id: true },
      });
      const source = await owner.knowledgeSource.create({
        data: { aiAgentId: aiAgent.id, licenseId: fx.a.licenseId, type: 'faq', name: 'FAQ' },
        select: { id: true },
      });

      // A model swap that changes embedding width must fail loudly rather than
      // silently poisoning retrieval.
      await expect(
        owner.$executeRawUnsafe(
          `INSERT INTO knowledge_chunks (id, source_id, license_id, chunk_text, embedding)
           VALUES (gen_random_uuid(), $1::uuid, $2::bigint, 'wrong', $3::vector)`,
          source.id,
          fx.a.licenseId.toString(),
          `[${Array.from({ length: 768 }, () => 0).join(',')}]`,
        ),
      ).rejects.toThrow(/expected 1536 dimensions/i);
    });
  });

  // =========================================================================
  // Remaining constraints
  // =========================================================================

  describe('configuration constraints', () => {
    it('allows only one fallback routing rule per license and kind', async () => {
      await owner.routingRule.create({
        data: { licenseId: fx.a.licenseId, kind: 'chat', isFallback: true },
      });
      await expect(
        owner.routingRule.create({
          data: { licenseId: fx.a.licenseId, kind: 'chat', isFallback: true },
        }),
      ).rejects.toThrow(/uq_one_fallback_routing_rule|Unique constraint/i);

      // A different kind is a different rule set.
      await expect(
        owner.routingRule.create({
          data: { licenseId: fx.a.licenseId, kind: 'ticket', isFallback: true },
        }),
      ).resolves.toBeDefined();
    });

    it('refuses a non-fallback rule that targets no team', async () => {
      await expect(
        owner.routingRule.create({
          data: { licenseId: fx.a.licenseId, kind: 'chat', isFallback: false },
        }),
      ).rejects.toThrow(/routing_rules_target_check/i);
    });

    it('refuses a webhook url that is not http(s)', async () => {
      for (const url of ['ftp://example.com/hook', 'file:///etc/passwd', 'javascript:alert(1)']) {
        await expect(
          owner.webhook.create({
            data: {
              licenseId: fx.a.licenseId,
              url,
              action: 'incoming_chat',
              secretKey: 'x'.repeat(32),
            },
          }),
        ).rejects.toThrow(/webhooks_url_check/i);
      }
    });

    it('refuses skill steps that are not a JSON array', async () => {
      await expect(
        owner.$executeRaw`
          INSERT INTO skills (id, license_id, name, kind, steps, updated_at)
          VALUES (gen_random_uuid(), ${fx.a.licenseId}, 'bad', 'ai_agent', '{"not":"array"}'::jsonb, now())
        `,
      ).rejects.toThrow(/skills_steps_is_array_check/i);
    });

    it('refuses a usage period that is not yyyymm', async () => {
      await expect(
        owner.usageRecord.create({
          data: { licenseId: fx.a.licenseId, metric: 'ai_resolutions', period: '2026-0' },
        }),
      ).rejects.toThrow(/usage_records_period_check/i);
    });

    it('keeps usage unique per license, metric and period', async () => {
      await owner.usageRecord.create({
        data: { licenseId: fx.a.licenseId, metric: 'ai_resolutions', period: '202607' },
      });
      await expect(
        owner.usageRecord.create({
          data: { licenseId: fx.a.licenseId, metric: 'ai_resolutions', period: '202607' },
        }),
      ).rejects.toThrow(/Unique constraint/i);
    });

    it('refuses a canned response shortcut containing whitespace', async () => {
      await expect(
        owner.cannedResponse.create({
          data: { licenseId: fx.a.licenseId, shortcut: 'two words', text: 'hi' },
        }),
      ).rejects.toThrow(/canned_responses_shortcut_check/i);
    });

    it('refuses a campaign window that ends before it starts', async () => {
      await expect(
        owner.campaign.create({
          data: {
            licenseId: fx.a.licenseId,
            name: 'Backwards',
            startsAt: new Date('2026-08-01'),
            endsAt: new Date('2026-07-01'),
          },
        }),
      ).rejects.toThrow(/campaigns_window_check/i);
    });

    it('refuses an invalid group priority', async () => {
      const group = await owner.group.create({
        data: { licenseId: fx.a.licenseId, name: 'Support' },
        select: { id: true },
      });
      await expect(
        owner.groupAgent.create({
          data: {
            licenseId: fx.a.licenseId,
            groupId: group.id,
            agentId: fx.a.agentAccountId,
            priority: 'vip',
          },
        }),
      ).rejects.toThrow(/group_agents_priority_check/i);
    });
  });
});
