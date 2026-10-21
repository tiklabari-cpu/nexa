/**
 * Writing the structured knowledge tables and indexing their rows (tm 310.2 ·
 * SiyahTuş analysis AI-13; ADR-14b §2.12).
 *
 *   - **The writer.** `/knowledge-tables/{table}` adds, lists, edits, deletes
 *     and reviews rows; a refused row names every problem as
 *     `{ field, code }`, the validators' and what only the database knows (a
 *     stranger's brand, owner or payment method; a name taken in an
 *     overlapping brand scope; a full table). An integration's row is not
 *     edited by hand. Another workspace's row is not there.
 *   - **CSV (AI-13 §8).** A file is refused whole only for what no row can be
 *     blamed for; otherwise the valid rows are taken and the others skipped
 *     with their problems, line by line. An export imports back.
 *   - **The row in the knowledge store (AI-13 coding logic 3).** Every row is
 *     one `table_row` source holding `renderRowText`, with the row's brands —
 *     so retrieval finds it, for its brands only — indexed again when the row
 *     changes and gone with it. A row whose text cannot be embedded is saved
 *     anyway and its source answers nothing until the sweep indexes it. The
 *     source is the row's: `/knowledge-sources` neither lists nor edits it.
 */
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  KNOWLEDGE_TABLE_ROWS_MAX,
  renderRowText,
  type KnowledgeReader,
  type KnowledgeTableProblem,
  type PaymentMethodFields,
} from '@siyahtus/types';
import { withTenant, type TenantContext } from '../../src/lib/tenant.js';
import { resolveEmbeddingInferenceProvider } from '../../src/services/ai/inference.js';
import { KnowledgeService } from '../../src/services/ai/knowledge-service.js';
import { EmbeddingProviderError } from '../../src/services/ai/provider/embedding-error.js';
import { KnowledgeTableRowKnowledgeSweeper } from '../../src/services/knowledge-tables/row-knowledge.js';
import { FakeEmbeddingProvider } from '../helpers/fake-embedding-provider.js';
import {
  grantToken,
  ownerClient,
  seedDefaultBrand,
  seedFixtures,
  testEnv,
  type Fixtures,
} from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

const APP_URL = process.env['DATABASE_APP_URL'];

const PAPARA = {
  name: 'Papara',
  aliases: ['PPR'],
  direction: 'deposit',
  currency: 'TRY',
  min_amount: 100,
  max_amount: 50_000,
  expected_minutes: 30,
  delay_threshold_minutes: 60,
};
/**
 * Retrieval's question, in the row text's words: the lexical stub scores the
 * player's own wording ("Papara ile en az ne kadar yatırabilirim?") 0.19 against
 * the whole row, under the 0.25 threshold — that question is answered from the
 * row itself (the exact-answer path, tm 310.3), not from a passage.
 */
const ASK_PAPARA_MIN = 'Papara yatırım en az tutar ne kadar?';

interface RowView {
  id: string;
  brand_ids: string[];
  owner_id: string | null;
  reviewed_at: string;
  review_interval_days: number;
  review_due_at: string;
  stale: boolean;
  source: string;
  created_by: string | null;
  updated_by: string | null;
  updated_at: string;
  [field: string]: unknown;
}

interface ImportView {
  imported: number;
  failed: number;
  dry_run: boolean;
  results: Array<{
    line: number;
    status: 'imported' | 'skipped';
    id: string | null;
    label: string | null;
    problems: KnowledgeTableProblem[];
  }>;
}

const DAY_MS = 86_400_000;

