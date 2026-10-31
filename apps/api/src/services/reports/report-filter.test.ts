import { describe, expect, it } from 'vitest';
import { isEmptyReportFilter, isReportFilterableGroup } from '@siyahtus/types';
import {
  assertFilterable,
  normalizeReportFilter,
  parseReportFilterQuery,
  queryNamesReportFilter,
  reportFilterBody,
  reportFilterJson,
  storedReportFilter,
  threadFilterSql,
  toThreadFilter,
  toWireFilter,
} from './report-filter.js';

const A = '0c1f6f2e-6f8b-4b7e-9a51-4f3d2b8a1c01';
const B = '0c1f6f2e-6f8b-4b7e-9a51-4f3d2b8a1c02';

describe('report filter parsing (RP-01 · tm 368)', () => {
  it('reads one value or many, drops duplicates and treats an empty list as no key', () => {
    expect(parseReportFilterQuery({ agent_id: A })).toEqual({ agent_id: [A] });
    expect(parseReportFilterQuery({ agent_id: [A, A.toUpperCase(), B] })).toEqual({
      agent_id: [A, B],
    });
    expect(parseReportFilterQuery({ group_id: ['05', '5', '7'] })).toEqual({
      group_id: ['5', '7'],
    });
    expect(normalizeReportFilter({ tag: [] })).toEqual({});
    expect(parseReportFilterQuery({ from: '2026-10-01', baseline: 'previous_year' })).toEqual({});
  });

  it('accepts identifiers only — no e-mail, no team name (GV-05)', () => {
    expect(() => parseReportFilterQuery({ agent_id: 'agent@example.test' })).toThrow(/agent_id/);
    expect(() => parseReportFilterQuery({ group_id: 'finans' })).toThrow(/group_id/);
    expect(() => parseReportFilterQuery({ tag: 'bonus' })).toThrow(/tag/);
    expect(() =>
      parseReportFilterQuery({ agent_id: Array.from({ length: 51 }, () => A) }),
    ).toThrow();
    expect(reportFilterBody.safeParse({ email: ['x@example.test'] }).success).toBe(false);
  });

  it('round-trips wire ⇄ query form, and stores the canonical JSON', () => {
    const wire = { agent_id: [A], group_id: ['12'], tag: [B], topic: ['withdrawal'] };
    const thread = toThreadFilter(wire);
    expect(thread?.groupIds).toEqual([12n]);
    expect(toWireFilter(thread)).toEqual(wire);
    expect(toThreadFilter({})).toBeNull();
    expect(toWireFilter(null)).toEqual({});
    expect(reportFilterJson(wire)).toEqual(wire);
    expect(storedReportFilter({ group_id: [12] })).toEqual({ group_id: ['12'] });
    expect(() => storedReportFilter({ agent_id: 'not-a-list' })).toThrow();
  });

  it('knows which query strings name a filter and which groups take one', () => {
    expect(queryNamesReportFilter({ topic: 'x' })).toBe(true);
    expect(queryNamesReportFilter({ team_id: '1', intent: 'x' })).toBe(false);
    expect(isReportFilterableGroup('overview')).toBe(true);
    expect(isReportFilterableGroup('cases')).toBe(false);
    expect(isEmptyReportFilter({})).toBe(true);
    expect(isEmptyReportFilter({ tag: [B] })).toBe(false);
    expect(() => assertFilterable('cases', { agentIds: [A] })).toThrow(/cases/);
    expect(() => assertFilterable('cases', null)).not.toThrow();
  });

  it('narrows nothing without a filter and every row on an empty team list', () => {
    expect(threadFilterSql(null).sql).toBe('TRUE');
    const empty = threadFilterSql({ groupIds: [] });
    expect(empty.sql).toContain('chat_access');
    expect(empty.values).toContainEqual([]);
  });
});
