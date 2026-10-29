/**
 * Widget texts a brand may rewrite, per language (tm 344 · WG-05).
 *
 * The widget ships its own strings for eight languages
 * (`apps/widget/src/locales/<lang>.ts`); a brand may replace a few of them in
 * its own voice — the offline notice, the queue line, the message box
 * placeholder and the rest of {@link WIDGET_PHRASE_KEYS}. Only these keys: the
 * list is closed, so a rewrite can never reach a string the widget does not
 * expect to vary (an error, an accessibility label), and every key carries a
 * length limit and the placeholders it may use. A text is plain — the widget
 * writes it with `textContent` anyway, but markup in the panel would be a
 * promise the widget does not keep.
 *
 * The visitor reads, for each key: the brand's text in the widget's language →
 * the widget's own text in that language → English → the key
 * (`apps/widget/src/i18n.ts` `createTranslator`). {@link WIDGET_PHRASE_DEFAULTS}
 * is a copy of the widget's own texts for these keys, held equal to the
 * catalogs by `apps/widget/src/locales/locales.test.ts`, so the panel can show
 * the default beside the field without importing the widget.
 *
 * Everything at the top level is a literal (no calls): the widget bundle
 * imports this module through the barrel, and only pure modules are dropped
 * from it when unused.
 */
import type { WidgetUiLocale } from './widget.js';

/** What a text may interpolate: the queue position and the estimated wait. */
export type WidgetPhrasePlaceholder = 'n' | 'minutes';

export interface WidgetPhraseRule {
  /** The longest text accepted, in characters (code points). */
  readonly max: number;
  readonly placeholders: readonly WidgetPhrasePlaceholder[];
}

/**
 * The closed list, in the order the panel shows them. `status.queueWait` is
 * the queue line while an estimate exists (`GET /customer/chat`
 * `chat.estimated_wait`); `status.queue` is the line without one, so it may
 * not name `{minutes}`.
 */
export const WIDGET_PHRASE_KEYS = [
  'title.default',
  'status.offline',
  'status.queue',
  'status.queueWait',
  'input.placeholder',
  'human.connecting',
  'prechat.intro',
  'prechat.submit',
  'offline.label',
  'offline.intro',
  'offline.subject',
  'offline.submit',
  'offline.thanks',
  'chat.end.closedMessage',
] as const;

export type WidgetPhraseKey = (typeof WIDGET_PHRASE_KEYS)[number];

export const WIDGET_PHRASE_RULES: Readonly<Record<WidgetPhraseKey, WidgetPhraseRule>> = {
  'title.default': { max: 60, placeholders: [] },
  'status.offline': { max: 200, placeholders: [] },
  'status.queue': { max: 120, placeholders: ['n'] },
  'status.queueWait': { max: 160, placeholders: ['n', 'minutes'] },
  'input.placeholder': { max: 80, placeholders: [] },
  'human.connecting': { max: 80, placeholders: [] },
  'prechat.intro': { max: 200, placeholders: [] },
  'prechat.submit': { max: 40, placeholders: [] },
  'offline.label': { max: 60, placeholders: [] },
  'offline.intro': { max: 300, placeholders: [] },
  'offline.subject': { max: 120, placeholders: [] },
  'offline.submit': { max: 40, placeholders: [] },
  'offline.thanks': { max: 300, placeholders: [] },
  'chat.end.closedMessage': { max: 160, placeholders: [] },
};

/** Why a text was refused — the `details.problem` of the 400. */
export type WidgetPhraseProblem =
  'unknown_key' | 'empty' | 'too_long' | 'markup' | 'line_break' | 'unknown_placeholder';

export function isWidgetPhraseKey(value: unknown): value is WidgetPhraseKey {
  return typeof value === 'string' && (WIDGET_PHRASE_KEYS as readonly string[]).includes(value);
}

/**
 * Why `text` may not stand for `key`, or null when it may. `text` is judged as
 * given; callers trim first ({@link checkWidgetPhrases} does).
 */
