import { describe, expect, it } from 'vitest';
import { hasAnyScope } from '@nexa/types';
import {
  EXPORT_SCOPES,
  REPORT_GROUPS,
  exportFilename,
  reportGroup,
  toCsv,
  toPdf,
  visibleReportGroups,
} from './reports-export.js';

describe('report group catalogue', () => {
  it('resolves a known id and rejects an unknown one', () => {
    expect(reportGroup('overview')?.label).toBe('Overview');
    expect(reportGroup('topics')?.label).toBe('Chat topics');
    expect(reportGroup('cases')?.label).toBe('Cases');
    expect(reportGroup('leads')?.label).toBe('Leads');
    expect(reportGroup('team-performance')?.label).toBe('Team performance');
    expect(reportGroup('sales')?.label).toBe('Sales');
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

/**
 * The catalogue's own invariants (07.7-l).
 *
 * The permission sweep in `reports-billing.test.ts` is driven off this list, so
 * everything it can prove rests on the list being sweepable in the first place:
 * every entry actually gated, every id distinct, every id the same string on
 * both surfaces. These are cheap to state and silent to break.
 */
describe('the catalogue is safe to gate and safe to sweep (07.7-l)', () => {
  it('gives every group a scope — an empty requirement would open it to any token', () => {
    // `hasAnyScope(granted, [])` is `true` by design: a route that requires no
    // scope is not an authorization failure. So a catalogue entry that declared
    // none would be listed to, and exportable by, every authenticated caller —
    // while still reading as gated next to its neighbours, which is exactly the
    // kind of mistake a review does not catch.
    for (const group of REPORT_GROUPS) {
      expect(group.scopes.length, group.id).toBeGreaterThan(0);
      expect(hasAnyScope([], group.scopes), group.id).toBe(false);
      expect(hasAnyScope(['chats--all:rw'], group.scopes), group.id).toBe(false);
    }
  });

  it('keeps every id distinct, and identical on the path and on the query string', () => {
    // The id is the path segment of `/reports/<id>` and the value of
    // `?group=<id>`; the two surfaces only speak one vocabulary while it needs
    // no encoding. A duplicate would make `reportGroup()` resolve the first
    // silently and hide the second from any sweep driven off this list.
    expect(new Set(REPORT_GROUPS.map((group) => group.id)).size).toBe(REPORT_GROUPS.length);
    for (const group of REPORT_GROUPS) {
      expect(group.id, group.id).toMatch(/^[a-z][a-z0-9-]*$/);
      expect(encodeURIComponent(group.id), group.id).toBe(group.id);
      expect(group.label.trim(), group.id).not.toBe('');
    }
  });

  it('resolves every catalogue id, and nothing that merely looks like one', () => {
    for (const group of REPORT_GROUPS) expect(reportGroup(group.id)).toBe(group);
    // A near miss must be a 400 from the route, not a silent match: casing, a
    // stray space, the other spelling of a hyphen, and a traversal attempt.
    for (const near of ['Overview', 'overview ', 'team_performance', '', '../overview']) {
      expect(reportGroup(near), JSON.stringify(near)).toBeUndefined();
    }
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

  it('carries the format as the extension, defaulting to csv', () => {
    const from = new Date('2026-07-01T00:00:00.000Z');
    const to = new Date('2026-07-26T12:00:00.000Z');
    expect(exportFilename('leads', from, to, 'pdf')).toBe('nexa-leads-2026-07-01-2026-07-26.pdf');
    // The v1 callers pass three arguments and must keep the name they had.
    expect(exportFilename('leads', from, to)).toBe(exportFilename('leads', from, to, 'csv'));
  });
});

/**
 * Reads the cross-reference table back out of a rendered document. Every
 * assertion about structural validity below goes through this, because an offset
 * that is merely *plausible* still opens a broken file in a reader — the check
 * that matters is that offset N actually lands on the bytes `N 0 obj`.
 */
function readXref(pdf: Buffer): { objectOffsets: number[]; size: number; startxref: number } {
  const text = pdf.toString('latin1');
  const tail = /startxref\n(\d+)\n%%EOF\n$/.exec(text);
  expect(tail).not.toBeNull();
  const startxref = Number(tail?.[1]);

  const table = text.slice(startxref);
  const head = /^xref\n0 (\d+)\n/.exec(table);
  expect(head).not.toBeNull();
  const size = Number(head?.[1]);

  const entries = table.slice(head?.[0].length).slice(0, size * 20);
  const objectOffsets: number[] = [];
  // Entry 0 is the free-list head; objects start at 1.
  for (let index = 1; index < size; index += 1) {
    const entry = entries.slice(index * 20, index * 20 + 20);
    expect(entry).toMatch(/^\d{10} 00000 n\r\n$/);
    objectOffsets.push(Number(entry.slice(0, 10)));
  }
  return { objectOffsets, size, startxref };
}

/** Asserts the file is structurally sound end to end, and hands back its text. */
function expectWellFormed(pdf: Buffer): string {
  const text = pdf.toString('latin1');
  expect(text.startsWith('%PDF-1.7\n')).toBe(true);
  expect(text.endsWith('%%EOF\n')).toBe(true);

  const { objectOffsets, size, startxref } = readXref(pdf);
  expect(text.slice(startxref, startxref + 4)).toBe('xref');
  expect(text).toContain(`/Size ${size}`);
  for (const [index, offset] of objectOffsets.entries()) {
    // The offset is a *byte* offset: it must name its own object exactly.
    expect(text.slice(offset)).toMatch(new RegExp(`^${index + 1} 0 obj\n`));
  }
  // Declared stream lengths must match the bytes actually between the keywords.
  for (const match of text.matchAll(/<< \/Length (\d+) >>\nstream\n/g)) {
    const start = match.index + match[0].length;
    const declared = Number(match[1]);
    expect(text.slice(start + declared, start + declared + 'endstream'.length)).toBe('endstream');
  }
  return text;
}

describe('toPdf (07.7-f)', () => {
  const headers = ['date', 'chats'];
  const rows = [
    ['2026-07-20', 3],
    ['2026-07-21', 5],
  ];

  it('renders a structurally valid, single-page PDF', () => {
    const text = expectWellFormed(toPdf('Overview', headers, rows));
    expect(text).toContain('/Type /Catalog');
    expect(text).toContain('/Count 1');
    // Helvetica by name only — no font file is embedded, so no dependency and no
    // multi-megabyte export.
    expect(text).toContain('/BaseFont /Helvetica /Encoding /WinAnsiEncoding');
    expect(text).not.toContain('/FontFile');
    expect(text).toContain('(Overview) Tj');
    expect(text).toContain('(2026-07-20) Tj');
    expect(text).toContain('(Page 1 of 1) Tj');
  });

  it('is deterministic — the same input renders byte-for-byte identically', () => {
    // The whole reason this serialiser is hand-written: no clock, no random ID,
    // nothing read from the environment.
    expect(toPdf('Overview', headers, rows).equals(toPdf('Overview', headers, rows))).toBe(true);
    const meta = { subtitle: '2026-07-20 — 2026-07-21', createdAt: new Date(0) };
    expect(toPdf('Overview', headers, rows, meta).equals(toPdf('Overview', headers, rows, meta))).toBe(
      true,
    );
  });

  it('takes its creation date from meta, and omits it entirely when absent', () => {
    const withDate = toPdf('Overview', headers, rows, {
      createdAt: new Date('2026-07-26T12:34:56.000Z'),
    }).toString('latin1');
    expect(withDate).toContain("/CreationDate (D:20260726123456Z00'00')");
    expect(withDate).toContain("/ModDate (D:20260726123456Z00'00')");

    // No date supplied means no date invented — the key is simply not there.
    expect(toPdf('Overview', headers, rows).toString('latin1')).not.toContain('/CreationDate');
  });

  it('escapes the PDF string delimiters and the backslash', () => {
    const text = expectWellFormed(
      toPdf('Agents', ['name'], [['Doe (Jane) \\ Co']], { subtitle: 'a (b) \\ c' }),
    );
    // An unescaped ')' would close the literal early and turn the rest of the
    // cell into stray operators — the file would still "look" like a PDF.
    expect(text).toContain('(Doe \\(Jane\\) \\\\ Co) Tj');
    expect(text).toContain('(a \\(b\\) \\\\ c) Tj');
    expect(text).not.toContain('(Doe (Jane)');
  });

  it('keeps text outside WinAnsi from corrupting the file', () => {
    // Latin-1 letters survive as their own byte (octal-escaped in the stream);
    // code points a core font cannot draw degrade to '?' — one byte for one
    // glyph, so no offset in the file shifts.
    const text = expectWellFormed(toPdf('Ünïcode', ['name'], [['Café → 世界']]));
    expect(text).toContain('(Caf\\351 ? ??) Tj');
    expect(text).toContain('(\\334n\\357code) Tj');
    // The escaping leaves every content stream free of high bytes, so no
    // transport that touches eight-bit data can alter a page.
    for (const match of text.matchAll(/stream\n([\s\S]*?)\nendstream/g)) {
      const highByte = [...(match[1] ?? '')].find((character) => character.charCodeAt(0) > 0x7e);
      expect(highByte).toBeUndefined();
    }
  });

  it('renders a valid one-page document for a table with no rows', () => {
    const text = expectWellFormed(toPdf('Leads', headers, []));
    expect(text).toContain('/Count 1');
    // A zero-row export is a real answer, not an empty file.
    expect(text).toContain('(No data.) Tj');
    expect(text).toContain('(date) Tj');
  });

  it('handles a table with no columns at all', () => {
    const text = expectWellFormed(toPdf('Nothing', [], [['ignored']]));
    expect(text).toContain('/Count 1');
    expect(text).toContain('(No data.) Tj');
  });

  it('paginates a long table, repeating the title and the header row', () => {
    const many = Array.from({ length: 200 }, (_, index) => [`2026-07-${index}`, index]);
    const text = expectWellFormed(toPdf('Overview', headers, many));

    const pageCount = Number(/\/Count (\d+)/.exec(text)?.[1]);
    expect(pageCount).toBeGreaterThan(1);
    expect(text).toContain(`(Page ${pageCount} of ${pageCount}) Tj`);
    expect(text.split('(Overview) Tj').length - 1).toBe(pageCount);
    expect(text.split('(chats) Tj').length - 1).toBe(pageCount);
    // Every row made it onto some page.
    expect(text).toContain('(2026-07-0) Tj');
    expect(text).toContain('(2026-07-199) Tj');
  });

  it('does not let one long free-text column starve the narrow ones', () => {
    // Proportional column widths would hand almost the whole page to `note` and
    // leave `date`/`chats` an ellipsis apiece. Max-min fair share gives the two
    // narrow columns the width they actually need first.
    const text = expectWellFormed(
      toPdf(
        'Overview',
        ['date', 'chats', 'note'],
        [['2026-07-20', 3, 'a very long note '.repeat(40)]],
      ),
    );
    expect(text).toContain('(2026-07-20) Tj');
    expect(text).toContain('(chats) Tj');
    // Only the greedy column is truncated (WinAnsi ellipsis, octal 205).
    expect(text).toContain('\\205) Tj');
  });

  it('survives an over-long cell and an over-wide table without throwing', () => {
    const wide = Array.from({ length: 40 }, (_, index) => `column ${index}`);
    expectWellFormed(toPdf('Wide', wide, [wide.map((_, index) => index)]));

    const text = expectWellFormed(toPdf('Long', ['note'], [['x'.repeat(5000)]]));
    // Truncated to the column, marked with the WinAnsi ellipsis (octal 205).
    expect(text).toContain('\\205) Tj');
    expect(text).not.toContain('x'.repeat(400));
  });

  it('renders null, undefined and non-finite numbers as blank cells', () => {
    const text = expectWellFormed(
      toPdf('Edges', ['a', 'b', 'c'], [[null, undefined, Number.NaN]]),
    );
    expect(text).not.toContain('(null) Tj');
    expect(text).not.toContain('(undefined) Tj');
    expect(text).not.toContain('(NaN) Tj');
  });

  it('does NOT apply the CSV formula guard, and leaves CSV behaviour untouched', () => {
    // A PDF has no formula evaluator, so prefixing a quote would only corrupt the
    // reader's data. The guard belongs to the format that can execute a cell.
    const text = expectWellFormed(toPdf('Tags', ['tag'], [['=1+1'], ['-2,5'], ['@SUM(A1)']]));
    expect(text).toContain('(=1+1) Tj');
    expect(text).toContain('(-2,5) Tj');
    expect(text).toContain('(@SUM\\(A1\\)) Tj');
    expect(text).not.toContain("('=1+1) Tj");

    // Regression: the CSV path still guards.
    expect(toCsv(['tag'], [['=1+1']])).toBe("tag\r\n'=1+1\r\n");
  });
});
