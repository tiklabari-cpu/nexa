/**
 * The widget's "Help" tab (WG-12 · tm 348): the visitor searches the
 * workspace's published knowledge base articles and reads one, without opening
 * a chat — and is one click from a chat on every screen of it.
 *
 * A module of its own, loaded the first time the visitor opens the tab
 * (`import('./help')` in `widget.ts`), so a page whose visitors never open it
 * pays nothing for it: its words in eight languages, its stylesheet and the
 * article renderer all live here, outside the bundle every page loads
 * (`test/bundle-size.test.ts` holds both budgets).
 *
 * The article body is the KB's markdown subset (`##`/`###` headings, `- `
 * lists, `**bold**`, `` `code` ``, `[text](url)` links) and is drawn the way
 * `rich-text.ts` draws an agent's formatting: out of `createElement` and text
 * nodes, never `innerHTML`, so nothing an author wrote can become markup
 * (NFR-S6). The grammar is the server's (`apps/api/src/lib/kb-render.ts`, the
 * public KB page) so an article reads the same in both places; only an
 * absolute `http(s)` address becomes a link, opened in a new tab with
 * `rel="noopener noreferrer nofollow"`.
 */
import type { WidgetLocale } from './locales/index.js';

/**
 * The search's bounds, `KB_SEARCH_*` in `@siyahtus/types` (`help.test.ts` holds
 * them equal). Copied rather than imported: the types package's entry carries
 * top-level statements, and a second importer of it splits them into a shared
 * chunk that every page would then fetch alongside the widget.
 */
export const QUERY_MIN = 2;
export const QUERY_MAX = 200;
export const PAGE_SIZE = 10;

export interface HelpHit {
  slug: string;
  title: string;
  excerpt: string;
}

export interface HelpArticle {
  slug: string;
  title: string;
  body: string;
}

/** What the widget hands the tab: where to draw, how to ask, how to leave. */
export interface HelpHost {
  doc: Document;
  /** The open panel; the tab draws under its header and hides the rest. */
  panel: HTMLElement;
  locale: WidgetLocale;
  /** `GET` on the Customer API with the visitor's token. */
  get<T>(path: string): Promise<T>;
  /** "Start a chat": the widget closes the tab and opens the conversation. */
  chat(): void;
  /** Called once the tab has taken itself down. */
  closed(): void;
}

export interface HelpView {
  close(): void;
}

type HelpKey = 'title' | 'search' | 'hint' | 'empty' | 'error' | 'back' | 'chat';

