/* eslint-env node */
/**
 * `jest-expo` is this gate's stand-in for a device: it applies the same Babel
 * transform Metro uses and installs the React Native module mocks, so a test can
 * import from `react-native` without a simulator. Playwright never enters this
 * workspace (§6.1.6 assumption) — this suite plus `expo export` is the gate.
 */

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
  testMatch: ['<rootDir>/src/**/*.test.ts', '<rootDir>/src/**/*.test.tsx'],
  // RNTL v14 registers its own matchers and cleanup, so no setup file is needed;
  // these two keep one test's stubs from leaking into the next.
  clearMocks: true,
  restoreMocks: true,
};
