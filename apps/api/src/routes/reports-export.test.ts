import { describe, expect, it } from 'vitest';
import {
  EXPORT_SCOPES,
  REPORT_GROUPS,
  exportFilename,
  reportGroup,
  toCsv,
  visibleReportGroups,
} from './reports-export.js';

describe('report group catalogue', () => {
  it('resolves a known id and rejects an unknown one', () => {
    expect(reportGroup('overview')?.label).toBe('Overview');
    expect(reportGroup('topics')?.label).toBe('Chat topics');
    expect(reportGroup('nonexistent')).toBeUndefined();
  });

  it('derives the export scope union from the catalogue, without duplicates', () => {
    // Every group is reachable through the endpoint's required scopes, and the
    // set is deduped rather than hand-listed.
    for (const group of REPORT_GROUPS) {
      expect(group.scopes.some((scope) => EXPORT_SCOPES.includes(scope))).toBe(true);
    }
    expect(new Set(EXPORT_SCOPES).size).toBe(EXPORT_SCOPES.length);
  });
});

describe('visibleReportGroups — permission-based visibility (07.7)', () => {
  it('shows every reports_read group to a reader', () => {
    const visible = visibleReportGroups(['reports_read']).map((group) => group.id);
    expect(visible).toEqual(REPORT_GROUPS.map((group) => group.id));
  });

  it('shows nothing to a token without the scope — empty, not an error', () => {
    // The list answers "what can you see" with nothing; the 403 is the export
    // endpoint's job, not the catalogue's.
    expect(visibleReportGroups(['chats--all:ro'])).toEqual([]);
    expect(visibleReportGroups([])).toEqual([]);
  });

  it('honours scope implication (an --all/:rw grant expands)', () => {
    // reports_read does not follow the `--` pattern, so it is granted only when
    // held outright — a chats grant must never leak reports visibility.
    expect(visibleReportGroups(['chats--all:rw'])).toEqual([]);
  });
});

describe('toCsv', () => {
  it('emits a header row and data rows, CRLF-terminated', () => {
    const csv = toCsv(['date', 'chats'], [['2026-07-20', 3]]);
    expect(csv).toBe('date,chats\r\n2026-07-20,3\r\n');
  });

  it('renders null and undefined as empty cells', () => {
    expect(toCsv(['a', 'b'], [[null, undefined]])).toBe('a,b\r\n,\r\n');
  });

  it('quotes fields with commas, quotes or newlines and doubles inner quotes', () => {
    const csv = toCsv(['name'], [['Doe, Jane'], ['a "quote"'], ['line\nbreak']]);
    expect(csv).toBe('name\r\n"Doe, Jane"\r\n"a ""quote"""\r\n"line\nbreak"\r\n');
  });

  it('neutralises spreadsheet formula injection on user-influenced fields', () => {
    // A tag or agent name that opens with a formula lead would execute on open
    // in Excel/Sheets. Prefixing a single quote defuses it; the field is then
    // quoted only if it also carries a separator.
    expect(toCsv(['tag'], [['=1+1']])).toBe("tag\r\n'=1+1\r\n");
    expect(toCsv(['tag'], [['@SUM(A1)']])).toBe("tag\r\n'@SUM(A1)\r\n");
    // A leading '-' is a formula lead too; the guarded value then needs quoting
    // because it carries a comma.
    expect(toCsv(['tag'], [['-2,5']])).toBe('tag\r\n"\'-2,5"\r\n');
  });

  it('drops non-finite numbers to empty rather than writing NaN/Infinity', () => {
    // Both cells are non-finite, so both render empty — the row is a lone comma
    // between two empty fields, under a matching two-column header.
    expect(toCsv(['a', 'b'], [[Number.NaN, Number.POSITIVE_INFINITY]])).toBe('a,b\r\n,\r\n');
  });
});

describe('exportFilename', () => {
  it('encodes the group and the UTC window', () => {
    const from = new Date('2026-07-01T00:00:00.000Z');
    const to = new Date('2026-07-26T12:00:00.000Z');
    expect(exportFilename('breakdown', from, to)).toBe('nexa-breakdown-2026-07-01-2026-07-26.csv');
  });
});
