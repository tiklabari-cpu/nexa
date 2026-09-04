/**
 * Requirement coverage — the 247 catalogue rows of `prd-uyum-denetimi.md` Ek A,
 * crossed with the requirement tags CONVENTIONS §7 puts in test titles.
 *
 * It answers one question: **which acceptance criteria has nobody claimed a test
 * for.** It does not answer whether the tests that do claim one are any good —
 * see "WHAT THIS DOES NOT BUY" at the bottom, which is the whole reason the
 * rule in §7 exists.
 *
 * Run: `pnpm audit:req-coverage` · machine form: `pnpm audit:req-coverage --json`
 *
 * ── INPUT: why the catalogue is parsed in place, not copied to JSON ──────────
 *
 * Ek A is a markdown table, and a table is a worse input than a data file. The
 * alternative — transcribe 247 rows into `catalog.json` and read that — was
 * rejected because it makes two sources of the same list, and the failure mode
 * of two sources is silent: the audit document gets edited (it is the record of
 * a review, so it will be), the JSON does not, and this report keeps answering
 * confidently about a catalogue that no longer exists. `sweep.cjs` already
 * parses PRD §6 in place for the same reason.
 *
 * The price is parser fragility, and it is paid with a tripwire rather than
 * with hope: EXPECTED_ROWS is pinned. A parser that silently sees twelve rows
 * would otherwise report magnificent coverage.
 *
 * Two irregularities in the catalogue are handled by name, because both are
 * facts about the document rather than bugs to fix here:
 *
 *   - `NFR-C8` is listed TWICE (once under FR-08, once under NFR-SEC-COMP).
 *     So Ek A has 247 rows but 246 distinct items. Reported, then merged; if
 *     the two rows ever disagree on a verdict that is reported as an error,
 *     because then "the item's verdict" has no answer.
 *   - `FR-MOD-02.4.1–.6` is a RANGE, written with an en-dash. No test can tag
 *     it literally (the extractor stops at the dash), and expanding it would
 *     invent five IDs the catalogue does not list. It gets one alias instead:
 *     a tag of `FR-MOD-02.4.1` claims it. See TAG_ALIASES.
 *
 * ── EXTRACTOR: the shapes of CONVENTIONS §7.6, two fixes ────────────────────
 *
 * §7.6 documents the grep that proves the format is extractable. This is that
 * grep as a script, and turning it into one surfaced two defects in it. Both
 * were fixed rather than copied, and both were measured against this repo:
 *
 *   1. **JS alternation is leftmost-first; POSIX ERE is leftmost-longest.**
 *     Ported verbatim, `FR-MOD-04.RBAC` comes out as `FR-MOD-04.` — the first
 *     branch matches a prefix and JS stops there, where grep would have
 *     preferred the longer branch. 2 of 246 catalogue IDs mis-extract under the
 *     verbatim port, 0 under the branch used here.
 *   2. **§7.6's pipeline only sees an ID that is FIRST inside its
 *     parenthesis.** Its extraction step is `\(<ID>[^)]*\)`, so
 *     `(400, NFR-S8)` and `(M-LOAD-CAP · NFR-R2)` match nothing. §7.4 imposes
 *     no such ordering — it says a work-item id may ride along as detail — so
 *     the grep undercounts. Measured: 8 claim sites and 1 whole item
 *     (`NFR-R2`) invisible to it, which is why this reports 75 tagged items in
 *     146 files where §7.1's table says 74 in 141. Otherwise the two agree
 *     exactly: every site the grep finds, this finds.
 *
 * A third §7.6 defect is not fixable here and is REPORTED instead: the slash
 * abbreviation §7.3 forbids (`NFR-S4/S5`). No extractor can expand it, so the
 * second ID is lost either way; `slashAbbreviations` lists the titles that
 * still do it, since a silently lost claim is exactly what this exists to find.
 *
 * ── HEURISTIC, and where it stops ───────────────────────────────────────────
 *
 *   - A tag counts only in the TITLE of a `describe`/`it`/`test` call whose
 *     opening starts a line — the §7.2 rule that a comment cannot carry a
 *     claim. Block comments are blanked first, so a `describe(` quoted inside
 *     one is not read as code; a `//`-commented one cannot match the anchor.
 *   - Only the modifiers that keep a call a titled block are followed
 *     (`.each`, `.skip`, `test.describe`, …). `test.beforeAll(` and
 *     `test.setTimeout(` open a line too and never carry a title.
 *   - The title must sit on the same line as the call opening — prettier puts
 *     it there throughout. `it.each(<table>)('title')` is handled by balancing
 *     the table argument, but only while it fits on that line. A call whose
 *     title could not be read is counted as `unscannable`, and listed
 *     individually when a catalogue ID appears just below it, because THAT is a
 *     claim about to be lost. Today 41 are unscannable — 40 multi-line `.each`
 *     tables and one `describe(key, …)` whose title is a variable — and none is
 *     near a catalogue ID.
 *   - Nesting is irrelevant HERE. §7.4 says a `describe` tag distributes to the
 *     `it`s under it; that changes what a tag MEANS, not which IDs are claimed,
 *     and this report only collects the set.
 */
