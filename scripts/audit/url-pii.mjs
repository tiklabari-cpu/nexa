/**
 * GV-05 — no personal data in an address (tm 386).
 *
 * An address is the least private place a value can sit: the browser keeps it
 * in history and autocomplete, a proxy and the server write it to their access
 * logs, and the next site the operator clicks through to receives it as the
 * `Referer`. So the rule is that an address carries only random numbers (a
 * Thread/Chat id, a UUID) and non-personal filters — never what somebody typed
 * into a search box, and never a person's e-mail, name, username or phone.
 *
 * This finds, in every app's and package's source (`apps/*\/src`,
 * `packages/*\/src` — globbed, so a new app such as `apps/admin` is scanned
 * the day it exists), the places an address is built with one of those keys:
 *
 *   1. `<params>.set('q', …)` / `.append('email', …)` — a `URLSearchParams`
 *      write (receiver named like one: `params`, `searchParams`, `next`, `qs`,
 *      `query`, `url`, or `….searchParams`).
 *   2. `setSearchParams({ q })`, `new URLSearchParams({ email })`,
 *      `navigate({ search: … })`-style object literals handed to an address
 *      builder, with a sensitive key in them.
 *   3. A string or template literal that spells `?email=` / `&q=` — a
 *      `navigate('/x?q=…')`, an `href="…?name=…"`, a link in a mail.
 *
 * WHERE IT STOPS, on purpose:
 *   - An API request's query is not the browser's address, and a GET search
 *     against our own API is masked in the server's log (`lib/log-redact.ts`,
 *     `q`/`query`/`search`/`email`/`name` …). Such a line is allowed only with
 *     an explicit marker, on the line or the line above:
 *     `// url-pii-ok: <why>` — a marker with no reason is itself a finding.
 *   - It reads text, not types: a key held in a variable (`params.set(k, v)`)
 *     is invisible. Test files are not scanned.
 *
 * `--json` prints the findings as JSON. Pinned by
 * `apps/api/src/config/url-pii-audit.test.ts` (a violating sample goes red).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** Top-level directories whose children each hold a `src` to scan. */
export const SCAN_PARENTS = ['apps', 'packages'];

/** Query keys whose value is a person, or what a person typed. */
export const PII_KEYS = ['email', 'name', 'username', 'phone', 'query', 'q', 'search'];

const KEYS = PII_KEYS.join('|');
const MARKER_RE = /url-pii-ok:(.*)$/;

/** Replace comment contents with spaces (strings kept), preserving offsets and newlines. */
function blankComments(source) {
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
          out += source.slice(i, i + 2);
          i += 2;
          continue;
        }
        out += source[i];
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

const SET_RE = new RegExp(
  `(?:[\\w$]*(?:params|Params|search|Search|query|Query|qs|url|Url|URL)[\\w$]*|next)\\??\\.(?:set|append)\\(\\s*(['"\`])(${KEYS})\\1`,
  'g',
);
const BUILDER_RE =
  /(?:setSearchParams|new\s+URLSearchParams|navigate|createSearchParams)\s*\(\s*(?:\(\s*\)\s*=>\s*\(?\s*)?\{/g;
const OBJECT_KEY_RE = new RegExp(`[{,]\\s*(['"]?)(${KEYS})\\1\\s*(?=[:,}])`, 'g');
const LITERAL_RE = new RegExp(`(['"\`])[^'"\`\\n]*?[?&](${KEYS})=`, 'g');

function lineOf(code, at) {
  return code.slice(0, at).split('\n').length;
}

/**
 * Every address built with a personal key in `source`. Exported for the test,
 * which runs it over synthetic sources.
 */
export function findUrlPii(source, file = '<source>') {
  const code = blankComments(source);
  const lines = source.split('\n');
  const raw = [];
  for (const m of code.matchAll(SET_RE)) {
    raw.push({ line: lineOf(code, m.index), key: m[2], kind: 'search-param' });
  }
  for (const m of code.matchAll(BUILDER_RE)) {
    const open = m.index + m[0].length - 1;
    const literal = literalAt(code, open);
    for (const key of literal.matchAll(OBJECT_KEY_RE)) {
      raw.push({ line: lineOf(code, open + key.index), key: key[2], kind: 'builder-object' });
    }
  }
  for (const m of code.matchAll(LITERAL_RE)) {
    raw.push({ line: lineOf(code, m.index + m[0].length - 1), key: m[2], kind: 'literal' });
  }

  const findings = [];
  const seen = new Set();
  for (const f of raw.sort((a, b) => a.line - b.line)) {
    const id = `${f.line}:${f.key}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const marker = [lines[f.line - 1], lines[f.line - 2]]
      .map((text) => (text === undefined ? null : MARKER_RE.exec(text)))
      .find(Boolean);
    if (marker && marker[1].trim().length > 0) continue;
    findings.push({
      file,
      ...f,
      ...(marker ? { reason: 'url-pii-ok marker without a reason' } : {}),
    });
  }
  return findings;
}

function walk(dir, files) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name === 'generated') continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, files);
    else if (
      /\.(ts|tsx|mts|js|jsx|mjs)$/.test(name) &&
      !/\.(test|spec)\.[cm]?[jt]sx?$/.test(name) &&
      !/\.d\.ts$/.test(name)
    ) {
      files.push(path);
    }
  }
  return files;
}

/** Every `<parent>/<name>/src` that exists, in a stable order. */
export function scanRoots(root = ROOT) {
  const roots = [];
  for (const parent of SCAN_PARENTS) {
    let names = [];
    try {
      names = readdirSync(join(root, parent)).sort();
    } catch {
      continue;
    }
    for (const name of names) {
      const src = join(root, parent, name, 'src');
      try {
        if (statSync(src).isDirectory()) roots.push(`${parent}/${name}/src`);
      } catch {
        // no src — nothing to scan
      }
    }
  }
  return roots;
}

export function auditRepository(root = ROOT, roots = scanRoots(root)) {
  const findings = [];
  let scanned = 0;
  for (const scanRoot of roots) {
    for (const file of walk(join(root, scanRoot), [])) {
      scanned += 1;
      const rel = relative(root, file).split('\\').join('/');
      findings.push(...findUrlPii(readFileSync(file, 'utf8'), rel));
    }
  }
  return { roots, scanned, findings };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { roots, scanned, findings } = auditRepository();
  const print = (line) => process.stdout.write(`${line}\n`);
  if (process.argv.includes('--json')) {
    print(JSON.stringify({ roots, scanned, findings }, null, 2));
  } else if (findings.length === 0) {
    print(
      `url-pii: ${scanned} files in ${roots.length} apps/packages, no personal key in an address.`,
    );
  } else {
    print(`url-pii: ${findings.length} personal key(s) in an address:`);
    for (const f of findings) {
      print(`  ${f.file}:${f.line}  ${f.key} (${f.kind})${f.reason ? ` — ${f.reason}` : ''}`);
    }
    print('An address carries ids and non-personal filters only (GV-05). An API request may');
    print('carry a search when the line says why: `// url-pii-ok: <reason>`.');
  }
  if (findings.length > 0) process.exitCode = 1;
}
