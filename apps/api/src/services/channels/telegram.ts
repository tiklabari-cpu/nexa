/**
 * Telegram adapter (Bot API) — FR-MOD-08.5.8 (Enterprise, TR market priority).
 * MOCK.
 *
 * Connect stands in for registering a bot with Telegram: an admin supplies the
 * bot's token (minted by @BotFather, out of band) and its `@username`. The
 * username is the channel address inbound webhooks resolve to a licence — the
 * same role `ig_user_id`/`page_id` play for the other OAuth-style adapters.
 *
 * Unlike those adapters' mock OAuth exchange, `bot_token` is not this mock's
 * to mint: it is a real-shaped credential supplied by the caller. It is
 * validated for shape and then discarded — `ConnectResult.config` documents
 * "never contains a raw secret" (`channel-adapter.ts`), and a client-supplied
 * secret is exactly what that guards against (§6.1.1, closed open question).
 *
 * Inbound mirrors the same flattened `{recipient, sender, message}` shape as
 * the other three adapters rather than Telegram's real `update` envelope
 * (consistent across the whole family): `recipient.id` is the connected bot's
 * `bot_username`, `sender.id` is the writer's Telegram user id.
 *
 * Not yet a member of `ChannelType` (`channel-adapter.ts`) — CHANNEL_TYPES
 * only widens, and this adapter joins the registry, in 08.5.8-c. Until then
 * `/channels/telegram/*` stays a 404 by design: the contract (08.5.8-a) and
 * this adapter land first so a type never reaches the route surface with no
 * adapter behind it (§6.1.1).
 */
import { z } from 'zod';
import { generateToken } from '../../lib/crypto.js';
import {
  type ChannelAdapter,
  type ConnectResult,
  type NormalizedInbound,
  type OutboundInput,
  type OutboundResult,
  parseWith,
} from './channel-adapter.js';

const connectSchema = z.object({
  /** The bot token minted by @BotFather — a credential, verified but never persisted. */
  bot_token: z.string().trim().min(1).max(128),
  /** The bot's `@username`, without the leading `@`. Its value is the channel address. */
  bot_username: z.string().trim().min(1).max(64),
});

const inboundSchema = z.object({
  recipient: z.object({ id: z.string().trim().min(1).max(64) }),
  sender: z.object({
    id: z.string().trim().min(1).max(64),
    username: z.string().trim().max(120).optional(),
  }),
  message: z.object({ text: z.string().min(1).max(10_000) }),
});

export class TelegramAdapter implements Omit<ChannelAdapter, 'type'> {
  readonly type = 'telegram' as const;

  parseConnect(input: unknown): ConnectResult {
    const body = parseWith(connectSchema, input);
    // `bot_token` is validated above and intentionally not read again here —
    // the caller's real credential must never reach `config` (§6.1.1).
    return {
      address: body.bot_username,
      config: { bot_username: body.bot_username },
    };
  }

  parseInbound(payload: unknown): NormalizedInbound {
    const body = parseWith(inboundSchema, payload);
    return {
      address: body.recipient.id,
      externalId: body.sender.id,
      senderName: body.sender.username ?? null,
      text: body.message.text,
    };
  }

  async send(_input: OutboundInput): Promise<OutboundResult> {
    // A real deployment calls the Bot API `sendMessage`; mocked as a
    // Telegram-style message id so nothing leaves the process.
    return { providerMessageId: `tg.${generateToken(18)}` };
  }
}
