/**
 * Colour tokens meet WCAG 2.1 AA contrast (NFR-A11Y1, tm 115).
 *
 * The e2e axe scan (`apps/e2e/tests/a11y.spec.ts`) is the real gate — it reads
 * the colours the browser actually computed, which is the only fully honest
 * measurement. But it costs a browser and four servers, so a token nudged in the
 * wrong direction stays invisible for the whole ten minutes it takes to find
 * out. This test closes that window: it reads `tokens.css` itself and re-derives
 * the ratios in milliseconds.
 *
 * It checks the *token* pairs, not the rendered page — those are different
 * claims, and this one is strictly weaker. A component that puts tertiary text
 * on a brand fill would pass here and fail axe, correctly. What this catches is
 * the failure axe caught in the first place: a palette that cannot satisfy AA no
 * matter which component uses it.
 *
 * Ratios follow WCAG 2.x relative luminance (sRGB, the 0.04045 knee), which is
 * the formula axe implements — the numbers here match its reported values to
 * within a rounding step.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The stylesheet the app ships, read as text.
 *
 * Read from disk rather than imported: the vitest config sets `css: false`, so a
 * `?raw` import comes back stubbed, and `import.meta.url` is a bundler URL here
 * rather than a `file:` one. `process.cwd()` is the vitest root — `apps/web` —
 * for every way this suite is started (`pnpm test`, turbo, or vitest directly).
 */
const TOKENS_CSS = readFileSync(join(process.cwd(), 'src/styles/tokens.css'), 'utf8');

/** WCAG 2.1 AA for body text. Large text is 3:1, but none of these pairs are large-only. */
const AA_NORMAL_TEXT = 4.5;

/**
 * WCAG 2.1 §1.4.11 Non-text Contrast — the threshold for things that are not
 * ink: focus indicators, state boundaries, meaningful graphics.
 *
 * A separate constant rather than a looser reading of the one above, because
 * confusing the two fails in both directions: 4.5:1 would reject focus rings
 * that conform, and 3:1 applied to text would pass ink that does not.
 */
const AA_NON_TEXT = 3;

type Theme = Record<string, string>;

