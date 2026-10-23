/**
 * The message search index exists, is whole, and is the one a search reaches
 * (ID-07 · tm 333.1; migration 20261023100000_event_text_search_index).
 *
 * `events_text_search_idx` is a trigram GIN over `siyahtus_search_fold(text)`
 * on messages, created `ON ONLY` the partitioned parent with each partition's
 * index built separately and attached — `scripts/partition-indexes.ts` does
 * that `CONCURRENTLY` for partitions that held rows. Prisma's diff sees none of
 * it (an expression, partial, partitioned index), so `db:check-drift` cannot
 * notice it missing or invalid; this file is what does. Half-built is the
 * failure to fear: an INVALID parent still exists, still has a name, and every
 * query keeps working — only slower, on whichever months lack their half.
 *
 * Plans are read as the table owner, because that is what the search will run
 * as: tm 333.2's `search_events` is SECURITY DEFINER. Under `siyahtus_app` row
 * level security makes `events` a security barrier and `textlike` is not
 * leakproof, so the `LIKE` would stay a row filter above the barrier — the
 * reason the search carries the tenant and visibility filters inside a
 * definer function instead (parent task 333).
 */
import { Prisma, type PrismaClient } from '@prisma/client';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateShortId } from '@siyahtus/types';
import { completePartitionedIndexes, type SqlSession } from '../../src/lib/partitioned-index.js';
import { ownerClient, seedFixtures, type Fixtures } from '../helpers/fixtures.js';

const PARENT = 'events_text_search_idx';

interface PlanNode {
  'Node Type': string;
  'Index Name'?: string;
  'Index Cond'?: string;
  Plans?: PlanNode[];
}

const flatten = (node: PlanNode): PlanNode[] => [node, ...(node.Plans ?? []).flatMap(flatten)];

/** One session as the owner, every statement it is sent kept in order. */
async function recordingSession(): Promise<{
  session: SqlSession;
  statements: string[];
  end: () => Promise<void>;
}> {
  const client = new pg.Client({ connectionString: process.env['DATABASE_URL'] });
  await client.connect();
  const statements: string[] = [];
  return {
    session: {
      query: async <Row>(text: string, values?: unknown[]) => {
        statements.push(text);
        return client.query(text, values) as unknown as Promise<{ rows: Row[] }>;
      },
    },
    statements,
    end: () => client.end(),
  };
}

