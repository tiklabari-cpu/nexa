import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    // Integration tests share one database and truncate between suites, so they
    // must not run concurrently — parallel files would clobber each other's
    // fixtures and produce failures that look like isolation bugs.
    fileParallelism: false,
    sequence: { concurrent: false },
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Loads the repo-root .env so `pnpm test` works without the caller having
    // to source it first.
    setupFiles: ['./test/setup.ts'],
  },
});