/** The tab's words (K25: the widget's eight languages). */
const TEXT: Record<WidgetLocale, Record<HelpKey, string>> = {
  en: {
    title: 'Help',
    search: 'Search help articles',
    hint: 'Type a question or a keyword.',
    empty: 'No article matches. Start a chat and we will help you.',
    error: 'Search is not available right now. Start a chat instead.',
    back: 'Back to results',
    chat: 'Start a chat',
  },
  tr: {
    title: 'Yardım',
    search: 'Yardım makalelerinde ara',
    hint: 'Bir soru ya da anahtar kelime yazın.',
    empty: 'Eşleşen makale yok. Sohbet başlatın, yardımcı olalım.',
    error: 'Arama şu an kullanılamıyor. Bunun yerine sohbet başlatın.',
    back: 'Sonuçlara dön',
    chat: 'Sohbet başlat',
  },
  de: {
    title: 'Hilfe',
    search: 'Hilfeartikel durchsuchen',
    hint: 'Geben Sie eine Frage oder ein Stichwort ein.',
    empty: 'Kein Artikel passt. Starten Sie einen Chat, wir helfen Ihnen.',
    error: 'Die Suche ist gerade nicht verfügbar. Starten Sie stattdessen einen Chat.',
    back: 'Zurück zu den Ergebnissen',
    chat: 'Chat starten',
  },
  fr: {
    title: 'Aide',
    search: "Rechercher dans les articles d'aide",
    hint: 'Saisissez une question ou un mot-clé.',
    empty: 'Aucun article ne correspond. Démarrez une conversation, nous vous aiderons.',
    error: 'La recherche est indisponible pour le moment. Démarrez plutôt une conversation.',
    back: 'Retour aux résultats',
    chat: 'Démarrer une conversation',
  },
  es: {
    title: 'Ayuda',
    search: 'Buscar en los artículos de ayuda',
    hint: 'Escriba una pregunta o una palabra clave.',
    empty: 'Ningún artículo coincide. Inicie un chat y le ayudaremos.',
    error: 'La búsqueda no está disponible ahora. Inicie un chat.',
    back: 'Volver a los resultados',
    chat: 'Iniciar un chat',
  },
  it: {
    title: 'Aiuto',
    search: 'Cerca negli articoli di aiuto',
    hint: 'Scrivi una domanda o una parola chiave.',
    empty: 'Nessun articolo corrisponde. Avvia una chat e ti aiuteremo.',
    error: 'La ricerca non è disponibile ora. Avvia invece una chat.',
    back: 'Torna ai risultati',
    chat: 'Avvia una chat',
  },
  pt: {
    title: 'Ajuda',
    search: 'Pesquisar nos artigos de ajuda',
    hint: 'Escreva uma pergunta ou uma palavra-chave.',
    empty: 'Nenhum artigo corresponde. Inicie um chat e vamos ajudar.',
    error: 'A pesquisa não está disponível agora. Inicie um chat.',
    back: 'Voltar aos resultados',
    chat: 'Iniciar um chat',
  },
  ar: {
    title: 'المساعدة',
    search: 'ابحث في مقالات المساعدة',
    hint: 'اكتب سؤالاً أو كلمة مفتاحية.',
    empty: 'لا توجد مقالة مطابقة. ابدأ محادثة وسنساعدك.',
    error: 'البحث غير متاح الآن. ابدأ محادثة بدلاً من ذلك.',
    back: 'العودة إلى النتائج',
    chat: 'ابدأ محادثة',
  },
};

/** The tab's own words for `locale`, English for anything else. */
export function helpText(locale: string): Record<HelpKey, string> {
  return TEXT[locale as WidgetLocale] ?? TEXT.en;
}

/** How long typing pauses before a search goes out — one request per pause, not per key. */
export const SEARCH_DELAY_MS = 300;

const STYLE_ID = 'nx-help-style';
const HELP_CSS = `
.nx-help-on>:not(.nx-header):not(.nx-help){display:none!important}
.nx-help{flex:1;min-height:0;display:flex;flex-direction:column;gap:12px;padding:16px;overflow-y:auto}
.nx-help-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px}
.nx-help-hit{display:block;width:100%;padding:12px 14px;border:1px solid var(--nx-border);border-radius:12px;background:var(--nx-surface);color:var(--nx-text);font:inherit;text-align:start;cursor:pointer}
.nx-help-hit:hover,.nx-help-hit:focus-visible{border-color:var(--nx-brand)}
.nx-help-hit strong{display:block;margin-bottom:4px;color:var(--nx-title)}
.nx-help-hit span,.nx-help-note{color:var(--nx-muted);font-size:13px}
.nx-help-note{margin:0}
.nx-help-back{align-self:flex-start;padding:4px 0;border:0;background:none;color:var(--nx-link);font:inherit;cursor:pointer}
.nx-help-article{display:flex;flex-direction:column;gap:8px;color:var(--nx-text);line-height:1.5}
.nx-help-article h2{margin:0;font-size:18px;color:var(--nx-title)}
.nx-help-article h3,.nx-help-article h4{margin:8px 0 0;font-size:15px}
.nx-help-article p,.nx-help-article ul{margin:0}
.nx-help-article a{color:var(--nx-link)}
.nx-help-article code{padding:0 4px;border-radius:4px;background:var(--nx-surface-2);font-size:.92em}
.nx-help .nx-human{flex:none;margin-top:auto}
.nx-help-btn[aria-pressed="true"]{background:rgba(255,255,255,.14)}
`;

