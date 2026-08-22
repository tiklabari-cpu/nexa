import { describe, expect, it } from 'vitest';
import { channelsFor } from './Channels.js';
import type { ConnectedChannel } from '../inbox/useInbox.js';

/**
 * The point of these is that the Website card's status is *derived*, not
 * written. Replace `channelsFor` with a hard-coded list and every one of the
 * first three fails — which is exactly what stops the status from drifting away
 * from the real `/websites` data (FR-MOD-08.5.1).
 */
describe('channelsFor', () => {
  const website = (sites: Array<{ status: string }>) =>
    channelsFor(sites).find((c) => c.id === 'website')!;

  it('is Not connected with no sites, offering Connect', () => {
    const w = website([]);
    expect(w.status).toBe('not_connected');
    expect(w.cta).toBe('Connect');
  });

  it('is Ready once a site is installed but none has connected, offering Manage', () => {
    const w = website([{ status: 'pending' }]);
    expect(w.status).toBe('ready');
    expect(w.cta).toBe('Manage');
  });

  it('is Connected as soon as any site connects, offering Manage', () => {
    const w = website([{ status: 'pending' }, { status: 'connected' }]);
    expect(w.status).toBe('connected');
    expect(w.cta).toBe('Manage');
  });

  it('offers the Chat page as a ready-to-share link', () => {
    const chat = channelsFor([]).find((c) => c.id === 'chat-page')!;
    expect(chat.status).toBe('ready');
    expect(chat.cta).toBe('Get link');
  });

  it('offers Email as a ready-to-use forwarding address', () => {
    const email = channelsFor([]).find((c) => c.id === 'email')!;
    expect(email.status).toBe('ready');
    expect(email.cta).toBe('Get address');
  });

  it('has no unbuilt channels left — every card in the grid is a live one', () => {
    // messenger (08.5.4-b), whatsapp (08.5.6-b), sms (08.5.5-b), instagram
    // (08.5.7-e) and telegram (08.5.8-d) are all built — their status is
    // derived from /channels, not fixed — so the whole grid is live now.
    // The unbuilt-channel status and its notify button were removed with the
    // last card off that list (08.5-c, K08.5.1); this is the empty-set claim
    // that keeps them gone — add an unbuilt card and it fails.
    const built = new Set([
      'website',
      'chat-page',
      'email',
      'messenger',
      'whatsapp',
      'sms',
      'instagram',
      'telegram',
    ]);
    const rest = channelsFor([]).filter((c) => !built.has(c.id));
    expect(rest).toHaveLength(0);
  });

  it('represents three statuses, each driven by state — and no fourth one to be in', () => {
    const three = new Set(['not_connected', 'connected', 'ready']);
    const seen = new Set([
      website([]).status,
      website([{ status: 'connected' }]).status,
      channelsFor([]).find((c) => c.id === 'chat-page')!.status, // ready
    ]);
    expect(seen).toEqual(three);

    // And nothing in the grid is in a fourth state. `ChannelStatus` has only
    // these three members since 08.5-c removed the unbuilt-channel one, so a
    // card reaching for a status that no longer renders fails here as well as
    // at the type level.
    const statuses = channelsFor(
      [{ status: 'connected' }],
      [
        {
          type: 'telegram',
          status: 'connected',
          address: '@acme_bot',
          connected: true,
          created_at: '2026-01-01T00:00:00.000Z',
        },
      ],
    ).map((c) => c.status);
    expect(statuses.filter((status) => !three.has(status))).toEqual([]);
  });
});

/**
 * The Messenger card (FR-MOD-08.5.4) moved off the fixed "Coming soon" list
 * the same way Instagram/Telegram did: status/address come from the live
 * `/channels` list. Its not-connected CTA names the provider because the
 * button itself runs the mock OAuth exchange, unlike Instagram/Telegram's
 * plain "Connect".
 */
