/**
 * SiyahTuş widget loader — the only script that runs on the customer's own page.
 *
 * Responsibilities, and nothing else:
 *   1. read config from `window.__siyahtus`
 *   2. create a sandboxed cross-origin iframe
 *   3. relay a narrow, validated message protocol between page and iframe
 *
 * It must never render chat content itself. Everything the customer types or
 * receives lives inside the iframe, on a different origin, so a compromised or
 * merely careless host page cannot read a conversation (NFR-S6).
 *
 * Slice 1 establishes the loader, the sandbox and the message boundary; slice 6
 * adds the chat surface behind it.
 */

import { sanitizeReferrer } from '@siyahtus/types';

export interface SiyahTusWidgetConfig {
  /** Tenant this widget talks to. */
  organizationId: string;
  /** Origin serving the widget iframe, e.g. `https://widget.siyahtus.example`. */
  widgetOrigin?: string;
  /** Corner placement. */
  position?: 'bottom-right' | 'bottom-left';
  /** BCP-47 language tag for the widget UI. */
  language?: string;
  // --- Appearance (FR-MOD-11.7), baked into the snippet from the workspace's
  // widget settings. All optional: an un-customised install carries none and
  // gets the shipped look. Validated server-side before it reaches here.
  /** Brand colour, a `#rrggbb` hex. */
  primaryColor?: string;
  /** `auto` follows the visitor's OS; `light`/`dark` force it. */
  theme?: 'auto' | 'light' | 'dark';
  /** Open the panel edge-to-edge on phones rather than as a floating card. */
  mobileFullscreen?: boolean;
  /** The removable "Powered by SiyahTuş" footer (FR-MOD-11.5). */
  poweredBy?: boolean;
}

/** Below this host-viewport width the widget is treated as being on a phone. */
const MOBILE_MAX_WIDTH = 480;

/**
 * How far the frame sits from the screen corner: flush. The widget document
 * places its launcher and panel 28 px in from the corner itself, so on the
 * screen-edge sides their shadows run off the screen instead of being cut off
 * by the frame's own edge a few pixels short of it.
 */
const FRAME_EDGE = '0px';
/** The widget's largest frame (the open panel, 488 × 802) plus some slack. */
const MAX_FRAME = { width: 520, height: 840 } as const;

interface SiyahTusGlobal extends SiyahTusWidgetConfig {
  open?: () => void;
  close?: () => void;
  destroy?: () => void;
}

/** Messages the iframe is allowed to send outward. Anything else is dropped. */
const ALLOWED_INBOUND = new Set([
  'siyahtus:ready',
  'siyahtus:resize',
  'siyahtus:open',
  'siyahtus:close',
  'siyahtus:logged-out',
  'siyahtus:unread',
  'siyahtus:campaign-tracking',
]);

/**
 * How long `siyahtus('logout')` waits for the widget to say it has forgotten
 * its visitor before resolving anyway — a widget that never booted (no
 * `organizationId`, a blocked frame) must not hang the host page's sign-out.
 */
export const LOGOUT_TIMEOUT_MS = 5_000;

const IFRAME_ID = 'siyahtus-widget-frame';

/**
 * Languages that read right-to-left — `RTL_LOCALES` in `locales/index.ts`, which
 * this script cannot import without pulling every catalogue into the one file a
 * host page loads (`loader.test.ts` pins the two lists together).
 */
export const RTL_LANGUAGES: ReadonlySet<string> = new Set(['ar']);

/**
 * The physical edge the frame is pinned to (tm 259.24 · UX audit D17).
 *
 * The widget document places its launcher and greeting card with logical CSS
 * (`inset-inline-*`, NFR-I18N1), so under `dir="rtl"` they sit at the frame's
 * *left* for a bottom-right install. A frame pinned to the physical right then
 * held a launcher that was only in the right place while the frame was as wide
 * as the launcher: the greeting card widens it to 340 px and the launcher
 * jumped ~250 px to the left. The frame follows the same rule the document
 * does — the configured corner, mirrored for a right-to-left language — so the
 * launcher stays in the corner of the screen it started in at every frame size.
 */
