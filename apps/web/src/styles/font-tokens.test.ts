/**
 * The panel font presets in `tokens.css` (owner, 2026-10-13).
 *
 *   - The built-in look is unchanged: `:root`'s font variables are exactly the
 *     literals `body` and the headings carried before presets existed, and
 *     those rules now read the variables.
 *   - Each `html[data-font=…]` block is `@siyahtus/types` · `PANEL_FONT_DESIGNS`.
 *   - The widget preview's reset carries the built-in values.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PANEL_FONT_DESIGNS, PANEL_FONT_PRESETS, type PanelFontDesign } from '@siyahtus/types';

const CSS = readFileSync(join(process.cwd(), 'src', 'styles', 'tokens.css'), 'utf8');

/** The declarations of the first block whose selector is exactly `selector`. */
function block(selector: string, from = 0): Record<string, string> {
  const start = CSS.indexOf(`${selector} {`, from);
  if (start === -1) throw new Error(`${selector} not found`);
  const body = CSS.slice(CSS.indexOf('{', start) + 1, CSS.indexOf('}', start));
  const withoutComments = body.replace(/\/\*[\s\S]*?\*\//g, '');
  return Object.fromEntries(
    [...withoutComments.matchAll(/([\w-]+):\s*([^;]+);/g)].map((m) => [
      m[1]!,
      m[2]!.replace(/\s+/g, ' ').trim(),
    ]),
  );
}

function asVariables(design: PanelFontDesign): Record<string, string> {
  return {
    '--font-body': design.body,
    '--font-heading': design.heading,
    '--font-size-body': design.bodySize,
    '--ls-body': design.letterSpacingBody,
    '--ls-heading': design.letterSpacingHeading,
    '--font-features': design.features,
    '--kpi-weight': String(design.kpiWeight),
  };
}

/** The font block on `:root` — the one after the colour ramps. */
const FONT_ROOT = block(':root', CSS.indexOf('--font-body') - 200);

describe('panel font presets in tokens.css', () => {
  it('keeps the built-in look exactly as it was before presets', () => {
    // The literals body and h1–h3 carried until 2026-10-13, and the Kpi's
    // `font-bold`.
    expect(FONT_ROOT).toMatchObject({
      '--font-body':
        "'Inter Variable', 'Inter var', Inter, -apple-system, 'Segoe UI', system-ui, sans-serif",
      '--font-size-body': '0.8125rem',
      '--ls-body': 'normal',
      '--ls-heading': '-0.011em',
      '--font-features': "'cv11' 1, 'ss03' 1, 'cv02' 1",
      '--kpi-weight': '700',
    });
    expect(FONT_ROOT).toEqual(asVariables(PANEL_FONT_DESIGNS.inter));
  });

  it('has body and the headings read the variables', () => {
    expect(block('body')).toMatchObject({
      'font-family': 'var(--font-body)',
      'font-feature-settings': 'var(--font-features)',
      'font-size': 'var(--font-size-body)',
      'letter-spacing': 'var(--ls-body)',
    });
    expect(block('h3')).toMatchObject({
      'font-family': 'var(--font-heading)',
      'letter-spacing': 'var(--ls-heading)',
    });
  });

  it.each(PANEL_FONT_PRESETS.filter((p) => p !== 'inter'))(
    'carries the %s design from @siyahtus/types',
    (preset) => {
      expect(block(`html[data-font='${preset}']`)).toEqual(asVariables(PANEL_FONT_DESIGNS[preset]));
    },
  );

  it('resets the widget preview to the built-in values', () => {
    expect(block('.font-preset-reset')).toMatchObject(asVariables(PANEL_FONT_DESIGNS.inter));
  });
});
