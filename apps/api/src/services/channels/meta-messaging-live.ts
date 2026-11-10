/**
 * Messenger and Instagram as real channels (tm 381 · KN-02 · FR-MOD-08.5.4 ·
 * FR-MOD-08.5.7) — the Graph calls and the webhook's reader.
 *
 * Switched on per channel by `messenger` / `instagram` in
 * `APPS_LIVE_PROVIDERS`, with the deployment's Meta app set (the same app as
 * WhatsApp, tm 380 — `WHATSAPP_APP_ID` / `_APP_SECRET` / `_VERIFY_TOKEN`);
 * otherwise the mock adapters (`messenger.ts`, `instagram.ts`) run exactly as
 * before. Live, the two differ from the mock where Meta forces it to:
 *
 *   - **Connect** is Facebook Login. The Settings card opens Meta's dialog
 *     with this deployment's app; the login's one-time `code` becomes a user
 *     token, made long-lived, which lists the pages the person manages — each
 *     with its page access token and the Instagram professional account linked
 *     to it. The admin chooses a page; its token is kept encrypted on the
 *     channel row and the app is subscribed to the page's `messages` and
 *     `messaging_postbacks`. Instagram Messaging rides on the same page: the
 *     account is reached through the page it is linked to.
 *   - **Inbound** is one webhook for both (`/channels/meta/messaging-webhook`),
 *     signed with the app secret exactly as WhatsApp's (`meta-graph.ts`).
 *     `object` is `page` or `instagram`; each item names the recipient (the
 *     page id / Instagram account id — the channel address) and the sender's
 *     page-scoped id (PSID / IGSID). Those ids are per page: the same person on
 *     two pages is two customers here, as at Meta (joining them is ID-03's
 *     work). The message id (`mid`) is the deduplication key.
 *   - **Outbound** is `POST /{page_id}/messages` with `messaging_type:
 *     RESPONSE` — free text inside the 24 hours after the customer's last
 *     message. The `HUMAN_AGENT` tag (seven days) is a separate Meta
 *     permission and out of scope (05 KN-02), so past the window the composer
 *     is locked, as for WhatsApp.
 *
 * Endpoints per developers.facebook.com/docs/messenger-platform and
 * /docs/instagram-platform/instagram-api-with-facebook-login. Every call goes
 * through the safe client, via the shared {@link MetaGraphClient}.
 */
import { z } from 'zod';
import { ApiError } from '../../lib/api-error.js';
import type { ProviderContext } from '../apps/verifiers/types.js';
import {
  MetaGraphClient,
  MetaGraphError,
  MetaGraphUnreachableError,
  metaSignatureMatches,
  verifyMetaSubscription,
} from './meta-graph.js';
import { splitText } from './split-text.js';

export const META_MESSAGING_CHANNELS = ['messenger', 'instagram'] as const;
export type MetaMessagingChannel = (typeof META_MESSAGING_CHANNELS)[number];

export function isMetaMessagingChannel(value: string): value is MetaMessagingChannel {
  return (META_MESSAGING_CHANNELS as readonly string[]).includes(value);
}

/** Meta's ceiling for one text message: Messenger 2000 characters, Instagram 1000. */
export const META_TEXT_MAX: Readonly<Record<MetaMessagingChannel, number>> = {
  messenger: 2000,
  instagram: 1000,
};

/** How long a page may answer freely after the customer's last message. */
export const META_REPLY_WINDOW_MS = 24 * 60 * 60 * 1000;

/** How long the pages a login opened wait to be chosen from. */
export const META_SELECTION_TTL_SECONDS = 600;

/**
 * The permissions each channel asks Facebook Login for: list the pages, read
 * and answer their messages, subscribe the app to their webhooks.
 */
export const META_LOGIN_SCOPES: Readonly<Record<MetaMessagingChannel, readonly string[]>> = {
  messenger: ['pages_show_list', 'pages_manage_metadata', 'pages_messaging', 'business_management'],
  instagram: [
    'pages_show_list',
    'pages_manage_metadata',
    'pages_messaging',
    'instagram_basic',
    'instagram_manage_messages',
    'business_management',
  ],
};

/** How the channel names itself in the inbox when a message has no text of its own. */
const CHANNEL_LABEL: Readonly<Record<MetaMessagingChannel, string>> = {
  messenger: 'Messenger',
  instagram: 'Instagram',
};