describe('message search index (events_text_search_idx)', () => {
  let owner: PrismaClient;

  beforeAll(() => {
    owner = ownerClient();
  });

  afterAll(async () => {
    await owner.$disconnect();
  });

  it('pg_trgm is installed, and trusted — creatable by an owner that is not superuser', async () => {
    const rows = await owner.$queryRaw<Array<{ trusted: boolean }>>`
      SELECT v.trusted
      FROM pg_extension e
      JOIN pg_available_extension_versions v ON v.name = e.extname AND v.version = e.extversion
      WHERE e.extname = 'pg_trgm'`;
    expect(rows).toEqual([{ trusted: true }]);
  });

  it('the parent and every partition’s index are valid and attached (pg_index.indisvalid)', async () => {
    const [parent] = await owner.$queryRaw<Array<{ valid: boolean; definition: string }>>`
      SELECT i.indisvalid AS valid, pg_get_indexdef(i.indexrelid) AS definition
      FROM pg_index i WHERE i.indexrelid = ${PARENT}::regclass`;
    expect(parent?.valid).toBe(true);
    expect(parent?.definition).toContain('USING gin (siyahtus_search_fold(text) gin_trgm_ops)');
    expect(parent?.definition).toContain("WHERE (type = 'message'::text)");

    const partitions = await owner.$queryRaw<
      Array<{ partition: string; child: string | null; valid: boolean | null }>
    >`
      SELECT c.relname AS partition, ci.relname AS child, x.indisvalid AS valid
      FROM pg_inherits h
      JOIN pg_class c ON c.oid = h.inhrelid
      LEFT JOIN pg_index x ON x.indrelid = c.oid
        AND x.indexrelid IN (SELECT inhrelid FROM pg_inherits WHERE inhparent = ${PARENT}::regclass)
      LEFT JOIN pg_class ci ON ci.oid = x.indexrelid
      WHERE h.inhparent = 'events'::regclass
      ORDER BY c.relname`;
    expect(partitions.length).toBeGreaterThan(1);
    expect(partitions.map((row) => row.partition)).toContain('events_default');
    for (const row of partitions) {
      expect(row.child, `${row.partition} has no index attached under ${PARENT}`).not.toBeNull();
      expect(row.valid, `${row.partition}'s ${row.child} is INVALID`).toBe(true);
    }
  });

  it('a partition opened after the migration is born with its half, and the parent stays valid', async () => {
    // Far enough ahead to be a month no other test opens; `events_ensure_partition`
    // refuses past 60.
    const [opened] = await owner.$queryRaw<Array<{ name: string }>>`
      SELECT events_ensure_partition(now() + interval '57 months') AS name`;
    const name = opened!.name;
    try {
      const rows = await owner.$queryRaw<Array<{ child_valid: boolean; parent_valid: boolean }>>`
        SELECT x.indisvalid AS child_valid,
               (SELECT indisvalid FROM pg_index WHERE indexrelid = ${PARENT}::regclass) AS parent_valid
        FROM pg_inherits ih
        JOIN pg_index x ON x.indexrelid = ih.inhrelid
        WHERE ih.inhparent = ${PARENT}::regclass AND x.indrelid = ${name}::regclass`;
      expect(rows).toEqual([{ child_valid: true, parent_valid: true }]);
    } finally {
      await owner.$executeRawUnsafe(`DROP TABLE IF EXISTS public.${name}`);
    }
  });

  it('a run against the migrated database finds nothing to do', async () => {
    const { session, end } = await recordingSession();
    try {
      expect(await completePartitionedIndexes(session, { table: 'public.events' })).toEqual([]);
    } finally {
      await end();
    }
  });

  it('folds case and Turkish letters byte-safely under SQL_ASCII', async () => {
    const cases: Array<[string | null, string | null]> = [
      ['İSTANBUL', 'istanbul'],
      ['Çağrı ŞIK Öğün Üye', 'cagri sik ogun uye'],
      ['Papara ile 5000 TL', 'papara ile 5000 tl'],
      ['Âlâ Îmân Ûmumî', 'ala iman umumi'],
      // What a browser's `'İ'.toLowerCase()` leaves: i + U+0307.
      ['İstanbul'.toLowerCase(), 'istanbul'],
      ['TR12 0006 1005 1978 6457 8413 26', 'tr12 0006 1005 1978 6457 8413 26'],
      [null, null],
    ];
    for (const [input, folded] of cases) {
      const [row] = await owner.$queryRaw<Array<{ folded: string | null }>>`
        SELECT siyahtus_search_fold(${input}::text) AS folded`;
      expect(row?.folded, String(input)).toBe(folded);
    }
  });

  describe('a search shaped like search_events', () => {
    let fx: Fixtures;
    let matches: (license: bigint, ...terms: string[]) => Prisma.Sql;

    beforeAll(async () => {
      fx = await seedFixtures(owner);
      const t = fx.a;
      const customer = await owner.customer.create({
        data: { organizationId: t.organizationId, name: 'Vic' },
        select: { id: true },
      });
      const chatId = generateShortId();
      const threadId = generateShortId();
      await owner.chat.create({
        data: { id: chatId, licenseId: t.licenseId, customerId: customer.id, active: true },
      });
      await owner.thread.create({
        data: { id: threadId, chatId, licenseId: t.licenseId, active: true },
      });

      // Enough rows that reading the month is the expensive plan, all in the
      // current month's partition; one statement, because the read is the point.
      await owner.$executeRaw`
        INSERT INTO events (id, thread_id, chat_id, license_id, type, text, author_type, created_at)
        SELECT ${threadId} || '_' || g, ${threadId}, ${chatId}, ${t.licenseId}, 'message',
               'Merhaba, hesabıma para yatırdım ' || g || '. sipariş bekliyorum',
               CASE WHEN g % 2 = 0 THEN 'agent' ELSE 'customer' END,
               date_trunc('month', now()) + make_interval(secs => g::double precision)
        FROM generate_series(1, 20000) AS g`;
      const extra: Array<[string, string, string]> = [
        ['20001', 'message', 'Papara ile 5000 TL gönderdim, gelmedi'],
        ['20002', 'message', 'İSTANBUL şubesine çağrı bıraktım'],
        // A system line with the same words: the index is partial on messages
        // and the search names the same predicate, so it never comes back.
        ['20003', 'system_message', 'papara 5000 system note'],
        // Both words, the wrong order and far apart: still a match — the
        // terms are separate conditions, not a phrase.
        ['20004', 'message', '5000 lira, sonra da Papara'],
      ];
      for (const [seq, type, text] of extra) {
        await owner.$executeRaw`
          INSERT INTO events (id, thread_id, chat_id, license_id, type, text, author_type, created_at)
          VALUES (${`${threadId}_${seq}`}, ${threadId}, ${chatId}, ${t.licenseId}, ${type}, ${text},
                  'customer', date_trunc('month', now()) + interval '6 hours')`;
      }
      // Statistics now, not whenever autovacuum gets to it: under gate load the
      // planner otherwise plans these rows as an empty table.
      await owner.$executeRawUnsafe('ANALYZE events');

      matches = (license, ...terms) => Prisma.sql`
        SELECT id FROM events
        WHERE license_id = ${license}
          AND type = 'message'
          AND created_at >= now() - interval '90 days'
          AND ${Prisma.join(
            terms.map(
              (term) =>
                Prisma.sql`siyahtus_search_fold(text) LIKE '%' || siyahtus_search_fold(${term}) || '%'`,
            ),
            ' AND ',
          )}
        ORDER BY created_at DESC, id DESC`;
    });

    const ids = async (sql: Prisma.Sql): Promise<string[]> =>
      (await owner.$queryRaw<Array<{ id: string }>>(sql)).map((row) => row.id.split('_')[1]!);

    it('finds "papara 5000" in "Papara ile 5000 TL", either order, never a system line', async () => {
      expect((await ids(matches(fx.a.licenseId, 'papara', '5000'))).sort()).toEqual([
        '20001',
        '20004',
      ]);
      expect(await ids(matches(fx.a.licenseId, 'PAPARA ile 5000'))).toEqual(['20001']);
    });

    it('is case- and Turkish-letter-insensitive both ways', async () => {
      expect(await ids(matches(fx.a.licenseId, 'istanbul'))).toEqual(['20002']);
      expect(await ids(matches(fx.a.licenseId, 'İstanbul'))).toEqual(['20002']);
      expect(await ids(matches(fx.a.licenseId, 'cagri'))).toEqual(['20002']);
      expect(await ids(matches(fx.a.licenseId, 'ÇAĞRI'))).toEqual(['20002']);
    });

    it('stays inside the licence it names', async () => {
      expect(await ids(matches(fx.b.licenseId, 'papara'))).toEqual([]);
    });

    it('is served by the trigram index, not by reading the month', async () => {
      const rows = await owner.$queryRaw<Array<Record<string, unknown>>>(
        Prisma.sql`EXPLAIN (FORMAT JSON) ${matches(fx.a.licenseId, 'papara', '5000')}`,
      );
      const raw = Object.values(rows[0] ?? {})[0];
      const plan = (
        (typeof raw === 'string' ? JSON.parse(raw) : raw) as Array<{ Plan: PlanNode }>
      )[0]!.Plan;
      const nodes = flatten(plan);

      const children = (
        await owner.$queryRaw<Array<{ name: string }>>`
          SELECT c.relname AS name FROM pg_inherits h JOIN pg_class c ON c.oid = h.inhrelid
          WHERE h.inhparent = ${PARENT}::regclass`
      ).map((row) => row.name);
      const [current] = await owner.$queryRaw<Array<{ name: string }>>`
        SELECT format('events_%s', to_char(now() AT TIME ZONE 'UTC', 'YYYY_MM')) AS name`;

      const trigram = nodes.filter(
        (node) =>
          node['Node Type'] === 'Bitmap Index Scan' && children.includes(node['Index Name']!),
      );
      expect(
        trigram.map((node) => node['Index Name']),
        JSON.stringify(plan, null, 1),
      ).toContain(`${current!.name}_text_search_idx`);
      for (const node of trigram) expect(node['Index Cond']).toMatch(/~~/);
      expect(
        nodes.filter(
          (node) =>
            node['Node Type'] === 'Seq Scan' &&
            (node as { 'Relation Name'?: string })['Relation Name'] === current!.name,
        ),
      ).toEqual([]);
    });
  });
});