const { execFileSync } = require('child_process');
const fs = require('fs');

const CATALOG_FILE = 'prd-uyum-denetimi.md';

/**
 * Rows expected in Ek A. Not a magic number — a tripwire. Bump it deliberately
 * when the audit document grows, so that a parser which silently stopped
 * reading cannot pass itself off as good news.
 */
const EXPECTED_ROWS = 247;

/** Catalogue IDs a tag may claim under a different spelling. See header. */
const TAG_ALIASES = new Map([['FR-MOD-02.4.1', 'FR-MOD-02.4.1–.6']]);

/**
 * Items held out of the coverage denominator.
 *
 * Without this list a recorded decision reads as a gap, and every future run of
 * this report re-opens an argument that was already settled. With it, the risk
 * runs the other way — a waiver is how debt gets hidden — so three rules hold:
 *
 *   1. Every waiver carries a `reason` and a `source` that says where the
 *     decision is written down. A waiver whose reason nobody wrote is reported
 *     as an error, the same discipline `unpaged-lists.cjs` applies.
 *   2. Waived items are PRINTED, in their own bucket, never folded into
 *     "covered". A `non-code` waiver especially is not a closure: `NFR-C2`
 *     (KVKK/VERBIS) is still open, it is just not open to a test.
 *   3. The list is deliberately SHORT. Several items with no code today were
 *     considered and left in the denominator because part of what they ask for
 *     IS code: `NFR-C3` (CCPA needs an opt-out endpoint), `NFR-C10` (a
 *     subprocessor change-notification mechanism), `FR-MOD-06.6` (a rule-based
 *     bot — no recorded decision not to build it, just no `bots` table).
 */
const WAIVERS = [
  {
    id: 'FR-MOD-13.4',
    kind: 'product-decision',
    reason: 'Visual workflow builder — the editor is not built; the paradigm is Skill',
    source: 'ADR-14 (PLAN.md:67, PLAN.md:1141) · schema.prisma:1425 says so in its own comment',
  },
  {
    id: 'SEMA-MIMARI.5.5',
    kind: 'product-decision',
    reason: 'The §5.5 phase matrix row for that same builder — one decision, two rows',
    source: 'ADR-14 (PLAN.md:67)',
  },
  {
    id: 'FR-MOD-08.4',
    kind: 'product-decision',
    reason: 'Desktop native app — web-first',
    source: 'PLAN.md §9/8 (PRD §11.1/8)',
  },
  {
    id: 'NFR-I18N4',
    kind: 'product-decision',
    reason: 'Live agent↔customer translation — Enterprise, deliberately out of scope',
    source: 'PLAN.md §9/4',
  },
  {
    id: 'NFR-U5',
    kind: 'product-decision',
    reason: 'Contractual uptime commitment + credit mechanism — no code here can promise it',
    source: 'packages/types/src/sla.ts:12-19, which excludes NFR-U5 by name',
  },
  {
    id: 'NFR-C1',
    kind: 'non-code',
    reason: 'DPA + SCC Module 2 + UK Addendum are legal texts; no assertion can sign one',
    source: 'prd-uyum-denetimi.md §7 Öncelik 4/11 — "mühendislik değil hukuk/operasyon işi"',
  },
  {
    id: 'NFR-C2',
    kind: 'non-code',
    reason: 'KVKK compliance + VERBIS registration is a filing, not a behaviour',
    source: 'prd-uyum-denetimi.md §7 Öncelik 4/11',
  },
  {
    id: 'NFR-C7',
    kind: 'non-code',
    reason:
      'ISO 27001 is a certification against an ISMS; the controls under it are covered elsewhere',
    source: 'prd-uyum-denetimi.md §6 — "Kontroller var, ISMS çerçevesi yok"',
  },
];

