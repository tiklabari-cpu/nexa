/**
 * Instagram adapter (Meta OAuth) — FR-MOD-08.5.7 (v2, Should). MOCK.
 *
 * Instagram DMs sit in the same Meta Graph family as Messenger (FR-MOD-08.5.4):
 * connect stands in for the OAuth handshake — an admin authorizes the app, gets
 * back a `code`, and exchanges it for a page-scoped access token — mocked here
 * as a locally minted opaque value so nothing leaves the process. The connected
 * account's `ig_user_id` is the channel address inbound webhooks resolve to a
 * licence.
 *
 * Inbound mirrors the Messenger webhook shape: a recipient (the connected IG
 * account) and a sender identified by IGSID (an Instagram-scoped id, the
 * sender's stable identity for that account).
 *
 * Registered in `CHANNEL_TYPES` and the adapter registry (08.5.7-c), which is
 * what opens `/channels/instagram/{connect,disconnect,messages,webhook}` — the
 * routes are generic over the channel type, so nothing there is Instagram-aware.
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
  /** The mock OAuth authorization code returned from the Instagram redirect. */
  code: z.string().trim().min(1).max(512),
  /** The connected Instagram account being linked. Its id is the channel address. */
  ig_user_id: z.string().trim().min(1).max(64),
  username: z.string().trim().max(120).optional(),
});

const inboundSchema = z.object({
  recipient: z.object({ id: z.string().trim().min(1).max(64) }),
  sender: z.object({
    id: z.string().trim().min(1).max(64),
    username: z.string().trim().max(120).optional(),
  }),
  message: z.object({ text: z.string().min(1).max(10_000) }),
});

export class InstagramAdapter implements ChannelAdapter {
  readonly type = 'instagram' as const;

  parseConnect(input: unknown): ConnectResult {
    const body = parseWith(connectSchema, input);
    // The real exchange trades `code` for a long-lived access token at Meta;
    // mocked here as a locally minted opaque value so nothing leaves the process.
    const igAccessToken = `mock_ig_access_token_${generateToken(18)}`;
    return {
      address: body.ig_user_id,
      config: {
        ig_user_id: body.ig_user_id,
        ...(body.username ? { username: body.username } : {}),
        ig_access_token: igAccessToken,
      },
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
    // A real deployment POSTs to the Graph API `/me/messages`; mocked as an
    // Instagram-style message id so nothing leaves the process.
    return { providerMessageId: `aigid.${generateToken(18)}` };
  }
}
