/**
 * Measures what actually happens when several `prisma migrate deploy` processes
 * start against one database at the same instant.
 *
 *     pnpm --filter @nexa/api measure:concurrent-migrate [processes]
 *
 * This exists because tm 164.3 had to choose where migrations run in a
 * multi-replica deployment (a Helm hook Job vs. a per-pod init-container vs. the
 * inline `apps/api/docker-entrypoint.sh` step this repo shipped first), and the
 * usual argument for leaving the inline step alone is a claim about a vendor's
 * behaviour: "Prisma takes an advisory lock, so the losers just wait." That
 * claim is checkable, and checking it is what decided the task — the wait turns
 * out to be *bounded*, and the bound is the whole risk.
 *
 * Three scenarios, because the decision turns on the difference between them:
 *
 *  1. **Cold** — an empty database, every migration to apply. A first install,
 *     and the longest this repo's own migration set ever holds the lock.
 *  2. **Warm** — the same database immediately after, nothing left to apply.
 *     The common case: a rollout, a scale-up, a restarting pod.
 *  3. **Contended** — an outside session holds the lock for longer than Prisma
 *     is willing to wait. This is the shape of a *slow* migration (a large
 *     index build) seen from the other replicas, and it is the one that fails.
 *
 * Nothing here connects to a cluster and nothing is deployed; it is a local
 * measurement whose numbers land in PLAN.md's KM-IAC block and whose conclusion
 * is CONVENTIONS §6.
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
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

/**
 * The key Prisma's migration engine locks on, observed rather than looked up:
 * during a cold migrate `pg_locks` shows exactly one advisory lock
 * (`classid 0 / objid 72707369 / ExclusiveLock`), and the P1002 error text names
 * the statement it came from. Scenario 3 takes that same lock from an ordinary
 * session, which is why it is able to lock the migration out.
 */
const PRISMA_ADVISORY_LOCK_KEY = 72_707_369;

/** How long scenario 3 holds the lock — comfortably past Prisma's own 10 s wait. */
const CONTENDED_HOLD_MS = 15_000;

interface Attempt {
  label: string;
  exitCode: number;
  durationMs: number;
  /** What the run says it did — classified from its output, not guessed. */
  outcome: string;
  output: string;
}

/** How many migrations a run reports having applied. */
function appliedCount(output: string): number {
  return output.match(/^Applying migration /gm)?.length ?? 0;
}

/**
 * Reads a run's own account of itself out of its output.
 *
 * The exit code alone cannot tell "applied the migrations" from "found nothing
 * to do", and that difference is the whole question: if every loser reports a
 * no-op then the lock serialised them; if one reports a lock timeout then the
 * lock did not hold long enough, which is the failure this task is about.
 */
function classify(exitCode: number, output: string): string {
  if (exitCode !== 0) {
    if (/advisory lock/i.test(output)) return 'FAILED: advisory lock timeout (P1002)';
    if (/P3009|failed migrations?/i.test(output)) return 'FAILED: migration state';
    return 'FAILED';
  }
  const applied = appliedCount(output);
  if (applied > 0) return `applied ${applied} migration(s)`;
  if (/No pending migrations to apply/i.test(output)) return 'no-op (nothing pending)';
  return 'ok (no migration applied)';
}

