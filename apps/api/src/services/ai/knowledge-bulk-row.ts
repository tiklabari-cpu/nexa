/**
 * CSV row schema for bulk knowledge-base import (FR-MOD-06.3.2).
 *
 * `lib/csv-import.ts` turns file text into `{ header, rows }` and has no
 * opinion on what the columns mean. This module is the next step: it maps a
 * header to the four columns the importer understands and validates one row
 * at a time against the same rule `routes/playbook.ts`'s `createSourceBody`
 * applies to a single JSON source — a website row needs `source_url`, every
 * other kind needs `content` — so a row that would be rejected by the
 * single-source endpoint is rejected here too, before it ever reaches it.
 *
 * Two decisions carry the module:
 *
 * 1. **Column presence is file-level, column content is row-level.** A CSV
 *    missing the `source_url` column entirely cannot express a website row no
 *    matter what any row contains, so that is refused for the whole file
 *    before a single row is looked at. A row with an invalid `type` or a
 *    missing value the row's own type requires is refused on its own — the
 *    rest of the file still gets a verdict, because a spreadsheet with 500
 *    correct rows and one typo should not lose all 500 to a single mistake.
 * 2. **No `content`/`source_url` cell reads as "invalid", only as "absent".**
 *    A blank cell means the admin left it out, not that they typed an empty
 *    string on purpose, so it is treated as `undefined` before validation —
 *    the same way `createSourceBody` treats an absent JSON key. `type` gets
 *    the same treatment so a blank cell defaults to `article`, mirroring
 *    `createSourceBody`'s `.default('article')`.
 *
 * Deliberately NOT here: writing a validated row to the database, tenant/
 * ai_agent ownership, indexing, or crawling a `website` row's URL (06.3.2-bulk-c
 * and -g own those) — this module only decides whether a row's *shape* is one
 * `KnowledgeService` could accept.
 */
import { z } from 'zod';

/** Mirrors `createSourceBody`'s `type` enum in `routes/playbook.ts`. */
export const KNOWLEDGE_SOURCE_TYPES = ['website', 'file', 'article', 'faq'] as const;
export type KnowledgeSourceType = (typeof KNOWLEDGE_SOURCE_TYPES)[number];

/** The columns a bulk-import file must name in its header, in no particular order. */
export const KNOWLEDGE_BULK_COLUMNS = ['name', 'type', 'content', 'source_url'] as const;
export type KnowledgeBulkColumn = (typeof KNOWLEDGE_BULK_COLUMNS)[number];

/** A column index for every {@link KNOWLEDGE_BULK_COLUMNS} entry. */
export type KnowledgeBulkColumnIndex = Readonly<Record<KnowledgeBulkColumn, number>>;

/** A row validated and defaulted, ready for `KnowledgeService` (minus `ai_agent_id`, which the endpoint supplies, not the file). */
export interface KnowledgeBulkRowValue {
  readonly name: string;
  readonly type: KnowledgeSourceType;
  readonly content?: string;
  readonly source_url?: string;
}

/** Which field failed and why, positioned by name rather than by column index — a CSV column can move, a field name cannot. */
export interface KnowledgeBulkRowFieldError {
  readonly field: string;
  readonly message: string;
}

export type KnowledgeBulkRowResult =
  | { readonly line: number; readonly ok: true; readonly value: KnowledgeBulkRowValue }
  | { readonly line: number; readonly ok: false; readonly error: KnowledgeBulkRowFieldError };

/** The whole file is refused: a required column is missing from the header, so no row in it could ever be mapped. */
export class KnowledgeBulkHeaderError extends Error {
  readonly missing: readonly KnowledgeBulkColumn[];

  constructor(missing: readonly KnowledgeBulkColumn[]) {
    super(`missing required column(s): ${missing.join(', ')}`);
    this.name = 'KnowledgeBulkHeaderError';
    this.missing = missing;
  }
}

/** True when `error` came from {@link resolveKnowledgeBulkColumns} — narrows for a caller's `catch`. */
export function isKnowledgeBulkHeaderError(error: unknown): error is KnowledgeBulkHeaderError {
  return error instanceof KnowledgeBulkHeaderError;
}

