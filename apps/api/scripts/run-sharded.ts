/**
 * Runs a vitest command as several shards at once, each against its own
 * isolated datastores.
 *
 *     tsx scripts/run-sharded.ts [--jobs=N] [--shards=M] vitest run --dir test/integration
 *
 * Why this is safe. `vitest.config.ts` keeps `fileParallelism: false` because
 * the files of *one* run share one database and truncate it between suites.
 * Two *runs* do not share anything: `with-test-datastores.ts` gives each its own
 * Postgres database, its own Redis index and a disjoint licence-id range (that
 * is what lets two windows test at the same time — tm 105). A shard is just
 * another run, so N shards of the suite are N runs that cannot see each other.
 *
 * Why it matters. The API integration suite is ~160 files run one after another,
 * well past a window's 10-minute command ceiling, which is why CONVENTIONS §1.3
 * had windows shard it by hand and run the parts one by one. This does the same
 * split but runs the parts side by side.
 *
 * How files are split. vitest's own `--shard` assigns files by hash, and the
 * suite is lopsided — `reports-billing.test.ts` alone is over two minutes — so a
 * hash split leaves one shard running long after the others. Every run therefore
 * records each file's duration (`node_modules/.cache/run-sharded/timings.json`,
 * parsed from vitest's per-file lines), and the next run deals the files out
 * longest-first onto whichever shard has the least work so far: one shard per
 * job, all finishing at about the same time. Until those timings exist — first
 * run, fresh clone, CI — it falls back to `--shard` with two shards per job,
 * drained from a queue. A stale or partial timings file only costs balance, never
 * coverage: the file list always comes from `vitest list`, and a file with no
 * timing is assumed to take the median.
 *
 * A shard's files reach vitest through `SIYAHTUS_TEST_FILES`, which
 * `vitest.config.ts` turns into an exact `include` — not as positional filters.
 * Those are substring matches on the path below `--dir`: measured, handing a
 * shard `agent-profile.test.ts` also ran `ai-agent-profile.test.ts`, and six
 * files ran twice (164 files reported for a 158-file suite).
 *
 * Each shard's output goes to its own log file — interleaved vitest output from
 * five processes is unreadable — and is summarised when the shard ends; a red
 * shard's log is printed in full. The exit code is non-zero if any shard failed.
 *
 * Concurrency: `--jobs`, else `SIYAHTUS_TEST_JOBS`, else a quarter of the CPUs
 * (owner decision 2026-10-07: speed over machine load; 5 on the 20-core dev
 * box). Capped at 6 — a shard is a vitest process plus Postgres work plus, in
 * some files, spawned servers. Where that comes out as 1 — a small CI runner —
 * or when the command already carries its own
 * `--shard`, the command runs exactly as it did before this script: one process,
 * output straight through.
 */
import { spawn, spawnSync } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { availableParallelism, tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const harness = resolve(dirname(fileURLToPath(import.meta.url)), 'with-test-datastores.ts');
const timingsFile = resolve('node_modules/.cache/run-sharded/timings.json');

/** Every shard holds one of the fifteen Redis test slots; leave room for other windows. */
const MAX_JOBS = 6;

/**
 * Owner decision 2026-10-07: parallel by default, the machine may be used in
 * full (supersedes the 2026-10-03 serial default). `--jobs=1` still runs serial.
 */
const DEFAULT_JOBS = Math.max(1, Math.floor(availableParallelism() / 4));

/** Windows caps the whole environment block at 32767 characters; one variable stays well below. */
const MAX_FILE_LIST = 16_000;

interface Options {
  jobs: number;
  shards: number | undefined;
  command: string[];
}

function positiveInt(name: string, raw: string | undefined): number | undefined {
  if (raw === undefined || raw === '') return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    console.error(`run-sharded: ${name} must be a positive integer, got "${raw}"`);
    process.exit(2);
  }
  return value;
}

