/**
 * §F.1/6 — silent debt. Scans tracked source for the markers that hide unfinished
 * work: TODO / FIXME / XXX / HACK, @ts-expect-error, @ts-ignore, skipped and
 * focused tests, and disabled lint rules. Lists every hit; a count alone would
 * be the same kind of claim this round exists to check.
 */
const { execSync } = require('child_process');
const fs = require('fs');

const files = execSync('git ls-files', { encoding: 'utf8' })
  .trim()
  .split(/\r?\n/)
  .filter((f) => /\.(ts|tsx|js|cjs|mjs)$/.test(f) && !f.startsWith('scripts/audit/'));

const patterns = [
  ['TODO', /\b(TODO)\b/],
  ['FIXME', /\b(FIXME)\b/],
  ['XXX', /\bXXX\b/],
  ['HACK', /\bHACK\b/],
  ['@ts-expect-error', /@ts-expect-error/],
  ['@ts-ignore', /@ts-ignore/],
  ['skipped test', /\b(it|test|describe)\.skip\s*\(|\bxit\s*\(|\bxdescribe\s*\(/],
  ['focused test', /\b(it|test|describe)\.only\s*\(/],
  ['eslint-disable', /eslint-disable/],
  ['istanbul ignore', /istanbul ignore/],
];

const hits = new Map(patterns.map(([k]) => [k, []]));

for (const f of files) {
  const lines = fs.readFileSync(f, 'utf8').split(/\r?\n/);
  lines.forEach((line, i) => {
    for (const [label, re] of patterns) {
      if (re.test(line)) hits.get(label).push(f + ':' + (i + 1) + '  ' + line.trim().slice(0, 120));
    }
  });
}

console.log('scanned tracked source files: ' + files.length + '\n');
for (const [label, list] of hits) {
  console.log('### ' + label + ' = ' + list.length);
  list.slice(0, 25).forEach((h) => console.log('   ' + h));
  if (list.length > 25) console.log('   … +' + (list.length - 25) + ' more');
}