/** Test files, as CONVENTIONS §7.6 globs them. */
const TEST_GLOBS = ['*.test.ts', '*.test.tsx', '*.spec.ts', '*.spec.tsx'];

/**
 * A catalogue ID, in the four namespaces of §7.3.
 *
 * The `FR-MOD-` branch differs from §7.6's: `[0-9]+(?:\.[0-9A-Za-z]+)*` instead
 * of `[0-9][0-9.]*`, so it cannot stop on a trailing dot and hand back
 * `FR-MOD-04.` for `FR-MOD-04.RBAC`. See the header note on alternation order.
 */
const REQ_ID =
  /FR-MOD-[0-9]+(?:\.[0-9A-Za-z]+)*|FR-[0-9A-Z][0-9A-Z-]*\.[0-9A-Za-z]+|NFR-[A-Z0-9]+|SEMA-MIMARI\.[0-9A-Za-z][0-9A-Za-z.-]*/g;

/** A verdict cell, with or without bold and with or without a revision arrow. */
const VERDICT_CELL = /^\*{0,2}(TAM|KISMİ|YOK)\*{0,2}\s*([↑↓])?$/;

/** A `describe` / `it` / `test` call, with its modifier chain, that opens a line. */
const BLOCK_OPEN = /^[ \t]*(describe|it|test)((?:\.[A-Za-z]+)*)[ \t]*\(/;

/**
 * Modifiers that keep a call a titled block.
 *
 * `test.beforeAll(`, `test.slow(`, `test.setTimeout(` and `test.describe.configure(`
 * open a line and take no title, so accepting any chain reported 30 of them as
 * "unscannable" — an overstated boundary that buries the two shapes where a tag
 * really could go missing.
 */
const BLOCK_MODIFIERS = new Set([
  'describe',
  'each',
  'for',
  'skip',
  'only',
  'todo',
  'fails',
  'concurrent',
  'sequential',
  'serial',
  'parallel',
  'skipIf',
  'runIf',
]);

// ── catalogue ───────────────────────────────────────────────────────────────

/**
 * Blank out block comments, preserving every offset and line break.
 *
 * A comment opens only where `/*` begins a line. The obvious version —
 * `source.replace(/\/\*[\s\S]*?\*\//g, …)` — is not string-aware, so it treats
 * the `/*` inside a title like `'scans every /app/* route'` as an opener and
 * blanks real source until the next `*​/`. That was not hypothetical: it ate
 * `apps/e2e/tests/a11y.spec.ts:989` and would silently eat any tag caught in
 * the same span. Measured: of the 9 mid-line `/*` occurrences in the 472
 * tracked test files, all 9 are inside strings or prose and NONE opens a
 * comment, so the line-start rule loses nothing here. A block comment opened
 * after code on the same line would be missed — it would have to contain a
 * line-leading `describe(` to matter.
 */
function blankBlockComments(source) {
  const blank = (text) => text.replace(/[^\n]/g, ' ');
  let inComment = false;
  return source
    .split(/\n/)
    .map((line) => {
      let out = '';
      let rest = line;
      for (;;) {
        if (inComment) {
          const close = rest.indexOf('*/');
          if (close === -1) return out + blank(rest);
          out += blank(rest.slice(0, close + 2));
          rest = rest.slice(close + 2);
          inComment = false;
          continue;
        }
        const open = /^[ \t]*\/\*/.exec(rest);
        if (!open) return out + rest;
        out += blank(rest.slice(0, open[0].length));
        rest = rest.slice(open[0].length);
        inComment = true;
      }
    })
    .join('\n');
}

function parseCatalogue() {
  const lines = fs.readFileSync(CATALOG_FILE, 'utf8').split(/\r?\n/);
  const start = lines.findIndex((l) => /^##\s+Ek A\b/.test(l));
  if (start === -1)
    throw new Error(`${CATALOG_FILE}: "## Ek A" header not found — file structure changed`);
  const after = lines.findIndex((l, i) => i > start && /^##\s/.test(l));
  const end = after === -1 ? lines.length : after;

  const rows = [];
  let group = '(ungrouped)';
  for (let i = start; i < end; i += 1) {
    const line = lines[i];
    const heading = /^###\s+(.*)$/.exec(line);
    if (heading) {
      group = heading[1].trim();
      continue;
    }
    const idMatch = /^\|\s*`([^`]+)`/.exec(line);
    if (!idMatch) continue;

    const cells = line.split('|').map((c) => c.trim());
    // Cells past the verdict may themselves contain `|` (grep patterns quoted
    // in the "Eksik olan" column do), so the verdict is found by shape, not by
    // index — the same reason sweep.cjs compares cells as strings.
    const vIndex = cells.findIndex((c, n) => n >= 2 && VERDICT_CELL.test(c));
    if (vIndex === -1)
      throw new Error(`${CATALOG_FILE}:${i + 1}: no verdict cell in catalogue row`);
    const [, verdict, revised] = VERDICT_CELL.exec(cells[vIndex]);

    rows.push({
      id: idMatch[1],
      line: i + 1,
      group,
      requirement: cells.slice(2, vIndex).join(' | '),
      verdict,
      revised: revised || null,
      importance: (cells[vIndex + 1] || '').replace(/\*/g, '') || '—',
    });
  }

  if (rows.length !== EXPECTED_ROWS) {
    throw new Error(
      `${CATALOG_FILE}: parsed ${rows.length} catalogue rows, expected ${EXPECTED_ROWS}. ` +
        'Either the document changed (bump EXPECTED_ROWS deliberately) or the parser stopped early.',
    );
  }

  const items = new Map();
  const duplicates = [];
  const conflicts = [];
  for (const row of rows) {
    const seen = items.get(row.id);
    if (!seen) {
      items.set(row.id, { ...row, lines: [row.line] });
      continue;
    }
    seen.lines.push(row.line);
    duplicates.push({ id: row.id, lines: seen.lines.slice() });
    if (seen.verdict !== row.verdict)
      conflicts.push({ id: row.id, verdicts: [seen.verdict, row.verdict] });
  }

  return { rows, items, duplicates, conflicts };
}

// ── tags in test titles ─────────────────────────────────────────────────────

/**
 * Read the title string of a block call, given the source starting at its `(`.
 *
 * Returns `null` when there is no string literal to read on that line — a
 * multi-line title, or a shape this does not know. The caller reports those
 * instead of dropping them, because silence is how a scanner loses a claim.
 */
function readTitle(line, openIndex, parameterised) {
  let i = openIndex + 1;
  const skipSpace = () => {
    while (i < line.length && /\s/.test(line[i])) i += 1;
  };

  /**
   * Step from just inside `each(` to just past its `)`.
   *
   * The table takes every shape an argument can — `[…]` literals, a bare
   * identifier (`describe.each(CASES)`), a call. So this balances the
   * parenthesis rather than recognising a form; recognising only `[` made a
   * real `describe.each(CASES)('$type adapter')` unreadable.
   */
  const skipTableArgument = () => {
    let depth = 1;
    let quote = null;
    for (; i < line.length; i += 1) {
      const c = line[i];
      if (quote) {
        if (c === '\\') i += 1;
        else if (c === quote) quote = null;
        continue;
      }
      if (c === "'" || c === '"' || c === '`') quote = c;
      else if (c === '(' || c === '[' || c === '{') depth += 1;
      else if (c === ')' || c === ']' || c === '}') {
        depth -= 1;
        if (depth === 0) {
          i += 1;
          return true;
        }
      }
    }
    return false;
  };

  // Only `.each` / `.for` put a table before the title, and the guard matters:
  // without it a plain template-literal title — `it(`refuses ${key}`, …)` — is
  // eaten as if it were one, and 100+ real titles read as unscannable.
  if (parameterised) {
    // `it.each(<table>)('title', …)` — step over the table and the `)(`.
    if (!skipTableArgument()) return null;
    skipSpace();
    if (line[i] !== '(') return null;
    i += 1;
  }
  skipSpace();

  const quote = line[i];
  if (quote !== "'" && quote !== '"' && quote !== '`') return null;
  i += 1;
  let title = '';
  for (; i < line.length; i += 1) {
    if (line[i] === '\\') {
      title += line[i + 1] || '';
      i += 1;
      continue;
    }
    if (line[i] === quote) return title;
    title += line[i];
  }
  return null;
}

/**
 * Every `(…ID…)` group in a title, as the set of catalogue IDs it claims.
 *
 * `slashed` carries back the §7.3 violations found on the way — `NFR-S4/S5`
 * yields `NFR-S4` and loses `S5`, which is the whole reason the rule bans it.
 */
function idsInTitle(title, slashed) {
  const ids = [];
  for (const group of title.match(/\([^)]*\)/g) || []) {
    for (const match of group.matchAll(REQ_ID)) {
      const normalised = match[0].replace(/[.-]+$/, '');
      if (!ids.includes(normalised)) ids.push(normalised);
      const after = group.slice(match.index + match[0].length);
      if (/^\/[0-9A-Za-z]/.test(after))
        slashed.push(`${normalised}${after.split(/[^0-9A-Za-z/.]/)[0]}`);
    }
  }
  return ids;
}

function scanTests() {
  // execFileSync, not a shell string: the globs must reach git unexpanded, and
  // cmd.exe (the default shell on this platform) does not strip the quotes a
  // POSIX shell would.
  const files = execFileSync('git', ['ls-files', ...TEST_GLOBS], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  })
    .trim()
    .split(/\r?\n/)
    .filter(Boolean);

  const sites = [];
  const unscannable = [];
  const slashAbbreviations = [];

  for (const file of files) {
    const raw = fs.readFileSync(file, 'utf8');
    const lines = blankBlockComments(raw).split(/\r?\n/);
    lines.forEach((line, index) => {
      const open = BLOCK_OPEN.exec(line);
      if (!open) return;
      const modifiers = open[2] ? open[2].slice(1).split('.') : [];
      if (!modifiers.every((m) => BLOCK_MODIFIERS.has(m))) return; // a hook, not a block
      const parameterised = modifiers.includes('each') || modifiers.includes('for');
      const title = readTitle(line, open[0].length - 1, parameterised);
      if (title === null) {
        // Only worth a line in the report if a claim is about to be lost here:
        // a catalogue ID inside a parenthesis in the lines this call spans.
        const below = lines.slice(index + 1, index + 6).join('\n');
        const nearby = (below.match(/\([^)]*\)/g) || []).flatMap((g) => g.match(REQ_ID) || []);
        unscannable.push({ file, line: index + 1, text: line.trim().slice(0, 110), nearby });
        return;
      }
      const slashed = [];
      const ids = idsInTitle(title, slashed);
      for (const abbreviation of slashed) {
        slashAbbreviations.push({ file, line: index + 1, abbreviation, title });
      }
      if (ids.length) sites.push({ file, line: index + 1, title, ids });
    });
  }

  return { files, sites, unscannable, slashAbbreviations };
}