/** The `--name: value;` declarations of the first block after `selector`. */
function readBlock(selector: string): Theme {
  const start = TOKENS_CSS.indexOf(selector);
  expect(start, `selector ${selector} not found in tokens.css`).toBeGreaterThan(-1);
  const open = TOKENS_CSS.indexOf('{', start);
  const close = TOKENS_CSS.indexOf('}', open);
  const body = TOKENS_CSS.slice(open, close);
  return Object.fromEntries(
    [...body.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((match) => [match[1]!, match[2]!.trim()]),
  );
}

/** Dark inherits every token it does not override — same as the cascade does. */
const LIGHT: Theme = readBlock(':root');
const DARK: Theme = { ...LIGHT, ...readBlock("[data-theme='dark']") };

/** Follow `var(--x)` indirection (`--bubble-agent-bg`) down to a literal hex. */
function resolve(theme: Theme, name: string): string {
  let value = theme[name];
  for (let hops = 0; value?.startsWith('var(') && hops < 8; hops += 1) {
    value = theme[value.slice(4, -1)];
  }
  expect(value, `${name} does not resolve to a colour`).toMatch(/^#[0-9a-f]{6}$/i);
  return value!;
}

const channel = (byte: number): number => {
  const srgb = byte / 255;
  return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
};

function relativeLuminance(hex: string): number {
  const packed = Number.parseInt(hex.slice(1), 16);
  return (
    0.2126 * channel((packed >> 16) & 0xff) +
    0.7152 * channel((packed >> 8) & 0xff) +
    0.0722 * channel(packed & 0xff)
  );
}

export function contrastRatio(a: string, b: string): number {
  const [lighter, darker] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (lighter! + 0.05) / (darker! + 0.05);
}

/** A foreground token, the background tokens it is drawn on, and why that pairing exists. */
interface Pairing {
  foreground: string;
  backgrounds: readonly string[];
  because: string;
}

/** Every surface a page can put text on. */
const SURFACES = ['--bg-canvas', '--bg-surface', '--bg-surface-2', '--bg-inset'] as const;

const PAIRINGS: readonly Pairing[] = [
  {
    foreground: '--text-primary',
    backgrounds: SURFACES,
    because: 'body copy, everywhere',
  },
  {
    foreground: '--text-secondary',
    backgrounds: SURFACES,
    because: 'labels, metadata, table sub-rows',
  },
  {
    foreground: '--text-tertiary',
    backgrounds: SURFACES,
    because: 'timestamps and hints — the faintest text the UI ships',
  },
  {
    foreground: '--brand-text',
    backgrounds: ['--bg-canvas', '--bg-surface', '--bg-surface-2'],
    because: 'accent links (`text-content-brand`)',
  },
  /**
   * Status colours are text before they are anything else — `text-warning` on a
   * queue badge, `text-success` on a KPI, `text-danger` on a validation message
   * — and they land on all four surfaces, badges being inset by convention.
   *
   * Added by tm 117, and not speculatively: the first axe scan of the light
   * theme (unreachable until that task shipped a theme switcher) failed on
   * `bg-inset` + `text-warning` at 4.06:1, and re-deriving the whole family here
   * turned up `--success` at 3.92 and `--note` at 3.26 on the same surface. One
   * screen happened to render one of the three; this catches all six in 4ms.
   */
  ...(['--success', '--warning', '--danger', '--info', '--ai', '--note'] as const).map(
    (foreground) => ({
      foreground,
      backgrounds: SURFACES,
      because: 'status text — badges, KPIs, validation messages',
    }),
  ),
  /**
   * `--note` as a *fill*, which is the opposite problem from `--note` as text.
   *
   * Its one fill site is the selected "Internal note" tab (`bg-note`,
   * `Composer.tsx`), and the token inverts across the themes — a dark olive on
   * light, a pale amber on dark — so the ink laid on it has to invert too.
   * Literal white satisfied only the light half: on dark it was 1.47:1, and no
   * scan had ever seen it because axe never opened that tab (tm 120).
   */
  {
    foreground: '--text-inverse',
    backgrounds: ['--note'],
    because: 'the selected "Internal note" tab — there `--note` is a fill, not text',
  },
  {
    foreground: '--bubble-agent-text',
    backgrounds: ['--bubble-agent-bg'],
    because: 'the agent side of every transcript',
  },
  {
    foreground: '--bubble-customer-text',
    backgrounds: ['--bubble-customer-bg'],
    because: 'the customer side of every transcript',
  },
];

/**
 * Solid brand fills that carry literal `text-white` — 95 `bg-brand-500` and 61
 * `hover:bg-brand-600` call sites write the colour rather than a token, so the
 * pair to check is white, not `--text-inverse` (which is near-black on dark).
 */
const WHITE_ON_FILL = ['--brand-500', '--brand-600'] as const;

/**
 * Everything the focus ring can be painted on (tm 123).
 *
 * Wider than `SURFACES`, and the two extras are the point. `--bg-rail` is the
 * one surface that does not follow the theme — near-black in both — so a ring
 * tuned against a light panel still has to clear it there; the rail carries the
 * app's primary navigation, so every keyboard session starts on it.
 * `--bubble-note-bg` is the composer's own background once an agent switches to
 * an internal note, which is where the note tab and the message box are focused.
 *
 * Why the *surface* and not the control's own fill: `tokens.css` gives
 * `:focus-visible` a positive `outline-offset`, so the ring is drawn outside the
 * border box and the colour beside it belongs to whatever is behind the control.
 * That is load-bearing — the composer's selected "Reply" tab is a solid
 * `--brand-500`, and the ring on `--brand-500` would be 1.00:1 on light. The
 * offset is asserted below so this reasoning cannot quietly stop being true.
 */
const RING_BACKDROPS = [...SURFACES, '--bg-rail', '--bubble-note-bg'] as const;

describe.each([
  ['light', LIGHT],
  ['dark', DARK],
])('%s theme colour tokens', (_themeName, theme) => {
  for (const { foreground, backgrounds, because } of PAIRINGS) {
    for (const background of backgrounds) {
      it(`${foreground} on ${background} meets AA — ${because}`, () => {
        const ratio = contrastRatio(resolve(theme, foreground), resolve(theme, background));
        expect(
          ratio,
          `${resolve(theme, foreground)} on ${resolve(theme, background)}`,
        ).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
      });
    }
  }

  for (const fill of WHITE_ON_FILL) {
    it(`white text on ${fill} meets AA`, () => {
      const ratio = contrastRatio('#ffffff', resolve(theme, fill));
      expect(ratio, `#ffffff on ${resolve(theme, fill)}`).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
    });
  }

  /**
   * The focus ring, against every surface it lands on.
   *
   * Added by tm 123 to close a hole that was total rather than partial: before
   * it, `--focus-ring` appeared in **no** assertion here and `focus` appeared in
   * **no** line of the e2e a11y suite, so the one indicator a keyboard user
   * depends on for the whole session had never been measured at any level. axe
   * cannot supply this — it ships no focus-indicator rule, because the ring is
   * not text — so this and the browser-side measurement in
   * `apps/e2e/tests/a11y.ts` are the only two places it is checked.
   */
  for (const backdrop of RING_BACKDROPS) {
    it(`--focus-ring on ${backdrop} meets 1.4.11 — the ring is drawn on the surface behind the control`, () => {
      const ratio = contrastRatio(resolve(theme, '--focus-ring'), resolve(theme, backdrop));
      expect(
        ratio,
        `${resolve(theme, '--focus-ring')} on ${resolve(theme, backdrop)}`,
      ).toBeGreaterThanOrEqual(AA_NON_TEXT);
    });
  }
});

/**
 * The `:focus-visible` rule itself, not just the colours it reaches for.
 *
 * Every ratio above is conditional on the ring being drawn *outside* the
 * control. Drop the offset to zero and the ring lands on the control's own fill
 * instead — on the composer's selected "Reply" tab that is `--brand-500`, which
 * the ring follows exactly on the light theme, so the indicator would measure
 * 1.00:1 and vanish. A width of zero or a style of `none` is the same failure by
 * a shorter route. None of that is visible to a contrast check, so it is
 * asserted here as the premise it is.
 */
describe('the :focus-visible rule', () => {
  // The selector as well as the body: which one wins the cascade is as much a
  // part of this rule's correctness as what it declares (see below).
  const MATCH = /(?:^|\n)([^\n{}]*:focus-visible[^\n{}]*)\{([^}]*)\}/.exec(TOKENS_CSS);
  const SELECTOR = MATCH?.[1]?.trim() ?? '';
  const RULE = MATCH?.[2] ?? '';

  const declaration = (property: string): string =>
    new RegExp(`(?:^|;)\\s*${property}:\\s*([^;]+)`).exec(RULE)?.[1]?.trim() ?? '';

  it('draws a solid ring at least 2px wide', () => {
    expect(RULE, ':focus-visible has no rule in tokens.css at all').not.toBe('');
    const outline = declaration('outline');
    expect(outline).toMatch(/solid/);
    expect(Number.parseFloat(outline)).toBeGreaterThanOrEqual(2);
  });

  /**
   * The cascade, which is where this rule was actually broken (tm 123).
   *
   * A bare `:focus-visible` weighs one class, which *ties* with Tailwind's
   * `.outline-none` — and `index.css` imports this file before
   * `@tailwind utilities`, so on a tie the utility won. `.outline-none` is
   * `outline: 2px solid transparent`, so all 79 controls carrying it focused
   * with a ring painted in nothing: measured at 1.00:1 in both themes, with no
   * fallback to the browser's own indicator either. Nothing above catches that
   * — every ratio here would still be perfect — so the selector is asserted
   * directly.
   */
  it('outranks a single utility class, or `outline-none` quietly wins the tie', () => {
    const beyondTheState = SELECTOR.replace(':focus-visible', '').match(/[.#[]|:[a-z-]+/gi) ?? [];
    expect(
      beyondTheState.length,
      `\`${SELECTOR}\` weighs no more than one class, so any \`outline-none\` on a control ` +
        `overrides it on source order`,
    ).toBeGreaterThan(0);
  });

  it('offsets the ring outwards, which is what puts it on the surface and not on the fill', () => {
    expect(Number.parseFloat(declaration('outline-offset'))).toBeGreaterThan(0);
  });

  it('would be invisible on the one fill it sits closest to, without that offset', () => {
    // Not a requirement — a measurement, kept next to the requirement it
    // justifies. `--focus-ring` *is* `--brand-500` on light by definition, so a
    // ring drawn on a brand-filled control would carry no boundary at all.
    expect(
      contrastRatio(resolve(LIGHT, '--focus-ring'), resolve(LIGHT, '--brand-500')),
    ).toBeCloseTo(1, 2);
  });
});

/**
 * Hover fills, which are states no static scan renders.
 *
 * The reply-suggestion chips are the only place the app swaps in a brand tint on
 * hover (`hover:bg-brand-100 dark:hover:bg-brand-950`, `Composer.tsx`), and the
 * ink stays `--text-primary` across the swap. Split per theme rather than run
 * through the `describe.each` above because only one of the two pairs is ever
 * rendered: `--brand-100` is the light-theme hover and `--brand-950` the dark
 * one, so asserting both in both themes would be measuring two combinations that
 * do not exist.
 */
describe('hovered fills keep their ink readable', () => {
  it('light: --text-primary on --brand-100 — a hovered reply suggestion', () => {
    expect(
      contrastRatio(resolve(LIGHT, '--text-primary'), resolve(LIGHT, '--brand-100')),
    ).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
  });

  it('dark: --text-primary on --brand-950 — the same chip, dark half', () => {
    expect(
      contrastRatio(resolve(DARK, '--text-primary'), resolve(DARK, '--brand-950')),
    ).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
  });
});

describe('contrastRatio', () => {
  it('agrees with the reference values WCAG documents', () => {
    // Black on white is the maximum the formula can produce.
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
    // Symmetric — the brighter colour is always the numerator.
    expect(contrastRatio('#767676', '#ffffff')).toBeCloseTo(
      contrastRatio('#ffffff', '#767676'),
      10,
    );
    // #767676 on white is the canonical "exactly AA" grey.
    expect(contrastRatio('#767676', '#ffffff')).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio('#777777', '#ffffff')).toBeLessThan(4.5);
  });

  it('reproduces the two ratios axe measured before the tm 115 fix', () => {
    // Old --brand-500 under white: axe said 4.49, i.e. under AA by a rounding step.
    expect(contrastRatio('#ffffff', '#2f6bff')).toBeCloseTo(4.5, 1);
    // Old dark --brand-600 as text on --bg-surface: axe said 2.74.
    expect(contrastRatio('#1f52d8', '#121829')).toBeCloseTo(2.74, 1);
  });
});