describe('structured knowledge tables — writer, CSV, row sources (AI-13 · tm 310.2)', () => {
  let owner: PrismaClient;
  let app: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;
  let tenant: TenantContext;
  let writeA: string;
  let readA: string;
  let writeB: string;
  let aiAgentA: string;
  let brandA: string;
  let brandB: string;
  const embeddings = new FakeEmbeddingProvider();
  const exact = new KnowledgeService({ embeddings, exactSearchCeiling: 1_000_000 });

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });
  const token = (t: Fixtures['a'], scopes: string[]) =>
    grantToken(owner, {
      licenseId: t.licenseId,
      organizationId: t.organizationId,
      ownerId: t.ownerAccountId,
      scopes,
    });

  beforeAll(async () => {
    if (!APP_URL) throw new Error('DATABASE_APP_URL must be set');
    owner = ownerClient();
    app = new PrismaClient({ datasourceUrl: APP_URL });
    server = await startTestServer({}, { embeddings });
  });

  afterAll(async () => {
    await server.close();
    await Promise.all([owner.$disconnect(), app.$disconnect()]);
  });

  beforeEach(async () => {
    fx = await seedFixtures(owner);
    await clearRateLimits(server.app);
    embeddings.failWith(undefined);
    tenant = { licenseId: fx.a.licenseId, organizationId: fx.a.organizationId };
    writeA = await token(fx.a, ['agents-bot--all:rw']);
    readA = await token(fx.a, ['agents-bot--all:ro']);
    writeB = await token(fx.b, ['agents-bot--all:rw']);
    aiAgentA = (
      await owner.aiAgent.create({
        data: { licenseId: fx.a.licenseId, kind: 'ai_agent', name: 'Ada', active: true },
        select: { id: true },
      })
    ).id;
    brandA = await seedDefaultBrand(owner, fx.a.licenseId);
    brandB = (
      await owner.brand.create({
        data: { licenseId: fx.a.licenseId, name: 'Second', slug: 'second' },
        select: { id: true },
      })
    ).id;
  });

  const add = async (table: string, body: Record<string, unknown>, as = writeA) => {
    const response = await server.post(`/knowledge-tables/${table}`, body, auth(as));
    expect(response.statusCode, response.body).toBe(201);
    return response.json() as RowView;
  };

  const refused = async (
    response: Awaited<ReturnType<TestServer['post']>>,
  ): Promise<KnowledgeTableProblem[]> => {
    expect(response.statusCode, response.body).toBe(400);
    const body = response.json() as {
      error: { type: string; details: { reason: string; problems: KnowledgeTableProblem[] } };
    };
    expect(body.error.type).toBe('validation');
    expect(body.error.details.reason).toBe('knowledge_table_row_invalid');
    return body.error.details.problems;
  };

  const list = async (table: string, query = '', as = writeA) => {
    const response = await server.get(`/knowledge-tables/${table}${query}`, auth(as));
    expect(response.statusCode, response.body).toBe(200);
    return (response.json() as { items: RowView[] }).items;
  };

  const sourceOf = (sqlTable: string, rowId: string) =>
    owner.knowledgeSource.findFirst({
      where: { sourceTable: sqlTable, sourceRowId: rowId },
      include: { _count: { select: { chunks: true } } },
    });

  async function found(question: string, reader: KnowledgeReader): Promise<string[]> {
    const asked = await exact.embedQuery(question);
    const { chunks } = await withTenant(app, tenant, (tx) =>
      exact.search(tx, tenant, asked, { reader, limit: 500 }),
    );
    return chunks.map((chunk) => chunk.text);
  }

  const player = (brandId: string | null = null): KnowledgeReader => ({
    audience: 'ai_agent',
    aiAgentId: aiAgentA,
    brandId,
  });

  const sweep = () =>
    new KnowledgeTableRowKnowledgeSweeper(app, {
      knowledge: exact,
      embeddingInference: resolveEmbeddingInferenceProvider(testEnv()),
    }).run();

  // ==========================================================================

  describe('the writer', () => {
    it('adds, lists, edits, reviews and deletes a row, stamping who and when', async () => {
      const created = await add('payment-methods', PAPARA);
      expect(created).toMatchObject({
        ...PAPARA,
        brand_ids: [],
        owner_id: null,
        review_interval_days: 14,
        stale: false,
        source: 'manual',
        created_by: fx.a.ownerAccountId,
        updated_by: fx.a.ownerAccountId,
        // Column defaults for what the body left out.
        working_hours: null,
        reference_format: 'none',
        networks: [],
        common_errors: [],
        active: true,
      });
      expect(Date.parse(created.review_due_at) - Date.parse(created.reviewed_at)).toBe(14 * DAY_MS);
      expect((await list('payment-methods')).map((row) => row.id)).toEqual([created.id]);

      // An edit names one field; the merged row is validated whole.
      const edited = await server.patch(
        `/knowledge-tables/payment-methods/${created.id}`,
        { min_amount: 200, customer_notes: '  ' },
        auth(writeA),
      );
      expect(edited.statusCode, edited.body).toBe(200);
      expect(edited.json()).toMatchObject({
        min_amount: 200,
        max_amount: 50_000,
        // A blank optional text is "not given": stored as null.
        customer_notes: null,
        reviewed_at: created.reviewed_at,
      });
      expect(
        await refused(
          await server.patch(
            `/knowledge-tables/payment-methods/${created.id}`,
            { min_amount: 60_000 },
            auth(writeA),
          ),
        ),
      ).toEqual([{ field: 'min_amount', code: 'min_above_max' }]);

      // "Gözden geçirdim": due again 14 days from now.
      await owner.kbPaymentMethod.update({
        where: { id: created.id },
        data: { reviewedAt: new Date(Date.now() - 30 * DAY_MS) },
      });
      expect((await list('payment-methods', '?stale=true')).map((row) => row.id)).toEqual([
        created.id,
      ]);
      expect(await list('payment-methods', '?stale=false')).toEqual([]);
      const reviewed = await server.post(
        `/knowledge-tables/payment-methods/${created.id}/review`,
        undefined,
        auth(writeA),
      );
      expect(reviewed.statusCode, reviewed.body).toBe(200);
      expect(reviewed.json()).toMatchObject({ stale: false, min_amount: 200 });
      expect(Date.now() - Date.parse((reviewed.json() as RowView).reviewed_at)).toBeLessThan(
        60_000,
      );

      const gone = await server.del(
        `/knowledge-tables/payment-methods/${created.id}`,
        auth(writeA),
      );
      expect(gone.statusCode).toBe(204);
      expect(await list('payment-methods')).toEqual([]);
      for (const response of [
        await server.del(`/knowledge-tables/payment-methods/${created.id}`, auth(writeA)),
        await server.patch(
          `/knowledge-tables/payment-methods/${created.id}`,
          { min_amount: 1 },
          auth(writeA),
        ),
        await server.post(
          `/knowledge-tables/payment-methods/${created.id}/review`,
          undefined,
          auth(writeA),
        ),
      ]) {
        expect(response.statusCode).toBe(404);
      }
      const audit = await owner.auditLogEntry.findFirst({
        where: { licenseId: fx.a.licenseId, target: `knowledge_table_row:${created.id}` },
      });
      expect(audit?.action).toBe('data.deleted');
    });

    it('writes all four tables, each with its own defaults', async () => {
      const bonus = await add('bonuses', {
        name: 'Hoş geldin',
        type: 'welcome',
        wagering_multiplier: 10,
        wagering_base: 'bonus',
        active_to: '2026-12-31T21:00:00Z',
      });
      expect(bonus).toMatchObject({
        claim_method: 'auto',
        review_interval_days: 30,
        active_to: '2026-12-31T21:00:00.000Z',
      });
      const kyc = await add('kyc-documents', {
        doc_type: 'Kimlik kartı',
        acceptance_criteria: ['Ön ve arka yüz', 'Okunaklı'],
      });
      expect(kyc).toMatchObject({ chat_upload_allowed: false, review_interval_days: 90 });
      const rule = await add('rules', {
        key: 'daily_withdrawal_limit',
        title: 'Günlük çekim limiti',
        numeric_value: 25_000.5,
        unit: 'TRY',
      });
      expect(rule).toMatchObject({ category: 'other', numeric_value: 25_000.5, value_text: null });
      for (const table of ['bonuses', 'kyc-documents', 'rules']) {
        expect(await list(table)).toHaveLength(1);
      }
    });

    it('refuses a row with every problem at once — the validators and what only the database knows', async () => {
      const strangerBrand = (
        await owner.brand.create({
          data: { licenseId: fx.b.licenseId, name: 'Theirs', slug: 'theirs' },
          select: { id: true },
        })
      ).id;
      const problems = await refused(
        await server.post(
          '/knowledge-tables/payment-methods',
          {
            name: 'Havale',
            min_amount: 500,
            max_amount: 100,
            expected_minutes: 60,
            delay_threshold_minutes: 30,
            brand_ids: [brandA, strangerBrand],
            owner_id: fx.b.ownerAccountId,
            colour: 'blue',
          },
          auth(writeA),
        ),
      );
      expect(problems).toEqual(
        expect.arrayContaining([
          { field: 'direction', code: 'required' },
          { field: 'min_amount', code: 'min_above_max' },
          { field: 'delay_threshold_minutes', code: 'delay_below_expected' },
          { field: 'brand_ids[1]', code: 'invalid' },
          { field: 'owner_id', code: 'invalid' },
          { field: 'colour', code: 'invalid' },
        ]),
      );
      expect(problems).toHaveLength(6);
      // A bonus may exclude only this workspace's payment methods.
      const theirMethod = await owner.kbPaymentMethod.create({
        data: { licenseId: fx.b.licenseId, name: 'X', direction: 'deposit' },
        select: { id: true },
      });
      expect(
        await refused(
          await server.post(
            '/knowledge-tables/bonuses',
            { name: 'Kayıp', excluded_method_ids: [theirMethod.id] },
            auth(writeA),
          ),
        ),
      ).toEqual([{ field: 'excluded_method_ids[0]', code: 'invalid' }]);
      expect(await list('payment-methods')).toEqual([]);
      expect(await list('bonuses')).toEqual([]);
    });

    it('keeps a name unique within a direction and an overlapping brand scope; a brand row beside the every-brand row is its override', async () => {
      await add('payment-methods', PAPARA);
      const taken = (body: Record<string, unknown>) =>
        server
          .post('/knowledge-tables/payment-methods', { ...PAPARA, ...body }, auth(writeA))
          .then(refused);
      expect(await taken({})).toEqual([
        { field: 'name', code: 'taken' },
        { field: 'aliases[0]', code: 'taken' },
      ]);
      // Turkish case folding, and an alias against the other's name.
      expect(await taken({ name: 'Yeni', aliases: ['papara'] })).toEqual([
        { field: 'aliases[0]', code: 'taken' },
      ]);
      // The other direction, and a brand's own row, are not clashes.
      await add('payment-methods', { ...PAPARA, direction: 'withdrawal' });
      await add('payment-methods', { ...PAPARA, brand_ids: [brandA] });
      expect(await taken({ brand_ids: [brandA, brandB] })).toEqual([
        { field: 'name', code: 'taken' },
        { field: 'aliases[0]', code: 'taken' },
      ]);
      await add('payment-methods', { ...PAPARA, brand_ids: [brandB] });
      // An edit into a clash is refused the same way.
      const other = await add('payment-methods', { name: 'Havale', direction: 'deposit' });
      expect(
        await refused(
          await server.patch(
            `/knowledge-tables/payment-methods/${other.id}`,
            { aliases: ['PPR'] },
            auth(writeA),
          ),
        ),
      ).toEqual([{ field: 'aliases[0]', code: 'taken' }]);
      // Two writers racing one name: one wins.
      const race = await Promise.all(
        [0, 1].map(() =>
          server.post(
            '/knowledge-tables/rules',
            { key: 'min_age', title: 'Yaş sınırı', numeric_value: 18 },
            auth(writeA),
          ),
        ),
      );
      expect(race.map((r) => r.statusCode).sort()).toEqual([201, 400]);
    });

    it("leaves an integration's row to the integration — no edit by hand, a review still", async () => {
      const row = await owner.kbRule.create({
        data: {
          licenseId: fx.a.licenseId,
          key: 'max_bet',
          title: 'En yüksek bahis',
          numericValue: 1000,
          source: 'integration',
        },
        select: { id: true },
      });
      const edit = await server.patch(
        `/knowledge-tables/rules/${row.id}`,
        { numeric_value: 5 },
        auth(writeA),
      );
      expect(edit.statusCode).toBe(400);
      expect(edit.json()).toMatchObject({
        error: { details: { reason: 'knowledge_table_row_from_integration' } },
      });
      const reviewed = await server.post(
        `/knowledge-tables/rules/${row.id}/review`,
        undefined,
        auth(writeA),
      );
      expect(reviewed.statusCode).toBe(200);
      expect(reviewed.json()).toMatchObject({ source: 'integration', numeric_value: 1000 });
    });

    it('holds a table at its row ceiling', async () => {
      await owner.kbRule.createMany({
        data: Array.from({ length: KNOWLEDGE_TABLE_ROWS_MAX }, (_, i) => ({
          licenseId: fx.a.licenseId,
          key: `rule_${i}`,
          title: `Kural ${i}`,
          valueText: 'x',
        })),
      });
      expect(
        await refused(
          await server.post(
            '/knowledge-tables/rules',
            { key: 'one_more', title: 'Bir tane daha', value_text: 'x' },
            auth(writeA),
          ),
        ),
      ).toEqual([{ field: '', code: 'too_many' }]);
    });

    it("never shows or touches another workspace's rows, and reads with the read scope only (NFR-S4)", async () => {
      const row = await add('payment-methods', PAPARA);
      expect(await list('payment-methods', '', writeB)).toEqual([]);
      for (const response of [
        await server.patch(
          `/knowledge-tables/payment-methods/${row.id}`,
          { min_amount: 1 },
          auth(writeB),
        ),
        await server.del(`/knowledge-tables/payment-methods/${row.id}`, auth(writeB)),
        await server.post(
          `/knowledge-tables/payment-methods/${row.id}/review`,
          undefined,
          auth(writeB),
        ),
      ]) {
        expect(response.statusCode).toBe(404);
      }
      // B's own row of the same name is no clash with A's.
      await add('payment-methods', PAPARA, writeB);
      const exported = await server.get('/knowledge-tables/payment-methods/export', auth(writeB));
      expect(exported.body.split('\r\n').filter(Boolean)).toHaveLength(2);

      expect(await list('payment-methods', '', readA)).toHaveLength(1);
      expect(
        (await server.get('/knowledge-tables/payment-methods/export', auth(readA))).statusCode,
      ).toBe(200);
      for (const response of [
        await server.post('/knowledge-tables/payment-methods', PAPARA, auth(readA)),
        await server.del(`/knowledge-tables/payment-methods/${row.id}`, auth(readA)),
      ]) {
        expect(response.statusCode).toBe(403);
      }
      expect(
        (await server.get('/knowledge-tables/withdrawal-limits', auth(writeA))).statusCode,
      ).toBe(404);
    });

    it("lists for a brand what serves it — its own rows and the every-brand rows, never another brand's", async () => {
      const every = await add('payment-methods', PAPARA);
      const own = await add('payment-methods', { ...PAPARA, brand_ids: [brandA], min_amount: 50 });
      const ids = async (query: string) =>
        (await list('payment-methods', query)).map((row) => row.id).sort();
      expect(await ids('')).toEqual([every.id, own.id].sort());
      expect(await ids(`?brand_id=${brandA}`)).toEqual([every.id, own.id].sort());
      expect(await ids(`?brand_id=${brandB}`)).toEqual([every.id]);
    });
  });

  // ==========================================================================

  describe('CSV (AI-13 §8)', () => {
    const importCsv = async (table: string, csv: string, dryRun = false, as = writeA) => {
      const response = await server.post(
        `/knowledge-tables/${table}/import`,
        { csv, dry_run: dryRun },
        auth(as),
      );
      return response;
    };

    const FILE = [
      'name,direction,aliases,min_amount,max_amount,working_hours,active',
      'Papara,deposit,PPR|Papara TL,100,50000,,true',
      'Havale,deposit,,500,100,,true',
      'papara,deposit,,1,2,,true',
      'EFT,deposit,,1.5,abc,{not json},evet',
      'Kripto,deposit,USDT,10,,"{""timezone"":""Europe/Istanbul"",""windows"":[{""day"":""monday"",""start"":""09:00"",""end"":""17:00""}],""closed_on_bank_holidays"":true}",hayır',
    ].join('\r\n');

    it('takes the valid rows and skips the others with their problems, line by line', async () => {
      const response = await importCsv('payment-methods', FILE);
      expect(response.statusCode, response.body).toBe(200);
      const report = response.json() as ImportView;
      expect(report).toMatchObject({ imported: 2, failed: 3, dry_run: false });
      expect(report.results.map(({ line, status, label }) => ({ line, status, label }))).toEqual([
        { line: 1, status: 'imported', label: 'Papara' },
        { line: 2, status: 'skipped', label: 'Havale' },
        { line: 3, status: 'skipped', label: 'papara' },
        { line: 4, status: 'skipped', label: 'EFT' },
        { line: 5, status: 'imported', label: 'Kripto' },
      ]);
      expect(report.results[1]!.problems).toEqual([{ field: 'min_amount', code: 'min_above_max' }]);
      // Taken by the file's own first row.
      expect(report.results[2]!.problems).toEqual([{ field: 'name', code: 'taken' }]);
      expect(report.results[3]!.problems).toEqual(
        expect.arrayContaining([
          { field: 'working_hours', code: 'invalid' },
          { field: 'max_amount', code: 'invalid' },
        ]),
      );
      const rows = await list('payment-methods');
      expect(rows.map((row) => row['name'])).toEqual(['Papara', 'Kripto']);
      expect(rows[0]).toMatchObject({
        aliases: ['PPR', 'Papara TL'],
        min_amount: 100,
        active: true,
      });
      expect(rows[1]).toMatchObject({
        aliases: ['USDT'],
        active: false,
        working_hours: { timezone: 'Europe/Istanbul', closed_on_bank_holidays: true },
      });
      expect(report.results[0]!.id).toBe(rows[0]!.id);
      // Imported rows are in the knowledge store like any other.
      for (const row of rows) {
        expect(await sourceOf('kb_payment_methods', row.id)).toMatchObject({ status: 'ready' });
      }
    });

    it('previews a dry run and writes nothing', async () => {
      const response = await importCsv('payment-methods', FILE, true);
      expect(response.statusCode).toBe(200);
      const report = response.json() as ImportView;
      expect(report).toMatchObject({ imported: 2, failed: 3, dry_run: true });
      expect(report.results.every((result) => result.id === null)).toBe(true);
      expect(await list('payment-methods')).toEqual([]);
    });

    it('refuses the whole file only for what no row can be blamed for', async () => {
      const reasonOf = async (csv: string) => {
        const response = await importCsv('payment-methods', csv);
        expect(response.statusCode, response.body).toBe(400);
        return (response.json() as { error: { details: { reason: string } } }).error.details.reason;
      };
      expect(await reasonOf('name,direction,colour\nPapara,deposit,blue')).toBe(
        'csv_header_unknown',
      );
      expect(await reasonOf('name,name,direction\nPapara,Papara,deposit')).toBe(
        'csv_header_repeated',
      );
      expect(await reasonOf('name,min_amount\nPapara,1')).toBe('csv_header_missing');
      expect(await reasonOf('name,direction\n"Papara,deposit')).toBe('csv_unclosed_quote');
      expect(await list('payment-methods')).toEqual([]);
    });

    it('exports what imports back, cell for cell', async () => {
      const method = await add('payment-methods', {
        ...PAPARA,
        networks: ['TRC20', 'ERC20'],
        common_errors: [
          {
            code: 'IBAN',
            title: 'Yanlış IBAN',
            customer_text: 'IBAN\'ı kontrol edin, "TR" ile başlar.',
            agent_hint: null,
          },
        ],
        working_hours: {
          timezone: 'Europe/Istanbul',
          windows: [{ day: 'friday', start: '09:00', end: '24:00' }],
          closed_on_bank_holidays: false,
        },
        customer_notes: '-Satır başında eksi\nve ikinci satır, virgüllü',
      });
      await add('rules', {
        key: 'negative_balance',
        title: '=Eksi bakiye',
        numeric_value: -5.25,
        value_text: '@uyarı',
      });
      const fieldsOf = (row: RowView) => {
        const {
          id: _id,
          reviewed_at: _r,
          review_due_at: _d,
          created_by: _cb,
          updated_by: _ub,
          updated_at: _u,
          ...rest
        } = row as RowView & { created_at?: string };
        delete (rest as Record<string, unknown>)['created_at'];
        return rest;
      };
      for (const table of ['payment-methods', 'rules']) {
        const exported = await server.get(`/knowledge-tables/${table}/export`, auth(writeA));
        expect(exported.statusCode).toBe(200);
        expect(exported.headers['content-type']).toMatch(/^text\/csv/);
        // Formula-looking cells leave guarded.
        if (table === 'rules') expect(exported.body).toContain("'=Eksi bakiye");
        const imported = await importCsv(table, exported.body, false, writeB);
        expect(imported.statusCode, imported.body).toBe(200);
        expect(imported.json()).toMatchObject({ imported: 1, failed: 0 });
        const [mine] = await list(table);
        const [theirs] = await list(table, '', writeB);
        expect(fieldsOf(theirs!)).toEqual(fieldsOf(mine!));
      }
      expect(method.customer_notes).toBe('-Satır başında eksi\nve ikinci satır, virgüllü');
    });
  });

  // ==========================================================================

  describe('the row in the knowledge store (AI-13 coding logic 3)', () => {
    it('keeps every row as one table_row source holding its text, its brands and its review, and retrieval finds it', async () => {
      const row = await add('payment-methods', PAPARA);
      const source = (await sourceOf('kb_payment_methods', row.id))!;
      expect(source).toMatchObject({
        type: 'table_row',
        name: 'Papara',
        status: 'ready',
        content: renderRowText('payment_methods', {
          ...(row as unknown as PaymentMethodFields),
        }),
        audiences: ['ai_agent', 'copilot'],
        aiAgentIds: [],
        brandIds: [],
        reviewIntervalDays: 14,
        lastRefreshError: null,
      });
      expect(source.content).toContain('En az tutar: 100 TRY.');
      expect(source.reviewedAt.toISOString()).toBe(row.reviewed_at);
      expect(source._count.chunks).toBeGreaterThan(0);
      expect((await found(ASK_PAPARA_MIN, player())).join('\n')).toContain('En az tutar: 100 TRY.');

      // Edited: indexed again — the old figure answers nothing.
      await server.patch(
        `/knowledge-tables/payment-methods/${row.id}`,
        { min_amount: 250 },
        auth(writeA),
      );
      const edited = (await found(ASK_PAPARA_MIN, player())).join('\n');
      expect(edited).toContain('En az tutar: 250 TRY.');
      expect(edited).not.toContain('En az tutar: 100 TRY.');

      // Moved to one brand: the source follows, and another brand's player
      // (or one whose brand is not known) no longer finds it.
      await server.patch(
        `/knowledge-tables/payment-methods/${row.id}`,
        { brand_ids: [brandA] },
        auth(writeA),
      );
      expect((await sourceOf('kb_payment_methods', row.id))!.brandIds).toEqual([brandA]);
      expect((await found(ASK_PAPARA_MIN, player(brandA))).join('\n')).toContain('250 TRY');
      expect((await found(ASK_PAPARA_MIN, player(brandB))).join('\n')).not.toContain('Papara');
      expect((await found(ASK_PAPARA_MIN, player(null))).join('\n')).not.toContain('Papara');

      // A review is the source's review too; deleted, the source goes.
      await owner.kbPaymentMethod.update({
        where: { id: row.id },
        data: { reviewedAt: new Date(Date.now() - 20 * DAY_MS) },
      });
      const reviewed = (
        await server.post(
          `/knowledge-tables/payment-methods/${row.id}/review`,
          undefined,
          auth(writeA),
        )
      ).json() as RowView;
      expect((await sourceOf('kb_payment_methods', row.id))!.reviewedAt.toISOString()).toBe(
        reviewed.reviewed_at,
      );
      await server.del(`/knowledge-tables/payment-methods/${row.id}`, auth(writeA));
      expect(await sourceOf('kb_payment_methods', row.id)).toBeNull();
      expect((await found(ASK_PAPARA_MIN, player(brandA))).join('\n')).not.toContain('Papara');
    });

    it("rewrites a bonus's text when a payment method it excludes is renamed or deleted, and ends its source with the campaign", async () => {
      const method = await add('payment-methods', PAPARA);
      const activeTo = new Date(Date.now() + 10 * DAY_MS).toISOString();
      const bonus = await add('bonuses', {
        name: 'Yatırım bonusu',
        excluded_method_ids: [method.id],
        active_to: activeTo,
      });
      const text = async () => (await sourceOf('kb_bonuses', bonus.id))!.content;
      expect(await text()).toContain('geçerli değildir: Papara.');
      expect((await sourceOf('kb_bonuses', bonus.id))!.validUntil?.toISOString()).toBe(
        new Date(activeTo).toISOString(),
      );
      await server.patch(
        `/knowledge-tables/payment-methods/${method.id}`,
        { name: 'Papara Cüzdan' },
        auth(writeA),
      );
      expect(await text()).toContain('geçerli değildir: Papara Cüzdan.');
      await server.del(`/knowledge-tables/payment-methods/${method.id}`, auth(writeA));
      expect(await text()).toContain(
        'Bazı ödeme yöntemleriyle yapılan yatırımlarda geçerli değildir.',
      );
    });

    it('saves the row when its text cannot be embedded, answers nothing from the old text, and the sweep indexes it', async () => {
      const row = await add('payment-methods', PAPARA);
      embeddings.failWith(new EmbeddingProviderError('unavailable'));
      const edited = await server.patch(
        `/knowledge-tables/payment-methods/${row.id}`,
        { min_amount: 300 },
        auth(writeA),
      );
      expect(edited.statusCode).toBe(200);
      const held = (await sourceOf('kb_payment_methods', row.id))!;
      expect(held).toMatchObject({ status: 'indexing' });
      expect(held.content).toContain('En az tutar: 300 TRY.');
      expect(held._count.chunks).toBe(0);
      expect(held.lastRefreshError).toMatch(/embedding provider did not answer/);
      // A new row is saved too, its source waiting.
      const fresh = await add('rules', { key: 'min_age', title: 'Yaş sınırı', numeric_value: 18 });
      expect(await sourceOf('kb_rules', fresh.id)).toMatchObject({ status: 'indexing' });
      embeddings.failWith(undefined);
      expect((await found(ASK_PAPARA_MIN, player())).join('\n')).not.toContain('100 TRY');

      const report = await sweep();
      expect(report.totals).toMatchObject({ checked: 2, synced: 2, deferred: 0 });
      expect(await sourceOf('kb_payment_methods', row.id)).toMatchObject({
        status: 'ready',
        lastRefreshError: null,
      });
      expect((await found(ASK_PAPARA_MIN, player())).join('\n')).toContain('300 TRY');
      expect((await sweep()).totals).toMatchObject({ checked: 0, synced: 0 });
    });

    it("takes a deleted row's source in the delete's own transaction, chunks and all", async () => {
      for (const [table, sql, body] of [
        ['rules', 'kb_rules', { key: 'min_age', title: 'Yaş sınırı', numeric_value: 18 }],
        ['kyc-documents', 'kb_kyc_documents', { doc_type: 'Pasaport' }],
        ['bonuses', 'kb_bonuses', { name: 'Kayıp bonusu' }],
      ] as const) {
        const row = await add(table, body);
        const source = (await sourceOf(sql, row.id))!;
        expect(source._count.chunks).toBeGreaterThan(0);
        expect(
          (await server.del(`/knowledge-tables/${table}/${row.id}`, auth(writeA))).statusCode,
        ).toBe(204);
        expect(await sourceOf(sql, row.id)).toBeNull();
        expect(await owner.knowledgeChunk.count({ where: { sourceId: source.id } })).toBe(0);
      }
    });

    it('indexes a row that has no source, and removes a source whose row is gone', async () => {
      // As a write that died between its commit and its sync left them.
      const bare = await owner.kbKycDocument.create({
        data: { licenseId: fx.a.licenseId, docType: 'Pasaport' },
        select: { id: true },
      });
      const row = await add('rules', { key: 'min_age', title: 'Yaş sınırı', numeric_value: 18 });
      await owner.$executeRawUnsafe('DELETE FROM kb_rules WHERE id = $1::uuid', row.id);
      expect(await sourceOf('kb_rules', row.id)).not.toBeNull();

      const report = await sweep();
      expect(report.totals).toMatchObject({ checked: 2, synced: 2, deferred: 0 });
      expect(await sourceOf('kb_kyc_documents', bare.id)).toMatchObject({
        status: 'ready',
        name: 'Pasaport',
      });
      expect(await sourceOf('kb_rules', row.id)).toBeNull();
    });

    it("is the row's: /knowledge-sources neither lists, edits, reindexes, reviews nor deletes it", async () => {
      const row = await add('payment-methods', PAPARA);
      const source = (await sourceOf('kb_payment_methods', row.id))!;
      const listed = await server.get('/knowledge-sources?audience=all', auth(writeA));
      expect(
        (listed.json() as { items: Array<{ id: string }> }).items.map((s) => s.id),
      ).not.toContain(source.id);
      for (const response of [
        await server.patch(`/knowledge-sources/${source.id}`, { name: 'X' }, auth(writeA)),
        await server.post(`/knowledge-sources/${source.id}/reindex`, undefined, auth(writeA)),
        await server.post(`/knowledge-sources/${source.id}/review`, undefined, auth(writeA)),
        await server.del(`/knowledge-sources/${source.id}`, auth(writeA)),
      ]) {
        expect(response.statusCode, response.body).toBe(400);
        expect(response.json()).toMatchObject({
          error: {
            details: {
              reason: 'knowledge_source_from_table_row',
              source_table: 'kb_payment_methods',
              source_row_id: row.id,
            },
          },
        });
      }
      expect(await sourceOf('kb_payment_methods', row.id)).toMatchObject({ name: 'Papara' });
    });
  });
});
