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
import type { Locator, Page, TestInfo } from '@playwright/test';
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

/*
 * ---------------------------------------------------------------------------
 * The states axe structurally cannot reach: `:focus-visible` and `:hover`
 * ---------------------------------------------------------------------------
 *
 * Everything above measures the DOM as it stands. That is the whole of what axe
 * can do, and it leaves a hole the size of every interaction state: the focus
 * ring and the hover colours are only in the computed style while the control is
 * actually focused or actually under the pointer, and nothing in the suite had
 * ever put a control into either. Measured before this module existed:
 * `focus`/`hover` matched **zero** times across `a11y.spec.ts` and `a11y.ts`,
 * and `tokens.test.ts`'s 90 assertions held no `--focus-ring` pair.
 *
 * That is not a theoretical gap. tm 120 measured what this class of blind spot
 * hides: a `1.47:1` serious violation on a tab no scan ever opened, missed by
 * all sixteen clean runs before it. The rule it wrote down — *a scan is evidence
 * only for the states it actually renders* — is exactly what `:focus-visible`
 * and `:hover` fail.
 *
 * `:hover` needs no new machinery, because axe reads `getComputedStyle` and the
 * pseudo-class is live while Playwright's mouse rests on the element: hover
 * first, scan second, and `color-contrast` grades the hovered pair. The focus
 * ring does need it. axe ships **no** rule for focus-indicator contrast — the
 * ring is not text, so `color-contrast` never looks at it — so a scan of a
 * focused control returns clean no matter how invisible its ring is. The
 * measurement below is therefore ours, and it is the reason the gate can fail on
 * a broken ring at all.
 */

/**
 * WCAG 2.1 §1.4.11 Non-text Contrast — 3:1, not the 4.5:1 the text rules use.
 *
 * A focus indicator is a non-text boundary, so it is graded against a lower
 * threshold than the ink beside it. Getting this wrong in either direction is a
 * defect of its own: 4.5:1 would fail rings that conform, and 3:1 applied to
 * text would pass ink that does not.
 */
export const NON_TEXT_CONTRAST_MIN = 3;

/** One control's focus indicator, as the browser actually painted it. */
export interface FocusRing {
  screen: string;
  /** Which control, in words — this ends up in the failure message. */
  target: string;
  /**
   * Did the element really match `:focus-visible` when this was read?
   *
   * Load-bearing rather than diagnostic. Chromium only paints the ring when it
   * believes the user is on the keyboard, so a measurement taken after a mouse
   * click would read `outline-style: none` and a ratio of 1 — indistinguishable
   * from the defect this exists to find.
   */
  focusVisible: boolean;
  /** `#rrggbb` of the outline, composited onto the backdrop if it carried alpha. */
  ring: string;
  /** `#rrggbb` actually painted where the ring lands. */
  backdrop: string;
  /** Outline width in CSS px. A 0px ring is invisible whatever its colour. */
  width: number;
  /** `outline-style` — `none` is the classic "the designer removed it" defect. */
  style: string;
  /** `outline-offset` in CSS px. Decides *what* the ring is drawn on; see below. */
  offset: number;
  ratio: number;
}

const srgbChannel = (byte: number): number => {
  const srgb = byte / 255;
  return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
};

const relativeLuminance = (hex: string): number => {
  const packed = Number.parseInt(hex.slice(1), 16);
  return (
    0.2126 * srgbChannel((packed >> 16) & 0xff) +
    0.7152 * srgbChannel((packed >> 8) & 0xff) +
    0.0722 * srgbChannel(packed & 0xff)
  );
};

/**
 * WCAG 2.x contrast for two opaque `#rrggbb` colours.
 *
 * Deliberately a second implementation of the one in
 * `apps/web/src/styles/tokens.test.ts`: these are different packages with no
 * dependency between them, and the point of a cross-check is lost if both sides
 * read the same code. The two agree to a rounding step, and both agree with the
 * ratios axe reports — that agreement is what makes either of them evidence.
 */
export function contrastRatio(a: string, b: string): number {
  const [lighter, darker] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (lighter! + 0.05) / (darker! + 0.05);
}

/**
 * Read the focus indicator the browser is painting on `locator` right now.
 *
 * The subtle half is *what the ring is drawn on*. `tokens.css` gives
 * `:focus-visible` an `outline-offset: 2px`, which puts the ring outside the
 * border box — so the colour beside it is whatever the **ancestors** paint
 * there, not the control's own fill. That distinction decides the answer: the
 * inbox composer's selected "Reply" tab is a solid `bg-brand-500`, and a ring
 * measured against that fill would read 1.00:1 while the ring a user actually
 * sees is drawn on the surface behind the tab and clears 1.4.11 comfortably. So
 * the backdrop is resolved by walking outwards and compositing every translucent
 * layer on the way, and only a zero-or-negative offset makes the control's own
 * background the neighbour.
 */
