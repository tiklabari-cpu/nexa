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
