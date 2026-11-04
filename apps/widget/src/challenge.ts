/**
 * The widget's human check (tm 339.3 · SiyahTuş analysis GV-01).
 *
 * A normal visitor never meets it: the API answers `403 challenge_required`
 * only when the workspace's mode and the risk signals say a visitor looks
 * scripted (`abuse-guard.ts`). Then `WidgetApi` hands the answer's `details`
 * here, this box is drawn in place of the conversation, and the provider's
 * token goes back on the repeated request.
 *
 * Nothing of it is loaded until that moment. The box is a chunk of its own
 * (`lazy-chunks.ts`, tm 395), fetched the first time a check is asked for, so
 * its drawing, its stylesheet and its words in eight languages cost the page
 * of a visitor nobody doubts nothing — and neither does the provider: no
 * Turnstile script, no frame, no request to Cloudflare. The mock provider
 * (development and tests) draws a plain checkbox that hands out the one token
 * the mock API accepts, so nothing leaves the page either way.
 *
 * It imports nothing but types — a value from the shared barrel would become a
 * chunk every page loads — so the widget hands it the mock token. Kept out of
 * `widget.ts` because it is the one part of the widget that talks to a third
 * party, and its DOM is built and torn down independently of the
 * conversation's.
 */
import type { ChallengeRequiredDetails } from '@siyahtus/types';
import type { WidgetLocale } from './i18n.js';

/** Cloudflare's script. Loaded on demand and only from here; the widget's CSP names this origin. */
export const TURNSTILE_SCRIPT_URL =
  'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

/** The slice of `window.turnstile` this file uses. */
interface TurnstileApi {
  render(
    container: HTMLElement,
    options: {
      sitekey: string;
      language?: string;
      callback: (token: string) => void;
      'error-callback': () => void;
      'expired-callback': () => void;
    },
  ): string;
  remove(widgetId: string): void;
}

type ChallengeKey =
  | 'title'
  | 'intro'
  | 'mock'
  | 'loading'
  | 'failed'
  | 'unavailable'
  | 'retry'
  | 'cancel'
  | 'provider';

/**
 * The box's words (K25: the widget's eight languages). Not a brand's to reword
 * (`WIDGET_PHRASE_KEYS`), so they live with the box rather than in the catalogs;
 * the widget's own `error.challenge` — shown after the box is gone — stays there.
 */
const TEXT: Record<WidgetLocale, Record<ChallengeKey, string>> = {
  en: {
    title: 'Quick check',
    intro: 'Please confirm you are a person to continue.',
    mock: 'I am not a robot',
    loading: 'Loading the check…',
    failed: 'The check did not pass. Please try again.',
    unavailable: 'The check could not be loaded. Please try again.',
    retry: 'Try again',
    cancel: 'Not now',
    provider: 'Protected by Cloudflare Turnstile.',
  },
  tr: {
    title: 'Kısa doğrulama',
    intro: 'Devam etmek için lütfen bir insan olduğunuzu doğrulayın.',
    mock: 'Robot değilim',
    loading: 'Doğrulama yükleniyor…',
    failed: 'Doğrulama geçilemedi. Lütfen tekrar deneyin.',
    unavailable: 'Doğrulama yüklenemedi. Lütfen tekrar deneyin.',
    retry: 'Tekrar dene',
    cancel: 'Şimdi değil',
    provider: 'Cloudflare Turnstile tarafından korunmaktadır.',
  },
  de: {
    title: 'Kurze Überprüfung',
    intro: 'Bitte bestätigen Sie, dass Sie ein Mensch sind, um fortzufahren.',
    mock: 'Ich bin kein Roboter',
    loading: 'Überprüfung wird geladen…',
    failed: 'Die Überprüfung war nicht erfolgreich. Bitte versuchen Sie es erneut.',
    unavailable: 'Die Überprüfung konnte nicht geladen werden. Bitte versuchen Sie es erneut.',
    retry: 'Erneut versuchen',
    cancel: 'Jetzt nicht',
    provider: 'Geschützt durch Cloudflare Turnstile.',
  },
  fr: {
    title: 'Vérification rapide',
    intro: 'Merci de confirmer que vous êtes une personne pour continuer.',
    mock: 'Je ne suis pas un robot',
    loading: 'Chargement de la vérification…',
    failed: 'La vérification a échoué. Merci de réessayer.',
    unavailable: 'La vérification n’a pas pu être chargée. Merci de réessayer.',
    retry: 'Réessayer',
    cancel: 'Pas maintenant',
    provider: 'Protégé par Cloudflare Turnstile.',
  },
  es: {
    title: 'Verificación rápida',
    intro: 'Confirma que eres una persona para continuar.',
    mock: 'No soy un robot',
    loading: 'Cargando la verificación…',
    failed: 'La verificación no se superó. Inténtalo de nuevo.',
    unavailable: 'No se pudo cargar la verificación. Inténtalo de nuevo.',
    retry: 'Reintentar',
    cancel: 'Ahora no',
    provider: 'Protegido por Cloudflare Turnstile.',
  },
  it: {
    title: 'Verifica rapida',
    intro: 'Conferma di essere una persona per continuare.',
    mock: 'Non sono un robot',
    loading: 'Caricamento della verifica…',
    failed: 'La verifica non è riuscita. Riprova.',
    unavailable: 'Non è stato possibile caricare la verifica. Riprova.',
    retry: 'Riprova',
    cancel: 'Non ora',
    provider: 'Protetto da Cloudflare Turnstile.',
  },
  pt: {
    title: 'Verificação rápida',
    intro: 'Confirme que você é uma pessoa para continuar.',
    mock: 'Não sou um robô',
    loading: 'Carregando a verificação…',
    failed: 'A verificação não foi concluída. Tente novamente.',
    unavailable: 'Não foi possível carregar a verificação. Tente novamente.',
    retry: 'Tentar novamente',
    cancel: 'Agora não',
    provider: 'Protegido pelo Cloudflare Turnstile.',
  },
  ar: {
    title: 'تحقق سريع',
    intro: 'يرجى تأكيد أنك شخص حقيقي للمتابعة.',
    mock: 'أنا لست روبوتًا',
    loading: 'جارٍ تحميل التحقق…',
    failed: 'لم ينجح التحقق. يرجى المحاولة مرة أخرى.',
    unavailable: 'تعذّر تحميل التحقق. يرجى المحاولة مرة أخرى.',
    retry: 'إعادة المحاولة',
    cancel: 'ليس الآن',
    provider: 'محمي بواسطة Cloudflare Turnstile.',
  },
};