export async function measureFocusRing(
  screen: string,
  target: string,
  locator: Locator,
): Promise<FocusRing> {
  const painted = await locator.evaluate((element) => {
    type Rgba = [number, number, number, number];

    /** `rgb(…)`/`rgba(…)` → channels. Anything else (`transparent`, `none`) is see-through. */
    const parse = (value: string): Rgba => {
      const parts = value.match(/[\d.]+/g);
      if (!parts || parts.length < 3) return [0, 0, 0, 0];
      return [
        Number(parts[0]),
        Number(parts[1]),
        Number(parts[2]),
        parts[3] === undefined ? 1 : Number(parts[3]),
      ];
    };

    /** Source-over: `top` painted onto an already opaque `bottom`. */
    const over = (top: Rgba, bottom: Rgba): Rgba => [
      top[0] * top[3] + bottom[0] * (1 - top[3]),
      top[1] * top[3] + bottom[1] * (1 - top[3]),
      top[2] * top[3] + bottom[2] * (1 - top[3]),
      1,
    ];

    const hex = (colour: Rgba): string =>
      `#${[colour[0], colour[1], colour[2]]
        .map((value) => Math.round(value).toString(16).padStart(2, '0'))
        .join('')}`;

    const style = getComputedStyle(element);
    const offset = Number.parseFloat(style.outlineOffset) || 0;

    // Every painted layer from where the ring lands outwards, stopping at the
    // first opaque one — translucent fills (`bg-brand-500/10`, `bg-white/5`) are
    // real backdrops and have to be composited, not skipped.
    const stack: Rgba[] = [];
    for (
      let node: Element | null = offset > 0 ? element.parentElement : element;
      node;
      node = node.parentElement
    ) {
      const layer = parse(getComputedStyle(node).backgroundColor);
      if (layer[3] === 0) continue;
      stack.push(layer);
      if (layer[3] === 1) break;
    }
    // Whatever the document leaves unpainted, the viewport paints white.
    stack.push([255, 255, 255, 1]);

    let backdrop = stack[stack.length - 1]!;
    for (let index = stack.length - 2; index >= 0; index -= 1) {
      backdrop = over(stack[index]!, backdrop);
    }

    return {
      focusVisible: element.matches(':focus-visible'),
      ring: hex(over(parse(style.outlineColor), backdrop)),
      backdrop: hex(backdrop),
      width: Number.parseFloat(style.outlineWidth) || 0,
      style: style.outlineStyle,
      offset,
    };
  });

  return {
    screen,
    target,
    ...painted,
    ratio: contrastRatio(painted.ring, painted.backdrop),
  };
}

/** One measurement as a run-log line, in the shape `summariseScan` uses. */
export function describeFocusRing(ring: FocusRing): string {
  return (
    `focus ${ring.screen} — ${ring.target}: ${ring.ring} on ${ring.backdrop} = ` +
    `${ring.ratio.toFixed(2)}:1 (1.4.11 wants ${NON_TEXT_CONTRAST_MIN}:1) · ` +
    `${ring.style} ${ring.width}px @ ${ring.offset}px · :focus-visible ${ring.focusVisible}`
  );
}

/**
 * The focus half of the gate. Throws, for the same reasons
 * `assertNoBlockingViolations` does.
 *
 * Three ways a focus indicator fails, and they are not the same failure: the
 * state never rendered (so nothing was measured), the ring is not drawn at all,
 * or it is drawn in a colour that cannot be told from what is behind it. Each
 * gets its own message, because "focus ring failed" sends the next window back
 * to the browser and these do not.
 */
export function assertFocusRingVisible(ring: FocusRing): void {
  if (!ring.focusVisible) {
    throw new Error(
      `${ring.screen} — ${ring.target} never matched \`:focus-visible\`, so its focus ` +
        `indicator was not measured at all. A ring can only be evidence for a state ` +
        `that rendered.\n  ${describeFocusRing(ring)}`,
    );
  }
  if (ring.style === 'none' || ring.width <= 0) {
    throw new Error(
      `${ring.screen} — ${ring.target} draws no focus indicator while focused ` +
        `(outline-style: ${ring.style}, outline-width: ${ring.width}px).\n  ${describeFocusRing(ring)}`,
    );
  }
  if (ring.ratio < NON_TEXT_CONTRAST_MIN) {
    throw new Error(
      `${ring.screen} — ${ring.target} has a focus indicator that cannot be seen: ` +
        `${ring.ratio.toFixed(2)}:1 against what is painted behind it, and WCAG 2.1 ` +
        `1.4.11 wants ${NON_TEXT_CONTRAST_MIN}:1.\n  ${describeFocusRing(ring)}`,
    );
  }
}
