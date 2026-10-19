/**
 * `ai_procedure_examples` and the catalogue narrowing on the database (tm 297.3
 * · SiyahTuş analysis AI-05 §2): the table's guards, what a skill save writes
 * there, how `ProcedureExamples.rank` measures nearness — exactly and through
 * the hnsw index — and a visitor's message answered from a narrowed catalogue.
 *
 * Which entries a ranking keeps is `prefilter.test.ts`'s; the fixture's
 * numbers are `ai-intents-fixture.test.ts`'s.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { embed, LEXICAL_EMBEDDING_SPACE, toVectorLiteral } from '@siyahtus/ai-mock';
import { splitSkillProcedure, validateProcedure, type Procedure } from '@siyahtus/types';
import { withTenant, type TenantContext } from '../../src/lib/tenant.js';
import { ProcedureExamples } from '../../src/services/ai/procedure-examples.js';
import { fakeOpenAiFetch, openAiProblem } from '../helpers/fake-openai.js';
import { grantToken, ownerClient, seedFixtures, type Fixtures } from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

const APP_URL = process.env['DATABASE_APP_URL'];

interface Topic {
  key: string;
  name: string;
  when_to_use: string;
  examples: string[];
}
const TOPICS = (
  JSON.parse(
    readFileSync(fileURLToPath(new URL('../fixtures/ai-intents-tr.json', import.meta.url)), 'utf8'),
  ) as { topics: Topic[] }
).topics;

/** A one-turn procedure for a fixture topic: it says its name and resolves. */
function topicProcedure(topic: Topic, examples = topic.examples): Procedure {
  const result = validateProcedure({
    when_to_use: topic.when_to_use,
    examples,
    steps: [
      { id: 'bilgi', type: 'say', template_key: 'bilgi' },
      { id: 'bitti', type: 'resolve', outcome: 'resolved' },
    ],
    templates: [{ key: 'bilgi', text: `${topic.name}: talebiniz alındı.` }],
  });
  if (!result.ok) throw new Error(JSON.stringify(result.problems));
  return result.procedure;
}

