/**
 * Pins `scripts/audit/sweep.cjs` — the §F.1/1 report that reads every PRD §6
 * `FR-MOD` row's status out of PLAN.md (tm 234).
 *
 * Why here: same reason as `req-coverage-audit.test.ts` beside it — a repo-root
 * tool with no owning package, inside the `test:unit` shard of CONVENTIONS §1.3.
 *
 * The defect: the sweep searched a row's whole text for a glyph, most-open
 * first, so a glyph in a NOTE became the row's status. tm 211 measured it on
 * `13.7` — the §6 row was stamped done, its note named the store half with the
 * out-of-scope glyph, and the moment the v1 row turned done the sweep read the
 * requirement as BLOCKED. tm 211 rewrote the note (§D158); the reader is fixed
 * here, and the first test puts that glyph back to prove it.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// src/config → apps/api → apps → repo root (same resolution as load-env-file.ts)
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const SCRIPT = resolve(REPO_ROOT, 'scripts/audit/sweep.cjs');

type Bucket = 'OPEN' | 'PARTIAL' | 'BLOCKED' | 'LOCKED' | 'DONE' | 'NOROW';
interface Module {
  sweep: (prd: string, plan: string) => { ids: string[]; out: Record<Bucket, string[]> };
  stampsOf: (line: string) => string[];
}

const load = (): Module => createRequire(import.meta.url)(SCRIPT) as Module;
const read = (file: string): string => readFileSync(resolve(REPO_ROOT, file), 'utf8');
const bucketOf = (out: Record<Bucket, string[]>, id: string): Bucket | undefined =>
  (Object.keys(out) as Bucket[]).find((k) =>
    out[k].some((e) => e === id || e.startsWith(`${id} `)),
  );

describe('scope sweep (§F.1/1)', () => {
  it('reads 13.7 as done even with the out-of-scope glyph back in its note, and 13.4 still as blocked', () => {
    const { sweep } = load();
    const prd = read('urun-gereksinim-dokumani-PRD.md');
    const plan = read('PLAN.md');

    // The exact prose tm 211 had to rewrite, glyph restored.
    const note = 'mağaza payı **süreç-sınırı** sınıfında';
    expect(plan).toContain(note);
    const regressed = plan.replace(note, 'mağaza payı ⛔-süreç **süreç-sınırı** sınıfında');

    const { out } = sweep(prd, regressed);
    expect(bucketOf(out, '13.7')).toBe('DONE');
    // The sentinel the other way: a real out-of-scope stamp (ADR-14) is not
    // prose, and must not be read as anything but BLOCKED.
    expect(bucketOf(out, '13.4')).toBe('BLOCKED');
  });

  it('takes the stamp from a status cell or a `→ K` pointer, never from prose', () => {
    const { stampsOf } = load();

    expect(stampsOf('| 07.7 | Reviews | Should | ★ | ✅ → K07.7 |')).toEqual(['✅']);
    expect(stampsOf('| 13.8 | Notifications | Must (MVP) | ✅ | ✅ → K13.8 |')).toEqual([
      '✅',
      '✅',
    ]);
    // Bold survives stripping; a trailing note in the same cell is not a second stamp.
    expect(
      stampsOf('| 13.4 | Workflow builder | Could | | ⛔ **ADR-14: UI yok** ✅ şablon |'),
    ).toEqual(['⛔']);
    // The §6 phase tables put the stamp inside a note.
    expect(stampsOf('| 11.5 | White-label | FR-MOD-11.5 + SLA. **✅ → K11.5** — 8/8 |')).toEqual([
      '✅',
    ]);
    // A glyph in a notes column says something ABOUT the row.
    expect(
      stampsOf('| 02.6 | Actions | Must | ✅ → K02.6 | Reopen ✅ · Create ticket ◐ |'),
    ).toEqual(['✅']);
    expect(stampsOf('| 08.9.6 | IP allowlist | **→ Faz 2.** Teslim: tm 80 ✅ |')).toEqual([]);
  });

  it('keeps the most open stamp when a code has several rows', () => {
    const { sweep } = load();
    const prd = '## 6. Özellikler\n| FR-MOD-01.2 | x |\n| FR-MOD-01.3 | y |\n## 7. NFR\n';
    const plan = [
      '| 01.2 | a | Must | ✅ → K01.2 |',
      '| 01.2 | b | Must | ◐ → K01.2 |',
      '| 01.3 | c | Must | ✅ → K01.3 |',
      '| 01.3 | d | note says ⬜ once |',
    ].join('\n');

    const { out } = sweep(prd, plan);
    expect(out.PARTIAL).toEqual(['01.2 @1,2']);
    expect(out.DONE).toEqual(['01.3']);
    expect(out.OPEN).toEqual([]);
  });
});
