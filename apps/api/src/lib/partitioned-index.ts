/**
 * Finishes a partitioned index one partition at a time, `CONCURRENTLY`
 * (ID-07 · tm 333.1 · `docs/runbooks/event-partitions.md`, "Message search
 * index").
 *
 * PostgreSQL refuses `CREATE INDEX CONCURRENTLY` on a partitioned table, and a
 * plain build holds SHARE on the whole table — on `events`, no message can be
 * written until the last month is indexed. The documented way through: create
 * the parent `ON ONLY` (instant, born invalid), build each partition's index
 * `CONCURRENTLY`, `ALTER INDEX … ATTACH PARTITION` it; the parent turns valid
 * by itself once every partition has one. A migration can do the first step but
 * not the second — `CONCURRENTLY` must be alone in its file and needs a literal
 * table name, while the partition set differs per database (the reasoning is
 * in migration 20261023100000_event_text_search_index). This is the second
 * and third step, run as the table owner after `prisma migrate deploy`
 * (`scripts/partition-indexes.ts`).
 *
 * What it works on is read from the catalog, not configured: every *invalid*
 * partitioned index on the table. A valid one is complete — PostgreSQL clones a
 * partitioned index into each partition created later, and `ATTACH PARTITION`
 * of a table builds whatever it lacks — so there is nothing to do, and a
 * healthy database costs one catalog query.
 *
 * Safe to re-run and to interrupt. A concurrent build that fails (a lock
 * timeout, a cancelled session) leaves an INVALID index behind under the
 * child's name; the next run drops that one `CONCURRENTLY` and builds again
 * rather than attaching or keeping it. One partition failing does not stop the
 * others: the step is recorded and the run carries on.
 */

/** The slice of `pg.Client` used here: one session, one statement per call. */
export interface SqlSession {
  query<Row = Record<string, unknown>>(text: string, values?: unknown[]): Promise<{ rows: Row[] }>;
}

export type PartitionStepAction = 'built' | 'rebuilt' | 'attached' | 'failed';

export interface PartitionStep {
  partition: string;
  index: string;
  action: PartitionStepAction;
  /** SQLSTATE and message, on `failed` only. */
  error?: string;
}

export interface PartitionedIndexResult {
  index: string;
  /** `pg_index.indisvalid` of the parent after the run. */
  valid: boolean;
  steps: PartitionStep[];
}

export interface CompletePartitionedIndexesOptions {
  /** The partitioned table, schema-qualified or on the search path (`events`). */
  table: string;
  /** Called before each step, for a progress line; never required. */
  onStep?: (step: { partition: string; index: string; statement: string }) => void;
}

interface ParentIndex {
  schema: string;
  index: string;
  table: string;
  definition: string;
}

/**
 * The name the child of `parent` on `partition` gets: the parent's name with
 * the table's prefix swapped for the partition's — `events_text_search_idx` on
 * `events_2026_10` is `events_2026_10_text_search_idx`. Migration
 * 20261023100000 names the children it builds the same way, so either side
 * recognises what the other left behind.
 */
export function childIndexName(parentIndex: string, table: string, partition: string): string {
  const suffix = parentIndex.startsWith(`${table}_`)
    ? parentIndex.slice(table.length + 1)
    : parentIndex;
  const name = `${partition}_${suffix}`;
  // PostgreSQL truncates an identifier past 63 bytes without saying so; two
  // children could then share a name. Refuse instead of guessing.
  if (Buffer.byteLength(name, 'utf8') > 63) {
    throw new Error(`child index name "${name}" is longer than 63 bytes`);
  }
  return name;
}

/**
 * The child's `CREATE INDEX CONCURRENTLY` from the parent's own definition, so
 * the two cannot disagree on the expression, the operator class or the
 * predicate — `ATTACH PARTITION` refuses an index that does not match.
 * `pg_get_indexdef` always prints a partitioned index as
 * `CREATE [UNIQUE] INDEX <name> ON ONLY <table> USING …`; anything else is not
 * a definition this knows how to rewrite, and it says so.
 */
export function childIndexStatement(
  parentDefinition: string,
  expectedHead: { index: string; table: string },
  child: { index: string; table: string },
): string {
  for (const unique of ['', 'UNIQUE '] as const) {
    const head = `CREATE ${unique}INDEX ${expectedHead.index} ON ONLY ${expectedHead.table} `;
    if (parentDefinition.startsWith(head)) {
      return (
        `CREATE ${unique}INDEX CONCURRENTLY IF NOT EXISTS ${child.index} ON ${child.table} ` +
        parentDefinition.slice(head.length)
      );
    }
  }
  throw new Error(`unexpected partitioned index definition: ${parentDefinition}`);
}

function describeError(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  const message = error instanceof Error ? error.message : String(error);
  return typeof code === 'string' ? `${code} ${message}` : message;
}

