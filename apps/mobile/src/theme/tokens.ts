/**
 * The RN counterpart of `apps/web/src/styles/tokens.css` (design-brief.md §2–§5).
 *
 * Hand-written, not generated: RN has no CSS custom properties to cascade
 * through, so there is no single file both platforms can share. Colour and
 * radius exist in `tokens.css` as literal values, though, so `tokens.test.ts`
 * parses that file and asserts every value below still matches it — the two
 * cannot silently drift on the numbers that *do* have one shared source.
 * Typography and spacing have no CSS-variable form (design-brief.md §3/§4 and
 * `apps/web/tailwind.config.ts` are prose/JS, not something safe to regex-parse
 * at the same fidelity), so those two are kept in step by hand.
 */

export type ThemeName = 'light' | 'dark';

/** Every colour the app draws with, camelCased from its `--kebab-case` token. */
export interface ColorTokens {
  bgCanvas: string;
  bgSurface: string;
  bgSurface2: string;
  bgRail: string;
  bgInset: string;
  border: string;
  borderStrong: string;
  textPrimary: string;
  textSecondary: string;
  textTertiary: string;
  textInverse: string;
  brand100: string;
  brand500: string;
  brand600: string;
  brand700: string;
  brand950: string;
  brandText: string;
  focusRing: string;
  success: string;
  warning: string;
  danger: string;
  info: string;
  ai: string;
  note: string;
  bubbleAgentBg: string;
  bubbleAgentText: string;
  bubbleCustomerBg: string;
  bubbleCustomerText: string;
  bubbleNoteBg: string;
  bubbleAiBg: string;
}

const LIGHT: ColorTokens = {
  bgCanvas: '#f7f8fa',
  bgSurface: '#ffffff',
  bgSurface2: '#f1f3f7',
  bgRail: '#111726',
  bgInset: '#e9ecf2',
  border: '#dde1e9',
  borderStrong: '#c3c9d6',

  textPrimary: '#111726',
  textSecondary: '#4a5468',
  textTertiary: '#606878',
  textInverse: '#ffffff',

  brand100: '#e4ecff',
  brand500: '#2d67fa',
  brand600: '#1f52d8',
  brand700: '#1740ac',
  brand950: '#0f1e42',
  brandText: '#1f52d8',
  focusRing: '#2d67fa', // var(--brand-500)

  success: '#10744f',
  warning: '#945800',
  danger: '#c42a2a',
  info: '#0b6e99',
  ai: '#7c3aed',
  note: '#806413',

  bubbleAgentBg: '#2d67fa', // var(--brand-500)
  bubbleAgentText: '#ffffff',
  bubbleCustomerBg: '#eff1f5',
  bubbleCustomerText: '#111726', // var(--text-primary)
  bubbleNoteBg: '#fff6e5',
  bubbleAiBg: '#f3edff',
};

/** Dark inherits every token it does not override — same as `[data-theme='dark']` does in CSS. */
const DARK: ColorTokens = {
  ...LIGHT,
  bgCanvas: '#0b1020',
  bgSurface: '#121829',
  bgSurface2: '#1a2136',
  bgRail: '#080c18',
  bgInset: '#0e1424',
  border: '#232c44',
  borderStrong: '#313c58',

  textPrimary: '#edf0f6',
  textSecondary: '#a6b0c4',
  textTertiary: '#868fa6',
  textInverse: '#0b1020',

  brandText: '#7aa2ff',
  focusRing: '#7aa2ff',

  success: '#3dd68c',
  warning: '#f5b14c',
  danger: '#ff6b6b',
  info: '#4fc3f7',
  ai: '#b392f7',
  note: '#ffce73',

  bubbleCustomerBg: '#1e2740',
  bubbleCustomerText: '#edf0f6', // var(--text-primary), which dark overrides above
  bubbleNoteBg: '#2e2210',
  bubbleAiBg: '#241a3d',
};

export const COLORS: Record<ThemeName, ColorTokens> = { light: LIGHT, dark: DARK };

/** `--radius-sm/md/lg` from `tokens.css`, as RN's unitless px numbers. */
export const RADIUS = {
  sm: 4,
  md: 8,
  lg: 12,
} as const;

/**
 * design-brief.md §3 — size/line-height in px (tokens.css sets the root at the
 * browser default of 16px/rem, so `rem * 16` is exact) and the weight each step
 * carries. `apps/web/tailwind.config.ts`'s `fontSize` scale is the same numbers
 * in rem; this is that table, not a re-derivation of it.
 */
export const FONT_SIZE = {
  '2xs': { size: 11, lineHeight: 16, weight: '500' },
  xs: { size: 12, lineHeight: 18, weight: '500' },
  sm: { size: 13, lineHeight: 20, weight: '400' },
  base: { size: 15, lineHeight: 24, weight: '400' },
  lg: { size: 17, lineHeight: 26, weight: '600' },
  xl: { size: 20, lineHeight: 28, weight: '600' },
  '2xl': { size: 26, lineHeight: 34, weight: '700' },
  '3xl': { size: 34, lineHeight: 42, weight: '700' },
} as const;

/**
 * `Inter var` never actually loads on the web either — `tokens.css` names it
 * first in the stack but ships no `@font-face`, so every browser has always
 * fallen through to the system font that follows it. Bundling `Inter var` here
 * would make the two platforms diverge from what the web app *actually*
 * renders, not converge on it — so RN takes the same fallback directly via
 * `undefined`, which is `Text`'s own signal to use the platform default
 * (San Francisco on iOS, Roboto on Android).
 */
export const FONT_FAMILY = {
  sans: undefined,
  mono: undefined,
} as const;

/** design-brief.md §4 — the 4px-based scale, unitless px for RN's `StyleSheet`. */
export const SPACING = {
  0: 0,
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  8: 32,
  10: 40,
  12: 48,
  16: 64,
} as const;
