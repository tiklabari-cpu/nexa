/**
 * WhatsApp as a real channel over the Cloud API (tm 380 · KN-01 ·
 * FR-MOD-08.5.6) — the Graph API client and the webhook's reader.
 *
 * Switched on by `whatsapp` in `APPS_LIVE_PROVIDERS` with the four
 * `WHATSAPP_*` values set (`config/env.ts`); otherwise the mock adapter
 * (`whatsapp.ts`) runs exactly as before. Live, the channel differs from the
 * mock where Meta forces it to:
 *
 *   - **Connect** is Meta's embedded signup. The Settings card opens Meta's
 *     dialog with this deployment's app and signup configuration; the business
 *     owner picks or creates a WhatsApp Business account and number there; the
 *     card gets back a one-time `code` plus the account (WABA) and phone number
 *     ids. Here the code becomes the business token, the number is checked to
 *     belong to that account (the ids from the browser are never trusted on
 *     their own), and the app is subscribed to the account's webhooks. The
 *     token is kept encrypted on the channel row.
 *   - **Inbound** is one webhook for the whole Meta app
 *     (`/channels/whatsapp/cloud-webhook`), not one per channel: Meta signs
 *     every delivery with the app secret (`X-Hub-Signature-256`, HMAC-SHA256 of
 *     the raw body) and names the business number it reached
 *     (`metadata.phone_number_id`), which is what resolves the workspace.
 *   - **Outbound** is `POST /{phone_number_id}/messages`, free text only: a
 *     business may answer freely for 24 hours after the customer's last message
 *     and only with an approved template after that. F1 sends no templates (05
 *     KN-01 decision 3), so past the window the composer is locked instead.
 *
 * Endpoints per developers.facebook.com/docs/whatsapp/cloud-api. Every call
 * goes through the safe client (`lib/safe-fetch.ts`): https only, no redirect,
 * bounded, and no URL in an error — the code exchange carries the app secret in
 * its query string.
 */
import { z } from 'zod';
import { ApiError } from '../../lib/api-error.js';
import { SafeHttpError } from '../../lib/safe-fetch.js';
import type { ProviderContext } from '../apps/verifiers/types.js';
import {
  MetaGraphClient,
  MetaGraphError,
  MetaGraphUnreachableError,
  metaSignatureMatches,
  verifyMetaSubscription,
} from './meta-graph.js';

export { GRAPH_INVALID_TOKEN, GRAPH_REENGAGEMENT_REQUIRED } from './meta-graph.js';

/** Meta's ceiling for one text message; a longer reply goes out in parts. */
export const WHATSAPP_TEXT_MAX = 4096;

/** How long a business may answer freely after the customer's last message. */
export const WHATSAPP_REPLY_WINDOW_MS = 24 * 60 * 60 * 1000;

/** The deployment's Meta app, as `config/env.ts` resolved it. */
export interface WhatsAppAppConfig {
  appId: string;
  appSecret: string;
  verifyToken: string;
  configId: string;
  graphVersion: string;
}

/** What the Settings card needs to open the embedded signup. */
export interface WhatsAppSignupConfig {
  app_id: string;
  config_id: string;
  graph_version: string;
  /** Where Meta's dialog sends the browser back with the code. */
  redirect_uri: string;
}

/** One customer message, normalised and ready for the inbox. */
export interface WhatsAppInboundMessage {
  /** Meta's message id (`wamid.…`) — the deduplication key. */
  wamid: string;
  /** The sender's WhatsApp id: their number in international form, digits only. */
  from: string;
  profileName: string | null;
  /** When the customer sent it (Meta's timestamp), ISO 8601. */
  at: string;
  /** Meta's message type (`text`, `image`, `interactive`, …). */
  type: string;
  /** The text a person reads: the body, a caption, a button's title; may be empty. */
  text: string;
  /** A file Meta holds for this message, fetched later by id. */
  media: { id: string; mime: string; filename: string | null } | null;
}

export const WHATSAPP_STATUSES = ['sent', 'delivered', 'read', 'failed'] as const;
export type WhatsAppStatus = (typeof WHATSAPP_STATUSES)[number];

