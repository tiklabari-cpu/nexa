/**
 * A crawled page's knowledge (tm 312.2 · AI-17): its text, title, language,
 * canonical URL and links — from HTML a stranger wrote.
 *
 * The document is parsed by parse5 (the WHATWG tokenizer jsdom uses, already
 * the inbound-mail sanitiser's parser): a state machine, linear in its input,
 * with no regular expression for hostile markup to backtrack through. Its
 * tree builder is not linear in nesting depth, though, so markup nested past
 * {@link MARKUP_MAX_DEPTH} is refused by a linear scan before the parse. Both
 * walks over the tree are iterative, so depth costs a loop, not the stack.
 *
 * What is kept is what a visitor reads as the page's content:
 *
 *   - `<main>` if the page has one, else its only `<article>`, else `<body>`
 *     — and `<body>` after all when the chosen part says less;
 *   - without scripts, styles, `<nav>`, `<aside>`, forms, embedded media,
 *     hidden elements, cookie/consent banners, and the page's own
 *     `<header>`/`<footer>` (an article's header — its headline — stays);
 *   - with its structure, because the chunker splits on blank lines and an
 *     answer is only as good as the chunk it came from: headings as `# `/
 *     `## `/`### ` lines kept with the paragraph under them, list items as
 *     `- ` lines, table rows as `| a | b |` lines — a bonus table read cell by
 *     cell would say nothing about which number belongs to which bonus.
 *
 * A page whose text stays under {@link NEEDS_JS_TEXT_CHARS} while it carries
 * scripts (or an empty single-page-app mount point) is `needsJs`: its text is
 * drawn by JavaScript this crawler does not run (AI-17-S3).
 *
 * Links are read from the whole document — navigation included, that is how
 * a site links its pages — resolved against `<base href>`, and left for the
 * frontier to normalise and scope.
 */
import { html as parse5Html, parse, type DefaultTreeAdapterMap } from 'parse5';

type ChildNode = DefaultTreeAdapterMap['childNode'];
type Element = DefaultTreeAdapterMap['element'];

/** Under this many characters of text, a script-heavy page is `needs_js`. */
export const NEEDS_JS_TEXT_CHARS = 200;
/** Scripts that, with too little text, mark a page as drawn by JavaScript. */
export const NEEDS_JS_SCRIPTS = 3;
/** `knowledge_pages.title`'s ceiling. */
export const PAGE_TITLE_MAX_CHARS = 500;
/** Links read from one page at most. */
export const PAGE_MAX_LINKS = 5000;

export interface ExtractedPage {
  /** `<title>`, else the first `<h1>`; null when the page has neither. */
  title: string | null;
  /** `<html lang>`'s primary subtag (`tr` for `tr-TR`), or null. */
  lang: string | null;
  /** The page's content as structured text (see the module comment). */
  text: string;
  /** `<link rel="canonical">`, absolute, or null. */
  canonical: string | null;
  /** Every http(s) link on the page, absolute, in document order, once each. */
  links: string[];
  /** Too little text for its scripts: drawn by JavaScript (AI-17-S3). */
  needsJs: boolean;
  /** `<meta name="robots">` (or one naming this crawler): `noindex`, `nofollow`. */
  noindex: boolean;
  nofollow: boolean;
}

/** Elements whose content is never a page's text. */
const DROPPED = new Set([
  'script',
  'style',
  'noscript',
  'template',
  'iframe',
  'object',
  'embed',
  'canvas',
  'video',
  'audio',
  'picture',
  'map',
  'nav',
  'aside',
  'button',
  'select',
  'textarea',
  'input',
  'head',
  'title',
]);

/** Elements that start and end a block of text. */
const BLOCK = new Set([
  'address',
  'article',
  'blockquote',
  'center',
  'dd',
  'details',
  'dialog',
  'dir',
  'div',
  'dl',
  'dt',
  'fieldset',
  'figcaption',
  'figure',
  'footer',
  'header',
  'hgroup',
  'hr',
  'legend',
  'main',
  'menu',
  'p',
  'section',
  'summary',
]);

