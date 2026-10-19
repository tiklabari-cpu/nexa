/**
 * The DoD test gate (CONVENTIONS §1) as a handful of headings, with one
 * summary table at the end.
 *
 *     pnpm test:gate                      # build, statik, birim, entegrasyon
 *     pnpm test:gate birim entegrasyon    # only these headings
 *     pnpm test:gate --e2e                # the four above, then e2e
 *     pnpm test:gate --force              # bypass the turbo cache (§1.3)
 *     pnpm test:gate --jobs=3             # parallel integration shards (default: CPUs/4, max 6; --jobs=1 = serial)
 *
 * Headings and what runs in each:
 *
 *   build        turbo run build
 *   statik       turbo run typecheck lint  ·  prettier --check  ·  node --test scripts/loop   (side by side)
 *   birim        turbo run test:unit        (every package's unit suite; api/rtm on isolated stores)
 *   entegrasyon  turbo run test:integration --concurrency=1
 *                (the api suite runs as parallel shards — `apps/api/scripts/run-sharded.ts`)
 *   e2e          `pnpm -w test:e2e` — parallel private stacks, each with its own ports and
 *                database (`apps/e2e/scripts/run-e2e-sharded.mjs`, tm 260); opt-in, and
 *                alone, because those stacks fill the machine's memory
 *
 * Order. `build` runs first and alone: everything else depends on built
 * packages, and two turbo processes building the same package at once race on
 * its `dist/`. After it, `statik` and `birim` run side by side with `--only`,
 * so neither tries to rebuild what `build` just produced. `entegrasyon` comes
 * next on its own — it already fills the machine with its shards, and sharing
 * the CPU with the unit suites is how a timing test turns into a timeout
 * (memory: integration gate needs serial turbo). `e2e` is last.
 *
 * Red stops what is pointless to run next (2026-10-16 — a red integration run
 * used to be followed by a 21-minute e2e run that could not count as proof):
 *   · `build` red      → nothing else runs (no `dist/` to test against);
 *   · `entegrasyon` red → `e2e` is skipped;
 *   · `statik`/`birim` red → `entegrasyon` still runs (independent information,
 *     skipping it only costs another 9-minute round), `e2e` is skipped.
 * Skipped headings show as ATLANDI in the table. `--keep-going` restores the
 * old run-everything behaviour. For every red unit/integration file the gate
 * prints the one-line command that re-runs just that file on private datastores.
 *
 * Every step's output goes to a log under the OS temp directory; a red step's
 * log tail is printed under the table. Exit code is 1 if any step failed.
 */
import { spawn } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const HEADINGS = ['build', 'statik', 'birim', 'entegrasyon', 'e2e'];
const DEFAULT_HEADINGS = ['build', 'statik', 'birim', 'entegrasyon'];

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith('--')));
const jobsFlag = args.find((a) => a.startsWith('--jobs='));
const named = args.filter((a) => !a.startsWith('--'));
for (const name of named) {
  if (!HEADINGS.includes(name)) {
    console.error(`test-gate: unknown heading "${name}" — choose from ${HEADINGS.join(', ')}`);
    process.exit(2);
  }
}
const selected = new Set(named.length > 0 ? named : DEFAULT_HEADINGS);
if (flags.has('--e2e')) selected.add('e2e');

const force = flags.has('--force') ? ' --force' : '';
// `--only` is safe only when this run built the packages itself.
const only = selected.has('build') ? ' --only' : '';

const env = { ...process.env };
if (jobsFlag) env.SIYAHTUS_TEST_JOBS = jobsFlag.slice('--jobs='.length);

/** The root `.env`, for e2e only — same rules as `apps/api/src/config/load-env-file.ts`. */
function withRootEnv(base) {
  const file = join(root, '.env');
  const merged = { ...base };
  if (!existsSync(file)) return merged;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator < 1) continue;
    const key = trimmed.slice(0, separator).trim();
    if (merged[key] !== undefined) continue;
    let value = trimmed.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    merged[key] = value;
  }
  return merged;
}

/** heading → steps; steps within one heading run side by side. */
const STEPS = {
  build: [{ name: 'build', command: `npx turbo run build${force}` }],
  statik: [
    { name: 'typecheck+lint', command: `npx turbo run typecheck lint${only}${force}` },
    { name: 'format:check', command: 'pnpm -w format:check' },
    // Döngü pencerelerinin okuma yardımcısı (2026-10-19); bozulursa sessizce yanlış blok basmasın.
    { name: 'loop-tools', command: 'node --test scripts/loop/block.test.mjs' },
  ],
  birim: [{ name: 'test:unit', command: `npx turbo run test:unit${only}${force}` }],
  entegrasyon: [
    {
      name: 'test:integration',
      command: `npx turbo run test:integration --concurrency=1${only}${force}`,
    },
  ],
  e2e: [{ name: 'test:e2e', command: 'pnpm -w test:e2e', env: withRootEnv(env) }],
};

/** Phases run one after another; headings within a phase run side by side. */
const PHASES = [['build'], ['statik', 'birim'], ['entegrasyon'], ['e2e']];

const logDir = join(tmpdir(), 'siyahtus-test-gate', new Date().toISOString().replace(/[:.]/g, '-'));
mkdirSync(logDir, { recursive: true });

