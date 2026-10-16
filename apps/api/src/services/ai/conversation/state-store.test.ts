/**
 * The state store's lock, without a database (tm 292.1 · AI-01 §6).
 *
 * The integration suite (`test/integration/ai-conversations.test.ts`) races
 * real transactions; this pins down what the store asks the database for: the
 * save is conditional on the version it was handed, a miss is a conflict and
 * nothing is read back, and a patch can only carry the fields a turn owns.
 */
import { Prisma, type AiConversation } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import type { TenantClient } from '../../../lib/tenant.js';
import {
  AI_CONVERSATION_PATCH_FIELDS,
  AiConversationConflictError,
  openConversation,
  saveConversation,
  type AiConversationPatch,
} from './state-store.js';

const ID = '3f8a6c1e-2b4d-4e5f-8a9b-0c1d2e3f4a5b';
const VERSION_ID = '9a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c3d';

function row(overrides: Partial<AiConversation> = {}): AiConversation {
  return {
    id: ID,
    licenseId: 7n,
    chatId: 'C1234567890A',
    threadId: 'T1234567890A',
    mode: 'ai',
    modeChangedAt: null,
    modeChangedBy: null,
    modeReason: null,
    activeSkillId: null,
    procedureSnapshot: null,
    procedureSnapshotHash: null,
    stepId: null,
    stepStatus: null,
    slots: {},
    suspended: null,
    counters: {},
    signals: {},
    digest: null,
    outcome: null,
    lastProcessedEventSeq: 0,
    version: 4,
    configVersionId: null,
    createdAt: new Date('2026-10-16T10:00:00Z'),
    updatedAt: new Date('2026-10-16T10:00:00Z'),
    closedAt: null,
    ...overrides,
  };
}

/** A tenant client whose conditional update matches `count` rows. */
function fakeTx(count: number, saved: AiConversation = row({ version: 5 })) {
  const updateMany = vi.fn(async (_args: unknown) => ({ count }));
  const findUniqueOrThrow = vi.fn(async (_args: unknown) => saved);
  const findFirst = vi.fn(async (_args: unknown) => saved);
  const executeRaw = vi.fn(async (_sql: TemplateStringsArray, ..._values: unknown[]) => 1);
  const tx = {
    aiConversation: { updateMany, findUniqueOrThrow, findFirst },
    $executeRaw: executeRaw,
  } as unknown as TenantClient;
  return { tx, updateMany, findUniqueOrThrow, findFirst, executeRaw };
}

describe('saveConversation — the optimistic lock', () => {
  it('writes only where the row is still at the version it was read at', async () => {
    const { tx, updateMany, findUniqueOrThrow } = fakeTx(1);

    const saved = await saveConversation(
      tx,
      { id: ID, version: 4 },
      { lastProcessedEventSeq: 9, slots: { method: { status: 'filled' } } },
    );

    expect(updateMany).toHaveBeenCalledWith({
      where: { id: ID, version: 4 },
      data: { lastProcessedEventSeq: 9, slots: { method: { status: 'filled' } } },
    });
    // The version is the database's to bump: the store never sends one.
    expect(updateMany.mock.calls[0]?.[0]).not.toHaveProperty('data.version');
    expect(findUniqueOrThrow).toHaveBeenCalledWith({ where: { id: ID } });
    expect(saved).toMatchObject({ id: ID, version: 5 });
  });

  it('throws a conflict when the row moved on, and reads nothing back', async () => {
    const { tx, findUniqueOrThrow } = fakeTx(0);

    const failure = await saveConversation(tx, { id: ID, version: 4 }, { mode: 'human' }).catch(
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(AiConversationConflictError);
    expect(failure).toMatchObject({
      code: 'ai_conversation_version_conflict',
      conversationId: ID,
      expectedVersion: 4,
    });
    expect(findUniqueOrThrow).not.toHaveBeenCalled();
  });

  it('writes a null JSON column as SQL NULL', async () => {
    const { tx, updateMany } = fakeTx(1);

    await saveConversation(
      tx,
      { id: ID, version: 4 },
      { suspended: null, digest: null, procedureSnapshot: null, procedureSnapshotHash: null },
    );

    expect(updateMany.mock.calls[0]?.[0]).toMatchObject({
      data: {
        suspended: Prisma.DbNull,
        digest: Prisma.DbNull,
        procedureSnapshot: Prisma.DbNull,
        procedureSnapshotHash: null,
      },
    });
  });

  it.each(['version', 'id', 'threadId', 'chatId', 'updatedAt', 'createdAt'])(
    'refuses a patch that carries %s, before any query',
    async (field) => {
      const { tx, updateMany } = fakeTx(1);
      const patch = {
        mode: 'human',
        [field]: field === 'version' ? 99 : 'x',
      } as AiConversationPatch;

      await expect(saveConversation(tx, { id: ID, version: 4 }, patch)).rejects.toThrow(
        new RegExp(`field ${field} is not writable`),
      );
      expect(updateMany).not.toHaveBeenCalled();
    },
  );

  it('refuses an empty patch rather than take the lock for nothing', async () => {
    const { tx, updateMany } = fakeTx(1);

    await expect(
      saveConversation(tx, { id: ID, version: 4 }, { stepId: undefined }),
    ).rejects.toThrow(/patch is empty/);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('names no identity, lock or timestamp column among the writable fields', () => {
    for (const field of ['id', 'chatId', 'threadId', 'version', 'createdAt', 'updatedAt']) {
      expect(AI_CONVERSATION_PATCH_FIELDS as readonly string[]).not.toContain(field);
    }
  });
});

describe('openConversation', () => {
  it('opens through ON CONFLICT DO NOTHING and returns the row either way', async () => {
    const existing = row({ configVersionId: VERSION_ID });
    const { tx, executeRaw, findFirst } = fakeTx(1, existing);

    const state = await openConversation(
      tx,
      { chatId: 'C1234567890A', threadId: 'T1234567890A' },
      { configVersionId: null },
    );

    const sql = (executeRaw.mock.calls[0]?.[0] ?? []).join('?');
    expect(sql).toMatch(/ON CONFLICT \(license_id, chat_id, thread_id\) DO NOTHING/);
    expect(sql).toMatch(/siyahtus_current_license\(\)/);
    expect(findFirst).toHaveBeenCalledWith({
      where: { threadId: 'T1234567890A', chatId: 'C1234567890A' },
    });
    // The row that was already there keeps the version it pinned.
    expect(state.configVersionId).toBe(VERSION_ID);
  });

  it('refuses a config version id that is not a uuid, before any query', async () => {
    const { tx, executeRaw } = fakeTx(1);

    await expect(
      openConversation(
        tx,
        { chatId: 'C1234567890A', threadId: 'T1234567890A' },
        { configVersionId: 'v12' },
      ),
    ).rejects.toThrow(TypeError);
    expect(executeRaw).not.toHaveBeenCalled();
  });
});
