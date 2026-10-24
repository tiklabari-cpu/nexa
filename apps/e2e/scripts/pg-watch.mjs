/**
 * Watches the e2e run's private databases for connections that stay busy (2026-10-24).
 *
 * The suite's worst kind of red is a request that never answers: a page waits ten seconds
 * with no response and no error, then fails on whatever it was waiting to show. One suspect
 * is the API's connection pool — ten connections per stack (`withTestConnectionBudget`) and an
 * inbox that opens ~25 requests at once — but a pool starved by transactions left open, or by
 * a statement stuck behind a lock, leaves no trace anywhere a run keeps. This does: it reads
 * `pg_stat_activity` every quarter second and writes one line for every backend that stayed
 * out of `idle` for more than {@link HELD_SECONDS}, with what it was running and for how long,
 * plus each database's peak connection count.
 *
 * Read-only, on one connection of its own, and never a reason for the run to fail: if it
 * cannot connect it says so once and the run goes on without it. Migrations and the bulk
 * fixtures of a few specs legitimately hold a connection for seconds; the query text says
 * which is which.
 */
import { createWriteStream, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { parseEnv } from 'node:util';

const INTERVAL_MS = 250;
const HELD_SECONDS = 2;

const SQL = `
  SELECT pid, datname, application_name, state, wait_event_type, wait_event,
         state_change, xact_start,
         extract(epoch FROM now() - state_change)::float8 AS state_s,
         left(regexp_replace(query, '\\s+', ' ', 'g'), 300) AS query
  FROM pg_stat_activity
  WHERE datname LIKE 'siyahtus\\_test\\_%' AND pid <> pg_backend_pid()`;

/**
 * Starts the watch; `stop()` flushes and resolves to `{ file, peaks, held }`, where `peaks`
 * maps a database to its highest `{ total, inTransaction }` and `held` counts the lines
 * written. Resolves to null from `stop()` when the watch never started.
 */
export async function startPgWatch({ repoRoot, logDir }) {
  let client;
  try {
    const url = process.env['DATABASE_URL'] ?? rootEnv(repoRoot)['DATABASE_URL'];
    if (!url) throw new Error('no DATABASE_URL in the environment or the root .env');
    const { Client } = createRequire(join(repoRoot, 'apps/api/package.json'))('pg');
    client = new Client({ connectionString: url, application_name: 'e2e-pg-watch' });
    await client.connect();
  } catch (error) {
    console.log(`[e2e] db watch off: ${error instanceof Error ? error.message : String(error)}`);
    return { stop: async () => null };
  }

  const file = join(logDir, 'pg-watch.jsonl');
  const out = createWriteStream(file);
  const peaks = new Map();
  /** Backends past the threshold, by pid and the moment they entered their state. */
  const open = new Map();
  let held = 0;
  let stopped = false;

  const close = (entry) => {
    out.write(`${JSON.stringify(entry)}\n`);
    held += 1;
  };

  const sample = async () => {
    const { rows } = await client.query(SQL);
    const now = new Set();
    const counts = new Map();
    for (const row of rows) {
      const count = counts.get(row.datname) ?? { total: 0, inTransaction: 0 };
      count.total += 1;
      if (row.xact_start) count.inTransaction += 1;
      counts.set(row.datname, count);
      if (row.state === 'idle' || row.state_s <= HELD_SECONDS) continue;
      const key = `${row.pid}:${new Date(row.state_change).toISOString()}`;
      now.add(key);
      const entry = open.get(key) ?? {
        since: new Date(row.state_change).toISOString(),
        database: row.datname,
        pid: row.pid,
        application: row.application_name || undefined,
        state: row.state,
        query: row.query,
      };
      entry.seconds = Math.round(row.state_s * 10) / 10;
      entry.wait = row.wait_event_type ? `${row.wait_event_type}/${row.wait_event}` : undefined;
      open.set(key, entry);
    }
    for (const [key, entry] of open) {
      if (now.has(key)) continue;
      open.delete(key);
      close(entry);
    }
    for (const [database, count] of counts) {
      const peak = peaks.get(database) ?? { total: 0, inTransaction: 0 };
      peaks.set(database, {
        total: Math.max(peak.total, count.total),
        inTransaction: Math.max(peak.inTransaction, count.inTransaction),
      });
    }
  };

  const loop = (async () => {
    while (!stopped) {
      const started = Date.now();
      try {
        await sample();
      } catch {
        // A missed sample is not worth stopping the watch for.
      }
      await new Promise((resolve) =>
        setTimeout(resolve, Math.max(0, INTERVAL_MS - (Date.now() - started))),
      );
    }
  })();

  return {
    stop: async () => {
      stopped = true;
      await loop;
      for (const entry of open.values()) close({ ...entry, stillOpen: true });
      await new Promise((resolve) => out.end(resolve));
      await client.end().catch(() => {});
      return { file, peaks, held };
    },
  };
}

function rootEnv(repoRoot) {
  try {
    return parseEnv(readFileSync(join(repoRoot, '.env'), 'utf8'));
  } catch {
    return {};
  }
}
