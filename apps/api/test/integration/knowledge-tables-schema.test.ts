/**
 * Structured knowledge tables and the access information setting (tm 310.1 ·
 * SiyahTuş analysis AI-13, owner decision K13; ADR-14b §2.12; migration
 * 20261021120000_knowledge_tables).
 *
 * Nothing writes or reads these tables in the product yet — tm 310.2 brings the
 * writer, tm 310.3 the fact resolver, tm 310.4 the access answer. What is
 * pinned here is what they lean on:
 *
 *   - **Tenant isolation.** RLS on all five tables, read and write; the four
 *     tables per licence, the access information per licence and brand.
 *   - **One vocabulary.** The CHECKs, the column defaults, `@siyahtus/types`
 *     and the contract name the same lists and bounds.
 *   - **What a row must say (AI-13 §6).** The validator and the CHECK refuse
 *     the same rows: a minimum above the maximum, a delay threshold below the
 *     expected time, a wagering base without a multiplier, a `code` bonus
 *     without its code, a campaign ending before it starts, a rule saying
 *     nothing.
 *   - **Brands (AI-13-S3 · K13).** The reader serves a brand its own rows and
 *     the every-brand rows — `knowledgeTableRowServesBrand`, row by row; the
 *     access information is one setting for every brand and at most one per
 *     brand, the workspace's own brand only, a brand's own winning.
 */
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loadOpenApiDocument } from '@siyahtus/contract';
import {
  AI_ACCESS_INFO_CACHE_SECONDS,
  AI_ACCESS_INFO_SOURCE_TYPES,
  BONUS_CLAIM_METHODS,
  BONUS_TYPES,
  BONUS_WAGERING_BASES,
  KB_RULE_CATEGORIES,
  KNOWLEDGE_REVIEW_INTERVAL_DAYS,
  KNOWLEDGE_TABLES,
  KNOWLEDGE_TABLE_PATH_SEGMENTS,
  KNOWLEDGE_TABLE_PROBLEM_CODES,
  KNOWLEDGE_TABLE_REVIEW_INTERVAL_DAYS,
  KNOWLEDGE_TABLE_ROW_SOURCES,
  KNOWLEDGE_TABLE_SQL_NAMES,
  PAYMENT_DIRECTIONS,
  PAYMENT_REFERENCE_FORMATS,
  knowledgeTableRowServesBrand,
  validateAiAccessInfo,
  validateBonus,
  validateKbRule,
  validateKycDocument,
  validatePaymentMethod,
  type KnowledgeTable,
  type KnowledgeTableProblem,
} from '@siyahtus/types';
import { withTenant, type TenantClient } from '../../src/lib/tenant.js';
import {
  readAiAccessInfo,
  readKnowledgeTableRows,
} from '../../src/services/knowledge-tables/rows.js';
import {
  ownerClient,
  seedFixtures,
  type Fixtures,
  type TenantFixture,
} from '../helpers/fixtures.js';

const APP_URL = process.env['DATABASE_APP_URL'];
const ROLLBACK = new Error('rollback probe');

/** As much of a JSON schema as these tests read. */
interface SchemaNode {
  enum?: Array<string | null>;
  minimum?: number;
  maximum?: number;
  default?: unknown;
  properties?: Record<string, SchemaNode>;
}

function contractSchemas(): Record<string, SchemaNode> {
  const document = loadOpenApiDocument() as unknown as {
    components: { schemas: Record<string, SchemaNode> };
  };
  return document.components.schemas;
}

const SQL_TABLES = [...Object.values(KNOWLEDGE_TABLE_SQL_NAMES), 'ai_access_info'];

type Writer = Pick<
  PrismaClient,
  'kbPaymentMethod' | 'kbBonus' | 'kbKycDocument' | 'kbRule' | 'aiAccessInfo' | '$executeRawUnsafe'
>;
type Data = Record<string, unknown>;

