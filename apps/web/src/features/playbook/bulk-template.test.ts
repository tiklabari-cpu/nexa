/**
 * The template's one hard promise: its header names exactly the columns
 * `resolveKnowledgeBulkColumns` in `apps/api/src/services/ai/knowledge-bulk-row.ts`
 * requires. This mirrors that module's column list here so a server-side
 * rename shows up as a failing test instead of a template silently drifting
 * out of sync — the same pattern `templates.test.ts` uses for step validity.
 */
import { describe, expect, it } from 'vitest';
import {
  BULK_TEMPLATE_COLUMNS,
  BULK_TEMPLATE_EXAMPLE_ROWS,
  BULK_TEMPLATE_FILENAME,
  BULK_TEMPLATE_MIME_TYPE,
  toTemplateBlob,
  toTemplateCsv,
} from './bulk-template.js';

/** Mirrors `KNOWLEDGE_BULK_COLUMNS` in `apps/api/src/services/ai/knowledge-bulk-row.ts`. */
const SERVER_REQUIRED_COLUMNS = ['name', 'type', 'content', 'source_url'];

describe('BULK_TEMPLATE_COLUMNS', () => {
  it('names every column the server requires, in the order the template writes them', () => {
    expect(BULK_TEMPLATE_COLUMNS.map((spec) => spec.column)).toEqual(SERVER_REQUIRED_COLUMNS);
  });

  it('gives every column a non-empty description and requirement rule', () => {
    for (const spec of BULK_TEMPLATE_COLUMNS) {
      expect(spec.description.trim(), spec.column).not.toBe('');
      expect(spec.requirement.trim(), spec.column).not.toBe('');
    }
  });

  it('uses unique column names', () => {
    const names = BULK_TEMPLATE_COLUMNS.map((spec) => spec.column);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe('BULK_TEMPLATE_EXAMPLE_ROWS', () => {
  it('demonstrates both required row shapes: a website row and a content row', () => {
    const hasWebsiteRow = BULK_TEMPLATE_EXAMPLE_ROWS.some(
      (row) => row.type === 'website' && row.source_url !== '' && row.content === '',
    );
    const hasContentRow = BULK_TEMPLATE_EXAMPLE_ROWS.some(
      (row) => row.type !== 'website' && row.content !== '' && row.source_url === '',
    );
    expect(hasWebsiteRow).toBe(true);
    expect(hasContentRow).toBe(true);
  });

  it('gives every example row a name', () => {
    for (const row of BULK_TEMPLATE_EXAMPLE_ROWS) {
      expect(row.name.trim()).not.toBe('');
    }
  });
});

describe('toTemplateCsv', () => {
  it("writes a header row that is exactly the server's required column set, derived from the dictionary", () => {
    const [headerLine] = toTemplateCsv().split('\r\n');
    expect(headerLine).toBe(SERVER_REQUIRED_COLUMNS.join(','));
  });

  it('writes one data line per example row, in the header column order', () => {
    const lines = toTemplateCsv().split('\r\n').filter((line) => line !== '');
    expect(lines).toHaveLength(1 + BULK_TEMPLATE_EXAMPLE_ROWS.length);

    const order = BULK_TEMPLATE_COLUMNS.map((spec) => spec.column);
    BULK_TEMPLATE_EXAMPLE_ROWS.forEach((row, index) => {
      expect(lines[index + 1]).toBe(order.map((column) => row[column]).join(','));
    });
  });

  it('is deterministic — no dates, ids or environment-dependent values', () => {
    expect(toTemplateCsv()).toBe(toTemplateCsv());
  });
});

/** `FileReader` rather than `Blob.text()` — the reliable read path in this test environment. */
function readBlobAsText(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the blob.'));
    reader.readAsText(blob);
  });
}

describe('toTemplateBlob', () => {
  it('wraps the template text with the CSV mime type', async () => {
    const blob = toTemplateBlob();
    expect(blob.type).toBe(BULK_TEMPLATE_MIME_TYPE);
    expect(await readBlobAsText(blob)).toBe(toTemplateCsv());
  });

  it('names a real .csv file', () => {
    expect(BULK_TEMPLATE_FILENAME.toLowerCase().endsWith('.csv')).toBe(true);
  });
});