describe('channelsFor — messenger', () => {
  const messenger = (rows: ConnectedChannel[]) =>
    channelsFor([], rows).find((c) => c.id === 'messenger')!;

  const row = (overrides: Partial<ConnectedChannel> = {}): ConnectedChannel => ({
    type: 'messenger',
    status: 'connected',
    address: 'page_789',
    connected: true,
    created_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  });

  it('is Not connected with no connected-channel row, offering the Facebook mock connect CTA', () => {
    const card = messenger([]);
    expect(card.status).toBe('not_connected');
    expect(card.cta).toBe('Connect with Facebook (mock)');
    expect(card.address).toBeUndefined();
  });

  it('is Not connected when the row exists but is not currently connected', () => {
    const card = messenger([row({ connected: false, status: 'off' })]);
    expect(card.status).toBe('not_connected');
    expect(card.cta).toBe('Connect with Facebook (mock)');
  });

  it('is Connected when the /channels row is connected, offering Disconnect and showing the page id', () => {
    const card = messenger([row({ address: 'page_789' })]);
    expect(card.status).toBe('connected');
    expect(card.cta).toBe('Disconnect');
    expect(card.address).toBe('page_789');
  });

  it('does not confuse another connected channel type for messenger', () => {
    const card = messenger([row({ type: 'instagram' })]);
    expect(card.status).toBe('not_connected');
    expect(card.cta).toBe('Connect with Facebook (mock)');
  });
});

/**
 * The WhatsApp card (FR-MOD-08.5.6) moved off the fixed "Coming soon" list
 * the same way Messenger/SMS/Instagram/Telegram did: status/address come
 * from the live `/channels` list, not a fixed label.
 */
describe('channelsFor — whatsapp', () => {
  const whatsapp = (rows: ConnectedChannel[]) =>
    channelsFor([], rows).find((c) => c.id === 'whatsapp')!;

  const row = (overrides: Partial<ConnectedChannel> = {}): ConnectedChannel => ({
    type: 'whatsapp',
    status: 'connected',
    address: '+15551234567',
    connected: true,
    created_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  });

  it('is Not connected with no connected-channel row, offering Connect', () => {
    const card = whatsapp([]);
    expect(card.status).toBe('not_connected');
    expect(card.cta).toBe('Connect');
    expect(card.address).toBeUndefined();
  });

  it('is Not connected when the row exists but is not currently connected', () => {
    const card = whatsapp([row({ connected: false, status: 'off' })]);
    expect(card.status).toBe('not_connected');
    expect(card.cta).toBe('Connect');
  });

  it('is Connected when the /channels row is connected, offering Disconnect and showing the phone number', () => {
    const card = whatsapp([row({ address: '+15551234567' })]);
    expect(card.status).toBe('connected');
    expect(card.cta).toBe('Disconnect');
    expect(card.address).toBe('+15551234567');
  });

  it('does not confuse another connected channel type for whatsapp', () => {
    const card = whatsapp([row({ type: 'twilio' })]);
    expect(card.status).toBe('not_connected');
    expect(card.cta).toBe('Connect');
  });
});

/**
 * The SMS card (FR-MOD-08.5.5) moved off the fixed "Coming soon" list the
 * same way Messenger/Instagram/Telegram did: status/address come from the
 * live `/channels` list. Unlike Messenger, the card's own id (`sms`) differs
 * from the connected-channel type it looks up (`twilio`, the provider name).
 */
