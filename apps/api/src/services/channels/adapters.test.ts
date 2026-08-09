/**
 * Channel adapters (MOCK) — FR-MOD-08.5.4/.5/.6.
 *
 * Unit-level: the provider-specific seams. Each adapter turns a connect body
 * into an address + config, a provider webhook into a normalized inbound, and an
 * outbound into a (mock) provider message id. The properties worth pinning are
 * the ones easy to get silently wrong: the routing address, and that a credential
 * handed to connect is not stored back on the channel.
 */
import { describe, expect, it } from 'vitest';
import { isApiError } from '../../lib/api-error.js';
import { isChannelType, CHANNEL_TYPES } from './channel-adapter.js';
import { getAdapter } from './registry.js';
import { InstagramAdapter } from './instagram.js';
import { MessengerAdapter } from './messenger.js';
import { TwilioAdapter } from './twilio.js';
import { WhatsAppAdapter } from './whatsapp.js';

describe('channel type guard', () => {
  it('recognises the adapter channels and rejects others', () => {
    // Pinned deliberately: this list is the runtime gate on
    // /channels/:type/{connect,disconnect,messages,webhook} — the last one
    // public. Widening it is a route-surface decision, so it changes here too.
    expect(CHANNEL_TYPES).toEqual(['messenger', 'twilio', 'whatsapp', 'instagram']);
    for (const t of CHANNEL_TYPES) expect(isChannelType(t)).toBe(true);
    expect(isChannelType('email')).toBe(false);
    expect(isChannelType('sms')).toBe(false);
    expect(isChannelType('website')).toBe(false);
    // Named in the domain channel list and the channels_type_check constraint,
    // but with no adapter — still a 404 (Telegram is Enterprise, out of scope).
    expect(isChannelType('telegram')).toBe(false);
    expect(isChannelType('website_widget')).toBe(false);
    expect(isChannelType('')).toBe(false);
  });

  it('maps each type to an adapter of that type', () => {
    for (const t of CHANNEL_TYPES) expect(getAdapter(t).type).toBe(t);
  });
});

describe('Messenger adapter (08.5.4)', () => {
  const adapter = new MessengerAdapter();

  it('connects with the page id as the address and mints a mock token', () => {
    const { address, config } = adapter.parseConnect({
      code: 'AQD_mock_oauth_code',
      page_id: '10159283746',
      page_name: 'Acme Support',
    });
    expect(address).toBe('10159283746');
    expect(config['page_id']).toBe('10159283746');
    // The OAuth exchange is mocked, but a token is produced (not the raw code).
    expect(config['page_access_token']).toMatch(/^mock_fb_page_token_/);
    expect(config).not.toHaveProperty('code');
  });

  it('rejects a connect body missing the page id', () => {
    try {
      adapter.parseConnect({ code: 'x' });
      throw new Error('should have thrown');
    } catch (error) {
      expect(isApiError(error) && error.status).toBe(400);
    }
  });

  it('normalizes an inbound webhook to sender PSID + text', () => {
    const inbound = adapter.parseInbound({
      recipient: { id: '10159283746' },
      sender: { id: 'psid_88421', name: 'Dana' },
      message: { text: 'hello there' },
    });
    expect(inbound).toEqual({
      address: '10159283746',
      externalId: 'psid_88421',
      senderName: 'Dana',
      text: 'hello there',
    });
  });

  it('rejects an inbound with no message text', () => {
    expect(() =>
      adapter.parseInbound({ recipient: { id: 'p' }, sender: { id: 's' }, message: {} }),
    ).toThrow();
  });

  it('sends and returns a Messenger-style message id', async () => {
    const { providerMessageId } = await adapter.send({
      config: { page_id: 'p' },
      externalId: 'psid_88421',
      text: 'hi',
    });
    expect(providerMessageId).toMatch(/^mid\./);
  });
});

