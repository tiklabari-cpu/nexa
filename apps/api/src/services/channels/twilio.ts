/**
 * Twilio SMS adapter — FR-MOD-08.5.5 (v1, Must). MOCK.
 *
 * The channel type is `twilio` (the provider), the value the `channels_type_check`
 * constraint and the source platform both use for SMS.
 *
 * Connect stands in for provisioning a Twilio number: an admin supplies their
 * account SID, auth token and the workspace's SMS number. The number is the
 * channel address; inbound webhooks name it as `To`. The auth token is a
 * credential, so it is not stored back on the channel config — only the SID and
 * number, which are enough to address an outbound send in the mock.
 *
 * Inbound mirrors Twilio's form-encoded webhook fields (`To`, `From`, `Body`),
 * accepted here as JSON since the mock provider posts JSON.
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
  account_sid: z.string().trim().min(1).max(64),
  /** A credential — validated for shape but never persisted on the channel. */
  auth_token: z.string().trim().min(1).max(128),
  phone_number: phoneNumber,
});

const inboundSchema = z.object({
  To: phoneNumber,
  From: phoneNumber,
  Body: z.string().min(1).max(10_000),
  FromName: z.string().trim().max(120).optional(),
});

export class TwilioAdapter implements ChannelAdapter {
  readonly type = 'twilio' as const;

  parseConnect(input: unknown): ConnectResult {
    const body = parseWith(connectSchema, input);
    return {
      address: body.phone_number,
      // No `auth_token`: a credential is verified at connect and discarded, not
      // stored where a channel read could recover it.
      config: { account_sid: body.account_sid, phone_number: body.phone_number },
    };
  }

  parseInbound(payload: unknown): NormalizedInbound {
    const body = parseWith(inboundSchema, payload);
    return {
      address: body.To,
      externalId: body.From,
      senderName: body.FromName ?? null,
      text: body.Body,
    };
  }

  async send(_input: OutboundInput): Promise<OutboundResult> {
    // A real deployment calls the Twilio Messages API; mocked as a Twilio-style
    // message SID (`SM…`).
    return { providerMessageId: `SM${generateToken(16)}` };
  }
}