export function frameEdge(
  position: string | undefined,
  language: string | undefined,
): 'left' | 'right' {
  const primary = (language ?? '').toLowerCase().split(/[-_]/)[0] ?? '';
  return edgeFor(position, RTL_LANGUAGES.has(primary));
}

/**
 * The same rule once the direction is known outright. The widget document
 * reports it (`rtl` on `siyahtus:ready` / `siyahtus:resize`) because with the
 * language chosen in the panel or by the visitor's browser (WG-02) the snippet
 * does not say, and the loader cannot know until the document does.
 */
function edgeFor(position: string | undefined, rtl: boolean): 'left' | 'right' {
  return (position === 'bottom-left') !== rtl ? 'left' : 'right';
}

/** Opaque here — the widget document (not this script) validates the shape. */
type SiyahTusCommandPayload = Record<string, unknown> | undefined;

/** Commands called before the widget can receive them, flushed once it is ready. */
let pendingCommands: Array<{ command: string; payload: SiyahTusCommandPayload }> = [];
/** Set once the current widget instance confirms (`siyahtus:ready`) it can receive commands. */
let relayCommand: ((command: string, payload: SiyahTusCommandPayload) => void) | null = null;

/** Host-page promises from `siyahtus('logout')`, answered by `siyahtus:logged-out`. */
let logoutWaiters: Array<() => void> = [];

/**
 * `siyahtus('trackSale', …)` (FR-MOD-13.5) — the general command surface a host
 * page's own scripts call. Exposed as soon as this script runs, since a page's
 * own script may call it before the widget has finished booting; queued
 * rather than dropped, and flushed once the frame confirms it is ready
 * (classic command-queue snippet pattern). Never throws — a checkout page
 * must not break because a call arrived early or was misused.
 *
 * `siyahtus('logout')` (ID-03 · K4 · tm 287.3) is the one command with an
 * answer: the host page signed its user out, the widget forgets them, and the
 * returned promise resolves once it has — so a page can `await` it before
 * navigating away, which would otherwise tear the frame down mid-forget. It
 * never rejects, and resolves after `LOGOUT_TIMEOUT_MS` whatever happened.
 */
function siyahtus(command: string, payload?: SiyahTusCommandPayload): Promise<void> | undefined {
  try {
    if (relayCommand) relayCommand(command, payload);
    else pendingCommands.push({ command, payload });
  } catch {
    // Never propagates into the host page — not even a relay failure against
    // a frame that has since gone away.
  }
  return command === 'logout' ? loggedOut() : undefined;
}

function loggedOut(): Promise<void> {
  return new Promise((resolve) => {
    const finish = (): void => {
      logoutWaiters = logoutWaiters.filter((waiter) => waiter !== finish);
      resolve();
    };
    logoutWaiters.push(finish);
    setTimeout(finish, LOGOUT_TIMEOUT_MS);
  });
}

