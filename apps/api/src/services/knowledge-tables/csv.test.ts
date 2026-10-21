/**
 * A structured table as CSV (tm 310.2 · AI-13 §8): what a header must say,
 * how each kind of cell reads, and that an export reads back.
 */
import { describe, expect, it } from 'vitest';
import { parseCsv } from '../../lib/csv-import.js';
import {
  KNOWLEDGE_TABLE_CSV_LIMITS,
  KnowledgeTableCsvHeaderError,
  knowledgeTableCsv,
  mapKnowledgeTableCsvRow,
  resolveKnowledgeTableColumns,
} from './csv.js';
import type { KnowledgeTableRecords } from './rows.js';

function headerError(header: string[]): KnowledgeTableCsvHeaderError {
  try {
    resolveKnowledgeTableColumns('payment_methods', header);
  } catch (error) {
    if (error instanceof KnowledgeTableCsvHeaderError) return error;
    throw error;
  }
  throw new Error('the header was accepted');
}

/** One data row of `csv` through the parser and the mapper, as the import reads it. */
function read(csv: string) {
  const document = parseCsv(csv, KNOWLEDGE_TABLE_CSV_LIMITS);
  const columns = resolveKnowledgeTableColumns('rules', document.header);
  return mapKnowledgeTableCsvRow('rules', columns, document.rows[0]!);
}

describe('knowledge table CSV (AI-13 §8 · tm 310.2)', () => {
  it('refuses a header naming an unknown column, a column twice, or no required one', () => {
    expect(headerError(['name', 'direction', 'Colour'])).toMatchObject({
      reason: 'csv_header_unknown',
      columns: ['colour'],
    });
    expect(headerError(['name', 'NAME', 'direction'])).toMatchObject({
      reason: 'csv_header_repeated',
      columns: ['name'],
    });
    expect(headerError(['name', 'min_amount'])).toMatchObject({
      reason: 'csv_header_missing',
      columns: ['direction'],
    });
    // Case, spaces and blank header cells are forgiven; the column order is the file's.
    const columns = resolveKnowledgeTableColumns('payment_methods', [' Direction ', '', 'name']);
    expect([...columns]).toEqual([
      ['direction', 0],
      ['name', 2],
    ]);
  });

  it('reads each kind of cell; a cell that is no value of its kind is left for the validator', () => {
    const document = parseCsv(
      [
        'name,direction,min_amount,max_amount,active,receipt_required,third_party_allowed,aliases,networks,working_hours,common_errors',
        'Papara,deposit,100.5,abc,EVET,0,maybe,PPR| Papara TL |,,,[]',
      ].join('\n'),
      KNOWLEDGE_TABLE_CSV_LIMITS,
    );
    const columns = resolveKnowledgeTableColumns('payment_methods', document.header);
    expect(mapKnowledgeTableCsvRow('payment_methods', columns, document.rows[0]!)).toEqual({
      row: {
        name: 'Papara',
        direction: 'deposit',
        min_amount: 100.5,
        max_amount: 'abc',
        active: true,
        receipt_required: false,
        third_party_allowed: 'maybe',
        aliases: ['PPR', 'Papara TL'],
        networks: [],
        common_errors: [],
      },
      problems: [],
    });
    const broken = parseCsv(
      'name,direction,working_hours\nX,deposit,{nope',
      KNOWLEDGE_TABLE_CSV_LIMITS,
    );
    expect(
      mapKnowledgeTableCsvRow(
        'payment_methods',
        resolveKnowledgeTableColumns('payment_methods', broken.header),
        broken.rows[0]!,
      ).problems,
    ).toEqual([{ field: 'working_hours', code: 'invalid' }]);
  });

  it("takes parseCsv's formula guard off again, so a negative number and a dash-led text are what they say", () => {
    expect(read('key,title,numeric_value,value_text\nk,=Başlık,-5.25,-50 TL').row).toEqual({
      key: 'k',
      title: '=Başlık',
      numeric_value: -5.25,
      value_text: '-50 TL',
    });
  });

  it('exports every writable column, guarded, in a shape the import reads back', () => {
    const at = new Date('2026-10-01T09:00:00Z');
    const rule: KnowledgeTableRecords['rules'] = {
      id: '6f1c1d52-4c8b-4f3e-9a51-0d6f7b1c2a10',
      licenseId: 1n,
      brandIds: ['0b8e5f9a-1c2d-4e3f-8a9b-0c1d2e3f4a5b'],
      ownerId: null,
      reviewedAt: at,
      reviewIntervalDays: 90,
      source: 'manual',
      createdBy: null,
      updatedBy: null,
      createdAt: at,
      updatedAt: at,
      key: 'max_bet',
      category: 'betting',
      title: '=En yüksek, bahis',
      valueText: null,
      numericValue: null,
      unit: null,
      description: 'İki "tırnak"\nve satır',
    } as unknown as KnowledgeTableRecords['rules'];
    const csv = knowledgeTableCsv('rules', [rule]);
    expect(csv.split('\r\n')[0]).toBe(
      'brand_ids,owner_id,review_interval_days,key,category,title,value_text,numeric_value,unit,description',
    );
    expect(csv).toContain(`"'=En yüksek, bahis"`);
    expect(read(csv).row).toEqual({
      brand_ids: ['0b8e5f9a-1c2d-4e3f-8a9b-0c1d2e3f4a5b'],
      review_interval_days: 90,
      key: 'max_bet',
      category: 'betting',
      title: '=En yüksek, bahis',
      description: 'İki "tırnak"\nve satır',
    });
  });
});
