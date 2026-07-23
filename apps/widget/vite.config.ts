import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

/**
 * The widget ships as two independent artifacts, built in two passes because
 * they have genuinely different shapes:
 *
 *   loader.js  (`--mode loader`) — the snippet a customer pastes into their
 *     page. A classic IIFE so it needs no module support, it only creates the
 *     iframe, and it never touches host page globals beyond a single namespace.
 *
 *   index.html + assets (default) — the chat UI, served *inside* the iframe.
 *     Because it is a separate document on a separate origin it cannot read the
 *     host page's DOM, storage or cookies (NFR-S6).
 *
 * The loader has a hard 50 KB budget (NFR-P3), enforced by a test.
 */
export default defineConfig(({ mode }) => {
  const isLoader = mode === 'loader';

  return {
    build: isLoader
      ? {
          outDir: 'dist',
          // The app pass runs second and must not wipe the loader.
          emptyOutDir: true,
          target: 'es2019',
          minify: 'terser',
          sourcemap: true,
          lib: {
            entry: resolve(import.meta.dirname, 'src/loader.ts'),
            name: '__nexaLoader',
            formats: ['iife'],
            fileName: () => 'loader.js',
          },
        }
      : {
          outDir: 'dist',
          emptyOutDir: false,
          target: 'es2020',
          minify: 'terser',
          sourcemap: true,
          rollupOptions: {
            input: resolve(import.meta.dirname, 'widget.html'),
          },
        },
    server: {
      port: Number(process.env['WIDGET_PORT'] ?? 5174),
      // The demo host page is served from `<tenant>.localhost` so it sits on a
      // different origin than the widget, the way a real embed does. RFC 6761
      // reserves the whole `.localhost` TLD for loopback, so this cannot reach
      // another machine.
      allowedHosts: ['localhost', '.localhost'],
    },
    test: {
      environment: 'jsdom',
      globals: true,
    },
  };
});
