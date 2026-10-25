/**
 * The HTML part of a received mail, made safe to keep (tm 357 · HD-02).
 *
 * A stranger's markup is the most hostile input this product takes in: a mail
 * is written by whoever chose to send it, and an HTML mail can carry a
 * script, an event handler, a form posting somewhere, a style sheet that
 * restyles the page around it, or an image that tells the sender the mail was
 * opened, by whom and when. Two layers stand between it and an agent:
 *
 *   1. **This allow list, at intake.** The mail is parsed by a real HTML5
 *      parser (parse5 — the tokenizer jsdom uses, so "what a browser would
 *      build" rather than what a regular expression guesses) and written back
 *      out by hand, element by element, keeping only the formatting tags and
 *      attributes listed below. Everything else is dropped with its content
 *      (`script`, `style`, `iframe`, `object`, `svg`, form controls…) or
 *      unwrapped to its text (any tag not listed). No `on*`, no `style`, no
 *      `class`/`id`; a link only to `http(s):` or `mailto:`; a remote image's
 *      address is parked in `data-src`, so it is never fetched — an inline
 *      `data:image/…` one is kept. The output is our own serialisation of a
 *      parsed tree, so it is well-formed and every text and attribute value
 *      is escaped.
 *   2. **The console's frame, at display** (`TicketThread`): an `<iframe>`
 *      with an empty `sandbox` (no script, no form, no navigation, an opaque
 *      origin) and a Content-Security-Policy that loads nothing.
 *
 * Either alone would stop a script; both are kept because each guards the
 * other's mistake. The walk is iterative, so a mail nested ten thousand
 * levels deep costs a loop rather than the stack.
 *
 * The text of an HTML-only mail comes from the same parse ({@link htmlToText}):
 * block elements break lines, a `<blockquote>` is `>`-quoted (so the reply
 * splitter recognises a quote the way it does in a plain-text mail), and
 * nothing the sanitiser drops — a script's source, a style sheet — is text.
 */
import { html as parse5Html, parse, type DefaultTreeAdapterMap } from 'parse5';

type ChildNode = DefaultTreeAdapterMap['childNode'];
type Element = DefaultTreeAdapterMap['element'];

/** Formatting tags kept, with their content. */
const KEPT = new Set([
  'a',
  'abbr',
  'address',
  'article',
  'b',
  'bdi',
  'bdo',
  'blockquote',
  'br',
  'caption',
  'center',
  'cite',
  'code',
  'col',
  'colgroup',
  'dd',
  'del',
  'dfn',
  'div',
  'dl',
  'dt',
  'em',
  'figcaption',
  'figure',
  'font',
  'footer',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'hr',
  'i',
  'img',
  'ins',
  'kbd',
  'li',
  'main',
  'mark',
  'ol',
  'p',
  'pre',
  'q',
  's',
  'samp',
  'section',
  'small',
  'span',
  'strike',
  'strong',
  'sub',
  'sup',
  'table',
  'tbody',
  'td',
  'tfoot',
  'th',
  'thead',
  'time',
  'tr',
  'tt',
  'u',
  'ul',
  'var',
  'wbr',
]);

/**
 * Dropped with everything inside them: active content, embedded documents,
 * form controls, metadata, and the foreign namespaces (SVG and MathML are where
 * parser-differential tricks live).
 */
const DROPPED = new Set([
  'applet',
  'audio',
  'base',
  'basefont',
  'button',
  'canvas',
  'datalist',
  'dialog',
  'embed',
  'frame',
  'frameset',
  'head',
  'iframe',
  'input',
  'keygen',
  'link',
  'map',
  'math',
  'menu',
  'meta',
  'meter',
  'noembed',
  'noframes',
  'noscript',
  'object',
  'optgroup',
  'option',
  'output',
  'param',
  'picture',
  'plaintext',
  'portal',
  'progress',
  'script',
  'select',
  'slot',
  'source',
  'style',
  'svg',
  'template',
  'textarea',
  'title',
  'track',
  'video',
  'xmp',
]);

/** No closing tag, no content. */
const VOID = new Set(['br', 'col', 'hr', 'img', 'wbr']);

/** Presentation attributes kept on any kept element. */
const ATTRIBUTES = new Set([
  'align',
  'alt',
  'bgcolor',
  'border',
  'cellpadding',
  'cellspacing',
  'color',
  'colspan',
  'dir',
  'face',
  'headers',
  'height',
  'lang',
  'rowspan',
  'scope',
  'size',
  'span',
  'start',
  'summary',
  'title',
  'type',
  'valign',
  'width',
]);

