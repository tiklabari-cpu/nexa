/**
 * §F.1/1 scope sweep: every FR-MOD row in PRD §6, looked up in PLAN.md.
 * No regex with escapes — cells are split on '|' and compared as strings, so
 * nothing here depends on how a shell passed backslashes through.
 */
const fs = require('fs');

const prd = fs.readFileSync('urun-gereksinim-dokumani-PRD.md', 'utf8').split(/\r?\n/);
const section6 = prd.slice(463, 733); // §6 (line 464) .. before §7 (line 734)

const ids = [];
for (const line of section6) {
  if (!line.startsWith('|')) continue;
  const first = line.split('|')[1];
  if (first === undefined) continue;
  const cell = first.trim().replace(/\*\*/g, '').replace(/~~/g, '');
  const m = cell.match(/^(?:FR-)?MOD-([0-9]+(?:\.[0-9]+)*)$/);
  if (m && !ids.includes(m[1])) ids.push(m[1]);
}

const plan = fs.readFileSync('PLAN.md', 'utf8').split(/\r?\n/);

/** Map: PRD code -> [{line, text}] of PLAN table rows whose first cell is that code. */
const rowsByCode = new Map();
plan.forEach((line, i) => {
  if (!line.startsWith('|')) return;
  const first = line.split('|')[1];
  if (first === undefined) return;
  const code = first.trim().replace(/\*\*/g, '').replace(/~~/g, '').replace(/^FR-MOD-/, '');
  if (!/^[0-9]+(\.[0-9]+)*$/.test(code)) return;
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
  const joined = rows.map((r) => r.text).join(' ');
  const at = ' @' + rows.map((r) => r.line).join(',');
  if (joined.includes('⬜')) out.OPEN.push(id + at);
  else if (joined.includes('◐')) out.PARTIAL.push(id + at);
  else if (joined.includes('⛔')) out.BLOCKED.push(id + at);
  else if (joined.includes('🔒')) out.LOCKED.push(id + at);
  else if (joined.includes('✅')) out.DONE.push(id);
  else out.NOROW.push(id + ' (row present, NO stamp)' + at);
}

console.log('PRD §6 FR-MOD rows counted: ' + ids.length);
for (const k of Object.keys(out)) {
  const v = out[k];
  console.log(k + ' = ' + v.length + (v.length && k !== 'DONE' ? '\n  ' + v.join('\n  ') : ''));
}
