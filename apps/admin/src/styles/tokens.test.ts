/**
 * The amber palette's contrast, measured from `tokens.css` itself (tm 389.6).
 *
 * jsdom has no layout or computed colour, so axe's `color-contrast` rule cannot run in the unit
 * suite; the e2e axe pass (`apps/e2e/tests/platform-admin.spec.ts`) does measure a real page.
 * This is the faster half: every foreground/background pair the shell uses, in both themes,
 * checked against WCAG AA (4.5:1 for text, 3:1 for a focus ring or a boundary). The values are
 * read from the stylesheet rather than transcribed, so retuning a token cannot silently leave the
 * assertion measuring the old one.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const CSS = readFileSync(join(process.cwd(), 'src/styles/tokens.css'), 'utf8');

/** The declarations of the first block that opens with `selector {`. */
function block(selector: string): Record<string, string> {
  const start = CSS.indexOf(`${selector} {`);
  if (start === -1) throw new Error(`no ${selector} block in tokens.css`);
  const body = CSS.slice(start, CSS.indexOf('\n}', start));
  const declarations: Record<string, string> = {};
  for (const match of body.matchAll(/(--[\w-]+):\s*([^;]+);/g)) {
    declarations[match[1]!] = match[2]!.trim();
  }
  return declarations;
}

const LIGHT = block(':root');
const DARK = { ...LIGHT, ...block("[data-theme='dark']") };

function resolve(theme: Record<string, string>, name: string): string {
  let value = theme[name];
  if (value === undefined) throw new Error(`${name} is not defined`);
  const reference = /^var\((--[\w-]+)\)$/.exec(value);
  if (reference) value = resolve(theme, reference[1]!);
  return value;
}

function channel(hex: string, offset: number): number {
  const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
  return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const clean = hex.startsWith('#')
    ? hex
    : (() => {
        throw new Error(`not a hex colour: ${hex}`);
      })();
  return 0.2126 * channel(clean, 1) + 0.7152 * channel(clean, 3) + 0.0722 * channel(clean, 5);
}

function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light! + 0.05) / (dark! + 0.05);
}

const THEMES = [
  ['light', LIGHT],
  ['dark', DARK],
] as const;

describe.each(THEMES)('%s theme', (_name, theme) => {
  const colour = (token: string): string => resolve(theme, token);

  it('keeps text readable on every surface it lands on (4.5:1)', () => {
    const surfaces = ['--bg-canvas', '--bg-surface', '--bg-surface-2', '--bg-inset'];
    const texts = ['--text-primary', '--text-secondary', '--text-tertiary', '--brand-text'];
    const failures: string[] = [];
    for (const text of texts) {
      for (const surface of surfaces) {
        const ratio = contrast(colour(text), colour(surface));
        if (ratio < 4.5) failures.push(`${text} on ${surface}: ${ratio.toFixed(2)}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it('keeps the status colours readable as text on the darkest surface of the theme', () => {
    const surface = theme === LIGHT ? '--bg-inset' : '--bg-surface-2';
    for (const status of ['--success', '--warning', '--danger', '--info']) {
      expect(contrast(colour(status), colour(surface)), status).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('carries white text on every brand fill that has a button on it', () => {
    for (const step of ['--brand-500', '--brand-600', '--brand-700']) {
      expect(contrast('#ffffff', colour(step)), step).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('keeps the PLATFORM strip legible: its text on its amber, comfortably over AA', () => {
    expect(contrast(colour('--strip-text'), colour('--strip-bg'))).toBeGreaterThanOrEqual(7);
  });

  it('draws a focus ring distinguishable from every surface (3:1)', () => {
    for (const surface of ['--bg-canvas', '--bg-surface', '--bg-surface-2', '--bg-rail']) {
      expect(contrast(colour('--focus-ring'), colour(surface)), surface).toBeGreaterThanOrEqual(3);
    }
  });

  it('lets the side menu read on its rail (white at 80% over the rail)', () => {
    // `text-white/80` on `--bg-rail`: composite white at 0.8 over the rail colour.
    const rail = colour('--bg-rail');
    const mix = (offset: number): number =>
      Math.round(255 * 0.8 + parseInt(rail.slice(offset, offset + 2), 16) * 0.2);
    const composite = `#${[1, 3, 5].map((offset) => mix(offset).toString(16).padStart(2, '0')).join('')}`;
    expect(contrast(composite, rail)).toBeGreaterThanOrEqual(7);
  });
});

describe('the amber identity', () => {
  it('is not the workspace panel’s indigo, in either theme', () => {
    // The two panels share token names so components copy across; the colour is what tells an
    // operator with both open which one a destructive button belongs to.
    for (const [, theme] of THEMES) {
      expect(theme['--brand-500']).not.toBe('#5b4fe9');
    }
    expect(LIGHT['--brand-500']).toBe('#b45309');
  });

  it('keeps the strip amber in both themes', () => {
    expect(resolve(LIGHT, '--strip-bg')).toBe('#fbbf24');
    expect(resolve(DARK, '--strip-bg')).toBe('#fbbf24');
  });
});