export function widgetPhraseProblem(key: string, text: string): WidgetPhraseProblem | null {
  if (!isWidgetPhraseKey(key)) return 'unknown_key';
  if (text.trim() === '') return 'empty';
  const rule = WIDGET_PHRASE_RULES[key];
  if ([...text].length > rule.max) return 'too_long';
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f\u2028\u2029]/.test(text)) return 'line_break';
  // A tag opens straight after `<`; "a < b" is prose.
  if (/<[a-z!/?]/i.test(text)) return 'markup';
  for (const match of text.matchAll(/\{([^{}]*)\}/g)) {
    if (!(rule.placeholders as readonly string[]).includes(match[1] ?? '')) {
      return 'unknown_placeholder';
    }
  }
  return null;
}

export type CheckedWidgetPhrases =
  | { ok: true; phrases: Partial<Record<WidgetPhraseKey, string>> }
  | { ok: false; key: string; problem: WidgetPhraseProblem };

/**
 * A whole language's texts, trimmed and checked; the first refusal wins, so
 * the panel can point at the field. Not an object, or a value that is not a
 * string, is the caller's 400 before this runs.
 */
export function checkWidgetPhrases(input: Readonly<Record<string, string>>): CheckedWidgetPhrases {
  const phrases: Partial<Record<WidgetPhraseKey, string>> = {};
  for (const [key, raw] of Object.entries(input)) {
    const text = raw.trim();
    const problem = widgetPhraseProblem(key, text);
    if (problem) return { ok: false, key, problem };
    phrases[key as WidgetPhraseKey] = text;
  }
  return { ok: true, phrases };
}

/**
 * Only the listed keys of a stored map — what the mint hands the widget. A key
 * dropped from the list later must not keep reaching visitors from old rows.
 */
export function pickWidgetPhrases(
  rows: ReadonlyArray<{ key: string; text: string }>,
): Partial<Record<WidgetPhraseKey, string>> {
  const phrases: Partial<Record<WidgetPhraseKey, string>> = {};
  for (const row of rows) {
    if (isWidgetPhraseKey(row.key)) phrases[row.key] = row.text;
  }
  return phrases;
}

/** What `pickWidgetUiLocale` chooses from (WG-02). */
export interface WidgetLocaleSources {
  /** A `language` the embedding page wrote into its install snippet. */
  snippet?: string | null;
  /** The panel's language (`auto` or one of the eight). */
  panel?: string | null;
  /** The panel's fallback for `auto`. */
  fallback?: string | null;
  /** `navigator.languages`, most preferred first. */
  browser?: readonly string[];
}

const UI_LOCALES: readonly WidgetUiLocale[] = ['en', 'tr', 'de', 'fr', 'es', 'it', 'pt', 'ar'];

/** A BCP-47 tag's primary subtag, when it is one of the eight. */
function uiLocaleOf(tag: string | null | undefined): WidgetUiLocale | null {
  const primary = (tag ?? '').toLowerCase().split(/[-_]/)[0];
  return UI_LOCALES.includes(primary as WidgetUiLocale) ? (primary as WidgetUiLocale) : null;
}

/**
 * Which language the widget shows (WG-02): the snippet's language, else the
 * panel's unless `auto`, else the first of the browser's languages it ships,
 * else the panel's fallback, else English. One definition for both ends: the
 * widget draws in it, and the token mint picks the same language's custom
 * texts (WG-05) without a second round-trip.
 */
export function pickWidgetUiLocale(sources: WidgetLocaleSources): WidgetUiLocale {
  const fromSnippet = uiLocaleOf(sources.snippet);
  if (fromSnippet) return fromSnippet;
  if (sources.panel && sources.panel !== 'auto') {
    const pinned = uiLocaleOf(sources.panel);
    if (pinned) return pinned;
  }
  for (const tag of sources.browser ?? []) {
    const match = uiLocaleOf(tag);
    if (match) return match;
  }
  return uiLocaleOf(sources.fallback) ?? 'en';
}

/**
 * The widget's own texts for the listed keys, per language — a copy of the
 * catalogs (see the module comment), for the panel's placeholders.
 */
