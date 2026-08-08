import '@testing-library/jest-dom/vitest';

// jsdom has no layout engine, so `Element.prototype.scrollIntoView` is absent
// — any component that calls it (e.g. keeping a keyboard-highlighted list row
// in view) throws under jsdom without a stand-in. The real scroll is a
// browser concern tests do not assert on, so a no-op is enough.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}
