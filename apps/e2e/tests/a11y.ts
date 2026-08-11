/**
 * WCAG 2.1 AA, measured (NFR-A11Y1–6).
 *
 * PLAN §7.2 has carried a `✅` on the A11Y row since Dilim 14, but everything
 * behind it was a hand walkthrough — keyboard order, ⌘K. The GL-8 closure round
 * (tm 114, §F.1/3) grepped the tree for `axe` / `AxeBuilder` /
 * `toHaveNoViolations` and found **zero** matches, so the AA claim had never
 * been checked by a machine. This module is that check: axe-core, driven through
 * the browser the e2e suite already runs, against the rendered DOM with the real
 * stylesheets applied. Contrast, accessible names and label association are only
 * decidable there — jsdom has no layout and no computed colour, so the web
 * suite structurally cannot answer them.
 *
 * **Why the gate is impact-based rather than all-or-nothing.** axe grades its
 * own findings, and `serious`/`critical` are the two grades that describe a user
 * who cannot finish the task: a control with no accessible name, a field with no
 * label, text under the AA contrast ratio. `moderate`/`minor` — a redundant
 * landmark, a heading level skipped — are counted and reported but do not fail
 * the run. A gate that fails on those is a gate that gets switched off, and an
 * switched-off gate measures nothing, which is the exact state this task exists
 * to end.
 *
 * Exceptions are narrow and named, in the shape `check-drift.ts` uses for its
 * unmodellable statements: a rule id plus the screens it is excused on plus the
 * reason. There is no wildcard and no "all screens" — an excuse that cannot name
 * its screen is a suppression.
 */
import AxeBuilder from '@axe-core/playwright';
import type { Page, TestInfo } from '@playwright/test';
import type { ImpactValue, Result as AxeViolation, SerialFrameSelector } from 'axe-core';

/**
 * WCAG 2.1 level A + AA, and nothing else. axe also ships `best-practice`,
 * `wcag22*` and experimental rulesets; including them would fail the run for
 * things §7.2 never claimed.
 */
export const WCAG_21_AA_TAGS: readonly string[] = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

/** The impact grades that fail the run. Everything else is advisory. */
export const BLOCKING_IMPACTS: readonly ImpactValue[] = ['serious', 'critical'];

export interface A11yException {
  /** An axe rule id, exact — `color-contrast`, never a pattern. */
  rule: string;
  /** Screen names from `a11y.spec.ts`. An exception is never global. */
  screens: readonly string[];
  /** Why this is not a defect, in one sentence. */
  reason: string;
}

/**
 * Rules excused on named screens.
 *
 * Empty is the honest state and the one to keep: the 2026-08-11 baseline run
 * (tm 115) found no `serious`/`critical` violation that needed excusing. An
 * entry here is a debt marker, not a fix.
 */
export const A11Y_EXCEPTIONS: readonly A11yException[] = [];

export interface ScreenScan {
  screen: string;
  /** serious/critical, not excused — these fail the run. */
  blocking: AxeViolation[];
  /** serious/critical matched by an `A11Y_EXCEPTIONS` entry. */
  excused: AxeViolation[];
  /** moderate/minor/ungraded — reported with counts, never fatal. */
  advisory: AxeViolation[];
}

const isBlockingImpact = (impact: ImpactValue | undefined): boolean =>
  BLOCKING_IMPACTS.includes(impact ?? null);

/**
 * Split one screen's violations into the three buckets the gate acts on.
 *
 * Pure on purpose: this is the decision the whole gate turns on, so it is
 * testable without a browser — `a11y.spec.ts` feeds it a hand-built serious
 * violation and asserts it lands in `blocking`.
 */
export function partitionViolations(
  screen: string,
  violations: readonly AxeViolation[],
  exceptions: readonly A11yException[] = A11Y_EXCEPTIONS,
): ScreenScan {
  const excusedHere = new Set(
    exceptions.filter((e) => e.screens.includes(screen)).map((e) => e.rule),
  );

  const scan: ScreenScan = { screen, blocking: [], excused: [], advisory: [] };
  for (const violation of violations) {
    if (!isBlockingImpact(violation.impact)) scan.advisory.push(violation);
    else if (excusedHere.has(violation.id)) scan.excused.push(violation);
    else scan.blocking.push(violation);
  }
  return scan;
}

