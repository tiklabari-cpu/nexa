/**
 * Measures what one page of a transcript actually costs, as the thread grows.
 *
 *     pnpm --filter @nexa/api measure:transcript-page [events]
 *
 * PRD NFR-P6 asks for "sabit-zaman" — a page of a big list must cost the same
 * as a page of a small one — and names three parts: monthly RANGE partitions on
 * `events`, cursor pagination, and a composite index. The first two were in
 * place; the third was not, and the audit (`prd-uyum-denetimi.md` Ek A,
 * `NFR-P6`) said so. `chat-service.ts#listEvents` bounded and ordered a page by
 * `(split_part(id, '_', 2))::bigint` — the sequence that lives inside the event
 * id — and no index matched that expression, so every page read the whole
 * thread and sorted it.
 *
 * That claim is checkable, and this is the check. It is deliberately not a
 * pass/fail assertion: the guard against regression is
 * `test/integration/transcript-page-plan.test.ts`, which pins the shape of the
 * plan. This script produces the numbers that shape is worth having — and, more
 * to the point, it is where the *design* was decided, because the obvious fix
 * turns out not to work. Three states, measured against the same rows:
 *
 *  1. **expression, no index** — what shipped before. The audit's finding.
 *  2. **expression + an index on the expression** — the obvious fix. Perfect as
 *     the owner; under `nexa_app` the cursor bound drops out of the index
 *     condition into a row filter, because `events` carries row level security
 *     and `split_part` is not leakproof. The first page is fine and every page
 *     after it re-reads the thread from event one.
 *  3. **a stored generated column + an index on it** — what shipped. `bigint`
 *     comparison is leakproof, so the bound rides into the index.
 *
 * Two page shapes, because 2 and 3 only differ on one of them: the first page
 * (cursor 0, which every row satisfies) and a page from the middle of the
 * thread (the cursor doing real work).
 *
 * Everything runs as `nexa_app` inside a tenant transaction — the role and the
 * row level security the product actually has. Measuring as the owner is what
 * would have made option 2 look like it worked.
 *
 * Nothing here touches the development database: a scratch `nexa_test_` one is
 * created, migrated, measured and dropped — the same prefix the test harness
 * sweeps, so a window that dies mid-measurement leaves no orphan.
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Prisma, PrismaClient } from '@prisma/client';
import { loadEnvFile } from '../src/config/load-env-file.js';
import {
  adminUrl,
  assertDroppableDatabaseName,
  isolatedDatabaseName,
  withDatabaseName,
} from './test-datastores.js';

loadEnvFile();

const apiRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const prismaCli = createRequire(import.meta.url).resolve('prisma/build/index.js');

/** The index the migration ships, named exactly as it creates it. */
const COLUMN_INDEX = 'events_thread_id_event_sequence_idx';
/** The index option 2 would have shipped. Built here only to be measured. */
const EXPRESSION_INDEX = 'events_thread_id_sequence_idx';

/** The console asks for a page of this size; `listEvents` fetches one extra. */
const PAGE_LIMIT = 50;

/** How many times each shape is timed. The median is reported; the first run warms the cache. */
const REPEATS = 5;

const LICENSE_ID = 1n;
const ORGANIZATION_ID = '00000000-0000-4000-8000-000000000001';
const CUSTOMER_ID = '00000000-0000-4000-8000-000000000002';
const CHAT_ID = 'MEASURE0CH';
const THREAD_ID = 'MEASURE0TH';

/** Where the thread's own events live. Early in the month, so N seconds of them still fit. */
const THREAD_MONTH = '2026-06-01T00:00:00.000Z';

interface PlanNode {
  'Node Type': string;
  'Relation Name'?: string;
  'Index Cond'?: string;
  Filter?: string;
  'Actual Total Time'?: number;
  'Shared Hit Blocks'?: number;
  'Shared Read Blocks'?: number;
  Plans?: PlanNode[];
}

interface Measurement {
  label: string;
  /** Median of `REPEATS` executions, in milliseconds. */
  medianMs: number;
  /** Shared buffers touched by the whole plan (hit + read), from the last run. */
  buffers: number;
  /** How many `events*` relations the plan scanned. */
  partitions: number;
  /** Whether the cursor bound reached the index, or only the thread did. */
  cursorInIndex: boolean;
  /** Node types worth naming: the ones the requirement is about. */
  shape: string;
}