const HEADINGS: Record<string, string> = {
  h1: '# ',
  h2: '## ',
  h3: '### ',
  h4: '### ',
  h5: '### ',
  h6: '### ',
};

/** Ids a single-page app mounts into; empty, they mean the page is drawn by script. */
const APP_ROOTS = new Set(['root', 'app', '__next', '__nuxt', '___gatsby', 'svelte']);

/** Consent-management vendors' container ids and classes. */
const CONSENT_VENDORS = [
  'onetrust',
  'cookiebot',
  'cmpbox',
  'usercentrics',
  'didomi',
  'qc-cmp',
  'truste',
  'cookie-law-info',
  'cc-window',
  'cc-banner',
  'osano',
];
const CONSENT_SUBJECTS = ['cookie', 'consent', 'gdpr', 'kvkk', 'cerez', 'çerez'];
const CONSENT_SHAPES = [
  'banner',
  'bar',
  'notice',
  'popup',
  'modal',
  'dialog',
  'overlay',
  'message',
  'box',
];

/** Inside a `<form>`, these mean it wraps the page (ASP.NET WebForms does) rather than being one. */
const CONTENT_MARKERS = new Set(['main', 'article', 'h1', 'h2', 'h3', 'p', 'table']);

/** Whether elements break a cell's or heading's text where they sit. */
const SPACED = new Set([...BLOCK, 'caption', 'li', 'ol', 'pre', 'table', 'td', 'th', 'tr', 'ul']);

/**
 * Nesting past this depth is refused before parsing. The HTML tree builder
 * scans its stack of open elements on most start tags, so its cost is the
 * page's size times its depth — measured on parse5 7.3: 5 MB at depth 512,
 * 1.2 s; 20,000 elements nested, 4 s; 100,000, two minutes. Chrome's parser
 * stops nesting at 512 too; no real page comes near it.
 */
export const MARKUP_MAX_DEPTH = 512;

/** Why a page's markup could not be read: `markup_too_deep` (see {@link MARKUP_MAX_DEPTH}). */
export class PageExtractError extends Error {
  constructor(readonly code: 'markup_too_deep') {
    super(`page markup refused: ${code}`);
    this.name = 'PageExtractError';
  }
}

/**
 * The page's knowledge. Throws {@link PageExtractError} for markup nested past
 * {@link MARKUP_MAX_DEPTH} — a page status `error` with that code.
 */
export function extractPage(html: string, pageUrl: string | URL): ExtractedPage {
  if (markupTooDeep(html, MARKUP_MAX_DEPTH)) throw new PageExtractError('markup_too_deep');
  const document = parse(html);
  const survey = surveyDocument(document.childNodes);
  const base = resolveBase(survey.base, pageUrl);

  const chosen = survey.mains[0] ?? (survey.articles.length === 1 ? survey.articles[0]! : null);
  let text = chosen ? renderText(chosen, true) : '';
  if (survey.body && (!chosen || text.length < NEEDS_JS_TEXT_CHARS)) {
    const whole = renderText(survey.body, false);
    if (whole.length > text.length) text = whole;
  }

  const title =
    clip(survey.title) ?? (survey.firstH1 ? clip(collapse(textOf(survey.firstH1))) : null);
  const links: string[] = [];
  const seen = new Set<string>();
  for (const href of survey.links) {
    if (links.length >= PAGE_MAX_LINKS) break;
    const absolute = resolveHttp(href, base);
    if (absolute === null || seen.has(absolute)) continue;
    seen.add(absolute);
    links.push(absolute);
  }

  return {
    title,
    lang: primarySubtag(survey.lang),
    text,
    canonical: survey.canonical === null ? null : resolveHttp(survey.canonical, base),
    links,
    needsJs:
      text.length < NEEDS_JS_TEXT_CHARS &&
      (survey.scripts >= NEEDS_JS_SCRIPTS || survey.emptyAppRoot),
    noindex: survey.noindex,
    nofollow: survey.nofollow,
  };
}

