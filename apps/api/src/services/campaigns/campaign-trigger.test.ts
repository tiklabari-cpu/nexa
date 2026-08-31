/**
 * The visit-side trigger rule (FR-MOD-03.3.2, tm 176.5).
 *
 * `selectTriggeredCampaigns` answers "which running campaigns should fire at a
 * visitor who is on these pages, right now" — the decision that sends somebody
 * an unsolicited message. Every part of it is a judgement call worth pinning
 * without a database: what counts as running, whether a stale stored status is
 * believed, and what a campaign with no trigger matches.
 */
import { describe, expect, it } from 'vitest';
import { selectTriggeredCampaigns, type TriggerableCampaign } from './campaign-trigger.js';

const NOW = new Date('2026-08-31T12:00:00.000Z');
const hoursFromNow = (n: number): Date => new Date(NOW.getTime() + n * 3_600_000);
const PRICING = ['https://shop.example/pricing'];

function campaign(id: string, overrides: Partial<TriggerableCampaign> = {}): TriggerableCampaign {
  return {
    id,
    status: 'ongoing',
    conditions: { url_contains: '/pricing' },
    startsAt: null,
    endsAt: null,
    ...overrides,
  };
}

describe('selectTriggeredCampaigns', () => {
  it('fires nothing when the workspace runs no campaigns', () => {
    expect(selectTriggeredCampaigns([], PRICING, NOW)).toEqual([]);
  });

  it('fires every running campaign whose trigger matches the visitor', () => {
    // The dual of the create-time engine: one visitor, many campaigns. A
    // visitor on a page two campaigns target is owed both — the poll is what
    // spaces them out one card at a time, not this.
    const fired = selectTriggeredCampaigns(
      [
        campaign('a'),
        campaign('b'),
        campaign('elsewhere', { conditions: { url_contains: '/faq' } }),
      ],
      PRICING,
      NOW,
    );
    expect(fired).toEqual(['a', 'b']);
  });

  it('leaves a visitor whose pages match nothing alone', () => {
    expect(selectTriggeredCampaigns([campaign('a')], ['https://shop.example/blog'], NOW)).toEqual(
      [],
    );
  });

  it('matches on any page of the visit, not only the newest', () => {
    // Same reading as the create-time engine and the goal funnel: somebody who
    // passed /pricing and then wrote in from /support is still on the journey
    // the campaign was aimed at.
    const pages = ['https://shop.example/pricing', 'https://shop.example/support'];
    expect(selectTriggeredCampaigns([campaign('a')], pages, NOW)).toEqual(['a']);
  });

  // --- Running *now*, not according to a status somebody last wrote ---------

  it('does not fire a campaign the owner switched off', () => {
    expect(
      selectTriggeredCampaigns([campaign('off', { status: 'inactive' })], PRICING, NOW),
    ).toEqual([]);
  });

  it('does not fire a campaign whose window has closed', () => {
    // The stored status still says `ongoing`: it is only recomputed when the
    // owner saves (tm 176.6). A new arrival must not be nudged by a campaign
    // that ended last week just because nobody has touched it since.
    const expired = campaign('expired', { endsAt: hoursFromNow(-1) });
    expect(selectTriggeredCampaigns([expired], PRICING, NOW)).toEqual([]);
  });

  it('does not fire a campaign that has not started yet', () => {
    expect(
      selectTriggeredCampaigns([campaign('later', { startsAt: hoursFromNow(1) })], PRICING, NOW),
    ).toEqual([]);
  });

  it('fires a scheduled campaign whose start time has come', () => {
    // The half that only this path can notice. The row was stored `scheduled`
    // and nothing has written to it since, so its status is still `scheduled`
    // — but the window is open, and the visitor arriving now is exactly who it
    // was scheduled for.
    const started = campaign('started', {
      status: 'scheduled',
      startsAt: hoursFromNow(-1),
      endsAt: hoursFromNow(1),
    });
    expect(selectTriggeredCampaigns([started], PRICING, NOW)).toEqual(['started']);
  });

  // --- A campaign that cannot target matches nobody, not everybody ----------

  it('refuses to fire a campaign with no trigger', () => {
    const untriggered = [
      campaign('empty', { conditions: {} }),
      campaign('blank', { conditions: { url_contains: '   ' } }),
      campaign('null', { conditions: null }),
      campaign('undefined', { conditions: undefined }),
    ];
    expect(selectTriggeredCampaigns(untriggered, PRICING, NOW)).toEqual([]);
  });

  it('keeps evaluating past a campaign it cannot fire', () => {
    const fired = selectTriggeredCampaigns(
      [
        campaign('off', { status: 'inactive' }),
        campaign('expired', { endsAt: hoursFromNow(-1) }),
        campaign('live'),
      ],
      PRICING,
      NOW,
    );
    expect(fired).toEqual(['live']);
  });

  it('matches the trigger case-insensitively, like the create-time engine', () => {
    const shouty = campaign('shouty', { conditions: { url_contains: '/PRICING' } });
    expect(selectTriggeredCampaigns([shouty], PRICING, NOW)).toEqual(['shouty']);
  });
});
