/**
 * The AI conversation state (tm 292.1 · SiyahTuş analysis AI-01 §6, AI-03 §2;
 * ADR-14b §2.7).
 *
 * One `ai_conversations` row per connection holds where the AI is in it, and
 * the AI core builds on four properties of that row — each asserted on its own:
 *
 *   1. The optimistic lock holds — a save lands only at the version it was
 *      read at, the database bumps the version on every write (so an agent's
 *      takeover fences a running turn), and of two turns that read the same
 *      version exactly one writes; the other's transaction, reply included,
 *      rolls back.
 *   2. What only moves one way does — the pinned configuration version (a
 *      null may be filled once, a value never changes) and the read position.
 *   3. It is a tenant record — RLS keeps workspaces apart, and a workspace
 *      cannot hang a conversation on another workspace's thread even under its
 *      own licence (the foreign key alone would let it).
 *   4. The runtime role writes what a turn owns and nothing else; the database
 *      refuses values outside the shared vocabularies; the row goes with its
 *      connection and its customer.
 */
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  AI_CONVERSATION_MODES,
  AI_CONVERSATION_OUTCOMES,
  AI_CONVERSATION_STEP_STATUSES,
  generateShortId,
} from '@siyahtus/types';
import { withTenant, type TenantClient, type TenantContext } from '../../src/lib/tenant.js';
import {
  AI_CONVERSATION_PATCH_FIELDS,
  AiConversationConflictError,
  loadConversation,
  openConversation,
  saveConversation,
  type AiConversationPatch,
  type AiConversationState,
  type ConnectionRef,
} from '../../src/services/ai/conversation/state-store.js';
import {
  ownerClient,
  seedFixtures,
  type Fixtures,
  type TenantFixture,
} from '../helpers/fixtures.js';

const APP_URL = process.env['DATABASE_APP_URL'];
const VERSION_A = '1d2e3f4a-5b6c-4d7e-8f9a-0b1c2d3e4f5a';
const VERSION_B = '6a7b8c9d-0e1f-4a2b-9c3d-4e5f6a7b8c9d';
const HASH = 'a'.repeat(64);

/** A one-shot latch: `open()` resolves `opened`. */
function signal(): { open: () => void; opened: Promise<void> } {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { open, opened };
}