/** The box's words for `locale`, English for anything else. */
export function challengeText(locale: string): Record<ChallengeKey, string> {
  return TEXT[locale as WidgetLocale] ?? TEXT.en;
}

const STYLE_ID = 'nx-challenge-style';
const CHALLENGE_CSS = `
.nx-challenge{flex:1 1 auto;min-height:0;overflow-y:auto;display:flex;flex-direction:column;align-items:flex-start;gap:10px;padding:18px 16px 16px;background:var(--nx-surface-2)}
.nx-challenge-title{margin:0;font-size:15px;font-weight:700;color:var(--nx-title);outline:none}
.nx-challenge-intro{margin:0;font-size:14px;line-height:20px;color:var(--nx-text)}
.nx-challenge-box{width:100%;min-height:72px;display:flex;flex-direction:column;justify-content:center;gap:8px;padding:12px;background:var(--nx-surface);border:1px solid var(--nx-field-border);border-radius:12px}
.nx-challenge-mock{display:flex;align-items:center;gap:10px;min-height:44px;font-size:14px;font-weight:600;color:var(--nx-text);cursor:pointer}
.nx-challenge-mock input{accent-color:var(--nx-brand);width:22px;height:22px;margin:0}
.nx-challenge-loading,.nx-challenge-provider{font-size:12px;color:var(--nx-muted)}
.nx-challenge-provider{margin:0}
.nx-challenge-notice{margin:0;font-size:13px;font-weight:600;color:var(--nx-danger)}
.nx-challenge-actions{display:flex;flex-wrap:wrap;gap:8px}
.nx-challenge-retry,.nx-challenge-cancel{min-height:44px;padding:0 16px;border-radius:12px;font:inherit;font-size:14px;font-weight:700;cursor:pointer}
.nx-challenge-retry{border:0;background:var(--nx-cta);color:var(--nx-on-brand)}
.nx-challenge-cancel{border:1px solid var(--nx-field-border);background:transparent;color:var(--nx-text)}
.nx-challenge-retry:focus-visible,.nx-challenge-cancel:focus-visible,.nx-challenge-mock input:focus-visible{outline:2px solid var(--nx-brand);outline-offset:2px}
`;

export interface ChallengeEnv {
  doc: Document;
  win: Window;
  locale: WidgetLocale;
  /** The one token the mock provider hands out (`MOCK_CAPTCHA_PASS_TOKEN`, from the widget). */
  mockToken: string;
}

export interface ChallengeRun {
  details: ChallengeRequiredDetails;
  /** The provider refused the token the last round sent: say so, and ask again. */
  failed: boolean;
  /** Hand over the token, or null when the visitor gave up. Called at most once per run. */
  settle: (token: string | null) => void;
}

/** Turnstile's language codes where ours differ. */
const TURNSTILE_LANGUAGE: Partial<Record<WidgetLocale, string>> = { pt: 'pt-br' };

/** The load in flight or done, per document — one script tag however many checks are drawn. */
const scriptLoads = new WeakMap<Document, Promise<TurnstileApi>>();

