import { beforeEach } from 'vitest';

// The widget keeps its last token mint for the tab in sessionStorage (tm 429).
// jsdom keeps one window per test file, so a mint one test made would answer
// the next test's mount: every test starts as a fresh tab. A test about the
// kept mint mounts twice inside itself. (Optional chaining: the build tests
// run without a DOM.)
beforeEach(() => {
  globalThis.sessionStorage?.clear();
});
