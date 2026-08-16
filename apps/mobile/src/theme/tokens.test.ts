/**
 * `tokens.ts` is hand-written (see its header comment), so nothing stops a
 * value drifting from `tokens.css` the day someone tunes a colour on the web
 * app and forgets the phone exists. This is the sapma/deviation test that
 * closes that gap for everything `tokens.css` actually declares: it re-parses
 * the stylesheet itself — same technique as `apps/web/src/styles/tokens.test.ts`
 * — and asserts every colour and radius in `tokens.ts` still matches it.
 *
 * Typography and spacing are not checked here because `tokens.css` does not
 * declare them (see the module header); those two are a hand-kept promise, not
 * a machine-checked one.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { COLORS, RADIUS } from './tokens';

/**
 * `apps/mobile` and `apps/web` are sibling workspaces; `process.cwd()` is this
 * package's root for every way the suite is started (`pnpm test`, turbo, or
 * jest directly), so the path up to the shared repo root is fixed.
 */
const TOKENS_CSS = readFileSync(
  join(process.cwd(), '..', 'web', 'src', 'styles', 'tokens.css'),
  'utf8',
);

type CssBlock = Record<string, string>;

/** The `--name: value;` declarations of the first block after `selector`. */
function readBlock(selector: string): CssBlock {
  const start = TOKENS_CSS.indexOf(selector);
  if (start === -1) throw new Error(`selector ${selector} not found in tokens.css`);
  const open = TOKENS_CSS.indexOf('{', start);
  const close = TOKENS_CSS.indexOf('}', open);
  const body = TOKENS_CSS.slice(open, close);
  return Object.fromEntries(
    [...body.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((match) => [match[1]!, match[2]!.trim()]),
  );
}

/** Follow one `var(--x)` indirection down to the literal it names. */
function resolve(block: CssBlock, name: string): string {
  const value = block[name];
  if (value === undefined) throw new Error(`${name} is not declared`);
  if (value.startsWith('var(')) {
    return resolve(block, value.slice(4, -1));
  }
  return value;
}

const CSS_LIGHT = readBlock(':root');
const CSS_DARK: CssBlock = { ...CSS_LIGHT, ...readBlock("[data-theme='dark']") };

/** `tokens.ts`'s camelCase keys, mapped to the `--kebab-case` custom property they mirror. */
const COLOR_TOKEN_CSS_NAME: Record<keyof typeof COLORS.light, string> = {
  bgCanvas: '--bg-canvas',
  bgSurface: '--bg-surface',
  bgSurface2: '--bg-surface-2',
  bgRail: '--bg-rail',
  bgInset: '--bg-inset',
  border: '--border',
  borderStrong: '--border-strong',
  textPrimary: '--text-primary',
  textSecondary: '--text-secondary',
  textTertiary: '--text-tertiary',
  textInverse: '--text-inverse',
  brand100: '--brand-100',
  brand500: '--brand-500',
  brand600: '--brand-600',
  brand700: '--brand-700',
  brand950: '--brand-950',
  brandText: '--brand-text',
  focusRing: '--focus-ring',
  success: '--success',
  warning: '--warning',
  danger: '--danger',
  info: '--info',
  ai: '--ai',
  note: '--note',
  bubbleAgentBg: '--bubble-agent-bg',
  bubbleAgentText: '--bubble-agent-text',
  bubbleCustomerBg: '--bubble-customer-bg',
  bubbleCustomerText: '--bubble-customer-text',
  bubbleNoteBg: '--bubble-note-bg',
  bubbleAiBg: '--bubble-ai-bg',
};

describe.each([
  ['light', CSS_LIGHT, COLORS.light],
  ['dark', CSS_DARK, COLORS.dark],
] as const)('%s theme colour tokens match tokens.css', (_themeName, cssBlock, rnColors) => {
  for (const [tokenKey, cssName] of Object.entries(COLOR_TOKEN_CSS_NAME) as Array<
    [keyof typeof rnColors, string]
  >) {
    it(`${tokenKey} (${cssName})`, () => {
      expect(rnColors[tokenKey].toLowerCase()).toBe(resolve(cssBlock, cssName).toLowerCase());
    });
  }
});

describe('radius tokens match tokens.css', () => {
  const cases: ReadonlyArray<readonly [keyof typeof RADIUS, string]> = [
    ['sm', '--radius-sm'],
    ['md', '--radius-md'],
    ['lg', '--radius-lg'],
  ];

  for (const [tokenKey, cssName] of cases) {
    it(`${tokenKey} (${cssName})`, () => {
      const cssPx = Number.parseFloat(resolve(CSS_LIGHT, cssName));
      expect(RADIUS[tokenKey]).toBe(cssPx);
    });
  }
});
