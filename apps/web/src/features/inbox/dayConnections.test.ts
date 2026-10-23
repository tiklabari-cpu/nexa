/**
 * The walk through a day's connections (ID-02 · tm 286.4): which connections
 * come before the live transcript, what is read after each page, and where a
 * separator goes.
 */
import { describe, expect, it } from 'vitest';
import {
  connectionBreaks,
  earlierConnections,
  focusStep,
  firstConnectionCursor,
  joinDayEvents,
  nextConnectionCursor,
} from './dayConnections.js';
import type { ChatConnection, ChatEvent } from './types.js';

function connection(id: string, minute: number): ChatConnection {
  return {
    id,
    active: false,
    created_at: `2026-10-15T10:${String(minute).padStart(2, '0')}:00.000Z`,
    closed_at: null,
    assignee_id: null,
    opened_via: 'same_day_return',
    group_id: null,
  };
}

function event(id: string, threadId: string): ChatEvent {
  return {
    id,
    chat_id: 'TJ1H8CFKRV',
    thread_id: threadId,
    type: 'message',
    text: id,
    author_id: null,
    author_type: 'customer',
    recipients: 'all',
    attachment_url: null,
    properties: {},
    created_at: '2026-10-15T10:00:00.000Z',
  };
}

const DAY = [connection('C1', 0), connection('C2', 10), connection('C3', 20)];

describe('earlierConnections', () => {
  it('lists the connections before the one the live transcript starts in', () => {
    expect(earlierConnections(DAY, 'C3').map((c) => c.id)).toEqual(['C1', 'C2']);
    expect(earlierConnections(DAY, 'C2').map((c) => c.id)).toEqual(['C1']);
  });

  it('has nothing before the first connection, an unknown one, or no anchor yet', () => {
    expect(earlierConnections(DAY, 'C1')).toEqual([]);
    expect(earlierConnections(DAY, 'C9')).toEqual([]);
    expect(earlierConnections(DAY, null)).toEqual([]);
    expect(earlierConnections(undefined, 'C3')).toEqual([]);
  });
});

describe('the cursor walk', () => {
  const earlier = DAY.slice(0, 2);

  it('starts at the newest earlier connection', () => {
    expect(firstConnectionCursor(earlier)).toEqual({ threadId: 'C2' });
    expect(firstConnectionCursor([])).toBeUndefined();
  });

  it('pages up inside a connection, then moves to the one before it, then stops', () => {
    expect(nextConnectionCursor(earlier, { threadId: 'C2' }, 'C2_5')).toEqual({
      threadId: 'C2',
      before: 'C2_5',
    });
    expect(nextConnectionCursor(earlier, { threadId: 'C2', before: 'C2_5' }, undefined)).toEqual({
      threadId: 'C1',
    });
    expect(nextConnectionCursor(earlier, { threadId: 'C1' }, undefined)).toBeUndefined();
  });
});

describe('joinDayEvents', () => {
  it('puts the earlier connections first and keeps the live copy of an event both hold', () => {
    const live = [event('C2_1', 'C2'), event('C3_1', 'C3')];
    const earlier = [event('C1_1', 'C1'), { ...event('C2_1', 'C2'), text: 'stale' }];
    const joined = joinDayEvents(earlier, live);
    expect(joined.map((e) => e.id)).toEqual(['C1_1', 'C2_1', 'C3_1']);
    expect(joined[1]!.text).toBe('C2_1');
  });
});

describe('connectionBreaks', () => {
  const day = [event('C1_1', 'C1'), event('C1_2', 'C1'), event('C2_1', 'C2'), event('C3_1', 'C3')];

  it('introduces every connection once the start of the day is on screen', () => {
    expect([
      ...connectionBreaks(day, { atStartOfDay: true, connectionCount: 3 }).entries(),
    ]).toEqual([
      [0, 'C1'],
      [2, 'C2'],
      [3, 'C3'],
    ]);
  });

  it('draws no separator at the top while history is still above it', () => {
    expect([...connectionBreaks(day, { atStartOfDay: false, connectionCount: 3 }).keys()]).toEqual([
      2, 3,
    ]);
  });

  it('draws none for a single connection', () => {
    const single = [event('C1_1', 'C1'), event('C1_2', 'C1')];
    expect(connectionBreaks(single, { atStartOfDay: true, connectionCount: 1 }).size).toBe(0);
  });

  it('keeps an optimistic bubble (no thread yet) in the connection before it', () => {
    const sending = [event('C2_1', 'C2'), event('optimistic-1', '')];
    expect(connectionBreaks(sending, { atStartOfDay: false, connectionCount: 2 }).size).toBe(0);
  });
});

describe('focusStep (ID-06 · tm 332)', () => {
  const ev = (id: string, thread: string): ChatEvent =>
    ({ id, thread_id: thread }) as unknown as ChatEvent;
  const events = [ev('A_1', 'A'), ev('A_2', 'A'), ev('B_1', 'B'), ev('B_2', 'B')];

  it('scrolls to a loaded message and highlights it', () => {
    expect(focusStep(events, { eventId: 'B_1' }, true)).toEqual({
      eventId: 'B_1',
      highlight: true,
    });
  });

  it('asks for older history while the message is not loaded, and gives up at the start', () => {
    expect(focusStep(events, { eventId: 'Z_1' }, true)).toBe('older');
    expect(focusStep(events, { eventId: 'Z_1' }, false)).toBeNull();
  });

  it("finds a connection's first event once the event before it is another connection's", () => {
    expect(focusStep(events, { threadId: 'B' }, true)).toEqual({
      eventId: 'B_1',
      highlight: false,
    });
  });

  it('keeps reading when the connection reaches the top of what is loaded', () => {
    expect(focusStep(events, { threadId: 'A' }, true)).toBe('older');
    expect(focusStep(events, { threadId: 'A' }, false)).toEqual({
      eventId: 'A_1',
      highlight: false,
    });
  });

  it('does nothing without a target', () => {
    expect(focusStep(events, {}, true)).toBeNull();
  });
});