/** Same grammar as the server's renderer: code span, then link, then bold. */
const INLINE = /`([^`\n]*)`|\[([^[\]\n]*)\]\(([^)\s[\]]*)\)|\*\*([^\n]+?)\*\*/g;
const HTTP_URL = /^https?:\/\//i;
const HEADING_3 = /^###[ \t]+(.+)$/;
const HEADING_2 = /^##[ \t]+(.+)$/;
const LIST_ITEM = /^-[ \t]+(.+)$/;

function isBlockStart(line: string): boolean {
  return HEADING_2.test(line) || HEADING_3.test(line) || LIST_ITEM.test(line);
}

/** Appends one block's inline subset to `target`, as elements and text nodes only. */
function appendInline(doc: Document, target: Node, text: string): void {
  let last = 0;
  for (const match of text.matchAll(INLINE)) {
    const at = match.index ?? 0;
    if (at > last) target.appendChild(doc.createTextNode(text.slice(last, at)));
    last = at + match[0].length;
    const [whole, code, linkText, linkUrl, bold] = match;
    if (code !== undefined) {
      const el = doc.createElement('code');
      el.textContent = code;
      target.appendChild(el);
    } else if (linkText !== undefined && linkUrl !== undefined && HTTP_URL.test(linkUrl)) {
      const a = doc.createElement('a');
      a.href = linkUrl;
      a.target = '_blank';
      a.rel = 'noopener noreferrer nofollow';
      a.textContent = linkText;
      target.appendChild(a);
    } else if (bold !== undefined) {
      const el = doc.createElement('strong');
      el.textContent = bold;
      target.appendChild(el);
    } else {
      // A link to anything but http(s) stays the words the author wrote.
      target.appendChild(doc.createTextNode(whole));
    }
  }
  if (last < text.length) target.appendChild(doc.createTextNode(text.slice(last)));
}

/**
 * The article body as DOM. Headings sit one level under the article's own
 * `h2` (the panel's title is the `h1`), so `##` is an `h3` and `###` an `h4`.
 */
export function renderArticleBody(doc: Document, body: string): DocumentFragment {
  const out = doc.createDocumentFragment();
  const lines = body.replace(/\r\n?/g, '\n').split('\n');
  const blank = (line: string) => line.trim() === '';
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? '';
    if (blank(line)) {
      i += 1;
      continue;
    }
    const heading = HEADING_3.exec(line) ?? HEADING_2.exec(line);
    if (heading) {
      const el = doc.createElement(line.startsWith('###') ? 'h4' : 'h3');
      appendInline(doc, el, (heading[1] ?? '').trim());
      out.appendChild(el);
      i += 1;
      continue;
    }
    if (LIST_ITEM.test(line)) {
      const list = doc.createElement('ul');
      for (let item = LIST_ITEM.exec(line); item; item = LIST_ITEM.exec(lines[i] ?? '')) {
        const li = doc.createElement('li');
        appendInline(doc, li, (item[1] ?? '').trim());
        list.appendChild(li);
        i += 1;
      }
      out.appendChild(list);
      continue;
    }
    const words: string[] = [];
    while (i < lines.length && !blank(lines[i] ?? '') && !isBlockStart(lines[i] ?? '')) {
      words.push((lines[i] ?? '').trim());
      i += 1;
    }
    const p = doc.createElement('p');
    appendInline(doc, p, words.join(' '));
    out.appendChild(p);
  }
  return out;
}