export function boot(
  win: Window & { __siyahtus?: SiyahTusGlobal } = window as never,
): (() => void) | null {
  const config = win.__siyahtus;
  if (!config?.organizationId) {
    // Silent: a missing config is a host page integration mistake, and throwing
    // inside someone else's page is hostile.
    return null;
  }
  if (win.document.getElementById(IFRAME_ID)) return null; // already booted

  const widgetOrigin = normaliseOrigin(config.widgetOrigin ?? win.location.origin);
  if (!widgetOrigin) return null;

  // The isolation this widget depends on comes from the iframe being on a
  // *different* origin than the page. Same-origin defeats it entirely: with
  // `allow-scripts allow-same-origin` a same-origin frame can reach into the
  // embedder and even strip its own sandbox. Refuse rather than run degraded.
  if (widgetOrigin === win.location.origin) return null;

  // A fresh instance is booting — any relay bound to a previous (now gone)
  // frame is stale. Queued commands are kept: they were issued for whichever
  // widget boots next, which is this one.
  relayCommand = null;

  const frame = win.document.createElement('iframe');
  frame.id = IFRAME_ID;
  frame.title = 'Chat';
  frame.setAttribute('aria-label', 'Customer support chat');
  // `allow-same-origin` gives the frame its *own* origin back. It does not give
  // it the host page's — that boundary is the differing origin, enforced above.
  //
  // Without it the document is opaque-origin: no storage, and every request it
  // makes carries `Origin: null`, which the API rejects because an origin that
  // identifies nothing cannot be checked against an allowlist. The widget could
  // not authenticate at all.
  frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-popups');
  frame.setAttribute('allowtransparency', 'true');
  // The "Your support number" menu item copies to the clipboard from inside the
  // frame (ID-05). A cross-origin frame may only do that when the embedder
  // delegates it; without it the widget falls back to selecting the number.
  frame.setAttribute('allow', 'clipboard-write');
  frame.src = buildFrameUrl(widgetOrigin, config, hostPageUrl(win));

  let corner = frameEdge(config.position, config.language);

  Object.assign(frame.style, {
    position: 'fixed',
    bottom: FRAME_EDGE,
    [corner]: FRAME_EDGE,
    width: '124px',
    height: '124px',
    // A short window must not push the panel's header off the top of it.
    maxHeight: `calc(100vh - 2 * ${FRAME_EDGE})`,
    border: '0',
    zIndex: '2147483000',
    colorScheme: 'normal',
    background: 'transparent',
  } satisfies Partial<CSSStyleDeclaration> as Record<string, string>);

  win.document.body.appendChild(frame);

  // The frame's own idea of how big it wants to be, updated by `siyahtus:resize`.
  // Geometry is recomputed from these plus whether the panel is open, so that
  // opening on a phone can fill the viewport (FR-MOD-11.7, "mobil tam ekran")
  // rather than leave a 380 px card overhanging a 360 px screen.
  let wantWidth = 124;
  let wantHeight = 124;
  let open = false;

  const applyGeometry = (): void => {
    if (open && config.mobileFullscreen && win.innerWidth <= MOBILE_MAX_WIDTH) {
      // Edge-to-edge: the launcher's corner offsets would leave a gap, so clear
      // them and pin all four sides.
      Object.assign(frame.style, {
        top: '0px',
        left: '0px',
        right: '0px',
        bottom: '0px',
        width: '100%',
        height: '100%',
        maxHeight: 'none',
      });
      return;
    }
    // Floating card in its corner — the default everywhere but a phone.
    frame.style.top = '';
    frame.style[corner] = FRAME_EDGE;
    frame.style[corner === 'left' ? 'right' : 'left'] = '';
    frame.style.bottom = FRAME_EDGE;
    frame.style.maxHeight = `calc(100vh - 2 * ${FRAME_EDGE})`;
    frame.style.width = `${wantWidth}px`;
    frame.style.height = `${wantHeight}px`;
  };

  const onMessage = (event: MessageEvent): void => {
    // Both checks matter: the origin proves who sent it, the source proves it
    // came from our frame rather than another one on the same origin.
    if (event.origin !== widgetOrigin) return;
    if (event.source !== frame.contentWindow) return;

    const data = event.data as {
      type?: unknown;
      height?: unknown;
      width?: unknown;
      rtl?: unknown;
      count?: unknown;
    };
    if (typeof data?.type !== 'string' || !ALLOWED_INBOUND.has(data.type)) return;

    // The document's own word on its direction, when it gives one (WG-02).
    if (typeof data.rtl === 'boolean') corner = edgeFor(config.position, data.rtl);

    if (data.type === 'siyahtus:open') open = true;
    if (data.type === 'siyahtus:close') open = false;

    if (data.type === 'siyahtus:ready') {
      relayCommand = (command, payload): void => {
        frame.contentWindow?.postMessage(
          { type: 'siyahtus:command', command, payload },
          widgetOrigin,
        );
      };
      const queued = pendingCommands;
      pendingCommands = [];
      for (const item of queued) relayCommand(item.command, item.payload);
    }

    if (data.type === 'siyahtus:resize') {
      const height = clampDimension(data.height, 84, MAX_FRAME.height);
      const width = clampDimension(data.width, 84, MAX_FRAME.width);
      if (height !== null) wantHeight = height;
      if (width !== null) wantWidth = width;
    }

    // The unread count, for a page that draws its own button (WG-10): the number
    // and nothing else, as a DOM event on the host's window.
    if (data.type === 'siyahtus:unread' && typeof data.count === 'number') {
      const count = Math.max(0, Math.min(999, Math.trunc(data.count)));
      win.dispatchEvent(new CustomEvent('siyahtus:unread', { detail: { count } }));
    }

    // The workspace has a campaign running: report page changes and exit intent.
    stopWatching ??=
      data.type === 'siyahtus:campaign-tracking'
        ? watchVisit(win, (message) => frame.contentWindow?.postMessage(message, widgetOrigin))
        : null;

    if (data.type === 'siyahtus:logged-out') {
      // The widget has forgotten its visitor (tm 287.3): answer the host page,
      // then open a fresh document — the old one still holds the transcript
      // in memory. Commands issued meanwhile wait for its `siyahtus:ready`,
      // and the frame starts again as a closed launcher.
      const waiting = logoutWaiters;
      logoutWaiters = [];
      for (const finish of waiting) finish();
      relayCommand = null;
      open = false;
      wantWidth = 124;
      wantHeight = 124;
      frame.src = buildFrameUrl(widgetOrigin, config, hostPageUrl(win));
    }

    applyGeometry();
  };

  win.addEventListener('message', onMessage);
  let stopWatching: (() => void) | null = null;

  const post = (type: string): void => {
    frame.contentWindow?.postMessage({ type }, widgetOrigin);
  };
  config.open = () => post('siyahtus:host-open');
  config.close = () => post('siyahtus:host-close');

  const destroy = (): void => {
    win.removeEventListener('message', onMessage);
    stopWatching?.();
    frame.remove();
    delete config.open;
    delete config.close;
    delete config.destroy;
    relayCommand = null;
  };
  config.destroy = destroy;

  return destroy;
}

function normaliseOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    // http is tolerated for local development only; anything else is refused
    // rather than silently downgrading a customer's transport security.
    if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

function buildFrameUrl(
  origin: string,
  config: SiyahTusWidgetConfig,
  host: { origin: string; url: string; referrer: string | null },
): string {
  const url = new URL('/widget.html', origin);
  url.searchParams.set('organization_id', config.organizationId);
  // The embedding page's origin, which only code running on that page knows.
  // The widget forwards it so the API can check it against the organization's
  // trusted domains — see the note on `host_origin` in the token route.
  url.searchParams.set('host_origin', host.origin);
  url.searchParams.set('host_url', host.url);
  // Only present when the visitor arrived from somewhere; a direct arrival
  // carries no parameter at all rather than an empty one, so the widget can
  // tell "came from nowhere" from "came from the empty string".
  if (host.referrer) url.searchParams.set('host_referrer', host.referrer);
  if (config.language) url.searchParams.set('language', config.language);
  // Appearance the widget applies at mount, so the launcher is on-brand before
  // the first open rather than flashing the default (FR-MOD-11.7). Only what the
  // snippet actually set is forwarded; the widget fills the rest with defaults.
  if (config.primaryColor) url.searchParams.set('color', config.primaryColor);
  if (config.theme) url.searchParams.set('theme', config.theme);
  if (config.position) url.searchParams.set('position', config.position);
  if (config.mobileFullscreen === false) url.searchParams.set('mobile_full', '0');
  if (config.poweredBy === false) url.searchParams.set('powered_by', '0');
  return url.toString();
}

/** A page change settles this long before it is reported (a router may push twice in a row). */
export const PAGE_DEBOUNCE_MS = 300;
/** An upward scroll this far inside `EXIT_SCROLL_WINDOW_MS` is a phone's way of leaving. */
const EXIT_SCROLL_DISTANCE = 150;
const EXIT_SCROLL_WINDOW_MS = 150;

/**
 * What only the host page can see for a campaign's targeting (EN-03 · tm 352.2):
 * a single-page site changing page without a reload (`pushState`,
 * `replaceState`, `popstate`), and the visitor heading for the way out — the
 * pointer leaving through the top edge, or on a phone a fast scroll to the top.
 * Both go to the widget frame as messages (`siyahtus:page`,
 * `siyahtus:exit-intent`); the frame decides what they mean.
 *
 * Started only when the widget says the workspace has a campaign running
 * (`siyahtus:campaign-tracking`, from the token mint), so a page whose
 * workspace has none keeps its `history` untouched. Returns the stop function,
 * which gives `history` back if nobody has wrapped it since.
 */