/** What Meta said about a message the workspace sent. */
export interface WhatsAppStatusUpdate {
  wamid: string;
  status: WhatsAppStatus;
  at: string;
  recipient: string;
  /** Meta's error code on a `failed` status, else null. */
  errorCode: number | null;
}

/** One business number's share of a webhook delivery. */
export interface WhatsAppWebhookBatch {
  phoneNumberId: string;
  messages: WhatsAppInboundMessage[];
  statuses: WhatsAppStatusUpdate[];
}

/**
 * A Graph call Meta refused, with Meta's own code (190 = the token is gone) —
 * the one error every Meta channel shares since tm 381 (`meta-graph.ts`).
 */
export const WhatsAppGraphError = MetaGraphError;
export type WhatsAppGraphError = MetaGraphError;

/** Graph could not be reached at all: timeout, DNS, TLS, a redirect, too large. */
export const WhatsAppUnreachableError = MetaGraphUnreachableError;
export type WhatsAppUnreachableError = MetaGraphUnreachableError;

// --- Webhook body ------------------------------------------------------------

const idString = z.string().min(1).max(256);
const mediaSchema = z.object({
  id: idString,
  mime_type: z.string().max(255).optional(),
  caption: z.string().max(10_000).optional(),
  filename: z.string().max(1024).optional(),
});

const messageSchema = z
  .object({
    id: idString,
    from: z.string().regex(/^[0-9]{3,20}$/),
    timestamp: z.string().regex(/^[0-9]{1,12}$/),
    type: z.string().max(40),
    text: z.object({ body: z.string().max(10_000) }).optional(),
    image: mediaSchema.optional(),
    document: mediaSchema.optional(),
    audio: mediaSchema.optional(),
    video: mediaSchema.optional(),
    sticker: mediaSchema.optional(),
    interactive: z
      .object({
        type: z.string().max(40),
        button_reply: z.object({ id: z.string().max(256), title: z.string().max(256) }).optional(),
        list_reply: z
          .object({
            id: z.string().max(256),
            title: z.string().max(256),
            description: z.string().max(1024).optional(),
          })
          .optional(),
      })
      .optional(),
    button: z
      .object({ text: z.string().max(256).optional(), payload: z.string().max(1024).optional() })
      .optional(),
  })
  .passthrough();

const statusSchema = z
  .object({
    id: idString,
    status: z.string().max(40),
    timestamp: z.string().regex(/^[0-9]{1,12}$/),
    recipient_id: z.string().max(32),
    errors: z
      .array(z.object({ code: z.number().int() }).passthrough())
      .max(10)
      .optional(),
  })
  .passthrough();

const valueSchema = z
  .object({
    metadata: z.object({ phone_number_id: idString }).passthrough(),
    contacts: z
      .array(
        z
          .object({
            wa_id: z.string().max(32).optional(),
            profile: z.object({ name: z.string().max(256).optional() }).optional(),
          })
          .passthrough(),
      )
      .max(100)
      .optional(),
    messages: z.array(z.unknown()).max(100).optional(),
    statuses: z.array(z.unknown()).max(100).optional(),
  })
  .passthrough();

const webhookSchema = z.object({
  object: z.literal('whatsapp_business_account'),
  entry: z
    .array(
      z.object({
        id: z.string().max(256).optional(),
        changes: z
          .array(z.object({ field: z.string().max(64), value: z.unknown() }).passthrough())
          .max(100),
      }),
    )
    .max(100),
});

/** Meta's seconds-since-epoch as ISO 8601. */
function epochSeconds(value: string): string {
  return new Date(Number(value) * 1000).toISOString();
}

/** The media part of a message, whichever type carries it. */
const MEDIA_TYPES = ['image', 'document', 'audio', 'video', 'sticker'] as const;

/** Types with nothing a person reads in the inbox, dropped without a trace. */
const SILENT_TYPES = new Set(['reaction', 'system', 'ephemeral', 'request_welcome']);

