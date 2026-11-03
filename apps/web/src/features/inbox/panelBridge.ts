/**
 * The postMessage bridge between the console and a custom panel's page
 * (KN-05 · owner decision K29 · tm 379). Pure functions; `CustomPanelsSection`
 * wires them to a frame.
 *
 * **Which messages are acted on.** Only one that comes from *this frame's own
 * window* (`event.source === iframe.contentWindow`) and carries *this frame's
 * channel nonce* — a random value the console writes into the frame address's
 * fragment and nowhere else. Its `event.origin` must be the panel's registered
 * origin or `"null"`, and nothing else:
 *
 *   The frame is sandboxed without `allow-same-origin` (K29 gate 2), and a
 *   browser gives such a document an *opaque* origin — its messages arrive
 *   with `origin === "null"`, never `https://backoffice.example`. A literal
 *   `event.origin === new URL(panel.url).origin` would therefore refuse every
 *   message the real panel sends. The registered origin is still accepted
 *   (a browser that ever reports it, or a future `allow-same-origin`
 *   decision), any *other* origin is refused, and the two checks that do the
 *   work for an opaque origin are the window identity and the nonce: a page
 *   the frame was navigated to never saw the fragment the console wrote, and
 *   another window (a pop-up, a second frame, the console itself) is not this
 *   frame's window.
 *
 * **Replies** go to the frame's window with target `'*'` — the only target
 * that reaches an opaque origin — and only in answer to an accepted `ready`,
 * so the token goes to the document that just proved it holds the nonce.
 *
 * **What a page can do:** be told the conversation (a ≤ 5 minute signed
 * token), ask to be taller or shorter (clamped), and put a suggestion in the
 * composer (`insert_text` → `offerDraft`; the agent sends it, or not). It
 * cannot read the transcript and cannot send a message.
 */
import {
  CUSTOM_PANEL_CHANNEL_PARAM,
  CUSTOM_PANEL_HEIGHT_MAX,
  CUSTOM_PANEL_HEIGHT_MIN,
  CUSTOM_PANEL_INSERT_TEXT_MAX,
  CUSTOM_PANEL_LINK_TOKEN_PARAM,
  CUSTOM_PANEL_MESSAGES,
} from '@siyahtus/types';

/** What the console knows about the frame it is listening to. */
export interface PanelFrame {
  /** `iframe.contentWindow` — the only window whose messages count. */
  window: MessageEventSource | null;
  /** The registered panel URL's origin. */
  origin: string;
  /** The nonce written into this frame's address. */
  channel: string;
}

export type PanelMessage =
  { type: 'ready' } | { type: 'resize'; height: number } | { type: 'insert_text'; text: string };

/** The opaque origin a sandboxed frame without `allow-same-origin` reports. */
const OPAQUE_ORIGIN = 'null';

/** 128 random bits, URL-safe. */
export function newPanelChannel(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * The frame's address: the registered URL, untouched, plus the channel nonce
 * in the fragment — which no request carries, so the page's server logs and
 * any `Referer` never see it. No player data goes here (GV-05).
 */
export function panelFrameSrc(url: string, channel: string): string {
  return `${url}#${CUSTOM_PANEL_CHANNEL_PARAM}=${encodeURIComponent(channel)}`;
}

/**
 * The "open in a new tab" address: the registered URL plus a `link` token in
 * the fragment. A `link` token never names the player (the server leaves
 * `player` out), so the username is in no address either way.
 */
export function panelLinkHref(url: string, token: string): string {
  return `${url}#${CUSTOM_PANEL_LINK_TOKEN_PARAM}=${encodeURIComponent(token)}`;
}

export function clampPanelHeight(height: number): number {
  return Math.min(CUSTOM_PANEL_HEIGHT_MAX, Math.max(CUSTOM_PANEL_HEIGHT_MIN, Math.round(height)));
}

/**
 * The message, when it is one the console acts on; otherwise null — and a
 * null is silent: a page that sends junk learns nothing about why.
 */
export function readPanelMessage(
  event: Pick<MessageEvent, 'source' | 'origin' | 'data'>,
  frame: PanelFrame,
): PanelMessage | null {
  if (frame.window === null || event.source !== frame.window) return null;
  if (event.origin !== frame.origin && event.origin !== OPAQUE_ORIGIN) return null;
  const data: unknown = event.data;
  if (typeof data !== 'object' || data === null) return null;
  const message = data as { type?: unknown; channel?: unknown; height?: unknown; text?: unknown };
  if (typeof message.channel !== 'string' || message.channel !== frame.channel) return null;
  switch (message.type) {
    case CUSTOM_PANEL_MESSAGES.ready:
      return { type: 'ready' };
    case CUSTOM_PANEL_MESSAGES.resize:
      return typeof message.height === 'number' && Number.isFinite(message.height)
        ? { type: 'resize', height: clampPanelHeight(message.height) }
        : null;
    case CUSTOM_PANEL_MESSAGES.insertText: {
      if (typeof message.text !== 'string') return null;
      const text = message.text.slice(0, CUSTOM_PANEL_INSERT_TEXT_MAX);
      return text.trim() === '' ? null : { type: 'insert_text', text };
    }
    default:
      return null;
  }
}

/** The answer to `ready`: the token and when it stops working. */
export function contextMessage(
  channel: string,
  token: string,
  expiresAt: string,
): { type: string; channel: string; token: string; expires_at: string } {
  return { type: CUSTOM_PANEL_MESSAGES.context, channel, token, expires_at: expiresAt };
}
