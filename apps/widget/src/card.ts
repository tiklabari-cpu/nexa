/**
 * A rich card in the widget (EN-02 · tm 353): a campaign's card in the
 * proactive slot, and a `rich_message` in the transcript.
 *
 * A chunk of its own, fetched the first time a card is drawn (`lazy-chunks.ts`),
 * so every page that never sees one pays nothing: its stylesheet and its words
 * in eight languages live here. It imports nothing but types — a value from the
 * shared barrel would become a chunk both halves load. Until it arrives the
 * widget shows the card's plain text, which is also what it falls back to if
 * the chunk cannot load.
 *
 * Drawn out of `createElement` and text nodes, never `innerHTML` (NFR-S6). The
 * buttons:
 *   - `send_message` — handed to the widget (`host.press`), which sends the
 *     label as the player's message with the postback, opening the panel first.
 *   - `open_url` — a link in a new tab, `noopener noreferrer`; only `https:`
 *     becomes one, whatever the server let through.
 *   - `copy_coupon` — the Clipboard API (the loader's frame allows
 *     `clipboard-write`), then "Copied" in a status line. Where the browser
 *     refuses, the code appears in a selected read-only box to copy by hand.
 * A campaign's link and coupon presses are counted
 * (`POST /customer/campaigns/{id}/clicked`); its message button counts through
 * the message itself.
 */
import type { RichCard } from '@siyahtus/types';

/** Which card a press was on: a campaign's, or a `rich_message` in the conversation. */
export interface CardSource {
  campaign_id?: string;
  event_id?: string;
}

export interface CardHost {
  locale: string;
  api: {
    post(path: string, body?: unknown): Promise<void>;
    fetchAttachment(url: string): Promise<Blob>;
  };
  /** A `send_message` button: say `label` as the player, with this postback. */
  press(label: string, postback: CardSource & { button: number }): void;
}

type CardKey = 'copied' | 'manual';

/** The card's words (K25: the widget's eight languages). */
const TEXT: Record<string, Record<CardKey, string>> = {
  en: { copied: 'Code copied: ', manual: 'Select the code and copy it:' },
  tr: { copied: 'Kod kopyalandı: ', manual: 'Kodu seçip kopyalayın:' },
  de: { copied: 'Code kopiert: ', manual: 'Markieren und kopieren Sie den Code:' },
  fr: { copied: 'Code copié : ', manual: 'Sélectionnez le code et copiez-le :' },
  es: { copied: 'Código copiado: ', manual: 'Seleccione el código y cópielo:' },
  it: { copied: 'Codice copiato: ', manual: 'Seleziona il codice e copialo:' },
  pt: { copied: 'Código copiado: ', manual: 'Selecione o código e copie-o:' },
  ar: { copied: 'تم نسخ الرمز: ', manual: 'حدد الرمز وانسخه:' },
};

/** The card's own words for `locale`, English for anything else. */
export function cardText(locale: string): Record<CardKey, string> {
  return TEXT[locale] ?? TEXT['en']!;
}

const STYLE_ID = 'nx-card-style';
const CARD_CSS = `
.nx-card{display:flex;flex-direction:column;gap:6px;min-width:0}
.nx-card-img{display:block;width:100%;max-height:160px;object-fit:cover;border-radius:8px}
.nx-card-title{margin:0;font-weight:700}
.nx-card-body{margin:0;white-space:pre-wrap;overflow-wrap:anywhere}
.nx-card-btns{display:flex;flex-direction:column;gap:6px;margin-top:2px}
.nx-card-btn{display:block;box-sizing:border-box;width:100%;padding:8px 10px;border:1px solid var(--nx-brand);border-radius:8px;background:transparent;color:inherit;font:inherit;font-weight:600;text-align:center;text-decoration:none;cursor:pointer}
.nx-card-btn[data-style="primary"]{background:var(--nx-brand);color:var(--nx-brand-text,#fff)}
.nx-card-btn:focus-visible{outline:2px solid var(--nx-brand);outline-offset:2px}
.nx-card-note{margin:0;font-size:12px}
.nx-card-code{width:100%;box-sizing:border-box;padding:6px 8px;font:inherit;font-family:monospace}
`;

