/**
 * WhatsApp (Business) adapter — FR-MOD-08.5.6 (v1, Must). MOCK.
 *
 * Connect stands in for linking a WhatsApp Business account: an admin supplies
 * the WABA id and the business phone number. The number is the channel address
 * inbound webhooks resolve to a licence.
 *
 * Inbound mirrors the WhatsApp Cloud API shape enough to route: the business
 * number the message reached (`to`), the sender's number (`from`), and the text
 * body. A `profile_name` is carried through when the provider includes it.
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
  phoneNumber,
} from './channel-adapter.js';

const connectSchema = z.object({
  /** WhatsApp Business Account id. */
  waba_id: z.string().trim().min(1).max(64),
  /** The business phone number — the channel address. */
  phone_number: phoneNumber,
});

const inboundSchema = z.object({
  to: phoneNumber,
  from: phoneNumber,
  text: z.object({ body: z.string().min(1).max(10_000) }),
  profile_name: z.string().trim().max(120).optional(),
});

export class WhatsAppAdapter implements ChannelAdapter {
  readonly type = 'whatsapp' as const;

  parseConnect(input: unknown): ConnectResult {
    const body = parseWith(connectSchema, input);
    return {
      address: body.phone_number,
      config: { waba_id: body.waba_id, phone_number: body.phone_number },
    };
  }

  parseInbound(payload: unknown): NormalizedInbound {
    const body = parseWith(inboundSchema, payload);
    return {
      address: body.to,
      externalId: body.from,
      senderName: body.profile_name ?? null,
      text: body.text.body,
    };
  }

  async send(_input: OutboundInput): Promise<OutboundResult> {
    // A real deployment POSTs to the Cloud API `/{phone-number-id}/messages`;
    // mocked as a WhatsApp-style message id (`wamid…`).
    return { providerMessageId: `wamid.${generateToken(18)}` };
  }
}
