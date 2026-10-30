/**
 * The widget's stylesheet, made smaller for the build (tm 320.1 · NFR-P3).
 *
 * The styles live in one template literal in `src/widget.ts` (`WIDGET_CSS`),
 * written for people: indented, commented, one declaration group per line.
 * Terser keeps a string as it is, so all of that reached the visitor — about
 * 4 KB gzipped of the 63 KB budget (`test/bundle-size.test.ts`), which had 11
 * bytes left when the "is it solved?" buttons (AI-25-S2) needed room.
 *
 * {@link minifyCss} drops the comments, trims each line, collapses runs of
 * spaces and the spaces around `{`, `}`, `;` and `,`. Nothing else: a space
 * before `:` is a descendant combinator, and one around `+`, `-` or `~` may be
 * `calc()` arithmetic or a combinator, so those stay. Line breaks stay too,
 * so the transform moves no code and the source map stays true (`map: null`).
 * The test parses the stylesheet before and after and compares every rule.
 *
 * Build only: the dev server and the tests read the source as written.
 */
import { resolve } from 'node:path';
import type { Plugin } from 'vite';

/** Comment-free, trimmed, with no space a CSS parser needs; the same number of lines. */
export function minifyCss(css: string): string {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, (comment) => '\n'.repeat(comment.split('\n').length - 1))
    .split('\n')
    .map((line) =>
      line
        .replace(/[ \t]+/g, ' ')
        .trim()
        .replace(/ ?([{};,]) ?/g, '$1')
        // A declaration's colon never needs the space after it; a selector's never has one.
        .replace(/(^|[{;])([a-z-]+): /g, '$1$2:')
        // The last declaration of a rule needs no semicolon.
        .replace(/;}/g, '}'),
    )
    .join('\n');
}

/** This package's own `src/widget.ts` — not the types package's file of the same name. */
const WIDGET_SOURCE = resolve(import.meta.dirname, 'src/widget.ts');

const STYLESHEET = /(const WIDGET_CSS = `)([^`]*)(`)/;

/** The template literal's text in `src/widget.ts`, or null when it is not there. */
export function widgetCssOf(source: string): string | null {
  return STYLESHEET.exec(source)?.[2] ?? null;
}

/** Vite plugin: `WIDGET_CSS` minified in `src/widget.ts`, at build time only. */
export function minifyWidgetCss(): Plugin {
  return {
    name: 'siyahtus-minify-widget-css',
    apply: 'build',
    transform(code, id) {
      if (resolve(id) !== WIDGET_SOURCE) return null;
      if (!STYLESHEET.test(code)) {
        this.error(
          'WIDGET_CSS was not found in src/widget.ts — the stylesheet would ship unminified',
        );
      }
      return {
        code: code.replace(STYLESHEET, (_all, open: string, css: string, close: string) => {
          return `${open}${minifyCss(css)}${close}`;
        }),
        map: null,
      };
    },
  };
}