function flatten(node: PlanNode): PlanNode[] {
  return [node, ...(node.Plans ?? []).flatMap(flatten)];
}

function summarise(label: string, plans: PlanNode[]): Measurement {
  const times = plans.map((plan) => plan['Actual Total Time'] ?? 0).sort((a, b) => a - b);
  const last = plans.at(-1)!;
  const nodes = flatten(last);
  const conditions = nodes.flatMap((node) => node['Index Cond'] ?? []).join(' ');
  const types = nodes
    .map((node) => node['Node Type'])
    .filter((type) => type !== 'Result' && type !== 'Limit');
  return {
    label,
    medianMs: times[Math.floor(times.length / 2)] ?? 0,
    buffers: (last['Shared Hit Blocks'] ?? 0) + (last['Shared Read Blocks'] ?? 0),
    partitions: nodes.filter((node) => node['Relation Name']?.startsWith('events')).length,
    cursorInIndex: /event_sequence [<>]|split_part/.test(conditions),
    shape: [...new Set(types)].join(' + '),
  };
}

/**
 * The transcript page, in the two forms the decision compared.
 *
 * Written out here rather than imported: this file has to be able to say "this
 * is the SQL that was measured" on its own, and one of the two forms no longer
 * exists in the product.
 */
function page(variant: 'expression' | 'column', after: number, newestFirst: boolean): Prisma.Sql {
  const key =
    variant === 'column'
      ? Prisma.sql`event_sequence`
      : Prisma.sql`(split_part(id, '_', 2))::bigint`;
  return Prisma.sql`
    SELECT id, chat_id, thread_id, type, text, author_id, author_type,
           recipients, attachment_url, properties, created_at
    FROM events
    WHERE thread_id = ${THREAD_ID}
      AND ${key} > ${after}
    ORDER BY ${key} ${newestFirst ? Prisma.sql`DESC` : Prisma.sql`ASC`}
    LIMIT ${PAGE_LIMIT + 1}
  `;
}

/**
 * Runs the page under EXPLAIN as the *application* role with a tenant context.
 *
 * Not as the owner: `events` carries row level security, the owner bypasses it,
 * and whether the cursor reaches the index depends on exactly that. Measuring
 * without it would measure a query nobody runs.
 */
async function explain(app: PrismaClient, statement: Prisma.Sql): Promise<PlanNode[]> {
  const plans: PlanNode[] = [];
  for (let run = 0; run < REPEATS; run += 1) {
    const plan = await app.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_license', ${LICENSE_ID.toString()}, true)`;
      await tx.$executeRaw`SELECT set_config('app.current_organization', ${ORGANIZATION_ID}, true)`;
      const rows = await tx.$queryRaw<Array<Record<string, unknown>>>(
        Prisma.sql`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${statement}`,
      );
      const raw = Object.values(rows[0] ?? {})[0];
      const parsed = (typeof raw === 'string' ? JSON.parse(raw) : raw) as Array<{ Plan: PlanNode }>;
      return parsed[0]!.Plan;
    });
    plans.push(plan);
  }
  return plans;
}

interface Variant {
  key: string;
  query: 'expression' | 'column';
  index: string | null;
}

const VARIANTS: Variant[] = [
  { key: '1. expression, no index   ', query: 'expression', index: null },
  { key: '2. expression + expr index', query: 'expression', index: EXPRESSION_INDEX },
  { key: '3. column + column index  ', query: 'column', index: COLUMN_INDEX },
];

const INDEX_SQL: Record<string, string> = {
  [EXPRESSION_INDEX]: `CREATE INDEX ${EXPRESSION_INDEX} ON events (thread_id, ((split_part(id, '_', 2))::bigint))`,
  [COLUMN_INDEX]: `CREATE INDEX ${COLUMN_INDEX} ON events (thread_id, event_sequence)`,
};