function normaliseMessage(raw: unknown, names: Map<string, string>): WhatsAppInboundMessage | null {
  const parsed = messageSchema.safeParse(raw);
  if (!parsed.success) return null;
  const message = parsed.data;
  if (SILENT_TYPES.has(message.type)) return null;
  const base = {
    wamid: message.id,
    from: message.from,
    profileName: names.get(message.from) ?? null,
    at: epochSeconds(message.timestamp),
    type: message.type,
  };
  if (message.type === 'text') {
    return { ...base, text: message.text?.body ?? '', media: null };
  }
  const mediaType = MEDIA_TYPES.find((type) => type === message.type);
  const media = mediaType ? message[mediaType] : undefined;
  if (media) {
    return {
      ...base,
      text: media.caption ?? '',
      media: {
        id: media.id,
        mime: (media.mime_type ?? 'application/octet-stream').split(';')[0]!.trim().toLowerCase(),
        filename: media.filename ?? null,
      },
    };
  }
  if (message.type === 'interactive') {
    const reply = message.interactive?.button_reply ?? message.interactive?.list_reply;
    return { ...base, text: reply?.title ?? '', media: null };
  }
  if (message.type === 'button') {
    return { ...base, text: message.button?.text ?? message.button?.payload ?? '', media: null };
  }
  // A location, a contact card, a message type Meta added after this was
  // written: said in the inbox rather than lost — the agent can ask.
  return { ...base, text: `[WhatsApp ${message.type} message]`, media: null };
}

function normaliseStatus(raw: unknown): WhatsAppStatusUpdate | null {
  const parsed = statusSchema.safeParse(raw);
  if (!parsed.success) return null;
  const status = parsed.data;
  if (!(WHATSAPP_STATUSES as readonly string[]).includes(status.status)) return null;
  return {
    wamid: status.id,
    status: status.status as WhatsAppStatus,
    at: epochSeconds(status.timestamp),
    recipient: status.recipient_id,
    errorCode: status.errors?.[0]?.code ?? null,
  };
}

/**
 * A webhook body as one batch per business number. A body that is not a
 * WhatsApp Business webhook at all is a 400; a single message or status inside
 * it that does not read is skipped, so one odd item does not lose its batch.
 */
export function parseWhatsAppWebhook(body: unknown): WhatsAppWebhookBatch[] {
  const parsed = webhookSchema.safeParse(body);
  if (!parsed.success) throw ApiError.validation('Not a WhatsApp Business webhook.');
  const batches = new Map<string, WhatsAppWebhookBatch>();
  for (const entry of parsed.data.entry) {
    for (const change of entry.changes) {
      if (change.field !== 'messages') continue;
      const value = valueSchema.safeParse(change.value);
      if (!value.success) continue;
      const id = value.data.metadata.phone_number_id;
      const batch = batches.get(id) ?? { phoneNumberId: id, messages: [], statuses: [] };
      const names = new Map<string, string>();
      for (const contact of value.data.contacts ?? []) {
        const name = contact.profile?.name?.trim();
        if (contact.wa_id && name) names.set(contact.wa_id, name);
      }
      for (const raw of value.data.messages ?? []) {
        const message = normaliseMessage(raw, names);
        if (message) batch.messages.push(message);
      }
      for (const raw of value.data.statuses ?? []) {
        const status = normaliseStatus(raw);
        if (status) batch.statuses.push(status);
      }
      batches.set(id, batch);
    }
  }
  return [...batches.values()];
}

// --- The Graph client ----------------------------------------------------------

/** Hosts Meta serves media downloads from (`lookaside.fbsbx.com` today). */
const META_MEDIA_HOSTS = /(^|\.)(fbsbx\.com|facebook\.com|fbcdn\.net|whatsapp\.net)$/i;

export class WhatsAppLive {
  /** The shared Graph client (tm 381): the call, its errors, the code exchange. */
  readonly graph: MetaGraphClient;

  constructor(
    private readonly context: ProviderContext,
    readonly config: WhatsAppAppConfig,
    /** `WEB_APP_URL` — where Meta's dialog sends the browser back. */
    private readonly webAppUrl: string,
  ) {
    this.graph = new MetaGraphClient(context, config.appSecret, config.graphVersion);
  }

  /** The browser's way back from Meta's dialog: a page of the panel, which posts the code to the card. */
  get redirectUri(): string {
    return `${this.webAppUrl.replace(/\/+$/, '')}/channels/whatsapp/callback`;
  }

