/**
 * NFR-P5 — list requests the console makes with a fixed `limit` and no cursor.
 *
 * P5-PAGE connected five screens to `next_page_id`. The defect it closed was not
 * a missing feature but an invisible ceiling: a list asked for one page, got one
 * page, and rendered it as if that were everything. Nothing about that reads as
 * broken — the screen is full, the rows are right, and the workspaces most
 * people develop against never have a fifty-first row. So the same mistake will
 * be made again the next time a screen needs a list, and it will look correct
 * the next time too.
 *
 * This is the sentry against that. It finds every request that pins a `limit`
 * and checks whether the same request can also carry a cursor. One that cannot
 * is either a real ceiling or a deliberate one; the deliberate ones say so in
 * the source (see "Waivers" below) rather than in someone's memory.
 *
 * HEURISTIC, and worth knowing where it stops:
 *   - It reads text, not types. A `limit` assembled somewhere other than at the
 *     call site is invisible to it, and so is a list endpoint called with no
 *     `limit` at all (the server's default page then applies and this says
 *     nothing about it).
 *   - "Same request" is approximated as ±8 lines. Every URL builder in this
 *     repo puts its cursor within one or two lines of its limit; one that
 *     spread them further apart would be reported and would need a waiver or a
 *     rewrite.
 *   - Not every endpoint that takes a `limit` paginates. `?limit=1` asked only
 *     for a `total`, or a six-row type-ahead, is a cap by design, not a
 *     ceiling by accident — the same "classify the result by hand" caveat
 *     `endpoint-ui.cjs` carries.
 *
 * Waivers: a comment containing `paging-exempt: <reason>` within the ten lines
 * above the call. The reason is required — a bare marker is reported as if it
 * were not there, because a waiver whose reason nobody wrote is the silent
 * ceiling again with extra steps.
 *
 * Unlike its siblings this one exits non-zero when it finds something. It is
 * here to stop a regression, and an audit that always exits 0 stops nothing.
 */
const { execSync } = require('child_process');
const fs = require('fs');

/** The agent console. The widget has no lists, and the phone pages its own way. */
const ROOT = 'apps/web/src';

/** How far from a `limit` a cursor may sit and still belong to the same request. */
const WINDOW = 8;
/** How far above a call a `paging-exempt:` comment may sit. */
const WAIVER_LOOKBACK = 10;

/** The contract's cursor parameters — the wire names, not local variables. */
const CURSOR = /\b(page_id|before_event_id|after_event_id)\b/;

/** The shapes a pinned `limit` takes in this codebase. */
const LIMIT_PATTERNS = [
  // `?limit=50`, `&limit=${PAGE_SIZE}` — inside a URL string.
  /limit=(\d+|\$\{[^}]*\})/,
  // `{ limit: 50 }`, `{ limit: PAGE_SIZE }`, `{ limit: String(PAGE_SIZE) }`.
  // Deliberately not `limit: <lowercase>`, which is a type annotation.
  /\blimit\s*:\s*(\d+|String\(|[A-Z][A-Z0-9_]*\b)/,
  // `params.set('limit', …)`, `params.append('limit', …)`.
  /\.(set|append)\(\s*['"]limit['"]/,
];

const WAIVER = /paging-exempt:\s*(\S.*)$/;

/**
 * Blank out comments while keeping line numbers.
 *
 * Matching against a comment is how a scanner reports the paragraph explaining
 * a decision as if it were the decision. Line comments are only stripped where
 * the `//` is not preceded by `:`, so a `http://` inside a string survives.
 */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const files = execSync(`git ls-files ${ROOT}`, { encoding: 'utf8' })
  .trim()
  .split(/\r?\n/)
  .filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.(ts|tsx)$/.test(f));

const paged = [];
const exempt = [];
const unpaged = [];

for (const file of files) {
  const raw = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  const code = stripComments(raw.join('\n')).split(/\r?\n/);

  code.forEach((line, index) => {
    if (!LIMIT_PATTERNS.some((re) => re.test(line))) return;

    const near = code.slice(Math.max(0, index - WINDOW), index + WINDOW + 1).join('\n');
    const at = `${file}:${index + 1}`;
    const text = raw[index].trim().slice(0, 110);

    if (CURSOR.test(near)) {
      paged.push(`${at}  ${text}`);
      return;
    }

    const waiver = raw
      .slice(Math.max(0, index - WAIVER_LOOKBACK), index + 1)
      .map((l) => WAIVER.exec(l))
      .filter(Boolean)
      .pop();
    if (waiver) {
      exempt.push(`${at}  ${waiver[1].replace(/\s*\*\/\s*$/, '').trim()}`);
      return;
    }

    unpaged.push(`${at}  ${text}`);
  });
}

const total = paged.length + exempt.length + unpaged.length;
console.log(`scanned ${ROOT} modules: ${files.length}`);
console.log(`list requests with a pinned limit: ${total}`);
console.log(`   paged (cursor in the same request): ${paged.length}`);
console.log(`   exempt (paging-exempt): ${exempt.length}`);
console.log(`   UNPAGED: ${unpaged.length}\n`);

console.log(`### paged = ${paged.length}`);
paged.forEach((p) => console.log('   ' + p));
console.log(`\n### exempt = ${exempt.length}`);
exempt.forEach((e) => console.log('   ' + e));
console.log(`\n### UNPAGED = ${unpaged.length}`);
unpaged.forEach((u) => console.log('   ' + u));

if (unpaged.length > 0) {
  console.log(
    '\nEach of these caps a list at one request. Chain it through `usePagedQuery`,' +
      '\nor write `paging-exempt: <why>` above the call if the cap is the point.',
  );
  process.exitCode = 1;
}
