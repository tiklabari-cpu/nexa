/**
 * Writing the structured knowledge tables (tm 310.2 · SiyahTuş analysis AI-13;
 * ADR-14b §2.12) — what the panel's form, its CSV import and its "Gözden
 * geçirdim" button go through; the rows themselves through `config-draft.ts`.
 *
 * A row is refused with every problem at once, as `{ field, code }`
 * (`KnowledgeTableProblem`) — the validators' own (`validateKnowledgeTableRow`)
 * and what only the database can say:
 *
 *   - a brand, an owner or an excluded payment method that is not this
 *     workspace's (`invalid` on that field — under RLS a stranger's id and an
 *     unknown one are one answer);
 *   - a name another row already answers to in an overlapping brand scope, and
 *     for a payment method the same direction (`taken`,
 *     `findKnowledgeTableConflicts`) — no index can say that;
 *   - a table already holding `KNOWLEDGE_TABLE_ROWS_MAX` rows (`too_many`).
 *
 * The uniqueness check reads the table and then writes, so one writer per
 * workspace and table at a time: a transaction-scoped advisory lock, taken
 * first. An edit is validated whole — the stored row with the body over it —
 * and stores only what the body names.
 *
 * Integration rows (`source = 'integration'`, F2) are not edited by hand.
 */
import {
  KNOWLEDGE_TABLE_REQUIRED_FIELDS,
  KNOWLEDGE_TABLE_ROWS_MAX,
  findKnowledgeTableConflicts,
  isUuid,
  knowledgeTableRowLabel,
  validateKnowledgeTableRow,
  type KnowledgeTable,
  type KnowledgeTableIdentity,
  type KnowledgeTableProblem,
} from '@siyahtus/types';
import { ApiError } from '../../lib/api-error.js';
import type { TenantClient } from '../../lib/tenant.js';
import {
  createKnowledgeTableRowDraft,
  deleteKnowledgeTableRowDraft,
  reviewKnowledgeTableRowDraft,
  updateKnowledgeTableRowDraft,
} from '../ai/config-draft.js';
import {
  knowledgeTableDataOf,
  knowledgeTableWriteShapeOf,
  normaliseKnowledgeTableInput,
  unknownKnowledgeTableFields,
} from './records.js';
import {
  findKnowledgeTableRecord,
  listKnowledgeTableRecords,
  type KnowledgeTableRecords,
} from './rows.js';

type AnyRecord = KnowledgeTableRecords[KnowledgeTable];

/** Who writes, and for which workspace. */
export interface KnowledgeTableWriter {
  licenseId: bigint;
  /** The person (`accounts.id`); null for a token that is no one's. */
  accountId: string | null;
}

/** What `details.reason` says when a row is refused for its fields. */
export const KNOWLEDGE_TABLE_ROW_INVALID = 'knowledge_table_row_invalid';

/** …and when an integration's row is edited by hand. */
export const KNOWLEDGE_TABLE_ROW_FROM_INTEGRATION = 'knowledge_table_row_from_integration';

/** The refusal of a row: 400 `validation`, every problem in `details.problems`. */
export function refuseKnowledgeTableRow(problems: KnowledgeTableProblem[]): never {
  const first = problems[0];
  const said = first ? `${first.field === '' ? 'row' : first.field}: ${first.code}` : 'invalid';
  const more = problems.length > 1 ? ` (and ${problems.length - 1} more)` : '';
  throw ApiError.validation(`The row was refused — ${said}${more}.`, {
    reason: KNOWLEDGE_TABLE_ROW_INVALID,
    problems,
  });
}

/** One writer per workspace and table, until this transaction ends. */
export async function lockKnowledgeTable(
  tx: TenantClient,
  licenseId: bigint,
  table: KnowledgeTable,
): Promise<void> {
  await tx.$executeRaw`
    SELECT pg_advisory_xact_lock(hashtextextended(${`knowledge_table:${licenseId}:${table}`}, 0))`;
}