/**
 * Trim, lower-case and strip a stray BOM from a header cell before matching it
 * against {@link KNOWLEDGE_BULK_COLUMNS}. `csv-import.ts` already removes a BOM
 * at the very start of the file; this also covers one glued to the first
 * header cell by an editor that writes the mark without it counting as the
 * first byte of the document.
 */
const BOM = String.fromCharCode(0xfeff);

function normalizeHeaderCell(cell: string): string {
  return cell.split(BOM).join('').trim().toLowerCase();
}

/**
 * Maps each required column name to its index in `header`. Header order is
 * not fixed and extra columns the importer does not recognise are ignored,
 * not an error — an admin's spreadsheet may carry notes columns of their own.
 * Throws {@link KnowledgeBulkHeaderError} when one or more required columns
 * cannot be found by name.
 */
export function resolveKnowledgeBulkColumns(header: readonly string[]): KnowledgeBulkColumnIndex {
  const normalized = header.map(normalizeHeaderCell);
  const columns = {} as Record<KnowledgeBulkColumn, number>;
  const missing: KnowledgeBulkColumn[] = [];

  for (const column of KNOWLEDGE_BULK_COLUMNS) {
    const index = normalized.indexOf(column);
    if (index === -1) missing.push(column);
    else columns[column] = index;
  }

  if (missing.length > 0) throw new KnowledgeBulkHeaderError(missing);
  return columns;
}

/** A blank cell (after trimming) is treated as absent, not as an empty value. */
function blankToUndefined(value: string): string | undefined {
  return value.trim() === '' ? undefined : value;
}

/**
 * Row validation, mirroring `createSourceBody` in `routes/playbook.ts` field
 * for field: same length caps, same enum, same "website needs source_url,
 * everything else needs content" rule via `superRefine`. `ai_agent_id` has no
 * counterpart here — it is not a column, it is the target the bulk endpoint
 * imports into.
 */
const knowledgeBulkRowSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    type: z.enum(KNOWLEDGE_SOURCE_TYPES).default('article'),
    content: z.string().trim().min(1).max(100_000).optional(),
    source_url: z.string().trim().min(1).max(2048).optional(),
  })
  .superRefine((row, ctx) => {
    if (row.type === 'website') {
      if (!row.source_url) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['source_url'], message: 'a website source needs a URL to crawl' });
      }
    } else if (!row.content) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['content'], message: 'content is required' });
    }
  });

/**
 * Validates one data row against the resolved column map. Never throws — a
 * bad row is reported through the return value so the caller can keep going
 * to the next row.
 */
export function mapKnowledgeBulkRow(
  columns: KnowledgeBulkColumnIndex,
  row: readonly string[],
): { ok: true; value: KnowledgeBulkRowValue } | { ok: false; error: KnowledgeBulkRowFieldError } {
  const cell = (column: KnowledgeBulkColumn): string => row[columns[column]] ?? '';

  const result = knowledgeBulkRowSchema.safeParse({
    name: cell('name'),
    type: blankToUndefined(cell('type')),
    content: blankToUndefined(cell('content')),
    source_url: blankToUndefined(cell('source_url')),
  });

  if (!result.success) {
    const issue = result.error.issues[0];
    return { ok: false, error: { field: issue?.path.join('.') || 'name', message: issue?.message ?? 'Invalid row.' } };
  }
  return { ok: true, value: result.data };
}

/**
 * Validates every data row of a parsed CSV document. `line` is the row's
 * 1-based position among data rows — the same "index, not physical file
 * line" convention `parseCsv` itself uses, since a quoted field spanning
 * several physical lines makes a true line number ambiguous.
 *
 * Throws {@link KnowledgeBulkHeaderError} up front when a required column is
 * missing; a document with a valid header always returns one result per row,
 * in row order, and never stops at the first failing row.
 */
export function mapKnowledgeBulkRows(document: {
  readonly header: readonly string[];
  readonly rows: readonly string[][];
}): KnowledgeBulkRowResult[] {
  const columns = resolveKnowledgeBulkColumns(document.header);
  return document.rows.map((row, index) => ({ line: index + 1, ...mapKnowledgeBulkRow(columns, row) }));
}