  signupConfig(): WhatsAppSignupConfig {
    return {
      app_id: this.config.appId,
      config_id: this.config.configId,
      graph_version: this.config.graphVersion,
      redirect_uri: this.redirectUri,
    };
  }

  /**
   * The subscription handshake (`GET` with `hub.mode=subscribe`): answers the
   * challenge to echo back only when Meta presents this deployment's verify
   * token, compared in constant time.
   */
  verifySubscription(
    mode: string | undefined,
    token: string | undefined,
    challenge: string | undefined,
  ): string | null {
    return verifyMetaSubscription(this.config.verifyToken, mode, token, challenge);
  }

  /**
   * `X-Hub-Signature-256: sha256=<hex>` against an HMAC-SHA256 of the raw body
   * under the app secret — the bytes Meta sent, not a re-serialised parse.
   */
  signatureMatches(rawBody: Buffer, header: string | undefined): boolean {
    return metaSignatureMatches(this.config.appSecret, rawBody, header);
  }

  /** The embedded signup's one-time code → the business's access token. */
  async exchangeCode(code: string): Promise<string> {
    return this.graph.exchangeCode(this.config.appId, this.redirectUri, code);
  }

  /**
   * The account's business numbers; the connect step checks the chosen one is
   * among them, so ids from the browser cannot name someone else's number.
   */
  async phoneNumbers(
    token: string,
    wabaId: string,
  ): Promise<Array<{ id: string; display_phone_number: string; verified_name: string | null }>> {
    const answer = (await this.#call(
      'GET',
      `/${encodeURIComponent(wabaId)}/phone_numbers?fields=id,display_phone_number,verified_name&limit=100`,
      token,
    )) as { data?: unknown };
    const rows = Array.isArray(answer?.data) ? answer.data : [];
    return rows
      .map(
        (row) => row as { id?: unknown; display_phone_number?: unknown; verified_name?: unknown },
      )
      .filter((row) => typeof row.id === 'string')
      .map((row) => ({
        id: row.id as string,
        display_phone_number:
          typeof row.display_phone_number === 'string' ? row.display_phone_number : '',
        verified_name: typeof row.verified_name === 'string' ? row.verified_name : null,
      }));
  }

  /** Subscribe this Meta app to the account's webhooks — what makes messages arrive. */
  async subscribeApp(token: string, wabaId: string): Promise<void> {
    await this.#call('POST', `/${encodeURIComponent(wabaId)}/subscribed_apps`, token, [], {});
  }

  /** Send free text, split at Meta's per-message limit. Answers the last message id. */
  async sendText(token: string, phoneNumberId: string, to: string, text: string): Promise<string> {
    const parts: string[] = [];
    for (let start = 0; start < text.length; start += WHATSAPP_TEXT_MAX) {
      parts.push(text.slice(start, start + WHATSAPP_TEXT_MAX));
    }
    let last = '';
    for (const part of parts.length > 0 ? parts : [text]) {
      const answer = (await this.#call(
        'POST',
        `/${encodeURIComponent(phoneNumberId)}/messages`,
        token,
        [],
        {
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to,
          type: 'text',
          text: { preview_url: false, body: part },
        },
      )) as { messages?: Array<{ id?: unknown }> };
      const id = answer?.messages?.[0]?.id;
      if (typeof id !== 'string' || !id) {
        throw new WhatsAppGraphError(200, null, 'no message id in the answer');
      }
      last = id;
    }
    return last;
  }

  /**
   * A customer's file, by the id the webhook named: Graph answers where it is
   * and how big; it is fetched only when within `maxBytes` (the workspace's own
   * file-size rule), and only from a Meta host — the token goes with it.
   */
  async fetchMedia(
    token: string,
    mediaId: string,
    maxBytes: number,
  ): Promise<{ bytes: Buffer; mime: string } | { tooLarge: true }> {
    const info = (await this.#call('GET', `/${encodeURIComponent(mediaId)}`, token)) as {
      url?: unknown;
      mime_type?: unknown;
      file_size?: unknown;
    };
    const size = Number(info?.file_size);
    if (Number.isFinite(size) && size > maxBytes) return { tooLarge: true };
    if (typeof info?.url !== 'string') throw new WhatsAppGraphError(200, null, 'no media url');
    let url: URL;
    try {
      url = new URL(info.url);
    } catch {
      throw new WhatsAppGraphError(200, null, 'media url unreadable');
    }
    const graphHost = new URL(this.context.endpoints.whatsapp).hostname;
    if (
      url.protocol !== 'https:' ||
      !(url.hostname === graphHost || META_MEDIA_HOSTS.test(url.hostname))
    ) {
      throw new WhatsAppGraphError(200, null, 'media url is not on a Meta host');
    }
    let answer;
    try {
      answer = await this.context.http.request({
        method: 'GET',
        url: url.toString(),
        headers: { authorization: `Bearer ${token}`, accept: '*/*' },
        maxBytes,
      });
    } catch (error) {
      if (error instanceof SafeHttpError && error.kind === 'too_large') return { tooLarge: true };
      throw new WhatsAppUnreachableError(error instanceof SafeHttpError ? error.kind : 'network');
    }
    if (answer.status !== 200) {
      throw this.graph.error(answer.status, answer.json, [token, this.config.appSecret]);
    }
    return {
      bytes: answer.bytes,
      mime: typeof info.mime_type === 'string' ? info.mime_type : 'application/octet-stream',
    };
  }

  #call(
    method: 'GET' | 'POST',
    path: string,
    token: string | null,
    secrets: readonly string[] = [],
    json?: unknown,
  ): Promise<unknown> {
    return this.graph.call(method, path, token, secrets, json);
  }
}

