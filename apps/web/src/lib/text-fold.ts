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
