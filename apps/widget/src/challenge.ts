/**
 * The widget's human check (tm 339.3 · SiyahTuş analysis GV-01).
 *
 * A normal visitor never meets it: the API answers `403 challenge_required`
 * only when the workspace's mode and the risk signals say a visitor looks
 * scripted (`abuse-guard.ts`). Then `WidgetApi` hands the answer's `details`
 * here, this box is drawn in place of the conversation, and the provider's
 * token goes back on the repeated request.
 *
 * Nothing of the provider is loaded until that moment — no Turnstile script,
 * no frame, no request to Cloudflare for the visitor who is never asked. The
 * mock provider (development and tests) draws a plain checkbox that hands out
 * the one token the mock API accepts, so nothing leaves the page either way.
 *
 * Kept out of `widget.ts` because it is the one part of the widget that talks
 * to a third party, and its DOM is built and torn down independently of the
 * conversation's.
 */
import { MOCK_CAPTCHA_PASS_TOKEN, type ChallengeRequiredDetails } from '@siyahtus/types';
import type { WidgetLocale, WidgetTranslate } from './i18n.js';

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

/** The elements the box is drawn into (built once per widget shell by `buildChallengeParts`). */
export interface ChallengeParts {
  root: HTMLElement;
  title: HTMLElement;
  /** Holds the provider's control: Turnstile's frame or the mock checkbox. */
  box: HTMLElement;
  /** A line under the box — "did not pass", "could not be loaded". Live region. */
  notice: HTMLElement;
  retry: HTMLButtonElement;
  cancel: HTMLButtonElement;
}

export function buildChallengeParts(doc: Document, t: WidgetTranslate): ChallengeParts {
  const root = doc.createElement('div');
  root.className = 'nx-challenge';
  root.hidden = true;
  root.setAttribute('role', 'group');
  const title = doc.createElement('p');
  title.className = 'nx-challenge-title';
  // Focus lands here when the box opens, so a screen reader starts at its title.
  title.tabIndex = -1;
  title.id = 'nx-challenge-title';
  title.textContent = t('challenge.title');
  root.setAttribute('aria-labelledby', title.id);
  const intro = doc.createElement('p');
  intro.className = 'nx-challenge-intro';
  intro.textContent = t('challenge.intro');
  const box = doc.createElement('div');
  box.className = 'nx-challenge-box';
  const notice = doc.createElement('p');
  notice.className = 'nx-challenge-notice';
  notice.setAttribute('role', 'status');
  notice.hidden = true;
  const retry = doc.createElement('button');
  retry.type = 'button';
  retry.className = 'nx-challenge-retry';
  retry.textContent = t('challenge.retry');
  retry.hidden = true;
  const cancel = doc.createElement('button');
  cancel.type = 'button';
  cancel.className = 'nx-challenge-cancel';
  cancel.textContent = t('challenge.cancel');
  const actions = doc.createElement('div');
  actions.className = 'nx-challenge-actions';
  actions.append(retry, cancel);
  root.append(title, intro, box, notice, actions);
  return { root, title, box, notice, retry, cancel };
}

export interface ChallengeEnv {
  doc: Document;
  win: Window;
  t: WidgetTranslate;
  locale: WidgetLocale;
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

/**
 * Draw the check into `parts` and wire its buttons. Returns a cleanup that
 * removes the provider's control; the caller hides the box itself.
 */
export function drawChallenge(
  env: ChallengeEnv,
  parts: ChallengeParts,
  run: ChallengeRun,
): () => void {
  const { doc, t } = env;
  let done = false;
  let widgetId: string | null = null;
  let turnstile: TurnstileApi | null = null;

  const showNotice = (text: string | null): void => {
    parts.notice.textContent = text ?? '';
    parts.notice.hidden = text === null;
  };
  const cleanup = (): void => {
    if (widgetId !== null && turnstile) {
      try {
        turnstile.remove(widgetId);
      } catch {
        // The frame is already gone with the page's own teardown.
      }
    }
    widgetId = null;
    parts.box.replaceChildren();
  };
  const finish = (token: string | null): void => {
    if (done) return;
    done = true;
    cleanup();
    run.settle(token);
  };

  parts.retry.hidden = true;
  parts.retry.onclick = null;
  parts.cancel.onclick = () => finish(null);
  showNotice(run.failed ? t('challenge.failed') : null);
  parts.box.replaceChildren();

  if (run.details.provider === 'mock') {
    // Stands in for the provider offline: ticking the box is the whole check.
    const label = doc.createElement('label');
    label.className = 'nx-challenge-mock';
    const tick = doc.createElement('input');
    tick.type = 'checkbox';
    tick.addEventListener('change', () => {
      if (tick.checked) finish(MOCK_CAPTCHA_PASS_TOKEN);
    });
    label.append(tick, doc.createTextNode(t('challenge.mock')));
    parts.box.append(label);
    return cleanup;
  }

  const load = (): void => {
    parts.retry.hidden = true;
    parts.box.replaceChildren();
    const loading = doc.createElement('span');
    loading.className = 'nx-challenge-loading';
    loading.textContent = t('challenge.loading');
    parts.box.append(loading);
    void loadTurnstile(env).then(
      (api) => {
        if (done) return;
        turnstile = api;
        parts.box.replaceChildren();
        const slot = doc.createElement('div');
        slot.className = 'nx-challenge-turnstile';
        parts.box.append(slot);
        const provider = doc.createElement('p');
        provider.className = 'nx-challenge-provider';
        provider.textContent = t('challenge.provider');
        parts.box.append(provider);
        widgetId = api.render(slot, {
          sitekey: run.details.site_key,
          language: TURNSTILE_LANGUAGE[env.locale] ?? env.locale,
          callback: (token) => finish(token),
          'error-callback': () => {
            showNotice(t('challenge.unavailable'));
            parts.retry.hidden = false;
          },
          'expired-callback': () => showNotice(t('challenge.failed')),
        });
      },
      () => {
        if (done) return;
        parts.box.replaceChildren();
        showNotice(t('challenge.unavailable'));
        parts.retry.hidden = false;
      },
    );
  };
  parts.retry.onclick = () => {
    showNotice(null);
    cleanup();
    load();
  };
  load();
  return cleanup;
}
