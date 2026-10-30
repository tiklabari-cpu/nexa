/**
 * The Help tab as a chunk of its own, without Vite's preload helper (WG-12 ·
 * tm 348 · NFR-P3).
 *
 * `src/help.ts` is fetched the first time a visitor opens the tab, so a page
 * whose visitors never do pays nothing for it. A plain `import('./help.js')`
 * would get there, but Vite wraps every literal dynamic import in its
 * `__vitePreload` helper (CSS and dependency preloading the widget has no use
 * for: one chunk, its styles inside it) — ≈0.5 KB gzipped on every page, when
 * the budget (`test/bundle-size.test.ts`) had 261 B left.
 *
 * So `src/widget.ts` writes the plain `import('./help.js')` — what the dev
 * server and the tests load as it is — and at build time this plugin, running
 * before Vite's import analysis, emits `src/help.ts` as a chunk and turns the
 * import into one of Rollup's URL for it (`import.meta.ROLLUP_FILE_URL_<ref>`).
 * A dynamic import whose argument is not a string literal gets no preload
 * wrapper. The replacement stays on its line, so the source map stays true.
 */
import { resolve } from 'node:path';
import type { Plugin } from 'vite';

/** This package's own files — the types package has a `src/widget.ts` too. */
const WIDGET_SOURCE = resolve(import.meta.dirname, 'src/widget.ts');
const HELP_SOURCE = resolve(import.meta.dirname, 'src/help.ts');

/** The import in `src/widget.ts` the build points at the emitted chunk's URL. */
export const HELP_IMPORT = "import('./help.js')";

/** Vite plugin: `src/help.ts` emitted as its own chunk and addressed by URL, build only. */
export function helpChunk(): Plugin {
  let reference = '';
  return {
    name: 'siyahtus-help-chunk',
    apply: 'build',
    // Before Vite's import analysis, which wraps a literal dynamic import.
    enforce: 'pre',
    buildStart() {
      // `strict`: an app build keeps no entry's exports (Vite sets
      // `preserveEntrySignatures: false`), and `openHelp` is what the widget imports.
      reference = this.emitFile({
        type: 'chunk',
        id: HELP_SOURCE,
        name: 'help',
        preserveSignature: 'strict',
      });
    },
    transform(code, id) {
      if (resolve(id) !== WIDGET_SOURCE) return null;
      if (!code.includes(HELP_IMPORT)) {
        this.error('the Help tab import was not found in src/widget.ts — it would not load');
      }
      return {
        code: code.replace(
          HELP_IMPORT,
          () => `import(/* @vite-ignore */ import.meta.ROLLUP_FILE_URL_${reference})`,
        ),
        map: null,
      };
    },
  };
}