export function watchVisit(
  win: Window,
  send: (message: Record<string, unknown>) => void,
): () => void {
  const history = win.history;
  let reported = hostPageUrl(win).url;
  let timer: number | undefined;

  const changed = (): void => {
    win.clearTimeout(timer);
    timer = win.setTimeout(() => {
      const { url } = hostPageUrl(win);
      if (url === reported) return;
      reported = url;
      send({ type: 'siyahtus:page', url });
    }, PAGE_DEBOUNCE_MS);
  };
  // The page's own pushState / replaceState, each followed by a look at the address.
  const names = ['pushState', 'replaceState'] as const;
  const originals = names.map((name) => history[name]);
  const wrapped = names.map((name, index) => {
    const original = originals[index]!;
    const watched = function (this: History, ...args: Parameters<History['pushState']>): void {
      original.apply(this, args);
      changed();
    };
    history[name] = watched;
    return watched;
  });
  win.addEventListener('popstate', changed);

  const exit = (): void => send({ type: 'siyahtus:exit-intent' });
  const onMouseOut = (event: MouseEvent): void => {
    if (!event.relatedTarget && event.clientY <= 0) exit();
  };
  let sample = { y: win.scrollY, t: Date.now() };
  const onScroll = (): void => {
    const now = Date.now();
    const y = win.scrollY;
    if (now - sample.t > EXIT_SCROLL_WINDOW_MS) {
      sample = { y, t: now };
    } else if (sample.y - y >= EXIT_SCROLL_DISTANCE && win.innerWidth <= MOBILE_MAX_WIDTH) {
      sample = { y, t: now };
      exit();
    }
  };
  win.document.addEventListener('mouseout', onMouseOut);
  win.addEventListener('scroll', onScroll, { passive: true });

  return () => {
    win.clearTimeout(timer);
    names.forEach((name, index) => {
      if (history[name] === wrapped[index]) history[name] = originals[index]!;
    });
    win.removeEventListener('popstate', changed);
    win.document.removeEventListener('mouseout', onMouseOut);
    win.removeEventListener('scroll', onScroll);
  };
}

/**
 * The embedded page, as origin + path, plus the page before it.
 *
 * The widget cannot work either out for itself: `document.referrer` inside a
 * cross-origin frame is trimmed to the origin by the default referrer policy,
 * so an agent would see "they are on the shop" and never "they are on
 * /checkout" — which is the entire point of showing visited pages. And the
 * frame's referrer is the *host page*, never the page the visitor came from;
 * only code running on the host page can see that one (FR-MOD-13.2).
 *
 * Query string and fragment are dropped from both. They are where session
 * tokens, reset links and email addresses live, and a support transcript is the
 * last place those should end up. The path answers the question an agent
 * actually has. Trimming the referrer here, rather than only server-side, means
 * the dropped parts never leave the visitor's browser at all.
 */
function hostPageUrl(win: Window): { origin: string; url: string; referrer: string | null } {
  const { origin, pathname } = win.location;
  return {
    origin,
    url: `${origin}${pathname}`.slice(0, 2048),
    referrer: sanitizeReferrer(win.document.referrer),
  };
}

function clampDimension(value: unknown, min: number, max: number): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  // Zero is the widget saying "nothing to draw" (no launcher, panel closed): the
  // frame gives the corner of the host page back instead of sitting over it.
  if (value === 0) return 0;
  return Math.min(max, Math.max(min, Math.round(value)));
}

// Exposed unconditionally, independent of boot() succeeding — a misconfigured
// `window.__siyahtus` should not also take down the tracking call surface.
if (typeof window !== 'undefined') {
  (window as Window & { siyahtus?: typeof siyahtus }).siyahtus = siyahtus;
}

// Auto-boot when loaded as a plain script tag, but stay inert under test/import.
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => boot(), { once: true });
  } else {
    boot();
  }
}