function parseOptions(argv: string[]): Options {
  let jobs: number | undefined;
  let shards: number | undefined;
  let index = 0;
  for (; index < argv.length; index += 1) {
    const match = /^--(jobs|shards)=(.*)$/.exec(argv[index]!);
    if (!match) break;
    if (match[1] === 'jobs') jobs = positiveInt('--jobs', match[2]);
    else shards = positiveInt('--shards', match[2]);
  }
  const command = argv.slice(index);
  if (command.length === 0) {
    console.error('usage: run-sharded.ts [--jobs=N] [--shards=M] <vitest command...>');
    process.exit(2);
  }

  jobs ??= positiveInt('SIYAHTUS_TEST_JOBS', process.env['SIYAHTUS_TEST_JOBS']) ?? DEFAULT_JOBS;
  return { jobs: Math.min(jobs, MAX_JOBS), shards, command };
}

function harnessProcess(args: string[], stdio: 'inherit' | 'pipe', env: NodeJS.ProcessEnv = {}) {
  // `--import tsx` rather than the `tsx` shim: the shim is a `.cmd` on Windows,
  // which cannot be spawned without a shell (see `with-test-datastores.ts`).
  return spawn(process.execPath, ['--import', 'tsx', harness, ...args], {
    stdio: stdio === 'inherit' ? 'inherit' : ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ...env },
  });
}

function runDirect(command: string[]): Promise<number> {
  return new Promise((resolvePromise) => {
    const child = harnessProcess(command, 'inherit');
    child.on('error', () => resolvePromise(1));
    child.on('close', (code) => resolvePromise(code ?? 1));
  });
}

// ---------------------------------------------------------------------------
// Planning: which files go to which shard
// ---------------------------------------------------------------------------

/** A shard is either a vitest hash shard or an explicit list of files. */
type Shard =
  { id: number; hashShard: string } | { id: number; files: string[]; expectedMs: number };

const posix = (path: string): string => path.replace(/\\/g, '/');

