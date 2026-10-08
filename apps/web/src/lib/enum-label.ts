/**
 * Words for a closed set of system values (O8 / D13, tm 259.17).
 *
 * The server hands the panel codes — `owner`, `ready`, `boolean`, `monthly` —
 * and a person reads them as words. A code this panel has no wording for is
 * shown as written: the server's vocabulary grows faster than a panel is
 * released, and a blank would hide a state that is real.
 */
import { hasMessage, type TFunction } from './i18n.js';

/** `t('<prefix>.<value>')` when that key exists, else the value itself. */
export function enumLabel(t: TFunction, prefix: string, value: string): string {
  const key = `${prefix}.${value}`;
  return hasMessage('en', key) ? t(key) : value;
}
