import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const API_TARGET = process.env['API_BASE_URL'] ?? 'http://localhost:4000';

/**
 * Source maps are on for every build except the container image's
 * (tm 256.5): the Dockerfile sets `SIYAHTUS_BUILD_SOURCEMAPS=false`, so the
 * served bundle neither ships `.map` files nor names one. Only `false` turns
 * them off.
 */
const SOURCEMAPS = process.env['SIYAHTUS_BUILD_SOURCEMAPS'] !== 'false';

/** Long-cached vendor chunks: package name → chunk. Everything else stays in the app chunk. */
const VENDOR_CHUNKS: Record<string, string> = {
  react: 'react',
  'react-dom': 'react',
  scheduler: 'react',
  'react-router': 'react',
  'react-router-dom': 'react',
  cookie: 'react',
  'set-cookie-parser': 'react',
  '@tanstack/react-query': 'query',
  '@tanstack/query-core': 'query',
};

export default defineConfig({
  plugins: [react()],
  // A second dev server beside the usual one (the pilot e2e stack,
  // `apps/e2e/playwright.pilot.config.ts`) needs its own dependency cache, or
  // its optimizer rewrites `.vite/deps` under the running one. Unset, Vite's
  // default.
  ...(process.env['SIYAHTUS_VITE_CACHE_DIR']
    ? { cacheDir: process.env['SIYAHTUS_VITE_CACHE_DIR'] }
    : {}),
  server: {
    port: Number(process.env['WEB_PORT'] ?? 5173),
    // Proxy in dev so the browser sees a same-origin API and cookies behave
    // exactly as they will behind a shared gateway in production.
    proxy: {
      '/api': { target: API_TARGET, changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: SOURCEMAPS,
    rollupOptions: {
      output: {
        // Matched by package directory, not listed by import name. Since v7,
        // react-router-dom only re-exports react-router, which this app does not
        // depend on directly, so the object form cannot resolve it and the
        // router would land in the app chunk.
        manualChunks(id) {
          const pkg = /.*[\\/]node_modules[\\/]((?:@[^\\/]+[\\/])?[^\\/]+)/.exec(id)?.[1];
          return pkg ? VENDOR_CHUNKS[pkg.replace('\\', '/')] : undefined;
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    css: false,
  },
});