function deploy(databaseUrl: string, label: string): Promise<Attempt> {
  const startedAt = Date.now();
  return new Promise((resolvePromise) => {
    const child = spawn(process.execPath, [prismaCli, 'migrate', 'deploy'], {
      cwd: apiRoot,
      // No version check: this must work offline, and a network round trip has
      // no business inside a measured lock wait (same reason as
      // scripts/test-datastores.ts).
      env: { ...process.env, DATABASE_URL: databaseUrl, CHECKPOINT_DISABLE: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let output = '';
    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.on('close', (code) => {
      const exitCode = code ?? 1;
      resolvePromise({
        label,
        exitCode,
        durationMs: Date.now() - startedAt,
        outcome: classify(exitCode, output),
        output,
      });
    });
  });
}

/** Starts every process before awaiting any of them — otherwise there is no race. */
async function race(databaseUrl: string, processes: number): Promise<Attempt[]> {
  const running = Array.from({ length: processes }, (_, index) =>
    deploy(databaseUrl, `process ${index + 1}`),
  );
  return Promise.all(running);
}

function report(title: string, attempts: Attempt[]): void {
  console.log(`\n=== ${title} ===`);
  for (const attempt of attempts) {
    console.log(
      `  ${attempt.label}: exit ${attempt.exitCode} · ${attempt.durationMs} ms · ${attempt.outcome}`,
    );
  }
  for (const attempt of attempts.filter((one) => one.exitCode !== 0)) {
    const tail = attempt.output.trim().split('\n').slice(-6).join('\n');
    console.log(`  --- ${attempt.label} output (tail) ---\n${tail}`);
  }
}

/**
 * Scenario 3: hold the lock from an ordinary session, then try to migrate.
 *
 * `connection_limit=1` matters — a session-level advisory lock belongs to the
 * connection that took it, so the holder must not be able to release it by
 * handing the next statement to a different pooled connection.
 */
async function contended(scratchUrl: string): Promise<Attempt> {
  const holderUrl = new URL(scratchUrl);
  holderUrl.searchParams.set('connection_limit', '1');
  const holder = new PrismaClient({ datasourceUrl: holderUrl.toString() });
  await holder.$executeRawUnsafe(`SELECT pg_advisory_lock(${PRISMA_ADVISORY_LOCK_KEY})`);
  const release = setTimeout(() => {
    void holder.$executeRawUnsafe(`SELECT pg_advisory_unlock(${PRISMA_ADVISORY_LOCK_KEY})`);
  }, CONTENDED_HOLD_MS);
  try {
    return await deploy(scratchUrl, 'process 1 (lock held elsewhere)');
  } finally {
    clearTimeout(release);
    await holder.$disconnect().catch(() => undefined);
  }
}

async function main(): Promise<number> {
  const processes = Number(process.argv[2] ?? '2');
  if (!Number.isInteger(processes) || processes < 2) {
    console.error('usage: measure-concurrent-migrate.ts [processes >= 2]');
    return 2;
  }

  const ownerUrl = process.env['DATABASE_URL'];
  if (!ownerUrl) throw new Error('DATABASE_URL must be set (see .env / .env.example)');

  // Minted with the same `nexa_test_` prefix the test harness uses, so a window
  // that dies mid-measurement leaves behind a database the next test run sweeps
  // rather than an orphan nobody owns.
  const databaseName = isolatedDatabaseName();
  const admin = new PrismaClient({ datasourceUrl: adminUrl(ownerUrl) });
  const scratchUrl = withDatabaseName(ownerUrl, databaseName);

  console.log(`scratch database: ${databaseName} · ${processes} concurrent processes`);
  await admin.$executeRawUnsafe(`CREATE DATABASE "${databaseName}"`);

  try {
    const cold = await race(scratchUrl, processes);
    report(`1. cold — empty database, ${processes} processes at once`, cold);

    const warm = await race(scratchUrl, processes);
    report(`2. warm — already migrated, ${processes} processes at once`, warm);

    const held = await contended(scratchUrl);
    report(`3. contended — lock held elsewhere for ${CONTENDED_HOLD_MS} ms`, [held]);

    const appliedTotal = cold.concat(warm).reduce((sum, one) => sum + appliedCount(one.output), 0);
    const found = Number(/(\d+) migrations found/.exec(cold[0]?.output ?? '')?.[1] ?? '0');
    const eachOnce = found > 0 && appliedTotal === found;
    console.log(
      `\nmigrations found: ${found} · applied across every racing process: ${appliedTotal}` +
        (eachOnce ? ' (each applied exactly once)' : ' (MISMATCH)'),
    );

    const unexpected = cold.concat(warm).filter((one) => one.exitCode !== 0);
    console.log(
      unexpected.length === 0
        ? 'races 1-2: every process exited 0'
        : `races 1-2: ${unexpected.length} process(es) failed`,
    );
    // Scenario 3 is *expected* to fail — that is the finding, not a broken run.
    console.log(
      held.exitCode === 0
        ? 'race 3: the held lock did NOT stop the migration — re-read CONVENTIONS §6, it assumes otherwise'
        : `race 3: exited ${held.exitCode} after ${held.durationMs} ms — the wait is bounded`,
    );
    return unexpected.length === 0 && eachOnce ? 0 : 1;
  } finally {
    assertDroppableDatabaseName(databaseName);
    await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
    await admin.$disconnect().catch(() => undefined);
  }
}

main()
  .then((code) => process.exit(code))
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