/** Add Cloudflare's script to `doc` once and resolve its API. A failed load can be tried again. */
function loadTurnstile(env: ChallengeEnv): Promise<TurnstileApi> {
  const existing = (env.win as unknown as { turnstile?: TurnstileApi }).turnstile;
  if (existing) return Promise.resolve(existing);
  const loading = scriptLoads.get(env.doc);
  if (loading) return loading;
  const load = new Promise<TurnstileApi>((resolve, reject) => {
    const script = env.doc.createElement('script');
    script.src = TURNSTILE_SCRIPT_URL;
    script.async = true;
    script.onload = () => {
      const api = (env.win as unknown as { turnstile?: TurnstileApi }).turnstile;
      if (api) resolve(api);
      else reject(new Error('turnstile did not initialise'));
    };
    script.onerror = () => reject(new Error('turnstile script failed to load'));
    env.doc.head.append(script);
  }).catch((error: unknown) => {
    scriptLoads.delete(env.doc);
    // The failed tag stays in the document; a second attempt adds a fresh one.
    env.doc.querySelectorAll(`script[src="${TURNSTILE_SCRIPT_URL}"]`).forEach((n) => n.remove());
    throw error;
  });
  scriptLoads.set(env.doc, load);
  return load;
}

function element<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  part: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = doc.createElement(tag);
  node.className = `nx-challenge-${part}`;
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * Draw the check into `root` — the widget's empty, hidden `.nx-challenge` slot,
 * which it shows and hides itself — and wire its buttons. Returns a cleanup that
 * removes the provider's control and empties the slot. `focus`: the panel is
 * open, so focus lands on the title and a screen reader starts there.
 */
export function drawChallenge(
  env: ChallengeEnv,
  root: HTMLElement,
  run: ChallengeRun,
  focus: boolean,
): () => void {
  const { doc } = env;
  const text = challengeText(env.locale);
  if (!doc.getElementById(STYLE_ID)) {
    const style = doc.createElement('style');
    style.id = STYLE_ID;
    style.textContent = CHALLENGE_CSS;
    doc.head.append(style);
  }

  const title = element(doc, 'p', 'title', text.title);
  title.tabIndex = -1;
  title.id = 'nx-challenge-title';
  root.setAttribute('role', 'group');
  root.setAttribute('aria-labelledby', title.id);
  const box = element(doc, 'div', 'box');
  const notice = element(doc, 'p', 'notice');
  notice.setAttribute('role', 'status');
  const retry = element(doc, 'button', 'retry', text.retry);
  retry.type = 'button';
  retry.hidden = true;
  const cancel = element(doc, 'button', 'cancel', text.cancel);
  cancel.type = 'button';
  const actions = element(doc, 'div', 'actions');
  actions.append(retry, cancel);
  root.replaceChildren(title, element(doc, 'p', 'intro', text.intro), box, notice, actions);

  let done = false;
  let widgetId: string | null = null;
  let turnstile: TurnstileApi | null = null;

  const showNotice = (line: string | null): void => {
    notice.textContent = line ?? '';
    notice.hidden = line === null;
  };
  const removeProvider = (): void => {
    if (widgetId !== null && turnstile) {
      try {
        turnstile.remove(widgetId);
      } catch {
        // The frame is already gone with the page's own teardown.
      }
    }
    widgetId = null;
    box.replaceChildren();
  };
  const cleanup = (): void => {
    removeProvider();
    root.replaceChildren();
  };
  const finish = (token: string | null): void => {
    if (done) return;
    done = true;
    cleanup();
    run.settle(token);
  };

  cancel.onclick = () => finish(null);
  showNotice(run.failed ? text.failed : null);
  if (focus) title.focus();

  if (run.details.provider === 'mock') {
    // Stands in for the provider offline: ticking the box is the whole check.
    const label = element(doc, 'label', 'mock');
    const tick = doc.createElement('input');
    tick.type = 'checkbox';
    tick.addEventListener('change', () => {
      if (tick.checked) finish(env.mockToken);
    });
    label.append(tick, doc.createTextNode(text.mock));
    box.append(label);
    return cleanup;
  }

  const load = (): void => {
    retry.hidden = true;
    box.replaceChildren(element(doc, 'span', 'loading', text.loading));
    void loadTurnstile(env).then(
      (api) => {
        if (done) return;
        turnstile = api;
        const slot = element(doc, 'div', 'turnstile');
        box.replaceChildren(slot, element(doc, 'p', 'provider', text.provider));
        widgetId = api.render(slot, {
          sitekey: run.details.site_key,
          language: TURNSTILE_LANGUAGE[env.locale] ?? env.locale,
          callback: (token) => finish(token),
          'error-callback': () => {
            showNotice(text.unavailable);
            retry.hidden = false;
          },
          'expired-callback': () => showNotice(text.failed),
        });
      },
      () => {
        if (done) return;
        box.replaceChildren();
        showNotice(text.unavailable);
        retry.hidden = false;
      },
    );
  };
  retry.onclick = () => {
    showNotice(null);
    removeProvider();
    load();
  };
  load();
  return cleanup;
}
