/**
 * The unresolved questions report's endpoints (tm 317.3 · SiyahTuş analysis
 * AI-22 · `paths/ai-unresolved.yaml`), through the real server:
 *
 *   - **The list.** Open clusters by the last seven days' count; an ignored one
 *     is counted but out of the default view (AI-22 acceptance 4) and back with
 *     `status`; the rates, the "new" badge, the items still without a cluster;
 *     `reason`/`language`/`brand_id`/`from`/`to` keep the clusters with such an
 *     item and count them.
 *   - **The detail.** The newest masked examples with their `chat_id` and
 *     `thread_id` (the title may mislead, so they are always there), a 14-day
 *     trend, the languages.
 *   - **The moves.** Ignore and bring back; resolve starts "after the fix" from
 *     zero; merge adds the counts and refuses a stranger; suggest-knowledge is a
 *     proposal; add-examples writes the procedure's draft, masked, without
 *     duplicates, within the 30, never into a locked copy or another agent's
 *     procedure.
 *   - **The alarm's threshold** the report sets is the one the job reads.
 *   - **Who.** `:ro` reads, `:rw` acts, a team member neither; another
 *     workspace's clusters are not found (NFR-S4).
 */
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_AGENT_SCOPES,
  PROCEDURE_EXAMPLES_MAX,
  splitSkillProcedure,
  UNRESOLVED_SPIKE_THRESHOLD_DEFAULT,
  type UnresolvedReason,
} from '@siyahtus/types';
import { withTenant } from '../../src/lib/tenant.js';
import { readUnresolvedSpikeThreshold } from '../../src/services/ai/unresolved/cluster-job.js';
import { customerAsks, seedAiWorkspace, type AiWorkspace } from '../helpers/ai-workspace.js';
import { grantToken, ownerClient, resetDatabase } from '../helpers/fixtures.js';
import { paparaAcceptanceProcedure } from '../helpers/procedure-fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

type Json = Record<string, unknown>;

interface ClusterBody {
  id: string;
  label: string;
  status: string;
  ignore_reason: string | null;
  item_count: number;
  count_7d: number;
  handoff_rate: number;
  abandon_rate: number;
  post_fix_count: number;
  is_new: boolean;
  resolved_at: string | null;
  linked_change_id: string | null;
  reasons: Array<{ reason: string; count: number }>;
  matching_count: number | null;
}

interface ListBody {
  clusters: ClusterBody[];
  total: number;
  unclustered_count: number;
  spike_threshold: number;
}

