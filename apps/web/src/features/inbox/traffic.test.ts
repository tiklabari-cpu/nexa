/**
 * The real-time tab bucketing (FR-MOD-03.1.1).
 *
 * The failure modes are all silent miscounts: a queued chat also counted as
 * chatting inflates two tabs at once, and a waiting chat that falls through
 * every bucket hides a customer who needs an answer. So the buckets are pinned
 * here — mutually exclusive across chatting/queued/waiting, summing to the
 * active total.
 */
import { describe, expect, it } from 'vitest';
import { filterByTrafficTab, matchesTrafficTab, trafficTabCounts } from './traffic.js';
import type { ChatEvent, ChatSummary } from './types.js';

function lastEvent(authorType: ChatEvent['author_type']): ChatEvent {
  return {
    id: 'e1',
    chat_id: 'c1',
    thread_id: 't1',
    type: 'message',
    text: 'hi',
    author_id: null,
    author_type: authorType,
    recipients: 'all',
    attachment_url: null,
    properties: {},
    created_at: '2026-07-24T00:00:00.000Z',
  };
}

function chat(overrides: Partial<ChatSummary>): ChatSummary {
  return {
    id: 'c1',
    customer_id: 'cust1',
    customer_name: 'Visitor',
    active: true,
    created_at: '2026-07-24T00:00:00.000Z',
    thread_id: 't1',
    assignee_id: 'agent1',
    queue_position: null,
    unread_count: 0,
    last_event: lastEvent('agent'),
    tags: [],
    ...overrides,
  };
}

const queued = chat({ queue_position: 3, assignee_id: null });
const waiting = chat({ last_event: lastEvent('customer') });
const chatting = chat({ last_event: lastEvent('agent') });
const archived = chat({ active: false, last_event: lastEvent('customer') });

describe('matchesTrafficTab', () => {
  it('puts every chat in All', () => {
    for (const c of [queued, waiting, chatting, archived]) {
      expect(matchesTrafficTab(c, 'all')).toBe(true);
    }
  });

  it('counts a queued chat only as queued', () => {
    expect(matchesTrafficTab(queued, 'queued')).toBe(true);
    expect(matchesTrafficTab(queued, 'waiting')).toBe(false);
    expect(matchesTrafficTab(queued, 'chatting')).toBe(false);
  });

  it('counts an unanswered customer message as waiting, not chatting', () => {
    expect(matchesTrafficTab(waiting, 'waiting')).toBe(true);
    expect(matchesTrafficTab(waiting, 'chatting')).toBe(false);
    expect(matchesTrafficTab(waiting, 'queued')).toBe(false);
  });

  it('counts an agent-answered chat as chatting, not waiting', () => {
    expect(matchesTrafficTab(chatting, 'chatting')).toBe(true);
    expect(matchesTrafficTab(chatting, 'waiting')).toBe(false);
  });

  it('leaves an archived chat out of the live tabs', () => {
    // Closed conversations belong in the Archive view, never in a live tab —
    // otherwise the counts stop reflecting what needs attention.
    expect(matchesTrafficTab(archived, 'waiting')).toBe(false);
    expect(matchesTrafficTab(archived, 'chatting')).toBe(false);
    expect(matchesTrafficTab(archived, 'queued')).toBe(false);
  });

  it('keeps chatting/queued/waiting mutually exclusive', () => {
    for (const c of [queued, waiting, chatting]) {
      const hits = (['chatting', 'queued', 'waiting'] as const).filter((t) =>
        matchesTrafficTab(c, t),
      );
      expect(hits).toHaveLength(1);
    }
  });
});

describe('trafficTabCounts', () => {
  it('reports one number per tab, All equal to the list length', () => {
    const counts = trafficTabCounts([queued, waiting, chatting, archived]);
    expect(counts).toEqual({ all: 4, chatting: 1, queued: 1, waiting: 1 });
  });

  it('is empty for an empty list', () => {
    expect(trafficTabCounts([])).toEqual({ all: 0, chatting: 0, queued: 0, waiting: 0 });
  });
});

describe('filterByTrafficTab', () => {
  it('returns the list untouched for All', () => {
    const list = [queued, waiting, chatting];
    expect(filterByTrafficTab(list, 'all')).toBe(list);
  });

  it('narrows to the matching chats', () => {
    expect(filterByTrafficTab([queued, waiting, chatting], 'waiting')).toEqual([waiting]);
  });
});