// ── analysis ────────────────────────────────────────────────────────────────

/**
 * The whole report as data. Split out from the rendering so that a test can
 * assert on the numbers rather than on formatted text, and so the CLI at the
 * bottom is only a printer.
 */
function analyse() {
  const { rows, items, duplicates, conflicts } = parseCatalogue();
  const { files, sites, unscannable, slashAbbreviations } = scanTests();

  const errors = [];
  for (const { id, verdicts } of conflicts) {
    errors.push(
      `catalogue: \`${id}\` is listed twice with different verdicts (${verdicts.join(' vs ')})`,
    );
  }
  for (const [tag, target] of TAG_ALIASES) {
    if (!items.has(target))
      errors.push(`alias: \`${tag}\` points at \`${target}\`, which is not in the catalogue`);
  }

  const waived = new Map();
  for (const waiver of WAIVERS) {
    if (!items.has(waiver.id)) {
      errors.push(`waiver: \`${waiver.id}\` is not a catalogue item — stale waiver`);
      continue;
    }
    if (!waiver.reason || !waiver.source) {
      errors.push(
        `waiver: \`${waiver.id}\` has no reason or no source — a waiver nobody justified is not one`,
      );
      continue;
    }
    waived.set(waiver.id, waiver);
  }

  /** ID -> sites claiming it. Unknown IDs are collected separately, never dropped. */
  const claims = new Map();
  const unknownTags = [];
  for (const site of sites) {
    for (const id of site.ids) {
      const target = TAG_ALIASES.get(id) || id;
      if (!items.has(target)) {
        unknownTags.push({ id, file: site.file, line: site.line, title: site.title });
        continue;
      }
      if (!claims.has(target)) claims.set(target, []);
      claims.get(target).push(site);
    }
  }
  for (const t of unknownTags) {
    errors.push(
      `tag: \`${t.id}\` (${t.file}:${t.line}) is not one of the ${items.size} catalogue items`,
    );
  }

  const inScope = [...items.values()].filter((i) => !waived.has(i.id));
  const tagged = inScope.filter((i) => claims.has(i.id));
  const untagged = inScope.filter((i) => !claims.has(i.id));

  const VERDICTS = ['TAM', 'KISMİ', 'YOK'];
  const byVerdict = VERDICTS.map((v) => ({
    verdict: v,
    inScope: inScope.filter((i) => i.verdict === v).length,
    tagged: tagged.filter((i) => i.verdict === v).length,
    untagged: untagged.filter((i) => i.verdict === v).length,
  }));

  /** Distinct titles that claim at least one catalogue item — not (item, site) pairs. */
  const claiming = [...new Set([...claims.values()].flat())];
  const claimSites = claiming.length;
  const claimFiles = new Set(claiming.map((s) => s.file)).size;
  const lostClaims = unscannable.filter((u) => u.nearby.length > 0);

  return {
    rows,
    items,
    duplicates,
    files,
    unscannable,
    slashAbbreviations,
    unknownTags,
    errors,
    waived,
    claims,
    inScope,
    tagged,
    untagged,
    byVerdict,
    claimSites,
    claimFiles,
    lostClaims,
  };
}

