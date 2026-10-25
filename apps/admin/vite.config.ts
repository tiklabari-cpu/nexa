import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// The platform-api process: `PLATFORM_BASE_URL` when a private stack names it, else the local
// `PLATFORM_PORT` (4002) — the same variable platform-api itself listens on.
const PLATFORM_TARGET =
  process.env['PLATFORM_BASE_URL'] ?? `http://localhost:${process.env['PLATFORM_PORT'] ?? 4002}`;

/**
 * Source maps are on for every build except the container image's: the
 * Dockerfile sets `SIYAHTUS_BUILD_SOURCEMAPS=false`, so the served bundle
 * neither ships `.map` files nor names one. Only `false` turns them off.
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
  // A second dev server beside the usual one (a private e2e stack) needs its own
  // dependency cache, or its optimizer rewrites `.vite/deps` under the running one.
  ...(process.env['SIYAHTUS_VITE_CACHE_DIR']
    ? { cacheDir: process.env['SIYAHTUS_VITE_CACHE_DIR'] }
    : {}),
  server: {
    port: Number(process.env['ADMIN_PORT'] ?? 5175),
    // Same-origin platform API in dev, exactly as it is behind the edge in
    // production (`/platform/*` → platform-api). No cookie, no CORS: the
    // operator session is a bearer token.
    proxy: {
      '/platform': { target: PLATFORM_TARGET, changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: SOURCEMAPS,
    rollupOptions: {
      output: {
        manualChunks(id) {
          // Matched by package directory, not listed by import name: since v7 react-router-dom
          // only re-exports react-router, which this app does not depend on directly.
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
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
