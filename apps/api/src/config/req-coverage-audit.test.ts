/**
 * Pins `scripts/audit/req-coverage.cjs` — the report that answers "which PRD
 * acceptance criterion has nobody claimed a test for" (tm 184.2, CONVENTIONS §7).
 *
 * Why here, in a package that has nothing to do with it: the script is a
 * repo-root tool, no workspace package owns it, and the root has no test runner.
 * This directory is already where repo-level artefacts get pinned for exactly
 * that reason — `migrate-on-start.test.ts` checks a Helm chart, `env.parity`
 * checks `.env.example` against `turbo.json`, `nginx-security.test.ts` does the
 * same from `apps/web`. Placement also has to satisfy CONVENTIONS §1.3: the
 * gate is run in shards (`test:unit` is `--dir src`, `test:integration` is
 * `--dir test/integration`), so a file outside both would be skipped by every
 * split run and only ever execute in the 15-minute whole-suite command.
 *
 * The script is a scanner over 472 test files and a 247-row markdown table, and
 * a scanner's characteristic failure is not a crash — it is a confident, wrong
 * number. Two of those are pinned here:
 *
 *   1. The catalogue parser sees the WHOLE table. If a markdown edit breaks the
 *      row shape and the parser silently reads twelve rows, the report says
 *      coverage is excellent. The script's own tripwire (EXPECTED_ROWS) throws
 *      on that; this checks the tripwire is set to what the document actually
 *      contains, rather than to a number that has drifted past it.
 *   2. Every tag in the repo names a real catalogue item. A typo'd tag is worse
 *      than a missing one: it reads as a covered requirement while protecting
 *      nothing. The script reports it and exits 1; this makes the test suite
 *      catch it too, before CI does (that step is tm 184.3's).
 *
 * The extractor itself is exercised directly, because it is the one piece with
 * real parsing in it and the one that silently under-reports when wrong.
 */
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// src/config → apps/api → apps → repo root (same resolution as load-env-file.ts)
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const SCRIPT = resolve(REPO_ROOT, 'scripts/audit/req-coverage.cjs');

interface Site {
  file: string;
  line: number;
  title: string;
  ids: string[];
}
interface Analysis {
  rows: { id: string }[];
  items: Map<string, { id: string; verdict: string }>;
  files: string[];
  errors: string[];
  waived: Map<string, { id: string; kind: string; reason: string; source: string }>;
  inScope: { id: string }[];
  tagged: { id: string }[];
  untagged: { id: string }[];
  unknownTags: Site[];
  lostClaims: { file: string; line: number }[];
}
interface Module {
  analyse: () => Analysis;
  toJson: (analysis: Analysis) => Record<string, unknown>;
  blankBlockComments: (source: string) => string;
  readTitle: (line: string, openIndex: number, parameterised: boolean) => string | null;
  idsInTitle: (title: string, slashed: string[]) => string[];
  EXPECTED_ROWS: number;
  WAIVERS: { id: string; kind: string; reason: string; source: string }[];
}

// The script is CommonJS and reads paths relative to the repo root, so it is
// required rather than imported and the cwd is pinned around the call.
const load = (): Module => createRequire(import.meta.url)(SCRIPT) as Module;
const withRepoRoot = <T>(run: () => T): T => {
  const previous = process.cwd();
  process.chdir(REPO_ROOT);
  try {
    return run();
  } finally {
    process.chdir(previous);
  }
};