function runStep(heading, step) {
  const log = join(logDir, `${heading}-${step.name.replace(/[^\w.-]/g, '_')}.log`);
  const out = createWriteStream(log);
  const started = Date.now();
  console.log(`[test-gate] ${heading} › ${step.name} started`);
  return new Promise((resolvePromise) => {
    // A fixed command line, so a shell is fine — and needed: pnpm/npx are `.cmd` shims on Windows.
    const child = spawn(step.command, {
      cwd: root,
      shell: true,
      env: step.env ?? env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.pipe(out, { end: false });
    child.stderr.pipe(out, { end: false });
    const finish = (code) =>
      out.end(() => {
        const seconds = Math.round((Date.now() - started) / 1000);
        const verdict = code === 0 ? 'passed' : `FAILED (exit ${code})`;
        console.log(`[test-gate] ${heading} › ${step.name} ${verdict} in ${seconds}s`);
        resolvePromise({ heading, step: step.name, code, seconds, log });
      });
    child.on('error', () => finish(1));
    child.on('close', (code) => finish(code ?? 1));
  });
}

function formatDuration(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}m ${String(s).padStart(2, '0')}s` : `${s}s`;
}

const keepGoing = flags.has('--keep-going');

/** Why a heading is not worth running after the results so far, or null. */
function skipReason(heading) {
  if (keepGoing) return null;
  const red = (name) => results.some((r) => r.heading === name && r.code !== 0);
  if (red('build')) return 'build kırmızı';
  if (heading === 'e2e') {
    if (red('entegrasyon')) return 'entegrasyon kırmızı';
    if (red('statik') || red('birim')) return 'statik/birim kırmızı';
  }
  return null;
}

const started = Date.now();
const results = [];
console.log(`[test-gate] headings: ${[...selected].join(', ')} — logs in ${logDir}`);
for (const phase of PHASES) {
  const headings = phase.filter((h) => selected.has(h));
  if (headings.length === 0) continue;
  const runs = [];
  for (const h of headings) {
    const reason = skipReason(h);
    if (reason) {
      console.log(`[test-gate] ${h} ATLANDI (${reason})`);
      for (const step of STEPS[h]) results.push({ heading: h, step: step.name, code: 0, seconds: 0, skipped: reason });
    } else {
      runs.push(...STEPS[h].map((step) => runStep(h, step)));
    }
  }
  results.push(...(await Promise.all(runs)));
}

/**
 * `@siyahtus/api:test:integration:  FAIL  test/integration/x.test.ts > …` → one re-run command per
 * package. Colour codes are stripped first; the same file listed twice (several tests) is kept once.
 */
function rerunHints(log) {
  const byPackage = new Map();
  const text = readFileSync(log, 'utf8').replace(/\x1b\[[0-9;]*m/g, '');
  for (const line of text.split(/\r?\n/)) {
    const m = /^(?:(@siyahtus\/[\w-]+):[\w:-]+:\s+)?FAIL\s+(\S+\.test\.tsx?)/.exec(line.trim()) ??
      /^(@siyahtus\/[\w-]+):[\w:-]+:\s+FAIL\s+(\S+\.test\.tsx?)/.exec(line.trim());
    if (!m) continue;
    const pkg = m[1] ?? '@siyahtus/api';
    if (!byPackage.has(pkg)) byPackage.set(pkg, new Set());
    byPackage.get(pkg).add(m[2]);
  }
  return [...byPackage].map(
    ([pkg, files]) =>
      `pnpm --filter ${pkg} exec tsx scripts/with-test-datastores.ts vitest run ${[...files].join(' ')}`,
  );
}

const total = Math.round((Date.now() - started) / 1000);
const failed = results.filter((r) => r.code !== 0);
const width = Math.max(...results.map((r) => `${r.heading} › ${r.step}`.length));

console.log('');
console.log('══════════════ test-gate ══════════════');
for (const r of results) {
  const label = `${r.heading} › ${r.step}`.padEnd(width);
  const verdict = r.skipped ? `ATLANDI (${r.skipped})` : r.code === 0 ? 'OK  ' : `RED (exit ${r.code})`;
  console.log(`  ${label}  ${verdict}  ${r.skipped ? '' : formatDuration(r.seconds).padStart(7)}`);
}
console.log(
  `  ${'toplam (duvar saati)'.padEnd(width)}        ${formatDuration(total).padStart(7)}`,
);
console.log(`  loglar: ${logDir}`);

for (const r of failed) {
  const lines = readFileSync(r.log, 'utf8').split(/\r?\n/);
  console.log('');
  console.log(`----- ${r.heading} › ${r.step}: last 80 lines of ${r.log} -----`);
  console.log(lines.slice(-80).join('\n'));
}

const hints = failed.flatMap((r) => (r.heading === 'birim' || r.heading === 'entegrasyon' ? rerunHints(r.log) : []));
if (hints.length > 0) {
  console.log('');
  console.log('----- Kırmızı dosyaları tek tek yeniden koş (özel veritabanıyla; tam kapıyı beklemeden) -----');
  for (const h of [...new Set(hints)]) console.log(`  ${h}`);
  console.log('  Hepsi yeşilse kapıyı yeniden başlat; e2e yalnız o koşuda ve yalnız entegrasyon yeşilse koşar.');
}

process.exitCode = failed.length === 0 ? 0 : 1;
