/**
 * Example CSV template for bulk knowledge-base import (FR-MOD-06.3.2).
 *
 * A deterministic, local catalogue — no external service — so the "Download
 * template" button produces the same file on every machine and in every test.
 * The header `toTemplateCsv()` writes is *derived* from
 * {@link BULK_TEMPLATE_COLUMNS} rather than typed out separately, so a column
 * added to the dictionary changes the downloadable file automatically instead
 * of needing two edits kept in sync by hand.
 *
 * The column set and the per-row requirement rule mirror
 * `KNOWLEDGE_BULK_COLUMNS` / `resolveKnowledgeBulkColumns` in
 * `apps/api/src/services/ai/knowledge-bulk-row.ts` field for field.
 * `apps/web` is deliberately decoupled from `apps/api` (the same reasoning as
 * `templates.ts`), so this is a mirror, not an import — `bulk-template.test.ts`
 * pins the header to the column set the server actually expects, the way
 * `templates.test.ts` pins template steps to `@nexa/ai-mock`'s validator.
 *
 * Deliberately NOT here: parsing a CSV back — `bulk-file.ts` only reads a
 * selected file to text, and a chosen file's rows are previewed by the
 * server's `dry_run`, not by a client-side parser (06.3.2-bulk assumption 5).
 */
import { KNOWLEDGE_TYPES } from './knowledge-tabs.js';

export type BulkTemplateColumn = 'name' | 'type' | 'content' | 'source_url';

export interface BulkTemplateColumnSpec {
  readonly column: BulkTemplateColumn;
  readonly description: string;
  /** Human-readable requirement rule, shown next to the column in the UI. */
  readonly requirement: string;
}

/** The four columns the importer understands, in the order the template writes them. */
export const BULK_TEMPLATE_COLUMNS: readonly BulkTemplateColumnSpec[] = [
  {
    column: 'name',
    description: 'The title shown for this source in the knowledge list.',
    requirement: 'Required for every row.',
  },
  {
    column: 'type',
    description: `One of ${KNOWLEDGE_TYPES.join(', ')}.`,
    requirement: 'Optional — a blank cell defaults to "article".',
  },
  {
    column: 'content',
    description: 'The text the AI indexes and answers from.',
    requirement: 'Required unless type is "website".',
  },
  {
    column: 'source_url',
    description: 'The page to crawl for a website row.',
    requirement: 'Required when type is "website"; ignored for every other type.',
  },
];

type ExampleRow = Readonly<Record<BulkTemplateColumn, string>>;

/**
 * Two rows, because the four columns encode a choice: a `website` row needs
 * `source_url` and no `content`, every other row needs `content` and no
 * `source_url`. One example row could only ever show one side of that.
 */
export const BULK_TEMPLATE_EXAMPLE_ROWS: readonly ExampleRow[] = [
  {
    name: 'Return policy',
    type: 'article',
    content: 'Items can be returned within 30 days of delivery for a full refund.',
    source_url: '',
  },
  {
    name: 'Pricing page',
    type: 'website',
    content: '',
    source_url: 'https://example.com/pricing',
  },
];

export const BULK_TEMPLATE_FILENAME = 'knowledge-bulk-import-template.csv';
export const BULK_TEMPLATE_MIME_TYPE = 'text/csv';

/** RFC 4180 field quoting: only cells holding a comma, quote or line break need it. */
function escapeCsvCell(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * The downloadable template text: a header row naming every
 * {@link BULK_TEMPLATE_COLUMNS} column, then one line per
 * {@link BULK_TEMPLATE_EXAMPLE_ROWS} entry — in the same column order, so a
 * cell always lands under the header it belongs to.
 */
export function toTemplateCsv(): string {
  const order = BULK_TEMPLATE_COLUMNS.map((spec) => spec.column);
  const lines = [order, ...BULK_TEMPLATE_EXAMPLE_ROWS.map((row) => order.map((column) => row[column]))];
  return lines.map((cells) => cells.map(escapeCsvCell).join(',')).join('\r\n') + '\r\n';
}

/** The template as a downloadable file, ready for an `<a download>` / `URL.createObjectURL` link. */
export function toTemplateBlob(): Blob {
  return new Blob([toTemplateCsv()], { type: BULK_TEMPLATE_MIME_TYPE });
}
