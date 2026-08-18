import type { Messages } from '../merge.js';

/**
 * Apps marketplace and the developer portal.
 *
 * Empty until I18N-k (tm 133.11) translates that surface. The file exists in both locales
 * from the start so the window doing the work has a place to write and never
 * has to invent the layout — and so `en`/`tr` filenames stay identical, which
 * `i18n-coverage.test.ts` checks.
 */
export const apps: Messages = {};
