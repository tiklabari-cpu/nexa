/**
 * Safe render core for public knowledge-base article bodies (PUBKB-d · PRD
 * §5.3-Knowledge · NFR-S6 · NFR-S4).
 *
 * An agent authors an article body; that body is then served as HTML to
 * *unauthenticated* browsers on the public KB surface (PUBKB-e). So the body is
 * attacker-influenced text that reaches a trust boundary with no login in front
 * of it — a stored-XSS sink if anything the author typed can execute in a
 * reader's browser. This module is the one place that turns author text into
 * markup, and it is built so the reader's browser runs *nothing* but the fixed
 * whitelist of tags below.
 *
 * The invariant, and why it is a single indivisible function: **escape first,
 * then whitelist.** Every byte of the input is HTML-escaped up front, so any
 * `<script>`, `<img onerror>` or `"`-attribute-break the author wrote is already
 * inert text before a single markdown rule looks at it. Only *after* that do we
 * recognise a small markdown subset and emit our own tags. Split the two steps
 * and the stored-XSS hole opens exactly at the seam — a tag recognised before
 * its dangerous characters were neutralised. Keeping escape and whitelist in one
 * function keeps the ordering un-splittable.
 *
 * No sanitiser dependency (`sanitize-html`, `DOMPurify`, `marked`, …) is added
 * (§C-PUBKB-3): a whitelist-producing renderer is safer to audit than a
 * blacklist-stripping one, and this way there is no third-party parser whose
 * quirks become our attack surface. The reverse-direction helper in
 * `services/ai/web-crawler.ts` (`htmlToText`) is deliberately *not* reused — it
 * decodes entities, which is the opposite of what a safe output path must do.
 *
 * All scanning is linear (anchored per-line matches, negated character classes,
 * one left-to-right inline pass) so no input can trigger catastrophic regex
 * backtracking, and the input length is capped so work and output stay bounded.
 */

/**
 * Input ceiling. Beyond this the body is truncated before rendering — a very
 * long article is legitimate, an unbounded one is a denial-of-service lever.
 * Because escaping expands each byte by at most a small constant, capping the
 * input is what caps the output; truncating the *output* instead could sever a
 * tag mid-way and is never done.
 */
const MAX_INPUT_LENGTH = 100_000;

/** Default excerpt length, sized for a search-result meta description. */
const DEFAULT_EXCERPT_LENGTH = 160;

/**
 * HTML-escape the five characters that carry meaning in HTML text and in
 * double-quoted attribute values. `&` is replaced first so the ampersands this
 * function introduces are not escaped a second time. After this runs, the string
 * cannot open a tag (`<`), close one (`>`), break out of an attribute (`"`/`'`)
 * or start an entity (`&`) — it is inert text.
 *
 * Exported so the SEO HTML surface (PUBKB-e, `kb-page.ts`) escapes every
 * interpolated title/description/URL through this one audited primitive rather
 * than growing a second, possibly-weaker copy — the same "call, don't copy"
 * discipline the render path itself follows.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Normalise line endings to `\n`, drop C0 control characters (keeping tab and
 * newline) and DEL, and cap the length — all in one linear pass, no regex, so a
 * NUL or stray control byte can neither reach the output nor confuse the scheme
 * check below. Surrogate pairs are copied half by half, which reconstructs them
 * unchanged, so non-ASCII prose (Turkish article text, emoji) survives intact.
 */
function normaliseInput(input: string): string {
  const capped = input.length > MAX_INPUT_LENGTH ? input.slice(0, MAX_INPUT_LENGTH) : input;
  let out = '';
  for (let i = 0; i < capped.length; i += 1) {
    const code = capped.charCodeAt(i);
    if (code === 0x0d) {
      // CR or CRLF collapses to a single LF.
      out += '\n';
      if (capped.charCodeAt(i + 1) === 0x0a) i += 1;
      continue;
    }
    if (code === 0x0a || code === 0x09) {
      out += capped[i];
      continue;
    }
    if (code < 0x20 || code === 0x7f) continue; // strip other C0 controls + DEL
    out += capped[i];
  }
  return out;
}

/**
 * Inline markdown, matched left-to-right in a single pass. Ordered so the more
 * literal construct wins at a given position: a code span (its contents are
 * literal), then a link, then bold. Each alternative uses a negated class or a
 * lazy `[^\n]` body, none nested, so the scan is linear — no catastrophic
 * backtracking regardless of input.
 *
 * The link's text and URL classes both exclude `[` and `]`: this is what keeps
 * the scan linear on adversarial input like `[[[[…` or `[x](` repeated. Without
 * it, an unterminated `[…` or `](…` would greedily scan to end and backtrack at
 * every one of the O(n) bracket positions — an O(n²) ReDoS lever. Excluding the
 * brackets makes each scan bail at the next one, so total work stays linear. It
 * costs only rare edge cases (a literal `[` in link text, a `[` in a URL, both
 * unusual) which simply fall back to plain text.
 *
 *   group 1 — code span body       `` `…` ``
 *   group 2 — link text            `[…]`
 *   group 3 — link URL             `(…)`
 *   group 4 — bold body            `**…**`
 */
