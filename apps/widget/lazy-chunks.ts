/**
 * The widget's lazy modules as chunks of their own, without Vite's preload
 * helper (WG-12 · tm 348, EN-03 · tm 352.2 · NFR-P3).
 *
 * `src/help.ts` is fetched the first time a visitor opens the Help tab and
 * `src/targeting.ts` only for a workspace with a campaign running, so a page
 * whose visitors never need them pays nothing. A plain `import('./help.js')`
 * would get there, but Vite wraps every literal dynamic import in its
 * `__vitePreload` helper (CSS and dependency preloading the widget has no use
 * for: one chunk, its styles inside it) — ≈0.5 KB gzipped on every page, when
 * the budget (`test/bundle-size.test.ts`) had 261 B left.
 *
 * So `src/widget.ts` writes the plain `import('./help.js')` — what the dev
 * server and the tests load as it is — and at build time this plugin, running
 * before Vite's import analysis, emits each module as a chunk and turns the
 * import into one of Rollup's URL for it (`import.meta.ROLLUP_FILE_URL_<ref>`).
 * A dynamic import whose argument is not a string literal gets no preload
 * wrapper. The replacement stays on its line, so the source map stays true.
 */
import { resolve } from 'node:path';
import type { Plugin } from 'vite';

/** This package's own files — the types package has a `src/widget.ts` too. */
const WIDGET_SOURCE = resolve(import.meta.dirname, 'src/widget.ts');

/** Each lazy module and the import in `src/widget.ts` the build points at its chunk's URL. */
export const LAZY_CHUNKS = [
  { name: 'help', source: 'src/help.ts', importCall: "import('./help.js')" },
  { name: 'targeting', source: 'src/targeting.ts', importCall: "import('./targeting.js')" },
  { name: 'card', source: 'src/card.ts', importCall: "import('./card.js')" },
] as const;

/** Vite plugin: the lazy modules emitted as chunks and addressed by URL, build only. */
export function lazyChunks(): Plugin {
  const references = new Map<string, string>();
  return {
    name: 'siyahtus-lazy-chunks',
    apply: 'build',
    // Before Vite's import analysis, which wraps a literal dynamic import.
    enforce: 'pre',
    buildStart() {
      for (const chunk of LAZY_CHUNKS) {
        // `strict`: an app build keeps no entry's exports (Vite sets
        // `preserveEntrySignatures: false`), and the widget imports them by name.
        references.set(
          chunk.name,
          this.emitFile({
            type: 'chunk',
            id: resolve(import.meta.dirname, chunk.source),
            name: chunk.name,
            preserveSignature: 'strict',
          }),
        );
      }
    },
    transform(code, id) {
      if (resolve(id) !== WIDGET_SOURCE) return null;
      let out = code;
      for (const chunk of LAZY_CHUNKS) {
        if (!out.includes(chunk.importCall)) {
          this.error(`the ${chunk.name} import was not found in src/widget.ts — it would not load`);
        }
        out = out.replace(
          chunk.importCall,
          () =>
            `import(/* @vite-ignore */ import.meta.ROLLUP_FILE_URL_${references.get(chunk.name)})`,
        );
      }
      return { code: out, map: null };
    },
  };
}
