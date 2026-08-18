/**
 * §F.1/4 — every Prisma model must have a consumer. A model nobody reads or
 * writes is either a missing feature or a table that should be dropped;
 * standing there silently is not the third option.
 *
 * Counts `prisma.<model>.` / `tx.<model>.` / `<client>.<model>.` call sites plus
 * raw-SQL mentions of the mapped table name, across api + rtm source (not tests
 * — a model only a test touches is exactly the leftover we are hunting).
 */
const { execSync } = require('child_process');
const fs = require('fs');

const schema = fs.readFileSync('apps/api/prisma/schema.prisma', 'utf8');

const models = [];
const re = /^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm;
let m;
while ((m = re.exec(schema)) !== null) {
  const mapMatch = m[2].match(/@@map\("([^"]+)"\)/);
  models.push({ name: m[1], table: mapMatch ? mapMatch[1] : m[1] });
}

const lower = (s) => s.charAt(0).toLowerCase() + s.slice(1);

const roots = ['apps/api/src', 'apps/rtm/src'];
let corpus = '';
for (const root of roots) {
  const files = execSync('git ls-files ' + root, { encoding: 'utf8' })
    .trim()
    .split(/\r?\n/)
    .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f));
  for (const f of files) corpus += fs.readFileSync(f, 'utf8') + '\n';
}

const orphans = [];
const rawOnly = [];
for (const { name, table } of models) {
  const prop = lower(name);
  const client = new RegExp('\\.' + prop + '\\s*\\.\\s*(find|create|update|upsert|delete|count|aggregate|groupBy)');
  const raw = corpus.includes('"' + table + '"') || corpus.includes(' ' + table + ' ');
  if (client.test(corpus)) continue;
  if (raw) rawOnly.push(name + ' (raw SQL / table name: ' + table + ')');
  else orphans.push(name + ' -> table ' + table);
}

console.log('models in schema: ' + models.length);
console.log('with Prisma client calls in api/rtm source: ' + (models.length - orphans.length - rawOnly.length));
console.log('reached only via raw SQL / table name: ' + rawOnly.length);
rawOnly.forEach((o) => console.log('   ' + o));
console.log('NO CONSUMER FOUND: ' + orphans.length);
orphans.forEach((o) => console.log('   ' + o));