/** Leaves exactly one of the two candidate indexes in place — or neither. */
async function useIndex(owner: PrismaClient, wanted: string | null): Promise<void> {
  for (const name of [EXPRESSION_INDEX, COLUMN_INDEX]) {
    await owner.$executeRawUnsafe(`DROP INDEX IF EXISTS ${name}`);
  }
  if (wanted) await owner.$executeRawUnsafe(INDEX_SQL[wanted]!);
  await owner.$executeRawUnsafe('ANALYZE events');
}

async function measureVariants(
  owner: PrismaClient,
  app: PrismaClient,
  events: number,
): Promise<Measurement[]> {
  const out: Measurement[] = [];
  for (const variant of VARIANTS) {
    await useIndex(owner, variant.index);
    out.push(
      summarise(`${variant.key} · first page  `, await explain(app, page(variant.query, 0, true))),
      summarise(
        `${variant.key} · page at ${events / 2}`,
        await explain(app, page(variant.query, events / 2, false)),
      ),
    );
  }
  return out;
}

function report(title: string, rows: Measurement[]): void {
  console.log(`\n=== ${title} ===`);
  for (const row of rows) {
    console.log(
      `  ${row.label.padEnd(46)} ${row.medianMs.toFixed(3).padStart(9)} ms · ` +
        `${String(row.buffers).padStart(6)} buffers · ${String(row.partitions).padStart(2)} partitions · ` +
        `cursor in index: ${row.cursorInIndex ? 'yes' : 'NO '} · ${row.shape}`,
    );
  }
}

function migrate(databaseUrl: string): Promise<number> {
  return new Promise((resolvePromise) => {
    const child = spawn(process.execPath, [prismaCli, 'migrate', 'deploy'], {
      cwd: apiRoot,
      env: { ...process.env, DATABASE_URL: databaseUrl, CHECKPOINT_DISABLE: '1' },
      stdio: ['ignore', 'ignore', 'inherit'],
    });
    child.on('close', (code) => resolvePromise(code ?? 1));
  });
}

/** Months of partitions around the thread's own month, so the fan-out axis is real. */
async function ensurePartitions(owner: PrismaClient, months: number): Promise<number> {
  for (let offset = 0; offset < months; offset += 1) {
    await owner.$executeRaw`
      SELECT events_ensure_partition((${THREAD_MONTH}::timestamptz + make_interval(months => ${offset}::int)))
    `;
  }
  const rows = await owner.$queryRaw<Array<{ count: bigint }>>`
    SELECT count(*) FROM pg_inherits WHERE inhparent = 'events'::regclass
  `;
  return Number(rows[0]?.count ?? 0);
}

async function seedThread(owner: PrismaClient): Promise<void> {
  await owner.$executeRaw`
    INSERT INTO organizations (id, name) VALUES (${ORGANIZATION_ID}::uuid, 'Measurement')
    ON CONFLICT (id) DO NOTHING
  `;
  await owner.$executeRaw`
    INSERT INTO licenses (id, organization_id) VALUES (${LICENSE_ID}, ${ORGANIZATION_ID}::uuid)
    ON CONFLICT (id) DO NOTHING
  `;
  await owner.$executeRaw`
    INSERT INTO customers (id, organization_id, name)
    VALUES (${CUSTOMER_ID}::uuid, ${ORGANIZATION_ID}::uuid, 'Measured Visitor')
    ON CONFLICT (id) DO NOTHING
  `;
  await owner.$executeRaw`
    INSERT INTO chats (id, license_id, customer_id, active, created_at, last_event_at)
    VALUES (${CHAT_ID}, ${LICENSE_ID}, ${CUSTOMER_ID}::uuid, true,
            ${THREAD_MONTH}::timestamptz, ${THREAD_MONTH}::timestamptz)
    ON CONFLICT (id) DO NOTHING
  `;
  await owner.$executeRaw`
    INSERT INTO threads (id, chat_id, license_id, active, created_at)
    VALUES (${THREAD_ID}, ${CHAT_ID}, ${LICENSE_ID}, true, ${THREAD_MONTH}::timestamptz)
    ON CONFLICT (id) DO NOTHING
  `;
}