export const WIDGET_PHRASE_DEFAULTS: Readonly<
  Record<WidgetUiLocale, Readonly<Record<WidgetPhraseKey, string>>>
> = {
  en: {
    'title.default': 'Chat with us',
    'status.offline': 'No one is available right now — leave a message and we will reply.',
    'status.queue': 'You are number {n} in the queue',
    'status.queueWait': 'You are number {n} in the queue · about {minutes} min',
    'input.placeholder': 'Type your message…',
    'human.connecting': 'Connecting…',
    'prechat.intro': 'Tell us who you are and we will get started.',
    'prechat.submit': 'Start chat',
    'offline.label': 'Leave a message',
    'offline.intro': 'Nobody is available right now. Leave a message and we will get back to you.',
    'offline.subject': 'How can we help?',
    'offline.submit': 'Send message',
    'offline.thanks': 'Thanks — we have your message and will reply by email.',
    'chat.end.closedMessage': 'Chat ended.',
  },
  tr: {
    'title.default': 'Bizimle sohbet edin',
    'status.offline': 'Şu anda kimse müsait değil — mesaj bırakın, size döneceğiz.',
    'status.queue': 'Sırada {n}. sıradasınız',
    'status.queueWait': 'Sırada {n}. sıradasınız · yaklaşık {minutes} dk',
    'input.placeholder': 'Mesajınızı yazın…',
    'human.connecting': 'Temsilci bağlanıyor…',
    'prechat.intro': 'Kim olduğunuzu söyleyin, başlayalım.',
    'prechat.submit': 'Sohbeti başlat',
    'offline.label': 'Mesaj bırakın',
    'offline.intro': 'Şu anda kimse müsait değil. Bir mesaj bırakın, size geri dönelim.',
    'offline.subject': 'Nasıl yardımcı olabiliriz?',
    'offline.submit': 'Mesajı gönder',
    'offline.thanks': 'Teşekkürler — mesajınızı aldık, e-posta ile yanıtlayacağız.',
    'chat.end.closedMessage': 'Sohbet sona erdi.',
  },
  de: {
    'title.default': 'Chatten Sie mit uns',
    'status.offline':
      'Gerade ist niemand verfügbar — hinterlassen Sie eine Nachricht, wir antworten.',
    'status.queue': 'Sie sind Nummer {n} in der Warteschlange',
    'status.queueWait': 'Sie sind Nummer {n} in der Warteschlange · etwa {minutes} Min.',
    'input.placeholder': 'Nachricht eingeben…',
    'human.connecting': 'Verbinde…',
    'prechat.intro': 'Sagen Sie uns, wer Sie sind, dann legen wir los.',
    'prechat.submit': 'Chat starten',
    'offline.label': 'Nachricht hinterlassen',
    'offline.intro':
      'Gerade ist niemand verfügbar. Hinterlassen Sie eine Nachricht, wir melden uns bei Ihnen.',
    'offline.subject': 'Wie können wir helfen?',
    'offline.submit': 'Nachricht senden',
    'offline.thanks': 'Danke — wir haben Ihre Nachricht und antworten per E-Mail.',
    'chat.end.closedMessage': 'Chat beendet.',
  },
  fr: {
    'title.default': 'Discutez avec nous',
    'status.offline':
      "Personne n'est disponible pour le moment — laissez un message, nous vous répondrons.",
    'status.queue': "Vous êtes en position {n} dans la file d'attente",
    'status.queueWait': "Vous êtes en position {n} dans la file d'attente · environ {minutes} min",
    'input.placeholder': 'Écrivez votre message…',
    'human.connecting': 'Connexion…',
    'prechat.intro': 'Dites-nous qui vous êtes et nous commencerons.',
    'prechat.submit': 'Démarrer le chat',
    'offline.label': 'Laisser un message',
    'offline.intro':
      'Personne n’est disponible pour le moment. Laissez un message et nous vous répondrons.',
    'offline.subject': 'Comment pouvons-nous vous aider ?',
    'offline.submit': 'Envoyer le message',
    'offline.thanks': 'Merci — nous avons votre message et vous répondrons par e-mail.',
    'chat.end.closedMessage': 'Chat terminé.',
  },
  es: {
    'title.default': 'Chatea con nosotros',
    'status.offline': 'Ahora mismo no hay nadie disponible — deja un mensaje y te responderemos.',
    'status.queue': 'Eres el número {n} en la cola',
    'status.queueWait': 'Eres el número {n} en la cola · unos {minutes} min',
    'input.placeholder': 'Escribe tu mensaje…',
    'human.connecting': 'Conectando…',
    'prechat.intro': 'Cuéntanos quién eres y empezamos.',
    'prechat.submit': 'Iniciar chat',
    'offline.label': 'Deja un mensaje',
    'offline.intro': 'Ahora mismo no hay nadie disponible. Deja un mensaje y te responderemos.',
    'offline.subject': '¿En qué podemos ayudarte?',
    'offline.submit': 'Enviar mensaje',
    'offline.thanks': 'Gracias — tenemos tu mensaje y te responderemos por correo.',
    'chat.end.closedMessage': 'Chat finalizado.',
  },
  it: {
    'title.default': 'Chatta con noi',
    'status.offline':
      "Al momento non c'è nessuno disponibile — lascia un messaggio e ti risponderemo.",
    'status.queue': 'Sei il numero {n} in coda',
    'status.queueWait': 'Sei il numero {n} in coda · circa {minutes} min',
    'input.placeholder': 'Scrivi il tuo messaggio…',
    'human.connecting': 'Connessione…',
    'prechat.intro': 'Dicci chi sei e iniziamo.',
    'prechat.submit': 'Avvia chat',
    'offline.label': 'Lascia un messaggio',
    'offline.intro':
      'Al momento non c’è nessuno disponibile. Lascia un messaggio e ti risponderemo.',
    'offline.subject': 'Come possiamo aiutarti?',
    'offline.submit': 'Invia il messaggio',
    'offline.thanks': 'Grazie — abbiamo il tuo messaggio e ti risponderemo via e-mail.',
    'chat.end.closedMessage': 'Chat terminata.',
  },
  pt: {
    'title.default': 'Converse conosco',
    'status.offline': 'No momento não há ninguém disponível — deixe uma mensagem e responderemos.',
    'status.queue': 'Você é o número {n} na fila',
    'status.queueWait': 'Você é o número {n} na fila · cerca de {minutes} min',
    'input.placeholder': 'Digite sua mensagem…',
    'human.connecting': 'Conectando…',
    'prechat.intro': 'Diga-nos quem você é e vamos começar.',
    'prechat.submit': 'Iniciar chat',
    'offline.label': 'Deixe uma mensagem',
    'offline.intro':
      'Ninguém está disponível neste momento. Deixe uma mensagem e nós responderemos.',
    'offline.subject': 'Como podemos ajudar?',
    'offline.submit': 'Enviar mensagem',
    'offline.thanks': 'Obrigado — recebemos a sua mensagem e responderemos por e-mail.',
    'chat.end.closedMessage': 'Conversa encerrada.',
  },
  ar: {
    'title.default': 'تحدث معنا',
    'status.offline': 'لا يوجد أحد متاح الآن — اترك رسالة وسنقوم بالرد.',
    'status.queue': 'أنت رقم {n} في قائمة الانتظار',
    'status.queueWait': 'أنت رقم {n} في قائمة الانتظار · حوالي {minutes} دقيقة',
    'input.placeholder': 'اكتب رسالتك…',
    'human.connecting': 'جارٍ الاتصال…',
    'prechat.intro': 'أخبرنا من أنت وسنبدأ.',
    'prechat.submit': 'بدء المحادثة',
    'offline.label': 'اترك رسالة',
    'offline.intro': 'لا أحد متاح الآن. اترك رسالة وسنعاود الاتصال بك.',
    'offline.subject': 'كيف يمكننا مساعدتك؟',
    'offline.submit': 'إرسال الرسالة',
    'offline.thanks': 'شكرًا — لقد استلمنا رسالتك وسنرد عبر البريد الإلكتروني.',
    'chat.end.closedMessage': 'انتهت المحادثة.',
  },
};