/** The least each table takes, Prisma field names. */
const BASE: Record<KnowledgeTable, Data> = {
  payment_methods: { name: 'Papara', direction: 'deposit' },
  bonuses: { name: 'Hoş geldin' },
  kyc_documents: { docType: 'Kimlik kartı' },
  rules: { key: 'daily_withdrawal_limit', title: 'Günlük çekim limiti', valueText: '50.000 TL' },
};

/** Write one row of `table` for `licenseId`, `data` over the table's least. */
async function plant(
  db: Writer,
  table: KnowledgeTable,
  licenseId: bigint,
  data: Data = {},
): Promise<{ id: string }> {
  const row = { ...BASE[table], ...data, licenseId } as never;
  switch (table) {
    case 'payment_methods':
      return db.kbPaymentMethod.create({ data: row });
    case 'bonuses':
      return db.kbBonus.create({ data: row });
    case 'kyc_documents':
      return db.kbKycDocument.create({ data: row });
    default:
      return db.kbRule.create({ data: row });
  }
}

async function columnDefault(db: PrismaClient, table: string, column: string): Promise<string> {
  const [row] = await db.$queryRaw<Array<{ value: string }>>`
    SELECT column_default AS value FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = ${table} AND column_name = ${column}`;
  return row!.value;
}

const codes = (problems: KnowledgeTableProblem[]) => problems.map((p) => `${p.field}:${p.code}`);

