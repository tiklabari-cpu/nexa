/**
 * Telegram as a real channel (tm 263 · FR-MOD-08.5.8) — the owner's "full
 * channel" decision: the bot token is verified, Telegram is told where to push
 * updates, those updates become chats, and agent replies go back as real
 * messages.
 *
 * Switched on by `telegram` in `APPS_LIVE_PROVIDERS`; otherwise the mock
 * adapter (`telegram.ts`) runs exactly as before. Live, the channel differs
 * from the mock in the three places a real provider forces it to:
 *
 *   - **Connect** asks Telegram (`getMe`) whose token this is — the bot's
 *     username comes from Telegram, never from the form — and registers the
 *     webhook (`setWebhook`) with a fresh random `secret_token`. The token is
 *     kept encrypted on the channel row (`channels.credential_ciphertext`); only
 *     a hash of the secret is kept, which is all the webhook needs.
 *   - **Inbound** arrives on its own path, `/channels/telegram/webhook/{id}`,
 *     and is accepted only with Telegram's `X-Telegram-Bot-Api-Secret-Token`
 *     header matching that hash. The mock's flat webhook stays for every other
 *     channel and is closed for a live Telegram: it authenticates nobody.
 *   - **Outbound** is `sendMessage` to the chat the customer wrote from.
 *
 * Endpoints per core.telegram.org/bots/api. Every call goes through the safe
 * client: the token sits in the URL path (`/bot<token>/…`), which is why that
 * client never puts a URL into an error.
 */
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { ApiError } from '../../lib/api-error.js';
import { constantTimeEqual, generateToken } from '../../lib/crypto.js';
import { SafeHttpError } from '../../lib/safe-fetch.js';
import {
  reasonForTransportError,
  sanitiseProviderMessage,
} from '../apps/verifiers/provider-message.js';
import type { ProviderContext, VerifyFailureReason } from '../apps/verifiers/types.js';
import type { NormalizedInbound } from './channel-adapter.js';

/**
 * What @BotFather hands out: the bot's numeric id, a colon, and a secret part.
 * Checked before the token is sent anywhere, so a paste of something else is a
 * form error rather than a call to Telegram with it.
 */
export const TELEGRAM_TOKEN_PATTERN = /^\d{5,15}:[A-Za-z0-9_-]{30,64}$/;

/** Telegram's ceiling for one message; a longer reply goes out in parts. */
export const TELEGRAM_TEXT_MAX = 4096;

/** The ports Telegram will deliver a webhook to. */
const WEBHOOK_PORTS = new Set(['', '443', '80', '88', '8443']);

/** A Telegram `Update` as far as a chat needs it: a private text message. */
const updateSchema = z.object({
  update_id: z.number().int(),
  message: z
    .object({
      message_id: z.number().int(),
      text: z.string().min(1).max(10_000).optional(),
      chat: z.object({ id: z.number().int(), type: z.string() }),
      from: z
        .object({
          id: z.number().int(),
          is_bot: z.boolean().optional(),
          first_name: z.string().max(256).optional(),
          last_name: z.string().max(256).optional(),
          username: z.string().max(64).optional(),
        })
        .optional(),
    })
    .optional(),
});

export function hashWebhookSecret(secret: string): string {
  return createHash('sha256').update(secret, 'utf8').digest('hex');
}

function telegramError(reason: VerifyFailureReason, providerMessage?: string): ApiError {
  const refused = reason === 'invalid_key' || reason === 'not_found';
  const details = {
    reason: refused ? 'app_credentials_invalid' : 'app_provider_unavailable',
    provider_reason: reason,
    ...(providerMessage ? { provider_message: providerMessage } : {}),
  };
  return refused
    ? ApiError.validation('Telegram did not accept this bot token.', details)
    : new ApiError('service_unavailable', 'Telegram could not be reached. Try again.', { details });
}

export class TelegramLive {
  constructor(
    private readonly context: ProviderContext,
    /** `API_BASE_URL` — where Telegram is told to deliver updates. */
    private readonly apiBaseUrl: string,
  ) {}

  /** The public URL Telegram posts this channel's updates to. */
  webhookUrl(channelId: string): string {
    return `${this.apiBaseUrl.replace(/\/+$/, '')}/api/v1/channels/telegram/webhook/${channelId}`;
  }

  /**
   * Refuse up front what Telegram would refuse later: it delivers only to
   * public https on four ports. Said before the token is sent anywhere, with
   * the setting to change, rather than as Telegram's own error after the fact.
   */
  assertWebhookReachable(): void {
    let url: URL;
    try {
      url = new URL(this.apiBaseUrl);
    } catch {
      url = new URL('http://invalid');
    }
    if (url.protocol !== 'https:' || !WEBHOOK_PORTS.has(url.port)) {
      throw ApiError.validation(
        'A live Telegram channel needs API_BASE_URL to be a public https:// address (port 443, 80, 88 or 8443): Telegram delivers messages there.',
        { reason: 'telegram_webhook_unreachable' },
      );
    }
  }

