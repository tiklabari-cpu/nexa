/**
 * Searching saved replies the way a Turkish-speaking agent types (IN-06).
 *
 * The `#` picker used to match the shortcut's first letters and stop at six
 * results, so "papara" found the replies whose shortcut began with it and hid
 * every other reply that *talks about* Papara, and "cekim" never found
 * "çekim". Both halves are fixed here, in the client, because the list already
 * arrives whole (a workspace has hundreds of replies, not hundreds of
 * thousands) and a round trip per keystroke would be slower than the filter.
 *
 * Folding: `toLocaleLowerCase('tr-TR')` first — so `I` is `ı` and `İ` is `i`,
 * not the English mapping — then NFD and every combining mark dropped (`ç` →
 * `c`, `ş` → `s`, `ğ` → `g`, `ö` → `o`, `ü` → `u`), and the dotless `ı`, which
 * has no decomposition, mapped to `i`. Query and text go through the same
 * fold, so the agent may type with or without the Turkish letters.
 *
 * Order: shortcut starts with the query, then shortcut contains it, then the
 * text does; inside a band, by shortcut, and a personal reply before a shared
 * one with the same shortcut (it is the one its author wrote for themselves).
 */
import { foldForSearch } from '../../lib/text-fold.js';
import type { CannedResponse } from './useCannedResponses.js';

// Re-exported: the fold moved to `lib/text-fold.ts`, shared with the palette.
export { foldForSearch };

/** 0 shortcut prefix, 1 shortcut infix, 2 text; null for no match. */
function band(item: CannedResponse, needle: string): number | null {
  const shortcut = foldForSearch(item.shortcut);
  if (shortcut.startsWith(needle)) return 0;
  if (shortcut.includes(needle)) return 1;
  if (foldForSearch(item.text).includes(needle)) return 2;
  return null;
}

/**
 * Every reply matching `query`, best first — no cap; the picker scrolls. An
 * empty query (a bare `#`) is every reply, in shortcut order.
 */
export function rankCannedResponses(items: CannedResponse[], query: string): CannedResponse[] {
  const needle = foldForSearch(query.trim());
  const ranked: Array<{ item: CannedResponse; band: number; key: string }> = [];
  for (const item of items) {
    const b = needle === '' ? 0 : band(item, needle);
    if (b !== null) ranked.push({ item, band: b, key: foldForSearch(item.shortcut) });
  }
  ranked.sort(
    (a, b) =>
      a.band - b.band ||
      (a.key < b.key ? -1 : a.key > b.key ? 1 : 0) ||
      Number(b.item.visibility === 'private') - Number(a.item.visibility === 'private'),
  );
  return ranked.map((r) => r.item);
}
