/**
 * ID-08 — identity keys in log calls are snake_case, everywhere.
 *
 * "Why did the AI tell this player that?" is answered by grepping the log for
 * a number. That works only while every line spells the key the same way: the
 * day this audit was written, one route logged `chatId`, the next `chat_id`,
 * and a search for either found half the story. `LOG_KEYS`
 * (`packages/types/src/log-keys.ts`) is the spelling; this finds a log call in
 * `apps/api` or `apps/rtm` that writes one of those keys as its camelCase twin
 * (`chatId`, `licenseId`, `reqId`, …) and exits 1.
 *
 * What it reads: every `<something>log(ger)?.<level>(` and `.child(` call whose
 * first argument is an object literal, and every key in that literal — nested
 * ones included, because `{ mail: { chatId } }` is on the line too. Both
 * `{ chatId: x }` and the shorthand `{ chatId }` count.
 *
 * HEURISTIC, and where it stops:
 *   - A field object built elsewhere and passed by name (`log.warn(fields, …)`)
 *     is invisible; so is a key handed to a helper that logs it later. The
 *     binding helpers (`plugins/log-context.ts`) take camelCase *parameters*
 *     and write snake_case keys, which is the shape to copy.
 *   - It reads text, not types: a receiver has to be named like a logger
 *     (`log`, `logger`, `#log`, `fooLog`, `fooLogger`).
 *   - Test files are not scanned — a test may log anything to its own sink.
 *
 * `--json` prints the findings as JSON. The list below is pinned to `LOG_KEYS`
 * by `apps/api/src/config/log-keys-audit.test.ts`, so a key added there and
 * forgotten here goes red.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** Where server-side log lines are written. A new service process is added here. */
export const SCAN_ROOTS = ['apps/api/src', 'apps/rtm/src'];

/** camelCase twin → the key `LOG_KEYS` says to write instead. */
export const CAMEL_TWINS = {
  licenseId: 'license_id',
  organizationId: 'organization_id',
  requestId: 'request_id',
  reqId: 'request_id',
  actorType: 'actor_type',
  actorId: 'actor_id',
  chatId: 'chat_id',
  threadId: 'thread_id',
  customerId: 'customer_id',
};

const LOG_CALL_RE =
  /(?:^|[^\w$])#?(?:log|logger|[A-Za-z_$][\w$]*Log|[A-Za-z_$][\w$]*Logger)\??\.(?:trace|debug|info|warn|error|fatal|child)\s*\(\s*\{/g;

/**
 * Replace string, template and comment contents with spaces, keeping offsets
 * and newlines, so a key-looking word inside a message cannot match.
 */
function blankNonCode(source) {
  let out = '';
  let i = 0;
  while (i < source.length) {
    const c = source[i];
    const next = source[i + 1];
    if (c === '/' && next === '/') {
      while (i < source.length && source[i] !== '\n') {
        out += ' ';
        i += 1;
      }
    } else if (c === '/' && next === '*') {
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) {
        out += source[i] === '\n' ? '\n' : ' ';
        i += 1;
      }
      out += '  ';
      i += 2;
    } else if (c === '"' || c === "'" || c === '`') {
      out += c;
      i += 1;
      while (i < source.length && source[i] !== c) {
        if (source[i] === '\\') {
          out += '  ';
          i += 2;
          continue;
        }
        out += source[i] === '\n' ? '\n' : ' ';
        i += 1;
      }
      out += c;
      i += 1;
    } else {
      out += c;
      i += 1;
    }
  }
  return out;
}

/** The object literal starting at `open` (a `{`), up to its matching `}`. */
function literalAt(code, open) {
  let depth = 0;
  for (let i = open; i < code.length; i += 1) {
    if (code[i] === '{') depth += 1;
    else if (code[i] === '}') {
      depth -= 1;
      if (depth === 0) return code.slice(open, i + 1);
    }
  }
  return code.slice(open);
}

const KEY_RE = new RegExp(`[{,]\\s*(${Object.keys(CAMEL_TWINS).join('|')})\\s*(?=[:,}])`, 'g');

/**
 * Every camelCase identity key written by a log call in `source`.
 * Exported for the test, which runs it over synthetic sources.
 */
export function findCamelLogKeys(source, file = '<source>') {
  const code = blankNonCode(source);
  const findings = [];
  for (const call of code.matchAll(LOG_CALL_RE)) {
    const open = call.index + call[0].length - 1;
    const literal = literalAt(code, open);
    for (const key of literal.matchAll(KEY_RE)) {
      const at = open + key.index + key[0].indexOf(key[1]);
      const line = code.slice(0, at).split('\n').length;
      findings.push({ file, line, key: key[1], expected: CAMEL_TWINS[key[1]] });
    }
  }
  return findings;
}

function walk(dir, files) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name === 'generated') continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, files);
    else if (/\.(ts|tsx|mts|js|mjs)$/.test(name) && !/\.test\.[cm]?[jt]sx?$/.test(name)) {
      files.push(path);
    }
  }
  return files;
}

export function auditRepository(root = ROOT, roots = SCAN_ROOTS) {
  const findings = [];
  let scanned = 0;
  for (const scanRoot of roots) {
    const absolute = join(root, scanRoot);
    for (const file of walk(absolute, [])) {
      scanned += 1;
      const rel = relative(root, file).split('\\').join('/');
      findings.push(...findCamelLogKeys(readFileSync(file, 'utf8'), rel));
    }
  }
  return { scanned, findings };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { scanned, findings } = auditRepository();
  const print = (line) =>
    process.stdout.write(`${line}
`);
  if (process.argv.includes('--json')) {
    print(JSON.stringify({ scanned, findings }, null, 2));
  } else if (findings.length === 0) {
    print(`log-keys: ${scanned} files, no camelCase identity key in a log call.`);
  } else {
    print(`log-keys: ${findings.length} camelCase identity key(s) in log calls:`);
    for (const f of findings) print(`  ${f.file}:${f.line}  ${f.key} → ${f.expected}`);
  }
  if (findings.length > 0) process.exitCode = 1;
}