export async function completePartitionedIndexes(
  db: SqlSession,
  options: CompletePartitionedIndexesOptions,
): Promise<PartitionedIndexResult[]> {
  const { rows: parents } = await db.query<ParentIndex>(
    `SELECT n.nspname AS schema, ic.relname AS index, tc.relname AS "table",
            pg_get_indexdef(ic.oid) AS definition
       FROM pg_index i
       JOIN pg_class ic ON ic.oid = i.indexrelid
       JOIN pg_class tc ON tc.oid = i.indrelid
       JOIN pg_namespace n ON n.oid = tc.relnamespace
      WHERE i.indrelid = $1::regclass
        AND ic.relkind = 'I'
        AND NOT i.indisvalid
      ORDER BY ic.relname`,
    [options.table],
  );

  const results: PartitionedIndexResult[] = [];
  for (const parent of parents) {
    results.push(await completeOne(db, parent, options.onStep));
  }
  return results;
}

async function completeOne(
  db: SqlSession,
  parent: ParentIndex,
  onStep: CompletePartitionedIndexesOptions['onStep'],
): Promise<PartitionedIndexResult> {
  const ident = async (...names: string[]): Promise<string[]> => {
    const { rows } = await db.query<{ q: string }>(
      'SELECT quote_ident(name) AS q FROM unnest($1::text[]) WITH ORDINALITY AS t(name, n) ORDER BY n',
      [names],
    );
    return rows.map((row) => row.q);
  };
  const [schemaQ, indexQ, tableQ] = await ident(parent.schema, parent.index, parent.table);
  const parentIndexQ = `${schemaQ}.${indexQ}`;

  // Direct partitions with no index attached under this parent yet. Read once:
  // a partition created while this runs is born with its child (cloned), so it
  // can only ever be missing from this list, never wrongly on it.
  const { rows: missing } = await db.query<{ schema: string; partition: string }>(
    `SELECT n.nspname AS schema, c.relname AS partition
       FROM pg_inherits h
       JOIN pg_class c ON c.oid = h.inhrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE h.inhparent = $1::regclass
        AND c.relkind = 'r'
        AND NOT EXISTS (
          SELECT 1 FROM pg_inherits ih
          JOIN pg_index ci ON ci.indexrelid = ih.inhrelid
          WHERE ih.inhparent = $2::regclass AND ci.indrelid = c.oid)
      ORDER BY c.relname`,
    [`${schemaQ}.${tableQ}`, parentIndexQ],
  );

  const steps: PartitionStep[] = [];
  for (const { schema, partition } of missing) {
    const index = childIndexName(parent.index, parent.table, partition);
    try {
      const [partSchemaQ, partitionQ, childQ] = await ident(schema, partition, index);
      const childTable = `${partSchemaQ}.${partitionQ}`;
      const childIndex = `${partSchemaQ}.${childQ}`;
      const create = childIndexStatement(
        parent.definition,
        { index: indexQ!, table: `${schemaQ}.${tableQ}` },
        { index: childQ!, table: childTable },
      );

      const { rows: existing } = await db.query<{ valid: boolean; on_partition: boolean }>(
        `SELECT i.indisvalid AS valid, i.indrelid = $2::regclass AS on_partition
           FROM pg_class c
           JOIN pg_index i ON i.indexrelid = c.oid
           JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = $1 AND c.relname = $3`,
        [schema, childTable, index],
      );
      const found = existing[0];
      if (found && !found.on_partition) {
        throw new Error(`index ${index} already exists on another table`);
      }

      let action: PartitionStepAction = 'built';
      if (found && found.valid) {
        action = 'attached';
      } else {
        if (found) {
          // A failed concurrent build's leftover: INVALID, never used by a
          // query, still maintained on every write. Kept, it would be attached
          // as if it were whole — PostgreSQL refuses that — or block the
          // `IF NOT EXISTS` below from building the real one.
          action = 'rebuilt';
          const drop = `DROP INDEX CONCURRENTLY IF EXISTS ${childIndex}`;
          onStep?.({ partition, index, statement: drop });
          await db.query(drop);
        }
        onStep?.({ partition, index, statement: create });
        await db.query(create);
      }

      const attach = `ALTER INDEX ${parentIndexQ} ATTACH PARTITION ${childIndex}`;
      onStep?.({ partition, index, statement: attach });
      await db.query(attach);
      steps.push({ partition, index, action });
    } catch (error) {
      steps.push({ partition, index, action: 'failed', error: describeError(error) });
    }
  }

  const { rows: validity } = await db.query<{ valid: boolean }>(
    'SELECT indisvalid AS valid FROM pg_index WHERE indexrelid = $1::regclass',
    [parentIndexQ],
  );
  return { index: parent.index, valid: validity[0]?.valid === true, steps };
}