/** The machine form CI consumes. Same numbers as the printed report. */
function toJson(a) {
  return {
    source: { catalog: CATALOG_FILE, testFiles: a.files.length, convention: 'CONVENTIONS.md §7' },
    catalog: { rows: a.rows.length, items: a.items.size, duplicates: a.duplicates },
    waived: [...a.waived.values()],
    summary: {
      inScope: a.inScope.length,
      tagged: a.tagged.length,
      untagged: a.untagged.length,
      claimSites: a.claimSites,
      claimFiles: a.claimFiles,
      byVerdict: a.byVerdict,
    },
    tagged: a.tagged.map((i) => ({
      id: i.id,
      verdict: i.verdict,
      importance: i.importance,
      sites: a.claims.get(i.id).map((s) => ({ file: s.file, line: s.line, title: s.title })),
    })),
    untagged: a.untagged.map((i) => ({
      id: i.id,
      verdict: i.verdict,
      importance: i.importance,
      group: i.group,
      requirement: i.requirement,
    })),
    unknownTags: a.unknownTags,
    slashAbbreviations: a.slashAbbreviations,
    unscannable: { total: a.unscannable.length, nearACatalogueId: a.lostClaims },
    errors: a.errors,
  };
}

// ── report ──────────────────────────────────────────────────────────────────

