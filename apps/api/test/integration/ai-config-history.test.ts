/**
 * The AI configuration change history (tm 315 · SiyahTuş analysis AI-21):
 * every write path of an editing table leaves exactly one change row and one
 * audit row in the same transaction; the rows are append-only to the
 * application, outlive the audit log's prune, are masked, and are read by
 * role — the whole history for the Founder and the Administrator, a Team
 * Lead's own, nothing for a Team Member — and exported as CSV.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AI_CONFIG_HISTORY_DAYS, AI_CONFIG_TEXT_LIMIT_BYTES } from '@siyahtus/types';
import { withTenant } from '../../src/lib/tenant.js';
import { updateSkillDraft } from '../../src/services/ai/config-draft.js';
import { RetentionRunner } from '../../src/services/retention/retention.js';
import {
  grantToken,
  ownerClient,
  seedFixtures,
  testEnv,
  type Fixtures,
} from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

const APP_URL = process.env['DATABASE_APP_URL'];
const DAY = 86_400_000;

interface Change {
  id: string;
  entity_type: string;
  entity_id: string;
  entity_name: string | null;
  action: string;
  actor: { id: string | null; type: string; role: string | null; name: string | null };
  fields: string[];
  diff: Array<{ path: string; kind: string; before?: unknown; after?: unknown }>;
  note: string | null;
}

describe('AI configuration change history (AI-21 · tm 315)', () => {
  let owner: PrismaClient;
  let appRole: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;
  let aiAgentId: string;
  let ownerAuth: Record<string, string>;
  let foreignAuth: Record<string, string>;
  let seq = 0;

  beforeAll(async () => {
    owner = ownerClient();
    if (!APP_URL) throw new Error('DATABASE_APP_URL must be set');
    appRole = new PrismaClient({ datasourceUrl: APP_URL });
    server = await startTestServer();
  });

  afterAll(async () => {
    await server.close();
    await appRole.$disconnect();
    await owner.$disconnect();
  });

  beforeEach(async () => {
    fx = await seedFixtures(owner);
    await clearRateLimits(server.app);
    aiAgentId = (
      await owner.aiAgent.create({
        data: { licenseId: fx.a.licenseId, name: 'Ada', kind: 'ai_agent', tone: 'friendly' },
        select: { id: true },
      })
    ).id;
    ownerAuth = {
      authorization: `Bearer ${await grantToken(owner, {
        licenseId: fx.a.licenseId,
        organizationId: fx.a.organizationId,
        ownerId: fx.a.ownerAccountId,
        scopes: ['agents-bot--all:rw'],
      })}`,
    };
    foreignAuth = {
      authorization: `Bearer ${await grantToken(owner, {
        licenseId: fx.b.licenseId,
        organizationId: fx.b.organizationId,
        ownerId: fx.b.ownerAccountId,
        scopes: ['agents-bot--all:rw'],
      })}`,
    };
  });

  const mine = () => ({ licenseId: fx.a.licenseId, organizationId: fx.a.organizationId });

  const changesOf = (entityId?: string) =>
    owner.aiConfigChange.findMany({
      where: { licenseId: fx.a.licenseId, ...(entityId ? { entityId } : {}) },
      orderBy: { at: 'asc' },
    });

  const auditOf = (action: string) =>
    owner.auditLogEntry.findMany({
      where: { licenseId: fx.a.licenseId, action },
      orderBy: { createdAt: 'asc' },
    });

  async function member(role: 'admin' | 'team_lead' | 'agent') {
    seq += 1;
    const account = await owner.account.create({
      data: { email: `${role}-${seq}-${Date.now()}@example.test`, name: `Üye ${role}` },
      select: { id: true },
    });
    await owner.agentMembership.create({
      data: { licenseId: fx.a.licenseId, agentId: account.id, role },
    });
    const token = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: account.id,
      scopes: ['agents-bot--all:ro', 'chats--all:rw'],
    });
    return { accountId: account.id, auth: { authorization: `Bearer ${token}` } };
  }

  async function createSkill(name = 'Bonus soruları'): Promise<string> {
    const created = await server.post(
      '/skills',
      { name, ai_agent_id: aiAgentId, instruction: 'Bonus şartlarını anlat.' },
      ownerAuth,
    );
    expect(created.statusCode, created.body).toBe(201);
    return (created.json() as { id: string }).id;
  }

  describe('recording', () => {
    it('a tone change is one change row (before/after) and one audit row naming the field', async () => {
      const response = await server.patch(`/ai-agents/${aiAgentId}`, { tone: 'formal' }, ownerAuth);
      expect(response.statusCode, response.body).toBe(200);

      const rows = await changesOf(aiAgentId);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        entityType: 'persona',
        action: 'updated',
        aiAgentId,
        actorId: fx.a.ownerAccountId,
        actorType: 'agent',
        actorRole: 'owner',
        versionId: null,
      });
      expect(rows[0]!.diff).toEqual([
        { path: 'tone', kind: 'changed', before: 'friendly', after: 'formal' },
      ]);
      expect((rows[0]!.before as Record<string, unknown>)['tone']).toBe('friendly');
      expect((rows[0]!.after as Record<string, unknown>)['tone']).toBe('formal');

      const audit = await auditOf('ai.config_changed');
      expect(audit).toHaveLength(1);
      expect(audit[0]!.target).toBe(`ai_config_change:${rows[0]!.id}`);
      expect(audit[0]!.metadata).toMatchObject({
        entity_type: 'persona',
        entity_id: aiAgentId,
        fields: ['tone'],
      });
      // Field names only: the audit row never carries a value.
      expect(JSON.stringify(audit[0]!.metadata)).not.toContain('formal');
    });

    it('a save that changes nothing writes no row', async () => {
      await server.patch(`/ai-agents/${aiAgentId}`, { tone: 'friendly' }, ownerAuth);
      expect(await changesOf(aiAgentId)).toHaveLength(0);
      expect(await auditOf('ai.config_changed')).toHaveLength(0);
    });

    it('pausing and resuming the agent are their own actions, in the trail too', async () => {
      await owner.aiAgent.update({ where: { id: aiAgentId }, data: { active: true } });
      await server.patch(`/ai-agents/${aiAgentId}`, { active: false }, ownerAuth);
      expect((await changesOf(aiAgentId)).map((row) => row.action)).toEqual(['paused']);
      expect(await auditOf('ai.paused')).toHaveLength(1);
    });

    it('a deleted skill keeps its whole previous state', async () => {
      const id = await createSkill();
      const removed = await server.del(`/skills/${id}`, ownerAuth);
      expect(removed.statusCode, removed.body).toBe(204);

      const rows = await changesOf(id);
      expect(rows.map((row) => row.action)).toEqual(['created', 'deleted']);
      const deleted = rows[1]!;
      expect(deleted.after).toBeNull();
      expect(deleted.before).toMatchObject({
        id,
        name: 'Bonus soruları',
        instruction: 'Bonus şartlarını anlat.',
        ai_agent_id: aiAgentId,
        kind: 'ai_agent',
        active: false,
      });
      expect(deleted.entityType).toBe('skill');
    });

    it('rolls back with the write: a failed save leaves no change row', async () => {
      const id = await createSkill();
      const before = (await changesOf(id)).length;
      await expect(
        withTenant(appRole, mine(), async (tx) => {
          await updateSkillDraft(
            tx,
            {
              audit: {
                licenseId: fx.a.licenseId,
                chainSecret: testEnv().AUDIT_CHAIN_SECRET,
                actorId: fx.a.ownerAccountId,
                actorType: 'agent',
              },
              role: 'owner',
            },
            id,
            { name: 'Yarıda kalan' },
          );
          throw new Error('the save fails after the write');
        }),
      ).rejects.toThrow('the save fails');
      expect(await changesOf(id)).toHaveLength(before);
      expect((await owner.skill.findUniqueOrThrow({ where: { id } })).name).toBe('Bonus soruları');
    });

    it('records the other editing tables through the same door, one row per save', async () => {
      const rule = await server.post(
        '/ai-guidance',
        {
          ai_agent_id: aiAgentId,
          title: 'Ödeme bilgisi',
          body: 'Ödeme yöntemlerini tablodan oku.',
          category: 'other',
        },
        ownerAuth,
      );
      expect(rule.statusCode, rule.body).toBe(201);
      const ruleId = (rule.json() as { id: string }).id;
      const patched = await server.patch(`/ai-guidance/${ruleId}`, { priority: 5 }, ownerAuth);
      expect(patched.statusCode, patched.body).toBe(200);

      const row = await server.post(
        '/knowledge-tables/payment-methods',
        {
          name: 'Papara',
          direction: 'deposit',
          currency: 'TRY',
          min_amount: 100,
          max_amount: 50_000,
        },
        ownerAuth,
      );
      expect(row.statusCode, row.body).toBe(201);
      const rowId = (row.json() as { id: string }).id;

      const ruleRows = await changesOf(ruleId);
      expect(ruleRows.map((r) => [r.entityType, r.action])).toEqual([
        ['guidance_rule', 'created'],
        ['guidance_rule', 'updated'],
      ]);
      expect(ruleRows[1]!.diff).toEqual([
        expect.objectContaining({ path: 'priority', kind: 'changed', after: 5 }),
      ]);
      // The row, not its mirrored knowledge source: one save, one row.
      const tableRows = await owner.aiConfigChange.findMany({
        where: {
          licenseId: fx.a.licenseId,
          entityType: { in: ['knowledge_table_row', 'knowledge_source'] },
        },
      });
      expect(tableRows.map((r) => [r.entityType, r.entityId, r.action])).toEqual([
        ['knowledge_table_row', rowId, 'created'],
      ]);
    });

    it('masks secrets in a knowledge text, and keeps a text over 20 KB as its digest', async () => {
      const masked = await server.post(
        '/knowledge-sources',
        {
          ai_agent_id: aiAgentId,
          name: 'Kart notu',
          content: 'Örnek kart 4111 1111 1111 1111 asla paylaşılmaz.',
        },
        ownerAuth,
      );
      expect(masked.statusCode, masked.body).toBe(201);
      const maskedId = (masked.json() as { id: string }).id;
      const [stored] = await changesOf(maskedId);
      const content = (stored!.after as Record<string, unknown>)['content'] as string;
      expect(content).not.toContain('4111 1111 1111 1111');
      expect(content).toContain('asla paylaşılmaz');

      const big = await server.post(
        '/knowledge-sources',
        {
          ai_agent_id: aiAgentId,
          name: 'Uzun metin',
          content: `${'Bonus kuralları uzun bir metin. '.repeat(Math.ceil((AI_CONFIG_TEXT_LIMIT_BYTES + 100) / 32))}`,
        },
        ownerAuth,
      );
      expect(big.statusCode, big.body).toBe(201);
      const [large] = await changesOf((big.json() as { id: string }).id);
      expect((large!.after as Record<string, unknown>)['content']).toMatchObject({
        omitted: 'too_large',
        sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
      });
    });
  });

  describe('the database', () => {
    it('refuses the application an UPDATE or a DELETE', async () => {
      await server.patch(`/ai-agents/${aiAgentId}`, { tone: 'formal' }, ownerAuth);
      await expect(
        withTenant(
          appRole,
          mine(),
          (tx) => tx.$executeRaw`UPDATE ai_config_changes SET note = 'rewritten'`,
        ),
      ).rejects.toThrow(/permission denied/i);
      await expect(
        withTenant(appRole, mine(), (tx) => tx.$executeRaw`DELETE FROM ai_config_changes`),
      ).rejects.toThrow(/permission denied/i);
      expect(await changesOf(aiAgentId)).toHaveLength(1);
    });

    it('keeps the rows through the 30-day audit prune; only its own five-year window takes them', async () => {
      await server.patch(`/ai-agents/${aiAgentId}`, { tone: 'formal' }, ownerAuth);
      const [recent] = await changesOf(aiAgentId);
      // An old change, written as the owner so its moment can be set.
      await owner.aiConfigChange.create({
        data: {
          id: '00000000-0000-4000-8000-000000000315',
          licenseId: fx.a.licenseId,
          entityType: 'persona',
          entityId: aiAgentId,
          action: 'updated',
          actorType: 'system',
          actorId: 'test',
          at: new Date(Date.now() - 60 * DAY),
          diff: [],
        },
      });
      await owner.aiConfigChange.create({
        data: {
          id: '00000000-0000-4000-8000-000000000316',
          licenseId: fx.a.licenseId,
          entityType: 'persona',
          entityId: aiAgentId,
          action: 'updated',
          actorType: 'system',
          actorId: 'test',
          at: new Date(Date.now() - (AI_CONFIG_HISTORY_DAYS + 2) * DAY),
          diff: [],
        },
      });
      await owner.auditLogEntry.updateMany({
        where: { licenseId: fx.a.licenseId },
        data: { createdAt: new Date(Date.now() - 60 * DAY) },
      });

      const mailDir = await mkdtemp(join(tmpdir(), 'siyahtus-ai-history-'));
      try {
        const report = await new RetentionRunner(appRole, {
          policy: { threadDays: 365, visitDays: 90, mailDays: 30, auditDays: 30 },
          mailDir,
          auditChainSecret: testEnv().AUDIT_CHAIN_SECRET,
        }).run({ dryRun: false });
        const tenant = report.tenants.find((t) => t.licenseId === String(fx.a.licenseId));
        expect(tenant?.auditEntries).toBeGreaterThan(0);
        expect(tenant?.aiConfigChanges).toBe(1);
      } finally {
        await rm(mailDir, { recursive: true, force: true });
      }
      expect((await changesOf(aiAgentId)).map((row) => row.id).sort()).toEqual(
        [recent!.id, '00000000-0000-4000-8000-000000000315'].sort(),
      );
    });

    it('the prune refuses a cutoff that is not in the past', async () => {
      await expect(
        appRole.$queryRaw`SELECT ai_config_changes_prune_expired(${fx.a.licenseId}, now() + interval '1 day')`,
      ).rejects.toThrow(/refuses/);
    });

    it('RLS keeps one workspace out of another’s history', async () => {
      await server.patch(`/ai-agents/${aiAgentId}`, { tone: 'formal' }, ownerAuth);
      expect(
        await withTenant(
          appRole,
          { licenseId: fx.b.licenseId, organizationId: fx.b.organizationId },
          (tx) => tx.aiConfigChange.count(),
        ),
      ).toBe(0);
      const theirs = await server.get('/ai/changes', foreignAuth);
      expect(theirs.statusCode, theirs.body).toBe(200);
      expect((theirs.json() as { items: Change[] }).items).toEqual([]);
      const [row] = await changesOf(aiAgentId);
      expect((await server.get(`/ai/changes/${row!.id}`, foreignAuth)).statusCode).toBe(404);
    });
  });

  describe('reading', () => {
    it('lists newest first with a cursor, filters, and opens one change with before and after', async () => {
      await server.patch(`/ai-agents/${aiAgentId}`, { tone: 'formal' }, ownerAuth);
      const skillId = await createSkill();
      await server.patch(`/skills/${skillId}`, { name: 'Bonus' }, ownerAuth);

      const first = await server.get('/ai/changes?limit=2', ownerAuth);
      expect(first.statusCode, first.body).toBe(200);
      const page = first.json() as {
        items: Change[];
        next_cursor: string | null;
        visibility: string;
      };
      expect(page.visibility).toBe('all');
      expect(page.items.map((c) => [c.entity_type, c.action])).toEqual([
        ['skill', 'updated'],
        ['skill', 'created'],
      ]);
      expect(page.items[0]).toMatchObject({
        entity_name: 'Bonus',
        fields: ['name'],
        actor: { id: fx.a.ownerAccountId, type: 'agent', role: 'owner' },
      });
      const next = await server.get(
        `/ai/changes?limit=2&cursor=${encodeURIComponent(page.next_cursor!)}`,
        ownerAuth,
      );
      expect((next.json() as { items: Change[] }).items.map((c) => c.entity_type)).toEqual([
        'persona',
      ]);

      const filtered = await server.get(
        `/ai/changes?entity_type=skill&entity_id=${skillId}&action=created`,
        ownerAuth,
      );
      expect((filtered.json() as { items: Change[] }).items).toHaveLength(1);

      const detail = await server.get(`/ai/changes/${page.items[0]!.id}`, ownerAuth);
      expect(detail.statusCode, detail.body).toBe(200);
      expect(detail.json()).toMatchObject({
        before: { name: 'Bonus soruları' },
        after: { name: 'Bonus' },
      });
      expect((await server.get('/ai/changes?cursor=nonsense', ownerAuth)).statusCode).toBe(400);
    });

    it('a Team Lead sees their own changes and the publish history, nothing else', async () => {
      await server.patch(`/ai-agents/${aiAgentId}`, { tone: 'formal' }, ownerAuth);
      const lead = await member('team_lead');
      const base = {
        licenseId: fx.a.licenseId,
        entityType: 'skill',
        entityId: aiAgentId,
        action: 'updated',
        actorType: 'agent',
        diff: [],
      };
      await owner.aiConfigChange.create({
        data: { ...base, id: '00000000-0000-4000-8000-0000000003a1', actorId: lead.accountId },
      });
      await owner.aiConfigChange.create({
        data: {
          ...base,
          id: '00000000-0000-4000-8000-0000000003a2',
          actorId: fx.a.ownerAccountId,
          entityType: 'config_version',
          action: 'published',
        },
      });

      const listed = await server.get('/ai/changes', lead.auth);
      expect(listed.statusCode, listed.body).toBe(200);
      const body = listed.json() as { items: Change[]; visibility: string };
      expect(body.visibility).toBe('own');
      expect(body.items.map((c) => c.id).sort()).toEqual([
        '00000000-0000-4000-8000-0000000003a1',
        '00000000-0000-4000-8000-0000000003a2',
      ]);
      const [ownersTone] = await changesOf(aiAgentId);
      expect((await server.get(`/ai/changes/${ownersTone!.id}`, lead.auth)).statusCode).toBe(404);
      expect((await server.get('/ai/changes/export', lead.auth)).statusCode).toBe(403);

      const agent = await member('agent');
      expect((await server.get('/ai/changes', agent.auth)).statusCode).toBe(403);
    });

    it('exports who, when, entity, field, before, after and version as CSV', async () => {
      await server.patch(`/ai-agents/${aiAgentId}`, { tone: 'formal' }, ownerAuth);
      const response = await server.get('/ai/changes/export', ownerAuth);
      expect(response.statusCode, response.body).toBe(200);
      expect(response.headers['content-type']).toContain('text/csv');
      const [header, line] = response.body.trimEnd().split('\r\n');
      expect(header).toBe(
        'at,actor,actor_role,entity_type,entity_id,entity_name,action,field,before,after,version_id,change_id',
      );
      const owners = await owner.account.findUniqueOrThrow({
        where: { id: fx.a.ownerAccountId },
        select: { name: true },
      });
      const cells = line!.split(',');
      expect(cells.slice(1, 10)).toEqual([
        owners.name,
        'owner',
        'persona',
        aiAgentId,
        'Ada',
        'updated',
        'tone',
        'friendly',
        'formal',
      ]);
      expect(cells[10]).toBe('');
    });
  });
});