/** Draws the tab into the open panel and returns the handle that takes it down. */
export function openHelp(host: HelpHost): HelpView {
  const { doc, panel } = host;
  const text = helpText(host.locale);

  if (!doc.getElementById(STYLE_ID)) {
    const style = doc.createElement('style');
    style.id = STYLE_ID;
    style.textContent = HELP_CSS;
    doc.head.append(style);
  }

  const root = doc.createElement('section');
  root.className = 'nx-help';
  root.setAttribute('aria-label', text.title);

  const form = doc.createElement('form');
  form.setAttribute('role', 'search');
  const input = doc.createElement('input');
  input.type = 'search';
  input.className = 'nx-prechat-input';
  input.maxLength = QUERY_MAX;
  input.placeholder = text.search;
  input.setAttribute('aria-label', text.search);
  input.autocomplete = 'off';
  form.append(input);

  const note = doc.createElement('p');
  note.className = 'nx-help-note';
  note.setAttribute('role', 'status');
  note.textContent = text.hint;

  const list = doc.createElement('ul');
  list.className = 'nx-help-list';

  const article = doc.createElement('article');
  article.className = 'nx-help-article';
  article.hidden = true;

  const chat = doc.createElement('button');
  chat.type = 'button';
  chat.className = 'nx-human';
  chat.textContent = text.chat;
  chat.addEventListener('click', () => host.chat());

  root.append(form, note, list, article, chat);
  const header = panel.querySelector('.nx-header');
  if (header) header.after(root);
  else panel.prepend(root);
  panel.classList.add('nx-help-on');

  // Answers can come back out of order; only the newest question's is drawn.
  let asked = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  function showList(): void {
    article.hidden = true;
    article.replaceChildren();
    form.hidden = false;
    note.hidden = false;
    list.hidden = false;
  }

  async function search(): Promise<void> {
    if (timer) clearTimeout(timer);
    timer = null;
    const q = input.value.trim();
    const ticket = ++asked;
    showList();
    if (q.length < QUERY_MIN) {
      list.replaceChildren();
      note.textContent = text.hint;
      return;
    }
    let hits: HelpHit[];
    try {
      const params = new URLSearchParams({
        q,
        locale: host.locale,
        limit: String(PAGE_SIZE),
      });
      hits = (await host.get<{ items: HelpHit[] }>(`/customer/kb/search?${params}`)).items;
    } catch {
      if (ticket === asked) {
        list.replaceChildren();
        note.textContent = text.error;
      }
      return;
    }
    if (ticket !== asked) return;
    note.textContent = hits.length === 0 ? text.empty : '';
    list.replaceChildren(
      ...hits.map((hit) => {
        const li = doc.createElement('li');
        const button = doc.createElement('button');
        button.type = 'button';
        button.className = 'nx-help-hit';
        const title = doc.createElement('strong');
        title.textContent = hit.title;
        const excerpt = doc.createElement('span');
        excerpt.textContent = hit.excerpt;
        button.append(title, excerpt);
        button.addEventListener('click', () => void read(hit.slug));
        li.append(button);
        return li;
      }),
    );
  }

  async function read(slug: string): Promise<void> {
    const ticket = ++asked;
    let item: HelpArticle;
    try {
      item = await host.get<HelpArticle>(`/customer/kb/articles/${encodeURIComponent(slug)}`);
    } catch {
      if (ticket === asked) note.textContent = text.error;
      return;
    }
    if (ticket !== asked) return;
    const back = doc.createElement('button');
    back.type = 'button';
    back.className = 'nx-help-back';
    back.textContent = text.back;
    back.addEventListener('click', () => {
      asked += 1;
      showList();
      input.focus();
    });
    const title = doc.createElement('h2');
    title.tabIndex = -1;
    title.textContent = item.title;
    article.replaceChildren(back, title, renderArticleBody(doc, item.body));
    form.hidden = true;
    note.hidden = true;
    list.hidden = true;
    article.hidden = false;
    title.focus();
  }

  input.addEventListener('input', () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void search(), SEARCH_DELAY_MS);
  });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void search();
  });
  input.focus();

  return {
    close() {
      if (timer) clearTimeout(timer);
      asked += 1;
      root.remove();
      panel.classList.remove('nx-help-on');
      host.closed();
    },
  };
}
