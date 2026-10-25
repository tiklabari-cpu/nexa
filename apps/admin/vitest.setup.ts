import '@testing-library/jest-dom/vitest';

import { setFormatLocale } from './src/lib/format.js';

// jsdom has no layout engine, so `scrollIntoView` is absent; a no-op is enough.
// A file on the node environment (`test/*.test.ts`) has no `Element` at all.
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

// The locale every test formats against unless it says otherwise: the runtime default is
// whatever the developer's OS is set to, and the gate must not measure the laptop (apps/web, tm 108).
setFormatLocale('en-US');