/** The deployment's Meta app, as `config/env.ts` resolved it. */
export interface MetaAppConfig {
  appId: string;
  appSecret: string;
  verifyToken: string;
  graphVersion: string;
}

/** What the Settings card needs to open Facebook Login. */
export interface MetaLoginConfig {
  app_id: string;
  graph_version: string;
  redirect_uri: string;
  scopes: { messenger: string[]; instagram: string[] };
}

/** A page the login opened, with its token — server-side only. */
export interface MetaPage {
  id: string;
  name: string;
  accessToken: string;
  instagram: { id: string; username: string | null } | null;
}

/** A page as the card sees it: no token. */
export interface MetaPageChoice {
  id: string;
  name: string;
  instagram: { id: string; username: string | null } | null;
}

export function pageChoice(page: MetaPage): MetaPageChoice {
  return { id: page.id, name: page.name, instagram: page.instagram };
}

/** One customer message, normalised and ready for the inbox. */
export interface MetaInboundMessage {
  channel: MetaMessagingChannel;
  /** The page id / Instagram account id it reached — the channel address. */
  address: string;
  /** The sender's page-scoped id (PSID / IGSID). */
  senderId: string;
  /** Meta's message id — the deduplication key. */
  mid: string;
  /** When the customer sent it (Meta's timestamp), ISO 8601. */
  at: string;
  /** What a person reads; never empty. */
  text: string;
}

// --- Webhook body ------------------------------------------------------------

const idString = z.string().min(1).max(256);

