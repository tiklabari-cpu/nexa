/**
 * The `risk_flags` table (tm 302.1 · SiyahTuş analysis AI-27): its CHECKs
 * against `risk-flags.ts`, its trigger (a flag is raised active, under the
 * writer's own chat and customer, and only ever cleared), its grants and RLS,
 * and what the retention sweep and an erasure do to it.
 *
 * What a set of flags means is `riskPolicy` (`@siyahtus/types`
 * `risk-flags.test.ts`); the routes, the AI's raising and who may clear are
 * tm 302.2's.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  RISK_FLAG_BASES,
  RISK_FLAG_CLEAR_REASON_MAX,
  RISK_FLAG_EVIDENCE_MAX,
  RISK_FLAG_MEMBER_KEY_MAX,
  RISK_FLAG_NOTE_MAX,
  RISK_FLAG_SCOPES,
  RISK_FLAG_SEVERITIES,
  RISK_FLAG_SOURCES,
  RISK_FLAG_STATUSES,
  RISK_FLAG_TYPES,
  riskPolicy,
  type RiskFlagScope,
  type RiskFlagType,
} from '@siyahtus/types';
import { withTenant } from '../../src/lib/tenant.js';
import {
  ownerClient,
  seedFixtures,
  type Fixtures,
  type TenantFixture,
} from '../helpers/fixtures.js';

const APP_URL = process.env['DATABASE_APP_URL'];

const MIGRATION = fileURLToPath(
  new URL('../../prisma/migrations/20261019180000_risk_flags/migration.sql', import.meta.url),
);

describe('risk flags table (AI-27 · tm 302.1)', () => {
  let owner: PrismaClient;
  let appRole: PrismaClient;
  let fx: Fixtures;
  let seq = 0;

  beforeAll(() => {
    owner = ownerClient();
    if (!APP_URL) throw new Error('DATABASE_APP_URL must be set');
    appRole = new PrismaClient({ datasourceUrl: APP_URL });
  });

  afterAll(async () => {
    await appRole.$disconnect();
    await owner.$disconnect();
  });

  beforeEach(async () => {
    fx = await seedFixtures(owner);
  });

  const tenant = (t: TenantFixture) => ({
    licenseId: t.licenseId,
    organizationId: t.organizationId,
  });

  const nextId = (prefix: string): string => {
    seq += 1;
    return prefix + String(seq).padStart(11, '0');
  };

  /** A closed conversation of `customerId` — a customer holds one open chat at a time. */
  async function seedChat(
    t: TenantFixture,
    customerId = t.customerId,
  ): Promise<{ chatId: string; threadId: string }> {
    const chatId = nextId('c');
    await owner.chat.create({
      data: { id: chatId, licenseId: t.licenseId, customerId, active: false },
    });
    const threadId = nextId('t');
    await owner.thread.create({
      data: { id: threadId, chatId, licenseId: t.licenseId, active: false, closedAt: new Date() },
    });
    return { chatId, threadId };
  }

  /** Raise a flag as the workspace's app role — the AI's, unless told otherwise. */
  function raise(
    t: TenantFixture,
    data: {
      chatId?: string | null;
      threadId?: string | null;
      customerId?: string;
      type?: RiskFlagType;
      scope?: RiskFlagScope;
      source?: string;
      ruleRef?: string | null;
      raisedBy?: string;
      status?: string;
      note?: string;
    } = {},
  ) {
    const source = data.source ?? 'ai_rule';
    return withTenant(appRole, tenant(t), (tx) =>
      tx.riskFlag.create({
        data: {
          id: crypto.randomUUID(),
          licenseId: t.licenseId,
          scope: data.scope ?? 'member',
          chatId: data.chatId ?? null,
          threadId: data.threadId ?? null,
          ...(data.customerId ? { customerId: data.customerId } : {}),
          type: data.type ?? 'self_exclusion_request',
          severity: 'urgent',
          source,
          ruleRef: data.ruleRef === undefined ? (source === 'ai_rule' ? 'G1' : null) : data.ruleRef,
          ...(data.raisedBy ? { raisedBy: data.raisedBy } : {}),
          ...(data.status ? { status: data.status } : {}),
          ...(data.note ? { note: data.note } : {}),
        },
      }),
    );
  }

  const update = (t: TenantFixture, id: string, sql: string) =>
    withTenant(appRole, tenant(t), (tx) =>
      tx.$executeRawUnsafe(`UPDATE risk_flags SET ${sql} WHERE id = '${id}'`),
    );

  // -------------------------------------------------------------------------

  it('the CHECKs are the constants', () => {
    const sql = readFileSync(MIGRATION, 'utf8').replace(/\s+/g, ' ');
    const list = (values: readonly string[]) => values.map((value) => `'${value}'`).join(', ');
    expect(sql).toContain(`CHECK (scope IN (${list(RISK_FLAG_SCOPES)}))`);
    expect(sql).toContain(`CHECK (type IN ( ${list(RISK_FLAG_TYPES)} ))`);
    expect(sql).toContain(`CHECK (severity IN (${list(RISK_FLAG_SEVERITIES)}))`);
    expect(sql).toContain(`CHECK (source IN (${list(RISK_FLAG_SOURCES)}))`);
    expect(sql).toContain(`CHECK (basis IN (${list(RISK_FLAG_BASES)}))`);
    expect(sql).toContain(`CHECK (status IN (${list(RISK_FLAG_STATUSES)}))`);
    expect(sql).toContain(`char_length(btrim(note)) BETWEEN 1 AND ${RISK_FLAG_NOTE_MAX}`);
    expect(sql).toContain(
      `char_length(btrim(clear_reason)) BETWEEN 1 AND ${RISK_FLAG_CLEAR_REASON_MAX}`,
    );
    expect(sql).toContain(`cardinality(evidence_event_ids) <= ${RISK_FLAG_EVIDENCE_MAX}`);
    expect(sql).toContain(`char_length(member_key) BETWEEN 1 AND ${RISK_FLAG_MEMBER_KEY_MAX}`);
  });

  it("RLS hides another workspace's flags and refuses one written in its name (NFR-S4)", async () => {
    const mine = await seedChat(fx.a);
    await raise(fx.a, mine);
    const count = (t: TenantFixture) => withTenant(appRole, tenant(t), (tx) => tx.riskFlag.count());
    expect(await count(fx.a)).toBe(1);
    expect(await count(fx.b)).toBe(0);

    // A row with nothing for the trigger to look up reaches the policy itself.
    await expect(
      withTenant(appRole, tenant(fx.a), (tx) =>
        tx.$executeRawUnsafe(
          `INSERT INTO risk_flags (id, license_id, scope, member_key, type, severity, source, rule_ref)
           VALUES (gen_random_uuid(), ${fx.b.licenseId}, 'member', 'oyuncu42', 'rg_signal', 'high', 'ai_rule', 'G2')`,
        ),
      ),
    ).rejects.toThrow(/row-level security/);

    // Another workspace cannot clear, or even reach, this workspace's flag.
    const [flag] = await owner.riskFlag.findMany({ select: { id: true } });
    expect(
      await update(
        fx.b,
        flag!.id,
        `status = 'cleared', cleared_by = gen_random_uuid(), cleared_at = now(), clear_reason = 'x'`,
      ),
    ).toBe(0);
  });

  it("refuses another workspace's chat, connection and customer under the writer's own licence (NFR-S4)", async () => {
    // Raw SQL: Prisma reports a foreign_key_violation without the trigger's words.
    const insert = (columns: Record<string, string>) => {
      const all = {
        scope: "'member'",
        type: "'rg_signal'",
        severity: "'high'",
        source: "'ai_rule'",
        rule_ref: "'G2'",
        ...columns,
      };
      return withTenant(appRole, tenant(fx.a), (tx) =>
        tx.$executeRawUnsafe(
          `INSERT INTO risk_flags (id, license_id, ${Object.keys(all).join(', ')})
           VALUES (gen_random_uuid(), ${fx.a.licenseId}, ${Object.values(all).join(', ')})`,
        ),
      );
    };
    const theirs = await seedChat(fx.b);
    await expect(insert({ chat_id: `'${theirs.chatId}'` })).rejects.toThrow(
      /chat c[0-9]+ is not this workspace's/,
    );
    await expect(insert({ customer_id: `'${fx.b.customerId}'` })).rejects.toThrow(
      /customer [0-9a-f-]+ is not this workspace's/,
    );
    const mine = await seedChat(fx.a);
    await expect(
      insert({ chat_id: `'${mine.chatId}'`, thread_id: `'${theirs.threadId}'` }),
    ).rejects.toThrow(/thread t[0-9]+ is not chat/);
    expect(await owner.riskFlag.count()).toBe(0);
  });

  it("raises a flag active, on its chat's customer", async () => {
    const conversation = await seedChat(fx.a);
    const flag = await raise(fx.a, conversation);
    expect(flag).toMatchObject({
      customerId: fx.a.customerId,
      status: 'active',
      basis: 'declared',
      evidenceEventIds: [],
      clearedAt: null,
    });

    const other = (
      await owner.customer.create({
        data: { organizationId: fx.a.organizationId, name: 'Başka' },
        select: { id: true },
      })
    ).id;
    await expect(raise(fx.a, { ...conversation, customerId: other })).rejects.toThrow(
      /is not chat/,
    );
    await expect(raise(fx.a, { scope: 'chat', customerId: fx.a.customerId })).rejects.toThrow(
      /a chat flag names its chat/,
    );
    await expect(raise(fx.a, { threadId: conversation.threadId })).rejects.toThrow(
      /named with its chat/,
    );
    await expect(raise(fx.a, { ...conversation, status: 'cleared' })).rejects.toThrow(
      /raised active/,
    );
    // A member flag needs a player to be about.
    await expect(raise(fx.a, {})).rejects.toThrow(/risk_flags_subject_check/);
    // A player-level flag without a chat — from the operator, F2.
    await expect(raise(fx.a, { customerId: fx.a.customerId })).resolves.toMatchObject({
      chatId: null,
    });
  });

  it('holds the source to its rule and its person', async () => {
    const conversation = await seedChat(fx.a);
    await expect(raise(fx.a, { ...conversation, ruleRef: null })).rejects.toThrow(
      /risk_flags_rule_ref_check/,
    );
    await expect(raise(fx.a, { ...conversation, ruleRef: 'G20' })).rejects.toThrow(
      /risk_flags_rule_ref_check/,
    );
    await expect(
      raise(fx.a, {
        ...conversation,
        source: 'agent',
        ruleRef: 'G1',
        raisedBy: fx.a.agentAccountId,
      }),
    ).rejects.toThrow(/risk_flags_rule_ref_check/);
    await expect(raise(fx.a, { ...conversation, source: 'agent' })).rejects.toThrow(
      /risk_flags_raised_by_check/,
    );
    await expect(
      raise(fx.a, { ...conversation, source: 'ai_classifier', raisedBy: fx.a.agentAccountId }),
    ).rejects.toThrow(/risk_flags_raised_by_check/);
    await expect(
      raise(fx.a, {
        ...conversation,
        source: 'agent',
        raisedBy: fx.a.agentAccountId,
        type: 'complaint_formal',
        scope: 'chat',
        note: 'Resmî şikâyet: çekim gecikmesi.',
      }),
    ).resolves.toMatchObject({ ruleRef: null, raisedBy: fx.a.agentAccountId });
  });

  it('is never deleted or rewritten — only cleared, once, with who, when and why', async () => {
    const privileges = await owner.$queryRaw<
      Array<{
        select: boolean;
        insert: boolean;
        update: boolean;
        delete: boolean;
        truncate: boolean;
      }>
    >`
      SELECT has_table_privilege('siyahtus_app', 'risk_flags', 'SELECT') AS select,
             has_table_privilege('siyahtus_app', 'risk_flags', 'INSERT') AS insert,
             has_table_privilege('siyahtus_app', 'risk_flags', 'UPDATE') AS update,
             has_table_privilege('siyahtus_app', 'risk_flags', 'DELETE') AS delete,
             has_table_privilege('siyahtus_app', 'risk_flags', 'TRUNCATE') AS truncate`;
    expect(privileges).toEqual([
      { select: true, insert: true, update: true, delete: false, truncate: false },
    ]);

    const conversation = await seedChat(fx.a);
    const { id } = await raise(fx.a, { ...conversation, note: 'Hesabını kapatmak istedi.' });
    await expect(
      withTenant(appRole, tenant(fx.a), (tx) =>
        tx.$executeRawUnsafe(`DELETE FROM risk_flags WHERE id = '${id}'`),
      ),
    ).rejects.toThrow(/permission denied/);

    for (const change of [
      `note = 'Başka bir not.'`,
      `type = 'rg_signal'`,
      `severity = 'info'`,
      `scope = 'chat'`,
      `customer_id = NULL`,
      `evidence_event_ids = ARRAY['e1']`,
      `raised_at = now() - interval '1 day'`,
      `chat_id = '${(await seedChat(fx.a)).chatId}'`,
    ]) {
      await expect(update(fx.a, id, change), change).rejects.toThrow(/not rewritten/);
    }
    // Cleared needs all three, and a reason with words in it.
    await expect(update(fx.a, id, `status = 'cleared'`)).rejects.toThrow(
      /risk_flags_cleared_check/,
    );
    await expect(
      update(
        fx.a,
        id,
        `status = 'cleared', cleared_by = '${fx.a.ownerAccountId}', cleared_at = now(), clear_reason = '   '`,
      ),
    ).rejects.toThrow(/risk_flags_clear_reason_check/);

    const clear = `status = 'cleared', cleared_by = '${fx.a.ownerAccountId}', cleared_at = now(), clear_reason = 'Oyuncu yanlış anlaşıldığını yazdı.'`;
    expect(await update(fx.a, id, clear)).toBe(1);
    await expect(
      update(
        fx.a,
        id,
        `status = 'active', cleared_by = NULL, cleared_at = NULL, clear_reason = NULL`,
      ),
    ).rejects.toThrow(/stays cleared/);
    await expect(update(fx.a, id, `clear_reason = 'Başka gerekçe.'`)).rejects.toThrow(
      /stays cleared/,
    );
    expect(await owner.riskFlag.findUniqueOrThrow({ where: { id } })).toMatchObject({
      status: 'cleared',
      clearedBy: fx.a.ownerAccountId,
      clearReason: 'Oyuncu yanlış anlaşıldığını yazdı.',
      note: 'Hesabını kapatmak istedi.',
    });
  });

  it("outlives its conversation's retention, and goes with the customer's erasure", async () => {
    const yesterday = await seedChat(fx.a);
    const member = await raise(fx.a, yesterday);
    const chatOnly = await raise(fx.a, {
      ...yesterday,
      type: 'complaint_formal',
      scope: 'chat',
      ruleRef: 'G15',
    });

    // The retention sweep deletes the conversation.
    await owner.chat.delete({ where: { id: yesterday.chatId } });
    const kept = await owner.riskFlag.findMany({
      where: { id: { in: [member.id, chatOnly.id] } },
      orderBy: { type: 'asc' },
    });
    expect(kept.map((f) => [f.type, f.chatId, f.threadId, f.customerId, f.status])).toEqual([
      ['complaint_formal', null, null, fx.a.customerId, 'active'],
      ['self_exclusion_request', null, null, fx.a.customerId, 'active'],
    ]);
    // Today's conversation still sees the player's flag — and only it.
    const today = await seedChat(fx.a);
    const policy = riskPolicy(
      kept.map((f) => ({
        type: f.type as RiskFlagType,
        scope: f.scope as RiskFlagScope,
        chat_id: f.chatId,
        status: f.status as 'active',
      })),
      today.chatId,
    );
    expect(policy).toMatchObject({ noPromotions: true, mustHandoff: false });

    // The erasure (`retention/erasure.ts` deletes the customer).
    await owner.customer.delete({ where: { id: fx.a.customerId } });
    expect(await owner.riskFlag.count()).toBe(0);
  });

  it("keeps a player's active flags in a valid partial index", async () => {
    const indexes = await owner.$queryRaw<Array<{ valid: boolean; predicate: string | null }>>`
      SELECT i.indisvalid AS valid, pg_get_expr(i.indpred, i.indrelid) AS predicate
        FROM pg_index i
        JOIN pg_class c ON c.oid = i.indexrelid
       WHERE c.relname = 'risk_flags_active_customer_idx'`;
    expect(indexes).toEqual([{ valid: true, predicate: "(status = 'active'::text)" }]);
  });
});
