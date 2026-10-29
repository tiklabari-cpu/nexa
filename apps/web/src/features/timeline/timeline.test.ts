/**
 * The timeline's pure half (ID-09 · tm 334.2): the address, the page URL, the
 * in-page filter, the connection dividers and the clock.
 */
import { describe, expect, it } from 'vitest';
import type { TimelineItem } from '@siyahtus/types';
import {
  aiFacets,
  formatRowTime,
  matchesQuery,
  parseKinds,
  readAddress,
  rowClipboardLine,
  rowSearchText,
  timelineAddress,
  timelineUrl,
  utcTooltip,
  withDividers,
  writeKinds,
  writeThread,
} from './timeline.js';

function item(id: string, extra: Partial<TimelineItem> = {}): TimelineItem {
  return {
    id,
    at: '2026-10-29T08:00:01.250Z',
    kind: 'message',
    actor: { type: 'customer', id: 'cust-1', name: 'Mira Kaya' },
    chat_id: 'DAYAAAAAAA',
    thread_id: 'CONNONE111',
    details: {},
    ...extra,
  };
}

describe('the address (ID-09)', () => {
  it('reads the day, the connection and the kinds, dropping names it does not know', () => {
    const address = readAddress(
      new URLSearchParams('chat=DAYAAAAAAA&thread=CONNONE111&kinds=note,bogus,message'),
    );
    expect(address).toEqual({
      chatId: 'DAYAAAAAAA',
      threadId: 'CONNONE111',
      // Catalogue order, not the order written.
      kinds: ['message', 'note'],
    });
    expect(readAddress(new URLSearchParams(''))).toEqual({
      chatId: null,
      threadId: null,
      kinds: [],
    });
    expect(parseKinds(null)).toEqual([]);
  });

  it('links to a day, or to one connection of it', () => {
    expect(timelineAddress('DAYAAAAAAA')).toBe('/app/inbox/timeline?chat=DAYAAAAAAA');
    expect(timelineAddress('DAYAAAAAAA', 'CONNONE111')).toBe(
      '/app/inbox/timeline?chat=DAYAAAAAAA&thread=CONNONE111',
    );
  });

  it('keeps the other parameters when the kinds or the connection change', () => {
    const base = new URLSearchParams('chat=DAYAAAAAAA&thread=CONNONE111');
    expect(writeKinds(base, ['note', 'ai_decision']).toString()).toBe(
      'chat=DAYAAAAAAA&thread=CONNONE111&kinds=note%2Cai_decision',
    );
    // Every kind is the same as none: the parameter goes.
    expect(writeKinds(new URLSearchParams('chat=X&kinds=note'), []).toString()).toBe('chat=X');
    expect(writeThread(base, null).toString()).toBe('chat=DAYAAAAAAA');
  });

  it('asks for a 200-row page, with the cursor and the kinds only when they are set', () => {
    expect(timelineUrl({ chatId: 'DAYAAAAAAA', threadId: null, kinds: [] }, undefined)).toBe(
      '/chats/DAYAAAAAAA/timeline?limit=200',
    );
    expect(
      timelineUrl({ chatId: 'DAYAAAAAAA', threadId: 'CONNONE111', kinds: ['note'] }, 'cursor/1'),
    ).toBe(
      '/chats/DAYAAAAAAA/timeline?limit=200&thread_id=CONNONE111&kinds=note&page_id=cursor%2F1',
    );
  });
});

describe('connection dividers', () => {
  const rows = [
    item('a', { thread_id: 'CONNONE111' }),
    item('b', { thread_id: 'CONNONE111' }),
    item('audit-day', { kind: 'audit', thread_id: null }),
    item('c', { thread_id: 'CONNTWO222' }),
  ];

  it('marks where each connection starts; a row about the whole day ends none', () => {
    const entries = withDividers(rows, true);
    expect(
      entries.map((entry) => (entry.type === 'divider' ? `|${entry.threadId}` : entry.item.id)),
    ).toEqual(['|CONNONE111', 'a', 'b', 'audit-day', '|CONNTWO222', 'c']);
  });

  it('draws none inside a single connection', () => {
    expect(withDividers(rows, false).every((entry) => entry.type === 'row')).toBe(true);
  });
});

describe('the in-page filter', () => {
  const decision = item('d1', {
    kind: 'ai_decision',
    actor: { type: 'ai', id: null, name: null },
    text: 'handoff',
    details: { procedure_id: 'proc-77', handoff_reason: 'low_confidence' },
  });
  const searchText = rowSearchText(decision, { kind: 'AI decision', actor: 'AI Agent' });

  it('reaches what the row shows and what sits behind "Details"', () => {
    expect(matchesQuery(searchText, 'low_confidence')).toBe(true);
    expect(matchesQuery(searchText, 'PROC-77')).toBe(true);
    expect(matchesQuery(searchText, 'ai decision')).toBe(true);
  });

  it('wants every word, in any order', () => {
    expect(matchesQuery(searchText, 'handoff proc-77')).toBe(true);
    expect(matchesQuery(searchText, 'handoff refund')).toBe(false);
    expect(matchesQuery(searchText, '   ')).toBe(true);
  });
});

describe('what an AI decision row says', () => {
  it('names the procedure and step, how many sources it read, and why it handed over', () => {
    const facets = aiFacets(
      item('d1', {
        kind: 'ai_decision',
        details: {
          procedure_name: 'Refund request',
          step: 'collect_order',
          knowledge_source_ids: ['s1', 's2'],
          handoff_reason: 'low_confidence',
        },
      }),
    );
    expect(facets).toEqual([
      { key: 'procedure', values: { name: 'Refund request' } },
      { key: 'step', values: { step: 'collect_order' } },
      { key: 'sources', values: { count: 2 } },
      { key: 'handoff', values: { reason: 'low_confidence' } },
    ]);
  });

  it('says nothing about fields the decision does not have', () => {
    expect(aiFacets(item('d2', { kind: 'ai_decision', details: { procedure_id: null } }))).toEqual(
      [],
    );
  });
});

describe('the clock', () => {
  it('shows the workspace zone, and gives the UTC moment to the millisecond on hover', () => {
    expect(formatRowTime('2026-10-29T08:00:01.250Z', 'UTC', 'en')).toContain('8:00:01');
    // Istanbul is UTC+3 all year.
    expect(formatRowTime('2026-10-29T08:00:01.250Z', 'Europe/Istanbul', 'en')).toContain(
      '11:00:01',
    );
    expect(utcTooltip('2026-10-29T08:00:01.250Z')).toBe('UTC 2026-10-29 08:00:01.250');
  });

  it('falls back to UTC for a zone name the engine does not know', () => {
    expect(formatRowTime('2026-10-29T08:00:01.250Z', 'Mars/Olympus', 'en')).toContain('8:00:01');
  });
});

describe('copying a row', () => {
  it('is one tab-separated line with the UTC instant, kind, actor and the text on one line', () => {
    expect(rowClipboardLine(item('m1', { text: 'first line\nsecond line' }), 'Mira Kaya')).toBe(
      '2026-10-29T08:00:01.250Z\tmessage\tMira Kaya\tfirst line second line',
    );
  });
});