/** The files `command` would run, relative to the package, via `vitest list`. */
function listFiles(command: string[]): string[] | undefined {
  if (command[0] !== 'vitest' || command[1] !== 'run') return undefined;
  const vitestBin = join(
    dirname(createRequire(join(process.cwd(), 'package.json')).resolve('vitest/package.json')),
    'vitest.mjs',
  );
  const listed = spawnSync(
    process.execPath,
    [vitestBin, 'list', '--filesOnly', '--json', ...command.slice(2)],
    { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
  );
  if (listed.status !== 0) return undefined;
  try {
    const entries = JSON.parse(listed.stdout) as Array<{ file: string }>;
    return entries.map((entry) => posix(relative(process.cwd(), entry.file))).sort();
  } catch {
    return undefined;
  }
}

function readTimings(): Record<string, number> {
  try {
    return JSON.parse(readFileSync(timingsFile, 'utf8')) as Record<string, number>;
  } catch {
    return {};
  }
}

function writeTimings(measured: Record<string, number>): void {
  if (Object.keys(measured).length === 0) return;
  mkdirSync(dirname(timingsFile), { recursive: true });
  writeFileSync(timingsFile, `${JSON.stringify({ ...readTimings(), ...measured }, null, 2)}\n`);
}

/** Longest-first onto the least-loaded shard. */
function planByTimings(command: string[], jobs: number): Shard[] | undefined {
  const files = listFiles(command);
  if (!files || files.length < jobs) return undefined;

  const timings = readTimings();
  const known = files.map((f) => timings[f]).filter((ms): ms is number => ms !== undefined);
  // Mostly unknown means the cache is from another suite or long out of date.
  if (known.length < files.length / 2) return undefined;

  const median = known.sort((a, b) => a - b)[Math.floor(known.length / 2)]!;
  const bins = Array.from({ length: jobs }, (_, i) => ({
    id: i + 1,
    files: [] as string[],
    expectedMs: 0,
  }));
  const byDuration = [...files].sort((a, b) => (timings[b] ?? median) - (timings[a] ?? median));
  for (const file of byDuration) {
    const lightest = bins.reduce((min, bin) => (bin.expectedMs < min.expectedMs ? bin : min));
    lightest.files.push(file);
    lightest.expectedMs += timings[file] ?? median;
  }
  const longest = Math.max(...bins.map((bin) => bin.files.join(',').length));
  return longest > MAX_FILE_LIST ? undefined : bins;
}

function planByHash(shards: number): Shard[] {
  return Array.from({ length: shards }, (_, i) => ({ id: i + 1, hashShard: `${i + 1}/${shards}` }));
}

// ---------------------------------------------------------------------------
// Running
// ---------------------------------------------------------------------------

interface Count {
  passed: number;
  failed: number;
  skipped: number;
  total: number;
}

interface ShardResult {
  shard: Shard;
  code: number;
  seconds: number;
  log: string;
  files: Count;
  tests: Count;
  timings: Record<string, number>;
}

// The escape character is the point: vitest colours its summary lines.
// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;]*m/g;

/** Reads vitest's `Test Files  3 failed | 12 passed (15)` style summary line. */
function parseCount(lines: string[], label: 'Test Files' | 'Tests'): Count {
  const count: Count = { passed: 0, failed: 0, skipped: 0, total: 0 };
  const line = [...lines].reverse().find((l) => l.startsWith(`${label} `));
  if (!line) return count;
  for (const [, n, kind] of line.matchAll(/(\d+) (passed|failed|skipped|todo)/g)) {
    if (kind === 'passed') count.passed += Number(n);
    else if (kind === 'failed') count.failed += Number(n);
    else count.skipped += Number(n);
  }
  const total = /\((\d+)\)\s*$/.exec(line);
  count.total = total ? Number(total[1]) : count.passed + count.failed + count.skipped;
  return count;
}

/** vitest's per-file line: `✓ test/integration/scim.test.ts (123 tests) 32609ms`. */
function parseFileTimings(lines: string[]): Record<string, number> {
  const timings: Record<string, number> = {};
  for (const line of lines) {
    const match = /^[✓❯×]\s+(\S+\.(?:test|spec)\.[cm]?[jt]sx?)\s+\(.*\)\s+(\d+)ms$/.exec(line);
    if (match) timings[posix(match[1]!)] = Number(match[2]);
  }
  return timings;
}

/** Drops `--dir <path>` / `--dir=<path>`. */
function withoutDir(command: string[]): string[] {
  const kept: string[] = [];
  for (let i = 0; i < command.length; i += 1) {
    if (command[i] === '--dir') i += 1;
    else if (!command[i]!.startsWith('--dir=')) kept.push(command[i]!);
  }
  return kept;
}

const shardName = (shard: Shard, of: number): string => `${shard.id}/${of}`;

function runShard(
  command: string[],
  shard: Shard,
  of: number,
  logDir: string,
): Promise<ShardResult> {
  const log = join(logDir, `shard-${String(shard.id).padStart(2, '0')}-of-${of}.log`);
  const out = createWriteStream(log);
  // An explicit file list replaces `--dir`: `include` is resolved from the package root.
  const args =
    'hashShard' in shard ? [...command, `--shard=${shard.hashShard}`] : withoutDir(command);
  const env = 'files' in shard ? { SIYAHTUS_TEST_FILES: shard.files.join(',') } : {};
  const prefix = 'files' in shard ? `SIYAHTUS_TEST_FILES=${shard.files.join(',')} ` : '';
  out.write(`# ${prefix}${args.join(' ')}\n\n`);
  const started = Date.now();
  return new Promise((resolvePromise) => {
    const child = harnessProcess(args, 'pipe', env);
    child.stdout?.pipe(out, { end: false });
    child.stderr?.pipe(out, { end: false });
    const finish = (code: number): void => {
      out.end(() => {
        const lines = readFileSync(log, 'utf8')
          .split(/\r?\n/)
          .map((l) => l.replace(ANSI, '').trim());
        resolvePromise({
          shard,
          code,
          seconds: Math.round((Date.now() - started) / 1000),
          log,
          files: parseCount(lines, 'Test Files'),
          tests: parseCount(lines, 'Tests'),
          timings: parseFileTimings(lines),
        });
      });
    };
    child.on('error', (error) => {
      out.write(`\nrun-sharded: could not start shard: ${error.message}\n`);
      finish(1);
    });
    child.on('close', (code) => finish(code ?? 1));
  });
}

function describe(count: Count): string {
  const parts = [`${count.passed} passed`];
  if (count.failed) parts.push(`${count.failed} failed`);
  if (count.skipped) parts.push(`${count.skipped} skipped`);
  return `${parts.join(' | ')} (${count.total})`;
}

function add(a: Count, b: Count): Count {
  return {
    passed: a.passed + b.passed,
    failed: a.failed + b.failed,
    skipped: a.skipped + b.skipped,
    total: a.total + b.total,
  };
}

async function runSharded(
  command: string[],
  jobs: number,
  plan: Shard[],
  how: string,
): Promise<number> {
  const label = basename(process.cwd());
  const logDir = join(
    tmpdir(),
    'siyahtus-test-shards',
    `${label}-${new Date().toISOString().replace(/[:.]/g, '-')}`,
  );
  mkdirSync(logDir, { recursive: true });
  const of = plan.length;
  jobs = Math.min(jobs, of);
  console.log(
    `[run-sharded] ${label}: ${of} shards (${how}), ${jobs} at a time — logs in ${logDir}`,
  );

  const started = Date.now();
  const queue = [...plan];
  const results: ShardResult[] = [];

  const worker = async (): Promise<void> => {
    for (let shard = queue.shift(); shard !== undefined; shard = queue.shift()) {
      const result = await runShard(command, shard, of, logDir);
      results.push(result);
      const verdict = result.code === 0 ? 'passed' : `FAILED (exit ${result.code})`;
      console.log(
        `[run-sharded] shard ${shardName(shard, of)} ${verdict} in ${result.seconds}s — ` +
          `files ${describe(result.files)} · tests ${describe(result.tests)}`,
      );
      if (result.code !== 0) {
        console.log(`----- shard ${shardName(shard, of)} log (${result.log}) -----`);
        console.log(readFileSync(result.log, 'utf8'));
        console.log(`----- end of shard ${shardName(shard, of)} -----`);
      }
    }
  };
  await Promise.all(Array.from({ length: jobs }, () => worker()));

  writeTimings(Object.assign({}, ...results.map((r) => r.timings)) as Record<string, number>);

  results.sort((a, b) => a.shard.id - b.shard.id);
  const zero: Count = { passed: 0, failed: 0, skipped: 0, total: 0 };
  const files = results.reduce((sum, r) => add(sum, r.files), zero);
  const tests = results.reduce((sum, r) => add(sum, r.tests), zero);
  const failed = results.filter((r) => r.code !== 0);
  const seconds = Math.round((Date.now() - started) / 1000);
  const slowest = results.reduce((max, r) => Math.max(max, r.seconds), 0);

  console.log('');
  console.log(`[run-sharded] ${label}: ${failed.length === 0 ? 'ALL GREEN' : 'RED'}`);
  console.log(`  Test Files  ${describe(files)}`);
  console.log(`  Tests       ${describe(tests)}`);
  console.log(`  Wall clock  ${seconds}s (${jobs} jobs × ${of} shards, slowest ${slowest}s)`);
  if (failed.length > 0) {
    console.log(`  Red shards  ${failed.map((r) => shardName(r.shard, of)).join(', ')}`);
    console.log('  Re-run one  the first line of its log is the exact command, run it through');
    console.log('              tsx scripts/with-test-datastores.ts <that command>');
  }
  return failed.length === 0 ? 0 : 1;
}

async function main(): Promise<number> {
  const { jobs, shards, command } = parseOptions(process.argv.slice(2));
  if (command.some((arg) => arg.startsWith('--shard')) || (jobs === 1 && shards === undefined)) {
    return runDirect(command);
  }
  if (shards !== undefined) {
    return shards === 1
      ? runDirect(command)
      : runSharded(command, jobs, planByHash(shards), 'by hash');
  }
  const byTimings = existsSync(timingsFile) ? planByTimings(command, jobs) : undefined;
  return byTimings
    ? runSharded(command, jobs, byTimings, 'balanced by recorded file timings')
    : runSharded(command, jobs, planByHash(jobs * 2), 'by hash — no usable timings yet');
}

process.exitCode = await main();