/** What uniqueness and brand priority compare, from a row in the writer's terms. */
function identityOf(row: Readonly<Record<string, unknown>>, id?: string): KnowledgeTableIdentity {
  const text = (value: unknown) => (typeof value === 'string' ? value : undefined);
  return {
    ...(id === undefined ? {} : { id }),
    brand_ids: Array.isArray(row['brand_ids'])
      ? row['brand_ids'].filter((v): v is string => typeof v === 'string')
      : [],
    name: text(row['name']),
    aliases: Array.isArray(row['aliases'])
      ? row['aliases'].filter((v): v is string => typeof v === 'string')
      : [],
    direction: text(row['direction']),
    doc_type: text(row['doc_type']),
    key: text(row['key']),
  };
}

/** A stored row as an identity. */
function identityOfRecord(table: KnowledgeTable, record: AnyRecord): KnowledgeTableIdentity {
  return identityOf(knowledgeTableWriteShapeOf(table, record), record.id);
}

/**
 * The ids in `field` of `row` that `known` does not hold, as problems on
 * their positions.
 */
function unknownIds(
  row: Readonly<Record<string, unknown>>,
  field: string,
  known: ReadonlySet<string>,
): KnowledgeTableProblem[] {
  const ids = row[field];
  if (!Array.isArray(ids)) return [];
  return ids.flatMap((id, i) =>
    typeof id === 'string' && !known.has(id.toLowerCase())
      ? [{ field: `${field}[${i}]`, code: 'invalid' as const }]
      : [],
  );
}

/**
 * What the workspace knows that a row may point at — read once per write (an
 * import reads it once for the whole file).
 */
export interface KnowledgeTableReferences {
  brandIds: ReadonlySet<string>;
  memberIds: ReadonlySet<string>;
  paymentMethodIds: ReadonlySet<string>;
}

/** The ids a row of `table` may point at, of the ones `rows` name. */
export async function readKnowledgeTableReferences(
  tx: TenantClient,
  rows: ReadonlyArray<Readonly<Record<string, unknown>>>,
): Promise<KnowledgeTableReferences> {
  const named = (field: string) => [
    ...new Set(
      rows.flatMap((row) => {
        const value = row[field];
        if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string');
        return typeof value === 'string' ? [value] : [];
      }),
    ),
  ];
  const uuids = (ids: string[]) => ids.filter((id) => isUuid(id));
  const brands = uuids(named('brand_ids'));
  const owners = uuids(named('owner_id'));
  const methods = uuids(named('excluded_method_ids'));
  const lower = (list: Array<{ id: string }>) => new Set(list.map((row) => row.id.toLowerCase()));
  return {
    brandIds: lower(
      brands.length === 0
        ? []
        : await tx.brand.findMany({ where: { id: { in: brands } }, select: { id: true } }),
    ),
    memberIds: lower(
      owners.length === 0
        ? []
        : await tx.account.findMany({ where: { id: { in: owners } }, select: { id: true } }),
    ),
    paymentMethodIds: lower(
      methods.length === 0
        ? []
        : await tx.kbPaymentMethod.findMany({
            where: { id: { in: methods } },
            select: { id: true },
          }),
    ),
  };
}

/**
 * Every problem in `row` — a create's body, or an edit's merged row — as a
 * row of `table` beside `others` (every stored row of the table, and an
 * import's rows taken before it).
 */
export function knowledgeTableRowProblems(
  table: KnowledgeTable,
  row: Readonly<Record<string, unknown>>,
  context: {
    id?: string;
    others: readonly KnowledgeTableIdentity[];
    references: KnowledgeTableReferences;
  },
): KnowledgeTableProblem[] {
  const unknown = unknownKnowledgeTableFields(table, row).map((field) => ({
    field,
    code: 'invalid' as const,
  }));
  const problems = [...unknown, ...validateKnowledgeTableRow(table, row)];
  problems.push(...unknownIds(row, 'brand_ids', context.references.brandIds));
  const owner = row['owner_id'];
  if (
    typeof owner === 'string' &&
    !context.references.memberIds.has(owner.toLowerCase()) &&
    !problems.some((p) => p.field === 'owner_id')
  ) {
    problems.push({ field: 'owner_id', code: 'invalid' });
  }
  if (table === 'bonuses') {
    problems.push(...unknownIds(row, 'excluded_method_ids', context.references.paymentMethodIds));
  }
  // `taken` only for a name that is itself acceptable.
  const refused = new Set(problems.map((p) => p.field));
  problems.push(
    ...findKnowledgeTableConflicts(table, identityOf(row, context.id), context.others).filter(
      (p) => !refused.has(p.field),
    ),
  );
  return dedupe(problems);
}