interface DetailBody extends ClusterBody {
  examples: Array<{
    text: string;
    context: string | null;
    reason: string;
    language: string | null;
    chat_id: string;
    thread_id: string;
  }>;
  trend: Array<{ date: string; count: number }>;
  languages: Array<{ language: string | null; count: number }>;
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const MODEL_SPACE = 'test:report-1536';

describe('the unresolved questions report’s endpoints (tm 317.3 · AI-22)', () => {
  let owner: PrismaClient;
  let server: TestServer;
  let ws: AiWorkspace;
  let other: AiWorkspace;
  let token: string;
  let chat: { chatId: string; threadId: string };

  const auth = (t = token) => ({ authorization: `Bearer ${t}` });
  // An OAuth credential is held to the member's role (an owner's has `:rw`, not a
  // literal `:ro`), so a read-only one is a PAT.
  const tokenFor = (w: AiWorkspace, scopes: string[], kind: 'oauth' | 'pat' = 'oauth') =>
    grantToken(owner, {
      licenseId: w.licenseId,
      organizationId: w.organizationId,
      ownerId: w.ownerId,
      scopes,
      kind,
    });
  const cluster = (id: string, action: string, body?: Json, t = token) =>
    server.post(`/ai/unresolved/clusters/${id}/${action}`, body ?? {}, auth(t));
  const list = async (query = '', t = token) => {
    const response = await server.get(
      `/ai/unresolved/clusters?ai_agent_id=${ws.aiAgentId}${query}`,
      auth(t),
    );
    expect(response.statusCode, response.body).toBe(200);
    return response.json() as ListBody;
  };

  async function chatOf(w: AiWorkspace): Promise<{ chatId: string; threadId: string }> {
    const { chatId } = await customerAsks(owner, server, w, 'merhaba nasılsınız bugün');
    // The AI may have noted the visitor's own words: this suite writes its own items.
    await owner.aiUnresolvedItem.deleteMany({ where: { licenseId: w.licenseId } });
    const event = await owner.event.findFirstOrThrow({
      where: { chatId },
      select: { threadId: true },
    });
    return { chatId, threadId: event.threadId };
  }

  async function makeCluster(
    w: AiWorkspace,
    data: Partial<{
      aiAgentId: string;
      label: string;
      status: string;
      itemCount: number;
      count7d: number;
      handoffCount: number;
      abandonCount: number;
      postFixCount: number;
      firstSeen: Date;
      lastSeen: Date;
      space: string;
    }> = {},
  ): Promise<string> {
    const status = data.status ?? 'open';
    return (
      await owner.aiUnresolvedCluster.create({
        data: {
          licenseId: w.licenseId,
          aiAgentId: data.aiAgentId ?? w.aiAgentId,
          label: data.label ?? 'Papara yatırma',
          embeddingSpace: data.space ?? MODEL_SPACE,
          itemCount: data.itemCount ?? 0,
          count7d: data.count7d ?? 0,
          handoffCount: data.handoffCount ?? 0,
          abandonCount: data.abandonCount ?? 0,
          postFixCount: data.postFixCount ?? 0,
          status,
          ...(status === 'resolved' ? { resolvedAt: new Date() } : {}),
          ...(status === 'ignored' ? { ignoreReason: 'bilinen' } : {}),
          firstSeen: data.firstSeen ?? new Date(Date.now() - 10 * DAY),
          lastSeen: data.lastSeen ?? new Date(),
        },
        select: { id: true },
      })
    ).id;
  }

  async function addItem(
    w: AiWorkspace,
    clusterId: string | null,
    text: string,
    options: Partial<{
      reason: UnresolvedReason;
      language: string | null;
      brandId: string | null;
      at: Date;
      context: string | null;
    }> = {},
  ): Promise<void> {
    await owner.aiUnresolvedItem.create({
      data: {
        licenseId: w.licenseId,
        aiAgentId: w.aiAgentId,
        clusterId,
        chatId: chat.chatId,
        threadId: chat.threadId,
        textMasked: text,
        contextMasked: options.context ?? null,
        reason: options.reason ?? 'no_procedure_match',
        language: options.language === undefined ? 'tr' : options.language,
        brandId: options.brandId ?? null,
        createdAt: options.at ?? new Date(),
      },
    });
  }

  async function makeSkill(
    w: AiWorkspace,
    data: Partial<{ examples: string[]; locked: boolean; aiAgentId: string }> = {},
  ): Promise<string> {
    const { procedure, ...own } = splitSkillProcedure(paparaAcceptanceProcedure());
    return (
      await owner.skill.create({
        data: {
          licenseId: w.licenseId,
          aiAgentId: data.aiAgentId ?? w.aiAgentId,
          name: 'Papara yatırma',
          kind: 'ai_agent',
          mode: 'procedure',
          whenToUse: own.when_to_use,
          examples: data.examples ?? ['Papara ile yatırdım gözükmüyor'],
          priority: own.priority,
          slots: own.slots as object,
          procedure: procedure as object,
          locked: data.locked ?? false,
          active: false,
          updatedAt: new Date(),
        },
        select: { id: true },
      })
    ).id;
  }

  beforeAll(async () => {
    owner = ownerClient();
    server = await startTestServer();
  });

  afterAll(async () => {
    await server.close();
    await owner.$disconnect();
  });

  beforeEach(async () => {
    await resetDatabase(owner);
    await clearRateLimits(server.app);
    ws = await seedAiWorkspace(owner);
    other = await seedAiWorkspace(owner);
    token = await tokenFor(ws, ['agents-bot--all:rw']);
    chat = await chatOf(ws);
  });

  describe('the list', () => {
    it('lists the open clusters by the last seven days, and keeps an ignored one out of the default view while counting it (AI-22 acceptance 4)', async () => {
      const busy = await makeCluster(ws, { label: 'Papara', itemCount: 12, count7d: 9 });
      const quiet = await makeCluster(ws, { label: 'Bonus', itemCount: 30, count7d: 2 });
      const ignored = await makeCluster(ws, {
        label: 'Eski soru',
        status: 'ignored',
        itemCount: 40,
        count7d: 40,
      });
      const fixed = await makeCluster(ws, { label: 'Düzelen', status: 'resolved', count7d: 50 });
      await makeCluster(other, { label: 'Başkasının', count7d: 99 });

      const open = await list();
      expect(open.clusters.map((c) => c.id)).toEqual([busy, quiet]);
      expect(open.total).toBe(2);
      expect(open.spike_threshold).toBe(UNRESOLVED_SPIKE_THRESHOLD_DEFAULT);

      expect((await list('&status=ignored')).clusters.map((c) => c.id)).toEqual([ignored]);
      expect((await list('&status=resolved')).clusters.map((c) => c.id)).toEqual([fixed]);
      expect((await list('&status=all')).clusters.map((c) => c.id)).toEqual([
        fixed,
        ignored,
        busy,
        quiet,
      ]);
      // The ignored cluster's counts are all there for whoever looks.
      expect((await list('&status=ignored')).clusters[0]).toMatchObject({
        item_count: 40,
        count_7d: 40,
        status: 'ignored',
      });
    });

    it('sorts by the hand-over rate, the abandon rate, the first and the last sighting, and shows the "new" badge', async () => {
      const handed = await makeCluster(ws, {
        label: 'Devir',
        itemCount: 10,
        handoffCount: 8,
        abandonCount: 0,
        count7d: 1,
        firstSeen: new Date(Date.now() - 20 * DAY),
        lastSeen: new Date(Date.now() - 5 * DAY),
      });
      const left = await makeCluster(ws, {
        label: 'Terk',
        itemCount: 10,
        handoffCount: 1,
        abandonCount: 6,
        count7d: 5,
        firstSeen: new Date(Date.now() - 2 * HOUR),
        lastSeen: new Date(Date.now() - HOUR / 2),
      });
      const rate = (await list('&sort=handoff_rate')).clusters;
      expect(rate.map((c) => c.id)).toEqual([handed, left]);
      expect(rate[0]).toMatchObject({ handoff_rate: 0.8, abandon_rate: 0, is_new: false });
      expect((await list('&sort=abandon_rate')).clusters.map((c) => c.id)).toEqual([left, handed]);
      const firstSeen = (await list('&sort=first_seen')).clusters;
      expect(firstSeen.map((c) => c.id)).toEqual([left, handed]);
      expect(firstSeen[0]!.is_new).toBe(true);
      expect((await list('&sort=last_seen')).clusters.map((c) => c.id)).toEqual([left, handed]);
      expect((await list()).clusters.map((c) => c.id)).toEqual([left, handed]);
    });

    it('keeps the clusters that have an item of the asked reason, language, brand and time — and counts those', async () => {
      const brand = await owner.brand.create({
        data: { licenseId: ws.licenseId, name: 'Marka A', slug: 'marka-a' },
        select: { id: true },
      });
      const a = await makeCluster(ws, { label: 'A', itemCount: 3, count7d: 3 });
      const b = await makeCluster(ws, { label: 'B', itemCount: 2, count7d: 2 });
      await addItem(ws, a, 'param yatmadı hala', { reason: 'no_knowledge', language: 'tr' });
      await addItem(ws, a, 'my deposit is missing', {
        reason: 'said_dont_know',
        language: 'en',
        brandId: brand.id,
      });
      await addItem(ws, a, 'param nerede kaldı', {
        reason: 'no_knowledge',
        language: 'tr',
        at: new Date(Date.now() - 30 * DAY),
      });
      await addItem(ws, b, 'bonus gelmedi bana', { reason: 'player_abandoned', language: 'tr' });
      await addItem(ws, null, 'kümesiz bir soru geldi', {});

      const plain = await list();
      expect(plain.clusters.every((c) => c.matching_count === null)).toBe(true);
      expect(plain.unclustered_count).toBe(1);
      expect(plain.clusters.find((c) => c.id === a)!.reasons).toEqual([
        { reason: 'no_knowledge', count: 2 },
        { reason: 'said_dont_know', count: 1 },
      ]);

      const byReason = await list('&reason=no_knowledge');
      expect(byReason.clusters.map((c) => [c.id, c.matching_count])).toEqual([[a, 2]]);
      expect((await list('&language=en')).clusters.map((c) => [c.id, c.matching_count])).toEqual([
        [a, 1],
      ]);
      expect(
        (await list(`&brand_id=${brand.id}`)).clusters.map((c) => [c.id, c.matching_count]),
      ).toEqual([[a, 1]]);
      const recent = await list(
        `&from=${encodeURIComponent(new Date(Date.now() - 7 * DAY).toISOString())}`,
      );
      expect(recent.clusters.map((c) => [c.id, c.matching_count]).sort()).toEqual(
        [
          [a, 2],
          [b, 1],
        ].sort(),
      );
      expect((await list('&reason=agent_flagged')).clusters).toEqual([]);
    });

    it('refuses a bad query, a stranger’s agent and a brand that is not the workspace’s', async () => {
      const bad = [
        '&sort=newest',
        '&status=done',
        '&language=turkish',
        '&reason=because',
        '&limit=0',
        '&limit=101',
        '&from=yesterday',
      ];
      for (const query of bad) {
        expect(
          (await server.get(`/ai/unresolved/clusters?ai_agent_id=${ws.aiAgentId}${query}`, auth()))
            .statusCode,
          query,
        ).toBe(400);
      }
      expect((await server.get('/ai/unresolved/clusters', auth())).statusCode).toBe(400);
      expect(
        (await server.get(`/ai/unresolved/clusters?ai_agent_id=${other.aiAgentId}`, auth()))
          .statusCode,
      ).toBe(404);
      const theirs = await owner.brand.create({
        data: { licenseId: other.licenseId, name: 'Onların', slug: 'onlarin' },
        select: { id: true },
      });
      expect(
        (
          await server.get(
            `/ai/unresolved/clusters?ai_agent_id=${ws.aiAgentId}&brand_id=${theirs.id}`,
            auth(),
          )
        ).statusCode,
      ).toBe(404);
    });

    it('pages the list', async () => {
      for (let i = 0; i < 5; i += 1) await makeCluster(ws, { label: `K${i}`, count7d: 10 - i });
      const first = await list('&limit=2');
      const second = await list('&limit=2&offset=2');
      expect(first.total).toBe(5);
      expect(first.clusters.map((c) => c.label)).toEqual(['K0', 'K1']);
      expect(second.clusters.map((c) => c.label)).toEqual(['K2', 'K3']);
    });
  });

  describe('one cluster', () => {
    it('gives the newest masked examples with their chat ids, a 14-day trend and the languages', async () => {
      const id = await makeCluster(ws, { itemCount: 4, count7d: 4 });
      await addItem(ws, id, 'en eski soru burada', {
        at: new Date(Date.now() - 20 * DAY),
        language: 'en',
      });
      await addItem(ws, id, 'param yatmadı hala', {
        at: new Date(Date.now() - 2 * DAY),
        context: 'Papara ile yatırdım',
      });
      await addItem(ws, id, 'kart **** **** **** 1234 çekildi', {
        at: new Date(Date.now() - HOUR),
      });
      await addItem(ws, id, 'en yeni soru da bu', {
        at: new Date(Date.now() - 2 * HOUR),
        reason: 'said_dont_know',
      });

      const response = await server.get(`/ai/unresolved/clusters/${id}`, auth());
      expect(response.statusCode, response.body).toBe(200);
      const detail = response.json() as DetailBody;
      expect(detail.examples.map((e) => e.text)).toEqual([
        'kart **** **** **** 1234 çekildi',
        'en yeni soru da bu',
        'param yatmadı hala',
        'en eski soru burada',
      ]);
      expect(detail.examples[2]).toMatchObject({
        context: 'Papara ile yatırdım',
        chat_id: chat.chatId,
        thread_id: chat.threadId,
        reason: 'no_procedure_match',
      });
      expect(detail.trend).toHaveLength(14);
      expect(detail.trend.reduce((sum, p) => sum + p.count, 0)).toBe(3);
      expect(detail.trend[13]!.count).toBeGreaterThanOrEqual(1);
      expect(detail.languages).toEqual([
        { language: 'tr', count: 3 },
        { language: 'en', count: 1 },
      ]);
      expect(detail.reasons[0]).toEqual({ reason: 'no_procedure_match', count: 3 });
    });

    it('is not found for a cluster that is another workspace’s, or none (NFR-S4)', async () => {
      const theirs = await makeCluster(other);
      for (const id of [theirs, '00000000-0000-4000-8000-000000000000']) {
        expect((await server.get(`/ai/unresolved/clusters/${id}`, auth())).statusCode).toBe(404);
        expect((await cluster(id, 'ignore')).statusCode).toBe(404);
        expect((await cluster(id, 'resolve')).statusCode).toBe(404);
        expect((await cluster(id, 'reopen')).statusCode).toBe(404);
        expect((await cluster(id, 'suggest-knowledge')).statusCode).toBe(404);
      }
      expect((await cluster(theirs, 'ignore')).statusCode).toBe(404);
      expect(
        (await owner.aiUnresolvedCluster.findUniqueOrThrow({ where: { id: theirs } })).status,
      ).toBe('open');
    });
  });

  describe('the moves', () => {
    it('ignores with a reason, brings it back, and the counts never stop', async () => {
      const id = await makeCluster(ws, { itemCount: 3, count7d: 3 });
      const ignored = await cluster(id, 'ignore', { reason: 'Bilinen sorun, ekip çözüyor' });
      expect(ignored.statusCode, ignored.body).toBe(200);
      expect(ignored.json()).toMatchObject({
        status: 'ignored',
        ignore_reason: 'Bilinen sorun, ekip çözüyor',
        item_count: 3,
      });
      expect((await list()).clusters).toEqual([]);
      expect((await list('&status=ignored')).clusters[0]!.count_7d).toBe(3);

      const reopened = await cluster(id, 'reopen');
      expect(reopened.json()).toMatchObject({ status: 'open', ignore_reason: null });
      expect((await list()).clusters.map((c) => c.id)).toEqual([id]);

      // A reason is optional, and not an empty one or a long one.
      expect((await cluster(id, 'ignore')).json()).toMatchObject({
        status: 'ignored',
        ignore_reason: null,
      });
      expect((await cluster(id, 'ignore', { reason: '  ' })).statusCode).toBe(400);
      expect((await cluster(id, 'ignore', { reason: 'x'.repeat(501) })).statusCode).toBe(400);
      expect((await cluster(id, 'ignore', { note: 'nope' })).statusCode).toBe(400);
    });

    it('marks fixed: the time is now and "after the fix" starts from zero — and an ignore or a reopen clears it', async () => {
      const id = await makeCluster(ws, { status: 'open', itemCount: 8, postFixCount: 4 });
      const change = '11111111-1111-4111-8111-111111111111';
      const before = Date.now();
      const resolved = await cluster(id, 'resolve', { linked_change_id: change });
      expect(resolved.statusCode, resolved.body).toBe(200);
      const body = resolved.json() as ClusterBody;
      expect(body).toMatchObject({
        status: 'resolved',
        post_fix_count: 0,
        linked_change_id: change,
      });
      expect(new Date(body.resolved_at!).getTime()).toBeGreaterThanOrEqual(before - 1000);
      expect((await list()).clusters).toEqual([]);
      expect((await list('&status=resolved')).clusters.map((c) => c.id)).toEqual([id]);

      // Fixed again: the count after the fix starts over.
      await owner.aiUnresolvedCluster.update({ where: { id }, data: { postFixCount: 3 } });
      expect((await cluster(id, 'resolve')).json()).toMatchObject({
        post_fix_count: 0,
        linked_change_id: null,
      });

      expect((await cluster(id, 'reopen')).json()).toMatchObject({
        status: 'open',
        resolved_at: null,
        post_fix_count: 0,
      });
      expect((await cluster(id, 'resolve', { linked_change_id: 'not-a-uuid' })).statusCode).toBe(
        400,
      );
    });

    it('merges clusters into one: the items move, the counts add up, the first sighting stays, the others are gone', async () => {
      const keep = await makeCluster(ws, {
        label: 'Kalan',
        itemCount: 5,
        count7d: 3,
        handoffCount: 1,
        firstSeen: new Date(Date.now() - 5 * DAY),
      });
      const a = await makeCluster(ws, {
        label: 'A',
        itemCount: 2,
        count7d: 2,
        handoffCount: 2,
        abandonCount: 1,
        firstSeen: new Date(Date.now() - 9 * DAY),
      });
      const b = await makeCluster(ws, { label: 'B', itemCount: 1, count7d: 1 });
      await addItem(ws, keep, 'kalan kümenin sorusu');
      await addItem(ws, a, 'a kümesinin sorusu');
      await addItem(ws, b, 'b kümesinin sorusu');

      const merged = await cluster(keep, 'merge', { source_ids: [a, b, a] });
      expect(merged.statusCode, merged.body).toBe(200);
      const body = merged.json() as { cluster: ClusterBody; absorbed: number };
      expect(body.absorbed).toBe(2);
      expect(body.cluster).toMatchObject({
        id: keep,
        label: 'Kalan',
        item_count: 8,
        count_7d: 6,
        handoff_rate: 0.375,
        abandon_rate: 0.125,
      });
      expect(await owner.aiUnresolvedCluster.count({ where: { id: { in: [a, b] } } })).toBe(0);
      expect(await owner.aiUnresolvedItem.count({ where: { clusterId: keep } })).toBe(3);
      const survivor = await owner.aiUnresolvedCluster.findUniqueOrThrow({ where: { id: keep } });
      expect(survivor.firstSeen.getTime()).toBeLessThan(Date.now() - 8 * DAY);
    });

    it('refuses a merge of a cluster into itself, of another agent’s or another space’s, or of one that is not there — and merges nothing', async () => {
      const keep = await makeCluster(ws, { itemCount: 2 });
      const fine = await makeCluster(ws, { itemCount: 1 });
      const otherAgent = (
        await owner.aiAgent.create({
          data: { licenseId: ws.licenseId, name: 'İkinci', kind: 'ai_agent', active: true },
          select: { id: true },
        })
      ).id;
      const strangerAgent = await makeCluster(ws, { aiAgentId: otherAgent });
      const strangerSpace = await makeCluster(ws, { space: 'test:another-space' });
      const theirs = await makeCluster(other);

      expect((await cluster(keep, 'merge', { source_ids: [keep] })).statusCode).toBe(400);
      expect((await cluster(keep, 'merge', { source_ids: [fine, strangerAgent] })).statusCode).toBe(
        400,
      );
      expect((await cluster(keep, 'merge', { source_ids: [fine, strangerSpace] })).statusCode).toBe(
        400,
      );
      expect((await cluster(keep, 'merge', { source_ids: [fine, theirs] })).statusCode).toBe(404);
      expect(
        (
          await cluster(keep, 'merge', {
            source_ids: [fine, '00000000-0000-4000-8000-000000000000'],
          })
        ).statusCode,
      ).toBe(404);
      expect((await cluster(keep, 'merge', { source_ids: [] })).statusCode).toBe(400);
      expect((await cluster(keep, 'merge', {})).statusCode).toBe(400);
      expect(await owner.aiUnresolvedCluster.count({ where: { licenseId: ws.licenseId } })).toBe(4);
      expect(
        (await owner.aiUnresolvedCluster.findUniqueOrThrow({ where: { id: keep } })).itemCount,
      ).toBe(2);
    });

    it('proposes a knowledge snippet from the title and the newest distinct questions, and writes nothing', async () => {
      const id = await makeCluster(ws, { label: 'Papara ile yatırma görünmüyor' });
      await addItem(ws, id, 'Papara yatırdım gözükmüyor', { at: new Date(Date.now() - 3 * HOUR) });
      await addItem(ws, id, 'papara yatırdım gözükmüyor', { at: new Date(Date.now() - 2 * HOUR) });
      await addItem(ws, id, 'param Papara ile gelmedi', { at: new Date(Date.now() - HOUR) });
      const sources = await owner.knowledgeSource.count({ where: { licenseId: ws.licenseId } });

      const response = await cluster(id, 'suggest-knowledge');
      expect(response.statusCode, response.body).toBe(200);
      expect(response.json()).toEqual({
        cluster_id: id,
        ai_agent_id: ws.aiAgentId,
        target: 'knowledge_snippet',
        title: 'Papara ile yatırma görünmüyor',
        questions: ['param Papara ile gelmedi', 'papara yatırdım gözükmüyor'],
        body: '- param Papara ile gelmedi\n- papara yatırdım gözükmüyor',
      });
      expect(await owner.knowledgeSource.count({ where: { licenseId: ws.licenseId } })).toBe(
        sources,
      );
    });
  });

  describe('add examples (AI-03)', () => {
    let id: string;

    beforeEach(async () => {
      id = await makeCluster(ws);
    });

    const add = (skillId: string, sentences: string[], t = token) =>
      cluster(id, 'add-examples', { skill_id: skillId, sentences }, t);

    it('adds the sentences to the procedure’s draft, skips what it already has, and embeds them', async () => {
      const skillId = await makeSkill(ws);
      const before = (await owner.skill.findUniqueOrThrow({ where: { id: skillId } })).updatedAt;

      const response = await add(skillId, [
        'Papara ile yatırdım gözükmüyor',
        '  Paramı Papara ile yolladım  ama hesabıma geçmedi ',
        'Paramı papara ile yolladım ama hesabıma geçmedi',
      ]);
      expect(response.statusCode, response.body).toBe(200);
      expect(response.json()).toEqual({
        skill_id: skillId,
        added: ['Paramı Papara ile yolladım ama hesabıma geçmedi'],
        skipped: 2,
        examples_count: 2,
      });
      const skill = await owner.skill.findUniqueOrThrow({ where: { id: skillId } });
      expect(skill.examples).toEqual([
        'Papara ile yatırdım gözükmüyor',
        'Paramı Papara ile yolladım ama hesabıma geçmedi',
      ]);
      expect(skill.updatedAt.getTime()).toBeGreaterThan(before.getTime());
      expect(await owner.aiProcedureExample.count({ where: { skillId } })).toBe(2);

      // Nothing new: nothing written.
      const again = await add(skillId, ['Papara ile yatırdım gözükmüyor']);
      expect(again.json()).toMatchObject({ added: [], skipped: 1, examples_count: 2 });
    });

    it('masks what the sentences carry (AI-26)', async () => {
      const skillId = await makeSkill(ws, { examples: [] });
      const response = await add(skillId, ['Kartım 4111 1111 1111 1111 ile yatırdım gözükmüyor']);
      expect(response.statusCode, response.body).toBe(200);
      const [stored] = (await owner.skill.findUniqueOrThrow({ where: { id: skillId } })).examples;
      expect(stored).toBeDefined();
      expect(stored).not.toContain('4111 1111 1111 1111');
    });

    it('refuses sentences that would take a procedure past its limit, adding none', async () => {
      const full = Array.from(
        { length: PROCEDURE_EXAMPLES_MAX - 1 },
        (_, i) => `örnek cümle ${i} metni`,
      );
      const skillId = await makeSkill(ws, { examples: full });
      const response = await add(skillId, ['birinci yeni cümle', 'ikinci yeni cümle']);
      expect(response.statusCode).toBe(400);
      expect((await owner.skill.findUniqueOrThrow({ where: { id: skillId } })).examples).toEqual(
        full,
      );
      expect((await add(skillId, ['tek yeni cümle'])).statusCode).toBe(200);
    });

    it('refuses a locked template copy, another agent’s procedure and a bad body', async () => {
      const locked = await makeSkill(ws, { locked: true });
      const otherAgent = (
        await owner.aiAgent.create({
          data: { licenseId: ws.licenseId, name: 'İkinci', kind: 'ai_agent', active: true },
          select: { id: true },
        })
      ).id;
      const elsewhere = await makeSkill(ws, { aiAgentId: otherAgent });
      const theirs = await makeSkill(other);
      const ok = await makeSkill(ws);

      const refused = await add(locked, ['yeni bir cümle']);
      expect(refused.statusCode).toBe(409);
      expect((refused.json() as { error: { type: string } }).error.type).toBe('template_locked');
      expect((await add(elsewhere, ['yeni bir cümle'])).statusCode).toBe(404);
      expect((await add(theirs, ['yeni bir cümle'])).statusCode).toBe(404);
      expect((await add(ok, [])).statusCode).toBe(400);
      expect((await add(ok, ['x'.repeat(301)])).statusCode).toBe(400);
      expect(
        (
          await add(
            ok,
            Array.from({ length: 11 }, (_, i) => `cümle numara ${i}`),
          )
        ).statusCode,
      ).toBe(400);
      expect((await add('not-a-uuid', ['bir cümle'])).statusCode).toBe(400);
      expect((await owner.skill.findUniqueOrThrow({ where: { id: locked } })).examples).toEqual([
        'Papara ile yatırdım gözükmüyor',
      ]);
    });
  });

  describe('the surge threshold', () => {
    it('is the default until set; the set value is the one the alarm reads; it is bounded', async () => {
      const read = await server.get('/ai/unresolved/settings', auth());
      expect(read.json()).toEqual({
        spike_threshold: UNRESOLVED_SPIKE_THRESHOLD_DEFAULT,
        default_threshold: UNRESOLVED_SPIKE_THRESHOLD_DEFAULT,
        window_minutes: 60,
        min_threshold: 5,
        max_threshold: 1000,
      });

      const put = await server.put('/ai/unresolved/settings', { spike_threshold: 35 }, auth());
      expect(put.statusCode, put.body).toBe(200);
      expect((put.json() as { spike_threshold: number }).spike_threshold).toBe(35);
      expect((await list()).spike_threshold).toBe(35);
      expect(
        await withTenant(
          owner,
          { licenseId: ws.licenseId, organizationId: ws.organizationId },
          (tx) => readUnresolvedSpikeThreshold(tx),
        ),
      ).toBe(35);
      // Again: an update, not a second row.
      expect(
        (await server.put('/ai/unresolved/settings', { spike_threshold: 50 }, auth())).statusCode,
      ).toBe(200);
      expect(await owner.aiUnresolvedSettings.count({ where: { licenseId: ws.licenseId } })).toBe(
        1,
      );

      for (const bad of [4, 1001, 20.5, '20', null]) {
        expect(
          (await server.put('/ai/unresolved/settings', { spike_threshold: bad }, auth()))
            .statusCode,
          String(bad),
        ).toBe(400);
      }
      expect((await server.put('/ai/unresolved/settings', {}, auth())).statusCode).toBe(400);
      // The other workspace's is its own.
      const theirs = await tokenFor(other, ['agents-bot--all:rw']);
      expect((await server.get('/ai/unresolved/settings', auth(theirs))).json()).toMatchObject({
        spike_threshold: UNRESOLVED_SPIKE_THRESHOLD_DEFAULT,
      });
    });
  });

  describe('who', () => {
    it('lets `:ro` read and not act, and a team member do neither (AI-22 "Ekip Üyesi: yok")', async () => {
      const id = await makeCluster(ws, { itemCount: 1, count7d: 1 });
      const skillId = await makeSkill(ws);
      const reader = await tokenFor(ws, ['agents-bot--all:ro'], 'pat');
      const member = await tokenFor(ws, [...DEFAULT_AGENT_SCOPES]);

      expect((await list('', reader)).clusters).toHaveLength(1);
      expect((await server.get(`/ai/unresolved/clusters/${id}`, auth(reader))).statusCode).toBe(
        200,
      );
      expect((await server.get('/ai/unresolved/settings', auth(reader))).statusCode).toBe(200);
      for (const action of ['ignore', 'reopen', 'resolve', 'suggest-knowledge']) {
        expect((await cluster(id, action, {}, reader)).statusCode, action).toBe(403);
      }
      expect((await cluster(id, 'merge', { source_ids: [id] }, reader)).statusCode).toBe(403);
      expect(
        (await cluster(id, 'add-examples', { skill_id: skillId, sentences: ['bir cümle'] }, reader))
          .statusCode,
      ).toBe(403);
      expect(
        (await server.put('/ai/unresolved/settings', { spike_threshold: 30 }, auth(reader)))
          .statusCode,
      ).toBe(403);

      for (const path of [
        `/ai/unresolved/clusters?ai_agent_id=${ws.aiAgentId}`,
        `/ai/unresolved/clusters/${id}`,
        '/ai/unresolved/settings',
      ]) {
        expect((await server.get(path, auth(member))).statusCode, path).toBe(403);
      }
      expect((await server.get('/ai/unresolved/settings')).statusCode).toBe(401);
      expect((await owner.aiUnresolvedCluster.findUniqueOrThrow({ where: { id } })).status).toBe(
        'open',
      );
    });
  });
});
