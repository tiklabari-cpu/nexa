/**
 * Nexa widget loader — the only script that runs on the customer's own page.
 *
 * Responsibilities, and nothing else:
 *   1. read config from `window.__nexa`
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

export interface NexaWidgetConfig {
  /** Tenant this widget talks to. */
  organizationId: string;
  /** Origin serving the widget iframe, e.g. `https://widget.nexa.example`. */
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
  /** The removable "Powered by Nexa" footer (FR-MOD-11.5). */
  poweredBy?: boolean;
}

/** Below this host-viewport width the widget is treated as being on a phone. */
const MOBILE_MAX_WIDTH = 480;

interface NexaGlobal extends NexaWidgetConfig {
  open?: () => void;
  close?: () => void;
  destroy?: () => void;
}

/** Messages the iframe is allowed to send outward. Anything else is dropped. */
const ALLOWED_INBOUND = new Set(['nexa:ready', 'nexa:resize', 'nexa:open', 'nexa:close']);

const IFRAME_ID = 'nexa-widget-frame';

export function boot(win: Window & { __nexa?: NexaGlobal } = window as never): (() => void) | null {
  const config = win.__nexa;
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
  frame.src = buildFrameUrl(widgetOrigin, config, hostPageUrl(win));

  const corner = config.position === 'bottom-left' ? 'left' : 'right';

  Object.assign(frame.style, {
    position: 'fixed',
    bottom: '16px',
    [corner]: '16px',
    width: '84px',
    height: '84px',
    border: '0',
    zIndex: '2147483000',
    colorScheme: 'normal',
    background: 'transparent',
  } satisfies Partial<CSSStyleDeclaration> as Record<string, string>);

  win.document.body.appendChild(frame);

  // The frame's own idea of how big it wants to be, updated by `nexa:resize`.
  // Geometry is recomputed from these plus whether the panel is open, so that
  // opening on a phone can fill the viewport (FR-MOD-11.7, "mobil tam ekran")
  // rather than leave a 380 px card overhanging a 360 px screen.
  let wantWidth = 84;
  let wantHeight = 84;
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
      });
      return;
    }
    // Floating card in its corner — the default everywhere but a phone.
    frame.style.top = '';
    frame.style[corner] = '16px';
    frame.style[corner === 'left' ? 'right' : 'left'] = '';
    frame.style.bottom = '16px';
    frame.style.width = `${wantWidth}px`;
    frame.style.height = `${wantHeight}px`;
  };

  const onMessage = (event: MessageEvent): void => {
    // Both checks matter: the origin proves who sent it, the source proves it
    // came from our frame rather than another one on the same origin.
    if (event.origin !== widgetOrigin) return;
    if (event.source !== frame.contentWindow) return;

    const data = event.data as { type?: unknown; height?: unknown; width?: unknown };
    if (typeof data?.type !== 'string' || !ALLOWED_INBOUND.has(data.type)) return;

    if (data.type === 'nexa:open') open = true;
    if (data.type === 'nexa:close') open = false;

    if (data.type === 'nexa:resize') {
      const height = clampDimension(data.height, 84, 720);
      const width = clampDimension(data.width, 84, 420);
      if (height) wantHeight = height;
      if (width) wantWidth = width;
    }

    applyGeometry();
  };

  win.addEventListener('message', onMessage);

  const post = (type: string): void => {
    frame.contentWindow?.postMessage({ type }, widgetOrigin);
  };
  config.open = () => post('nexa:host-open');
  config.close = () => post('nexa:host-close');

  const destroy = (): void => {
    win.removeEventListener('message', onMessage);
    frame.remove();
    delete config.open;
    delete config.close;
    delete config.destroy;
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
  config: NexaWidgetConfig,
  host: { origin: string; url: string },
): string {
  const url = new URL('/widget.html', origin);
  url.searchParams.set('organization_id', config.organizationId);
  // The embedding page's origin, which only code running on that page knows.
  // The widget forwards it so the API can check it against the organization's
  // trusted domains — see the note on `host_origin` in the token route.
  url.searchParams.set('host_origin', host.origin);
  url.searchParams.set('host_url', host.url);
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

/**
 * The embedded page, as origin + path.
 *
 * The widget cannot work this out for itself: `document.referrer` inside a
 * cross-origin frame is trimmed to the origin by the default referrer policy,
 * so an agent would see "they are on the shop" and never "they are on
 * /checkout" — which is the entire point of showing visited pages.
 *
 * Query string and fragment are dropped. They are where session tokens, reset
 * links and email addresses live, and a support transcript is the last place
 * those should end up. The path answers the question an agent actually has.
 */
function hostPageUrl(win: Window): { origin: string; url: string } {
  const { origin, pathname } = win.location;
  return { origin, url: `${origin}${pathname}`.slice(0, 2048) };
}

function clampDimension(value: unknown, min: number, max: number): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.min(max, Math.max(min, Math.round(value)));
}

// Auto-boot when loaded as a plain script tag, but stay inert under test/import.
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => boot(), { once: true });
  } else {
    boot();
  }
}
