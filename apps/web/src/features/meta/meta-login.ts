/**
 * Facebook Login for a live Messenger or Instagram channel (tm 381 · KN-02),
 * as pure pieces the connect card, the callback page and their tests share.
 *
 * The card opens Meta's login dialog in a pop-up — no Meta script is loaded
 * into the console, so its Content-Security-Policy stays as it is. Meta's
 * dialog returns to the console's own callback page
 * (`/channels/meta/callback`), which relays the one-time `code` to the opener
 * with the `state` the card minted, so a page that did not start this login
 * cannot finish it. The code is worth nothing alone: only the API, with the
 * app secret, can exchange it — and it answers with pages, never tokens.
 */
import { newSignupState } from '../whatsapp/whatsapp-signup.js';

export type MetaMessagingChannel = 'messenger' | 'instagram';

export interface MetaLoginConfig {
  app_id: string;
  graph_version: string;
  redirect_uri: string;
  scopes: { messenger: string[]; instagram: string[] };
}

export interface MetaPageChoice {
  id: string;
  name: string;
  instagram: { id: string; username: string | null } | null;
}

export interface MetaPageSelection {
  selection_id: string;
  pages: MetaPageChoice[];
}

/** The callback page's message to the card. */
export const META_CALLBACK_MESSAGE_TYPE = 'siyahtus:meta-login';

export interface MetaCallbackMessage {
  type: typeof META_CALLBACK_MESSAGE_TYPE;
  state: string | null;
  code: string | null;
  error: string | null;
}

/** A fresh, unguessable `state` for one login (the same generator as WhatsApp's signup). */
export const newLoginState = newSignupState;

/** Meta's login dialog for this deployment's app, asking the channel's permissions. */
export function loginDialogUrl(
  config: MetaLoginConfig,
  channel: MetaMessagingChannel,
  state: string,
): string {
  const params = new URLSearchParams({
    client_id: config.app_id,
    redirect_uri: config.redirect_uri,
    response_type: 'code',
    scope: config.scopes[channel].join(','),
    state,
  });
  return `https://www.facebook.com/${encodeURIComponent(config.graph_version)}/dialog/oauth?${params.toString()}`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

/** The callback page's message for this login (`state`), or null for anything else on the window. */
export function readMetaCallback(
  origin: string,
  ownOrigin: string,
  data: unknown,
  state: string,
): MetaCallbackMessage | null {
  if (origin !== ownOrigin) return null;
  const message = asRecord(data);
  if (!message || message['type'] !== META_CALLBACK_MESSAGE_TYPE || message['state'] !== state) {
    return null;
  }
  return {
    type: META_CALLBACK_MESSAGE_TYPE,
    state,
    code: typeof message['code'] === 'string' && message['code'] ? message['code'] : null,
    error: typeof message['error'] === 'string' && message['error'] ? message['error'] : null,
  };
}

/** What the callback page reads off its own address. */
export function metaCallbackMessageFrom(search: string): MetaCallbackMessage {
  const params = new URLSearchParams(search);
  return {
    type: META_CALLBACK_MESSAGE_TYPE,
    state: params.get('state'),
    code: params.get('code'),
    error: params.get('error') ?? params.get('error_reason'),
  };
}

/** The pages a channel can be connected to: Instagram needs a linked professional account. */
export function connectablePages(
  pages: readonly MetaPageChoice[],
  channel: MetaMessagingChannel,
): MetaPageChoice[] {
  return channel === 'instagram' ? pages.filter((page) => page.instagram !== null) : [...pages];
}