function dedupe(problems: KnowledgeTableProblem[]): KnowledgeTableProblem[] {
  const seen = new Set<string>();
  return problems.filter((p) => {
    const key = `${p.field}\u0000${p.code}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** A create's fields the table requires and the body does not give, as problems. */
function missingRequired(
  table: KnowledgeTable,
  row: Readonly<Record<string, unknown>>,
): KnowledgeTableProblem[] {
  return KNOWLEDGE_TABLE_REQUIRED_FIELDS[table]
    .filter((field) => row[field] === undefined || row[field] === null)
    .map((field) => ({ field, code: 'required' as const }));
}

/** The problems a new `row` has — the create's rule, said once for the form and the import. */
export function newKnowledgeTableRowProblems(
  table: KnowledgeTable,
  row: Readonly<Record<string, unknown>>,
  context: { others: readonly KnowledgeTableIdentity[]; references: KnowledgeTableReferences },
): KnowledgeTableProblem[] {
  return dedupe([
    ...missingRequired(table, row),
    ...knowledgeTableRowProblems(table, row, context),
  ]);
}

/** Add a row (`POST /knowledge-tables/{table}`), in the caller's transaction. */
export async function createKnowledgeTableRow<T extends KnowledgeTable>(
  tx: TenantClient,
  writer: KnowledgeTableWriter,
  table: T,
  body: Readonly<Record<string, unknown>>,
): Promise<KnowledgeTableRecords[T]> {
  await lockKnowledgeTable(tx, writer.licenseId, table);
  const row = normaliseKnowledgeTableInput(table, body);
  const stored = await listKnowledgeTableRecords(tx, table);
  const problems =
    stored.length >= KNOWLEDGE_TABLE_ROWS_MAX
      ? [{ field: '', code: 'too_many' as const }]
      : newKnowledgeTableRowProblems(table, row, {
          others: stored.map((record) => identityOfRecord(table, record)),
          references: await readKnowledgeTableReferences(tx, [row]),
        });
  if (problems.length > 0) refuseKnowledgeTableRow(problems);
  return createKnowledgeTableRowDraft(
    tx,
    table,
    writer.licenseId,
    knowledgeTableDataOf(table, row),
    writer.accountId,
  );
}

/** One CSV data row's verdict. */
export interface KnowledgeTableImportVerdict {
  line: number;
  status: 'imported' | 'skipped';
  id: string | null;
  label: string | null;
  problems: KnowledgeTableProblem[];
}

/**
 * An import's rows (`POST /knowledge-tables/{table}/import`), in the caller's
 * transaction: each row the create's rule, beside the stored rows and the
 * rows taken before it in the file; the valid rows written, the others
 * skipped with their problems (AI-13 §8). `parsed` carries what the CSV cells
 * could not say (a cell that is not JSON). A dry run writes nothing.
 */
export async function importKnowledgeTableRows<T extends KnowledgeTable>(
  tx: TenantClient,
  writer: KnowledgeTableWriter,
  table: T,
  parsed: ReadonlyArray<{
    line: number;
    row: Record<string, unknown>;
    problems: KnowledgeTableProblem[];
  }>,
  dryRun: boolean,
): Promise<{ verdicts: KnowledgeTableImportVerdict[]; created: Array<KnowledgeTableRecords[T]> }> {
  await lockKnowledgeTable(tx, writer.licenseId, table);
  const stored = await listKnowledgeTableRecords(tx, table);
  const others = stored.map((record) => identityOfRecord(table, record));
  const rows = parsed.map((entry) => ({
    ...entry,
    row: normaliseKnowledgeTableInput(table, entry.row),
  }));
  const references = await readKnowledgeTableReferences(
    tx,
    rows.map((entry) => entry.row),
  );
  let room = KNOWLEDGE_TABLE_ROWS_MAX - stored.length;
  const verdicts: KnowledgeTableImportVerdict[] = [];
  const created: Array<KnowledgeTableRecords[T]> = [];
  for (const entry of rows) {
    const label = knowledgeTableRowLabel(table, entry.row);
    const problems = dedupe([
      ...entry.problems,
      ...newKnowledgeTableRowProblems(table, entry.row, { others, references }),
    ]);
    if (problems.length === 0 && room <= 0) problems.push({ field: '', code: 'too_many' });
    if (problems.length > 0) {
      verdicts.push({ line: entry.line, status: 'skipped', id: null, label, problems });
      continue;
    }
    room -= 1;
    others.push(identityOf(entry.row));
    let id: string | null = null;
    if (!dryRun) {
      const record = await createKnowledgeTableRowDraft(
        tx,
        table,
        writer.licenseId,
        knowledgeTableDataOf(table, entry.row),
        writer.accountId,
      );
      created.push(record);
      id = record.id;
    }
    verdicts.push({ line: entry.line, status: 'imported', id, label, problems: [] });
  }
  return { verdicts, created };
}

/**
 * Edit a row (`PATCH /knowledge-tables/{table}/{rowId}`): the stored row with
 * `body` over it, validated whole; only what `body` names is written. Null
 * when the row is not this workspace's.
 */
export async function updateKnowledgeTableRow<T extends KnowledgeTable>(
  tx: TenantClient,
  writer: KnowledgeTableWriter,
  table: T,
  id: string,
  body: Readonly<Record<string, unknown>>,
): Promise<KnowledgeTableRecords[T] | null> {
  await lockKnowledgeTable(tx, writer.licenseId, table);
  const existing = await findKnowledgeTableRecord(tx, table, id);
  if (existing === null) return null;
  if (existing.source === 'integration') {
    throw ApiError.validation(
      "This row is an integration's: it is changed where the integration takes it from, not here.",
      { reason: KNOWLEDGE_TABLE_ROW_FROM_INTEGRATION },
    );
  }
  const change = normaliseKnowledgeTableInput(table, body);
  const merged = { ...knowledgeTableWriteShapeOf(table, existing), ...change };
  const stored = await listKnowledgeTableRecords(tx, table);
  const problems = knowledgeTableRowProblems(table, merged, {
    id,
    others: stored.map((record) => identityOfRecord(table, record)),
    references: await readKnowledgeTableReferences(tx, [merged]),
  });
  if (problems.length > 0) refuseKnowledgeTableRow(problems);
  await updateKnowledgeTableRowDraft(
    tx,
    table,
    id,
    knowledgeTableDataOf(table, change),
    writer.accountId,
  );
  return findKnowledgeTableRecord(tx, table, id);
}

/** Mark a row reviewed; null when it is not this workspace's. */
export async function reviewKnowledgeTableRow<T extends KnowledgeTable>(
  tx: TenantClient,
  writer: KnowledgeTableWriter,
  table: T,
  id: string,
): Promise<KnowledgeTableRecords[T] | null> {
  if ((await reviewKnowledgeTableRowDraft(tx, table, id, writer.accountId)) === 0) return null;
  return findKnowledgeTableRecord(tx, table, id);
}

/** Delete a row and its knowledge source; false when it is not this workspace's. */
export async function deleteKnowledgeTableRow(
  tx: TenantClient,
  writer: KnowledgeTableWriter,
  table: KnowledgeTable,
  id: string,
): Promise<boolean> {
  await lockKnowledgeTable(tx, writer.licenseId, table);
  return (await deleteKnowledgeTableRowDraft(tx, table, id)) > 0;
}
