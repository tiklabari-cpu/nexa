import { defineConfig } from 'vitest/config';

// `scripts/run-sharded.ts` hands each parallel shard its files here, as an exact
// list. Positional CLI filters would not do: they are substring matches, so
// `agent-profile.test.ts` also selects `ai-agent-profile.test.ts`.
const shardFiles = process.env['SIYAHTUS_TEST_FILES']?.split(',').filter(Boolean);

export default defineConfig({
  test: {
    globals: false,
    ...(shardFiles ? { include: shardFiles } : {}),
    // Integration tests share one database and truncate between suites, so they
    // must not run concurrently — parallel files would clobber each other's
    // fixtures and produce failures that look like isolation bugs. (Separate
    // *runs* are isolated by `scripts/with-test-datastores.ts`; that is what
    // `scripts/run-sharded.ts` parallelises over.)
    fileParallelism: false,
    sequence: { concurrent: false },
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Loads the repo-root .env so `pnpm test` works without the caller having
    // to source it first.
    setupFiles: ['./test/setup.ts'],
  },
});