/**
 * axe's `failureSummary` on one line.
 *
 * It arrives as a small multi-line document ("Fix any of the following:" plus
 * indented bullets), and for `color-contrast` it is the whole measurement — both
 * colours, the ratio found and the ratio AA wants. Flattened here rather than
 * dropped, because that string is the difference between a failure you can fix
 * from the log and one that sends you back to the browser.
 */
const compactSummary = (summary: string | undefined): string =>
  (summary ?? '').split('\n').slice(1).join(' ').replace(/\s+/g, ' ').trim();

/** One violation as a reviewable line: rule, impact, and where it is in the DOM. */
export function describeViolation(violation: AxeViolation): string {
  const where = violation.nodes
    .slice(0, 4)
    .map((node) => {
      const why = compactSummary(node.failureSummary);
      return `      ${node.target.join(' ')}${why ? `\n        ${why}` : ''}`;
    })
    .join('\n');
  const more = violation.nodes.length > 4 ? `\n      …and ${violation.nodes.length - 4} more` : '';
  return `  [${violation.impact ?? 'ungraded'}] ${violation.id} — ${violation.help}\n    ${violation.helpUrl}\n${where}${more}`;
}

/** The message a failing screen prints. Read by a human at 2am, so it is verbose. */
export function describeScan(scan: ScreenScan): string {
  return [
    `${scan.screen}: ${scan.blocking.length} blocking WCAG 2.1 AA violation(s)`,
    ...scan.blocking.map(describeViolation),
  ].join('\n');
}

/** `Inbox  blocking 0 · excused 0 · advisory 2` — the per-screen count for the run log. */
export function summariseScan(scan: ScreenScan): string {
  const nodes = (list: readonly AxeViolation[]): number =>
    list.reduce((total, violation) => total + violation.nodes.length, 0);
  return (
    `axe ${scan.screen}: blocking ${scan.blocking.length} (${nodes(scan.blocking)} nodes) · ` +
    `excused ${scan.excused.length} · advisory ${scan.advisory.length} (${nodes(scan.advisory)} nodes)`
  );
}

export interface ScanOptions {
  /**
   * Restrict the scan, e.g. to one pane or into an iframe. Given straight to
   * `AxeBuilder.include`, so it takes the same selector shapes.
   */
  include?: SerialFrameSelector;
  /** Subtrees to skip, same shape as `include`. */
  exclude?: SerialFrameSelector;
}

/**
 * Run axe over the current page and file the result.
 *
 * The full axe result is attached to the Playwright report — not just the
 * blocking subset — so a later window can see what was advisory at the time
 * without re-running anything.
 */
export async function scanScreen(
  page: Page,
  screen: string,
  testInfo: TestInfo,
  options: ScanOptions = {},
): Promise<ScreenScan> {
  let builder = new AxeBuilder({ page }).withTags([...WCAG_21_AA_TAGS]);
  if (options.include) builder = builder.include(options.include);
  if (options.exclude) builder = builder.exclude(options.exclude);

  const results = await builder.analyze();
  const scan = partitionViolations(screen, results.violations);

  await testInfo.attach(`axe-${screen.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.json`, {
    contentType: 'application/json',
    body: JSON.stringify(
      {
        screen,
        url: results.url,
        counts: {
          blocking: scan.blocking.length,
          excused: scan.excused.length,
          advisory: scan.advisory.length,
        },
        violations: results.violations.map((violation) => ({
          id: violation.id,
          impact: violation.impact,
          help: violation.help,
          nodes: violation.nodes.map((node) => ({
            target: node.target.join(' '),
            // axe renders the measurement into this string — for `color-contrast`
            // it carries the two colours, the ratio it computed and the ratio AA
            // requires, which is what makes the report fixable without re-running.
            why: node.failureSummary,
          })),
        })),
      },
      null,
      2,
    ),
  });

  // The per-screen measurement is the deliverable, not a debug aid — it has to
  // reach the run log so the numbers can be read off a plain `test:e2e`.
  console.log(summariseScan(scan));
  return scan;
}

/**
 * The gate itself. Throws — plainly, with every offending selector in the
 * message — when a screen carries an unexcused `serious`/`critical` violation.
 *
 * A thrown `Error` rather than an `expect`, so the failure is the same whether
 * it is reached from a spec or from `partitionViolations`'s own test, and so
 * this module stays independent of the assertion library.
 */
export function assertNoBlockingViolations(scan: ScreenScan): void {
  if (scan.blocking.length > 0) throw new Error(describeScan(scan));
}
