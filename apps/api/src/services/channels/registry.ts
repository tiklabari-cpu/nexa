/**
 * The adapter registry — the one place that maps a channel type to its adapter.
 *
 * A `Record` keyed by `ChannelType` rather than a lookup that can miss: adding a
 * channel type without an adapter here is a compile error, not a 500 at runtime.
 */
import { CHANNEL_TYPES, type ChannelAdapter, type ChannelType } from './channel-adapter.js';
import { InstagramAdapter } from './instagram.js';
import { MessengerAdapter } from './messenger.js';
import { TelegramAdapter } from './telegram.js';
import { TwilioAdapter } from './twilio.js';
import { WhatsAppAdapter } from './whatsapp.js';

const ADAPTERS: Record<ChannelType, ChannelAdapter> = {
  messenger: new MessengerAdapter(),
  twilio: new TwilioAdapter(),
  whatsapp: new WhatsAppAdapter(),
  instagram: new InstagramAdapter(),
  telegram: new TelegramAdapter(),
};

export function getAdapter(type: ChannelType): ChannelAdapter {
  return ADAPTERS[type];
}

export { CHANNEL_TYPES };
export type { ChannelAdapter, ChannelType };