/** Elements that hold nothing, so never deepen the tree. */
const VOID = new Set([
  'area',
  'base',
  'basefont',
  'bgsound',
  'br',
  'col',
  'embed',
  'frame',
  'hr',
  'image',
  'img',
  'input',
  'keygen',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]);

/** Elements the next one of their kind closes (`<li>…<li>`): a run of them stays shallow. */
const IMPLIED_END = new Set([
  'body',
  'caption',
  'colgroup',
  'dd',
  'dt',
  'head',
  'html',
  'li',
  'optgroup',
  'option',
  'p',
  'rb',
  'rp',
  'rt',
  'rtc',
  'tbody',
  'td',
  'tfoot',
  'th',
  'thead',
  'tr',
]);

/** Elements whose content is text up to their own end tag. */
const RAW_TEXT = new Set([
  'iframe',
  'noembed',
  'noframes',
  'noscript',
  'plaintext',
  'script',
  'style',
  'textarea',
  'title',
  'xmp',
]);

function isTagNameChar(code: number): boolean {
  return (
    (code >= 0x61 && code <= 0x7a) || // a-z (the text is lowercased)
    (code >= 0x30 && code <= 0x39) || // 0-9
    code === 0x2d || // -
    code === 0x3a || // :
    code === 0x5f || // _
    code === 0x2e // .
  );
}

/**
 * Whether the markup nests deeper than `limit`, judged by a scan the way the
 * tree builder would count it — closely enough: an end tag closes the
 * elements above its match, and is ignored when nothing open matches (so
 * `<div></span>` repeated still deepens); void elements, self-closed foreign
 * ones and elements an equal sibling closes do not count. Linear: every
 * element is pushed and popped at most once.
 */
function markupTooDeep(html: string, limit: number): boolean {
  const text = html.toLowerCase();
  const open: string[] = [];
  const counts = new Map<string, number>();
  let at = 0;
  for (;;) {
    const lt = text.indexOf('<', at);
    if (lt === -1) return false;
    const next = text.charCodeAt(lt + 1);
    if (next === 0x21 || next === 0x3f) {
      // `<!--…-->`, `<!DOCTYPE…>`, `<?…>`.
      const comment = text.startsWith('<!--', lt);
      const end = comment ? text.indexOf('-->', lt + 4) : text.indexOf('>', lt + 2);
      if (end === -1) return false;
      at = end + (comment ? 3 : 1);
      continue;
    }
    const closing = next === 0x2f;
    const nameStart = lt + (closing ? 2 : 1);
    const first = text.charCodeAt(nameStart);
    if (!(first >= 0x61 && first <= 0x7a)) {
      at = lt + 1; // A `<` that starts no tag is text.
      continue;
    }
    let nameEnd = nameStart + 1;
    while (nameEnd < text.length && isTagNameChar(text.charCodeAt(nameEnd))) nameEnd += 1;
    const name = text.slice(nameStart, nameEnd);
    const end = text.indexOf('>', nameEnd);
    if (end === -1) return false;
    at = end + 1;

    if (closing) {
      if ((counts.get(name) ?? 0) === 0) continue;
      for (;;) {
        const popped = open.pop()!;
        counts.set(popped, counts.get(popped)! - 1);
        if (popped === name) break;
      }
      continue;
    }
    if (RAW_TEXT.has(name)) {
      if (name === 'plaintext') return false;
      const close = text.indexOf(`</${name}`, at);
      if (close === -1) return false;
      at = close;
      continue;
    }
    if (VOID.has(name) || IMPLIED_END.has(name) || text.charCodeAt(end - 1) === 0x2f) continue;
    open.push(name);
    counts.set(name, (counts.get(name) ?? 0) + 1);
    if (open.length > limit) return true;
  }
}

