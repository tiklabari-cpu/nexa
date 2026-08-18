import type { Messages } from '../merge.js';

/**
 * Settings: channels, widgets, tags, security, sandbox, white-label.
 *
 * Empty until I18N-i/j (tm 133.9, 133.10) translates that surface. The file exists in both locales
 * from the start so the window doing the work has a place to write and never
 * has to invent the layout — and so `en`/`tr` filenames stay identical, which
 * `i18n-coverage.test.ts` checks.
 */
export const settings: Messages = {};
