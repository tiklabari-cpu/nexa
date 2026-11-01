/**
 * Meta's embedded signup for a live WhatsApp channel (tm 380 · KN-01), as pure
 * pieces the connect card and its tests share.
 *
 * The card opens Meta's dialog in a pop-up — no Meta script is loaded into the
 * console, so the console's Content-Security-Policy stays as it is. Two
 * messages come back to the card while the pop-up is open:
 *
 *   - **Session info** from Meta's own page (`*.facebook.com`), a JSON string
 *     `{ type: 'WA_EMBEDDED_SIGNUP', event: 'FINISH', data: { phone_number_id,
 *     waba_id } }` — which account and number the business chose, or `CANCEL`
 *     / `ERROR`.
 *   - **The code** from the console's own callback page
 *     (`/channels/whatsapp/callback`, where Meta's dialog returns), relayed to
 *     the opener with the `state` the card minted — so a page that did not
 *     start this signup cannot finish it.
 *
 * Neither is trusted alone: the API exchanges the code itself and checks that
 * the number belongs to the account the code opens.
 */

export interface WhatsAppSignupConfig {
  app_id: string;
  config_id: string;
  graph_version: string;
  redirect_uri: string;
}

/** What the card posts to `POST /channels/whatsapp/connect`. */
export interface WhatsAppConnectBody {
  code: string;
  waba_id: string;
  phone_number_id: string;
}

/** The callback page's message to the card. */
export const CALLBACK_MESSAGE_TYPE = 'siyahtus:whatsapp-signup';

export interface CallbackMessage {
  type: typeof CALLBACK_MESSAGE_TYPE;
  state: string | null;
  code: string | null;
  error: string | null;
}

/** Where Meta's own pages post from. */
const META_ORIGIN = /^https:\/\/([a-z0-9-]+\.)*facebook\.com$/;

export function isMetaOrigin(origin: string): boolean {
  return META_ORIGIN.test(origin);
}

/** Meta's dialog for this deployment's app and signup configuration. */
export function signupDialogUrl(config: WhatsAppSignupConfig, state: string): string {
  const params = new URLSearchParams({
    client_id: config.app_id,
    config_id: config.config_id,
    redirect_uri: config.redirect_uri,
    response_type: 'code',
    override_default_response_type: 'true',
    state,
    extras: JSON.stringify({ setup: {}, featureType: '', sessionInfoVersion: '3' }),
  });
  return `https://www.facebook.com/${encodeURIComponent(config.graph_version)}/dialog/oauth?${params.toString()}`;
}

/** A fresh, unguessable `state` for one signup. */
export function newSignupState(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export type SessionInfo =
  | { kind: 'finish'; wabaId: string; phoneNumberId: string }
  | { kind: 'cancel' }
  | { kind: 'error' };

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value === 'string') {
    try {
      return asRecord(JSON.parse(value));
    } catch {
      return null;
    }
  }
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

/** Meta's session-info message, or null for anything else on the window. */
export function readSessionInfo(origin: string, data: unknown): SessionInfo | null {
  if (!isMetaOrigin(origin)) return null;
  const message = asRecord(data);
  if (!message || message['type'] !== 'WA_EMBEDDED_SIGNUP') return null;
  const event = message['event'];
  if (event === 'CANCEL') return { kind: 'cancel' };
  if (event === 'ERROR') return { kind: 'error' };
  if (typeof event !== 'string' || !event.startsWith('FINISH')) return null;
  const payload = asRecord(message['data']);
  const wabaId = payload?.['waba_id'];
  const phoneNumberId = payload?.['phone_number_id'];
  if (typeof wabaId !== 'string' || typeof phoneNumberId !== 'string') return { kind: 'error' };
  return { kind: 'finish', wabaId, phoneNumberId };
}

/** The callback page's message for this signup (`state`), or null. */
export function readCallback(
  origin: string,
  ownOrigin: string,
  data: unknown,
  state: string,
): CallbackMessage | null {
  if (origin !== ownOrigin) return null;
  const message = asRecord(data);
  if (!message || message['type'] !== CALLBACK_MESSAGE_TYPE || message['state'] !== state) {
    return null;
  }
  return {
    type: CALLBACK_MESSAGE_TYPE,
    state,
    code: typeof message['code'] === 'string' && message['code'] ? message['code'] : null,
    error: typeof message['error'] === 'string' && message['error'] ? message['error'] : null,
  };
}

/** What the callback page reads off its own address. */
export function callbackMessageFrom(search: string): CallbackMessage {
  const params = new URLSearchParams(search);
  return {
    type: CALLBACK_MESSAGE_TYPE,
    state: params.get('state'),
    code: params.get('code'),
    error: params.get('error') ?? params.get('error_reason'),
  };
}
