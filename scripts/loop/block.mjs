#!/usr/bin/env node
/**
 * Tek çağrıda blok okuma (2026-10-19).
 *
 *     node scripts/loop/block.mjs <dosya> <sorgu> [<sorgu> …] [<dosya> <sorgu> …] [--full]
 *     node scripts/loop/block.mjs <dosya>                  # sorgu yok → dosyanın yapısı
 *
 * Sorgu: `send` (bildirilen ad) · `ChatService.send` (sahibiyle) · `412` (o satırı içeren
 * blok) · `it:metin` / `describe:metin` (başlığında metin geçen test bloğu) · `re:desen` ya da
 * `rei:desen` (regex, rei harf duyarsız: eşleşen satırlar + onları kapsayan bloklar; grep -n +
 * sed -n yerine. `/desen/` biçimi yok — Git Bash onu bir yola çevirir).
 * .md'de başlık metni, .prisma'da model/enum adı. Diğer dosya türlerinde grep çıktısı verir.
 *
 * Neden: pencereler bir bloğu okumak için önce `grep -n`, sonra `sed -n a,bp` çağırıyordu
 * (26 pencerede 760 çift, %10'unda aralık ıskalanıp yeniden okundu). Her ayrı çağrı o anki
 * bağlamın tamamını yeniden okur; bu betik bul + oku işini tek çağrıya indirir ve bloğun
 * sınırını tahmin etmez — TypeScript ayrıştırıcısıyla (tip kontrolü yok) bulur.
 *
 * Yalnız okur. "bulunamadı" yokluk kanıtı değildir (dinamik kayıt, string ile çağrı…);
 * grep ile doğrula. Çıkış: 0 bulundu · 1 en az bir sorgu bulunamadı · 2 kullanım hatası.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { extname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
let ts = null;
try {
  ts = require('typescript');
} catch {
  ts = null;
}

/** Bundan uzun blok gövdesi yerine ilk satırları + iç blokları basar (`--full` ile tamamı). */
export const MAX_LINES = 200;
const HEAD_LINES = 12;
const GREP_CONTEXT = 8;
const LINE_WINDOW = 15;
const MAX_INLINE_MATCHES = 3;
const OUTLINE_ROWS = 150;
const PATTERN_LIST_LINES = 40;
const BOM = String.fromCharCode(0xfeff);

const TS_EXT = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs']);
const TEST_KINDS = { describe: 'describe', suite: 'describe', it: 'it', test: 'it', bench: 'it' };
const HOOKS = new Set(['beforeEach', 'afterEach', 'beforeAll', 'afterAll']);

// ───────────────────────── dosya → bloklar ─────────────────────────

