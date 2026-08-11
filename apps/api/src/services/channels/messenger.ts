/**
 * Messenger adapter (Facebook OAuth) — FR-MOD-08.5.4 (v1, Must). MOCK.
 *
 * Connect stands in for the OAuth handshake: a real integration redirects an
 * admin to Facebook, gets back an authorization `code`, and exchanges it for a
 * page access token. Here the exchange is mocked — the `code` is accepted and a
 * token minted locally — but the *shape* is real, so wiring a live provider
 * later is a body swap, not a redesign. The connected page's id is the channel
 * address inbound webhooks resolve to a licence.
 *
 * Inbound mirrors the Messenger webhook: a messaging entry names the recipient
 * page and the sender PSID (a page-scoped id, the sender's stable identity for
 * this page).
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
  /** The mock OAuth authorization code returned from the Facebook redirect. */
  code: z.string().trim().min(1).max(512),
  /** The Facebook Page being connected. Its id is the channel address. */
  page_id: z.string().trim().min(1).max(64),
  page_name: z.string().trim().max(120).optional(),
});

const inboundSchema = z.object({
  recipient: z.object({ id: z.string().trim().min(1).max(64) }),
  sender: z.object({
    id: z.string().trim().min(1).max(64),
    name: z.string().trim().max(120).optional(),
  }),
  message: z.object({ text: z.string().min(1).max(10_000) }),
});

export class MessengerAdapter implements ChannelAdapter {
  readonly type = 'messenger' as const;

  parseConnect(input: unknown): ConnectResult {
    const body = parseWith(connectSchema, input);
    // The real exchange trades `code` for a long-lived page token at Facebook;
    // mocked here as a locally minted opaque value so nothing leaves the process.
    const pageAccessToken = `mock_fb_page_token_${generateToken(18)}`;
    return {
      address: body.page_id,
      config: {
        page_id: body.page_id,
        ...(body.page_name ? { page_name: body.page_name } : {}),
        page_access_token: pageAccessToken,
      },
    };
  }

  parseInbound(payload: unknown): NormalizedInbound {
    const body = parseWith(inboundSchema, payload);
    return {
      address: body.recipient.id,
      externalId: body.sender.id,
      senderName: body.sender.name ?? null,
      text: body.message.text,
    };
  }

  async send(_input: OutboundInput): Promise<OutboundResult> {
    // A real deployment POSTs to the Graph API `/me/messages`; mocked as a
    // Messenger-style message id so nothing leaves the process.
    return { providerMessageId: `mid.${generateToken(18)}` };
  }
}