describe('channelsFor — sms', () => {
  const sms = (rows: ConnectedChannel[]) => channelsFor([], rows).find((c) => c.id === 'sms')!;

  const row = (overrides: Partial<ConnectedChannel> = {}): ConnectedChannel => ({
    type: 'twilio',
    status: 'connected',
    address: '+15551234567',
    connected: true,
    created_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  });

  it('is Not connected with no connected-channel row, offering Connect', () => {
    const card = sms([]);
    expect(card.status).toBe('not_connected');
    expect(card.cta).toBe('Connect');
    expect(card.address).toBeUndefined();
  });

  it('is Not connected when the row exists but is not currently connected', () => {
    const card = sms([row({ connected: false, status: 'off' })]);
    expect(card.status).toBe('not_connected');
    expect(card.cta).toBe('Connect');
  });

  it('is Connected when the /channels row is connected, offering Disconnect and showing the phone number', () => {
    const card = sms([row({ address: '+15551234567' })]);
    expect(card.status).toBe('connected');
    expect(card.cta).toBe('Disconnect');
    expect(card.address).toBe('+15551234567');
  });

  it('does not confuse another connected channel type for sms', () => {
    const card = sms([row({ type: 'messenger' })]);
    expect(card.status).toBe('not_connected');
    expect(card.cta).toBe('Connect');
  });
});

/**
 * The Instagram card (FR-MOD-08.5.7) moved off the fixed "Coming soon" list:
 * its status/cta/address are derived from the `/channels` list the same way
 * the Website card derives from `/websites`.
 */
describe('channelsFor — instagram', () => {
  const instagram = (rows: ConnectedChannel[]) =>
    channelsFor([], rows).find((c) => c.id === 'instagram')!;

  const row = (overrides: Partial<ConnectedChannel> = {}): ConnectedChannel => ({
    type: 'instagram',
    status: 'connected',
    address: 'ig_789',
    connected: true,
    created_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  });

  it('is Not connected with no connected-channel row, offering Connect', () => {
    const card = instagram([]);
    expect(card.status).toBe('not_connected');
    expect(card.cta).toBe('Connect');
    expect(card.address).toBeUndefined();
  });

  it('is Not connected when the row exists but is not currently connected', () => {
    const card = instagram([row({ connected: false, status: 'off' })]);
    expect(card.status).toBe('not_connected');
    expect(card.cta).toBe('Connect');
  });

  it('is Connected when the /channels row is connected, offering Disconnect and showing the address', () => {
    const card = instagram([row({ address: 'ig_789' })]);
    expect(card.status).toBe('connected');
    expect(card.cta).toBe('Disconnect');
    expect(card.address).toBe('ig_789');
  });

  it('does not confuse another connected channel type for instagram', () => {
    const card = instagram([row({ type: 'messenger' })]);
    expect(card.status).toBe('not_connected');
    expect(card.cta).toBe('Connect');
  });
});

/**
 * The Telegram card (FR-MOD-08.5.8) follows the same derivation as
 * Instagram's: status/cta/address come from the live `/channels` list, not a
 * fixed "Coming soon" label.
 */
describe('channelsFor — telegram', () => {
  const telegram = (rows: ConnectedChannel[]) =>
    channelsFor([], rows).find((c) => c.id === 'telegram')!;

  const row = (overrides: Partial<ConnectedChannel> = {}): ConnectedChannel => ({
    type: 'telegram',
    status: 'connected',
    address: 'nexa_support_bot',
    connected: true,
    created_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  });

  it('is Not connected with no connected-channel row, offering Connect', () => {
    const card = telegram([]);
    expect(card.status).toBe('not_connected');
    expect(card.cta).toBe('Connect');
    expect(card.address).toBeUndefined();
  });

  it('is Not connected when the row exists but is not currently connected', () => {
    const card = telegram([row({ connected: false, status: 'off' })]);
    expect(card.status).toBe('not_connected');
    expect(card.cta).toBe('Connect');
  });

  it('is Connected when the /channels row is connected, offering Disconnect and showing the address', () => {
    const card = telegram([row({ address: 'nexa_support_bot' })]);
    expect(card.status).toBe('connected');
    expect(card.cta).toBe('Disconnect');
    expect(card.address).toBe('nexa_support_bot');
  });

  it('does not confuse another connected channel type for telegram', () => {
    const card = telegram([row({ type: 'instagram' })]);
    expect(card.status).toBe('not_connected');
    expect(card.cta).toBe('Connect');
  });
});
