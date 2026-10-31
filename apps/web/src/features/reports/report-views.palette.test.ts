/**
 * Report views in the command palette (IN-11): the tabs and the agent's saved
 * views, matched with the Turkish fold and ranked like the settings sections.
 */
import { describe, expect, it } from 'vitest';
import {
  REPORT_TAB_LABEL_KEYS,
  REPORT_TABS,
  parseReportTab,
  reportsHref,
  searchReportViews,
  type ReportTabId,
  type SavedReportView,
} from './report-views.js';

const TR: Record<ReportTabId, string> = {
  overview: 'Genel bakış',
  'ai-agent': 'AI Ajanı',
  reviews: 'Değerlendirmeler',
  breakdown: 'Dağılım',
  staffing: 'Kadro',
  topics: 'Sohbet konuları',
  cases: 'Talepler',
  leads: 'Potansiyel müşteriler',
  sales: 'Satışlar',
  'team-performance': 'Ekip performansı',
};
const labelOf = (tab: ReportTabId): string => TR[tab];

const VIEW: SavedReportView = {
  id: 'v-1',
  name: 'Haftalık değerlendirme',
  tab: 'reviews',
  mode: 7,
  customFrom: '',
  customTo: '',
  baseline: null,
};

describe('report view catalogue', () => {
  it('has a label key for every tab', () => {
    for (const tab of REPORT_TABS) expect(REPORT_TAB_LABEL_KEYS[tab]).toMatch(/^reports\.tabs\./);
  });

  it('parses only tabs this build knows', () => {
    expect(parseReportTab('cases')).toBe('cases');
    expect(parseReportTab('nope')).toBeNull();
    expect(parseReportTab(null)).toBeNull();
  });

  it('builds the two addresses the page reads', () => {
    expect(reportsHref({ tab: 'team-performance' })).toBe('/app/reports?tab=team-performance');
    expect(reportsHref({ viewId: 'a b' })).toBe('/app/reports?view=a%20b');
  });
});

describe('searchReportViews', () => {
  it('finds a tab through the Turkish fold, "performansi" reaching "Ekip performansı"', () => {
    expect(searchReportViews('performansi', labelOf, []).map((m) => m.href)).toEqual([
      '/app/reports?tab=team-performance',
    ]);
    expect(searchReportViews('GENEL', labelOf, [])[0]?.href).toBe('/app/reports?tab=overview');
  });

  it('lists a saved view by name, with the tab it opens on, after tabs of an equal rank', () => {
    const found = searchReportViews('degerlendirme', labelOf, [VIEW]);
    expect(found.map((m) => m.id)).toEqual(['tab:reviews', 'view:v-1']);
    expect(found[1]).toMatchObject({
      label: 'Haftalık değerlendirme',
      sub: 'Değerlendirmeler',
      href: '/app/reports?view=v-1',
    });
  });

  it('ranks a label start before a label inside, and stops at the limit', () => {
    const found = searchReportViews('talep', labelOf, [
      { ...VIEW, id: 'v-2', name: 'Açık talepler' },
    ]);
    expect(found.map((m) => m.id)).toEqual(['tab:cases', 'view:v-2']);
    expect(searchReportViews('a', labelOf, [], 3)).toHaveLength(3);
  });

  it('matches nothing for a blank query or an unknown word', () => {
    expect(searchReportViews('  ', labelOf, [VIEW])).toEqual([]);
    expect(searchReportViews('xyzzy', labelOf, [VIEW])).toEqual([]);
  });
});
