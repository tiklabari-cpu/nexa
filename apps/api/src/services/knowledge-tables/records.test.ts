/**
 * One column list, three spellings (tm 310.2): `KNOWLEDGE_TABLE_COLUMNS` names
 * exactly the contract's fields and the Prisma model's columns, and a row
 * crosses between them unchanged.
 */
import { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { loadOpenApiDocument } from '@siyahtus/contract';
import {
  KNOWLEDGE_TABLES,
  KNOWLEDGE_TABLE_COLUMNS,
  KNOWLEDGE_TABLE_REQUIRED_FIELDS,
  type KnowledgeTable,
} from '@siyahtus/types';
import {
  knowledgeTableColumnKey,
  knowledgeTableDataOf,
  knowledgeTableFieldsOf,
  normaliseKnowledgeTableInput,
  serialiseKnowledgeTableRow,
  unknownKnowledgeTableFields,
} from './records.js';
import type { KnowledgeTableRecords } from './rows.js';

const CONTRACT_FIELDS: Record<KnowledgeTable, string> = {
  payment_methods: 'KbPaymentMethodFields',
  bonuses: 'KbBonusFields',
  kyc_documents: 'KbKycDocumentFields',
  rules: 'KbRuleFields',
};

const PRISMA_COLUMNS: Record<KnowledgeTable, Record<string, string>> = {
  payment_methods: Prisma.KbPaymentMethodScalarFieldEnum,
  bonuses: Prisma.KbBonusScalarFieldEnum,
  kyc_documents: Prisma.KbKycDocumentScalarFieldEnum,
  rules: Prisma.KbRuleScalarFieldEnum,
};

/** The columns every row carries that are not its fields. */
const META_COLUMNS = [
  'id',
  'licenseId',
  'brandIds',
  'ownerId',
  'reviewedAt',
  'reviewIntervalDays',
  'source',
  'createdBy',
  'updatedBy',
  'createdAt',
  'updatedAt',
];

function contractSchema(schema: string): {
  properties: Record<string, unknown>;
  required?: string[];
} {
  const document = loadOpenApiDocument() as unknown as {
    components: {
      schemas: Record<string, { properties: Record<string, unknown>; required?: string[] }>;
    };
  };
  return document.components.schemas[schema]!;
}

const contractProperties = (schema: string) => Object.keys(contractSchema(schema).properties);

const META = {
  id: '6f1c1d52-4c8b-4f3e-9a51-0d6f7b1c2a10',
  licenseId: 1n,
  brandIds: [],
  ownerId: null,
  reviewedAt: new Date('2026-10-01T09:00:00Z'),
  reviewIntervalDays: 30,
  source: 'manual',
  createdBy: null,
  updatedBy: null,
  createdAt: new Date('2026-10-01T09:00:00Z'),
  updatedAt: new Date('2026-10-01T09:00:00Z'),
};

const BONUS: KnowledgeTableRecords['bonuses'] = {
  ...META,
  name: 'Hoş geldin',
  aliases: ['HG'],
  type: 'welcome',
  minDeposit: new Prisma.Decimal('100.50'),
  wageringMultiplier: new Prisma.Decimal('12.5'),
  wageringBase: 'bonus',
  contributing: [{ category: 'slot', percent: 100 }],
  minOdds: null,
  maxBet: null,
  maxCashout: null,
  validityDays: 7,
  claimMethod: 'auto',
  promoCode: null,
  excludedMethodIds: [],
  activeFrom: null,
  activeTo: new Date('2026-10-20T21:00:00Z'),
  termsText: null,
};

describe('the knowledge tables between Prisma, the fields and the contract (tm 310.2)', () => {
  it.each(KNOWLEDGE_TABLES)('names exactly the contract fields and the columns of %s', (table) => {
    const fields = KNOWLEDGE_TABLE_COLUMNS[table].map(([field]) => field);
    expect([...fields].sort()).toEqual(contractProperties(CONTRACT_FIELDS[table]).sort());
    expect([...fields.map(knowledgeTableColumnKey), ...META_COLUMNS].sort()).toEqual(
      Object.values(PRISMA_COLUMNS[table]).sort(),
    );
    // A create requires what the contract's create schema does.
    const create = CONTRACT_FIELDS[table].replace(/Fields$/, 'Create');
    expect([...KNOWLEDGE_TABLE_REQUIRED_FIELDS[table]].sort()).toEqual(
      [...(contractSchema(create).required ?? [])].sort(),
    );
  });

  it('reads a record as numbers and ISO moments, and writes them back as Prisma takes them', () => {
    const fields = knowledgeTableFieldsOf('bonuses', BONUS);
    expect(fields).toMatchObject({
      min_deposit: 100.5,
      wagering_multiplier: 12.5,
      active_to: '2026-10-20T21:00:00.000Z',
      contributing: [{ category: 'slot', percent: 100 }],
    });
    const data = knowledgeTableDataOf('bonuses', { ...fields, brand_ids: [] });
    expect(data['activeTo']).toEqual(new Date('2026-10-20T21:00:00Z'));
    expect(data['minDeposit']).toBe(100.5);
    expect(data['brandIds']).toEqual([]);
    expect('licenseId' in data).toBe(false);
    // A method's hours set to null clear the JSON column; an omitted field is not written.
    expect(knowledgeTableDataOf('payment_methods', { working_hours: null })).toEqual({
      workingHours: Prisma.DbNull,
    });
    expect(
      knowledgeTableDataOf('payment_methods', { name: 'X', working_hours: undefined }),
    ).toEqual({ name: 'X' });
  });

  it('serialises the review state — due at the campaign end when that comes first', () => {
    const row = serialiseKnowledgeTableRow('bonuses', BONUS, new Date('2026-10-21T00:00:00Z'));
    expect(row).toMatchObject({
      reviewed_at: '2026-10-01T09:00:00.000Z',
      review_due_at: '2026-10-20T21:00:00.000Z',
      stale: true,
      min_deposit: 100.5,
    });
  });

  it('trims texts, stores a blank optional text as null, and names the fields no write knows', () => {
    expect(
      normaliseKnowledgeTableInput('rules', {
        key: ' min_age ',
        unit: '   ',
        numeric_value: 18,
        brand_ids: [' a '],
        colour: ' x ',
      }),
    ).toEqual({ key: 'min_age', unit: null, numeric_value: 18, brand_ids: ['a'], colour: ' x ' });
    expect(
      unknownKnowledgeTableFields('rules', { key: 'a', colour: 'x', source: 'manual' }),
    ).toEqual(['colour', 'source']);
  });
});
