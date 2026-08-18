/* eslint-env node */
/**
 * Runs after the test framework is installed — which is the whole reason this
 * file exists next to `jest.setup.js`. Anything that touches React Native
 * Testing Library has to wait until `expect`/`afterEach` exist, because
 * importing RNTL registers its matchers and its automatic cleanup hook.
 */
const { configure } = require('@testing-library/react-native');

/**
 * RNTL gives `findBy*` and `waitFor` one second, and one second is not a budget
 * this suite can be held to on a loaded machine.
 *
 * That default is separate from Jest's `testTimeout` (raised to 20 s in
 * `jest.config.js`) and it expires first, which is why the failure it produces
 * reads as a missing element rather than a slow one — "Unable to find an element
 * with text: No teammates yet." is what a screen that simply had not finished
 * fetching yet looks like from the outside. Measured (2026-08-18, 20 vCPU) under
 * `pnpm -w test`, where jest-expo competes with three vitest projects for cores:
 * four such failures, all on the first render in their file, all of them screens
 * whose text does arrive — just later than a second.
 *
 * Five seconds keeps a real absence a fast failure (one `findBy*` that never
 * resolves still reports inside the 20 s test budget, with its own useful
 * message) while giving a slow one five times the headroom it had.
 */
configure({ asyncUtilTimeout: 5_000 });