const pct = (n, d) => (d === 0 ? '—' : `${((n / d) * 100).toFixed(1)}%`);

/**
 * Print the report. Returns the process exit code.
 *
 * Coverage debt never fails this: §7.5 makes adoption gradual on purpose, and a
 * report that is permanently red is a report nobody reads. What DOES fail is
 * this report lying about itself — a tag naming an ID the catalogue does not
 * have, a waiver for an item that no longer exists, a waiver with no reason.
 */
function main(argv) {
  const analysis = analyse();
  if (argv.includes('--json')) {
    console.log(JSON.stringify(toJson(analysis), null, 2));
    return analysis.errors.length ? 1 : 0;
  }
  const {
    rows,
    items,
    duplicates,
    files,
    unscannable,
    slashAbbreviations,
    errors,
    waived,
    claims,
    inScope,
    tagged,
    untagged,
    byVerdict,
    claimSites,
    claimFiles,
    lostClaims,
  } = analysis;

  console.log(`requirement coverage — ${CATALOG_FILE} Ek A × test titles (CONVENTIONS §7)\n`);
  console.log(`catalogue rows:      ${rows.length}  ->  ${items.size} distinct items`);
  for (const d of duplicates)
    console.log(`   listed twice:     \`${d.id}\` at :${d.lines.join(', :')}  (merged)`);
  console.log(`waived:              ${waived.size}  (printed below; NOT counted as covered)`);
  console.log(`in scope:            ${inScope.length}\n`);
  console.log(
    `tagged:              ${tagged.length}  (${pct(tagged.length, inScope.length)} of in-scope)`,
  );
  console.log(
    `   claim sites:      ${claimSites} in ${claimFiles} test files (of ${files.length} scanned)`,
  );
  console.log(`UNTAGGED:            ${untagged.length}\n`);

  console.log('by audit verdict:');
  console.log('   verdict   in-scope   tagged   untagged');
  for (const v of byVerdict) {
    console.log(
      `   ${v.verdict.padEnd(9)} ${String(v.inScope).padStart(8)} ${String(v.tagged).padStart(8)} ${String(v.untagged).padStart(10)}`,
    );
  }

  console.log(`\n### UNTAGGED = ${untagged.length}`);
  let group = null;
  for (const item of untagged) {
    if (item.group !== group) {
      group = item.group;
      console.log(`\n   -- ${group}`);
    }
    const verdict = `${item.verdict}${item.revised || ''}`;
    console.log(
      `   ${item.id.padEnd(20)} ${verdict.padEnd(7)} ${item.importance.padEnd(7)} ${item.requirement.slice(0, 78)}`,
    );
  }

  console.log(`\n### tagged = ${tagged.length}`);
  for (const item of tagged) {
    const sitesFor = claims.get(item.id);
    const first = `${sitesFor[0].file}:${sitesFor[0].line}`;
    const more = sitesFor.length > 1 ? `  (+${sitesFor.length - 1} more)` : '';
    console.log(`   ${item.id.padEnd(20)} ${item.verdict.padEnd(6)} ${first}${more}`);
  }

  console.log(`\n### waived = ${waived.size}  (held out of the denominator, NOT closed)`);
  for (const w of waived.values()) {
    console.log(`   ${w.id.padEnd(20)} ${w.kind.padEnd(16)} ${w.reason}`);
    console.log(`   ${''.padEnd(20)} ${''.padEnd(16)} source: ${w.source}`);
  }

  if (slashAbbreviations.length) {
    console.log(
      `\n### slash abbreviations = ${slashAbbreviations.length}  (§7.3 forbids them: the second ID is lost)`,
    );
    for (const s of slashAbbreviations) {
      console.log(`   ${s.file}:${s.line}  ${s.abbreviation}  in  ${s.title.slice(0, 70)}`);
    }
  }

  console.log(
    `\n### unscannable call sites = ${unscannable.length}  (title not on the opening line; ` +
      `${lostClaims.length} near a catalogue ID)`,
  );
  for (const u of lostClaims)
    console.log(`   ${u.file}:${u.line}  ${u.text}   -> ${u.nearby.join(' ')}`);

  if (errors.length) {
    console.log(`\n### ERRORS = ${errors.length}`);
    errors.forEach((e) => console.log(`   ${e}`));
  }

  console.log(
    '\nWHAT THIS DOES NOT BUY (CONVENTIONS §7.7): a tag records that someone CLAIMED\n' +
      'a block goes red if the requirement regresses. It does not check the claim. The\n' +
      "audit's own lesson is `FR-MOD-07.4` — green test, wrong criterion, and a fixture\n" +
      'too blind to notice; a tag on it would have been green here too. An untagged\n' +
      'item above is UNTAGGED, not untested — §7.5 adopts the rule going forward and\n' +
      'does not backfill. Reading either number as a quality score is the same mistake\n' +
      'the rule exists to stop.',
  );

  return errors.length ? 1 : 0;
}

module.exports = {
  analyse,
  toJson,
  main,
  parseCatalogue,
  blankBlockComments,
  readTitle,
  idsInTitle,
  CATALOG_FILE,
  EXPECTED_ROWS,
  WAIVERS,
  TAG_ALIASES,
};

if (require.main === module) process.exitCode = main(process.argv.slice(2));
