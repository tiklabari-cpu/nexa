/**
 * Custom panels — an operator's own page inside the Inbox's right panel
 * (SiyahTuş analysis KN-05 · owner decision K29 · tm 379).
 *
 * An admin registers an `https://` address, the teams whose conversations it
 * appears in, and gets a signing secret. The console embeds the page in a
 * sandboxed frame and, once the page says it is ready, hands it a short-lived
 * token signed with that secret that names the conversation (the page's server
 * verifies it; the console never vouches for anything the token does not say).
 *
 * What the gates are, and why the panel CSP is a broad `frame-src https:`
 * rather than one per tenant (K29): the CSP cannot know the tenant before
 * sign-in, so the real gates are here and on the server —
 *
 *   1. only an admin-saved `https://` address (`customPanelUrlProblem`, the
 *      `custom_panels_url_check` CHECK, the audit trail);
 *   2. the frame is always {@link CUSTOM_PANEL_SANDBOX} — no
 *      `allow-same-origin`, so the page runs in an opaque origin and reaches
 *      nothing of the console's;
 *   3. a message is acted on only when it comes from that frame's own window
 *      and carries the frame's channel nonce (`panelBridge.ts` in the console);
 *   4. the context travels only as a ≤ 5 minute signed token by postMessage —
 *      never in an address (GV-05);
 *   5. the page reads no history and sends nothing: `insert_text` only puts a
 *      suggestion in the composer, the agent sends it.
 *
 * Pure literals and functions only: this module sits in the barrel the widget
 * loader imports, and a top-level call would be carried into it.
 */

/** A panel's name, as the tab-strip and the settings list show it. */
export const CUSTOM_PANEL_NAME_MAX = 60;

/** The longest address a panel may have — the CHECK holds the same bound. */
export const CUSTOM_PANEL_URL_MAX = 2048;

/** Panels per workspace. Each one is a frame on every matching conversation. */
export const CUSTOM_PANELS_MAX = 20;

/** Teams one panel can be limited to. Empty means every team. */
export const CUSTOM_PANEL_GROUPS_MAX = 50;

/** How long a context token lives (KN-05: "≤ 5 dk"). */
export const CUSTOM_PANEL_TOKEN_TTL_SECONDS = 300;

/** Who signs the token — its `iss`. */
export const CUSTOM_PANEL_TOKEN_ISSUER = 'siyahtus';

/**
 * The sandbox every panel frame gets, exactly (K29 gate 2). No
 * `allow-same-origin`: with it, a page could read its own cookies — and, were
 * it ever the console's own origin, lift the sandbox off itself. No
 * `allow-top-navigation`: the page cannot move the console away.
 */
export const CUSTOM_PANEL_SANDBOX = 'allow-scripts allow-forms allow-popups';

/**
 * How a token was handed over: to the embedded frame by postMessage, or in the
 * fragment of the "open in a new tab" address for a back-office that refuses
 * to be framed (`X-Frame-Options: DENY`). A `link` token never names the
 * player — an address is the one place the username must not be (GV-05).
 */
export const CUSTOM_PANEL_TOKEN_DELIVERIES = ['frame', 'link'] as const;
export type CustomPanelTokenDelivery = (typeof CUSTOM_PANEL_TOKEN_DELIVERIES)[number];

/** The token's `aud`: one panel, so a token minted for one is refused by another. */
export function customPanelAudience(panelId: string): string {
  return `siyahtus-panel:${panelId}`;
}

/** The fragment key that carries the frame's channel nonce. */
export const CUSTOM_PANEL_CHANNEL_PARAM = 'siyahtus_channel';

/** The fragment key that carries a `link` token on the new-tab address. */
export const CUSTOM_PANEL_LINK_TOKEN_PARAM = 'siyahtus_token';

/**
 * The bridge's message types. Page → console: `ready`, `resize`,
 * `insert_text`. Console → page: `context`.
 */
export const CUSTOM_PANEL_MESSAGES = Object.freeze({
  ready: 'siyahtus:ready',
  context: 'siyahtus:context',
  resize: 'siyahtus:resize',
  insertText: 'siyahtus:insert_text',
} as const);

/** The longest suggestion a page may put in the composer. */
export const CUSTOM_PANEL_INSERT_TEXT_MAX = 2000;

/** The frame's height bounds, in CSS pixels — `resize` is clamped to them. */
export const CUSTOM_PANEL_HEIGHT_MIN = 120;
export const CUSTOM_PANEL_HEIGHT_MAX = 1200;
export const CUSTOM_PANEL_HEIGHT_DEFAULT = 360;

/**
 * What a context token says. Code names (`chat_id` is the day container the
 * screens call "Thread ID", `thread_id` the connection they call "Chat ID",
 * K1 = A) — a token is read by code, not by people.
 */
export interface CustomPanelTokenClaims {
  iss: typeof CUSTOM_PANEL_TOKEN_ISSUER;
  aud: string;
  /** Seconds since the epoch. */
  iat: number;
  exp: number;
  jti: string;
  delivery: CustomPanelTokenDelivery;
  org_id: string;
  license_id: string;
  panel_id: string;
  chat_id: string;
  thread_id: string | null;
  agent_id: string;
  /**
   * The player as the widget knows them. Absent on a `link` token, and when
   * the agent's role may not see player contact details (RL-02
   * `customers.contact.view`). `username_verified` is true only for an
   * identity the operator's own server signed (ID-03 / K28) — until that
   * exists, a typed username is never verified.
   */
  player?: { username: string | null; username_verified: boolean };
}

export type CustomPanelUrlProblem =
  'invalid' | 'not_https' | 'credentials' | 'fragment' | 'too_long';

/**
 * Why `raw` cannot be a panel address, or null when it can. `https:` only (a
 * console served over TLS frames nothing else, and K29 opens no `http:`); no
 * `user:password@` (it would sit in every agent's DOM); no fragment (the
 * console writes its own channel nonce there).
 */
export function customPanelUrlProblem(raw: string): CustomPanelUrlProblem | null {
  if (raw.length > CUSTOM_PANEL_URL_MAX) return 'too_long';
  if (/\s/.test(raw)) return 'invalid';
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return 'invalid';
  }
  if (url.protocol !== 'https:') return 'not_https';
  if (url.hostname === '') return 'invalid';
  if (url.username !== '' || url.password !== '') return 'credentials';
  if (raw.includes('#')) return 'fragment';
  return null;
}

/** The origin a panel's page runs on, for the "opens …" line and the bridge. */
export function customPanelOrigin(url: string): string {
  return new URL(url).origin;
}