describe('completePartitionedIndexes (scratch partitioned table)', () => {
  const SCHEMA = 'partition_index_probe';
  let owner: PrismaClient;

  beforeAll(async () => {
    owner = ownerClient();
    await owner.$executeRawUnsafe(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await owner.$executeRawUnsafe(`CREATE SCHEMA ${SCHEMA}`);
  });

  afterAll(async () => {
    await owner.$executeRawUnsafe(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await owner.$disconnect();
  });

  async function probeTable(name: string): Promise<void> {
    for (const statement of [
      `CREATE TABLE ${SCHEMA}.${name} (id INT, type TEXT, body TEXT, at TIMESTAMPTZ) PARTITION BY RANGE (at)`,
      `CREATE TABLE ${SCHEMA}.${name}_a PARTITION OF ${SCHEMA}.${name} FOR VALUES FROM ('2026-01-01') TO ('2026-02-01')`,
      `CREATE TABLE ${SCHEMA}.${name}_b PARTITION OF ${SCHEMA}.${name} FOR VALUES FROM ('2026-02-01') TO ('2026-03-01')`,
      `CREATE TABLE ${SCHEMA}.${name}_c PARTITION OF ${SCHEMA}.${name} DEFAULT`,
      `INSERT INTO ${SCHEMA}.${name} SELECT g % 50, 'message', 'Papara ' || g, '2026-01-01'::timestamptz + make_interval(hours => g)
         FROM generate_series(1, 1000) AS g`,
      `CREATE INDEX ${name}_body_idx ON ONLY ${SCHEMA}.${name}
         USING gin (siyahtus_search_fold(body) gin_trgm_ops) WHERE type = 'message'`,
    ]) {
      await owner.$executeRawUnsafe(statement);
    }
  }

  const validity = async (index: string): Promise<boolean | undefined> =>
    (
      await owner.$queryRawUnsafe<Array<{ valid: boolean }>>(
        `SELECT indisvalid AS valid FROM pg_index WHERE indexrelid = '${SCHEMA}.${index}'::regclass`,
      )
    )[0]?.valid;

  it('builds each missing half CONCURRENTLY, replaces an INVALID leftover, attaches a valid one, and the parent turns valid', async () => {
    await probeTable('probe');
    // A failed concurrent build's leftover under the child's own name: a
    // UNIQUE build over duplicate ids fails and leaves the index INVALID.
    await expect(
      owner.$executeRawUnsafe(
        `CREATE UNIQUE INDEX CONCURRENTLY probe_b_body_idx ON ${SCHEMA}.probe_b (id)`,
      ),
    ).rejects.toThrow();
    expect(await validity('probe_b_body_idx')).toBe(false);
    // An index already built — say by an earlier run that stopped before ATTACH.
    await owner.$executeRawUnsafe(
      `CREATE INDEX probe_c_body_idx ON ${SCHEMA}.probe_c USING gin (siyahtus_search_fold(body) gin_trgm_ops) WHERE type = 'message'`,
    );
    expect(await validity('probe_body_idx')).toBe(false);

    const { session, statements, end } = await recordingSession();
    try {
      const results = await completePartitionedIndexes(session, { table: `${SCHEMA}.probe` });
      expect(results).toEqual([
        {
          index: 'probe_body_idx',
          valid: true,
          steps: [
            { partition: 'probe_a', index: 'probe_a_body_idx', action: 'built' },
            { partition: 'probe_b', index: 'probe_b_body_idx', action: 'rebuilt' },
            { partition: 'probe_c', index: 'probe_c_body_idx', action: 'attached' },
          ],
        },
      ]);

      const ddl = statements.filter((text) => /^(CREATE|DROP|ALTER) /.test(text));
      expect(ddl).toEqual([
        `CREATE INDEX CONCURRENTLY IF NOT EXISTS probe_a_body_idx ON ${SCHEMA}.probe_a USING gin (siyahtus_search_fold(body) gin_trgm_ops) WHERE (type = 'message'::text)`,
        `ALTER INDEX ${SCHEMA}.probe_body_idx ATTACH PARTITION ${SCHEMA}.probe_a_body_idx`,
        `DROP INDEX CONCURRENTLY IF EXISTS ${SCHEMA}.probe_b_body_idx`,
        `CREATE INDEX CONCURRENTLY IF NOT EXISTS probe_b_body_idx ON ${SCHEMA}.probe_b USING gin (siyahtus_search_fold(body) gin_trgm_ops) WHERE (type = 'message'::text)`,
        `ALTER INDEX ${SCHEMA}.probe_body_idx ATTACH PARTITION ${SCHEMA}.probe_b_body_idx`,
        `ALTER INDEX ${SCHEMA}.probe_body_idx ATTACH PARTITION ${SCHEMA}.probe_c_body_idx`,
      ]);
      expect(await validity('probe_body_idx')).toBe(true);
      expect(await validity('probe_b_body_idx')).toBe(true);

      expect(await completePartitionedIndexes(session, { table: `${SCHEMA}.probe` })).toEqual([]);
    } finally {
      await end();
    }
  });

  it('one partition failing does not stop the others, and the parent is reported still invalid', async () => {
    await probeTable('clash');
    // The name the builder wants for clash_b already belongs to another table.
    await owner.$executeRawUnsafe(`CREATE INDEX clash_b_body_idx ON ${SCHEMA}.clash_a (id)`);

    const { session, end } = await recordingSession();
    try {
      const [result] = await completePartitionedIndexes(session, { table: `${SCHEMA}.clash` });
      expect(result?.valid).toBe(false);
      expect(result?.steps.map(({ partition, action }) => [partition, action])).toEqual([
        ['clash_a', 'built'],
        ['clash_b', 'failed'],
        ['clash_c', 'built'],
      ]);
      expect(result?.steps[1]?.error).toMatch(/already exists on another table/);
    } finally {
      await end();
    }
  });
});
