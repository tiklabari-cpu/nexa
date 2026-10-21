/**
 * A structured table as CSV, both ways (tm 310.2 · AI-13 §8; the bulk import
 * pattern, `knowledge-bulk-row.ts`).
 *
 * The columns are the writable fields — the meta fields, then
 * `KNOWLEDGE_TABLE_COLUMNS` — named as the fields are, so an exported file
 * imports back. A cell is spelled by its field's kind: text as written, a
 * number with a `.` decimal point, `true`/`false`, a list's items joined by
 * `|`, a JSON field as its JSON. A blank cell is "not given": the column
 * default on a new row.
 *
 * **Column presence is file-level, cell content row-level.** A header naming
 * a column no table field has, naming one twice, or missing one the table
 * requires refuses the file (nothing can be salvaged from it); a cell that
 * does not parse is that row's problem (`invalid` on its field), and the rest
 * of the file still gets a verdict.
 *
 * `parseCsv` guards formulas on the way in with a leading `'`; here the guard
 * comes off again — the values are typed and validated, the row's text is
 * what the AI quotes, and the export guards every cell again on the way out
 * (`toCsv`) — so `-5` is the number it says and an export imports back as it
 * was.
 */
import {
  KNOWLEDGE_TABLE_REQUIRED_FIELDS,
  type KnowledgeTable,
  type KnowledgeTableFieldKind,
  type KnowledgeTableProblem,
} from '@siyahtus/types';
import type { CsvLimits } from '../../lib/csv-import.js';
import { toCsv, type CsvCell } from '../../routes/reports-export.js';
import { knowledgeTableWriteShapeOf, knowledgeTableWritableFields } from './records.js';
import type { KnowledgeTableRecords } from './rows.js';

/**
 * The import budget (NFR-S8): a table's whole row ceiling in one file, cells
 * up to a bonus's terms, and the bytes those can take.
 */
export const KNOWLEDGE_TABLE_CSV_LIMITS: CsvLimits = {
  maxRows: 500,
  maxCellChars: 20_000,
  maxBytes: 5_242_880, // 5 MiB
};

/** Separates a list field's items in a cell. */
export const KNOWLEDGE_TABLE_CSV_LIST_SEPARATOR = '|';

/** Why a header was refused. */
export class KnowledgeTableCsvHeaderError extends Error {
  readonly reason: 'csv_header_unknown' | 'csv_header_repeated' | 'csv_header_missing';
  readonly columns: string[];

  constructor(reason: KnowledgeTableCsvHeaderError['reason'], columns: string[], detail: string) {
    super(detail);
    this.name = 'KnowledgeTableCsvHeaderError';
    this.reason = reason;
    this.columns = columns;
  }
}

/** The formula guard `parseCsv` put on a cell, taken off. */
function unguard(cell: string): string {
  return /^'[=+\-@\t\r]/.test(cell) ? cell.slice(1) : cell;
}

/** `header`'s cell for each column, by field — or a refusal of the whole file. */
export function resolveKnowledgeTableColumns(
  table: KnowledgeTable,
  header: readonly string[],
): Map<string, number> {
  const kinds = knowledgeTableWritableFields(table);
  const columns = new Map<string, number>();
  const unknown: string[] = [];
  const repeated: string[] = [];
  header.forEach((cell, index) => {
    const name = unguard(cell).trim().toLowerCase();
    if (name === '') return;
    if (!kinds.has(name)) unknown.push(name);
    else if (columns.has(name)) repeated.push(name);
    else columns.set(name, index);
  });
  if (unknown.length > 0) {
    throw new KnowledgeTableCsvHeaderError(
      'csv_header_unknown',
      unknown,
      `no field of this table is called ${unknown.join(', ')}.`,
    );
  }
  if (repeated.length > 0) {
    throw new KnowledgeTableCsvHeaderError(
      'csv_header_repeated',
      repeated,
      `the column ${repeated.join(', ')} is named twice.`,
    );
  }
  const missing = KNOWLEDGE_TABLE_REQUIRED_FIELDS[table].filter((field) => !columns.has(field));
  if (missing.length > 0) {
    throw new KnowledgeTableCsvHeaderError(
      'csv_header_missing',
      missing,
      `the file has no ${missing.join(', ')} column.`,
    );
  }
  return columns;
}

const NUMBER = /^-?\d+(\.\d+)?$/;
const TRUE = new Set(['true', 'yes', '1', 'evet']);
const FALSE = new Set(['false', 'no', '0', 'hayır', 'hayir']);

/**
 * One cell as its field's value. A cell that is no value of its kind is kept
 * as the text it is, so the validator calls it `invalid` — except a JSON cell
 * that does not parse, which is reported here.
 */
function cellValue(
  kind: KnowledgeTableFieldKind,
  raw: string,
): { value: unknown } | { problem: true } {
  const cell = unguard(raw);
  const trimmed = cell.trim();
  if (trimmed === '') return { value: kind === 'list' ? [] : undefined };
  switch (kind) {
    case 'number':
      return { value: NUMBER.test(trimmed) ? Number(trimmed) : trimmed };
    case 'boolean': {
      const lowered = trimmed.toLocaleLowerCase('tr-TR');
      if (TRUE.has(lowered)) return { value: true };
      if (FALSE.has(lowered)) return { value: false };
      return { value: trimmed };
    }
    case 'list':
      return {
        value: trimmed
          .split(KNOWLEDGE_TABLE_CSV_LIST_SEPARATOR)
          .map((item) => item.trim())
          .filter((item) => item !== ''),
      };
    case 'json':
      try {
        return { value: JSON.parse(trimmed) as unknown };
      } catch {
        return { problem: true };
      }
    default:
      return { value: cell };
  }
}

/** One data row as a write's body, and the cells that did not parse. */
export function mapKnowledgeTableCsvRow(
  table: KnowledgeTable,
  columns: ReadonlyMap<string, number>,
  cells: readonly string[],
): { row: Record<string, unknown>; problems: KnowledgeTableProblem[] } {
  const kinds = knowledgeTableWritableFields(table);
  const row: Record<string, unknown> = {};
  const problems: KnowledgeTableProblem[] = [];
  for (const [field, index] of columns) {
    const parsed = cellValue(kinds.get(field)!, cells[index] ?? '');
    if ('problem' in parsed) problems.push({ field, code: 'invalid' });
    else if (parsed.value !== undefined) row[field] = parsed.value;
  }
  return { row, problems };
}

/** A field's value as a cell. */
function exportCell(kind: KnowledgeTableFieldKind, value: unknown): CsvCell {
  if (value === null || value === undefined) return null;
  switch (kind) {
    case 'list':
      return (value as unknown[]).join(KNOWLEDGE_TABLE_CSV_LIST_SEPARATOR);
    case 'json':
      return JSON.stringify(value);
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      return value as number;
    default:
      return String(value);
  }
}

/** The table as CSV: every writable column, one row per record, oldest first. */
export function knowledgeTableCsv<T extends KnowledgeTable>(
  table: T,
  records: ReadonlyArray<KnowledgeTableRecords[T]>,
): string {
  const kinds = [...knowledgeTableWritableFields(table)];
  return toCsv(
    kinds.map(([field]) => field),
    records.map((record) => {
      const shape = knowledgeTableWriteShapeOf(table, record);
      return kinds.map(([field, kind]) => exportCell(kind, shape[field]));
    }),
  );
}
