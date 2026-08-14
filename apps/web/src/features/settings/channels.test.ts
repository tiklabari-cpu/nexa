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

  it('shows every unbuilt channel as Coming soon with Get notified', () => {
    // instagram (08.5.7-e) and telegram (08.5.8-d) are built — their status is
    // derived from /channels, not fixed — so both are excluded here the same
    // way website/chat-page/email are.
    const built = new Set(['website', 'chat-page', 'email', 'instagram', 'telegram']);
    const rest = channelsFor([]).filter((c) => !built.has(c.id));
    expect(rest.length).toBeGreaterThan(0);
    for (const channel of rest) {
      expect(channel.status).toBe('coming_soon');
      expect(channel.cta).toBe('Get notified');
    }
  });

  it('represents all four statuses, each driven by state', () => {
    const seen = new Set([
      website([]).status,
      website([{ status: 'connected' }]).status,
      channelsFor([]).find((c) => c.id === 'chat-page')!.status, // ready
      channelsFor([]).find((c) => c.id === 'whatsapp')!.status, // coming_soon
    ]);
    expect(seen).toEqual(new Set(['not_connected', 'connected', 'ready', 'coming_soon']));
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