/**
 * Grows the thread to exactly `total` events.
 *
 * Written as one `INSERT ... SELECT` over `generate_series` rather than a loop:
 * the point of the run is the read, and tens of thousands of round trips would
 * make the setup the slowest part of it. Every tenth event is an internal note,
 * so a thread of nothing but public messages does not flatter the customer's
 * `recipients = 'all'` filter.
 */
async function growTo(owner: PrismaClient, from: number, total: number): Promise<void> {
  await owner.$executeRaw`
    INSERT INTO events (id, thread_id, chat_id, license_id, type, text,
                        author_type, recipients, created_at)
    SELECT ${THREAD_ID} || '_' || g, ${THREAD_ID}, ${CHAT_ID}, ${LICENSE_ID}, 'message',
           'measured message ' || g,
           CASE WHEN g % 2 = 0 THEN 'agent' ELSE 'customer' END,
           CASE WHEN g % 10 = 0 THEN 'agents' ELSE 'all' END,
           ${THREAD_MONTH}::timestamptz + make_interval(secs => g::double precision)
    FROM generate_series(${from + 1}::bigint, ${total}::bigint) g
  `;
  await owner.$executeRaw`UPDATE threads SET event_sequence = ${total} WHERE id = ${THREAD_ID}`;
}

async function main(): Promise<number> {
  const events = Number(process.argv[2] ?? '2000');
  if (!Number.isInteger(events) || events < 100) {
    console.error('usage: measure-transcript-page.ts [events >= 100]');
    return 2;
  }

  const ownerUrl = process.env['DATABASE_URL'];
  const appUrl = process.env['DATABASE_APP_URL'];
  if (!ownerUrl || !appUrl) {
    throw new Error('DATABASE_URL and DATABASE_APP_URL must be set (see .env / .env.example)');
  }

  const databaseName = isolatedDatabaseName();
  assertDroppableDatabaseName(databaseName);
  const admin = new PrismaClient({ datasourceUrl: adminUrl(ownerUrl) });
  const scratchOwnerUrl = withDatabaseName(ownerUrl, databaseName);
  const scratchAppUrl = withDatabaseName(appUrl, databaseName);

  console.log(`scratch database: ${databaseName} · ${events} events, then ${events * 10}`);
  await admin.$executeRawUnsafe(`CREATE DATABASE "${databaseName}"`);

  const owner = new PrismaClient({ datasourceUrl: scratchOwnerUrl });
  const app = new PrismaClient({ datasourceUrl: scratchAppUrl });

  try {
    const migrated = await migrate(scratchOwnerUrl);
    if (migrated !== 0) throw new Error(`migrate deploy failed with exit ${migrated}`);

    const fewMonths = await ensurePartitions(owner, 6);
    await seedThread(owner);

    await growTo(owner, 0, events);
    const small = await measureVariants(owner, app, events);
    report(`${events} events · ${fewMonths} partitions · role nexa_app`, small);

    await growTo(owner, events, events * 10);
    const large = await measureVariants(owner, app, events * 10);
    report(`${events * 10} events · ${fewMonths} partitions · role nexa_app`, large);

    // The one axis the shipped fix does not remove: the page fans out over
    // every partition, because the cursor is a sequence and the partition key
    // is a timestamp — there is no predicate to prune with.
    const manyMonths = await ensurePartitions(owner, 36);
    await useIndex(owner, COLUMN_INDEX);
    report(`${events * 10} events · ${manyMonths} partitions · shipped variant only`, [
      summarise(
        '3. column + column index   · first page  ',
        await explain(app, page('column', 0, true)),
      ),
    ]);

    console.log('\n=== verdict (shared buffers, 10x the thread) ===');
    for (const [index, row] of large.entries()) {
      const before = small[index]!;
      console.log(
        `  ${row.label.padEnd(46)} ${String(before.buffers).padStart(6)} -> ${String(row.buffers).padStart(6)}` +
          ` · x${(row.buffers / Math.max(1, before.buffers)).toFixed(2)}`,
      );
    }
    return 0;
  } finally {
    await owner.$disconnect().catch(() => undefined);
    await app.$disconnect().catch(() => undefined);
    await admin
      .$executeRawUnsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`)
      .catch(() => undefined);
    await admin.$disconnect().catch(() => undefined);
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