const messagingSchema = z
  .object({
    sender: z.object({ id: idString }).passthrough(),
    recipient: z.object({ id: idString }).passthrough(),
    timestamp: z.number().int().nonnegative(),
    message: z
      .object({
        mid: idString,
        text: z.string().max(10_000).optional(),
        is_echo: z.boolean().optional(),
        is_deleted: z.boolean().optional(),
        is_unsupported: z.boolean().optional(),
        attachments: z
          .array(z.object({ type: z.string().max(40) }).passthrough())
          .max(20)
          .optional(),
        reply_to: z.object({ story: z.unknown().optional() }).passthrough().optional(),
      })
      .passthrough()
      .optional(),
    postback: z
      .object({
        mid: idString.optional(),
        title: z.string().max(1000).optional(),
        payload: z.string().max(1000).optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

const webhookSchema = z.object({
  object: z.enum(['page', 'instagram']),
  entry: z
    .array(
      z
        .object({
          id: z.string().max(256).optional(),
          messaging: z.array(z.unknown()).max(100).optional(),
        })
        .passthrough(),
    )
    .max(100),
});

/** What an attachment says in the inbox: the file stays at Meta (not fetched in F1). */
function attachmentText(channel: MetaMessagingChannel, type: string): string {
  if (type === 'story_mention') return '[Instagram story mention]';
  const kind = /^[a-z_]{1,40}$/.test(type) ? type.replace(/_/g, ' ') : 'attachment';
  return `[${CHANNEL_LABEL[channel]} ${kind}]`;
}

function normaliseMessaging(
  channel: MetaMessagingChannel,
  entryId: string | undefined,
  raw: unknown,
): MetaInboundMessage | null {
  const parsed = messagingSchema.safeParse(raw);
  if (!parsed.success) return null;
  const item = parsed.data;
  const senderId = item.sender.id;
  const address = item.recipient.id;
  // The page's own messages come back as echoes (and, on Instagram, with the
  // account as sender): not the customer's, never taken in.
  if (senderId === address || (entryId !== undefined && senderId === entryId)) return null;
  const base = {
    channel,
    address,
    senderId,
    at: new Date(Math.min(item.timestamp, 8_640_000_000_000_000)).toISOString(),
  };

  if (item.message) {
    const message = item.message;
    if (message.is_echo || message.is_deleted) return null;
    const parts: string[] = [];
    if (message.reply_to?.story !== undefined) parts.push('[Story reply]');
    const text = message.text?.trim();
    if (text) parts.push(text);
    for (const attachment of message.attachments ?? []) {
      parts.push(attachmentText(channel, attachment.type));
    }
    if (parts.length === 0 || (parts.length === 1 && parts[0] === '[Story reply]')) {
      parts.push(`[${CHANNEL_LABEL[channel]} message]`);
    }
    return { ...base, mid: message.mid, text: parts.join(' ') };
  }

  if (item.postback) {
    // A button the customer pressed (EN-02's `send_message` buttons map onto
    // these): its title is what they "said". Older deliveries carry no mid;
    // sender and time are then the key, which a redelivery repeats exactly.
    const postback = item.postback;
    const text = postback.title?.trim() || postback.payload?.trim() || '[button]';
    return {
      ...base,
      mid: postback.mid ?? `postback.${senderId}.${item.timestamp}`,
      text,
    };
  }

  // Delivery and read receipts, reactions, referrals, handovers: nothing a
  // person reads in the inbox.
  return null;
}

/**
 * A webhook body as messages. A body that is not a Messenger or Instagram
 * webhook at all is a 400; a single item inside it that does not read is
 * skipped, so one odd item does not lose its batch.
 */
export function parseMetaMessagingWebhook(body: unknown): MetaInboundMessage[] {
  const parsed = webhookSchema.safeParse(body);
  if (!parsed.success) throw ApiError.validation('Not a Messenger or Instagram webhook.');
  const channel: MetaMessagingChannel = parsed.data.object === 'page' ? 'messenger' : 'instagram';
  const messages: MetaInboundMessage[] = [];
  for (const entry of parsed.data.entry) {
    for (const raw of entry.messaging ?? []) {
      const message = normaliseMessaging(channel, entry.id, raw);
      if (message) messages.push(message);
    }
  }
  return messages;
}

// --- The Graph calls -----------------------------------------------------------

export class MetaMessagingLive {
  readonly graph: MetaGraphClient;

  constructor(
    context: ProviderContext,
    readonly config: MetaAppConfig,
    /** `WEB_APP_URL` — where Meta's dialog sends the browser back. */
    private readonly webAppUrl: string,
    /** Which of the two this deployment runs live. */
    readonly channels: readonly MetaMessagingChannel[],
  ) {
    this.graph = new MetaGraphClient(context, config.appSecret, config.graphVersion);
  }

  runs(type: string): type is MetaMessagingChannel {
    return (this.channels as readonly string[]).includes(type);
  }

  /** The browser's way back from Meta's dialog: a page of the panel, which posts the code to the card. */
  get redirectUri(): string {
    return `${this.webAppUrl.replace(/\/+$/, '')}/channels/meta/callback`;
  }

  loginConfig(): MetaLoginConfig {
    return {
      app_id: this.config.appId,
      graph_version: this.config.graphVersion,
      redirect_uri: this.redirectUri,
      scopes: {
        messenger: [...META_LOGIN_SCOPES.messenger],
        instagram: [...META_LOGIN_SCOPES.instagram],
      },
    };
  }

  verifySubscription(
    mode: string | undefined,
    token: string | undefined,
    challenge: string | undefined,
  ): string | null {
    return verifyMetaSubscription(this.config.verifyToken, mode, token, challenge);
  }

  signatureMatches(rawBody: Buffer, header: string | undefined): boolean {
    return metaSignatureMatches(this.config.appSecret, rawBody, header);
  }

  /** The login's code → a long-lived user token (what reads non-expiring page tokens). */
  async userTokenFromCode(code: string): Promise<string> {
    const shortLived = await this.graph.exchangeCode(this.config.appId, this.redirectUri, code);
    return this.graph.longLivedUserToken(this.config.appId, shortLived);
  }

  /** The pages the person manages, each with its token and linked Instagram account. */
  async pages(userToken: string): Promise<MetaPage[]> {
    const query = new URLSearchParams({
      // url-pii-ok: Graph's field selector (names of fields to return), no person's data
      fields: 'id,name,access_token,instagram_business_account{id,username}',
      limit: '100',
    });
    const answer = (await this.graph.call(
      'GET',
      `/me/accounts?${query.toString()}`,
      userToken,
    )) as {
      data?: unknown;
    };
    const rows = Array.isArray(answer?.data) ? answer.data : [];
    const pages: MetaPage[] = [];
    for (const raw of rows) {
      const row = raw as {
        id?: unknown;
        name?: unknown;
        access_token?: unknown;
        instagram_business_account?: { id?: unknown; username?: unknown } | null;
      };
      if (typeof row.id !== 'string' || typeof row.access_token !== 'string') continue;
      if (!/^[0-9]{1,32}$/.test(row.id) || !row.access_token) continue;
      const ig = row.instagram_business_account;
      pages.push({
        id: row.id,
        name: typeof row.name === 'string' ? row.name.slice(0, 120) : row.id,
        accessToken: row.access_token,
        instagram:
          ig && typeof ig.id === 'string' && /^[0-9]{1,32}$/.test(ig.id)
            ? {
                id: ig.id,
                username: typeof ig.username === 'string' ? ig.username.slice(0, 120) : null,
              }
            : null,
      });
    }
    return pages;
  }

  /** Subscribe this app to the page's messages and button presses — what makes them arrive. */
  async subscribePage(pageToken: string, pageId: string): Promise<void> {
    await this.graph.call('POST', `/${encodeURIComponent(pageId)}/subscribed_apps`, pageToken, [], {
      subscribed_fields: 'messages,messaging_postbacks',
    });
  }

  /**
   * Send free text as a response (`messaging_type: RESPONSE`), split at the
   * channel's per-message limit. Answers the last message id.
   */
  async sendText(
    pageToken: string,
    pageId: string,
    type: MetaMessagingChannel,
    recipientId: string,
    text: string,
  ): Promise<string> {
    const max = META_TEXT_MAX[type];
    let last = '';
    for (const part of splitText(text, max)) {
      const answer = (await this.graph.call(
        'POST',
        `/${encodeURIComponent(pageId)}/messages`,
        pageToken,
        [],
        { recipient: { id: recipientId }, messaging_type: 'RESPONSE', message: { text: part } },
      )) as { message_id?: unknown };
      const id = answer?.message_id;
      if (typeof id !== 'string' || !id) {
        throw new MetaGraphError(200, null, 'no message id in the answer');
      }
      last = id;
    }
    return last;
  }
}

/** A refused or failed login / connect step as the API answers it — never Meta's raw text with a secret. */
export function metaConnectError(error: unknown, label: string): ApiError {
  if (error instanceof MetaGraphError) {
    const details = {
      reason: 'app_credentials_invalid',
      ...(error.code !== null ? { provider_code: error.code } : {}),
      ...(error.providerMessage ? { provider_message: error.providerMessage } : {}),
    };
    if (error.httpStatus >= 500) {
      return new ApiError('service_unavailable', `${label} could not be reached. Try again.`, {
        details: { ...details, reason: 'app_provider_unavailable' },
      });
    }
    return ApiError.validation(`Meta did not accept this ${label} login.`, details);
  }
  if (error instanceof MetaGraphUnreachableError) {
    return new ApiError('service_unavailable', `${label} could not be reached. Try again.`, {
      details: { reason: 'app_provider_unavailable' },
    });
  }
  if (error instanceof ApiError) return error;
  return ApiError.internal(`${label} connect failed.`);
}

/**
 * The live Messenger / Instagram this deployment runs, or `null` for the
 * mocks: `messenger` and/or `instagram` in `APPS_LIVE_PROVIDERS` — which
 * `config/env.ts` keeps only with the Meta app's three values and a usable
 * `APPS_CREDENTIAL_KEY`.
 */
export function createLiveMetaMessaging(
  env: {
    APPS_LIVE_PROVIDERS: readonly string[];
    APPS_CREDENTIAL_KEY?: string | undefined;
    WHATSAPP_APP_ID?: string | undefined;
    WHATSAPP_APP_SECRET?: string | undefined;
    WHATSAPP_VERIFY_TOKEN?: string | undefined;
    WHATSAPP_GRAPH_VERSION: string;
    WEB_APP_URL: string;
  },
  context: ProviderContext,
): { live: MetaMessagingLive; credentialKey: string } | null {
  const channels = META_MESSAGING_CHANNELS.filter((id) => env.APPS_LIVE_PROVIDERS.includes(id));
  if (
    channels.length === 0 ||
    !env.APPS_CREDENTIAL_KEY ||
    !env.WHATSAPP_APP_ID ||
    !env.WHATSAPP_APP_SECRET ||
    !env.WHATSAPP_VERIFY_TOKEN
  ) {
    return null;
  }
  return {
    live: new MetaMessagingLive(
      context,
      {
        appId: env.WHATSAPP_APP_ID,
        appSecret: env.WHATSAPP_APP_SECRET,
        verifyToken: env.WHATSAPP_VERIFY_TOKEN,
        graphVersion: env.WHATSAPP_GRAPH_VERSION,
      },
      env.WEB_APP_URL,
      channels,
    ),
    credentialKey: env.APPS_CREDENTIAL_KEY,
  };
}
