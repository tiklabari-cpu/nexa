/**
 * The common channel adapter — FR-MOD-08.5.4/.5/.6 (v1, Must).
 *
 * One shape for every connected channel, so the parts that do not care which
 * provider a message came from (resolve the customer, open or continue a chat,
 * record what left) are written once. An adapter is the thin, provider-specific
 * seam either side of that:
 *
 *   parseConnect  the mock "connect" step (OAuth exchange, number provisioning,
 *                 business linking) → the workspace's channel address plus the
 *                 config to persist. The address is the routing key an inbound
 *                 webhook later names.
 *   parseInbound  a provider webhook body → a normalized inbound message.
 *   send          deliver an outbound message to the provider → a message id.
 *
 * External providers are MOCKED in this build (MASTER-PROMPT §5): no network
 * leaves the process. `send` returns a plausible provider message id; a real
 * deployment swaps the body of these three methods and nothing above them
 * changes. Provider signature verification is deliberately out of scope (§9).
 */
import { z } from 'zod';
import { ApiError } from '../../lib/api-error.js';

/**
 * The adapter channels: the v1 three (FR-MOD-08.5.4/.5/.6), Instagram DMs
 * (FR-MOD-08.5.7, v2) and Telegram bots (FR-MOD-08.5.8, Enterprise). These are
 * the values the `channels_type_check` constraint allows for adapters (SMS is
 * `twilio`, its provider). Email and the Website widget resolve tenants their
 * own way and are not adapters.
 *
 * This list is the runtime gate: `routes/channels.ts` narrows the `:type` path
 * segment through `isChannelType`, so a type here has connect / disconnect /
 * messages / webhook open to it, and a type not here is a 404. Do not widen it
 * without an adapter in the registry — `Record<ChannelType, ChannelAdapter>`
 * turns that mistake into a compile error rather than a runtime 500.
 *
 * Distinct from `@nexa/types`' domain-scoped `CHANNEL_TYPES` (8 values, every
 * channel the product names, including ones with no adapter). The two lists are
 * deliberately separate — different questions, different answers.
 */
export const CHANNEL_TYPES = ['messenger', 'twilio', 'whatsapp', 'instagram', 'telegram'] as const;
export type ChannelType = (typeof CHANNEL_TYPES)[number];

export function isChannelType(value: unknown): value is ChannelType {
  return typeof value === 'string' && (CHANNEL_TYPES as readonly string[]).includes(value);
}

/** The result of the mock connect step: what to store on the `channels` row. */
export interface ConnectResult {
  /**
   * The workspace's own channel address (a Messenger page id, a phone number).
   * Stored as `config.address` and the key a provider webhook resolves to a
   * licence — so it is unique per channel type across the platform.
   */
  address: string;
  /** Provider config persisted on the channel. Never contains a raw secret. */
  config: Record<string, unknown>;
}

/** A provider webhook body, normalized so the chat core is provider-agnostic. */
export interface NormalizedInbound {
  /** The workspace channel address the message was sent to — the routing key. */
  address: string;
  /** The sender's stable per-channel identity (PSID / phone number). */
  externalId: string;
  /** A display name the provider supplied, if any. */
  senderName: string | null;
  /** The message text. */
  text: string;
}

export interface OutboundInput {
  /** The channel's stored config, as returned by `parseConnect`. */
  config: Record<string, unknown>;
  /** The recipient's per-channel identity. */
  externalId: string;
  text: string;
}

export interface OutboundResult {
  /** The provider's id for the sent message (mocked). */
  providerMessageId: string;
}

export interface ChannelAdapter {
  readonly type: ChannelType;
  /** Validate and normalize the mock connect input. Throws 400 on bad input. */
  parseConnect(input: unknown): ConnectResult;
  /** Parse a provider inbound webhook body. Throws 400 on a malformed body. */
  parseInbound(payload: unknown): NormalizedInbound;
  /** Deliver an outbound message to the provider (mock). */
  send(input: OutboundInput): Promise<OutboundResult>;
}

/**
 * Parse `value` with `schema`, raising the same 400 the rest of the API raises
 * on a bad body — so an adapter's validation failure reads identically to any
 * other route's.
 */
export function parseWith<T extends z.ZodTypeAny>(schema: T, value: unknown): z.infer<T> {
  const result = schema.safeParse(value);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw ApiError.validation(
      issue ? `${issue.path.join('.') || 'body'}: ${issue.message}` : 'Invalid request.',
    );
  }
  return result.data;
}

/** A phone number, kept as the digits (plus an optional leading `+`) the
 *  provider used — enough to match a sender and address a reply in the mock. */
export const phoneNumber = z
  .string()
  .trim()
  .min(3)
  .max(32)
  .regex(/^\+?[0-9]{3,20}$/, 'must be a phone number in digits, optionally +-prefixed');
