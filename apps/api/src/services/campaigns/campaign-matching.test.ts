import { describe, expect, it } from 'vitest';
import {
  campaignPerformance,
  computeCampaignStatus,
  hasTrigger,
  matchesConditions,
  visitorPageUrls,
} from './campaign-matching.js';

describe('visitorPageUrls', () => {
  it('pulls the string urls out of a pages array', () => {
    expect(
      visitorPageUrls([
        { url: 'https://shop.example/pricing', at: 'x' },
        { url: 'https://shop.example/cart' },
      ]),
    ).toEqual(['https://shop.example/pricing', 'https://shop.example/cart']);
  });

  it('survives malformed json rather than throwing', () => {
    expect(visitorPageUrls(null)).toEqual([]);
    expect(visitorPageUrls('not-an-array')).toEqual([]);
    expect(visitorPageUrls([{ url: 42 }, {}, { url: '' }, { url: '/ok' }])).toEqual(['/ok']);
  });
});

describe('hasTrigger', () => {
  it('is true only when a condition carries something to match on', () => {
    expect(hasTrigger({ url_contains: '/pricing' })).toBe(true);
    expect(hasTrigger({})).toBe(false);
    expect(hasTrigger({ url_contains: '   ' })).toBe(false);
  });
});

describe('matchesConditions', () => {
  it('matches when the visitor is on a page containing the needle (case-insensitive)', () => {
    expect(matchesConditions({ url_contains: '/Pricing' }, ['https://shop.example/pricing'])).toBe(
      true,
    );
  });

  it('does not match when no page contains the needle', () => {
    expect(matchesConditions({ url_contains: '/pricing' }, ['https://shop.example/blog'])).toBe(
      false,
    );
  });

  it('matches nobody when there is no trigger', () => {
    // The rule that keeps "trigger required" honest: an empty predicate is not
    // "everyone", it is "not ready".
    expect(matchesConditions({}, ['https://shop.example/pricing'])).toBe(false);
    expect(matchesConditions({ url_contains: '' }, ['https://shop.example/pricing'])).toBe(false);
  });
});

describe('computeCampaignStatus', () => {
  const now = new Date('2026-07-26T12:00:00.000Z');
  const hourBefore = new Date('2026-07-26T11:00:00.000Z');
  const hourAfter = new Date('2026-07-26T13:00:00.000Z');

  it('is inactive whenever the campaign is switched off, whatever the schedule', () => {
    expect(computeCampaignStatus({ active: false, startsAt: null, endsAt: null }, now)).toBe(
      'inactive',
    );
    expect(
      computeCampaignStatus({ active: false, startsAt: hourBefore, endsAt: hourAfter }, now),
    ).toBe('inactive');
  });

  it('is scheduled while an active campaign has not started yet', () => {
    expect(computeCampaignStatus({ active: true, startsAt: hourAfter, endsAt: null }, now)).toBe(
      'scheduled',
    );
  });

  it('is ongoing once an active campaign has started and not ended', () => {
    expect(computeCampaignStatus({ active: true, startsAt: hourBefore, endsAt: null }, now)).toBe(
      'ongoing',
    );
    expect(computeCampaignStatus({ active: true, startsAt: null, endsAt: hourAfter }, now)).toBe(
      'ongoing',
    );
    expect(computeCampaignStatus({ active: true, startsAt: null, endsAt: null }, now)).toBe(
      'ongoing',
    );
  });

  it('falls back to inactive once an active campaign has ended', () => {
    expect(
      computeCampaignStatus({ active: true, startsAt: hourBefore, endsAt: hourBefore }, now),
    ).toBe('inactive');
  });
});

describe('campaignPerformance', () => {
  it('counts displayed / chats / conversion from the sends', () => {
    expect(
      campaignPerformance([
        { engaged: false, converted: false },
        { engaged: true, converted: false },
        { engaged: true, converted: true },
      ]),
    ).toEqual({ displayed: 3, chats: 2, conversion: 1 });
  });

  it('is all zeros for a campaign that has fired at nobody', () => {
    expect(campaignPerformance([])).toEqual({ displayed: 0, chats: 0, conversion: 0 });
  });
});
