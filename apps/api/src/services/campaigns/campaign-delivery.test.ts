/**
 * The campaign delivery selection rule (FR-MOD-03.3.2).
 *
 * `pickDeliverableSend` answers one question — of everything this visitor is
 * still owed, which single message should this poll carry — and every part of
 * the answer is a decision somebody could reasonably have made differently:
 * oldest first, one at a time, and the campaign's schedule judged now rather
 * than when the trigger matched. Pinned here, without a database, so those
 * decisions cannot drift silently.
 */
import { describe, expect, it } from 'vitest';
import { pickDeliverableSend, type PendingSend } from './campaign-delivery.js';

const NOW = new Date('2026-08-31T12:00:00.000Z');
const hoursFromNow = (n: number): Date => new Date(NOW.getTime() + n * 3_600_000);

function send(id: string, overrides: Partial<PendingSend['campaign']> = {}): PendingSend {
  return {
    id: `send-${id}`,
    campaign: {
      id: `campaign-${id}`,
      status: 'ongoing',
      content: { message: `message ${id}` },
      startsAt: null,
      endsAt: null,
      ...overrides,
    },
  };
}

describe('pickDeliverableSend', () => {
  it('returns nothing when nothing is owed', () => {
    expect(pickDeliverableSend([], NOW)).toBeNull();
  });

  it('carries the oldest owed send, and only that one', () => {
    // The caller reads them ordered oldest-first; the rule takes the head.
    const picked = pickDeliverableSend([send('a'), send('b'), send('c')], NOW);
    expect(picked).toEqual({
      sendId: 'send-a',
      campaignId: 'campaign-a',
      message: 'message a',
    });
  });

  it('trims the stored message', () => {
    const picked = pickDeliverableSend([send('a', { content: { message: '  hello  ' } })], NOW);
    expect(picked?.message).toBe('hello');
  });

  // --- Still running *now*, not when the trigger matched ---------------------

  it('skips a send whose campaign has been switched off', () => {
    const picked = pickDeliverableSend([send('off', { status: 'inactive' }), send('live')], NOW);
    expect(picked?.campaignId).toBe('campaign-live');
  });

  it('skips a send whose campaign window has closed since it was queued', () => {
    // The stored status still says `ongoing` — it is only recomputed on write
    // (tm 176.6). Delivery must not depend on that being fresh.
    const expired = send('expired', { status: 'ongoing', endsAt: hoursFromNow(-1) });
    expect(pickDeliverableSend([expired], NOW)).toBeNull();
  });

  it('skips a send whose campaign has not started yet', () => {
    const future = send('future', { status: 'ongoing', startsAt: hoursFromNow(1) });
    expect(pickDeliverableSend([future], NOW)).toBeNull();
  });

  it('delivers inside an open window', () => {
    const running = send('running', { startsAt: hoursFromNow(-1), endsAt: hoursFromNow(1) });
    expect(pickDeliverableSend([running], NOW)?.campaignId).toBe('campaign-running');
  });

  // --- An undeliverable send must not wedge the ones behind it ---------------

  it('passes over undeliverable sends rather than stopping at the first', () => {
    const picked = pickDeliverableSend(
      [
        send('off', { status: 'inactive' }),
        send('expired', { endsAt: hoursFromNow(-1) }),
        send('live'),
      ],
      NOW,
    );
    expect(picked?.campaignId).toBe('campaign-live');
  });

  it('refuses to deliver an empty card', () => {
    // A campaign cannot be created or activated without a message, so this is a
    // row switched off and emptied. Blank, whitespace and a missing key alike.
    const blank = [
      send('none', { content: {} }),
      send('empty', { content: { message: '' } }),
      send('spaces', { content: { message: '   ' } }),
      send('null', { content: null }),
    ];
    expect(pickDeliverableSend(blank, NOW)).toBeNull();
    expect(pickDeliverableSend([...blank, send('real')], NOW)?.campaignId).toBe('campaign-real');
  });
});