  assertTokenShape(token: string): void {
    if (!TELEGRAM_TOKEN_PATTERN.test(token)) {
      throw ApiError.validation(
        'bot_token: that does not look like a token from @BotFather (digits, a colon, then the secret).',
      );
    }
  }

  /** `getMe`: whose token this is. Answers the bot's username, never trusting the form. */
  async getMe(token: string): Promise<{ username: string }> {
    const result = await this.#call(token, 'getMe');
    const username = (result as { username?: unknown; is_bot?: unknown } | undefined)?.username;
    if (typeof username !== 'string' || !username) throw telegramError('provider_error');
    return { username };
  }

  /** `setWebhook` with a fresh secret; answers the secret so its hash can be stored. */
  async setWebhook(token: string, channelId: string): Promise<{ secret: string }> {
    // base64url of 32 random bytes: 43 characters of A-Z a-z 0-9 _ -, inside
    // the alphabet and length Telegram allows for `secret_token`.
    const secret = generateToken(32);
    await this.#call(token, 'setWebhook', {
      url: this.webhookUrl(channelId),
      secret_token: secret,
      allowed_updates: ['message'],
      drop_pending_updates: true,
    });
    return { secret };
  }

  /** `deleteWebhook`. Best effort: a disconnect must succeed even if Telegram is down. */
  async deleteWebhook(token: string): Promise<boolean> {
    try {
      await this.#call(token, 'deleteWebhook', { drop_pending_updates: true });
      return true;
    } catch {
      return false;
    }
  }

  /** `sendMessage`, split at Telegram's per-message limit. Answers the last message id. */
  async sendMessage(token: string, chatId: string, text: string): Promise<string> {
    const parts: string[] = [];
    for (let start = 0; start < text.length; start += TELEGRAM_TEXT_MAX) {
      parts.push(text.slice(start, start + TELEGRAM_TEXT_MAX));
    }
    let last = '';
    for (const part of parts.length > 0 ? parts : [text]) {
      const result = (await this.#call(token, 'sendMessage', { chat_id: chatId, text: part })) as
        { message_id?: unknown } | undefined;
      last = `tg.${String(result?.message_id ?? '')}`;
    }
    return last;
  }

  /** The update header check: constant-time, against the stored hash only. */
  secretMatches(provided: string | undefined, storedHash: string): boolean {
    if (!provided) return false;
    return constantTimeEqual(hashWebhookSecret(provided), storedHash);
  }

  /**
   * A Telegram `Update` as a chat message, or `null` for anything this channel
   * does not turn into one — an edit, a sticker, a group, another bot. Those
   * are answered 200 and dropped, so Telegram does not retry them forever.
   */
  parseUpdate(body: unknown, address: string): NormalizedInbound | null {
    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) throw ApiError.validation('Not a Telegram update.');
    const message = parsed.data.message;
    if (!message || !message.text || message.chat.type !== 'private') return null;
    if (message.from?.is_bot) return null;
    const name = [message.from?.first_name, message.from?.last_name].filter(Boolean).join(' ');
    return {
      address,
      // The private chat's id is the user's id, and it is what `sendMessage`
      // takes back — the reply address.
      externalId: String(message.chat.id),
      senderName: name || message.from?.username || null,
      text: message.text,
    };
  }

  async #call(token: string, method: string, body?: Record<string, unknown>): Promise<unknown> {
    let answer;
    try {
      answer = await this.context.http.request({
        method: body ? 'POST' : 'GET',
        url: `${this.context.endpoints.telegram}/bot${token}/${method}`,
        ...(body ? { json: body } : {}),
      });
    } catch (error) {
      throw telegramError(
        error instanceof SafeHttpError ? reasonForTransportError(error) : 'unreachable',
      );
    }
    const envelope = answer.json as
      { ok?: unknown; result?: unknown; description?: unknown; error_code?: unknown } | undefined;
    if (answer.status === 200 && envelope?.ok === true) return envelope.result;
    const message = sanitiseProviderMessage(envelope?.description, [token]);
    // 401 Unauthorized is a revoked or wrong token; Telegram answers a token of
    // the right shape that names no bot with 404.
    if (answer.status === 401 || answer.status === 404) throw telegramError('invalid_key', message);
    if (answer.status >= 500) throw telegramError('provider_error', message);
    throw ApiError.validation(
      message ? `Telegram refused: ${message}` : 'Telegram refused the request.',
      {
        reason: 'app_provider_refused',
      },
    );
  }
}

/**
 * The live Telegram this deployment runs, or `null` for the mock: `telegram`
 * in `APPS_LIVE_PROVIDERS` (which env.ts only accepts alongside a key).
 */
export function createLiveTelegram(
  env: {
    APPS_LIVE_PROVIDERS: readonly string[];
    APPS_CREDENTIAL_KEY?: string | undefined;
    API_BASE_URL: string;
  },
  context: ProviderContext,
): { live: TelegramLive; credentialKey: string } | null {
  if (!env.APPS_LIVE_PROVIDERS.includes('telegram') || !env.APPS_CREDENTIAL_KEY) return null;
  return {
    live: new TelegramLive(context, env.API_BASE_URL),
    credentialKey: env.APPS_CREDENTIAL_KEY,
  };
}
