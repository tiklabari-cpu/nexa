/**
 * Builds the per-partition halves of `events`' partitioned indexes
 * `CONCURRENTLY` and attaches them (ID-07 · tm 333.1 ·
 * `docs/runbooks/event-partitions.md`, "Message search index"):
 *
 *   pnpm --filter @siyahtus/api db:partition-indexes          # development
 *   node dist/scripts/partition-indexes.js                    # in the api image
 *
 * Connects as the table owner (`DATABASE_URL`) — only the owner may create an
 * index — over one session, so that the advisory lock and the session settings
 * below hold for every statement. `apps/api/docker-entrypoint.sh` and the Helm
 * migrate Job run it after `prisma migrate deploy`; on a database where every
 * partitioned index is already valid it is one catalog query.
 *
 * Exit 0 when every partitioned index on `events` is valid afterwards, 1 when
 * one is not (each partition's step is printed, failures with their SQLSTATE),
 * 2 when another run holds the lock. The entrypoint treats a non-zero exit as a
 * warning, not a reason to stay down: an index still being finished makes
 * search slower, never wrong.
 */
import pg from 'pg';
import { loadEnvFile } from '../src/config/load-env-file.js';
import { completePartitionedIndexes } from '../src/lib/partitioned-index.js';

loadEnvFile();

/**
 * How long one statement may wait for a lock. `CREATE INDEX CONCURRENTLY`
 * waits for every transaction already open on the table to end — twice — and a
 * session left idle in a transaction would otherwise hold the entrypoint, and
 * the api behind it, indefinitely. Past this the build fails, leaves an INVALID
 * index the next run drops and rebuilds, and the run moves on.
 */
const LOCK_TIMEOUT = '60s';
/** One run at a time; a second one starting beside it would wait on the first's builds. */
const LOCK_KEY = 'siyahtus:partition-indexes';

async function main(): Promise<void> {
  const url = process.env['DATABASE_URL'];
  if (!url) {
    console.error('partition-indexes: DATABASE_URL (the table owner) is not set');
    process.exitCode = 1;
    return;
  }

  const client = new pg.Client({ connectionString: url, application_name: 'partition-indexes' });
  await client.connect();
  try {
    await client.query(`SET lock_timeout = '${LOCK_TIMEOUT}'`);
    await client.query('SET statement_timeout = 0');
    const { rows } = await client.query<{ locked: boolean }>(
      'SELECT pg_try_advisory_lock(hashtext($1)) AS locked',
      [LOCK_KEY],
    );
    if (!rows[0]?.locked) {
      console.error('partition-indexes: another run holds the lock — skipped');
      process.exitCode = 2;
      return;
    }

    const results = await completePartitionedIndexes(client, {
      table: 'public.events',
      onStep: ({ statement }) => console.log(`partition-indexes: ${statement}`),
    });
    for (const result of results) console.log(JSON.stringify(result));
    if (results.length === 0) console.log('partition-indexes: every partitioned index is valid');
    if (results.some((result) => !result.valid)) process.exitCode = 1;
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error(`partition-indexes: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