describe('ai_procedure_examples and the catalogue narrowing (AI-05 §2 · tm 297.3)', () => {
  let owner: PrismaClient;
  let appRole: PrismaClient;
  let server: TestServer;
  /** A server whose embedding provider refuses every request. */
  let failing: TestServer;
  let fx: Fixtures;
  let aiAgentId: string;
  let headers: Record<string, string>;
  let tenant: TenantContext;

  beforeAll(async () => {
    if (!APP_URL) throw new Error('DATABASE_APP_URL must be set');
    owner = ownerClient();
    appRole = new PrismaClient({ datasourceUrl: APP_URL });
    server = await startTestServer();
    failing = await startTestServer(
      {
        LOG_LEVEL: 'silent',
        EMBEDDING_PROVIDER: 'openai',
        EMBEDDING_API_BASE_URL: 'https://eu.api.openai.com/v1',
        EMBEDDING_MODEL: 'text-embedding-3-small',
        EMBEDDING_API_KEY: 'sk-test-only-embedding-label',
      },
      { embeddingFetch: fakeOpenAiFetch(openAiProblem(400, 'invalid_request_error')).impl },
    );
  });

  afterAll(async () => {
    await Promise.all([server.close(), failing.close()]);
    await Promise.all([owner.$disconnect(), appRole.$disconnect()]);
  });

  beforeEach(async () => {
    fx = await seedFixtures(owner);
    await clearRateLimits(server.app);
    await clearRateLimits(failing.app);
    tenant = { licenseId: fx.a.licenseId, organizationId: fx.a.organizationId };
    const support = await owner.group.create({
      data: { licenseId: fx.a.licenseId, name: 'Support' },
      select: { id: true },
    });
    await owner.routingRule.create({
      data: {
        licenseId: fx.a.licenseId,
        kind: 'chat',
        isFallback: true,
        targetGroupId: support.id,
        priority: 100,
      },
    });
    aiAgentId = (
      await owner.aiAgent.create({
        data: { licenseId: fx.a.licenseId, name: 'Ada', kind: 'ai_agent', active: true },
        select: { id: true },
      })
    ).id;
    const token = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['agents-bot--all:rw', 'chats--all:rw'],
    });
    headers = { authorization: `Bearer ${token}` };
  });

  /** `POST /skills` a fixture topic as a procedure; its id. */
  async function create(topic: Topic, on: TestServer = server): Promise<string> {
    const response = await on.post(
      '/skills',
      {
        name: topic.name,
        ai_agent_id: aiAgentId,
        mode: 'procedure',
        ...splitSkillProcedure(topicProcedure(topic)),
      },
      headers,
    );
    expect(response.statusCode, response.body).toBe(201);
    return (response.json() as { id: string }).id;
  }

  async function rows(skillId: string): Promise<Array<{ text: string; space: string }>> {
    return owner.$queryRaw<Array<{ text: string; space: string }>>`
      SELECT text, embedding_space AS space FROM ai_procedure_examples
      WHERE skill_id = ${skillId}::uuid ORDER BY text`;
  }

  const sorted = (texts: string[]) => [...texts].sort();

  describe('the table', () => {
    it('is under RLS with the tenant policy; its hnsw index is built and valid; the runtime may not edit a row', async () => {
      const [table] = await owner.$queryRaw<Array<{ rls: boolean; policies: number }>>`
        SELECT c.relrowsecurity AS rls,
               (SELECT count(*)::int FROM pg_policies p WHERE p.tablename = 'ai_procedure_examples') AS policies
        FROM pg_class c WHERE c.relname = 'ai_procedure_examples'`;
      expect(table).toEqual({ rls: true, policies: 1 });
      const [index] = await owner.$queryRaw<Array<{ method: string; valid: boolean }>>`
        SELECT am.amname AS method, i.indisvalid AS valid
        FROM pg_index i
        JOIN pg_class c ON c.oid = i.indexrelid
        JOIN pg_am am ON am.oid = c.relam
        WHERE c.relname = 'idx_procedure_examples_embedding_hnsw'`;
      expect(index).toEqual({ method: 'hnsw', valid: true });
      const [grants] = await owner.$queryRaw<
        Array<{ select: boolean; insert: boolean; delete: boolean; update: boolean }>
      >`
        SELECT has_table_privilege('siyahtus_app', 'ai_procedure_examples', 'SELECT') AS select,
               has_table_privilege('siyahtus_app', 'ai_procedure_examples', 'INSERT') AS insert,
               has_table_privilege('siyahtus_app', 'ai_procedure_examples', 'DELETE') AS delete,
               has_table_privilege('siyahtus_app', 'ai_procedure_examples', 'UPDATE') AS update`;
      expect(grants).toEqual({ select: true, insert: true, delete: true, update: false });
    });

    it('a workspace cannot write examples for another workspace’s skill, nor see another’s rows', async () => {
      const mine = await create(TOPICS[0]!);
      const theirs = await owner.skill.create({
        data: {
          licenseId: fx.b.licenseId,
          name: 'Başka',
          kind: 'ai_agent',
          updatedAt: new Date(),
        },
        select: { id: true },
      });
      const vector = toVectorLiteral(embed('para yatırdım'));
      await expect(
        withTenant(
          appRole,
          tenant,
          (tx) =>
            tx.$executeRaw`
            INSERT INTO ai_procedure_examples (id, license_id, skill_id, text, embedding, embedding_space)
            VALUES (gen_random_uuid(), ${fx.a.licenseId}, ${theirs.id}::uuid, 'x', ${vector}::vector, 'mock:lexical-v1')`,
        ),
      ).rejects.toThrow(/not this workspace/);
      const seen = await withTenant(
        appRole,
        { licenseId: fx.b.licenseId, organizationId: fx.b.organizationId },
        (tx) => tx.aiProcedureExample.count({ where: { skillId: mine } }),
      );
      expect(seen).toBe(0);
      expect(await rows(mine)).toHaveLength(TOPICS[0]!.examples.length);
    });
  });

  describe('what a save writes', () => {
    it('POST: one row per example, each in the provider’s space', async () => {
      const id = await create(TOPICS[0]!);
      expect(await rows(id)).toEqual(
        sorted(TOPICS[0]!.examples).map((text) => ({ text, space: LEXICAL_EMBEDDING_SPACE })),
      );
    });

    it('PATCH: new examples replace the rows, a rename keeps them, single clears them, DELETE takes them', async () => {
      const id = await create(TOPICS[1]!);
      const before = await owner.aiProcedureExample.findMany({
        where: { skillId: id },
        select: { id: true },
      });

      let response = await server.patch(`/skills/${id}`, { name: 'Çekim beklemede' }, headers);
      expect(response.statusCode, response.body).toBe(200);
      const kept = await owner.aiProcedureExample.findMany({
        where: { skillId: id },
        select: { id: true },
      });
      expect(sorted(kept.map((row) => row.id))).toEqual(sorted(before.map((row) => row.id)));

      response = await server.patch(
        `/skills/${id}`,
        { examples: ['çekimim gelmedi', 'para çekemedim'] },
        headers,
      );
      expect(response.statusCode, response.body).toBe(200);
      expect((await rows(id)).map((row) => row.text)).toEqual([
        'para çekemedim',
        'çekimim gelmedi',
      ]);

      response = await server.patch(
        `/skills/${id}`,
        { mode: 'single', steps: [{ type: 'send_message', source: 'text', text: 'Merhaba' }] },
        headers,
      );
      expect(response.statusCode, response.body).toBe(200);
      expect(await rows(id)).toEqual([]);

      const other = await create(TOPICS[2]!);
      expect((await server.del(`/skills/${other}`, headers)).statusCode).toBe(204);
      expect(await owner.aiProcedureExample.count({ where: { skillId: other } })).toBe(0);
    });

    it('a save the embedding cannot take still saves, without rows; the next save writes them', async () => {
      const id = await create(TOPICS[3]!, failing);
      expect(await owner.skill.count({ where: { id } })).toBe(1);
      expect(await rows(id)).toEqual([]);

      const response = await server.patch(`/skills/${id}`, { active: true }, headers);
      expect(response.statusCode, response.body).toBe(200);
      expect(await rows(id)).toHaveLength(TOPICS[3]!.examples.length);
    });
  });

  describe('ProcedureExamples.rank', () => {
    async function rank(
      text: string,
      skillIds: string[],
      examples = new ProcedureExamples(),
      space = LEXICAL_EMBEDDING_SPACE,
    ) {
      return withTenant(appRole, tenant, (tx) =>
        examples.rank(tx, tenant, { space, vector: toVectorLiteral(embed(text)) }, skillIds),
      );
    }

    it('exact: each procedure by its nearest example, nearest first; another space is not in scope', async () => {
      const ids = await Promise.all(TOPICS.slice(0, 4).map((topic) => create(topic)));
      const result = await rank('çekim talebim hala beklemede', ids);
      expect(result.strategy).toBe('exact');
      expect(result.examplesInScope).toBe(
        TOPICS.slice(0, 4).reduce((sum, topic) => sum + topic.examples.length, 0),
      );
      expect(result.ranked[0]).toEqual({ skillId: ids[1], similarity: expect.closeTo(1, 4) });
      expect(result.ranked.map((item) => item.skillId).sort()).toEqual([...ids].sort());
      for (let i = 1; i < result.ranked.length; i += 1) {
        expect(result.ranked[i - 1]!.similarity).toBeGreaterThanOrEqual(
          result.ranked[i]!.similarity,
        );
      }

      expect(
        (await rank('çekim talebim hala beklemede', ids, undefined, 'other:space')).ranked,
      ).toEqual([]);
      // Only the ids asked about.
      expect((await rank('çekim talebim hala beklemede', [ids[0]!])).ranked).toHaveLength(1);
    });

    it('approximate, above the ceiling: the hnsw walk finds the same nearest procedure', async () => {
      const ids = await Promise.all(TOPICS.slice(0, 4).map((topic) => create(topic)));
      const exact = await rank('bonusum yüklenmedi', ids);
      const walked = await rank(
        'bonusum yüklenmedi',
        ids,
        new ProcedureExamples({ exactSearchCeiling: 0 }),
      );
      expect(walked.strategy).toBe('approximate');
      expect(walked.ranked[0]!.skillId).toBe(ids[3]);
      expect(walked.ranked.map((item) => item.skillId)).toEqual(
        exact.ranked.map((item) => item.skillId),
      );
    });
  });

  it('a visitor’s message with 20 procedures: the call is offered 10, the right one answers, the record says so (AI-05 acceptance)', async () => {
    const ids = new Map<string, string>();
    for (const topic of TOPICS) {
      const id = await create(topic);
      const response = await server.patch(`/skills/${id}`, { active: true }, headers);
      expect(response.statusCode, response.body).toBe(200);
      ids.set(topic.key, id);
    }

    const visitor = await server.post(
      '/customer/token',
      { organization_id: fx.a.organizationId },
      { origin: `https://${fx.a.trustedDomain}` },
    );
    const auth = { authorization: `Bearer ${(visitor.json() as { token: string }).token}` };
    const response = await server.post(
      '/customer/chat/events',
      { text: 'havale attım gözükmüyor' },
      auth,
    );
    expect(response.statusCode).toBe(201);
    const { chat_id: chatId } = response.json() as { chat_id: string };

    const written = await owner.event.findMany({
      where: { chatId, authorType: 'bot' },
      select: { text: true },
    });
    expect(written.map((event) => event.text)).toEqual([
      'Yatırım hesaba geçmedi: talebiniz alındı.\nSorununuz çözüldü mü?',
    ]);
    const decision = await owner.aiDecisionLog.findFirstOrThrow({
      where: { chatId },
      select: { procedureId: true, details: true },
    });
    expect(decision.procedureId).toBe(ids.get('deposit_not_credited'));
    expect(decision.details).toMatchObject({
      understood: {
        procedure_key: ids.get('deposit_not_credited'),
        prefilter: { procedures: 20, offered: 10, unranked: 0, strategy: 'exact' },
      },
    });
  });
});