interface Survey {
  lang: string | null;
  body: Element | null;
  title: string | null;
  firstH1: Element | null;
  base: string | null;
  canonical: string | null;
  noindex: boolean;
  nofollow: boolean;
  links: string[];
  scripts: number;
  mains: Element[];
  articles: Element[];
  emptyAppRoot: boolean;
}

function isElement(node: ChildNode): node is Element {
  return 'tagName' in node;
}

function attribute(element: Element, name: string): string | undefined {
  return element.attrs.find((entry) => entry.name === name)?.value;
}

/** One pass over the whole document for everything that is not the text. */
function surveyDocument(roots: readonly ChildNode[]): Survey {
  const survey: Survey = {
    lang: null,
    body: null,
    title: null,
    firstH1: null,
    base: null,
    canonical: null,
    noindex: false,
    nofollow: false,
    links: [],
    scripts: 0,
    mains: [],
    articles: [],
    emptyAppRoot: false,
  };
  const stack: ChildNode[] = [...roots].reverse();
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (!isElement(node) || node.namespaceURI !== parse5Html.NS.HTML) continue;
    const tag = node.tagName;
    switch (tag) {
      case 'html':
        survey.lang ??= attribute(node, 'lang') ?? null;
        break;
      case 'body':
        survey.body ??= node;
        break;
      case 'title':
        survey.title ??= collapse(textOf(node)) || null;
        break;
      case 'h1':
        survey.firstH1 ??= node;
        break;
      case 'base':
        survey.base ??= attribute(node, 'href') ?? null;
        break;
      case 'link': {
        const rel = (attribute(node, 'rel') ?? '').toLowerCase().split(/\s+/);
        const href = attribute(node, 'href');
        if (survey.canonical === null && href && rel.includes('canonical')) survey.canonical = href;
        break;
      }
      case 'meta':
        readMeta(node, survey);
        break;
      case 'a':
      case 'area': {
        const href = attribute(node, 'href');
        if (href !== undefined && survey.links.length < PAGE_MAX_LINKS * 2) survey.links.push(href);
        break;
      }
      case 'script':
        survey.scripts += 1;
        continue;
      case 'main':
        survey.mains.push(node);
        break;
      case 'article':
        survey.articles.push(node);
        break;
      case 'template':
        continue;
    }
    if (attribute(node, 'role') === 'main' && tag !== 'main') survey.mains.push(node);
    if (!survey.emptyAppRoot && isEmptyAppRoot(node)) survey.emptyAppRoot = true;
    for (let i = node.childNodes.length - 1; i >= 0; i -= 1) stack.push(node.childNodes[i]!);
  }
  return survey;
}