/** A campaign's link or coupon press, counted; nothing for a card in a conversation. */
function counted(host: CardHost, source: CardSource, button: number): void {
  if (!source.campaign_id) return;
  const id = encodeURIComponent(source.campaign_id);
  void host.api.post(`/customer/campaigns/${id}/clicked`, { button }).catch(() => undefined);
}

/**
 * One element per card (and widget), so a slot redrawn on every poll keeps its
 * image and its "Copied" line.
 */
const drawn = new WeakMap<RichCard, { press: CardHost['press']; root: HTMLElement }>();

/** Draw `card` — the same element again for the same card. The caller puts it where the plain text was. */
export function cardElement(
  doc: Document,
  card: RichCard,
  source: CardSource,
  host: CardHost,
): HTMLElement {
  const known = drawn.get(card);
  if (known?.press === host.press) return known.root;
  if (!doc.getElementById(STYLE_ID)) {
    const style = doc.createElement('style');
    style.id = STYLE_ID;
    style.textContent = CARD_CSS;
    doc.head.append(style);
  }
  const text = cardText(host.locale);
  const element = <K extends keyof HTMLElementTagNameMap>(
    tag: K,
    className: string,
    content?: string,
  ): HTMLElementTagNameMap[K] => {
    const node = doc.createElement(tag);
    node.className = className;
    if (content !== undefined) node.textContent = content;
    return node;
  };

  const root = element('div', 'nx-card');
  if (card.image) {
    const img = element('img', 'nx-card-img');
    img.alt = card.image.alt;
    if (card.image.url.startsWith('https://')) {
      img.src = card.image.url;
    } else {
      // This workspace's upload: fetched with the visitor's token, like an attachment.
      host.api
        .fetchAttachment(card.image.url)
        .then((blob) => {
          img.src = URL.createObjectURL(blob);
        })
        .catch(() => img.remove());
    }
    root.append(img);
  }
  if (card.title) root.append(element('p', 'nx-card-title', card.title));
  root.append(element('p', 'nx-card-body', card.body));

  const note = element('p', 'nx-card-note');
  note.setAttribute('role', 'status');
  const buttons = element('div', 'nx-card-btns');
  card.buttons.forEach((button, index) => {
    const action = button.action;
    let control: HTMLElement;
    if (action.type === 'open_url') {
      if (!action.url.startsWith('https://')) return;
      const link = element('a', 'nx-card-btn', button.label);
      link.href = action.url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.addEventListener('click', () => counted(host, source, index));
      control = link;
    } else {
      const press = element('button', 'nx-card-btn', button.label);
      press.type = 'button';
      press.addEventListener('click', () => {
        if (action.type === 'send_message') {
          host.press(button.label, { ...source, button: index });
          return;
        }
        if (action.type !== 'copy_coupon') return;
        counted(host, source, index);
        const shown = (): void => {
          note.textContent = text.copied + action.code;
        };
        const manual = (): void => {
          // The browser would not let the page write the clipboard (an iframe
          // without the permission, an old browser): the code, selected, to
          // copy by hand.
          const field = element('input', 'nx-card-code');
          field.readOnly = true;
          field.value = action.code;
          field.setAttribute('aria-label', text.manual);
          note.replaceChildren(text.manual, field);
          field.select();
        };
        const clipboard = doc.defaultView?.navigator.clipboard;
        if (clipboard) void clipboard.writeText(action.code).then(shown, manual);
        else manual();
      });
      control = press;
    }
    control.dataset['style'] = button.style;
    buttons.append(control);
  });
  if (buttons.childElementCount > 0) root.append(buttons, note);
  drawn.set(card, { press: host.press, root });
  return root;
}
