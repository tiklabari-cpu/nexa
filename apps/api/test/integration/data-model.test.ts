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
    it('covers every tenant table, partitions included', async () => {
      // The `events` partitions used to be exempted from this sweep, and the
      // exemption hid a real hole: RLS on a partitioned parent governs access
      // *through* the parent, so `SELECT * FROM events_2026_08` was checked
      // against that partition's own — absent — policies and handed back every
      // tenant's rows. Counting them here means a month opened by the
      // partition scheduler has to arrive protected or this turns red.
      const rows = await app.$queryRaw<Array<{ tablename: string; rowsecurity: boolean }>>`
        SELECT tablename, rowsecurity FROM pg_tables
        WHERE schemaname = 'public'
          AND tablename <> '_prisma_migrations'
      `;
      const unprotected = rows.filter((r) => !r.rowsecurity).map((r) => r.tablename);
      expect(unprotected).toEqual([]);
      expect(rows.length).toBeGreaterThan(30);
      // The sweep is only a guard if it actually reached the partitions.
      expect(rows.filter((r) => /^events_/.test(r.tablename)).length).toBeGreaterThan(1);
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

    it('hides events from the runtime role when a partition is named directly', async () => {
      // The sibling test above reads through `events`, which is the only way
      // application code ever reaches an event. This one goes around it: the
      // runtime role can name a partition, and a partitioned parent's policies
      // do not govern that path. Both tenants write, so "nothing came back"
      // cannot be an artefact of an empty table.
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

      // Ask the planner which partition took the rows rather than deriving the
      // name from today's date: the test then follows the schema instead of
      // restating it, and keeps working when the partitioning scheme changes.
      const [routed] = await owner.$queryRaw<Array<{ partition: string }>>`
        SELECT DISTINCT tableoid::regclass::text AS partition FROM events
      `;
      const partition = routed?.partition ?? '';
      expect(partition).toMatch(/^events_(\d{4}_\d{2}|default)$/);

      // No tenant context at all — the shape of an unscoped query that slipped
      // past `withTenant`. Before the partitions carried their own policy this
      // returned both tenants' rows.
      const leaked = await app.$queryRawUnsafe<Array<{ count: number }>>(
        `SELECT count(*)::int AS count FROM public."${partition}"`,
      );
      expect(leaked[0]?.count).toBe(0);

      // The other half of the proof: a policy that denies everything would also
      // return zero. With the context set, the same partition yields this
      // tenant's row and only this tenant's row, and the parent still reads.
      const scoped = await withTenant(
        app,
        { licenseId: fx.a.licenseId, organizationId: fx.a.organizationId },
        async (tx) => ({
          direct: await tx.$queryRawUnsafe<Array<{ licenseId: bigint }>>(
            `SELECT license_id AS "licenseId" FROM public."${partition}"`,
          ),
          throughParent: await tx.event.findMany({ select: { chatId: true } }),
        }),
      );
      expect(scoped.direct.map((r) => r.licenseId)).toEqual([fx.a.licenseId]);
      expect(scoped.throughParent.map((e) => e.chatId)).toEqual([mine.chatId]);

      // And the deny is durable rather than a side effect of a missing grant:
      // `ALTER DEFAULT PRIVILEGES` hands DML on every new table back to the
      // runtime role, so only a policy survives the next month's partition.
      const [policy] = await owner.$queryRaw<Array<{ qual: string; withCheck: string | null }>>`
        SELECT qual, with_check AS "withCheck" FROM pg_policies
        WHERE schemaname = 'public' AND tablename = ${partition}
      `;
      expect(policy?.qual).toMatch(/nexa_current_license/);
      expect(policy?.withCheck).toMatch(/nexa_current_license/);
    });

    it('opens a future month through the maintenance scheduler with relrowsecurity already on, not just via a direct events_ensure_partition call', async () => {
      // `plugins/database.ts` never calls events_ensure_partition on its own —
      // it calls events_maintain_partitions on boot and every six hours, which
      // loops over a window of months and calls events_ensure_partition once
      // per month. S4-PART-a proved a direct events_ensure_partition call is
      // born secured; this proves the function the scheduler actually runs
      // reaches the same guard for a month that scheduler would open.
      //
      // The offset is chosen far outside both the app's 3-month window
      // (PARTITION_MONTHS_AHEAD) and the domain migration's one-off 6-month
      // seed, so this month cannot already exist from an earlier step in this
      // suite or from migrating the test database.
      const monthsAhead = 14;
      const future = new Date();
      future.setUTCMonth(future.getUTCMonth() + monthsAhead);
      const name = `events_${future.getUTCFullYear()}_${String(future.getUTCMonth() + 1).padStart(2, '0')}`;

      const before = await owner.$queryRaw<Array<{ exists: boolean }>>`
        SELECT to_regclass(${`public.${name}`}) IS NOT NULL AS exists
      `;
      expect(before[0]?.exists).toBe(false);

      // events_ensure_partition is SECURITY INVOKER and nexa_app has no CREATE
      // privilege on schema public (a pre-existing, separate gap — see tm
      // 150.1's handoff note), so an out-of-window month can only be opened by
      // a privileged connection. That is run here as `owner`, standing in for
      // whatever privileged path actually opens a month that far out.
      await owner.$queryRaw`SELECT events_maintain_partitions(${monthsAhead}::int, 1::int)`;

      const after = await owner.$queryRaw<Array<{ exists: boolean }>>`
        SELECT to_regclass(${`public.${name}`}) IS NOT NULL AS exists
      `;
      expect(after[0]?.exists).toBe(true);

      const [security] = await owner.$queryRaw<Array<{ relname: string; enabled: boolean }>>`
        SELECT relname, relrowsecurity AS enabled FROM pg_class WHERE relname = ${name}
      `;
      expect(security).toEqual({ relname: name, enabled: true });

      const policies = await owner.$queryRaw<Array<{ policyname: string }>>`
        SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = ${name}
      `;
      expect(policies.map((p) => p.policyname)).toEqual([`${name}_tenant`]);

      await owner.$executeRawUnsafe(`DROP TABLE IF EXISTS ${name}`);
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
  // Chat supervisions (Traffic "Supervise" — FR-MOD-13.2 / FR-MOD-03.1.1)
  // =========================================================================

  describe('chat supervisions', () => {
    it('has RLS enabled and a tenant policy — the KK for 13.2-c', async () => {
      // The whole point of the slice: the table exists, is protected, and
      // carries a policy. Named here rather than left to the bulk sweep above,
      // so a regression points straight at this table.
      const [security] = await owner.$queryRaw<Array<{ relname: string; enabled: boolean }>>`
        SELECT relname, relrowsecurity AS enabled FROM pg_class
        WHERE relname = 'chat_supervisions'
      `;
      expect(security).toEqual({ relname: 'chat_supervisions', enabled: true });

      const policies = await owner.$queryRaw<
        Array<{ policyname: string; qual: string; withCheck: string | null }>
      >`
        SELECT policyname, qual, with_check AS "withCheck" FROM pg_policies
        WHERE tablename = 'chat_supervisions'
      `;
      // Both halves matter and fail independently: `qual` is what hides another
      // tenant's rows on read, `with_check` is what refuses to plant one.
      expect(policies).toHaveLength(1);
      expect(policies[0]?.policyname).toBe('chat_supervisions_tenant');
      expect(policies[0]?.qual).toMatch(/nexa_current_license/);
      expect(policies[0]?.withCheck).toMatch(/nexa_current_license/);
    });

    it('keys a supervision by (chat, agent) and indexes the board read', async () => {
      const indexes = await owner.$queryRaw<Array<{ indexname: string; indexdef: string }>>`
        SELECT indexname, indexdef FROM pg_indexes
        WHERE tablename = 'chat_supervisions' ORDER BY indexname
      `;
      const byName = new Map(indexes.map((i) => [i.indexname, i.indexdef]));

      // One row per watcher per chat: the primary key is what makes re-opening
      // the same panel an update instead of a second supervisor.
      expect(byName.get('chat_supervisions_pkey')).toMatch(/\(chat_id, agent_id\)/);
      // 13.2-e reads "recently seen, in this license" every board refresh; the
      // DESC order is what lets that come out of the index.
      expect(byName.get('chat_supervisions_license_id_last_seen_at_idx')).toMatch(
        /\(license_id, last_seen_at DESC\)/,
      );
    });

    it('cascades from all three ends — a row can never outlive what it names', async () => {
      // A supervision is meaningful only while chat, agent and license all
      // exist; an orphan names a watcher of nothing.
      const constraints = await owner.$queryRaw<
        Array<{ column: string; foreignTable: string; deleteRule: string }>
      >`
        SELECT kcu.column_name AS "column",
               ccu.table_name  AS "foreignTable",
               rc.delete_rule  AS "deleteRule"
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON kcu.constraint_name = tc.constraint_name
        JOIN information_schema.constraint_column_usage ccu
          ON ccu.constraint_name = tc.constraint_name
        JOIN information_schema.referential_constraints rc
          ON rc.constraint_name = tc.constraint_name
        WHERE tc.table_name = 'chat_supervisions' AND tc.constraint_type = 'FOREIGN KEY'
        ORDER BY kcu.column_name
      `;
      expect(constraints).toEqual([
        { column: 'agent_id', foreignTable: 'accounts', deleteRule: 'CASCADE' },
        { column: 'chat_id', foreignTable: 'chats', deleteRule: 'CASCADE' },
        { column: 'license_id', foreignTable: 'licenses', deleteRule: 'CASCADE' },
      ]);
    });

    it('drops a supervision with the chat it watches', async () => {
      const { chatId } = await openChat();
      await owner.chatSupervision.create({
        data: { chatId, agentId: fx.a.agentAccountId, licenseId: fx.a.licenseId },
      });

      await owner.chat.delete({ where: { id: chatId } });

      expect(await owner.chatSupervision.count({ where: { chatId } })).toBe(0);
    });

    it('refuses a second row for the same watcher, and allows a second watcher', async () => {
      const { chatId } = await openChat();
      await owner.chatSupervision.create({
        data: { chatId, agentId: fx.a.agentAccountId, licenseId: fx.a.licenseId },
      });

      await expect(
        owner.chatSupervision.create({
          data: { chatId, agentId: fx.a.agentAccountId, licenseId: fx.a.licenseId },
        }),
      ).rejects.toThrow(/unique|duplicate/i);

      // A chat may be watched by more than one person — the key is the pair.
      await expect(
        owner.chatSupervision.create({
          data: { chatId, agentId: fx.a.ownerAccountId, licenseId: fx.a.licenseId },
        }),
      ).resolves.toBeDefined();
    });

    it('lets the runtime role register, heartbeat and release its own row', async () => {
      // Live state, not a record of something that happened: unlike audit_log
      // there is nothing to withhold, and 13.2-d needs all four verbs.
      const { chatId } = await openChat();
      const heartbeat = new Date('2026-08-10T09:00:00.000Z');

      const released = await withTenant(
        app,
        { licenseId: fx.a.licenseId, organizationId: fx.a.organizationId },
        async (tx) => {
          const registered = await tx.chatSupervision.create({
            data: { chatId, agentId: fx.a.agentAccountId, licenseId: fx.a.licenseId },
          });
          const beat = await tx.chatSupervision.update({
            where: { chatId_agentId: { chatId, agentId: fx.a.agentAccountId } },
            data: { lastSeenAt: heartbeat },
          });
          expect(beat.lastSeenAt).toEqual(heartbeat);
          // started_at survives the heartbeat — how long someone has been
          // watching is a different fact from whether they still are.
          expect(beat.startedAt).toEqual(registered.startedAt);

          await tx.chatSupervision.delete({
            where: { chatId_agentId: { chatId, agentId: fx.a.agentAccountId } },
          });
          return tx.chatSupervision.count({});
        },
      );
      expect(released).toBe(0);
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
  // Scheduled report exports (PRD §5.3-Reports · 07.9-sched)
  // =========================================================================

  describe('scheduled report exports', () => {
    /** A usable definition for tenant A — the caller overrides what it is testing. */
    function definition(overrides: Record<string, unknown> = {}) {
      return {
        licenseId: fx.a.licenseId,
        groupId: 'overview',
        frequency: 'weekly',
        recipients: ['ops@acme.test'],
        ...overrides,
      };
    }

    /** A run of `reportId` covering one day, so only the period key varies. */
    function run(reportId: string, periodKey: string, overrides: Record<string, unknown> = {}) {
      return {
        licenseId: fx.a.licenseId,
        scheduledReportId: reportId,
        periodKey,
        periodFrom: new Date('2026-07-31T00:00:00Z'),
        periodTo: new Date('2026-08-01T00:00:00Z'),
        ...overrides,
      };
    }

    it('delivers a period at most once (the claim constraint)', async () => {
      // The KK-derived idempotency clause. The scheduler inserts the run row
      // *before* mailing, so this rejection is how a second sweep — a retry, an
      // overlapping cron, a second API instance — learns the period is taken.
      // Without it the same report goes out twice to real mailboxes.
      const report = await owner.scheduledReport.create({
        data: definition({ frequency: 'daily' }),
        select: { id: true },
      });
      await owner.scheduledReportRun.create({ data: run(report.id, '2026-07-31') });

      await expect(
        owner.scheduledReportRun.create({ data: run(report.id, '2026-07-31') }),
      ).rejects.toThrow(/unique constraint/i);

      // The next period is a different claim, not a duplicate.
      await expect(
        owner.scheduledReportRun.create({
          data: run(report.id, '2026-08-01', {
            periodFrom: new Date('2026-08-01T00:00:00Z'),
            periodTo: new Date('2026-08-02T00:00:00Z'),
          }),
        }),
      ).resolves.toBeDefined();
    });

    it('holds the claim against a concurrent race, not just a sequential check', async () => {
      // Two sweeps starting in the same second is the realistic case: an
      // operator run (07.9-sched-f) while the scheduler ticks. Exactly one
      // insert may win.
      const report = await owner.scheduledReport.create({
        data: definition(),
        select: { id: true },
      });

      const attempts = Array.from({ length: 8 }, () =>
        owner.scheduledReportRun
          .create({ data: run(report.id, '2026-W31') })
          .then(() => 'created' as const)
          .catch(() => 'rejected' as const),
      );
      const results = await Promise.all(attempts);

      expect(results.filter((r) => r === 'created')).toHaveLength(1);
      expect(
        await owner.scheduledReportRun.count({ where: { scheduledReportId: report.id } }),
      ).toBe(1);
    });

    it('has RLS enabled and a tenant policy on both tables', async () => {
      // The KK-derived isolation clause for 07.9-sched-a: the tables exist, are
      // protected, and carry a policy. Asserted by name so a regression points
      // at this slice rather than at the bulk sweep.
      const security = await owner.$queryRaw<Array<{ relname: string; enabled: boolean }>>`
        SELECT relname, relrowsecurity AS enabled FROM pg_class
        WHERE relname IN ('scheduled_reports', 'scheduled_report_runs')
        ORDER BY relname
      `;
      expect(security).toEqual([
        { relname: 'scheduled_report_runs', enabled: true },
        { relname: 'scheduled_reports', enabled: true },
      ]);

      const policies = await owner.$queryRaw<Array<{ tablename: string; policyname: string }>>`
        SELECT tablename, policyname FROM pg_policies
        WHERE tablename IN ('scheduled_reports', 'scheduled_report_runs')
        ORDER BY tablename
      `;
      expect(policies).toEqual([
        { tablename: 'scheduled_report_runs', policyname: 'scheduled_report_runs_tenant' },
        { tablename: 'scheduled_reports', policyname: 'scheduled_reports_tenant' },
      ]);
    });

    it('grants the runtime role its privileges — and withholds DELETE on runs', async () => {
      // A deletable run is a way to release a claimed period and mail the same
      // report twice, so the API role can resolve a run but never erase one.
      const grants = await owner.$queryRaw<Array<{ table_name: string; privilege_type: string }>>`
        SELECT table_name, privilege_type FROM information_schema.role_table_grants
        WHERE grantee = 'nexa_app'
          AND table_name IN ('scheduled_reports', 'scheduled_report_runs')
        ORDER BY table_name, privilege_type
      `;
      const byTable = (name: string) =>
        grants.filter((g) => g.table_name === name).map((g) => g.privilege_type);

      expect(byTable('scheduled_reports').sort()).toEqual(['DELETE', 'INSERT', 'SELECT', 'UPDATE']);
      expect(byTable('scheduled_report_runs').sort()).toEqual(['INSERT', 'SELECT', 'UPDATE']);
    });

    it('indexes the sweep and the history read', async () => {
      // The scheduler asks one question of the definitions ("which of this
      // license's schedules are live?") and the history screen asks one of the
      // runs. Both are the indexes below; without them each sweep degrades into
      // a scan of an append-only log.
      const indexes = await owner.$queryRaw<Array<{ indexname: string; indexdef: string }>>`
        SELECT indexname, indexdef FROM pg_indexes
        WHERE tablename IN ('scheduled_reports', 'scheduled_report_runs')
        ORDER BY indexname
      `;
      const definitionOf = (name: string) => indexes.find((i) => i.indexname === name)?.indexdef;

      expect(definitionOf('scheduled_reports_license_id_enabled_idx')).toMatch(
        /license_id.*enabled/s,
      );
      expect(
        definitionOf('scheduled_report_runs_license_id_scheduled_report_id_create_idx'),
      ).toMatch(/license_id.*scheduled_report_id.*created_at/s);
    });

    it('refuses a frequency the period key cannot be derived from', async () => {
      // 'hourly' has no period label, so a run of it could not be deduplicated:
      // the schedule would either never fire or fire without a claim.
      await expect(
        owner.scheduledReport.create({ data: definition({ frequency: 'hourly' }) }),
      ).rejects.toThrow(/scheduled_reports_frequency_check/i);

      for (const frequency of ['daily', 'weekly', 'monthly']) {
        await expect(
          owner.scheduledReport.create({ data: definition({ frequency }) }),
        ).resolves.toBeDefined();
      }
    });

    it('refuses a definition with no recipients', async () => {
      // Not a harmless no-op: the run still claims its period, so the report is
      // recorded as delivered while nobody ever received it.
      await expect(
        owner.scheduledReport.create({ data: definition({ recipients: [] }) }),
      ).rejects.toThrow(/scheduled_reports_recipients_not_empty_check/i);
    });

    it('refuses a period key outside the three deterministic shapes', async () => {
      // The quiet catastrophe this guards: a free-form or empty key collapses
      // every period onto one row, so after the first delivery the unique
      // constraint rejects every later period and the report is never sent again.
      const report = await owner.scheduledReport.create({
        data: definition(),
        select: { id: true },
      });

      for (const bad of ['', 'last week', '2026-7', '2026-W3', '2026-07-31T00:00:00Z']) {
        await expect(
          owner.scheduledReportRun.create({ data: run(report.id, bad) }),
        ).rejects.toThrow(/scheduled_report_runs_period_key_check/i);
      }

      for (const good of ['2026-07-31', '2026-W31', '2026-07']) {
        await expect(
          owner.scheduledReportRun.create({ data: run(report.id, good) }),
        ).resolves.toBeDefined();
      }
    });

    it('refuses a run status outside the claim lifecycle, and a backwards period', async () => {
      const report = await owner.scheduledReport.create({
        data: definition(),
        select: { id: true },
      });

      await expect(
        owner.scheduledReportRun.create({ data: run(report.id, '2026-07', { status: 'queued' }) }),
      ).rejects.toThrow(/scheduled_report_runs_status_check/i);

      // period_from >= period_to would export an empty window while the row
      // claims a successful delivery.
      await expect(
        owner.scheduledReportRun.create({
          data: run(report.id, '2026-07', {
            periodFrom: new Date('2026-08-01T00:00:00Z'),
            periodTo: new Date('2026-07-31T00:00:00Z'),
          }),
        }),
      ).rejects.toThrow(/scheduled_report_runs_period_range_check/i);
    });

    it('refuses a run that points at another license’s schedule (composite FK)', async () => {
      // The cross-tenant claim RLS cannot catch: the row carries tenant A's
      // license, so `WITH CHECK` is satisfied — but it would occupy tenant B's
      // (schedule, period) slot and stop B's report ever going out for that
      // period. Asserted as the owner, who bypasses RLS entirely, to show the
      // constraint and not the policy is what refuses it.
      const theirs = await owner.scheduledReport.create({
        data: definition({ licenseId: fx.b.licenseId, recipients: ['b@beta.test'] }),
        select: { id: true },
      });

      await expect(
        owner.scheduledReportRun.create({
          data: run(theirs.id, '2026-07', { licenseId: fx.a.licenseId }),
        }),
      ).rejects.toThrow(/foreign key constraint/i);

      // Same row under its own license: accepted. The constraint rejects the
      // mismatch, not the shape.
      await expect(
        owner.scheduledReportRun.create({
          data: run(theirs.id, '2026-07', { licenseId: fx.b.licenseId }),
        }),
      ).resolves.toBeDefined();
    });

    it('takes a definition’s runs with it, and both with the license (cascade)', async () => {
      // Withholding DELETE on runs from nexa_app must not leave orphans behind
      // when a schedule is cancelled: the referential action runs as the table
      // owner, so the cascade still fires.
      const report = await owner.scheduledReport.create({
        data: definition({ licenseId: fx.b.licenseId, recipients: ['b@beta.test'] }),
        select: { id: true },
      });
      await owner.scheduledReportRun.create({
        data: run(report.id, '2026-07', { licenseId: fx.b.licenseId }),
      });

      await owner.scheduledReport.delete({ where: { id: report.id } });
      expect(
        await owner.scheduledReportRun.count({ where: { scheduledReportId: report.id } }),
      ).toBe(0);

      // And erasing the workspace erases both (NFR-C9).
      const survivor = await owner.scheduledReport.create({
        data: definition({ licenseId: fx.b.licenseId, recipients: ['b@beta.test'] }),
        select: { id: true },
      });
      await owner.scheduledReportRun.create({
        data: run(survivor.id, '2026-08', { licenseId: fx.b.licenseId }),
      });

      await owner.license.delete({ where: { id: fx.b.licenseId } });

      expect(await owner.scheduledReport.count({ where: { licenseId: fx.b.licenseId } })).toBe(0);
      expect(await owner.scheduledReportRun.count({ where: { licenseId: fx.b.licenseId } })).toBe(
        0,
      );
    });

    it('round-trips a definition and a run through Prisma with the defaults applied', async () => {
      // The happy path, last: the models are usable and the column defaults are
      // the ones the scheduler assumes — enabled, CSV, claimed-not-yet-sent.
      const report = await owner.scheduledReport.create({ data: definition() });
      expect(report.enabled).toBe(true);
      expect(report.format).toBe('csv');
      expect(report.lastRunAt).toBeNull();
      expect(report.recipients).toEqual(['ops@acme.test']);

      const claimed = await owner.scheduledReportRun.create({ data: run(report.id, '2026-W31') });
      expect(claimed.status).toBe('pending');
      expect(claimed.recipientCount).toBe(0);
      expect(claimed.rowCount).toBe(0);
      expect(claimed.error).toBeNull();
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
  // Purchased API request packages (FR-MOD-09.3 · NFR-S4)
  // =========================================================================

  describe('api package purchases', () => {
    /** An Essential purchase, as 09.3-d's core will write it. */
    const purchase = (overrides: Record<string, unknown> = {}) => ({
      licenseId: fx.a.licenseId,
      packageId: 'essential',
      apiCalls: 100_000n,
      priceCents: 2999,
      period: '202608',
      ...overrides,
    });

    it("hides another tenant's purchases", async () => {
      // What a leak here exposes is money: how much a competitor spends on API
      // capacity, and when they scaled up.
      const mine = await owner.apiPackagePurchase.create({
        data: purchase(),
        select: { id: true },
      });
      const theirs = await owner.apiPackagePurchase.create({
        data: purchase({ licenseId: fx.b.licenseId, packageId: 'pro', apiCalls: 500_000n }),
        select: { id: true },
      });

      const visible = await withTenant(
        app,
        { licenseId: fx.a.licenseId, organizationId: fx.a.organizationId },
        (tx) => tx.apiPackagePurchase.findMany({ select: { id: true } }),
      );
      expect(visible.map((p) => p.id)).toEqual([mine.id]);
      expect(visible.map((p) => p.id)).not.toContain(theirs.id);
    });

    it("refuses to record a purchase against another tenant's license", async () => {
      // The write side of the same boundary, and the worse half: a row written
      // into someone else's license bills them for a package they never asked
      // for — the policy's WITH CHECK is what stops it.
      await expect(
        withTenant(app, { licenseId: fx.a.licenseId, organizationId: fx.a.organizationId }, (tx) =>
          tx.apiPackagePurchase.create({ data: purchase({ licenseId: fx.b.licenseId }) }),
        ),
      ).rejects.toThrow(/row-level security/i);
    });

    it('keeps the record of a sale append-only for the API role', async () => {
      // A purchase is the only surviving evidence of a charge: payment is mocked
      // (ADR-13) so no processor holds a receipt, and the quota it bought is
      // folded into usage_records.included, a running total that remembers
      // nothing about what raised it. An actor who can edit this row can lower
      // the price on an invoice already issued, or delete it and leave the
      // credited quota unexplained.
      await owner.apiPackagePurchase.create({ data: purchase() });

      await expect(
        withTenant(app, { licenseId: fx.a.licenseId, organizationId: fx.a.organizationId }, (tx) =>
          tx.apiPackagePurchase.updateMany({ data: { priceCents: 0 } }),
        ),
      ).rejects.toThrow(/permission denied|policy/i);

      await expect(
        withTenant(app, { licenseId: fx.a.licenseId, organizationId: fx.a.organizationId }, (tx) =>
          tx.apiPackagePurchase.deleteMany({}),
        ),
      ).rejects.toThrow(/permission denied|policy/i);

      // Recording one is still allowed — the grant is narrowed, not closed.
      await expect(
        withTenant(app, { licenseId: fx.a.licenseId, organizationId: fx.a.organizationId }, (tx) =>
          tx.apiPackagePurchase.create({ data: purchase({ packageId: 'pro' }) }),
        ),
      ).resolves.toBeDefined();
    });

    it('has RLS enabled and a tenant policy', async () => {
      // The KK-derived isolation clause for 09.3-b, asserted by name so a
      // regression points at this slice rather than at the bulk sweep above.
      const [security] = await owner.$queryRaw<Array<{ relname: string; enabled: boolean }>>`
        SELECT relname, relrowsecurity AS enabled FROM pg_class
        WHERE relname = 'api_package_purchases'
      `;
      expect(security).toEqual({ relname: 'api_package_purchases', enabled: true });

      const policies = await owner.$queryRaw<Array<{ tablename: string; policyname: string }>>`
        SELECT tablename, policyname FROM pg_policies
        WHERE tablename = 'api_package_purchases'
      `;
      expect(policies).toEqual([
        { tablename: 'api_package_purchases', policyname: 'api_package_purchases_tenant' },
      ]);
    });

    it('grants the runtime role only what recording a sale needs', async () => {
      const grants = await owner.$queryRaw<Array<{ privilege_type: string }>>`
        SELECT privilege_type FROM information_schema.role_table_grants
        WHERE grantee = 'nexa_app' AND table_name = 'api_package_purchases'
      `;
      expect(grants.map((g) => g.privilege_type).sort()).toEqual(['INSERT', 'SELECT']);
    });

    it('indexes the read every consumer makes — one license, one period', async () => {
      // Both readers ask the same question: what did this workspace buy for this
      // billing period (the history list, and the invoice line items). Without
      // the index that is a scan of an append-only ledger that only ever grows.
      const [index] = await owner.$queryRaw<Array<{ indexdef: string }>>`
        SELECT indexdef FROM pg_indexes
        WHERE tablename = 'api_package_purchases'
          AND indexname = 'api_package_purchases_license_id_period_idx'
      `;
      expect(index?.indexdef).toMatch(/license_id.*period/s);
    });

    it('refuses a period that is not yyyymm', async () => {
      // `period` is the join key back to the usage_records row the quota was
      // credited to. A shape those two do not share records a sale against a
      // period nothing bills: money taken, quota credited out of reach.
      for (const period of ['2026-8', '20268', 'august', '      ']) {
        await expect(
          owner.apiPackagePurchase.create({ data: purchase({ period }) }),
        ).rejects.toThrow(/api_package_purchases_period_check/i);
      }
    });

    it('refuses a purchase that buys no calls, or a negative price', async () => {
      // Zero quota is a charge for nothing; a negative price is a refund, and
      // giving quota back means lowering usage_records.included below what has
      // already been spent — a slice that has not been designed yet.
      for (const apiCalls of [0n, -1n]) {
        await expect(
          owner.apiPackagePurchase.create({ data: purchase({ apiCalls }) }),
        ).rejects.toThrow(/api_package_purchases_api_calls_check/i);
      }

      await expect(
        owner.apiPackagePurchase.create({ data: purchase({ priceCents: -1 }) }),
      ).rejects.toThrow(/api_package_purchases_price_cents_check/i);

      // A free package is representable — only a negative one is not.
      await expect(
        owner.apiPackagePurchase.create({ data: purchase({ priceCents: 0 }) }),
      ).resolves.toBeDefined();
    });

    it('is removed when its license is deleted (onDelete cascade)', async () => {
      // NFR-C9: erasing a workspace erases its billing history with it, and the
      // narrowed grant above must not leave orphans behind — the cascade runs as
      // the table owner, not as nexa_app.
      await owner.apiPackagePurchase.create({ data: purchase({ licenseId: fx.b.licenseId }) });
      await owner.license.delete({ where: { id: fx.b.licenseId } });

      expect(await owner.apiPackagePurchase.count({ where: { licenseId: fx.b.licenseId } })).toBe(
        0,
      );
    });

    it('round-trips a purchase through Prisma with the defaults applied', async () => {
      // The happy path, last: the model is usable and records what was sold at
      // the price it was sold for, stamped when it happened.
      const before = Date.now();
      const recorded = await owner.apiPackagePurchase.create({ data: purchase() });

      expect(recorded.packageId).toBe('essential');
      expect(recorded.apiCalls).toBe(100_000n);
      expect(recorded.priceCents).toBe(2999);
      expect(recorded.period).toBe('202608');
      expect(recorded.purchasedAt.getTime()).toBeGreaterThanOrEqual(before - 1000);

      // Several purchases of the same package in the same period are a feature:
      // a package is a one-off top-up, so buying twice buys twice the quota.
      await expect(owner.apiPackagePurchase.create({ data: purchase() })).resolves.toBeDefined();
      expect(await owner.apiPackagePurchase.count({ where: { licenseId: fx.a.licenseId } })).toBe(
        2,
      );
    });
  });

  // =========================================================================
  // Sales tracker (FR-MOD-13.5 · NFR-S4)
  // =========================================================================

  describe('sales tracker', () => {
    /** An order, as the ingest endpoint (13.5-c) will write it. */
    const sale = (overrides: Record<string, unknown> = {}) => ({
      licenseId: fx.a.licenseId,
      externalOrderId: 'order-1',
      amountCents: 4999,
      currency: 'USD',
      ...overrides,
    });

    it('has RLS enabled and a tenant policy on both tables', async () => {
      const security = await owner.$queryRaw<Array<{ relname: string; enabled: boolean }>>`
        SELECT relname, relrowsecurity AS enabled FROM pg_class
        WHERE relname IN ('sales_tracker_settings', 'tracked_sales')
      `;
      expect(security.sort((a, b) => a.relname.localeCompare(b.relname))).toEqual([
        { relname: 'sales_tracker_settings', enabled: true },
        { relname: 'tracked_sales', enabled: true },
      ]);

      const policies = await owner.$queryRaw<Array<{ tablename: string; policyname: string }>>`
        SELECT tablename, policyname FROM pg_policies
        WHERE tablename IN ('sales_tracker_settings', 'tracked_sales')
      `;
      expect(policies.sort((a, b) => a.tablename.localeCompare(b.tablename))).toEqual([
        { tablename: 'sales_tracker_settings', policyname: 'sales_tracker_settings_tenant' },
        { tablename: 'tracked_sales', policyname: 'tracked_sales_tenant' },
      ]);
    });

    it("hides another tenant's tracked sales", async () => {
      // What a leak here exposes is revenue: how much a competitor sells, and
      // through which conversations.
      const mine = await owner.trackedSale.create({ data: sale(), select: { id: true } });
      const theirs = await owner.trackedSale.create({
        data: sale({ licenseId: fx.b.licenseId, externalOrderId: 'order-2' }),
        select: { id: true },
      });

      const visible = await withTenant(
        app,
        { licenseId: fx.a.licenseId, organizationId: fx.a.organizationId },
        (tx) => tx.trackedSale.findMany({ select: { id: true } }),
      );
      expect(visible.map((s) => s.id)).toEqual([mine.id]);
      expect(visible.map((s) => s.id)).not.toContain(theirs.id);
    });

    it("refuses to write a tracked sale into another tenant's license", async () => {
      await expect(
        withTenant(app, { licenseId: fx.a.licenseId, organizationId: fx.a.organizationId }, (tx) =>
          tx.trackedSale.create({ data: sale({ licenseId: fx.b.licenseId }) }),
        ),
      ).rejects.toThrow(/row-level security/i);
    });

    it("hides another tenant's sales tracker settings", async () => {
      await owner.salesTrackerSettings.create({
        data: { licenseId: fx.a.licenseId, enabled: true },
      });
      await owner.salesTrackerSettings.create({
        data: { licenseId: fx.b.licenseId, enabled: true },
      });

      const visible = await withTenant(
        app,
        { licenseId: fx.a.licenseId, organizationId: fx.a.organizationId },
        (tx) => tx.salesTrackerSettings.findMany({ select: { licenseId: true } }),
      );
      expect(visible).toEqual([{ licenseId: fx.a.licenseId }]);
    });

    it('refuses a second order with the same external id in the same license', async () => {
      // The ingest endpoint may see the same order more than once — an
      // at-least-once retry from the merchant's own backend — and a second row
      // would double the sale in every downstream report.
      await owner.trackedSale.create({ data: sale() });
      await expect(owner.trackedSale.create({ data: sale() })).rejects.toThrow(
        /unique constraint/i,
      );

      // The same external id in a different license is not a conflict.
      await expect(
        owner.trackedSale.create({ data: sale({ licenseId: fx.b.licenseId }) }),
      ).resolves.toBeDefined();
    });

    it('refuses a negative order amount', async () => {
      await expect(owner.trackedSale.create({ data: sale({ amountCents: -1 }) })).rejects.toThrow(
        /tracked_sales_amount_cents_check/i,
      );

      // Zero is a representable (fully-discounted) order.
      await expect(
        owner.trackedSale.create({ data: sale({ amountCents: 0 }) }),
      ).resolves.toBeDefined();
    });

    it('refuses a currency that is not a 3-letter code, on both tables', async () => {
      for (const currency of ['US', 'DOLLAR', '']) {
        await expect(owner.trackedSale.create({ data: sale({ currency }) })).rejects.toThrow(
          /tracked_sales_currency_check/i,
        );
      }

      await expect(
        owner.salesTrackerSettings.create({ data: { licenseId: fx.a.licenseId, currency: 'EU' } }),
      ).rejects.toThrow(/sales_tracker_settings_currency_check/i);
    });

    it('refuses a non-positive attribution window', async () => {
      for (const attributionWindowDays of [0, -1]) {
        await expect(
          owner.salesTrackerSettings.create({
            data: { licenseId: fx.a.licenseId, attributionWindowDays },
          }),
        ).rejects.toThrow(/sales_tracker_settings_attribution_window_days_check/i);
      }
    });

    it('drops the chat and customer pointer, not the sale, when either is deleted', async () => {
      // A sale must outlive the chat's retention window and a purged customer —
      // the same choice `goal_achievements.chat_id` already makes.
      const { chatId } = await openChat();
      const recorded = await owner.trackedSale.create({
        data: sale({ chatId, customerId: fx.a.customerId, attributed: true }),
      });

      await owner.chat.delete({ where: { id: chatId } });
      const afterChatDelete = await owner.trackedSale.findUniqueOrThrow({
        where: { id: recorded.id },
      });
      expect(afterChatDelete.chatId).toBeNull();
      expect(afterChatDelete.attributed).toBe(true);

      await owner.customer.delete({ where: { id: fx.a.customerId } });
      const afterCustomerDelete = await owner.trackedSale.findUniqueOrThrow({
        where: { id: recorded.id },
      });
      expect(afterCustomerDelete.customerId).toBeNull();
    });

    it('is removed when its license is deleted (onDelete cascade)', async () => {
      await owner.trackedSale.create({ data: sale({ licenseId: fx.b.licenseId }) });
      await owner.salesTrackerSettings.create({ data: { licenseId: fx.b.licenseId } });
      await owner.license.delete({ where: { id: fx.b.licenseId } });

      expect(await owner.trackedSale.count({ where: { licenseId: fx.b.licenseId } })).toBe(0);
      expect(await owner.salesTrackerSettings.count({ where: { licenseId: fx.b.licenseId } })).toBe(
        0,
      );
    });

    it('round-trips a tracked sale and settings row through Prisma with the defaults applied', async () => {
      const recorded = await owner.trackedSale.create({ data: sale() });
      expect(recorded.attributed).toBe(false);
      expect(recorded.chatId).toBeNull();
      expect(recorded.customerId).toBeNull();

      const settings = await owner.salesTrackerSettings.create({
        data: { licenseId: fx.a.licenseId },
      });
      expect(settings.enabled).toBe(false);
      expect(settings.currency).toBe('USD');
      expect(settings.attributionWindowDays).toBe(7);
    });
  });

  // =========================================================================
  // SSO connections (NFR-S11)
  // =========================================================================

  describe('sso connections', () => {
    /** A PEM block shaped like the certificate an IdP publishes. */
    const PEM = '-----BEGIN CERTIFICATE-----\nMIIB...\n-----END CERTIFICATE-----\n';

    /** A connection as the write endpoint (S11-a2) will store one. */
    const connection = (overrides: Record<string, unknown> = {}) => ({
      licenseId: fx.a.licenseId,
      name: 'Okta (corp)',
      idpEntityId: 'https://idp.example.test/saml/metadata',
      idpSsoUrl: 'https://idp.example.test/saml/sso',
      idpCertificatePem: PEM,
      ...overrides,
    });

    it('has RLS enabled and a tenant policy', async () => {
      const [security] = await owner.$queryRaw<Array<{ enabled: boolean }>>`
        SELECT relrowsecurity AS enabled FROM pg_class WHERE relname = 'sso_connections'
      `;
      expect(security?.enabled).toBe(true);

      const policies = await owner.$queryRaw<Array<{ policyname: string }>>`
        SELECT policyname FROM pg_policies WHERE tablename = 'sso_connections'
      `;
      expect(policies.map((p) => p.policyname)).toEqual(['sso_connections_tenant']);
    });

    it("hides another tenant's connections", async () => {
      // A leak here names the workspace's identity provider — reconnaissance for
      // a targeted phish, and the first half of impersonating their login.
      const mine = await owner.ssoConnection.create({ data: connection(), select: { id: true } });
      const theirs = await owner.ssoConnection.create({
        data: connection({ licenseId: fx.b.licenseId }),
        select: { id: true },
      });

      const visible = await withTenant(
        app,
        { licenseId: fx.a.licenseId, organizationId: fx.a.organizationId },
        (tx) => tx.ssoConnection.findMany({ select: { id: true } }),
      );
      expect(visible.map((c) => c.id)).toEqual([mine.id]);

      // Correct SQL, and the row exists — RLS is what makes it invisible.
      const byId = await withTenant(
        app,
        { licenseId: fx.a.licenseId, organizationId: fx.a.organizationId },
        (tx) => tx.ssoConnection.findUnique({ where: { id: theirs.id } }),
      );
      expect(byId).toBeNull();
    });

    it("refuses to plant an identity provider in another tenant's license (WITH CHECK)", async () => {
      // The write side is the dangerous one: a connection planted in someone
      // else's license is an attacker-controlled certificate against their
      // accounts, which ends in a session rather than in a disclosure.
      await expect(
        withTenant(app, { licenseId: fx.a.licenseId, organizationId: fx.a.organizationId }, (tx) =>
          tx.ssoConnection.create({ data: connection({ licenseId: fx.b.licenseId }) }),
        ),
      ).rejects.toThrow(/row-level security/i);
    });

    it("cannot update or delete another tenant's connection", async () => {
      const theirs = await owner.ssoConnection.create({
        data: connection({ licenseId: fx.b.licenseId }),
      });

      const asA = { licenseId: fx.a.licenseId, organizationId: fx.a.organizationId };
      // Both are `*Many` on purpose: an id-targeted write under RLS matches no
      // row rather than raising, so the proof is that nothing changed.
      const updated = await withTenant(app, asA, (tx) =>
        tx.ssoConnection.updateMany({
          where: { id: theirs.id },
          data: { idpCertificatePem: 'attacker', enabled: true },
        }),
      );
      expect(updated.count).toBe(0);

      const deleted = await withTenant(app, asA, (tx) =>
        tx.ssoConnection.deleteMany({ where: { id: theirs.id } }),
      );
      expect(deleted.count).toBe(0);

      const survivor = await owner.ssoConnection.findUniqueOrThrow({ where: { id: theirs.id } });
      expect(survivor.idpCertificatePem).toBe(PEM);
      expect(survivor.enabled).toBe(false);
    });

    it('refuses a second connection for the same IdP in one license', async () => {
      await owner.ssoConnection.create({ data: connection() });
      await expect(owner.ssoConnection.create({ data: connection() })).rejects.toThrow(
        /unique constraint/i,
      );

      // The same IdP in a different license is not a conflict: two workspaces
      // may well federate to the same Okta tenant.
      await expect(
        owner.ssoConnection.create({ data: connection({ licenseId: fx.b.licenseId }) }),
      ).resolves.toBeDefined();
    });

    it('refuses a blank name or entity id', async () => {
      await expect(
        owner.ssoConnection.create({ data: connection({ name: '  ' }) }),
      ).rejects.toThrow(/sso_connections_name_check/i);
      await expect(
        owner.ssoConnection.create({ data: connection({ idpEntityId: '' }) }),
      ).rejects.toThrow(/sso_connections_idp_entity_id_check/i);
    });

    it('refuses an SSO URL that is not an absolute http(s) URL', async () => {
      // The column is handed to a browser as a redirect target (S11-d), so the
      // scheme surface is closed here rather than trusted to whatever endpoint
      // writes it: a `javascript:` URL would be script execution on our origin.
      for (const idpSsoUrl of [
        'javascript:alert(1)',
        'data:text/html,x',
        '//evil.example/sso',
        '/saml/sso',
        'idp.example.test/sso',
      ]) {
        await expect(
          owner.ssoConnection.create({ data: connection({ idpSsoUrl }) }),
          idpSsoUrl,
        ).rejects.toThrow(/sso_connections_idp_sso_url_check/i);
      }

      // http is allowed at this layer on purpose — requiring TLS is the write
      // endpoint's policy, where a loopback IdP harness can be excepted.
      await expect(
        owner.ssoConnection.create({
          data: connection({ idpSsoUrl: 'http://localhost:9999/sso' }),
        }),
      ).resolves.toBeDefined();
    });

    it('refuses a certificate that is not a PEM certificate block', async () => {
      // A fingerprint or a private key sitting in this column would look like a
      // configured trust anchor while verifying nothing.
      for (const idpCertificatePem of [
        '',
        'AA:BB:CC:DD',
        '-----BEGIN RSA PRIVATE KEY-----\nx\n-----END RSA PRIVATE KEY-----',
      ]) {
        await expect(
          owner.ssoConnection.create({ data: connection({ idpCertificatePem }) }),
          idpCertificatePem,
        ).rejects.toThrow(/sso_connections_idp_certificate_pem_check/i);
      }
    });

    it('refuses an attribute mapping that is not a JSON object', async () => {
      // Read by key. A scalar or an array there makes every lookup silently
      // miss, which reads as "the IdP sent no e-mail" rather than as a mistake.
      for (const attributeMapping of ['email', 42, ['email']]) {
        await expect(
          owner.ssoConnection.create({ data: connection({ attributeMapping }) }),
          JSON.stringify(attributeMapping),
        ).rejects.toThrow(/sso_connections_attribute_mapping_check/i);
      }
    });

    it('is removed when its license is deleted (onDelete cascade)', async () => {
      await owner.ssoConnection.create({ data: connection({ licenseId: fx.b.licenseId }) });
      await owner.license.delete({ where: { id: fx.b.licenseId } });

      expect(await owner.ssoConnection.count({ where: { licenseId: fx.b.licenseId } })).toBe(0);
    });

    it('round-trips a connection through Prisma with the safe defaults applied', async () => {
      const saved = await owner.ssoConnection.create({ data: connection() });

      // Both defaults are "off": a half-written row must never be a way in, and
      // IdP-initiated sign-in gives up the `InResponseTo` binding replay
      // detection rests on, so it is chosen rather than inherited.
      expect(saved.enabled).toBe(false);
      expect(saved.allowIdpInitiated).toBe(false);
      expect(saved.attributeMapping).toEqual({});
      // The certificate is stored as it arrives — public, so nothing is hashed.
      expect(saved.idpCertificatePem).toBe(PEM);
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