describe('requirement coverage report (CONVENTIONS §7)', () => {
  it('reads the whole catalogue, and its row tripwire matches the document', () => {
    const audit = load();
    const analysis = withRepoRoot(() => audit.analyse());

    expect(analysis.rows.length).toBe(audit.EXPECTED_ROWS);
    // 247 rows, 246 items: `NFR-C8` is listed under two sections. The gap is
    // asserted rather than tolerated so that a THIRD duplicate cannot appear
    // unnoticed and quietly shrink the denominator.
    expect(analysis.items.size).toBe(analysis.rows.length - 1);
    expect(analysis.files.length).toBeGreaterThan(400);
  });

  it('reports no integrity error against the repo as it stands', () => {
    const analysis = withRepoRoot(() => load().analyse());

    // Each of these is a way the report lies about itself: a tag naming an ID
    // the catalogue does not have, or a claim sitting on a call site the
    // scanner cannot read. Both would be invisible in the coverage numbers.
    expect(analysis.unknownTags).toEqual([]);
    expect(analysis.lostClaims).toEqual([]);
    expect(analysis.errors).toEqual([]);
  });

  it('keeps waived items out of the denominator but never counts them as covered', () => {
    const audit = load();
    const analysis = withRepoRoot(() => audit.analyse());
    const json = audit.toJson(analysis) as { waived: { id: string }[] };

    expect(analysis.waived.size).toBe(audit.WAIVERS.length);
    for (const waiver of audit.WAIVERS) {
      // A waiver nobody justified is not one — the script errors on an empty
      // reason or source, so the shipped list must never contain one.
      expect(waiver.reason.length, waiver.id).toBeGreaterThan(0);
      expect(waiver.source.length, waiver.id).toBeGreaterThan(0);
      expect(['product-decision', 'non-code']).toContain(waiver.kind);
      expect(analysis.inScope.map((i) => i.id)).not.toContain(waiver.id);
      expect(analysis.tagged.map((i) => i.id)).not.toContain(waiver.id);
      expect(analysis.untagged.map((i) => i.id)).not.toContain(waiver.id);
    }
    // Held out of the counts, still printed: the machine form has to carry them
    // so a reader of the JSON cannot mistake a deferral for a closure.
    expect(json.waived.map((w) => w.id).sort()).toEqual(audit.WAIVERS.map((w) => w.id).sort());
    expect(analysis.inScope.length).toBe(analysis.tagged.length + analysis.untagged.length);
    expect(analysis.inScope.length).toBe(analysis.items.size - analysis.waived.size);
  });

  it('extracts an ID wherever it sits in the parenthesis, not only first', () => {
    const { idsInTitle } = load();
    const slashed: string[] = [];

    expect(idsInTitle('white_label (FR-MOD-11.5)', slashed)).toEqual(['FR-MOD-11.5']);
    // The work-item id rides along as detail (§7.3) and is not an ID.
    expect(idsInTitle('plan entitlements (FR-MOD-10.1.1 · 11.5-b)', slashed)).toEqual([
      'FR-MOD-10.1.1',
    ]);
    // CONVENTIONS §7.6's grep misses both of these: it requires the ID to open
    // the parenthesis. §7.4 imposes no such order, so the script must not.
    expect(idsInTitle('rejects a query over the length cap (400, NFR-S8)', slashed)).toEqual([
      'NFR-S8',
    ]);
    expect(idsInTitle('a gateway that refuses (M-LOAD-CAP · NFR-R2)', slashed)).toEqual(['NFR-R2']);
    // Many-to-many in one parenthesis (§7.4).
    expect(idsInTitle('two at once (FR-MOD-08.9.5 · NFR-C5)', slashed)).toEqual([
      'FR-MOD-08.9.5',
      'NFR-C5',
    ]);
    // A suffix that is not numeric still belongs to the ID — the alternation
    // order fix. Leftmost-first would have yielded `FR-MOD-04.`.
    expect(idsInTitle('role ceiling (FR-MOD-04.RBAC)', slashed)).toEqual(['FR-MOD-04.RBAC']);
    // Not in a parenthesis = not a claim (§7.4).
    expect(idsInTitle('names FR-MOD-13.7 in prose', slashed)).toEqual([]);
    expect(slashed).toEqual([]);
  });

  it('reports the slash abbreviation §7.3 forbids instead of silently losing an ID', () => {
    const { idsInTitle } = load();
    const slashed: string[] = [];

    // No extractor can expand this: `S5` alone is not an ID, so the second
    // claim is gone either way. Reporting it is the only honest option.
    expect(idsInTitle('brand isolation (Multibrand RLS · NFR-S4/S5)', slashed)).toEqual(['NFR-S4']);
    expect(slashed).toEqual(['NFR-S4/S5']);
  });

  it('reads a title out of the call shapes that appear in this repo', () => {
    const { readTitle } = load();
    const open = (source: string): number => source.indexOf('(');
    const read = (source: string, parameterised = false): string | null =>
      readTitle(source, open(source), parameterised);

    expect(read("describe('plain (NFR-C4)', () => {")).toBe('plain (NFR-C4)');
    expect(read('it("double quoted", async () => {')).toBe('double quoted');
    // A template literal is a TITLE unless the call is parameterised — treating
    // it as an `.each` table instead made 100+ real titles unreadable.
    expect(read('it(`refuses ${key} outright`, () => {')).toBe('refuses ${key} outright');
    expect(read("it.each([1, 2])('case %s', (n) => {", true)).toBe('case %s');
    // A table is any argument, not only a `[…]` literal. Recognising just the
    // literal made this real call — channels-adapters.test.ts:301 — unreadable.
    expect(read("describe.each(CASES)('$type adapter', (c) => {", true)).toBe('$type adapter');
    // An apostrophe inside a double-quoted title must not end it.
    expect(read('it("another brand\'s id", () => {')).toBe("another brand's id");
    // A table that does not fit on the line is unreadable here, and the script
    // counts it rather than pretending the block has no title.
    expect(read('it.each([', true)).toBeNull();
  });

  it('blanks a block comment without eating a slash-star inside a title', () => {
    const { blankBlockComments } = load();

    const docblock = blankBlockComments("/**\n * describe('fake (NFR-C4)')\n */\nreal();");
    expect(docblock).not.toContain('describe');
    expect(docblock).toContain('real();');
    // Offsets and line breaks survive, or every reported line number shifts.
    expect(docblock.split('\n').map((l) => l.length)).toEqual([3, 28, 3, 7]);

    // The regex-based version treated the `/*` in this title as a comment
    // opener and blanked source until the next `*` + `/` — it really did erase
    // apps/e2e/tests/a11y.spec.ts:989, and would erase any tag caught with it.
    const withStar = "test('scans every /app/* route', () => {\nkeep();";
    expect(blankBlockComments(withStar)).toBe(withStar);
  });
});