/** @returns {{ entries: Entry[], stmts: Range[], imports: Range|null, warning: string|null }} */
function parseTs(file, text, lines) {
  const ext = extname(file).toLowerCase();
  const kind = ext === '.tsx' || ext === '.jsx' ? ts.ScriptKind.TSX : ext === '.ts' || ext === '.mts' || ext === '.cts' ? ts.ScriptKind.TS : ts.ScriptKind.JS;
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
  const lineOf = (pos) => sf.getLineAndCharacterOfPosition(pos).line + 1;
  const startOf = (node) => {
    let line = lineOf(node.getStart(sf, true));
    // Bitişik `//` yorumları da bloğa dahil (JSDoc ve decorator'lar zaten node'un içinde).
    while (line > 1 && /^\s*(\/\/|\/\*|\*)/.test(lines[line - 2])) line--;
    return line;
  };
  const endOf = (node) => lineOf(node.getEnd());
  const entries = [];
  const stmts = [];
  let imports = null;
  const add = (node, kind, name, owner) =>
    entries.push({ kind, name, qual: owner ? `${owner}.${name}` : name, start: startOf(node), end: endOf(node) });
  const isFn = (n) => n && (ts.isArrowFunction(n) || ts.isFunctionExpression(n));
  const propName = (n) => (n && (ts.isIdentifier(n) || ts.isStringLiteral(n) || ts.isPrivateIdentifier(n) || ts.isNumericLiteral(n)) ? n.text : null);
  const calleeName = (e) =>
    ts.isIdentifier(e) ? e.text : ts.isPropertyAccessExpression(e) || ts.isCallExpression(e) ? calleeName(e.expression) : null;
  const titleOf = (arg) =>
    !arg ? '' : ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg) ? arg.text : arg.getText(sf).replace(/^`|`$/g, '');
  const statementParent = (p) =>
    p && (ts.isSourceFile(p) || ts.isBlock(p) || ts.isModuleBlock(p) || ts.isCaseClause(p) || ts.isDefaultClause(p));

  function visit(node, owner) {
    if (statementParent(node.parent)) stmts.push({ start: startOf(node), end: endOf(node), node });
    if (ts.isImportDeclaration(node)) {
      const s = lineOf(node.getStart(sf)), e = endOf(node);
      imports = imports ? { start: Math.min(imports.start, s), end: Math.max(imports.end, e), count: imports.count + 1 } : { start: s, end: e, count: 1 };
      return;
    }
    let next = owner;
    if (ts.isFunctionDeclaration(node)) {
      const n = node.name?.text ?? 'default';
      add(node, 'function', n, owner);
      next = owner ? `${owner}.${n}` : n;
    } else if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) {
      const n = node.name?.text ?? 'default';
      add(node, 'class', n, owner);
      next = owner ? `${owner}.${n}` : n;
    } else if (ts.isInterfaceDeclaration(node)) add(node, 'interface', node.name.text, owner);
    else if (ts.isTypeAliasDeclaration(node)) add(node, 'type', node.name.text, owner);
    else if (ts.isEnumDeclaration(node)) add(node, 'enum', node.name.text, owner);
    else if (ts.isModuleDeclaration(node) && node.name) {
      add(node, 'namespace', node.name.text, owner);
      next = owner ? `${owner}.${node.name.text}` : node.name.text;
    } else if (ts.isMethodDeclaration(node) || ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node)) {
      const n = propName(node.name);
      if (n) {
        add(node, 'method', n, owner);
        next = owner ? `${owner}.${n}` : n;
      }
    } else if (ts.isConstructorDeclaration(node)) add(node, 'method', 'constructor', owner);
    else if ((ts.isPropertyDeclaration(node) || ts.isPropertyAssignment(node)) && node.initializer) {
      const n = propName(node.name);
      const init = node.initializer;
      if (n && (isFn(init) || ts.isObjectLiteralExpression(init))) {
        add(node, isFn(init) ? 'method' : 'object', n, owner);
        next = owner ? `${owner}.${n}` : n;
      }
    } else if (ts.isVariableStatement(node)) {
      const decls = node.declarationList.declarations;
      for (const d of decls) {
        if (!ts.isIdentifier(d.name)) continue;
        const target = decls.length === 1 ? node : d;
        add(target, isFn(d.initializer) ? 'function' : 'const', d.name.text, owner);
        if (d.initializer) visit(d.initializer, owner ? `${owner}.${d.name.text}` : d.name.text);
      }
      return;
    } else if (ts.isExpressionStatement(node) && ts.isCallExpression(node.expression)) {
      const call = node.expression;
      const base = calleeName(call.expression);
      if (base && TEST_KINDS[base]) entries.push({ kind: TEST_KINDS[base], name: titleOf(call.arguments[0]), qual: null, start: startOf(node), end: endOf(node) });
      else if (base && HOOKS.has(base)) entries.push({ kind: 'hook', name: base, qual: null, start: startOf(node), end: endOf(node) });
    }
    ts.forEachChild(node, (c) => visit(c, next));
  }
  ts.forEachChild(sf, (c) => visit(c, null));
  const errors = sf.parseDiagnostics?.length ?? 0;
  return { entries, stmts, imports, warning: errors ? `⚠ ${errors} sözdizimi hatası — sınırlar yanlış olabilir` : null };
}

