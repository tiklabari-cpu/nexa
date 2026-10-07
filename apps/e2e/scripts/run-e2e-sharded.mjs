/**
 * The e2e suite on several private stacks at once (tm 260.2).
 *
 *     pnpm test:e2e                     # N shards, N from the machine (below)
 *     pnpm test:e2e --shards=3          # or SIYAHTUS_E2E_SHARDS=3
 *     pnpm test:e2e:private             # one private stack (= --shards=1)
 *     pnpm test:e2e --legacy            # the old single stack on the usual ports
 *     pnpm test:e2e widget inbox-tabs   # only spec files whose name contains a word
 *     pnpm test:e2e --plan              # print the split and stop
 *
 * Why. The suite runs one file after another (`workers: 1`) because its specs
 * share one seeded workspace; 321 tests took 23.5 minutes that way, and every
 * task's DoD gate runs all of them (tm 260, owner decision 2026-10-07). Workers
 * inside one stack would still share that workspace. Whole stacks do not: each
 * shard is `playwright.config.ts` with `SIYAHTUS_E2E_SHARD=i` — its own servers
 * on its own ports, its own database and Redis index from
 * `apps/api/scripts/with-test-datastores.ts`, seeded by the global setup — so a
 * shard is exactly the old run, over fewer files.
 *
 * The split. Files, never tests: a spec file's tests may lean on each other's
 * order, and the old run never separated them either. Longest-first onto the
 * least-loaded shard (LPT), weighted by each file's duration in the last run
 * that measured it (`node_modules/.cache/run-e2e-sharded/timings.json`, written
 * from the shards' JSON reports); a file with no timing yet is weighted by its
 * test count. `zz-suite-state.spec.ts`, the suite's end-of-run sentinel
 * (tm 247), runs last in every shard, because every shard is a whole workspace
 * whose invariants it guards — so the total test count is the listed count plus
 * one sentinel per extra shard, and the summary says so.
 *
 * How many. Memory is the limit on this kind of machine, not cores: a stack is
 * six servers and a Chromium, and a host that starts paging freezes a dev
 * server long enough to fail tests at random. The default is what the free
 * memory at start allows (`SHARD_MEMORY_GB` each, with `RESERVE_GB` left over),
 * capped at `DEFAULT_MAX_SHARDS`; the run reports the lowest free memory it saw.
 * Measured on the 15.6 GB development machine (tm 260.5): a stack started
 * without pnpm wrappers takes ~1.1 GB while it runs — two of them left 2.8 GB
 * free from 5 GB, where the same two through pnpm left 0.8 GB and paged at
 * 1,800 pages/s. In CI, without an explicit count, the old single
 * stack runs (`--legacy`) — the runner there is small and the workflow's
 * services are the usual ports.
 *
 * Output. Each shard's output streams with a `[e2e:i]` prefix and is kept in a
 * log under the OS temp directory; each shard has its own HTML report
 * (`playwright-report/shard-i`) and results (`test-results/shard-i`). The last
 * lines are one row per shard and a total. A red shard does not stop the
 * others; the exit code is 1 if any shard was red or reported fewer tests than
 * it was given.
 */
