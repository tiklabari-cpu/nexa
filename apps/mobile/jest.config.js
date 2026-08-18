/* eslint-env node */
/**
 * `jest-expo` is this gate's stand-in for a device: it applies the same Babel
 * transform Metro uses and installs the React Native module mocks, so a test can
 * import from `react-native` without a simulator. Playwright never enters this
 * workspace (§6.1.6 assumption) — this suite plus `expo export` is the gate.
 */

/**
 * Pin the environment the gate runs in, rather than inherit it.
 *
 * `jest` only sets `NODE_ENV=test` when nothing else has: an ambient value wins.
 * The root `.env` carries `NODE_ENV=development` and turbo forwards `NODE_ENV`
 * (`turbo.json` `globalEnv`), so a window that sourced `.env` — which is how
 * `db:migrate` and the e2e suite are run here — hands this suite a different
 * environment than a window that did not. React Native reads it at runtime:
 * `Libraries/Animated/nodes/AnimatedProps.js` falls back to a synthetic view tag
 * when `NODE_ENV === 'test'` and otherwise **throws** `Unable to locate attached
 * view in the native tree`, because outside a test there is supposed to be a
 * native tree. Under `react-test-renderer` there never is one, so every screen
 * React Navigation animates fails to render. That is the failure §D112 recorded
 * as a load-timing flake; it is not one — measured, it reproduces on demand with
 * `NODE_ENV=development npx jest src/App.test.tsx` and never appears with
 * `NODE_ENV=test`, at any load. CI already exports `NODE_ENV=test`
 * (`.github/workflows/ci.yml`); this makes a local run agree with it.
 */
process.env.NODE_ENV = 'test';

/**
 * React Native and Expo publish untranspiled source, so they must go through
 * Babel rather than be treated as ready-to-run CommonJS. The recipe every RN
 * project copies — `node_modules/(?!react-native|expo|…)` — does not work here:
 * pnpm stores every real package under `node_modules/.pnpm/<name>@<version>/`,
 * so that pattern matches the outer `node_modules/` and ignores the whole store
 * before it ever reaches a package name. Anchor on the `.pnpm` directory instead
 * and whitelist by the escaped names pnpm writes there (`@react-native+…`).
 */
const TRANSFORMED = [
  '(jest-)?react-native.*',
  '@react-native(-community)?\\+.*',
  // Ships ESM-only (`lib/module`, no `lib/commonjs`) as of v7 — Jest's default
  // CJS runtime cannot execute `export`/`import` unless Babel gets to it first.
  '@react-navigation\\+.*',
  'expo.*',
  '@expo(nent)?\\+.*',
  '@testing-library\\+react-native.*',
  'test-renderer.*',
].join('|');

module.exports = {
  preset: 'jest-expo',
  transformIgnorePatterns: [`node_modules[/\\\\]\\.pnpm[/\\\\](?!(?:${TRANSFORMED}))`],
  moduleNameMapper: {
    // `@nexa/types` is TypeScript source whose internal imports carry the ESM
    // `.js` extension (`export * from './domain.js'`) — the form tsc, vite and
    // tsx all expect, and the one Jest's CommonJS resolver cannot follow to a
    // `.ts` file. Metro needs the same shim; see `metro.config.js`.
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  setupFiles: ['<rootDir>/jest.setup.js'],
  // RNTL v14 registers its own matchers and cleanup, so nothing here needs to
  // install them — but its timeouts have to be widened after the framework is
  // in place, which `setupFiles` is too early for.
  setupFilesAfterEnv: ['<rootDir>/jest.setup-after-env.js'],
  testMatch: ['<rootDir>/src/**/*.test.ts', '<rootDir>/src/**/*.test.tsx'],
  /**
   * Five seconds is not a budget this suite can be held to on a loaded machine.
   *
   * Measured (2026-08-18, 20 vCPU): alone the suite is 495/495 in ~16 s, and the
   * slowest single test is well under a second. Run the way the gate runs it —
   * `pnpm -w test`, so jest-expo, three vitest projects and their workers all
   * want the same cores — 18 tests fail, and they are almost exactly the *first*
   * test of each file: React Native's module graph is loaded lazily on first
   * render, so whichever test renders first pays for it, and starved of CPU that
   * one-off cost crosses five seconds. Nothing about the assertion is slow.
   * 20 s is the ceiling §D112 set; it holds ~40× the unloaded cost of the
   * slowest first render, and a test that genuinely hangs still fails the gate
   * rather than the run.
   */
  testTimeout: 20_000,
  /**
   * Half the cores, because all of them is slower — measured, not assumed.
   *
   * Jest's default is one worker per core bar one (19 here), and each one loads
   * the whole React Native module graph. On this machine that costs more than it
   * buys, and it costs the most exactly when the gate is busiest. Three runs of
   * this suite, same commit (2026-08-18, 20 vCPU):
   *
   *   workers | alone  | with 20 cores already saturated
   *   default |  15.7s | 61.7s
   *   50%     |   8.2s | 20.9s
   *
   * So this is not a flake mitigation that trades speed for calm — it is faster
   * both ways, and it is what leaves headroom for the other three suites
   * `pnpm -w test` starts at the same moment.
   */
  maxWorkers: '50%',
  // these two keep one test's stubs from leaking into the next.
  clearMocks: true,
  restoreMocks: true,
};