function parseMarkdown(lines) {
  const heads = [];
  let fence = false;
  lines.forEach((l, i) => {
    if (/^\s*(```|~~~)/.test(l)) fence = !fence;
    const m = !fence && /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(l);
    if (m) heads.push({ level: m[1].length, text: m[2], line: i + 1 });
  });
  const entries = heads.map((h, k) => {
    let end = lines.length;
    for (let j = k + 1; j < heads.length; j++) if (heads[j].level <= h.level) { end = heads[j].line - 1; break; }
    while (end > h.line && lines[end - 1].trim() === '') end--;
    return { kind: 'bölüm', name: h.text, qual: null, start: h.line, end, level: h.level };
  });
  return { entries, stmts: [], imports: null, warning: null };
}

function parsePrisma(lines) {
  const entries = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^(model|enum|view|type|generator|datasource)\s+(\w+)\s*\{/.exec(lines[i]);
    if (!m) continue;
    let j = i;
    while (j < lines.length - 1 && !/^\}/.test(lines[j])) j++;
    let start = i + 1;
    while (start > 1 && /^\s*\/\//.test(lines[start - 2])) start--;
    entries.push({ kind: m[1], name: m[2], qual: null, start, end: j + 1 });
  }
  return { entries, stmts: [], imports: null, warning: null };
}

// ───────────────────────── biçim ─────────────────────────

const label = (e) => (e.kind === 'it' || e.kind === 'describe' ? `${e.kind}('${e.name}')` : `${e.kind} ${e.qual ?? e.name}`);
const span = (e) => e.end - e.start + 1;
const contains = (outer, inner) => outer.start <= inner.start && inner.end <= outer.end && span(outer) > span(inner);

/** `mark` kümesindeki satırlar `>` ile işaretlenir (desen sorgusunda eşleşen satırlar). */
function body(lines, start, end, mark = null) {
  const out = [];
  for (let n = start; n <= end; n++) out.push(`${String(n).padStart(6)}${mark?.has(n) ? '>' : ''}\t${lines[n - 1] ?? ''}`);
  return out.join('\n');
}

/** Bloğun doğrudan içindeki (başka bir iç bloğun içinde olmayan) bloklar/ifadeler. */
function innerRows(parsed, lines, outer) {
  const pool = [
    ...parsed.entries.filter((e) => contains(outer, e)).map((e) => ({ ...e, text: label(e) })),
    ...parsed.stmts
      .filter((s) => contains(outer, s) && !parsed.entries.some((e) => e.start === s.start && e.end === s.end))
      .map((s) => ({ ...s, text: (lines[s.start - 1] ?? '').trim().slice(0, 90) })),
  ];
  const direct = pool.filter((p) => !pool.some((q) => q !== p && contains(q, p)));
  direct.sort((a, b) => a.start - b.start);
  return direct.slice(0, 60).map((p) => `${`${p.start}-${p.end}`.padStart(11)}  ${p.text}`);
}

function printBlock(ctx, e, note = '', mark = null) {
  const { rel, lines, parsed, full } = ctx;
  const head = `== ${rel}:${e.start}-${e.end} · ${note || label(e)} · ${span(e)} satır${parsed.warning ? ` · ${parsed.warning}` : ''}`;
  if (span(e) <= MAX_LINES || full) return `${head}\n${body(lines, e.start, e.end, mark)}`;
  const inner = innerRows(parsed, lines, e);
  return [
    `${head} — ${MAX_LINES} satırdan uzun: ilk ${HEAD_LINES} satır + iç bloklar (tamamı için --full ya da iç bloğun satırı)`,
    body(lines, e.start, e.start + HEAD_LINES - 1, mark),
    inner.length ? `  iç bloklar:\n${inner.join('\n')}` : '  (iç blok yok)',
  ].join('\n');
}

function outline(ctx) {
  const { rel, lines, parsed } = ctx;
  const depthOf = (e) => parsed.entries.filter((o) => o !== e && contains(o, e)).length;
  // Kısa obje alanları (`tr: {…}` gibi) yapıyı kalabalıklaştırır; sorguyla yine bulunurlar.
  // Yerel `const`'lar (describe içindeki fixture değişkenleri gibi) da yapıda gösterilmez.
  const rows = parsed.entries
    .map((e) => ({ e, d: depthOf(e) }))
    .filter(({ e, d }) => !(e.kind === 'object' && span(e) < 5) && !(e.kind === 'const' && d > 0));
  let maxDepth = 3;
  while (maxDepth > 0 && rows.filter((r) => r.d <= maxDepth).length > OUTLINE_ROWS) maxDepth--;
  const shown = rows.filter((r) => r.d <= maxDepth);
  const out = [`== ${rel} · yapı · ${lines.length} satır${parsed.warning ? ` · ${parsed.warning}` : ''}`];
  if (parsed.imports) out.push(`${`${parsed.imports.start}-${parsed.imports.end}`.padStart(11)}  importlar (${parsed.imports.count})`);
  for (const { e, d } of shown.slice(0, OUTLINE_ROWS)) out.push(`${`${e.start}-${e.end}`.padStart(11)}  ${'  '.repeat(d)}${label(e)}`);
  const hidden = rows.length - Math.min(shown.length, OUTLINE_ROWS);
  if (hidden > 0) out.push(`  … ${hidden} iç blok gizlendi — ilgili satırla sor: block.mjs ${rel} <satır>`);
  if (parsed.entries.length === 0) out.push('  (tanınan blok yok)');
  out.push(`  → blok: node scripts/loop/block.mjs ${rel} <ad|satır|re:desen>`);
  return out.join('\n');
}

/** `query` metin (içerir) ya da RegExp. */
function grepFallback(ctx, query) {
  const { rel, lines } = ctx;
  const hits = matchLines(lines, query);
  if (hits.length === 0) return null;
  const ranges = [];
  for (const h of hits) {
    const s = Math.max(1, h - GREP_CONTEXT), e = Math.min(lines.length, h + GREP_CONTEXT);
    const last = ranges.at(-1);
    if (last && s <= last.end + 1) last.end = e;
    else ranges.push({ start: s, end: e });
  }
  const why = ctx.kind === 'md' ? 'başlıklarda yok' : 'AST yok';
  const shown = query instanceof RegExp ? String(query) : `'${query}'`;
  const out = [`== ${rel} · ${shown} · ${hits.length} eşleşme (${why} — grep çıktısı, ±${GREP_CONTEXT} satır)`];
  let budget = MAX_LINES;
  for (const r of ranges) {
    if (budget <= 0) {
      out.push(`  … kalan eşleşmeler basılmadı (${MAX_LINES} satır sınırı); daraltmak için satırla sor`);
      break;
    }
    const end = Math.min(r.end, r.start + budget - 1);
    out.push(body(lines, r.start, end), '  --');
    budget -= end - r.start + 1;
  }
  return out.join('\n');
}

// ───────────────────────── sorgu ─────────────────────────

/**
 * Satırı "kapsayan blok": obje alanları ve iç içe yerel `const`'lar sayılmaz (çevreleyen
 * fonksiyon/test daha anlamlı). Blok sınırdan büyükse satırı içeren, sığan en geniş ifade;
 * o da yoksa ±LINE_WINDOW penceresi. @returns {{ range, note: string }}
 */
function holderOf(ctx, n) {
  const { lines, parsed, full } = ctx;
  const nested = (e) => parsed.entries.some((o) => o !== e && contains(o, e));
  const holders = parsed.entries
    .filter((e) => e.start <= n && n <= e.end && e.kind !== 'object' && !(e.kind === 'const' && nested(e)))
    .sort((a, b) => span(a) - span(b));
  const deepest = holders[0];
  if (deepest && (span(deepest) <= MAX_LINES || full)) return { range: deepest, note: '' };
  const fits = parsed.stmts.filter((s) => s.start <= n && n <= s.end && span(s) <= MAX_LINES && (!deepest || contains(deepest, s) || span(deepest) === span(s)));
  fits.sort((a, b) => span(b) - span(a));
  const where = deepest ? ` (${label(deepest)} ${deepest.start}-${deepest.end} içinde)` : '';
  if (fits[0]) return { range: fits[0], note: `satır ${n}'i içeren ifade${where}` };
  const s = Math.max(1, n - LINE_WINDOW), e = Math.min(lines.length, n + LINE_WINDOW);
  return { range: { start: s, end: e }, note: `satır ${n} ±${LINE_WINDOW}${where}` };
}

function lineQuery(ctx, n) {
  if (n < 1 || n > ctx.lines.length) return { text: `satır ${n} dosyanın dışında (${ctx.lines.length} satır)`, found: false };
  const { range, note } = holderOf(ctx, n);
  return { text: printBlock(ctx, range, note), found: true };
}

const matchLines = (lines, query) => {
  const hits = [];
  lines.forEach((l, i) => (query instanceof RegExp ? query.test(l) : l.includes(query)) && hits.push(i + 1));
  return hits;
};

/** `re:desen`: eşleşen satırlar (grep -n yerine) + onları kapsayan bloklar (sed -n yerine). */
function patternQuery(ctx, re) {
  const { rel, lines, parsed, isAst } = ctx;
  const hits = matchLines(lines, re);
  if (hits.length === 0) return { text: `== ${rel} · ${re} · bulunamadı (yokluk kanıtı değildir; dosyayı bilmiyorsan grep -rln)`, found: false };
  if (!isAst) return { text: grepFallback(ctx, re), found: true };
  const inImports = (n) => parsed.imports && parsed.imports.start <= n && n <= parsed.imports.end;
  // Aynı bloğa düşen eşleşmeler tek blokta toplanır.
  const blocks = [];
  for (const n of hits) {
    if (inImports(n)) continue;
    const h = holderOf(ctx, n);
    const same = blocks.find((b) => b.range.start === h.range.start && b.range.end === h.range.end);
    if (same) same.marks.add(n);
    else blocks.push({ ...h, marks: new Set([n]) });
  }
  const list = [
    `== ${rel} · ${re} · ${hits.length} eşleşme · ${blocks.length} blok`,
    ...hits.slice(0, PATTERN_LIST_LINES).map((n) => `${String(n).padStart(6)}:\t${lines[n - 1].trim().slice(0, 120)}${inImports(n) ? '   (import)' : ''}`),
  ];
  if (hits.length > PATTERN_LIST_LINES) list.push(`  … +${hits.length - PATTERN_LIST_LINES} eşleşme daha (daralt ya da satırla sor)`);
  const total = blocks.reduce((s, b) => s + Math.min(span(b.range), MAX_LINES), 0);
  if (blocks.length <= MAX_INLINE_MATCHES && total <= MAX_LINES * 1.5) {
    return { text: [list.join('\n'), ...blocks.map((b) => printBlock(ctx, b.range, b.note, b.marks))].join('\n\n'), found: true };
  }
  const rows = blocks.slice(0, 40).map((b) =>
    `${`${b.range.start}-${b.range.end}`.padStart(11)}  ${b.note || label(b.range)}  (eşleşme: ${[...b.marks].join(', ')})`);
  list.push(`  bloklar — hangisi? (satırla ya da adla sor: block.mjs ${rel} <satır|ad>)`, ...rows);
  return { text: list.join('\n'), found: true };
}

function nameQuery(ctx, query) {
  const { rel, parsed, isAst } = ctx;
  const m = /^(it|test|describe):(.+)$/s.exec(query);
  let hits;
  if (m) {
    const want = m[1] === 'describe' ? 'describe' : 'it';
    const needle = m[2].toLowerCase();
    hits = parsed.entries.filter((e) => e.kind === want && e.name.toLowerCase().includes(needle));
  } else if (ctx.kind === 'md') {
    const needle = query.toLowerCase();
    hits = parsed.entries.filter((e) => e.name.toLowerCase().includes(needle));
  } else {
    hits = parsed.entries.filter((e) => e.kind !== 'it' && e.kind !== 'describe' && e.kind !== 'hook' && (e.name === query || e.qual === query || e.qual?.endsWith(`.${query}`)));
    if (query.includes('.')) hits = hits.filter((e) => e.qual === query || e.qual?.endsWith(`.${query}`));
  }
  // Aynı aralık iki kez sayılmasın (ör. aynı satırlardaki sınıf ve onun default export'u).
  hits = hits.filter((h, i) => hits.findIndex((o) => o.start === h.start && o.end === h.end) === i);
  if (hits.length === 0) {
    // .md'de başlıkta geçmeyen metin (tablo satırı, kural cümlesi) grep ile aranır.
    if (!isAst || ctx.kind === 'md') {
      const g = grepFallback(ctx, query);
      if (g) return { text: g, found: true };
    }
    const needle = query.replace(/^(it|test|describe):/, '').toLowerCase();
    const near = parsed.entries.filter((e) => needle.length >= 2 && e.name.toLowerCase().includes(needle)).slice(0, 5).map((e) => `${e.start}-${e.end} ${label(e)}`);
    return {
      text: `== ${rel} · bulunamadı: '${query}' — grep ile ara (yokluk kanıtı değildir)${near.length ? `\n  benzer: ${near.join(' · ')}` : ''}`,
      found: false,
    };
  }
  const total = hits.reduce((n, h) => n + Math.min(span(h), MAX_LINES), 0);
  if (hits.length <= MAX_INLINE_MATCHES && total <= MAX_LINES * 1.5) return { text: hits.map((h) => printBlock(ctx, h)).join('\n\n'), found: true };
  return {
    text: [
      `== ${rel} · '${query}' · ${hits.length} eşleşme — hangisi? (satırla sor: block.mjs ${rel} <satır>)`,
      ...hits.slice(0, 40).map((h) => `${`${h.start}-${h.end}`.padStart(11)}  ${label(h)}`),
    ].join('\n'),
    found: true,
  };
}

// ───────────────────────── giriş ─────────────────────────

function load(file, full) {
  const text = readFileSync(file, 'utf8');
  const raw = text.startsWith(BOM) ? text.slice(1) : text;
  const lines = raw.split(/\r?\n/);
  if (lines.length > 1 && lines.at(-1) === '') lines.pop();
  const ext = extname(file).toLowerCase();
  const rel0 = relative(process.cwd(), resolve(file)).replace(/\\/g, '/');
  const rel = rel0.startsWith('..') ? file.replace(/\\/g, '/') : rel0;
  let parsed, kind;
  if (TS_EXT.has(ext) && ts) [parsed, kind] = [parseTs(file, lines.join('\n'), lines), 'ts'];
  else if (ext === '.md') [parsed, kind] = [parseMarkdown(lines), 'md'];
  else if (ext === '.prisma') [parsed, kind] = [parsePrisma(lines), 'prisma'];
  else [parsed, kind] = [{ entries: [], stmts: [], imports: null, warning: TS_EXT.has(ext) ? '⚠ typescript yüklenemedi' : null }, 'other'];
  return { rel, lines, parsed, full, kind, isAst: kind !== 'other' };
}

/** @returns {{ out: string, code: number }} */
export function run(argv) {
  const full = argv.includes('--full');
  const args = argv.filter((a) => a !== '--full');
  const isFile = (a) => existsSync(a) && statSync(a).isFile();
  if (args.length === 0 || !isFile(args[0])) {
    return {
      out: `kullanım: node scripts/loop/block.mjs <dosya> [<ad|satır|re:desen|it:başlık|describe:başlık> …] [<dosya> …] [--full]${args[0] ? `\ndosya bulunamadı: ${args[0]}` : ''}\n`,
      code: 2,
    };
  }
  const items = [];
  for (const a of args) {
    if (isFile(a)) items.push({ file: a, queries: [] });
    else items.at(-1).queries.push(a);
  }
  const parts = [];
  let missing = false;
  for (const { file, queries } of items) {
    const ctx = load(file, full);
    if (queries.length === 0) {
      parts.push(ctx.kind === 'other' ? `== ${ctx.rel} · yapı bu dosya türünde yok (AST yok) · ${ctx.lines.length} satır` : outline(ctx));
      continue;
    }
    for (const q of queries) {
      const pat = /^(re|rei):(.+)$/s.exec(q);
      let r;
      if (pat) {
        let re;
        try {
          re = new RegExp(pat[2], pat[1] === 'rei' ? 'i' : '');
        } catch (err) {
          return { out: `geçersiz desen ${q}: ${err.message}\n`, code: 2 };
        }
        r = patternQuery(ctx, re);
      } else if (/^\d+$/.test(q)) {
        r = ctx.isAst ? lineQuery(ctx, Number(q)) : { text: printBlock(ctx, { start: Math.max(1, +q - LINE_WINDOW), end: Math.min(ctx.lines.length, +q + LINE_WINDOW) }, `satır ${q} ±${LINE_WINDOW} (AST yok)`), found: +q >= 1 && +q <= ctx.lines.length };
      } else r = nameQuery(ctx, q);
      if (!r.found) missing = true;
      parts.push(r.text);
    }
  }
  return { out: parts.join('\n\n') + '\n', code: missing ? 1 : 0 };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { out, code } = run(process.argv.slice(2));
  process.stdout.write(out);
  process.exitCode = code;
}
