import { describe, expect, it } from 'vitest';
import type { Campaign, CampaignStatus } from '@nexa/types';
import {
  CAMPAIGN_TABS,
  campaignCounts,
  conversionRate,
  filterCampaigns,
  isCampaignActive,
  isCampaignFilter,
} from './campaigns.js';

function campaign(status: CampaignStatus, over: Partial<Campaign> = {}): Campaign {
  return {
    id: `c-${status}-${over.name ?? ''}`,
    name: 'A campaign',
    status,
    conditions: { url_contains: '/pricing' },
    content: { message: 'Hi' },
    starts_at: null,
    ends_at: null,
    recurring: false,
    created_at: '2026-07-26T12:00:00.000Z',
    performance: { displayed: 0, chats: 0, conversion: 0 },
    ...over,
  };
}

describe('CAMPAIGN_TABS', () => {
  it('offers All / Ongoing / Scheduled / Inactive in order (FR-MOD-03.3.1)', () => {
    expect(CAMPAIGN_TABS.map((tab) => tab.id)).toEqual(['all', 'ongoing', 'scheduled', 'inactive']);
  });
});

describe('isCampaignFilter', () => {
  it('accepts the tab ids and rejects anything else', () => {
    expect(isCampaignFilter('ongoing')).toBe(true);
    expect(isCampaignFilter('all')).toBe(true);
    expect(isCampaignFilter('active')).toBe(false);
    expect(isCampaignFilter('')).toBe(false);
  });
});

describe('filterCampaigns', () => {
  const list = [campaign('ongoing'), campaign('scheduled'), campaign('inactive'), campaign('ongoing')];

  it('keeps everything for the "all" tab', () => {
    expect(filterCampaigns(list, 'all')).toHaveLength(4);
  });

  it('narrows to a single status for the other tabs', () => {
    expect(filterCampaigns(list, 'ongoing').every((c) => c.status === 'ongoing')).toBe(true);
    expect(filterCampaigns(list, 'ongoing')).toHaveLength(2);
    expect(filterCampaigns(list, 'inactive')).toHaveLength(1);
    expect(filterCampaigns(list, 'scheduled')).toHaveLength(1);
  });

  it('does not mutate the input for the "all" tab', () => {
    const returned = filterCampaigns(list, 'all');
    expect(returned).not.toBe(list);
  });
});

describe('campaignCounts', () => {
  it('counts each tab, with "all" being the total', () => {
    const counts = campaignCounts([campaign('ongoing'), campaign('ongoing'), campaign('inactive')]);
    expect(counts).toEqual({ all: 3, ongoing: 2, scheduled: 0, inactive: 1 });
  });
});

describe('isCampaignActive', () => {
  it('reads as on for anything but inactive', () => {
    expect(isCampaignActive({ status: 'ongoing' })).toBe(true);
    expect(isCampaignActive({ status: 'scheduled' })).toBe(true);
    expect(isCampaignActive({ status: 'inactive' })).toBe(false);
  });
});

describe('conversionRate', () => {
  it('is a whole-number percentage of the visitors reached', () => {
    expect(conversionRate({ displayed: 200, chats: 40, conversion: 30 })).toBe(15);
  });

  it('is zero — not NaN — before anything has been displayed', () => {
    expect(conversionRate({ displayed: 0, chats: 0, conversion: 0 })).toBe(0);
  });
});