/** An attribute value longer than this is not presentation; it is dropped. */
const ATTRIBUTE_MAX = 2_000;

/** An inline image kept inline: base64 of one of the four image types. */
const INLINE_IMAGE = /^data:image\/(?:png|jpeg|gif|webp);base64,[a-z0-9+/=\s]+$/i;
const INLINE_IMAGE_MAX = 1_048_576;

/** C0, DEL and C1 controls and whitespace, which browsers strip from a URL's scheme. */
// eslint-disable-next-line no-control-regex
const URL_NOISE = /[\x00-\x20\x7f-\x9f]/g;

function escapeText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttribute(value: string): string {
  return escapeText(value).replace(/"/g, '&quot;');
}

function isElement(node: ChildNode): node is Element {
  return 'tagName' in node;
}

/** `href` if it is a web or mail link, otherwise null. */
function safeHref(raw: string): string | null {
  const value = raw.replace(URL_NOISE, '');
  return /^(?:https?:|mailto:)/i.test(value) && value.length <= ATTRIBUTE_MAX ? value : null;
}

/** The kept attributes of `node`, as `name="value"` pairs. */
function attributesOf(node: Element): string[] {
  const out: string[] = [];
  for (const attribute of node.attrs) {
    const name = attribute.name.toLowerCase();
    if (ATTRIBUTES.has(name) && attribute.value.length <= ATTRIBUTE_MAX) {
      out.push(`${name}="${escapeAttribute(attribute.value)}"`);
    }
  }

  if (node.tagName === 'a') {
    const href = node.attrs.find((a) => a.name.toLowerCase() === 'href');
    const safe = href ? safeHref(href.value) : null;
    if (safe) {
      out.push(`href="${escapeAttribute(safe)}"`);
      out.push('target="_blank"', 'rel="noopener noreferrer nofollow"');
    }
  }

  if (node.tagName === 'img') {
    const src = node.attrs.find((a) => a.name.toLowerCase() === 'src')?.value.trim() ?? '';
    if (src.length <= INLINE_IMAGE_MAX && INLINE_IMAGE.test(src)) {
      out.push(`src="${escapeAttribute(src.replace(/\s+/g, ''))}"`);
    } else {
      const remote = safeHref(src);
      // Parked, never fetched: a remote image in a mail is how a sender learns
      // the mail was read. `mailto:` is no image; only a web address is kept.
      if (remote && /^https?:/i.test(remote)) out.push(`data-src="${escapeAttribute(remote)}"`);
    }
  }
  return out;
}

type Step = { node: ChildNode } | { close: string };

/** The `<body>` of a parsed document — where every mail's content ends up. */
function bodyOf(html: string): ChildNode[] {
  const document = parse(html);
  const root = document.childNodes.find(
    (node): node is Element => isElement(node) && node.tagName === 'html',
  );
  const body = root?.childNodes.find(
    (node): node is Element => isElement(node) && node.tagName === 'body',
  );
  return body?.childNodes ?? [];
}

function pushChildren(stack: Step[], children: readonly ChildNode[]): void {
  for (let i = children.length - 1; i >= 0; i -= 1) stack.push({ node: children[i]! });
}

/**
 * The mail's HTML with only the allow list left (see the module comment).
 * Returns the empty string when nothing presentable remains.
 */
export function sanitizeInboundHtml(html: string): string {
  const out: string[] = [];
  const stack: Step[] = [];
  pushChildren(stack, bodyOf(html));

  while (stack.length > 0) {
    const step = stack.pop()!;
    if ('close' in step) {
      out.push(`</${step.close}>`);
      continue;
    }
    const node = step.node;
    if (node.nodeName === '#text' && 'value' in node) {
      out.push(escapeText(node.value));
      continue;
    }
    // Comments, doctypes: nothing of them survives.
    if (!isElement(node)) continue;
    // Anything outside the HTML namespace — an `<svg>` or `<math>` subtree.
    if (node.namespaceURI !== parse5Html.NS.HTML) continue;

    const tag = node.tagName;
    if (DROPPED.has(tag)) continue;
    if (!KEPT.has(tag)) {
      // Unknown or structural (`html`, `body`, `form`, `o:p`…): its text stays.
      pushChildren(stack, node.childNodes);
      continue;
    }

    const attributes = attributesOf(node);
    // An image with nowhere safe to come from is nothing to keep.
    if (
      tag === 'img' &&
      !attributes.some((a) => a.startsWith('src=') || a.startsWith('data-src='))
    ) {
      continue;
    }
    out.push(attributes.length > 0 ? `<${tag} ${attributes.join(' ')}>` : `<${tag}>`);
    if (VOID.has(tag)) continue;
    stack.push({ close: tag });
    pushChildren(stack, node.childNodes);
  }
  return out.join('').trim();
}

/** Elements that start and end a line of text. */
const BLOCK = new Set([
  'address',
  'article',
  'blockquote',
  'caption',
  'center',
  'dd',
  'div',
  'dl',
  'dt',
  'figcaption',
  'figure',
  'footer',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'hr',
  'li',
  'main',
  'ol',
  'p',
  'pre',
  'section',
  'table',
  'tbody',
  'tfoot',
  'thead',
  'tr',
  'ul',
]);

/** A paragraph's worth of space after these, not just a line break. */
const PARAGRAPH = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'table', 'blockquote']);