import { spawn, spawnSync } from 'node:child_process';
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { freemem, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const e2eDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(e2eDir, '../..');

/** Mirrors `MAX_E2E_SHARDS` in `tests/stack-ports.ts` — the ports stop there. */
const MAX_SHARDS = 6;
/** The default never goes past this; more needs `--shards`. */
const DEFAULT_MAX_SHARDS = 3;
/** Free memory one shard is budgeted at, and what is kept back for everything else. */
const SHARD_MEMORY_GB = 1.25;
const RESERVE_GB = 0.5;
/** Seconds between shard starts, so N stacks do not cold-start in the same instant. */
const STAGGER_S = 15;
const SENTINEL = 'zz-suite-state.spec.ts';
const TIMINGS_FILE = join(e2eDir, 'node_modules/.cache/run-e2e-sharded/timings.json');
const GB = 1024 ** 3;
/** The two programs a shard runs, relative to `apps/e2e`. */
const API_TSX = '../api/node_modules/tsx/dist/cli.mjs';
const PLAYWRIGHT_CLI = 'node_modules/@playwright/test/cli.js';

// --- arguments ----------------------------------------------------------------

const argv = process.argv.slice(2).filter((arg) => arg !== '--');
const flag = (name) => argv.find((arg) => arg === name || arg.startsWith(`${name}=`));
const flagValue = (name) => flag(name)?.split('=')[1];
const words = argv.filter((arg) => !arg.startsWith('--'));
const unknown = argv.filter(
  (arg) => arg.startsWith('--') && !/^--(shards=\d+|legacy|plan)$/.test(arg),
);
if (unknown.length > 0) {
  console.error(`run-e2e-sharded: unknown option ${unknown.join(' ')}`);
  process.exit(2);
}

const explicitShards = flagValue('--shards') ?? process.env['SIYAHTUS_E2E_SHARDS'];
const legacy =
  flag('--legacy') !== undefined || (process.env['CI'] && explicitShards === undefined);

if (legacy) {
  // The old run, unchanged: `playwright.config.ts` with no shard, the usual
  // ports, the shared seeded database, and locally whatever dev servers hold
  // the ports.
  console.log('[e2e] single shared stack on the usual ports (--legacy)');
  const filters = words;
  const result = spawnSync(
    ['pnpm', '--filter', '@siyahtus/e2e', 'exec', 'playwright', 'test', ...filters].join(' '),
    { cwd: repoRoot, stdio: 'inherit', shell: true },
  );
  process.exit(result.status ?? 1);
}

const shards = shardCount();

// --- the split ----------------------------------------------------------------

const listed = listTests();
const files = [...listed.keys()]
  .filter((file) => words.length === 0 || words.some((word) => file.includes(word)))
  .sort();
if (files.length === 0) {
  console.error(`run-e2e-sharded: no spec file matches ${words.join(' ')}`);
  process.exit(2);
}
const timings = readTimings();
const plan = split(files, shards);
const used = plan.filter((shard) => shard.files.length > 0);

console.log(
  `[e2e] ${used.length} private stack(s) · ${files.length} files · ${sum(files.map((f) => listed.get(f)))} tests listed · free memory ${(freemem() / GB).toFixed(1)} GB`,
);
for (const [i, shard] of used.entries()) {
  console.log(
    `[e2e] shard ${i}: ${shard.files.length} files, ${shard.tests} tests, ~${formatDuration(shard.load)} — ${shard.files.join(' ')}`,
  );
}
if (flag('--plan') !== undefined) process.exit(0);

// --- the run ------------------------------------------------------------------

const logDir = join(
  tmpdir(),
  'siyahtus-e2e-shards',
  new Date().toISOString().replace(/[:.]/g, '-'),
);
mkdirSync(logDir, { recursive: true });
console.log(`[e2e] logs in ${logDir}`);

let lowestFreeGb = freemem() / GB;
const memoryWatch = setInterval(() => {
  lowestFreeGb = Math.min(lowestFreeGb, freemem() / GB);
}, 2_000);

const children = new Set();
const stop = () => {
  for (const child of children) killTree(child);
  process.exit(130);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

const started = Date.now();
const results = await Promise.all(
  used.map((shard, i) => delay(i * STAGGER_S * 1000).then(() => runShard(i, shard))),
);
clearInterval(memoryWatch);
const wall = Math.round((Date.now() - started) / 1000);

updateTimings(results);
process.exitCode = summarize(results, wall);

// --- helpers --------------------------------------------------------------------

function shardCount() {
  if (explicitShards !== undefined) {
    const n = Number(explicitShards);
    if (!Number.isInteger(n) || n < 1 || n > MAX_SHARDS) {
      console.error(`run-e2e-sharded: shards must be 1-${MAX_SHARDS}, not "${explicitShards}"`);
      process.exit(2);
    }
    return n;
  }
  const byMemory = Math.floor((freemem() / GB - RESERVE_GB) / SHARD_MEMORY_GB);
  return Math.max(1, Math.min(DEFAULT_MAX_SHARDS, byMemory));
}

/** spec file (relative to `tests/`) → number of tests, from Playwright's own listing. */
function listTests() {
  const env = { ...process.env };
  delete env['SIYAHTUS_E2E_SHARD'];
  const result = spawnSync(`node ${PLAYWRIGHT_CLI} test --list --reporter=json`, {
    cwd: e2eDir,
    env,
    shell: true,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  const out = result.stdout ?? '';
  const start = out.indexOf('{');
  if (result.status !== 0 || start < 0) {
    console.error(`run-e2e-sharded: could not list the suite\n${out}\n${result.stderr ?? ''}`);
    process.exit(1);
  }
  const report = JSON.parse(out.slice(start));
  const counts = new Map();
  const walk = (suite, file) => {
    const owner = suite.file ?? file;
    for (const spec of suite.specs ?? []) {
      counts.set(owner, (counts.get(owner) ?? 0) + (spec.tests?.length ?? 1));
    }
    for (const child of suite.suites ?? []) walk(child, owner);
  };
  for (const suite of report.suites ?? []) walk(suite, suite.file);
  return counts;
}

function readTimings() {
  try {
    return JSON.parse(readFileSync(TIMINGS_FILE, 'utf8'));
  } catch {
    return {};
  }
}

/** Longest-first onto the least-loaded shard; the sentinel last in each. */
function split(all, n) {
  const measured = Object.values(timings).filter((t) => t.tests > 0);
  const perTest =
    measured.length > 0
      ? sum(measured.map((t) => t.seconds)) / sum(measured.map((t) => t.tests))
      : 4.4; // 23.5 min / 321 tests, the single-stack baseline (tm 260)
  const weight = (file) => timings[file]?.seconds ?? (listed.get(file) ?? 1) * perTest;
  const bins = Array.from({ length: n }, () => ({ files: [], load: 0, tests: 0 }));
  const work = all.filter((file) => file !== SENTINEL).sort((a, b) => weight(b) - weight(a));
  for (const file of work) {
    const bin = bins.reduce((least, b) => (b.load < least.load ? b : least));
    bin.files.push(file);
    bin.load += weight(file);
    bin.tests += listed.get(file) ?? 0;
  }
  if (all.includes(SENTINEL)) {
    for (const bin of bins.filter((b) => b.files.length > 0)) {
      bin.files.push(SENTINEL);
      bin.load += weight(SENTINEL);
      bin.tests += listed.get(SENTINEL) ?? 0;
    }
  }
  for (const bin of bins) bin.files.sort();
  return bins;
}

function runShard(i, shard) {
  const log = join(logDir, `shard-${i}.log`);
  const out = createWriteStream(log);
  const report = join(e2eDir, 'test-results', `shard-${i}.json`);
  rmSync(report, { force: true });
  const filters = shard.files.map((file) => `tests/${file}`);
  // The same wrapper `test:e2e:pilot` uses: a private database and Redis index,
  // dropped afterwards, with the root `.env` loaded. Called straight through
  // `node` rather than `pnpm … exec`: each pnpm is ~110 MB held for the whole
  // run, per shard (see `server()` in `playwright.config.ts`).
  const command = [
    `node ${API_TSX} ../api/scripts/with-test-datastores.ts`,
    `node ${PLAYWRIGHT_CLI} test`,
    ...filters,
  ].join(' ');
  const shardStarted = Date.now();
  console.log(`[e2e:${i}] starting (${shard.files.length} files, ${shard.tests} tests)`);
  return new Promise((resolvePromise) => {
    const child = spawn(command, {
      cwd: e2eDir,
      shell: true,
      env: { ...process.env, SIYAHTUS_E2E_SHARD: String(i), FORCE_COLOR: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    children.add(child);
    const prefix = (stream) => {
      let pending = '';
      stream.on('data', (chunk) => {
        out.write(chunk);
        pending += chunk.toString();
        const lines = pending.split(/\r?\n/);
        pending = lines.pop() ?? '';
        for (const line of lines) if (line.trim()) console.log(`[e2e:${i}] ${line}`);
      });
    };
    prefix(child.stdout);
    prefix(child.stderr);
    child.on('close', (code) => {
      children.delete(child);
      out.end();
      const seconds = Math.round((Date.now() - shardStarted) / 1000);
      resolvePromise({ i, shard, code: code ?? 1, seconds, log, stats: readReport(report) });
    });
  });
}

/** A shard's JSON report: counts and per-file durations, or null if it never got that far. */
function readReport(path) {
  if (!existsSync(path)) return null;
  const report = JSON.parse(readFileSync(path, 'utf8'));
  const perFile = new Map();
  const walk = (suite, file) => {
    const owner = suite.file ?? file;
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests ?? []) {
        const seconds = sum((test.results ?? []).map((r) => r.duration ?? 0)) / 1000;
        const entry = perFile.get(owner) ?? { seconds: 0, tests: 0 };
        entry.seconds += seconds;
        entry.tests += 1;
        perFile.set(owner, entry);
      }
    }
    for (const child of suite.suites ?? []) walk(child, owner);
  };
  for (const suite of report.suites ?? []) walk(suite, suite.file);
  const s = report.stats ?? {};
  return {
    passed: s.expected ?? 0,
    failed: s.unexpected ?? 0,
    flaky: s.flaky ?? 0,
    skipped: s.skipped ?? 0,
    perFile,
  };
}

function updateTimings(all) {
  const next = { ...timings };
  for (const result of all) {
    // Only a green shard's durations: a red test's time is its timeout.
    if (result.code !== 0 || !result.stats) continue;
    for (const [file, entry] of result.stats.perFile) next[file] = entry;
  }
  mkdirSync(dirname(TIMINGS_FILE), { recursive: true });
  writeFileSync(TIMINGS_FILE, `${JSON.stringify(next, null, 2)}\n`);
}

function summarize(all, wallSeconds) {
  console.log('');
  console.log('══════════════ e2e (sharded) ══════════════');
  let red = false;
  const total = { passed: 0, failed: 0, flaky: 0, skipped: 0 };
  for (const r of all) {
    const s = r.stats;
    const ran = s ? s.passed + s.failed + s.flaky + s.skipped : 0;
    const short = s && ran < r.shard.tests;
    if (r.code !== 0 || !s || s.failed > 0 || short) red = true;
    if (s) for (const key of Object.keys(total)) total[key] += s[key];
    const verdict = !s
      ? `RED (exit ${r.code}, no report — see the log)`
      : `${s.passed} passed, ${s.failed} failed, ${s.flaky} flaky, ${s.skipped} skipped` +
        (short ? ` — ONLY ${ran} OF ${r.shard.tests} RAN` : '') +
        (r.code !== 0 ? ` (exit ${r.code})` : '');
    console.log(`  shard ${r.i}  ${formatDuration(r.seconds).padStart(7)}  ${verdict}`);
    console.log(`           log: ${r.log}`);
  }
  const sentinels = all.filter((r) => r.shard.files.includes(SENTINEL)).length;
  const listedTotal = sum(files.map((f) => listed.get(f)));
  const sentinelTests = listed.get(SENTINEL) ?? 0;
  console.log(
    `  Tests: ${total.passed} passed, ${total.failed} failed, ${total.flaky} flaky, ${total.skipped} skipped` +
      ` (${listedTotal} listed${sentinels > 1 ? ` + ${(sentinels - 1) * sentinelTests} from the sentinel in every shard` : ''})`,
  );
  console.log(
    `  wall clock ${formatDuration(wallSeconds)} · ${all.length} shard(s) · lowest free memory ${lowestFreeGb.toFixed(1)} GB`,
  );
  console.log(`  verdict: ${red ? 'RED' : 'GREEN'}`);
  return red ? 1 : 0;
}

function killTree(child) {
  if (!child.pid) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/T', '/F', '/PID', String(child.pid)], { stdio: 'ignore' });
  } else {
    child.kill('SIGTERM');
  }
}

function sum(values) {
  return values.reduce((a, b) => a + (b ?? 0), 0);
}

function delay(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

function formatDuration(seconds) {
  const s = Math.round(seconds);
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}m ${String(s % 60).padStart(2, '0')}s` : `${s}s`;
}