describe('Twilio SMS adapter (08.5.5)', () => {
  const adapter = new TwilioAdapter();

  it('has channel type twilio', () => {
    expect(adapter.type).toBe('twilio');
  });

  it('connects with the number as the address and never stores the auth token', () => {
    const { address, config } = adapter.parseConnect({
      account_sid: 'ACmock123',
      auth_token: 'super-secret-token',
      phone_number: '+14155550123',
    });
    expect(address).toBe('+14155550123');
    expect(config['account_sid']).toBe('ACmock123');
    expect(config['phone_number']).toBe('+14155550123');
    // A credential is verified at connect and discarded — never persisted.
    expect(config).not.toHaveProperty('auth_token');
  });

  it('rejects a non-numeric phone number', () => {
    expect(() =>
      adapter.parseConnect({ account_sid: 'AC', auth_token: 't', phone_number: 'not-a-number' }),
    ).toThrow();
  });

  it('normalizes an inbound Twilio webhook (To/From/Body)', () => {
    const inbound = adapter.parseInbound({
      To: '+14155550123',
      From: '+14155559999',
      Body: 'need help',
    });
    expect(inbound).toEqual({
      address: '+14155550123',
      externalId: '+14155559999',
      senderName: null,
      text: 'need help',
    });
  });

  it('sends and returns a Twilio-style SID', async () => {
    const { providerMessageId } = await adapter.send({
      config: { phone_number: '+14155550123' },
      externalId: '+14155559999',
      text: 'on it',
    });
    expect(providerMessageId).toMatch(/^SM/);
  });
});

describe('WhatsApp adapter (08.5.6)', () => {
  const adapter = new WhatsAppAdapter();

  it('connects with the business number as the address', () => {
    const { address, config } = adapter.parseConnect({
      waba_id: '987654321',
      phone_number: '+441632960000',
    });
    expect(address).toBe('+441632960000');
    expect(config['waba_id']).toBe('987654321');
  });

  it('normalizes an inbound WhatsApp webhook and carries the profile name', () => {
    const inbound = adapter.parseInbound({
      to: '+441632960000',
      from: '+441632961111',
      text: { body: 'merhaba' },
      profile_name: 'Ada',
    });
    expect(inbound).toEqual({
      address: '+441632960000',
      externalId: '+441632961111',
      senderName: 'Ada',
      text: 'merhaba',
    });
  });

  it('sends and returns a WhatsApp-style message id', async () => {
    const { providerMessageId } = await adapter.send({
      config: { phone_number: '+441632960000' },
      externalId: '+441632961111',
      text: 'selam',
    });
    expect(providerMessageId).toMatch(/^wamid\./);
  });
});

describe('Instagram adapter (08.5.7)', () => {
  const adapter = new InstagramAdapter();

  it('connects with the IG user id as the address and mints a mock token', () => {
    const { address, config } = adapter.parseConnect({
      code: 'IGQmock_oauth_code',
      ig_user_id: '17841400000000000',
      username: 'acme_support',
    });
    expect(address).toBe('17841400000000000');
    expect(config['ig_user_id']).toBe('17841400000000000');
    expect(config['username']).toBe('acme_support');
    // The OAuth exchange is mocked, but a token is produced (not the raw code).
    expect(config['ig_access_token']).toMatch(/^mock_ig_access_token_/);
    expect(config).not.toHaveProperty('code');
  });

  it('rejects a connect body missing the IG user id', () => {
    try {
      adapter.parseConnect({ code: 'x' });
      throw new Error('should have thrown');
    } catch (error) {
      expect(isApiError(error) && error.status).toBe(400);
    }
  });

  it('normalizes an inbound DM to sender IGSID + text', () => {
    const inbound = adapter.parseInbound({
      recipient: { id: '17841400000000000' },
      sender: { id: 'igsid_88421', username: 'dana_h' },
      message: { text: 'hello there' },
    });
    expect(inbound).toEqual({
      address: '17841400000000000',
      externalId: 'igsid_88421',
      senderName: 'dana_h',
      text: 'hello there',
    });
  });

  it('rejects an inbound with no message text', () => {
    expect(() =>
      adapter.parseInbound({ recipient: { id: 'p' }, sender: { id: 's' }, message: {} }),
    ).toThrow();
  });

  it('rejects an inbound with an over-length message', () => {
    expect(() =>
      adapter.parseInbound({
        recipient: { id: 'p' },
        sender: { id: 's' },
        message: { text: 'x'.repeat(10_001) },
      }),
    ).toThrow();
  });

  it('sends and returns an Instagram-style message id', async () => {
    const { providerMessageId } = await adapter.send({
      config: { ig_user_id: '17841400000000000' },
      externalId: 'igsid_88421',
      text: 'hi',
    });
    expect(providerMessageId).toMatch(/^aigid\./);
  });
});