/** Lines of plain text, each remembering how deep in `<blockquote>`s it began. */
class TextLines {
  readonly #lines: Array<{ depth: number; text: string }> = [];
  #current = '';
  #currentDepth = 0;
  depth = 0;

  inline(text: string): void {
    if (this.#current === '') {
      this.#currentDepth = this.depth;
      text = text.replace(/^ +/, '');
    }
    this.#current += text;
  }

  /** End the line in progress, if any. */
  breakLine(): void {
    if (this.#current.trim() === '') {
      this.#current = '';
      return;
    }
    this.#lines.push({ depth: this.#currentDepth, text: this.#current.trimEnd() });
    this.#current = '';
  }

  /** End the line in progress and leave one blank line under it. */
  breakParagraph(): void {
    this.breakLine();
    const last = this.#lines.at(-1);
    if (last && last.text !== '') this.#lines.push({ depth: this.depth, text: '' });
  }

  /** A `<br>`: a line break even on an empty line. */
  hardBreak(): void {
    this.#lines.push({
      depth: this.#current === '' ? this.depth : this.#currentDepth,
      text: this.#current.trimEnd(),
    });
    this.#current = '';
  }

  toString(): string {
    this.breakLine();
    const out = this.#lines.map(({ depth, text }) =>
      depth > 0 ? `${'> '.repeat(depth)}${text}`.trimEnd() : text,
    );
    return out
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }
}

type TextStep =
  { node: ChildNode; pre: boolean } | { leave: 'block' | 'paragraph' | 'quote' | 'cell' };

/**
 * The text of an HTML mail, for a mail that sent no plain part. Whitespace is
 * collapsed as a browser would outside `<pre>`; list items get a dash; a
 * quoted block is `>`-quoted.
 */
export function htmlToText(html: string): string {
  const lines = new TextLines();
  const stack: TextStep[] = [];
  const push = (children: readonly ChildNode[], pre: boolean) => {
    for (let i = children.length - 1; i >= 0; i -= 1) stack.push({ node: children[i]!, pre });
  };
  push(bodyOf(html), false);

  while (stack.length > 0) {
    const step = stack.pop()!;
    if ('leave' in step) {
      if (step.leave === 'quote') {
        // The quote's last line ends inside it; the blank line under it is outside.
        lines.breakLine();
        lines.depth -= 1;
        lines.breakParagraph();
      } else if (step.leave === 'paragraph') lines.breakParagraph();
      else if (step.leave === 'cell') lines.inline(' ');
      else lines.breakLine();
      continue;
    }
    const { node, pre } = step;
    if (node.nodeName === '#text' && 'value' in node) {
      if (pre) {
        const parts = node.value.split('\n');
        parts.forEach((part, index) => {
          if (index > 0) lines.hardBreak();
          lines.inline(part);
        });
      } else {
        lines.inline(node.value.replace(/[ \t\n\f\r]+/g, ' '));
      }
      continue;
    }
    if (!isElement(node) || node.namespaceURI !== parse5Html.NS.HTML) continue;
    const tag = node.tagName;
    if (DROPPED.has(tag)) continue;

    if (tag === 'br') {
      lines.hardBreak();
      continue;
    }
    if (tag === 'img') {
      const alt = node.attrs.find((a) => a.name === 'alt')?.value.trim();
      if (alt) lines.inline(alt);
      continue;
    }
    if (tag === 'blockquote') {
      lines.breakParagraph();
      lines.depth += 1;
      stack.push({ leave: 'quote' });
    } else if (BLOCK.has(tag)) {
      lines.breakLine();
      stack.push({ leave: PARAGRAPH.has(tag) ? 'paragraph' : 'block' });
      if (tag === 'li') lines.inline('- ');
    } else if (tag === 'td' || tag === 'th') {
      stack.push({ leave: 'cell' });
    }
    push(node.childNodes, pre || tag === 'pre');
  }
  return lines.toString();
}