const INLINE = /`([^`\n]*)`|\[([^[\]\n]*)\]\(([^)\s[\]]*)\)|\*\*([^\n]+?)\*\*/g;

/** A link target is allowed only if it is an absolute http(s) URL. */
const HTTP_URL = /^https?:\/\//i;

/**
 * Render the inline subset within one block's already-escaped text. Because the
 * input is escaped, every capture is inert: a link's text or URL cannot contain
 * a raw `"` or `>` (they are `&quot;` / `&gt;`), so nothing can break out of the
 * `href` attribute or the tag. A link whose URL is not http(s) — `javascript:`,
 * `data:`, `vbscript:`, a protocol-relative `//host`, a relative path — is not
 * emitted as a link at all; the (safe, escaped) original text is kept instead.
 * The generated `<a>` carries `rel="nofollow noopener ugc"`: nofollow/ugc so
 * author-supplied links do not lend ranking, noopener so the target cannot reach
 * back through `window.opener`.
 */
function renderInline(escaped: string): string {
  return escaped.replace(INLINE, (match, code, linkText, linkUrl, boldText) => {
    if (code !== undefined) return `<code>${code}</code>`;
    if (linkText !== undefined) {
      if (HTTP_URL.test(linkUrl)) {
        return `<a href="${linkUrl}" rel="nofollow noopener ugc">${linkText}</a>`;
      }
      return match; // scheme not allowed → fall back to the escaped literal text
    }
    if (boldText !== undefined) return `<strong>${boldText}</strong>`;
    return match;
  });
}

const HEADING_3 = /^###[ \t]+(.+)$/;
const HEADING_2 = /^##[ \t]+(.+)$/;
const LIST_ITEM = /^-[ \t]+(.+)$/;

/** True for a line that opens a heading or list block. */
function isBlockStart(line: string): boolean {
  return HEADING_2.test(line) || HEADING_3.test(line) || LIST_ITEM.test(line);
}

/** True for a line that is empty or only whitespace. */
function isBlank(line: string): boolean {
  return line.trim() === '';
}

/**
 * Turn an author's limited-markdown body into safe HTML.
 *
 * Order is mandatory: (1) normalise + bound the input; (2) HTML-escape the
 * *whole* thing; (3) only then recognise the block grammar (`##`/`###` headings,
 * `-` lists, blank-line-separated paragraphs) and inline grammar
 * (`**bold**`, `` `code` ``, `[text](url)` links) on the escaped text, emitting
 * a fixed whitelist of tags. No raw HTML from the input can ever survive step 2,
 * so the only tags in the result are the ones produced here. Deterministic: the
 * same input always yields the same output.
 */
export function renderArticleBody(markdown: string): string {
  if (!markdown) return '';

  const escaped = escapeHtml(normaliseInput(markdown));
  const lines = escaped.split('\n');
  const html: string[] = [];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? '';

    if (isBlank(line)) {
      i += 1;
      continue;
    }

    const h3 = HEADING_3.exec(line);
    if (h3) {
      html.push(`<h3>${renderInline((h3[1] ?? '').trim())}</h3>`);
      i += 1;
      continue;
    }

    const h2 = HEADING_2.exec(line);
    if (h2) {
      html.push(`<h2>${renderInline((h2[1] ?? '').trim())}</h2>`);
      i += 1;
      continue;
    }

    const firstItem = LIST_ITEM.exec(line);
    if (firstItem) {
      const items: string[] = [];
      let item: RegExpExecArray | null = firstItem;
      while (item) {
        items.push(`<li>${renderInline((item[1] ?? '').trim())}</li>`);
        i += 1;
        item = i < lines.length ? LIST_ITEM.exec(lines[i] ?? '') : null;
      }
      html.push(`<ul>${items.join('')}</ul>`);
      continue;
    }

    // Otherwise a paragraph: consecutive plain lines, soft-wrapped with spaces
    // (standard markdown), until a blank line or the start of another block.
    const paragraph: string[] = [];
    for (let cur = line; i < lines.length && !isBlank(cur) && !isBlockStart(cur); ) {
      paragraph.push(cur.trim());
      i += 1;
      cur = lines[i] ?? '';
    }
    html.push(`<p>${renderInline(paragraph.join(' '))}</p>`);
  }

  return html.join('\n');
}

/**
 * Reduce a markdown body to a short, tag-free plain-text excerpt for a meta
 * description (PUBKB-e). This is not an HTML output path: it strips markdown
 * markers and any tag-like `<…>` span, then removes every remaining `<`/`>` so
 * the result carries no angle bracket at all and cannot form a tag even if a
 * caller placed it carelessly. Whitespace is collapsed and the text is truncated
 * on a word boundary with an ellipsis. Entities are never decoded, so nested
 * encodings do not re-materialise into markup.
 */
export function renderPlainExcerpt(markdown: string, maxLength: number = DEFAULT_EXCERPT_LENGTH): string {
  if (!markdown) return '';

  const plain = normaliseInput(markdown)
    .replace(/<[^>]*>/g, ' ') // drop anything tag-shaped (defence in depth)
    .replace(/^[ \t]*#{1,6}[ \t]+/gm, '') // heading markers
    .replace(/^[ \t]*[-*][ \t]+/gm, '') // list markers
    .replace(/\[([^[\]\n]*)\]\(([^)\s[\]]*)\)/g, '$1') // link → its text (bracket-bounded, linear)
    .replace(/\*\*([^\n]+?)\*\*/g, '$1') // bold markers
    .replace(/`([^`\n]*)`/g, '$1') // code markers
    .replace(/[<>]/g, '') // any stray angle bracket → gone; output has no '<'
    .replace(/\s+/g, ' ')
    .trim();

  if (plain.length <= maxLength) return plain;

  const cut = plain.slice(0, maxLength);
  const lastSpace = cut.lastIndexOf(' ');
  const base = lastSpace > maxLength * 0.6 ? cut.slice(0, lastSpace) : cut;
  return `${base.trimEnd()}…`;
}
