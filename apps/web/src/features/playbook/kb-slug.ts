/**
 * KB article slug — derivation and validation on the write form (PUBKB-h).
 *
 * Mirrors the backend's normalisation (`apps/api/src/lib/kb-slug.ts`
 * `normalizeKbSlug`, plus the reserved-word list in `routes/kb.ts`) closely
 * enough that what this preview accepts is what the PATCH will actually
 * accept — but it stays a preview: a genuine duplicate slug is only the
 * backend's to catch, and comes back as a field-under error from the save.
 */

/**
 * Words that already name a static route on the public reader surfaces
 * (`articles`/`categories` — PUBKB-c, `sitemap.xml`/`robots.txt` — PUBKB-f).
 * An article saved under one of these would never be reachable at its own
 * address, so it is refused here the same way the backend refuses it.
 */
const RESERVED_ARTICLE_SLUGS = new Set(['articles', 'categories', 'sitemap.xml', 'robots.txt']);

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Turn a title into a slug candidate: lower-case, whitespace runs collapsed to
 * a single hyphen, repeated hyphens collapsed, leading/trailing hyphens
 * trimmed. Never rejects — this is what the Slug field auto-fills as the
 * Title is typed, so it always produces something to look at (and, if need
 * be, hand-edit) rather than leaving the field blank the moment the title
 * holds an unusual character.
 */
export function deriveKbSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * The Slug field's validator (FR-EK-A.1). Catches, ahead of the round trip,
 * the mistakes that are knowable client-side: empty, a character outside
 * `[a-z0-9-]`, or a word reserved for a public-KB static route. A slug that
 * collides with another article's is not knowable here — the backend is the
 * only side that has the full set — so that case still comes back as a
 * server-reported field error.
 */
export function kbSlugError(slug: string): string | null {
  const value = slug.trim();
  if (!value) return 'Give the article a slug — its permanent address.';
  if (!SLUG_PATTERN.test(value)) {
    return 'Use lower-case letters, numbers and hyphens only.';
  }
  if (RESERVED_ARTICLE_SLUGS.has(value)) {
    return `"${value}" is reserved and cannot be used for an article.`;
  }
  return null;
}
