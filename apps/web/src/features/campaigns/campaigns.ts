/**
 * Campaigns view logic (FR-MOD-03.3), kept free of React so the two rules the
 * feature turns on — which tab a campaign belongs to, and what its numbers say —
 * are decided by pure functions a unit test can pin down.
 */
import {
  CAMPAIGN_STATUS_FILTERS,
  type Campaign,
  type CampaignStatus,
  type CampaignStatusFilter,
} from '@nexa/types';

/** The status sub-tabs in display order (FR-MOD-03.3.1). */
export const CAMPAIGN_TABS: ReadonlyArray<{ id: CampaignStatusFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'ongoing', label: 'Ongoing' },
  { id: 'scheduled', label: 'Scheduled' },
  { id: 'inactive', label: 'Inactive' },
];

/** True for a value the status tabs understand — guards a URL/query param. */
export function isCampaignFilter(value: string): value is CampaignStatusFilter {
  return (CAMPAIGN_STATUS_FILTERS as readonly string[]).includes(value);
}

/** Narrow a campaign list to a status tab; `all` keeps everything (FR-MOD-03.3.1). */
export function filterCampaigns(
  campaigns: readonly Campaign[],
  filter: CampaignStatusFilter,
): Campaign[] {
  return filter === 'all'
    ? [...campaigns]
    : campaigns.filter((campaign) => campaign.status === filter);
}

/** How many campaigns fall under each tab — the counts shown beside the labels. */
export function campaignCounts(
  campaigns: readonly Campaign[],
): Record<CampaignStatusFilter, number> {
  const counts: Record<CampaignStatusFilter, number> = {
    all: campaigns.length,
    ongoing: 0,
    scheduled: 0,
    inactive: 0,
  };
  for (const campaign of campaigns) counts[campaign.status] += 1;
  return counts;
}

export const CAMPAIGN_STATUS_LABEL: Record<CampaignStatus, string> = {
  ongoing: 'Ongoing',
  scheduled: 'Scheduled',
  inactive: 'Inactive',
};

/** Whether the on/off toggle reads as on — anything but `inactive` is running. */
export function isCampaignActive(campaign: Pick<Campaign, 'status'>): boolean {
  return campaign.status !== 'inactive';
}

/**
 * Conversion rate as a whole-number percentage of the visitors reached — the one
 * derived figure the card shows beyond the raw counts. Zero when nothing has been
 * displayed yet, so a brand-new campaign reads 0% rather than dividing by zero.
 */
export function conversionRate(performance: Campaign['performance']): number {
  if (performance.displayed === 0) return 0;
  return Math.round((performance.conversion / performance.displayed) * 100);
}
