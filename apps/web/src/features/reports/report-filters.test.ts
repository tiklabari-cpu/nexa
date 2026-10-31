/**
 * Report filters in the address (RP-01 · tm 368.2): identifiers only, the same
 * spelling everywhere a filter travels, and no filter sent to a report that
 * refuses one.
 */
import { REPORT_FILTERABLE_GROUPS } from '@siyahtus/types';
import { describe, expect, it } from 'vitest';
import {
  NO_REPORT_FILTER,
  agentReportsHref,
  isReportFilterEmpty,
  normalizeReportFilter,
  parseReportFilter,
  reportFilterBody,
  reportFilterParams,
  takesReportFilter,
  teamReportsHref,
  writeReportFilter,
} from './report-filters.js';

const AGENT = '3f2b8c1e-5a4d-4e6f-9b7a-0c1d2e3f4a5b';
const TAG = '11111111-2222-4333-8444-555555555555';

describe('parseReportFilter — the address names identifiers, nothing else', () => {
  it('reads each key as a list, any-of within a key', () => {
    const filter = parseReportFilter(
      new URLSearchParams(`group_id=5&group_id=7&agent_id=${AGENT}&tag=${TAG}&topic=refund`),
    );
    expect(filter).toEqual({
      agent_id: [AGENT],
      group_id: ['5', '7'],
      tag: [TAG],
      topic: ['refund'],
    });
  });

  it('drops an e-mail address or a name in place of an id (GV-05)', () => {
    const filter = parseReportFilter(
      new URLSearchParams('agent_id=jane@acme.test&tag=Billing&group_id=Support'),
    );
    expect(filter).toEqual(NO_REPORT_FILTER);
  });

  it('spells a team and an id one way: 05 is 5, upper-case ids fold, duplicates collapse', () => {
    const filter = parseReportFilter(
      new URLSearchParams(
        `group_id=05&group_id=5&agent_id=${AGENT.toUpperCase()}&agent_id=${AGENT}`,
      ),
    );
    expect(filter.group_id).toEqual(['5']);
    expect(filter.agent_id).toEqual([AGENT]);
  });

  it('keeps at most what the API takes per key', () => {
    const many = Array.from({ length: 80 }, (_, index) => `group_id=${index + 1}`).join('&');
    expect(parseReportFilter(new URLSearchParams(many)).group_id).toHaveLength(50);
  });

  it('bounds a topic key like the API does', () => {
    const filter = parseReportFilter(new URLSearchParams(`topic=${'x'.repeat(201)}&topic=ok`));
    expect(filter.topic).toEqual(['ok']);
  });
});

describe('writeReportFilter', () => {
  it('replaces the filter keys and leaves the page keys', () => {
    const next = writeReportFilter(
      new URLSearchParams('tab=reviews&group_id=9&agent_id=old'),
      normalizeReportFilter({ group_id: ['5'], agent_id: [AGENT] }),
    );
    expect(next.getAll('group_id')).toEqual(['5']);
    expect(next.getAll('agent_id')).toEqual([AGENT]);
    expect(next.get('tab')).toBe('reviews');
  });

  it('clears the keys when the filter is empty', () => {
    const next = writeReportFilter(new URLSearchParams('group_id=9&tag=x'), NO_REPORT_FILTER);
    expect(next.toString()).toBe('');
  });
});

describe('reportFilterParams — one function decides what a request carries', () => {
  const filter = normalizeReportFilter({ group_id: ['5', '7'], agent_id: [AGENT], topic: ['a b'] });

  it('repeats a key per value, as the API reads it', () => {
    const params = new URLSearchParams(reportFilterParams('overview', filter));
    expect(params.getAll('group_id')).toEqual(['5', '7']);
    expect(params.getAll('agent_id')).toEqual([AGENT]);
    expect(params.getAll('topic')).toEqual(['a b']);
  });

  it('is empty when the filter narrows nothing', () => {
    expect(reportFilterParams('overview', NO_REPORT_FILTER)).toBe('');
    expect(isReportFilterEmpty(NO_REPORT_FILTER)).toBe(true);
  });

  it('sends the filter to exactly the four conversation reports and no other', () => {
    for (const group of REPORT_FILTERABLE_GROUPS) {
      expect(takesReportFilter(group)).toBe(true);
      expect(reportFilterParams(group, filter)).not.toBe('');
    }
    for (const group of ['cases', 'leads', 'sales', 'topics', 'ai-agent', 'staffing-forecast']) {
      expect(takesReportFilter(group)).toBe(false);
      expect(reportFilterParams(group, filter)).toBe('');
    }
  });
});

describe('reportFilterBody — what a share link is created with', () => {
  it('is the non-empty keys, or nothing', () => {
    expect(reportFilterBody('breakdown', NO_REPORT_FILTER)).toBeUndefined();
    expect(reportFilterBody('breakdown', normalizeReportFilter({ tag: [TAG] }))).toEqual({
      tag: [TAG],
    });
  });

  it('is nothing for a report that takes no filter', () => {
    expect(reportFilterBody('cases', normalizeReportFilter({ tag: [TAG] }))).toBeUndefined();
  });
});

describe('deep links', () => {
  it('open the reports by number or account id, never by name or e-mail', () => {
    expect(teamReportsHref(5)).toBe('/app/reports?group_id=5');
    expect(agentReportsHref(AGENT)).toBe(`/app/reports?agent_id=${AGENT}`);
    expect(`${teamReportsHref(5)}${agentReportsHref(AGENT)}`).not.toContain('@');
  });

  it('read back as the filter they name', () => {
    const url = new URL(teamReportsHref(5), 'http://x');
    expect(parseReportFilter(url.searchParams).group_id).toEqual(['5']);
  });
});