/** A refused or failed connect step as the API answers it — never Meta's raw text with a secret. */
export function whatsAppConnectError(error: unknown): ApiError {
  if (error instanceof WhatsAppGraphError) {
    const details = {
      reason: 'app_credentials_invalid',
      ...(error.code !== null ? { provider_code: error.code } : {}),
      ...(error.providerMessage ? { provider_message: error.providerMessage } : {}),
    };
    if (error.httpStatus >= 500) {
      return new ApiError('service_unavailable', 'WhatsApp could not be reached. Try again.', {
        details: { ...details, reason: 'app_provider_unavailable' },
      });
    }
    return ApiError.validation('Meta did not accept this WhatsApp sign-up.', details);
  }
  if (error instanceof WhatsAppUnreachableError) {
    return new ApiError('service_unavailable', 'WhatsApp could not be reached. Try again.', {
      details: { reason: 'app_provider_unavailable' },
    });
  }
  if (error instanceof ApiError) return error;
  return ApiError.internal('WhatsApp connect failed.');
}

/**
 * The live WhatsApp this deployment runs, or `null` for the mock: `whatsapp`
 * in `APPS_LIVE_PROVIDERS` — which `config/env.ts` keeps only with the four
 * `WHATSAPP_*` values and a usable `APPS_CREDENTIAL_KEY`.
 */
export function createLiveWhatsApp(
  env: {
    APPS_LIVE_PROVIDERS: readonly string[];
    APPS_CREDENTIAL_KEY?: string | undefined;
    WHATSAPP_APP_ID?: string | undefined;
    WHATSAPP_APP_SECRET?: string | undefined;
    WHATSAPP_VERIFY_TOKEN?: string | undefined;
    WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID?: string | undefined;
    WHATSAPP_GRAPH_VERSION: string;
    WEB_APP_URL: string;
  },
  context: ProviderContext,
): { live: WhatsAppLive; credentialKey: string } | null {
  if (
    !env.APPS_LIVE_PROVIDERS.includes('whatsapp') ||
    !env.APPS_CREDENTIAL_KEY ||
    !env.WHATSAPP_APP_ID ||
    !env.WHATSAPP_APP_SECRET ||
    !env.WHATSAPP_VERIFY_TOKEN ||
    !env.WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID
  ) {
    return null;
  }
  return {
    live: new WhatsAppLive(
      context,
      {
        appId: env.WHATSAPP_APP_ID,
        appSecret: env.WHATSAPP_APP_SECRET,
        verifyToken: env.WHATSAPP_VERIFY_TOKEN,
        configId: env.WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID,
        graphVersion: env.WHATSAPP_GRAPH_VERSION,
      },
      env.WEB_APP_URL,
    ),
    credentialKey: env.APPS_CREDENTIAL_KEY,
  };
}
