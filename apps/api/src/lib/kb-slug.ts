/**
 * KB slug normalisation (PUBKB-b · PRD §5.3).
 *
 * A KB slug is the URL segment a published article or category is read at, so it
 * must be a clean, lower-cased, hyphenated ASCII token. This differs from the
 * name-derived slug elsewhere (`brands.ts` `slugify`) in one deliberate way: it
 * **refuses** rather than transliterates. The KK for the public KB is explicit —
 * "ASCII dışı transliterasyon yok" — so a value carrying a non-ASCII letter is
 * not silently folded into hyphens (which would turn "Ürünler" into a
 * meaningless "rnler" or ""); it comes back `null` for the caller to reject, and
 * the author is asked to supply an ASCII slug they actually intended.
 */

/**
 * Normalise a KB slug, or return `null` if the input cannot be one.
 *
 * Lower-cases, turns runs of whitespace into single hyphens, collapses repeated
 * hyphens and trims them from the ends. Returns `null` when the input carries a
 * non-ASCII character (no transliteration), or when nothing valid remains
 * (empty, or a character outside `[a-z0-9-]` survived — e.g. punctuation).
 */
export function normalizeKbSlug(input: string): string | null {
  // Checked on the raw input: an accented or non-Latin letter must be refused,
  // not quietly dropped on the way to a lossy slug. Any UTF-16 unit above 0x7F
  // is non-ASCII (every ASCII code point is at most 127).
  for (let i = 0; i < input.length; i++) {
    if (input.charCodeAt(i) > 127) return null;
  }

  const slug = input
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');

  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) ? slug : null;
}