function readMeta(node: Element, survey: Survey): void {
  const name = (attribute(node, 'name') ?? '').toLowerCase();
  const content = (attribute(node, 'content') ?? '').toLowerCase();
  if (name === 'robots' || name === 'siyahtusbot') {
    const directives = content.split(/[\s,]+/);
    if (directives.includes('noindex') || directives.includes('none')) survey.noindex = true;
    if (directives.includes('nofollow') || directives.includes('none')) survey.nofollow = true;
  }
  if ((attribute(node, 'http-equiv') ?? '').toLowerCase() === 'refresh') {
    // `5; url=/elsewhere` — a redirect written into the page; followed like a link.
    const raw = attribute(node, 'content') ?? '';
    const at = raw.toLowerCase().indexOf('url=');
    if (at !== -1) {
      const target = raw
        .slice(at + 4)
        .trim()
        .replace(/^['"]|['"]$/g, '');
      if (target) survey.links.push(target);
    }
  }
}

function isEmptyAppRoot(node: Element): boolean {
  const id = attribute(node, 'id');
  if (!(node.tagName === 'app-root' || (id !== undefined && APP_ROOTS.has(id)))) return false;
  return node.childNodes.every(
    (child) => !isElement(child) && (!('value' in child) || child.value.trim() === ''),
  );
}

/** The text below an element, scripts and styles left out — for a title or a heading. */
function textOf(root: Element): string {
  let out = '';
  const stack: ChildNode[] = [...root.childNodes].reverse();
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (node.nodeName === '#text' && 'value' in node) {
      out += node.value;
      continue;
    }
    if (!isElement(node) || DROPPED.has(node.tagName)) continue;
    for (let i = node.childNodes.length - 1; i >= 0; i -= 1) stack.push(node.childNodes[i]!);
  }
  return out;
}

function collapse(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function clip(text: string | null): string | null {
  if (!text) return null;
  return text.length > PAGE_TITLE_MAX_CHARS ? text.slice(0, PAGE_TITLE_MAX_CHARS).trimEnd() : text;
}

function primarySubtag(lang: string | null): string | null {
  if (!lang) return null;
  const primary = lang.trim().split(/[-_]/, 1)[0]!.toLowerCase();
  return /^[a-z]{2,3}$/.test(primary) ? primary : null;
}

function resolveBase(base: string | null, pageUrl: string | URL): URL {
  const page = typeof pageUrl === 'string' ? new URL(pageUrl) : pageUrl;
  if (base === null) return page;
  try {
    const resolved = new URL(base, page);
    return resolved.protocol === 'http:' || resolved.protocol === 'https:' ? resolved : page;
  } catch {
    return page;
  }
}

function resolveHttp(href: string, base: URL): string | null {
  const trimmed = href.trim();
  if (trimmed === '' || trimmed.startsWith('#')) return null;
  try {
    const url = new URL(trimmed, base);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    url.hash = '';
    return url.href;
  } catch {
    return null;
  }
}

/** Whether an element is chrome around the content rather than content. */
function isDropped(element: Element, keepChrome: boolean): boolean {
  if (element.namespaceURI !== parse5Html.NS.HTML) return true;
  const tag = element.tagName;
  if (DROPPED.has(tag)) return true;
  // A search box or a sign-up form is chrome; a form around the whole page is not.
  if (tag === 'form') return !wrapsContent(element);
  const role = (attribute(element, 'role') ?? '').toLowerCase();
  if (role === 'navigation' || role === 'search' || role === 'complementary') return true;
  if (
    !keepChrome &&
    (tag === 'header' || tag === 'footer' || role === 'banner' || role === 'contentinfo')
  ) {
    return true;
  }
  // `hidden` and `aria-hidden` are not grounds: a FAQ's collapsed answers
  // are hidden until clicked, and they are the knowledge.
  return isConsentBanner(element);
}

/** Whether a `<form>` holds the page's content. Forms do not nest, so each is scanned once. */
function wrapsContent(form: Element): boolean {
  const stack: ChildNode[] = [...form.childNodes];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (!isElement(node)) continue;
    if (CONTENT_MARKERS.has(node.tagName)) return true;
    for (const child of node.childNodes) stack.push(child);
  }
  return false;
}

/**
 * A cookie/consent banner: a consent vendor's container, or an element whose
 * id or class names the subject (cookie, consent, KVKK…) and either a
 * banner's shape or both cookie and consent — so a "cookie policy" page's
 * own content is not mistaken for one.
 */
function isConsentBanner(element: Element): boolean {
  const names =
    `${attribute(element, 'id') ?? ''} ${attribute(element, 'class') ?? ''}`.toLowerCase();
  if (names.trim() === '') return false;
  if (CONSENT_VENDORS.some((vendor) => names.includes(vendor))) return true;
  if (!CONSENT_SUBJECTS.some((subject) => names.includes(subject))) return false;
  if (names.includes('cookie') && names.includes('consent')) return true;
  return CONSENT_SHAPES.some((shape) => names.includes(shape));
}

type SegmentKind = 'text' | 'heading' | 'item' | 'row';

interface Segment {
  kind: SegmentKind;
  text: string;
  /** The list or table a line belongs to; its lines stay together. */
  group: number;
}

interface ListItem {
  indent: string;
  /** Whether the item's `- ` has been written. */
  opened: boolean;
}

interface Table {
  group: number;
  rows: number;
  cells: string[] | null;
  headerRow: boolean;
}

type Step = { node: ChildNode; keepChrome: boolean } | { leave: () => void };

/**
 * The text of one subtree, structured (see the module comment). `keepChrome`:
 * the subtree is a `<main>`/`<article>`, whose own header and footer are
 * content.
 */
function renderText(root: Element, keepChrome: boolean): string {
  const segments: Segment[] = [];
  let current = '';
  let groups = 0;
  let listGroup = 0;
  let listDepth = 0;
  const items: ListItem[] = [];
  const tables: Table[] = [];
  let cellDepth = 0;

  const push = (kind: SegmentKind, text: string, group = 0): void => {
    if (text !== '') segments.push({ kind, text, group });
  };
  /** Ends the block being written: a paragraph, or the current list item's line. */
  const flush = (): void => {
    if (cellDepth > 0) {
      current += ' ';
      return;
    }
    const text = cleanLines(current);
    current = '';
    if (text === '') return;
    const item = items.at(-1);
    if (item) {
      push('item', `${item.opened ? `${item.indent}  ` : `${item.indent}- `}${text}`, listGroup);
      item.opened = true;
    } else {
      push('text', text);
    }
  };

  const stack: Step[] = [];
  const descend = (element: Element, chrome: boolean): void => {
    for (let i = element.childNodes.length - 1; i >= 0; i -= 1) {
      stack.push({ node: element.childNodes[i]!, keepChrome: chrome });
    }
  };
  descend(root, keepChrome);

  while (stack.length > 0) {
    const step = stack.pop()!;
    if ('leave' in step) {
      step.leave();
      continue;
    }
    const { node } = step;
    if (node.nodeName === '#text' && 'value' in node) {
      // `\s` takes the no-break space too: in stored text it is a space.
      current += node.value.replace(/\s+/g, ' ');
      continue;
    }
    if (!isElement(node) || isDropped(node, step.keepChrome)) continue;
    const tag = node.tagName;
    const chrome = step.keepChrome || tag === 'main' || tag === 'article';

    if (tag === 'br') {
      current += cellDepth > 0 ? ' ' : '\n';
      continue;
    }
    if (tag === 'pre' && cellDepth === 0) {
      flush();
      push('text', cleanPre(textOf(node)));
      continue;
    }

    const heading = HEADINGS[tag];
    if (heading !== undefined && cellDepth === 0) {
      flush();
      stack.push({
        leave: () => {
          const text = cleanLines(current).replace(/\n/g, ' ');
          current = '';
          push('heading', text === '' ? '' : `${heading}${text}`);
        },
      });
      descend(node, chrome);
      continue;
    }

    if ((tag === 'ul' || tag === 'ol') && cellDepth === 0) {
      flush();
      if (listDepth === 0) listGroup = ++groups;
      listDepth += 1;
      stack.push({
        leave: () => {
          flush();
          listDepth -= 1;
        },
      });
      descend(node, chrome);
      continue;
    }
    if (tag === 'li' && cellDepth === 0) {
      flush();
      items.push({ indent: '  '.repeat(Math.max(0, listDepth - 1)), opened: false });
      stack.push({
        leave: () => {
          flush();
          items.pop();
        },
      });
      descend(node, chrome);
      continue;
    }

    if (tag === 'table' && cellDepth === 0) {
      flush();
      tables.push({ group: ++groups, rows: 0, cells: null, headerRow: true });
      stack.push({
        leave: () => {
          flush();
          tables.pop();
        },
      });
      descend(node, chrome);
      continue;
    }
    const table = tables.at(-1);
    if (tag === 'tr' && table && cellDepth === 0) {
      flush();
      table.cells = [];
      table.headerRow = true;
      stack.push({
        leave: () => {
          const cells = table.cells ?? [];
          table.cells = null;
          if (cells.every((cell) => cell === '')) return;
          push('row', `| ${cells.join(' | ')} |`, table.group);
          if (table.rows === 0 && table.headerRow) {
            push('row', `| ${cells.map(() => '---').join(' | ')} |`, table.group);
          }
          table.rows += 1;
        },
      });
      descend(node, chrome);
      continue;
    }
    if ((tag === 'td' || tag === 'th') && table?.cells && cellDepth === 0) {
      current = '';
      cellDepth += 1;
      if (tag === 'td') table.headerRow = false;
      stack.push({
        leave: () => {
          cellDepth -= 1;
          table.cells?.push(current.replace(/\s+/g, ' ').trim().replace(/\|/g, '\\|'));
          current = '';
        },
      });
      descend(node, chrome);
      continue;
    }

    if ((BLOCK.has(tag) || tag === 'caption') && cellDepth === 0) {
      flush();
      stack.push({ leave: flush });
      descend(node, chrome);
      continue;
    }
    // Inside a cell, a block or a nested table's cell is a word break.
    if (SPACED.has(tag) || HEADINGS[tag] !== undefined) current += ' ';
    descend(node, chrome);
  }
  flush();
  return joinSegments(segments);
}

/** Lines of a block: whitespace runs to one space, each line trimmed, empty lines gone. */
function cleanLines(text: string): string {
  return text
    .split('\n')
    .map((line) => line.replace(/ {2,}/g, ' ').trim())
    .filter((line) => line !== '')
    .join('\n');
}

function cleanPre(text: string): string {
  const lines = text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trimEnd());
  while (lines.length > 0 && lines[0] === '') lines.shift();
  while (lines.length > 0 && lines.at(-1) === '') lines.pop();
  return lines.join('\n');
}

