/**
 * §F.1/4 — every Prisma model must have a consumer. A model nobody reads or
 * writes is either a missing feature or a table that should be dropped;
 * standing there silently is not the third option.
 *
 * Counts `prisma.<model>.` / `tx.<model>.` / `<client>.<model>.` call sites plus
 * raw-SQL mentions of the mapped table name, across api + rtm source (not tests
 * — a model only a test touches is exactly the leftover we are hunting).
 *
 * ── THE THIRD PATH: a SQL function (tm 234) ─────────────────────────────────
 *
 * Until tm 234 those were the only two paths, and every §F.1 round got the same
 * three wrong answers: `password_reset_tokens`, `account_two_factor` and
 * `two_factor_recovery_codes` came out as NO CONSUMER FOUND. All three are read
 * and written on every login, but never by the api directly — RLS gives them no
 * permissive policy, and the only way in is a SECURITY DEFINER function defined
 * in a migration (`auth_consume_password_reset`, `auth_two_factor_*`) that the
 * api calls by name through `$queryRaw`. GL-11 (§D143) and GL-13 (§D153) both
 * had to rule the three out by hand.
 *
 * So the migrations are read too. A model counts as "reached via a SQL function"
 * when BOTH halves hold, because either alone proves nothing:
 *
 *   1. a function whose CURRENT definition names the table in its body — the
 *      migrations are replayed in order, so a later `CREATE OR REPLACE` or
 *      `DROP FUNCTION` wins over the definition it replaces; and
 *   2. api/rtm source calls that function (`name(`).
 *
 * A function nobody calls does not rescue its table: that is still a table
 * nothing in the running product reaches, and `Workflow` (ADR-14) must keep
 * showing up here as the one real finding.
 *
 * Where this stops, knowingly: SQL comments are blanked before the body is
 * read, but a table named inside a string literal would still count. A table
 * reached only through a function that another function calls is NOT followed
 * — it stays under NO CONSUMER FOUND, which errs toward a false positive
 * rather than a hidden orphan. `DROP FUNCTION` removes a name without reading
 * its signature, which is right for every drop-then-recreate in this repo.
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const SCHEMA = 'apps/api/prisma/schema.prisma';
const MIGRATIONS = 'apps/api/prisma/migrations';
const ROOTS = ['apps/api/src', 'apps/rtm/src'];

const lower = (s) => s.charAt(0).toLowerCase() + s.slice(1);
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** `_` is a word character, so `account_two_factor` does not match inside `account_two_factor_x`. */
const word = (name) => new RegExp('\\b' + escape(name) + '\\b');

function parseModels(schema) {
  const models = [];
  const re = /^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm;
  let m;
  while ((m = re.exec(schema)) !== null) {
    const mapMatch = m[2].match(/@@map\("([^"]+)"\)/);
    models.push({ name: m[1], table: mapMatch ? mapMatch[1] : m[1] });
  }
  return models;
}

/**
 * Split one migration into statements, with comments blanked.
 *
 * A plain `split(';')` breaks on the first `;` inside a plpgsql body, so the
 * splitter tracks `'…'` literals and `$tag$…$tag$` bodies (this repo uses both
 * `$$` and `$fn$`). Comments go first, so a `$$` or `;` in prose cannot open
 * or close anything.
 */
function splitStatements(sql) {
  const text = sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, '');
  const statements = [];
  let start = 0;
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === "'") {
      const close = text.indexOf("'", i + 1);
      i = close === -1 ? text.length : close + 1;
      continue;
    }
    if (c === '$') {
      const tag = /^\$[A-Za-z_]*\$/.exec(text.slice(i));
      if (tag) {
        const close = text.indexOf(tag[0], i + tag[0].length);
        i = close === -1 ? text.length : close + tag[0].length;
        continue;
      }
    }
    if (c === ';') {
      statements.push(text.slice(start, i));
      start = i + 1;
    }
    i += 1;
  }
  if (text.slice(start).trim()) statements.push(text.slice(start));
  return statements.map((s) => s.trim()).filter(Boolean);
}

/**
 * Replay the migrations in order and return the functions that exist at the
 * end: name -> { body, securityDefiner, migration }.
 *
 * `migrations` is `[{ name, sql }]`, already sorted — Prisma's directory names
 * are timestamps, so lexical order is apply order.
 */
