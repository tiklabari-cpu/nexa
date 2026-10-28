/**
 * The AI configuration compiler against the database (tm 316.5 · SiyahTuş
 * analysis AI-20 · ADR-14b `docs/adr/ai-config-versioning.md` §2.4, §2.10 (1)).
 *
 * What the pure checks in `config-compiler.test.ts` cannot show: which rows
 * the draft is read from (the agent's active skills, even while it is paused;
 * the knowledge sources the customer-facing agent may use, not retired), that
 * the package stored in `jsonb` hashes to what the compiler wrote, and that a
 * hand-over target is judged against the workspace's teams as they are now —
 * a rule's team is a soft reference, so a team deleted later is a problem the
 * submission finds.
 */
import { createHash, randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AI_CONFIG_PACKAGE_FORMAT } from '@siyahtus/types';
import { withTenant, type TenantClient } from '../../src/lib/tenant.js';
import { canonicalJson } from '../../src/services/audit/audit-chain.js';
import { compileDraft, diffAiConfig } from '../../src/services/ai/config-compiler.js';
import { ownerClient, seedFixtures, type Fixtures } from '../helpers/fixtures.js';

const APP_URL = process.env['DATABASE_APP_URL'];

describe('AI configuration compiler (AI-20 · tm 316.5)', () => {
  let owner: PrismaClient;
  let appRole: PrismaClient;
  let fx: Fixtures;
  let agentA: string;
  let teamId: bigint;

  const asA = <T>(fn: (tx: TenantClient) => Promise<T>) =>
    withTenant(appRole, { licenseId: fx.a.licenseId, organizationId: fx.a.organizationId }, fn);
  const compileA = (options?: { maxBytes?: number }) =>
    asA((tx) => compileDraft(tx, agentA, options));

  const skill = (data: { name: string; steps: unknown; active?: boolean; locked?: boolean }) =>
    owner.skill.create({
      data: {
        licenseId: fx.a.licenseId,
        aiAgentId: agentA,
        kind: 'ai_agent',
        name: data.name,
        steps: data.steps as object,
        active: data.active ?? true,
        locked: data.locked ?? false,
      },
      select: { id: true },
    });

  const source = (data: {
    name: string;
    audiences?: string[];
    aiAgentIds?: string[];
    status?: string;
    retiredAt?: Date;
  }) =>
    owner.knowledgeSource.create({
      data: {
        licenseId: fx.a.licenseId,
        aiAgentId: agentA,
        type: 'article',
        name: data.name,
        status: data.status ?? 'ready',
        ...(data.audiences ? { audiences: data.audiences } : {}),
        ...(data.aiAgentIds ? { aiAgentIds: data.aiAgentIds } : {}),
        ...(data.retiredAt ? { retiredAt: data.retiredAt } : {}),
      },
      select: { id: true },
    });

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
    agentA = (
      await owner.aiAgent.create({
        data: { licenseId: fx.a.licenseId, kind: 'ai_agent', name: 'Ada', tone: 'friendly' },
        select: { id: true },
      })
    ).id;
    teamId = (
      await owner.group.create({
        data: { licenseId: fx.a.licenseId, name: 'Payments' },
        select: { id: true },
      })
    ).id;
  });

  it('compiles the active draft and the knowledge the agent may use; the stored package hashes the same', async () => {
    const on = await skill({
      name: 'Withdrawals',
      steps: [
        { type: 'send_message', source: 'text', text: 'One moment.' },
        { type: 'transfer_to_team', group_id: Number(teamId), group: 'Payments' },
      ],
    });
    await skill({ name: 'Draft only', steps: [], active: false });
    await owner.aiGuidanceRule.create({
      data: {
        licenseId: fx.a.licenseId,
        aiAgentId: agentA,
        title: 'Address',
        body: 'Oyuncuya her zaman adıyla hitap et ve kısa cevap ver.',
        category: 'communication',
      },
    });
    const shared = await source({ name: 'Deposits FAQ' });
    const indexing = await source({ name: 'Bonus terms', status: 'indexing' });
    await source({ name: 'Copilot notes', audiences: ['copilot'] });
    // Scoped to another agent (one per workspace in v1, so a bare id: the array has no foreign key).
    await source({ name: "Other agent's", aiAgentIds: [randomUUID()] });
    await source({ name: 'Retired', retiredAt: new Date() });
    await owner.knowledgeSource.update({
      where: { id: shared.id },
      data: { chunkGeneration: 3 },
    });
    // A paused agent's draft is compiled all the same: pausing is not versioned.
    await owner.aiAgent.update({
      where: { id: agentA },
      data: { active: false, draftRevision: 4n },
    });

    const result = await compileA();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { compiled } = result;
    expect(result.draftRevision).toBe(4n);
    expect(compiled.packageFormat).toBe(AI_CONFIG_PACKAGE_FORMAT);
    expect(compiled.snapshot.agent).toMatchObject({ id: agentA, persona: { tone: 'friendly' } });
    expect(compiled.snapshot.turn.skills.map((row) => row.id)).toEqual([on.id]);
    expect(compiled.snapshot.turn.guidance).toHaveLength(1);
    expect(compiled.knowledgeManifest.map((entry) => [entry.source_id, entry.generation])).toEqual(
      [
        [shared.id, 3],
        [indexing.id, 1],
      ].sort((a, b) => (String(a[0]) < String(b[0]) ? -1 : 1)),
    );
    expect(result.warnings).toMatchObject([
      { code: 'knowledge_source_not_ready', key: indexing.id, details: { status: 'indexing' } },
    ]);

    const text = canonicalJson(compiled.snapshot);
    expect(compiled.snapshotHash).toBe(createHash('sha256').update(text, 'utf8').digest('hex'));
    expect(compiled.bytes).toBe(Buffer.byteLength(text, 'utf8'));

    // Through jsonb and back, the package is the one that was hashed.
    const stored = await asA((tx) =>
      tx.aiConfigVersion.create({
        data: {
          licenseId: fx.a.licenseId,
          aiAgentId: agentA,
          number: 2,
          status: 'in_review',
          snapshot: compiled.snapshot as object,
          snapshotHash: compiled.snapshotHash,
          packageFormat: compiled.packageFormat,
          knowledgeManifest: compiled.knowledgeManifest as object[],
          draftRevision: result.draftRevision,
        },
      }),
    );
    expect(createHash('sha256').update(canonicalJson(stored.snapshot), 'utf8').digest('hex')).toBe(
      compiled.snapshotHash,
    );
    const unchanged = diffAiConfig(
      {
        versionId: stored.id,
        packageFormat: stored.packageFormat,
        snapshot: stored.snapshot,
        knowledgeManifest: stored.knowledgeManifest,
      },
      compiled,
    );
    expect(unchanged.changes).toBe(0);
  });

  it('refuses a draft whose steps, rules or hand-over targets would not hold', async () => {
    const broken = await skill({
      name: 'Broken',
      steps: [{ type: 'send_message', source: 'text' }],
    });
    const rule = await owner.aiHandoffRule.create({
      data: {
        licenseId: fx.a.licenseId,
        aiAgentId: agentA,
        position: 1,
        title: 'Payments',
        triggerType: 'player_request',
        targetGroupId: teamId,
      },
      select: { id: true },
    });
    const locked = await owner.aiGuidanceRule.create({
      data: {
        licenseId: fx.a.licenseId,
        aiAgentId: agentA,
        title: 'Credentials',
        body: 'Oyuncudan şifresini iste.',
        category: 'other',
      },
      select: { id: true },
    });
    // The rule's team is a soft reference: deleting the team leaves it pointing nowhere.
    await owner.group.delete({
      where: { licenseId_id: { licenseId: fx.a.licenseId, id: teamId } },
    });

    const result = await compileA();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.draftRevision).toBe(0n);
    expect(result.problems.map((problem) => [problem.code, problem.key])).toEqual([
      ['skill_steps_invalid', broken.id],
      ['guidance_locked_rule', locked.id],
      ['handoff_target_unknown_team', `rule:${rule.id}`],
    ]);
  });

  it('refuses a package larger than a version holds', async () => {
    await skill({
      name: 'Greeting',
      steps: [{ type: 'send_message', source: 'text', text: 'Hi' }],
    });
    const result = await compileA({ maxBytes: 64 });
    expect(result).toMatchObject({ ok: false, problems: [{ code: 'package_too_large' }] });
  });

  it("knows no Copilot and no other workspace's agent", async () => {
    const copilot = await owner.aiAgent.create({
      data: { licenseId: fx.a.licenseId, kind: 'copilot', name: 'Copilot' },
      select: { id: true },
    });
    const theirs = await owner.aiAgent.create({
      data: { licenseId: fx.b.licenseId, kind: 'ai_agent', name: 'Bea' },
      select: { id: true },
    });
    for (const id of [copilot.id, theirs.id]) {
      const result = await asA((tx) => compileDraft(tx, id));
      expect(result).toMatchObject({
        ok: false,
        draftRevision: null,
        problems: [{ code: 'agent_not_found' }],
      });
    }
  });

  it('tells a guardrail edit as a compliance change and a new chunk generation as a knowledge one', async () => {
    await skill({
      name: 'Greeting',
      steps: [{ type: 'send_message', source: 'text', text: 'Hi' }],
    });
    const faq = await source({ name: 'FAQ' });
    const first = await compileA();
    if (!first.ok) throw new Error('the first draft compiles');
    const base = {
      versionId: 'published',
      packageFormat: first.compiled.packageFormat,
      snapshot: first.compiled.snapshot,
      knowledgeManifest: first.compiled.knowledgeManifest,
    };

    await owner.knowledgeSource.update({ where: { id: faq.id }, data: { chunkGeneration: 2 } });
    const reindexed = await compileA();
    if (!reindexed.ok) throw new Error('the reindexed draft compiles');
    expect(diffAiConfig(base, reindexed.compiled)).toMatchObject({
      changes: 1,
      sections: [{ section: 'knowledge', changed: 1, items: [{ key: faq.id, kind: 'changed' }] }],
      touches_compliance: false,
    });

    const phrase = await owner.aiForbiddenPhrase.create({
      data: { licenseId: fx.a.licenseId, aiAgentId: agentA, phrase: 'garanti kazanç' },
      select: { id: true },
    });
    const guarded = await compileA();
    if (!guarded.ok) throw new Error('the guarded draft compiles');
    const diff = diffAiConfig(base, guarded.compiled);
    expect(diff).toMatchObject({ touches_compliance: true, compliance: ['guardrails'] });
    expect(diff.sections.find((section) => section.section === 'guardrails')?.items).toEqual([
      { key: `phrase:${phrase.id}`, kind: 'added' },
    ]);
  });
});