/**
 * Blocks joined by a blank line — the chunker's paragraph break — except a
 * heading, which stays on the line above its first block, and the lines of
 * one list or table, which stay together.
 */
function joinSegments(segments: readonly Segment[]): string {
  let out = '';
  let previous: Segment | null = null;
  for (const segment of segments) {
    if (previous !== null) {
      const together =
        previous.kind === 'heading' ||
        (segment.kind === previous.kind &&
          (segment.kind === 'item' || segment.kind === 'row') &&
          segment.group === previous.group);
      out += together ? '\n' : '\n\n';
    }
    out += segment.text;
    previous = segment;
  }
  return out;
}

/**
 * A fetched page's bytes as text: the byte-order mark first, then the
 * `Content-Type` charset, then a `<meta charset>` in the first 1024 bytes
 * (the HTML spec's prescan, simplified), else UTF-8. A charset Node cannot
 * decode falls back to UTF-8 — a Turkish site in `windows-1254` decodes as
 * one.
 */
export function decodeHtmlBytes(body: Uint8Array, contentType: string | null): string {
  if (body[0] === 0xef && body[1] === 0xbb && body[2] === 0xbf)
    return decode(body.subarray(3), 'utf-8');
  if (body[0] === 0xfe && body[1] === 0xff) return decode(body.subarray(2), 'utf-16be');
  if (body[0] === 0xff && body[1] === 0xfe) return decode(body.subarray(2), 'utf-16le');
  const declared = /charset\s*=\s*["']?([^"';\s]+)/i.exec(contentType ?? '')?.[1];
  if (declared) return decode(body, declared);
  const head = Buffer.from(body.subarray(0, 1024)).toString('latin1');
  const meta = /<meta[^>]{0,512}?charset\s*=\s*["']?\s*([A-Za-z0-9_:.-]{1,40})/i.exec(head)?.[1];
  return decode(body, meta ?? 'utf-8');
}

function decode(body: Uint8Array, label: string): string {
  try {
    return new TextDecoder(label.trim().toLowerCase()).decode(body);
  } catch {
    // A label Node does not know (RangeError): the page is read as UTF-8.
    return new TextDecoder('utf-8').decode(body);
  }
}
