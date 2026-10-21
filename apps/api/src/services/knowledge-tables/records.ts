/**
 * A structured-table row between its three spellings (tm 310.2 · AI-13): the
 * Prisma record (camelCase, `Decimal`, `Date`), the fields `@siyahtus/types`
 * validates and renders (snake_case, numbers, ISO strings), and the contract's
 * reply (`KbPaymentMethod`, …). One column list — `KNOWLEDGE_TABLE_COLUMNS` —
 * drives all three, so a field cannot reach one spelling and miss another.
 */
import { Prisma } from '@prisma/client';
import {
  KNOWLEDGE_TABLE_COLUMNS,
  knowledgeTableRowReviewDueAt,
  type KnowledgeTable,
  type KnowledgeTableFields,
  type KnowledgeTableFieldKind,
} from '@siyahtus/types';
import type { KnowledgeTableRecords } from './rows.js';

/** `min_amount` → `minAmount`: a field's Prisma key. */
export function knowledgeTableColumnKey(field: string): string {
  return field.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
}

/**
 * The fields a write may name: the meta fields (`KNOWLEDGE_TABLE_META_WRITE_FIELDS`),
 * then the table's own.
 */
export function knowledgeTableWritableFields(
  table: KnowledgeTable,
): ReadonlyMap<string, KnowledgeTableFieldKind> {
  return new Map<string, KnowledgeTableFieldKind>([
    ['brand_ids', 'list'],
    ['owner_id', 'text'],
    ['review_interval_days', 'number'],
    ...KNOWLEDGE_TABLE_COLUMNS[table],
  ]);
}

/** The fields that are campaign moments — written as `Date`s. */
const MOMENT_FIELDS = new Set(['active_from', 'active_to']);

/** The JSON fields a row may hold null in (the others default to `[]`). */
const NULLABLE_JSON_FIELDS = new Set(['working_hours']);

/** A stored value as the fields spell it. */
function fieldValue(value: unknown): unknown {
  if (value instanceof Prisma.Decimal) return value.toNumber();
  if (value instanceof Date) return value.toISOString();
  return value;
}

type AnyRecord = KnowledgeTableRecords[KnowledgeTable];

/** The row's own fields, as `@siyahtus/types` validates and renders them. */
export function knowledgeTableFieldsOf<T extends KnowledgeTable>(
  table: T,
  record: KnowledgeTableRecords[T],
): KnowledgeTableFields[T] {
  const stored = record as unknown as Record<string, unknown>;
  const fields: Record<string, unknown> = {};
  for (const [field] of KNOWLEDGE_TABLE_COLUMNS[table]) {
    fields[field] = fieldValue(stored[knowledgeTableColumnKey(field)]);
  }
  return fields as unknown as KnowledgeTableFields[T];
}

/** The fields and the writable meta fields — what an edit is merged over and validated as. */
export function knowledgeTableWriteShapeOf(
  table: KnowledgeTable,
  record: AnyRecord,
): Record<string, unknown> {
  return {
    brand_ids: record.brandIds,
    owner_id: record.ownerId,
    review_interval_days: record.reviewIntervalDays,
    ...(knowledgeTableFieldsOf(table, record) as unknown as Record<string, unknown>),
  };
}

/**
 * What a write stores, as Prisma data: the fields `input` names, and only
 * those (an omitted one keeps its value, or the column default on a create).
 * `input` is already normalised and validated.
 */
export function knowledgeTableDataOf(
  table: KnowledgeTable,
  input: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  for (const field of knowledgeTableWritableFields(table).keys()) {
    if (!(field in input) || input[field] === undefined) continue;
    const value = input[field];
    let stored: unknown = value;
    if (value === null && NULLABLE_JSON_FIELDS.has(field)) stored = Prisma.DbNull;
    else if (MOMENT_FIELDS.has(field) && typeof value === 'string') stored = new Date(value);
    data[knowledgeTableColumnKey(field)] = stored;
  }
  return data;
}

/**
 * A write's body as the validators read it: strings trimmed, a blank optional
 * text as null ("not given" — the validators' rule, said once more so the row
 * stores null rather than ''), list items trimmed. JSON fields as given.
 */
export function normaliseKnowledgeTableInput(
  table: KnowledgeTable,
  input: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const kinds = knowledgeTableWritableFields(table);
  const out: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(input)) {
    const kind = kinds.get(field);
    if (kind === 'text' && typeof value === 'string') {
      out[field] = value.trim() === '' ? null : value.trim();
    } else if (kind === 'list' && Array.isArray(value)) {
      out[field] = value.map((item) => (typeof item === 'string' ? item.trim() : item));
    } else {
      out[field] = value;
    }
  }
  return out;
}

/** The fields of `input` no table write knows — refused, not ignored. */
export function unknownKnowledgeTableFields(
  table: KnowledgeTable,
  input: Readonly<Record<string, unknown>>,
): string[] {
  const kinds = knowledgeTableWritableFields(table);
  return Object.keys(input).filter((field) => !kinds.has(field));
}

/** The contract's row (`KbPaymentMethod`, …): meta fields, review state, the fields. */
export function serialiseKnowledgeTableRow(
  table: KnowledgeTable,
  record: AnyRecord,
  now: Date = new Date(),
): Record<string, unknown> {
  const activeTo = 'activeTo' in record ? record.activeTo : null;
  const due = knowledgeTableRowReviewDueAt(table, {
    reviewed_at: record.reviewedAt,
    review_interval_days: record.reviewIntervalDays,
    active_to: activeTo,
  });
  return {
    id: record.id,
    brand_ids: record.brandIds,
    owner_id: record.ownerId,
    reviewed_at: record.reviewedAt.toISOString(),
    review_interval_days: record.reviewIntervalDays,
    review_due_at: due.toISOString(),
    stale: due.getTime() < now.getTime(),
    source: record.source,
    created_by: record.createdBy,
    updated_by: record.updatedBy,
    created_at: record.createdAt.toISOString(),
    updated_at: record.updatedAt.toISOString(),
    ...(knowledgeTableFieldsOf(table, record) as unknown as Record<string, unknown>),
  };
}
