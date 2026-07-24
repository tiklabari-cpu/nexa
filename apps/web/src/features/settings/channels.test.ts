import { describe, expect, it } from 'vitest';
import { channelsFor } from './Channels.js';

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

  it('shows every unbuilt channel as Coming soon with Get notified', () => {
    const built = new Set(['website', 'chat-page']);
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
