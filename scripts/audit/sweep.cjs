/**
 * §F.1/1 scope sweep: every FR-MOD row in PRD §6, looked up in PLAN.md.
 * No regex with escapes — cells are split on '|' and compared as strings, so
 * nothing here depends on how a shell passed backslashes through.
 *
 * ── A ROW'S STATUS IS ITS STAMP, NOT ANY GLYPH IN IT (tm 234) ───────────────
 *
 * This used to search the whole row text for a glyph, open-first. So a glyph in
 * a description cell counted as the row's status. Measured (tm 211): the §6
 * row of `13.7` was stamped done but its note said the store half was out of
 * scope, with the out-of-scope glyph; while the v1 row was still partial the
 * partial glyph outranked it and nobody saw, and the moment tm 211 closed the
 * v1 row the sweep read `13.7` as BLOCKED. tm 211 fixed the text (§D158); this
 * fixes the reader, which already split the FIRST cell on '|' and now reads
 * the stamp the same way.
 *
 * A stamp is one of two shapes, both measured against every PRD §6 row:
 *
 *   - a cell that STARTS with a status glyph (bold/strike stripped) — the
 *     status column of every module table: `✅ → K07.7`, a bare `✅`, and
 *     `⛔ **ADR-14: …**` on `13.4`;
 *   - a `<glyph> → K<code>` pointer inside a cell — the §6 phase tables put the
 *     stamp inside a note (`FR-MOD-11.5 + … **✅ → K11.5** — …`).
 *
 * Anything else — `Reopen ✅ (…)`, `mağaza payı ⛔-süreç` — is prose about the
 * row, and no longer moves its status.
 */
const fs = require('fs');

/** Most-open first: a row with any open stamp is open, whatever else it carries. */
const STATUSES = [
  ['OPEN', '⬜'],
  ['PARTIAL', '◐'],
  ['BLOCKED', '⛔'],
  ['LOCKED', '🔒'],
  ['DONE', '✅'],
];
const GLYPHS = STATUSES.map(([, glyph]) => glyph);

/** The first cell of a table row as a PRD code (`FR-MOD-` and bold/strike stripped), or null. */
function codeOf(line) {
  if (!line.startsWith('|')) return null;
  const first = line.split('|')[1];
  if (first === undefined) return null;
  return first
    .trim()
    .replace(/\*\*/g, '')
    .replace(/~~/g, '')
    .replace(/^FR-MOD-/, '');
}

/** The status glyphs a table row's STAMP carries — see the header for the two shapes. */
function stampsOf(line) {
  const stamps = [];
  for (const raw of line.split('|').slice(2)) {
    const cell = raw.replace(/\*\*/g, '').replace(/~~/g, '').trim();
    const leading = GLYPHS.find((g) => cell.startsWith(g));
    if (leading) stamps.push(leading);
    for (const g of GLYPHS) {
      let at = cell.indexOf(g, leading === g ? g.length : 0);
      while (at !== -1) {
        if (/^\s*→\s*K/.test(cell.slice(at + g.length))) stamps.push(g);
        at = cell.indexOf(g, at + g.length);
      }
    }
  }
  return stamps;
}

/** One PRD code's rows -> its status bucket, or null when no row carries a stamp. */
function classify(rows) {
  const stamps = rows.flatMap((r) => stampsOf(r.text));
  const hit = STATUSES.find(([, glyph]) => stamps.includes(glyph));
  return hit ? hit[0] : null;
}

function prdIds(prdText) {
  const prd = prdText.split(/\r?\n/);
  const start = prd.findIndex((l) => /^##\s+6\./.test(l));
  const end = prd.findIndex((l, i) => i > start && /^##\s+7\./.test(l));
  if (start === -1 || end === -1)
    throw new Error('PRD §6/§7 headers not found — file structure changed');
  const ids = [];
  // §6 up to (not including) §7, found by header, not a fixed line range
  for (const line of prd.slice(start, end)) {
    if (!line.startsWith('|')) continue;
    const first = line.split('|')[1];
    if (first === undefined) continue;
    const cell = first.trim().replace(/\*\*/g, '').replace(/~~/g, '');
    const m = cell.match(/^(?:FR-)?MOD-([0-9]+(?:\.[0-9]+)*)$/);
    if (m && !ids.includes(m[1])) ids.push(m[1]);
  }
  return ids;
}

function sweep(prdText, planText) {
  const ids = prdIds(prdText);

  /** Map: PRD code -> [{line, text}] of PLAN table rows whose first cell is that code. */
  const rowsByCode = new Map();
  planText.split(/\r?\n/).forEach((line, i) => {
    const code = codeOf(line);
    if (code === null || !/^[0-9]+(\.[0-9]+)*$/.test(code)) return;
    if (!rowsByCode.has(code)) rowsByCode.set(code, []);
    rowsByCode.get(code).push({ line: i + 1, text: line });
  });

  const out = { OPEN: [], PARTIAL: [], BLOCKED: [], LOCKED: [], DONE: [], NOROW: [] };
  for (const id of ids) {
    const rows = rowsByCode.get(id) || [];
    if (!rows.length) {
      out.NOROW.push(id);
      continue;
    }
    const at = ' @' + rows.map((r) => r.line).join(',');
    const status = classify(rows);
    if (status === 'DONE') out.DONE.push(id);
    else if (status) out[status].push(id + at);
    else out.NOROW.push(id + ' (row present, NO stamp)' + at);
  }
  return { ids, out };
}

function main() {
  const { ids, out } = sweep(
    fs.readFileSync('urun-gereksinim-dokumani-PRD.md', 'utf8'),
    fs.readFileSync('PLAN.md', 'utf8'),
  );
  console.log('PRD §6 FR-MOD rows counted: ' + ids.length);
  for (const k of Object.keys(out)) {
    const v = out[k];
    console.log(k + ' = ' + v.length + (v.length && k !== 'DONE' ? '\n  ' + v.join('\n  ') : ''));
  }
  return 0;
}

module.exports = { sweep, stampsOf, classify, codeOf, prdIds };

if (require.main === module) process.exitCode = main();
