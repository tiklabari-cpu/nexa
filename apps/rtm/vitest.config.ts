import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    // Integration tests share one database and truncate between suites, so they
    // must not run concurrently.
    fileParallelism: false,
    sequence: { concurrent: false },
    testTimeout: 30_000,
    hookTimeout: 30_000,
    setupFiles: ['./test/setup.ts'],
  },
});