describe('ai_conversations (AI-01 · AI-03)', () => {
  let owner: PrismaClient;
  // Two runtime-role clients, connected up front: a race needs two sessions,
  // and a lazy connect would hand the first turn a head start.
  let app: PrismaClient;
  let app2: PrismaClient;
  let fx: Fixtures;

  const ctx = (t: TenantFixture): TenantContext => ({
    licenseId: t.licenseId,
    organizationId: t.organizationId,
  });

  beforeAll(async () => {
    if (!APP_URL) throw new Error('DATABASE_APP_URL must be set');
    owner = ownerClient();
    app = new PrismaClient({ datasourceUrl: APP_URL });
    app2 = new PrismaClient({ datasourceUrl: APP_URL });
    await Promise.all([app.$connect(), app2.$connect()]);
  });

  afterAll(async () => {
    await Promise.all([owner.$disconnect(), app.$disconnect(), app2.$disconnect()]);
  });

  beforeEach(async () => {
    fx = await seedFixtures(owner);
  });

  // --- 1. The optimistic lock --------------------------------------------------

  describe('the optimistic lock', () => {
    it('opens a row at version 0 on the pinned configuration, and a second open returns it as it was', async () => {
      const ref = await seedConnection(fx.a);

      const opened = await open(fx.a, ref, VERSION_A);
      expect(opened).toMatchObject({
        chatId: ref.chatId,
        threadId: ref.threadId,
        mode: 'ai',
        version: 0,
        lastProcessedEventSeq: 0,
        configVersionId: VERSION_A,
        slots: {},
        counters: {},
        signals: {},
        procedureSnapshot: null,
        closedAt: null,
      });

      // A later open — a newer version published meanwhile — changes nothing.
      const again = await open(fx.a, ref, VERSION_B);
      expect(again).toEqual(opened);
      expect(await owner.aiConversation.count({ where: { threadId: ref.threadId } })).toBe(1);
    });

    it('gives two turns opening the same connection at once the same row', async () => {
      const ref = await seedConnection(fx.a);

      const [one, two] = await Promise.all([
        withTenant(app, ctx(fx.a), (tx) => openConversation(tx, ref, { configVersionId: null })),
        withTenant(app2, ctx(fx.a), (tx) => openConversation(tx, ref, { configVersionId: null })),
      ]);

      expect(one.id).toBe(two.id);
      expect(await owner.aiConversation.count({ where: { threadId: ref.threadId } })).toBe(1);
    });

    it('bumps the version by one on every save and keeps what was written', async () => {
      const ref = await seedConnection(fx.a);
      const s0 = await open(fx.a, ref);

      const s1 = await save(fx.a, s0, {
        lastProcessedEventSeq: 3,
        slots: { method: { value: 'papara', status: 'filled' } },
        counters: { turns: 1 },
      });
      expect(s1.version).toBe(1);
      expect(s1.updatedAt.getTime()).toBeGreaterThanOrEqual(s0.updatedAt.getTime());

      const s2 = await save(fx.a, s1, { stepId: 'ask_time', stepStatus: 'awaiting_answer' });
      expect(s2.version).toBe(2);

      const reloaded = await load(fx.a, ref);
      expect(reloaded).toEqual(s2);
      expect(reloaded).toMatchObject({
        lastProcessedEventSeq: 3,
        slots: { method: { value: 'papara', status: 'filled' } },
        counters: { turns: 1 },
        stepId: 'ask_time',
        stepStatus: 'awaiting_answer',
      });
    });

    it('refuses a save at a stale version and leaves the row as the first writer left it', async () => {
      const ref = await seedConnection(fx.a);
      const s0 = await open(fx.a, ref);
      await save(fx.a, s0, { lastProcessedEventSeq: 3 });

      const failure = await save(fx.a, s0, { lastProcessedEventSeq: 5 }).catch((e: unknown) => e);

      expect(failure).toBeInstanceOf(AiConversationConflictError);
      expect(failure).toMatchObject({ conversationId: s0.id, expectedVersion: 0 });
      expect(await load(fx.a, ref)).toMatchObject({ version: 1, lastProcessedEventSeq: 3 });
    });

    it('lets one of two turns that read the same version write; the other turn and its reply roll back', async () => {
      const ref = await seedConnection(fx.a);
      const read = await open(fx.a, ref);

      // Turn one saves and holds its transaction open; turn two's save has to
      // queue behind the row lock, then finds the version gone.
      const firstSaved = signal();
      const commitFirst = signal();
      const first = withTenant(app, ctx(fx.a), async (tx) => {
        await reply(tx, ref, 'first');
        const saved = await saveConversation(tx, read, { lastProcessedEventSeq: 3 });
        firstSaved.open();
        await commitFirst.opened;
        return saved;
      });
      await Promise.race([firstSaved.opened, first]);
      const second = withTenant(app2, ctx(fx.a), async (tx) => {
        await reply(tx, ref, 'second');
        return saveConversation(tx, read, { lastProcessedEventSeq: 4 });
      }).catch((e: unknown) => e);

      try {
        await waitForLockWait();
      } finally {
        commitFirst.open();
      }

      const [won, lost] = await Promise.all([first, second]);
      expect(won.version).toBe(1);
      expect(lost).toBeInstanceOf(AiConversationConflictError);
      expect(await load(fx.a, ref)).toMatchObject({ version: 1, lastProcessedEventSeq: 3 });
      // The loser's reply went down with its save.
      const replies = await owner.aiDecisionLog.findMany({
        where: { threadId: ref.threadId },
        select: { details: true },
      });
      expect(replies).toEqual([{ details: { turn: 'first' } }]);
    });

    it('has exactly one winner per round when two turns race freely', async () => {
      const ref = await seedConnection(fx.a);
      let state = await open(fx.a, ref);

      for (let round = 1; round <= 8; round += 1) {
        const read = state;
        const results = await Promise.allSettled([
          withTenant(app, ctx(fx.a), (tx) =>
            saveConversation(tx, read, { counters: { turns: round, by: 'one' } }),
          ),
          withTenant(app2, ctx(fx.a), (tx) =>
            saveConversation(tx, read, { counters: { turns: round, by: 'two' } }),
          ),
        ]);
        const won = results.filter((r) => r.status === 'fulfilled');
        const lost = results.filter((r) => r.status === 'rejected');
        expect(won).toHaveLength(1);
        expect(lost).toHaveLength(1);
        expect((lost[0] as PromiseRejectedResult).reason).toBeInstanceOf(
          AiConversationConflictError,
        );
        state = (won[0] as PromiseFulfilledResult<AiConversationState>).value;
        expect(state.version).toBe(round);
      }
    });

    it('fences a running turn when anyone writes the row meanwhile — an agent taking over (AI-11)', async () => {
      const ref = await seedConnection(fx.a);
      const turnRead = await open(fx.a, ref);

      // The takeover writes without knowing any version; the database bumps it.
      await withTenant(app, ctx(fx.a), (tx) =>
        tx.aiConversation.updateMany({
          where: { threadId: ref.threadId },
          data: { mode: 'human', modeReason: 'agent_takeover', modeChangedAt: new Date() },
        }),
      );

      await expect(save(fx.a, turnRead, { lastProcessedEventSeq: 3 })).rejects.toBeInstanceOf(
        AiConversationConflictError,
      );
      expect(await load(fx.a, ref)).toMatchObject({
        version: 1,
        mode: 'human',
        lastProcessedEventSeq: 0,
      });
    });
  });

  // --- 2. What only moves one way ---------------------------------------------

  describe('one-way columns', () => {
    it('never moves the read position back', async () => {
      const ref = await seedConnection(fx.a);
      const s1 = await save(fx.a, await open(fx.a, ref), { lastProcessedEventSeq: 7 });

      await expect(save(fx.a, s1, { lastProcessedEventSeq: 3 })).rejects.toThrow(
        /last_processed_event_seq cannot move back/,
      );
      // Standing still is fine.
      expect(
        await save(fx.a, s1, { lastProcessedEventSeq: 7, counters: { turns: 2 } }),
      ).toMatchObject({ lastProcessedEventSeq: 7, version: 2 });
    });

    it('fills a null configuration version once and never changes a pinned one (ADR-14b §2.7)', async () => {
      const ref = await seedConnection(fx.a);
      const unpinned = await open(fx.a, ref);
      expect(unpinned.configVersionId).toBeNull();

      const pinned = await save(fx.a, unpinned, { configVersionId: VERSION_A });
      expect(pinned.configVersionId).toBe(VERSION_A);

      await expect(save(fx.a, pinned, { configVersionId: VERSION_B })).rejects.toThrow(
        /config_version_id is pinned/,
      );
      await expect(save(fx.a, pinned, { configVersionId: null })).rejects.toThrow(
        /config_version_id is pinned/,
      );
      // Not even the owner rewrites it.
      await expect(
        owner.aiConversation.update({
          where: { id: pinned.id },
          data: { configVersionId: VERSION_B },
        }),
      ).rejects.toThrow(/config_version_id is pinned/);
      expect(await load(fx.a, ref)).toMatchObject({ configVersionId: VERSION_A, version: 1 });
    });
  });

  // --- 3. A tenant record ------------------------------------------------------

  describe('tenant isolation', () => {
    it("never shows one workspace another workspace's conversation, nor lets it write one (NFR-S4)", async () => {
      const ref = await seedConnection(fx.a);
      const mine = await open(fx.a, ref);

      expect(await load(fx.b, ref)).toBeNull();
      expect(
        await withTenant(app, ctx(fx.b), (tx) =>
          Promise.all([
            tx.aiConversation.count(),
            tx.aiConversation.findUnique({ where: { id: mine.id } }),
          ]),
        ),
      ).toEqual([0, null]);

      // A save from B finds no row: a conflict, never a write.
      await expect(save(fx.b, mine, { mode: 'paused' })).rejects.toBeInstanceOf(
        AiConversationConflictError,
      );
      expect(
        await withTenant(app, ctx(fx.b), (tx) =>
          tx.aiConversation.updateMany({ where: { id: mine.id }, data: { mode: 'paused' } }),
        ),
      ).toEqual({ count: 0 });
      expect(await load(fx.a, ref)).toEqual(mine);
    });

    it("refuses a conversation on another workspace's thread, even under the writer's own licence (NFR-S4)", async () => {
      const theirs = await seedConnection(fx.a);

      // B names A's connection: the thread is invisible to B, so it is no
      // connection of B's — whatever licence the row would carry.
      await expect(open(fx.b, theirs)).rejects.toThrow(/is not a connection of chat/);
      // Nor can B file one under A's licence.
      await expect(
        withTenant(
          app,
          ctx(fx.b),
          (tx) =>
            tx.$executeRaw`
            INSERT INTO ai_conversations (id, license_id, chat_id, thread_id)
            VALUES (gen_random_uuid(), ${fx.a.licenseId}, ${theirs.chatId}, ${theirs.threadId})`,
        ),
      ).rejects.toThrow(/row-level security|is not a connection of chat/);
      expect(await owner.aiConversation.count()).toBe(0);
    });

    it('shows nothing and opens nothing without a tenant context', async () => {
      const ref = await seedConnection(fx.a);
      await open(fx.a, ref);

      const [row] = await app.$queryRaw<Array<{ n: number }>>`
        SELECT count(*)::int AS n FROM ai_conversations`;
      expect(row?.n).toBe(0);
      await expect(
        app.$executeRaw`
          INSERT INTO ai_conversations (id, license_id, chat_id, thread_id)
          VALUES (gen_random_uuid(), ${fx.a.licenseId}, ${ref.chatId}, ${ref.threadId})`,
      ).rejects.toThrow(/row-level security|is not a connection of chat/);
    });

    it("refuses a chat id that is not the thread's own chat", async () => {
      const ref = await seedConnection(fx.a);
      const other = await seedConnection(fx.a);

      await expect(open(fx.a, { chatId: other.chatId, threadId: ref.threadId })).rejects.toThrow(
        /is not a connection of chat/,
      );
    });
  });

  // --- 4. The role, the vocabulary, the lifetime --------------------------------

  describe('the table', () => {
    it('lets the runtime role write every patch field', async () => {
      const ref = await seedConnection(fx.a);
      const s0 = await open(fx.a, ref);
      // From the row's own clock, not this process's: the database checks
      // `closed_at >= created_at`, and the container's clock may run ahead.
      const now = new Date(s0.createdAt.getTime() + 1_000);
      const every: Required<AiConversationPatch> = {
        mode: 'human',
        modeChangedAt: now,
        modeChangedBy: fx.a.agentAccountId,
        modeReason: 'agent_takeover',
        activeSkillId: VERSION_B,
        procedureSnapshot: { steps: [{ id: 'ask_method', type: 'collect' }] },
        procedureSnapshotHash: HASH,
        stepId: 'ask_method',
        stepStatus: 'awaiting_answer',
        slots: { method: { status: 'missing' } },
        suspended: { skill_id: VERSION_B, step_id: 'intro' },
        counters: { turns: 1 },
        signals: { repeat_same_day: false },
        digest: { outcome: 'handed_off' },
        outcome: 'handed_off',
        lastProcessedEventSeq: 2,
        configVersionId: VERSION_A,
        closedAt: now,
      };
      expect(Object.keys(every).sort()).toEqual([...AI_CONVERSATION_PATCH_FIELDS].sort());

      const saved = await save(fx.a, s0, every);
      expect(saved).toMatchObject({ ...every, version: 1 });

      // …and clear the nullable ones again.
      const cleared = await save(fx.a, saved, {
        procedureSnapshot: null,
        procedureSnapshotHash: null,
        suspended: null,
        digest: null,
        stepId: null,
        stepStatus: null,
        outcome: null,
      });
      expect(cleared).toMatchObject({
        procedureSnapshot: null,
        suspended: null,
        digest: null,
        outcome: null,
        version: 2,
      });
    });

    it('denies the runtime role the identity, the lock counter, the timestamps and DELETE', async () => {
      const ref = await seedConnection(fx.a);
      const other = await seedConnection(fx.a);
      const s0 = await open(fx.a, ref);
      const asApp = <T>(fn: (tx: TenantClient) => Promise<T>) => withTenant(app, ctx(fx.a), fn);

      for (const data of [
        { version: 0 },
        { threadId: other.threadId },
        { chatId: other.chatId },
        { createdAt: new Date(0) },
        { updatedAt: new Date(0) },
      ]) {
        await expect(
          asApp((tx) => tx.aiConversation.updateMany({ where: { id: s0.id }, data })),
          JSON.stringify(data),
        ).rejects.toThrow(/permission denied/i);
      }
      await expect(
        asApp((tx) => tx.aiConversation.deleteMany({ where: { id: s0.id } })),
      ).rejects.toThrow(/permission denied/i);
      expect(await load(fx.a, ref)).toEqual(s0);
    });

    it('starts every row at version 0, whatever the insert says', async () => {
      const ref = await seedConnection(fx.a);
      const row = await owner.aiConversation.create({
        data: {
          licenseId: fx.a.licenseId,
          chatId: ref.chatId,
          threadId: ref.threadId,
          version: 42,
        },
      });
      expect(row.version).toBe(0);
    });

    it('accepts each value the shared vocabularies name, and refuses one outside them', async () => {
      const ref = await seedConnection(fx.a);
      const { id } = await open(fx.a, ref);
      const set = (data: Record<string, unknown>) =>
        owner.aiConversation.update({ where: { id }, data });

      for (const mode of AI_CONVERSATION_MODES) await set({ mode });
      for (const stepStatus of AI_CONVERSATION_STEP_STATUSES) await set({ stepStatus });
      for (const outcome of AI_CONVERSATION_OUTCOMES) await set({ outcome });

      await expect(set({ mode: 'bot' })).rejects.toThrow(/ai_conversations_mode_check/);
      await expect(set({ stepStatus: 'waiting' })).rejects.toThrow(
        /ai_conversations_step_status_check/,
      );
      await expect(set({ outcome: 'solved' })).rejects.toThrow(/ai_conversations_outcome_check/);
      await expect(set({ modeReason: 'The agent took over.' })).rejects.toThrow(
        /ai_conversations_mode_reason_check/,
      );
    });

    it('refuses a snapshot without its hash, a malformed hash and JSON that is not an object', async () => {
      const ref = await seedConnection(fx.a);
      const { id } = await open(fx.a, ref);
      const set = (data: Record<string, unknown>) =>
        owner.aiConversation.update({ where: { id }, data });

      await expect(set({ procedureSnapshot: { steps: [] } })).rejects.toThrow(
        /ai_conversations_snapshot_pair_check/,
      );
      await expect(set({ procedureSnapshotHash: HASH })).rejects.toThrow(
        /ai_conversations_snapshot_pair_check/,
      );
      await expect(
        set({ procedureSnapshot: { steps: [] }, procedureSnapshotHash: 'v12' }),
      ).rejects.toThrow(/ai_conversations_snapshot_hash_check/);
      await expect(set({ slots: ['papara'] })).rejects.toThrow(/ai_conversations_json_shape_check/);
      await expect(set({ digest: 'resolved' })).rejects.toThrow(
        /ai_conversations_json_shape_check/,
      );
      await set({ procedureSnapshot: { steps: [] }, procedureSnapshotHash: HASH });
    });

    it('goes with its connection, and with its customer', async () => {
      const ref = await seedConnection(fx.a);
      await open(fx.a, ref);
      await owner.thread.delete({ where: { id: ref.threadId } });
      expect(await owner.aiConversation.count({ where: { threadId: ref.threadId } })).toBe(0);

      const erased = await seedConnection(fx.a);
      await open(fx.a, erased);
      const { customerId } = await owner.chat.findUniqueOrThrow({
        where: { id: erased.chatId },
        select: { customerId: true },
      });
      await owner.customer.delete({ where: { id: customerId } });
      expect(await owner.aiConversation.count()).toBe(0);
    });
  });

  // -------------------------------------------------------------------------

  async function seedConnection(t: TenantFixture): Promise<ConnectionRef> {
    const customer = await owner.customer.create({
      data: { organizationId: t.organizationId, name: `c-${generateShortId()}` },
      select: { id: true },
    });
    const chatId = generateShortId();
    await owner.chat.create({
      data: { id: chatId, licenseId: t.licenseId, customerId: customer.id },
    });
    const threadId = generateShortId();
    await owner.thread.create({ data: { id: threadId, chatId, licenseId: t.licenseId } });
    return { chatId, threadId };
  }

  function open(t: TenantFixture, ref: ConnectionRef, configVersionId: string | null = null) {
    return withTenant(app, ctx(t), (tx) => openConversation(tx, ref, { configVersionId }));
  }

  function load(t: TenantFixture, ref: ConnectionRef) {
    return withTenant(app, ctx(t), (tx) => loadConversation(tx, ref));
  }

  function save(t: TenantFixture, current: AiConversationState, patch: AiConversationPatch) {
    return withTenant(app, ctx(t), (tx) => saveConversation(tx, current, patch));
  }

  /** Stands in for the turn's reply: a row written in the save's transaction. */
  async function reply(tx: TenantClient, ref: ConnectionRef, turn: string): Promise<void> {
    await tx.aiDecisionLog.create({
      data: {
        licenseId: fx.a.licenseId,
        chatId: ref.chatId,
        threadId: ref.threadId,
        decision: 'answered',
        details: { turn },
      },
      select: { id: true },
    });
  }

  /** Until a runtime-role session waits on a lock over `ai_conversations`. */
  async function waitForLockWait(): Promise<void> {
    const deadline = Date.now() + 5_000;
    for (;;) {
      const [row] = await owner.$queryRaw<Array<{ waiting: number }>>`
        SELECT count(*)::int AS waiting FROM pg_stat_activity
         WHERE datname = current_database() AND usename = 'siyahtus_app'
           AND wait_event_type = 'Lock' AND query LIKE '%ai_conversations%'`;
      if ((row?.waiting ?? 0) > 0) return;
      if (Date.now() > deadline) throw new Error('the second turn never queued behind the first');
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
});
