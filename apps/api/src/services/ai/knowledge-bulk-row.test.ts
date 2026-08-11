import { describe, expect, it } from 'vitest';
import {
  isKnowledgeBulkHeaderError,
  type KnowledgeBulkColumnIndex,
  type KnowledgeBulkHeaderError,
  mapKnowledgeBulkRow,
  mapKnowledgeBulkRows,
  resolveKnowledgeBulkColumns,
} from './knowledge-bulk-row.js';

/**
 * FR-MOD-06.3.2 — mapping a bulk-import CSV row to the shape
 * `createSourceBody` (routes/playbook.ts) accepts for one JSON source.
 *
 * Negatives lead: a wrong row silently imported becomes a wrong AI answer,
 * so every way a row can fail its own type's requirement is pinned before
 * the positive "a mixed file gets a verdict per row" case.
 */

const HEADER = ['name', 'type', 'content', 'source_url'];
const COLUMNS: KnowledgeBulkColumnIndex = resolveKnowledgeBulkColumns(HEADER);

function headerErrorOf(run: () => unknown): KnowledgeBulkHeaderError {
  try {
    run();
  } catch (error) {
    if (isKnowledgeBulkHeaderError(error)) return error;
    throw error;
  }
  throw new Error('expected a KnowledgeBulkHeaderError, but the call returned');
}

describe('resolveKnowledgeBulkColumns', () => {
  it('maps every required column regardless of case, surrounding whitespace or order', () => {
    const columns = resolveKnowledgeBulkColumns([' Source_URL ', 'NAME', 'Type', 'Content']);
    expect(columns).toEqual({ source_url: 0, name: 1, type: 2, content: 3 });
  });

  it('ignores an unrecognised extra column instead of rejecting the file', () => {
    const columns = resolveKnowledgeBulkColumns([
      'name',
      'type',
      'content',
      'source_url',
      'internal note',
    ]);
    expect(columns).toEqual({ name: 0, type: 1, content: 2, source_url: 3 });
  });

  it('refuses the whole file when a required column is missing from the header, naming it', () => {
    const error = headerErrorOf(() => resolveKnowledgeBulkColumns(['name', 'type', 'content']));
    expect(error.missing).toEqual(['source_url']);
  });

  it('reports every missing column, not just the first', () => {
    const error = headerErrorOf(() => resolveKnowledgeBulkColumns(['name']));
    expect(error.missing).toEqual(['type', 'content', 'source_url']);
  });
});

describe('mapKnowledgeBulkRow', () => {
  it('rejects a type outside website/file/article/faq', () => {
    const result = mapKnowledgeBulkRow(COLUMNS, ['Onboarding', 'workflow', 'text', '']);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.field).toBe('type');
  });

  it('rejects a website row with a blank source_url', () => {
    const result = mapKnowledgeBulkRow(COLUMNS, ['Docs site', 'website', '', '']);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.field).toBe('source_url');
  });

  it('rejects a non-website row with blank content', () => {
    const result = mapKnowledgeBulkRow(COLUMNS, ['Refund policy', 'article', '', '']);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.field).toBe('content');
  });

  it('rejects content over the 100,000-character cap', () => {
    const result = mapKnowledgeBulkRow(COLUMNS, ['Huge doc', 'article', 'a'.repeat(100_001), '']);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.field).toBe('content');
  });

  it('rejects a blank name', () => {
    const result = mapKnowledgeBulkRow(COLUMNS, ['', 'article', 'some text', '']);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.field).toBe('name');
  });

  it('defaults a blank type to article, same as createSourceBody', () => {
    const result = mapKnowledgeBulkRow(COLUMNS, ['Shipping FAQ', '', 'we ship worldwide', '']);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.type).toBe('article');
  });

  it('accepts a website row and drops the unused content field', () => {
    const result = mapKnowledgeBulkRow(COLUMNS, [
      'Pricing page',
      'website',
      '',
      'https://example.com/pricing',
    ]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({
        name: 'Pricing page',
        type: 'website',
        source_url: 'https://example.com/pricing',
      });
    }
  });

  it('still maps the recognised columns when an unknown extra column is present', () => {
    const columns = resolveKnowledgeBulkColumns([
      'name',
      'type',
      'content',
      'source_url',
      'internal note',
    ]);
    const result = mapKnowledgeBulkRow(columns, [
      'FAQ item',
      'faq',
      'we reply within 24h',
      '',
      'reviewed by CS',
    ]);
    expect(result.ok).toBe(true);
    if (result.ok)
      expect(result.value).toEqual({
        name: 'FAQ item',
        type: 'faq',
        content: 'we reply within 24h',
      });
  });
});

describe('mapKnowledgeBulkRows', () => {
  it('validates every row independently, preserving order and 1-based line numbers', () => {
    const rows = [
      ['Website', 'website', '', 'https://example.com'],
      ['Bad type', 'workflow', 'text', ''],
      ['Article', 'article', 'body text', ''],
      ['No URL', 'website', '', ''],
      ['FAQ', 'faq', 'answer', ''],
    ];

    const results = mapKnowledgeBulkRows({ header: HEADER, rows });

    expect(results.map((r) => r.line)).toEqual([1, 2, 3, 4, 5]);
    expect(results.map((r) => r.ok)).toEqual([true, false, true, false, true]);
    const failed = results.filter(
      (r): r is Extract<(typeof results)[number], { ok: false }> => !r.ok,
    );
    expect(failed.map((r) => r.error.field)).toEqual(['type', 'source_url']);
  });

  it('throws a file-level error instead of a per-row one when a required column is absent', () => {
    const error = headerErrorOf(() =>
      mapKnowledgeBulkRows({ header: ['name', 'type', 'content'], rows: [['A', 'article', 'x']] }),
    );
    expect(error.missing).toEqual(['source_url']);
  });
});