function currentFunctions(migrations) {
  const fns = new Map();
  for (const { name: migration, sql } of migrations) {
    for (const statement of splitStatements(sql)) {
      const create =
        /^CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:"?public"?\.)?"?(\w+)"?\s*\(/i.exec(statement);
      if (create) {
        fns.set(create[1], {
          body: statement,
          securityDefiner: /\bSECURITY\s+DEFINER\b/i.test(statement),
          migration,
        });
        continue;
      }
      const drop = /^DROP\s+FUNCTION\s+(?:IF\s+EXISTS\s+)?([\s\S]*)$/i.exec(statement);
      if (drop) {
        for (const m of drop[1].matchAll(/(?:"?public"?\.)?"?(\w+)"?\s*\(/g)) fns.delete(m[1]);
      }
    }
  }
  return fns;
}

/**
 * The whole report as data, from inputs a test can build by hand.
 *
 * `sources` is `[{ file, text }]` — api + rtm non-test source.
 */
function analyse({ schema, migrations, sources }) {
  const models = parseModels(schema);
  const corpus = sources.map((s) => s.text).join('\n');
  const fns = currentFunctions(migrations);

  /** function name -> files that call it. Only functions somebody calls matter. */
  const callers = new Map();
  for (const name of fns.keys()) {
    const call = new RegExp('\\b' + escape(name) + '\\s*\\(');
    const files = sources.filter((s) => call.test(s.text)).map((s) => s.file);
    if (files.length) callers.set(name, files);
  }

  const clientCalls = [];
  const rawOnly = [];
  const viaFunction = [];
  const orphans = [];
  for (const { name, table } of models) {
    const prop = lower(name);
    const client = new RegExp(
      '\\.' + prop + '\\s*\\.\\s*(find|create|update|upsert|delete|count|aggregate|groupBy)',
    );
    if (client.test(corpus)) {
      clientCalls.push(name);
      continue;
    }
    if (corpus.includes('"' + table + '"') || corpus.includes(' ' + table + ' ')) {
      rawOnly.push({ name, table });
      continue;
    }
    const mentions = word(table);
    const reaching = [...fns.entries()]
      .filter(([fn, def]) => callers.has(fn) && mentions.test(def.body))
      .map(([fn, def]) => ({
        name: fn,
        securityDefiner: def.securityDefiner,
        migration: def.migration,
        callers: callers.get(fn),
      }));
    if (reaching.length) viaFunction.push({ name, table, functions: reaching });
    else orphans.push({ name, table });
  }

  return { models, clientCalls, rawOnly, viaFunction, orphans };
}

function readRepo() {
  const schema = fs.readFileSync(SCHEMA, 'utf8');
  const migrations = fs
    .readdirSync(MIGRATIONS, { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(MIGRATIONS, d.name, 'migration.sql')))
    .map((d) => d.name)
    .sort()
    .map((name) => ({
      name,
      sql: fs.readFileSync(path.join(MIGRATIONS, name, 'migration.sql'), 'utf8'),
    }));
  const sources = [];
  for (const root of ROOTS) {
    const files = execSync('git ls-files ' + root, { encoding: 'utf8' })
      .trim()
      .split(/\r?\n/)
      .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f));
    for (const file of files) sources.push({ file, text: fs.readFileSync(file, 'utf8') });
  }
  return { schema, migrations, sources };
}

function main() {
  const { models, clientCalls, rawOnly, viaFunction, orphans } = analyse(readRepo());
  console.log('models in schema: ' + models.length);
  console.log('with Prisma client calls in api/rtm source: ' + clientCalls.length);
  console.log('reached only via raw SQL / table name: ' + rawOnly.length);
  rawOnly.forEach((o) => console.log('   ' + o.name + ' (raw SQL / table name: ' + o.table + ')'));
  console.log('reached only via a SQL function called from api/rtm source: ' + viaFunction.length);
  for (const v of viaFunction) {
    console.log('   ' + v.name + ' -> table ' + v.table);
    for (const f of v.functions) {
      const mode = f.securityDefiner ? 'SECURITY DEFINER' : 'SECURITY INVOKER';
      console.log('      ' + f.name + '() [' + mode + '] <- ' + f.callers.join(', '));
    }
  }
  console.log('NO CONSUMER FOUND: ' + orphans.length);
  orphans.forEach((o) => console.log('   ' + o.name + ' -> table ' + o.table));
  return 0;
}

module.exports = { analyse, parseModels, splitStatements, currentFunctions, readRepo };

if (require.main === module) process.exitCode = main();
