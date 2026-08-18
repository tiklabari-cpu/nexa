import type { Messages } from '../merge.js';

/**
 * Sign-in and the public pages (sign up, forgot/reset, join, OAuth callback).
 *
 * Empty until I18N-b (tm 133.2) translates that surface. The file exists in both locales
 * from the start so the window doing the work has a place to write and never
 * has to invent the layout — and so `en`/`tr` filenames stay identical, which
 * `i18n-coverage.test.ts` checks.
 */
export const auth: Messages = {};
