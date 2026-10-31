/**
 * The one search fold (IN-06 · IN-08 · IN-11).
 *
 * `toLocaleLowerCase('tr-TR')` first — so `I` is `ı` and `İ` is `i`, not the
 * English mapping — then NFD and every combining mark dropped (`ç` → `c`,
 * `ş` → `s`, `ğ` → `g`, `ö` → `o`, `ü` → `u`), and the dotless `ı`, which has
 * no decomposition, mapped to `i`. Query and text go through the same fold, so
 * an agent may type with or without the Turkish letters and "İki adımlı" is
 * found by "iki", "IKI" and "iki adimli" alike.
 *
 * Saved replies, the shortcut list and the command palette all fold with this
 * function; a second copy would drift the first time one of them learned a new
 * letter.
 */
export function foldForSearch(value: string): string {
  return value
    .toLocaleLowerCase('tr-TR')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/ı/g, 'i');
}

/**
 * How well `query` matches one entry, for the lists that rank (IN-11): `0` the
 * label starts with it, `1` the label contains it, `2` only an alias does,
 * `null` no match. Everything is folded here, so a caller passes the typed
 * query and the raw label/aliases and cannot forget the fold on one side.
 * An empty (or blank) query matches nothing.
 */
export function matchRank(
  query: string,
  label: string,
  aliases: readonly string[] = [],
): 0 | 1 | 2 | null {
  const needle = foldForSearch(query.trim());
  if (!needle) return null;
  const folded = foldForSearch(label);
  if (folded.startsWith(needle)) return 0;
  if (folded.includes(needle)) return 1;
  return aliases.some((alias) => foldForSearch(alias).includes(needle)) ? 2 : null;
}