describe('structured knowledge tables — schema (AI-13 · K13 · tm 310.1)', () => {
  let owner: PrismaClient;
  let app: PrismaClient;
  let fx: Fixtures;
  let brandA1: string;
  let brandA2: string;
  let brandB: string;

  const asTenant = <T>(
    tenant: TenantFixture,
    fn: (tx: TenantClient) => Promise<T>,
    brandId?: string,
  ) =>
    withTenant(
      app,
      {
        licenseId: tenant.licenseId,
        organizationId: tenant.organizationId,
        ...(brandId ? { brandId } : {}),
      },
      fn,
    );

  /** Run `fn` as the owner and roll it back; what it threw, or null. */
  async function attempt(fn: (tx: Writer) => Promise<unknown>): Promise<string | null> {
    try {
      await owner.$transaction(async (tx) => {
        await fn(tx);
        throw ROLLBACK;
      });
    } catch (error) {
      if (error === ROLLBACK) return null;
      return error instanceof Error ? error.message : String(error);
    }
    return null;
  }

  const tryRow = (table: KnowledgeTable, data: Data) =>
    attempt((tx) => plant(tx, table, fx.a.licenseId, data));

  beforeAll(() => {
    if (!APP_URL) throw new Error('DATABASE_APP_URL must be set');
    owner = ownerClient();
    app = new PrismaClient({ datasourceUrl: APP_URL });
  });

  afterAll(async () => {
    await Promise.all([owner.$disconnect(), app.$disconnect()]);
  });

  beforeEach(async () => {
    fx = await seedFixtures(owner);
    const brand = (licenseId: bigint, slug: string) =>
      owner.brand
        .create({ data: { licenseId, name: slug, slug }, select: { id: true } })
        .then((b) => b.id);
    [brandA1, brandA2, brandB] = await Promise.all([
      brand(fx.a.licenseId, 'a-one'),
      brand(fx.a.licenseId, 'a-two'),
      brand(fx.b.licenseId, 'b-one'),
    ]);
  });

  // =========================================================================
  // Tenant isolation
  // =========================================================================

  describe('tenant isolation', () => {
    it('turns RLS on for the five tables, each policy guarding read and write (NFR-S4)', async () => {
      const security = await owner.$queryRaw<Array<{ relname: string; enabled: boolean }>>`
        SELECT relname, relrowsecurity AS enabled FROM pg_class
         WHERE relname = ANY(${SQL_TABLES}::text[]) AND relkind = 'r'`;
      expect(security.map((row) => row.relname).sort()).toEqual([...SQL_TABLES].sort());
      for (const row of security) expect(row.enabled, row.relname).toBe(true);

      const policies = await owner.$queryRaw<
        Array<{ tablename: string; policyname: string; qual: string; withCheck: string }>
      >`
        SELECT tablename, policyname, qual, with_check AS "withCheck" FROM pg_policies
         WHERE tablename = ANY(${SQL_TABLES}::text[])`;
      expect(policies).toHaveLength(SQL_TABLES.length);
      for (const policy of policies) {
        expect(policy.policyname).toBe(`${policy.tablename}_tenant`);
        expect(policy.qual, policy.tablename).toContain('siyahtus_current_license()');
        expect(policy.withCheck, policy.tablename).toContain('siyahtus_current_license()');
        // The four tables are per licence — the brand list is the reader's;
        // the access information narrows by brand like `handoff_routes`.
        const branded = policy.tablename === 'ai_access_info';
        expect(policy.qual.includes('siyahtus_current_brand()'), policy.tablename).toBe(branded);
        expect(policy.withCheck.includes('siyahtus_current_brand()'), policy.tablename).toBe(
          branded,
        );
      }
    });

    it.each(KNOWLEDGE_TABLES)(
      "%s: never shows another licence's row, and refuses writing one for it",
      async (table) => {
        await plant(owner, table, fx.a.licenseId);
        const sql = KNOWLEDGE_TABLE_SQL_NAMES[table];
        const count = (tenant: TenantFixture) =>
          asTenant(tenant, async (tx) => {
            const [row] = await tx.$queryRawUnsafe<Array<{ n: number }>>(
              `SELECT count(*)::int AS n FROM ${sql}`,
            );
            return row!.n;
          });
        expect(await count(fx.a)).toBe(1);
        expect(await count(fx.b)).toBe(0);
        await expect(asTenant(fx.b, (tx) => plant(tx, table, fx.a.licenseId))).rejects.toThrow(
          /row-level security/,
        );
      },
    );

    it("never shows another licence's access information, and refuses writing it (NFR-S4)", async () => {
      await owner.aiAccessInfo.create({
        data: { licenseId: fx.a.licenseId, sourceType: 'fixed_link', url: 'https://a.example' },
      });
      expect(await asTenant(fx.a, (tx) => tx.aiAccessInfo.count())).toBe(1);
      expect(await asTenant(fx.b, (tx) => tx.aiAccessInfo.count())).toBe(0);
      await expect(
        asTenant(fx.b, (tx) =>
          tx.aiAccessInfo.create({
            data: { licenseId: fx.a.licenseId, sourceType: 'fixed_link', url: 'https://b.example' },
          }),
        ),
      ).rejects.toThrow(/row-level security/);
    });

    it('the application role writes rows but never empties a table wholesale', async () => {
      for (const table of SQL_TABLES) {
        await expect(
          asTenant(fx.a, (tx) => tx.$executeRawUnsafe(`TRUNCATE ${table}`)),
          table,
        ).rejects.toThrow(/permission denied/);
      }
    });
  });

  // =========================================================================
  // One vocabulary
  // =========================================================================

  describe('one vocabulary — the CHECKs, the defaults, the types and the contract', () => {
    const LISTS: Array<[KnowledgeTable, string, readonly string[], Data]> = [
      ['payment_methods', 'direction', PAYMENT_DIRECTIONS, {}],
      ['payment_methods', 'referenceFormat', PAYMENT_REFERENCE_FORMATS, {}],
      ['bonuses', 'type', BONUS_TYPES, {}],
      ['bonuses', 'wageringBase', BONUS_WAGERING_BASES, { wageringMultiplier: 10 }],
      ['bonuses', 'claimMethod', BONUS_CLAIM_METHODS, { promoCode: 'KOD' }],
      ['rules', 'category', KB_RULE_CATEGORIES, {}],
      ...KNOWLEDGE_TABLES.map(
        (table) =>
          [table, 'source', KNOWLEDGE_TABLE_ROW_SOURCES, {}] as [
            KnowledgeTable,
            string,
            readonly string[],
            Data,
          ],
      ),
    ];

    it.each(LISTS)(
      '%s.%s admits every value the types list, and nothing else',
      async (table, field, list, with_) => {
        for (const value of list) {
          expect(await tryRow(table, { ...with_, [field]: value }), `${field}=${value}`).toBeNull();
        }
        expect(await tryRow(table, { ...with_, [field]: 'nope' })).toMatch(/check constraint/i);
      },
    );

    it("each table defaults to its review interval; the bounds are the knowledge store's (AI-13-S2)", async () => {
      for (const table of KNOWLEDGE_TABLES) {
        expect(
          await columnDefault(owner, KNOWLEDGE_TABLE_SQL_NAMES[table], 'review_interval_days'),
        ).toBe(String(KNOWLEDGE_TABLE_REVIEW_INTERVAL_DAYS[table]));
        const { min, max } = KNOWLEDGE_REVIEW_INTERVAL_DAYS;
        expect(await tryRow(table, { reviewIntervalDays: min })).toBeNull();
        expect(await tryRow(table, { reviewIntervalDays: max })).toBeNull();
        expect(await tryRow(table, { reviewIntervalDays: min - 1 })).toMatch(/check constraint/i);
        expect(await tryRow(table, { reviewIntervalDays: max + 1 })).toMatch(/check constraint/i);
      }
      expect(await columnDefault(owner, 'ai_access_info', 'cache_seconds')).toBe(
        String(AI_ACCESS_INFO_CACHE_SECONDS.default),
      );
    });

    it('the contract names the same lists and bounds', () => {
      const s = contractSchemas();
      const props = (name: string) => s[name]!.properties!;
      const values = (node: SchemaNode | undefined) => (node?.enum ?? []).filter((v) => v !== null);
      expect(values(s['KnowledgeTableSegment'])).toEqual(
        Object.values(KNOWLEDGE_TABLE_PATH_SEGMENTS),
      );
      expect(values(s['KnowledgeTableRowSource'])).toEqual([...KNOWLEDGE_TABLE_ROW_SOURCES]);
      expect(values(props('KnowledgeTableProblem')['code'])).toEqual([
        ...KNOWLEDGE_TABLE_PROBLEM_CODES,
      ]);
      expect(values(props('KbPaymentMethodFields')['direction'])).toEqual([...PAYMENT_DIRECTIONS]);
      expect(values(props('KbPaymentMethodFields')['reference_format'])).toEqual([
        ...PAYMENT_REFERENCE_FORMATS,
      ]);
      expect(values(props('KbBonusFields')['type'])).toEqual([...BONUS_TYPES]);
      expect(values(props('KbBonusFields')['wagering_base'])).toEqual([...BONUS_WAGERING_BASES]);
      expect(values(props('KbBonusFields')['claim_method'])).toEqual([...BONUS_CLAIM_METHODS]);
      expect(values(props('KbRuleFields')['category'])).toEqual([...KB_RULE_CATEGORIES]);
      expect(values(s['AiAccessInfoSourceType'])).toEqual([...AI_ACCESS_INFO_SOURCE_TYPES]);
      const interval = props('KnowledgeTableRowMetaWrite')['review_interval_days']!;
      expect([interval.minimum, interval.maximum]).toEqual([
        KNOWLEDGE_REVIEW_INTERVAL_DAYS.min,
        KNOWLEDGE_REVIEW_INTERVAL_DAYS.max,
      ]);
      const cache = props('AiAccessInfoUpdate')['cache_seconds']!;
      expect([cache.minimum, cache.maximum, cache.default]).toEqual([
        AI_ACCESS_INFO_CACHE_SECONDS.min,
        AI_ACCESS_INFO_CACHE_SECONDS.max,
        AI_ACCESS_INFO_CACHE_SECONDS.default,
      ]);
    });
  });

  // =========================================================================
  // What a row must say
  // =========================================================================

  describe('what a row must say — the validator and the CHECK agree (AI-13 §6)', () => {
    it('a payment method: the minimum never above the maximum, the delay threshold never below the expected time', async () => {
      const papara = {
        name: 'Papara',
        direction: 'deposit',
        min_amount: 100,
        max_amount: 50_000,
        expected_minutes: 30,
        delay_threshold_minutes: 60,
      };
      expect(validatePaymentMethod(papara)).toEqual([]);
      expect(
        await tryRow('payment_methods', {
          minAmount: 100,
          maxAmount: 50_000,
          expectedMinutes: 30,
          delayThresholdMinutes: 60,
        }),
      ).toBeNull();

      expect(codes(validatePaymentMethod({ ...papara, min_amount: 60_000 }))).toEqual([
        'min_amount:min_above_max',
      ]);
      expect(await tryRow('payment_methods', { minAmount: 60_000, maxAmount: 50_000 })).toMatch(
        /kb_payment_methods_limits_check/,
      );
      expect(codes(validatePaymentMethod({ ...papara, delay_threshold_minutes: 20 }))).toEqual([
        'delay_threshold_minutes:delay_below_expected',
      ]);
      expect(
        await tryRow('payment_methods', { expectedMinutes: 30, delayThresholdMinutes: 20 }),
      ).toMatch(/kb_payment_methods_limits_check/);
      expect(codes(validatePaymentMethod({ ...papara, currency: 'try' }))).toEqual([
        'currency:invalid',
      ]);
      expect(await tryRow('payment_methods', { currency: 'try' })).toMatch(
        /kb_payment_methods_fields_check/,
      );
      expect(codes(validatePaymentMethod({ ...papara, name: '  ' }))).toEqual(['name:required']);
      expect(await tryRow('payment_methods', { name: '  ' })).toMatch(
        /kb_payment_methods_fields_check/,
      );
    });

    it('a bonus: a wagering base with its multiplier, a code for `code`, the campaign in order', async () => {
      const bonus = { name: 'Hoş geldin', wagering_multiplier: 10, wagering_base: 'bonus' };
      expect(validateBonus(bonus)).toEqual([]);
      expect(await tryRow('bonuses', { wageringMultiplier: 10, wageringBase: 'bonus' })).toBeNull();

      expect(codes(validateBonus({ ...bonus, wagering_base: null }))).toEqual([
        'wagering_base:wagering_base_required',
      ]);
      expect(await tryRow('bonuses', { wageringMultiplier: 10 })).toMatch(/kb_bonuses_terms_check/);
      expect(codes(validateBonus({ ...bonus, wagering_multiplier: null }))).toEqual([
        'wagering_multiplier:required',
      ]);
      expect(await tryRow('bonuses', { wageringBase: 'bonus' })).toMatch(/kb_bonuses_terms_check/);
      expect(codes(validateBonus({ ...bonus, claim_method: 'code' }))).toEqual([
        'promo_code:promo_code_required',
      ]);
      expect(await tryRow('bonuses', { claimMethod: 'code' })).toMatch(/kb_bonuses_terms_check/);
      const window = { active_from: '2026-10-31T00:00:00Z', active_to: '2026-10-01T00:00:00Z' };
      expect(codes(validateBonus({ ...bonus, ...window }))).toEqual([
        'active_to:active_to_before_from',
      ]);
      expect(
        await tryRow('bonuses', {
          activeFrom: new Date(window.active_from),
          activeTo: new Date(window.active_to),
        }),
      ).toMatch(/kb_bonuses_terms_check/);
      expect(codes(validateBonus({ ...bonus, min_odds: 0.5 }))).toEqual(['min_odds:out_of_range']);
      expect(await tryRow('bonuses', { minOdds: 0.5 })).toMatch(/kb_bonuses_terms_check/);
    });

    it('a rule says something; a KYC document has a name and a review of at most 30 days', async () => {
      expect(codes(validateKbRule({ key: 'x', title: 'X' }))).toEqual([
        'value_text:value_required',
      ]);
      expect(await tryRow('rules', { valueText: null })).toMatch(/kb_rules_fields_check/);
      expect(
        await tryRow('rules', { valueText: null, numericValue: 50_000, unit: 'TRY' }),
      ).toBeNull();
      expect(codes(validateKbRule({ key: 'Günlük', title: 'X', value_text: 'y' }))).toEqual([
        'key:invalid',
      ]);
      expect(await tryRow('rules', { key: 'Günlük' })).toMatch(/kb_rules_fields_check/);

      expect(codes(validateKycDocument({ doc_type: '' }))).toEqual(['doc_type:required']);
      expect(await tryRow('kyc_documents', { docType: '' })).toMatch(
        /kb_kyc_documents_fields_check/,
      );
      expect(codes(validateKycDocument({ doc_type: 'Kimlik', review_hours: 721 }))).toEqual([
        'review_hours:out_of_range',
      ]);
      expect(await tryRow('kyc_documents', { reviewHours: 721 })).toMatch(
        /kb_kyc_documents_fields_check/,
      );
    });

    it('a list holds no NULL, so "for this brand" is a plain = ANY', async () => {
      for (const table of KNOWLEDGE_TABLES) {
        const error = await attempt(async (tx) => {
          const row = await plant(tx, table, fx.a.licenseId);
          await tx.$executeRawUnsafe(
            `UPDATE ${KNOWLEDGE_TABLE_SQL_NAMES[table]} SET brand_ids = ARRAY[NULL]::uuid[] WHERE id = $1::uuid`,
            row.id,
          );
        });
        expect(error, table).toMatch(/_meta_check/);
      }
    });
  });

  // =========================================================================
  // Access information
  // =========================================================================

  describe('access information (K13)', () => {
    const access = (data: Data) =>
      attempt((tx) =>
        tx.aiAccessInfo.create({ data: { licenseId: fx.a.licenseId, ...data } as never }),
      );

    it('each source type needs its target; a URL is http(s); a last value comes with its moment', async () => {
      const source = 'b5a3f1e2-0000-4000-8000-000000000001';
      expect(await access({ sourceType: 'kb_row', kbSourceId: source })).toBeNull();
      expect(
        await access({ sourceType: 'dynamic_url', url: 'https://api.example/adres.json' }),
      ).toBeNull();
      expect(
        await access({
          sourceType: 'fixed_link',
          url: 'http://giris.example',
          fixedText: 'Güncel adres:',
        }),
      ).toBeNull();

      expect(codes(validateAiAccessInfo({ source_type: 'kb_row' }))).toEqual([
        'kb_source_id:required',
      ]);
      expect(await access({ sourceType: 'kb_row' })).toMatch(/ai_access_info_source_check/);
      expect(codes(validateAiAccessInfo({ source_type: 'dynamic_url' }))).toEqual(['url:required']);
      expect(await access({ sourceType: 'dynamic_url' })).toMatch(/ai_access_info_source_check/);
      expect(
        codes(validateAiAccessInfo({ source_type: 'fixed_link', url: 'javascript:alert(1)' })),
      ).toEqual(['url:invalid']);
      expect(await access({ sourceType: 'fixed_link', url: 'javascript:alert(1)' })).toMatch(
        /ai_access_info_source_check/,
      );
      expect(await access({ sourceType: 'telepathy', url: 'https://x.example' })).toMatch(
        /ai_access_info_source_check/,
      );
      expect(
        await access({
          sourceType: 'dynamic_url',
          url: 'https://x.example',
          lastValue: 'https://yeni.example',
        }),
      ).toMatch(/ai_access_info_source_check/);
      expect(
        await access({
          sourceType: 'dynamic_url',
          url: 'https://x.example',
          lastValue: 'https://yeni.example',
          lastFetchedAt: new Date(),
        }),
      ).toBeNull();
      expect(
        await access({ sourceType: 'dynamic_url', url: 'https://x.example', cacheSeconds: 29 }),
      ).toMatch(/ai_access_info_source_check/);
    });

    it('one setting for every brand and at most one per brand', async () => {
      const row = (brandId: string | null) => ({
        licenseId: fx.a.licenseId,
        brandId,
        sourceType: 'fixed_link',
        url: 'https://giris.example',
      });
      await owner.aiAccessInfo.create({ data: row(null) });
      await owner.aiAccessInfo.create({ data: row(brandA1) });
      await owner.aiAccessInfo.create({ data: row(brandA2) });
      await expect(owner.aiAccessInfo.create({ data: row(null) })).rejects.toThrow(
        /Unique constraint/,
      );
      await expect(owner.aiAccessInfo.create({ data: row(brandA1) })).rejects.toThrow(
        /Unique constraint/,
      );
      // Another licence keeps its own.
      await owner.aiAccessInfo.create({
        data: { licenseId: fx.b.licenseId, sourceType: 'fixed_link', url: 'https://b.example' },
      });
    });

    it("refuses another workspace's brand — a foreign key alone is checked past RLS", async () => {
      await expect(
        asTenant(fx.a, (tx) =>
          tx.aiAccessInfo.create({
            data: {
              licenseId: fx.a.licenseId,
              brandId: brandB,
              sourceType: 'fixed_link',
              url: 'https://x.example',
            },
          }),
        ),
        // The brand exists, so the foreign key itself is satisfied (it is
        // checked past RLS); only `ai_access_info_before_write` raises this.
      ).rejects.toThrow(/Foreign key constraint/);
    });

    it('a brand reads its own setting over the every-brand one; an unknown brand the every-brand one', async () => {
      const every = await owner.aiAccessInfo.create({
        data: { licenseId: fx.a.licenseId, sourceType: 'fixed_link', url: 'https://hepsi.example' },
      });
      const own = await owner.aiAccessInfo.create({
        data: {
          licenseId: fx.a.licenseId,
          brandId: brandA1,
          sourceType: 'fixed_link',
          url: 'https://a1.example',
        },
      });
      const read = (brandId: string | null) =>
        asTenant(fx.a, (tx) => readAiAccessInfo(tx, { brandId }).then((row) => row?.id ?? null));
      expect(await read(brandA1)).toBe(own.id);
      expect(await read(brandA2)).toBe(every.id);
      expect(await read(null)).toBe(every.id);
      expect(
        await asTenant(fx.b, (tx) =>
          readAiAccessInfo(tx, { brandId: null }).then((row) => row?.id ?? null),
        ),
      ).toBeNull();
      // Under a brand context RLS narrows too: A2 never sees A1's row.
      expect(
        await asTenant(
          fx.a,
          (tx) => tx.aiAccessInfo.findMany({ select: { id: true } }),
          brandA2,
        ).then((rows) => rows.map((r) => r.id)),
      ).toEqual([every.id]);
    });
  });

  // =========================================================================
  // The brand reader
  // =========================================================================

  describe('the brand reader agrees with knowledgeTableRowServesBrand (AI-13-S3)', () => {
    it.each(KNOWLEDGE_TABLES)('%s', async (table) => {
      const scopes: string[][] = [[], [brandA1], [brandA2], [brandA1, brandA2]];
      const planted: Array<{ id: string; brandIds: string[] }> = [];
      for (const [i, brandIds] of scopes.entries()) {
        const name = {
          payment_methods: 'name',
          bonuses: 'name',
          kyc_documents: 'docType',
          rules: 'key',
        }[table];
        const row = await plant(owner, table, fx.a.licenseId, {
          brandIds,
          [name]: table === 'rules' ? `rule_${i}` : `Satır ${i}`,
        });
        planted.push({ id: row.id, brandIds });
      }
      // Another licence's every-brand row is never served.
      await plant(owner, table, fx.b.licenseId);

      for (const brandId of [brandA1, brandA2, null]) {
        const served = await asTenant(fx.a, (tx) => readKnowledgeTableRows(tx, table, { brandId }));
        const expected = planted.filter((row) =>
          knowledgeTableRowServesBrand(row.brandIds, brandId),
        );
        expect(served.map((row) => row.id).sort(), String(brandId)).toEqual(
          expected.map((row) => row.id).sort(),
        );
      }
    });
  });
});
