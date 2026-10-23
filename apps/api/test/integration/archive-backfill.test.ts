/**
 * The archive filters' backfill (tm 336.1 · AR-02):
 * `20261023180100_threads_archive_backfill` fills `handled_by`, `agent_ids`
 * and `risk_flags` on connections that closed before the close wrote them.
 *
 * The migration spells ADR-09a's predicate and the agent list out in SQL —
 * the one place that cannot import `handledBySql` / `agentIdsSql`. This file
 * replays it over a corpus with one connection per branch of the predicate,
 * on both sides of the effective moment, and holds every row to what the two
 * functions say: a condition added to one and not the other turns it red.
 * It also pins that the replay is idempotent and leaves values the close
 * already wrote alone.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { generateShortId } from '@siyahtus/types';
import { agentIdsSql } from '../../src/services/archive/archive-filters.js';
import {
  ADR_09A_EFFECTIVE_AT,
  AUTOMATIC_HANDOFF_REASONS,
  AUTOMATIC_MODE_HANDOVERS,
  handledBySql,
} from '../../src/services/billing/ai-resolution.js';
import { ownerClient, seedFixtures, type Fixtures } from '../helpers/fixtures.js';

const MIGRATION = fileURLToPath(
  new URL(
    '../../prisma/migrations/20261023180100_threads_archive_backfill/migration.sql',
    import.meta.url,
  ),
);

const HOUR = 3_600_000;
const BEFORE = new Date(ADR_09A_EFFECTIVE_AT.getTime() - 10 * 24 * HOUR);
const AFTER = new Date(ADR_09A_EFFECTIVE_AT.getTime() + 10 * 24 * HOUR);

type Line =
  | { author: 'customer' | 'bot' }
  | { author: 'agent'; note?: boolean; id?: string }
  | { system: 'chat_transferred' | 'ai_mode_changed'; reason: string };

describe('the archive backfill replays the close (AR-02 · tm 336.1)', () => {
  let owner: PrismaClient;
  let fx: Fixtures;

  beforeAll(() => {
    owner = ownerClient();
  });

  afterAll(async () => {
    await owner.$disconnect();
  });

  beforeEach(async () => {
    fx = await seedFixtures(owner);
  });

  async function thread(closedAt: Date | null, lines: Line[]): Promise<string> {
    const customer = await owner.customer.create({
      data: { organizationId: fx.a.organizationId },
      select: { id: true },
    });
    const chatId = generateShortId();
    const startedAt = new Date((closedAt ?? new Date()).getTime() - HOUR);
    await owner.chat.create({
      data: {
        id: chatId,
        licenseId: fx.a.licenseId,
        customerId: customer.id,
        active: false,
        createdAt: startedAt,
      },
    });
    const threadId = generateShortId();
    await owner.thread.create({
      data: {
        id: threadId,
        chatId,
        licenseId: fx.a.licenseId,
        active: closedAt === null,
        createdAt: startedAt,
        closedAt,
      },
    });
    let n = 0;
    for (const line of lines) {
      n += 1;
      const base = {
        id: `${threadId}_${n}`,
        threadId,
        chatId,
        licenseId: fx.a.licenseId,
        createdAt: new Date(startedAt.getTime() + n * 60_000),
      };
      if ('system' in line) {
        await owner.event.create({
          data: {
            ...base,
            type: 'system_message',
            authorType: 'system',
            authorId: 'system',
            properties: { system_event: line.system, reason: line.reason },
          },
        });
      } else {
        await owner.event.create({
          data: {
            ...base,
            type: 'message',
            text: 'x',
            authorType: line.author,
            authorId:
              line.author === 'agent' ? (line.id ?? fx.a.agentAccountId) : `${line.author}-1`,
            recipients: line.author === 'agent' && line.note ? 'agents' : 'all',
          },
        });
      }
    }
    return threadId;
  }

  async function corpus(): Promise<Map<string, string>> {
    const handoff: Line = { system: 'chat_transferred', reason: AUTOMATIC_HANDOFF_REASONS[0] };
    const stall: Line = { system: 'ai_mode_changed', reason: AUTOMATIC_MODE_HANDOVERS[0] };
    const made = new Map<string, string>();
    const add = async (name: string, closedAt: Date | null, lines: Line[]) =>
      made.set(name, await thread(closedAt, lines));
    await add('nobody', BEFORE, [{ author: 'customer' }]);
    await add('botOnly', BEFORE, [{ author: 'customer' }, { author: 'bot' }]);
    await add('agentOnly', BEFORE, [{ author: 'customer' }, { author: 'agent' }]);
    await add('botAndAgent', BEFORE, [{ author: 'bot' }, { author: 'agent' }]);
    await add('noteOnly', BEFORE, [{ author: 'customer' }, { author: 'agent', note: true }]);
    await add('twoAgents', BEFORE, [
      { author: 'agent', id: fx.a.ownerAccountId },
      { author: 'agent' },
      { author: 'agent', id: fx.a.ownerAccountId },
    ]);
    await add('forgedAuthor', BEFORE, [{ author: 'agent', id: 'not-a-uuid' }]);
    await add('handedOffBefore', BEFORE, [{ author: 'bot' }, handoff]);
    await add('handedOffAfter', AFTER, [{ author: 'bot' }, handoff]);
    await add('stalledAfter', AFTER, [{ author: 'bot' }, stall]);
    await add('manualTransferAfter', AFTER, [
      { author: 'bot' },
      { system: 'chat_transferred', reason: 'manual' },
    ]);
    await add('open', null, [{ author: 'agent' }]);
    return made;
  }

  /** What the close would write, row by row — the functions, not the migration. */
  async function expected(made: Map<string, string>) {
    const rows = await owner.$queryRaw<
      Array<{ id: string; handled_by: string | null; agent_ids: string[] | null }>
    >`
      SELECT t.id,
             CASE WHEN t.active THEN NULL ELSE ${handledBySql()} END AS handled_by,
             CASE WHEN t.active THEN NULL ELSE ${agentIdsSql()} END AS agent_ids
        FROM threads t WHERE t.id = ANY(${[...made.values()]}::text[])`;
    return byName(made, rows);
  }

  async function stored(made: Map<string, string>) {
    const rows = await owner.$queryRaw<
      Array<{ id: string; handled_by: string | null; agent_ids: string[] | null }>
    >`SELECT t.id, t.handled_by, t.agent_ids FROM threads t
       WHERE t.id = ANY(${[...made.values()]}::text[])`;
    return byName(made, rows);
  }

  function byName(
    made: Map<string, string>,
    rows: Array<{ id: string; handled_by: string | null; agent_ids: string[] | null }>,
  ) {
    const nameOf = new Map([...made].map(([name, id]) => [id, name]));
    return Object.fromEntries(
      rows
        .map(
          (r) => [nameOf.get(r.id)!, { handledBy: r.handled_by, agentIds: r.agent_ids }] as const,
        )
        .sort(([a], [b]) => a.localeCompare(b)),
    );
  }

  const replay = () => owner.$executeRawUnsafe(readFileSync(MIGRATION, 'utf8'));

  it('writes exactly what handledBySql and agentIdsSql say, for every branch on both sides of the effective moment', async () => {
    const made = await corpus();
    const want = await expected(made);
    // The functions themselves, so a corpus that stopped covering a branch shows.
    expect(want).toMatchObject({
      nobody: { handledBy: 'ai', agentIds: [] },
      botOnly: { handledBy: 'ai', agentIds: [] },
      agentOnly: { handledBy: 'human', agentIds: [fx.a.agentAccountId] },
      botAndAgent: { handledBy: 'mixed' },
      noteOnly: { handledBy: 'human', agentIds: [] },
      twoAgents: {
        handledBy: 'human',
        agentIds: [fx.a.agentAccountId, fx.a.ownerAccountId].sort(),
      },
      forgedAuthor: { handledBy: 'human', agentIds: [] },
      handedOffBefore: { handledBy: 'ai' },
      handedOffAfter: { handledBy: 'mixed' },
      stalledAfter: { handledBy: 'mixed' },
      manualTransferAfter: { handledBy: 'ai' },
      open: { handledBy: null, agentIds: null },
    });

    expect(await stored(made)).toMatchObject(
      Object.fromEntries(Object.keys(want).map((k) => [k, { handledBy: null, agentIds: null }])),
    );
    await replay();
    expect(await stored(made)).toEqual(want);
    // Idempotent: a second deploy finds nothing left to do.
    await replay();
    expect(await stored(made)).toEqual(want);
  });

  it('spells the predicate with the constants it mirrors', () => {
    const sql = readFileSync(MIGRATION, 'utf8');
    expect(sql).toContain(`'${ADR_09A_EFFECTIVE_AT.toISOString()}'::timestamptz`);
    expect(sql).toContain(`ARRAY[${AUTOMATIC_HANDOFF_REASONS.map((r) => `'${r}'`).join(', ')}]`);
    expect(sql).toContain(`ARRAY[${AUTOMATIC_MODE_HANDOVERS.map((r) => `'${r}'`).join(', ')}]`);
  });

  it('keeps what the close already wrote, and fills risk flags from every flag raised, cleared ones included', async () => {
    const written = await thread(BEFORE, [{ author: 'bot' }]);
    await owner.thread.update({
      where: { id: written },
      data: { handledBy: 'mixed', agentIds: [fx.a.ownerAccountId] },
    });
    const flagged = await thread(BEFORE, [{ author: 'customer' }]);
    const chatId = (await owner.thread.findUniqueOrThrow({ where: { id: flagged } })).chatId;
    for (const type of ['abusive', 'rg_signal', 'abusive'] as const) {
      await owner.riskFlag.create({
        data: {
          licenseId: fx.a.licenseId,
          scope: 'chat',
          chatId,
          threadId: flagged,
          type,
          severity: 'high',
          source: 'agent',
          raisedBy: fx.a.ownerAccountId,
        },
      });
    }
    // The trigger keeps the list as flags are raised: sorted, each type once.
    const kept = await owner.thread.findUniqueOrThrow({ where: { id: flagged } });
    expect(kept.riskFlagTypes).toEqual(['abusive', 'rg_signal']);
    // A connection flagged before the trigger existed.
    await owner.$executeRaw`UPDATE threads SET risk_flags = '{}' WHERE id = ${flagged}`;

    await replay();
    const after = await owner.thread.findUniqueOrThrow({ where: { id: written } });
    expect(after.handledBy).toBe('mixed');
    expect(after.agentIds).toEqual([fx.a.ownerAccountId]);
    expect(
      (await owner.thread.findUniqueOrThrow({ where: { id: flagged } })).riskFlagTypes,
    ).toEqual(['abusive', 'rg_signal']);
  });
});
