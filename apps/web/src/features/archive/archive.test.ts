/**
 * The Archive's address and list decisions (AR-01 · tm 335.2): what the address
 * holds, how rows fold into days, and how a refused detail is told apart.
 */
import { describe, expect, it } from 'vitest';
import type { ArchiveConversation } from '@siyahtus/types';
import { ApiClientError } from '../../lib/api-client.js';
import {
  archiveListUrl,
  archiveRefusal,
  archiveTranscriptUrl,
  groupByDay,
  readGrouped,
  readScope,
  writeFlag,
} from './archive.js';

function row(threadId: string, chatId: string): ArchiveConversation {
  return {
    thread_id: threadId,
    chat_id: chatId,
    customer: { id: 'c', name: null, username: null },
    started_at: '2026-10-20T09:00:00.000Z',
    ended_at: null,
    assignee: null,
    group_ids: [],
    tags: [],
    rating: null,
    handled_by: null,
    risk_flags: [],
    first_customer_message: null,
    message_count: 0,
  };
}

function refusal(status: number, details?: Record<string, unknown>): ApiClientError {
  return new ApiClientError({
    type: status === 404 ? 'not_found' : 'internal',
    status,
    message: 'x',
    requestId: 'r',
    ...(details ? { details } : {}),
  });
}

describe('the Archive address', () => {
  it('lists closed connections unless the address widens it', () => {
    expect(readScope(new URLSearchParams(''))).toBe('closed');
    expect(readScope(new URLSearchParams('status=all'))).toBe('all');
    expect(readScope(new URLSearchParams('status=open'))).toBe('closed');
  });

  it('folds days only on ?group=day', () => {
    expect(readGrouped(new URLSearchParams(''))).toBe(false);
    expect(readGrouped(new URLSearchParams('group=day'))).toBe(true);
    expect(readGrouped(new URLSearchParams('group=week'))).toBe(false);
  });

  it('leaves no trace of a default and keeps the other parameters', () => {
    const on = writeFlag(new URLSearchParams('c=T1'), 'scope', true);
    expect(on.toString()).toBe('c=T1&status=all');
    expect(writeFlag(on, 'scope', false).toString()).toBe('c=T1');
    expect(writeFlag(new URLSearchParams(), 'group', true).toString()).toBe('group=day');
  });

  it('builds the list and transcript requests', () => {
    expect(archiveListUrl('closed', undefined)).toBe(
      '/archive/conversations?status=closed&limit=50',
    );
    expect(archiveListUrl('all', 'abc def')).toBe(
      '/archive/conversations?status=all&limit=50&page_id=abc+def',
    );
    expect(archiveTranscriptUrl('CH', 'TH', undefined)).toBe(
      '/chats/CH/events?thread_id=TH&sort=newest&limit=200',
    );
    expect(archiveTranscriptUrl('CH', 'TH', 'CH_7')).toBe(
      '/chats/CH/events?thread_id=TH&sort=newest&limit=200&before_event_id=CH_7',
    );
  });
});

describe('groupByDay', () => {
  it('puts a day where its newest row is and keeps the list order inside it', () => {
    const days = groupByDay([row('T1', 'A'), row('T2', 'B'), row('T3', 'A'), row('T4', 'C')]);
    expect(days.map((day) => day.chatId)).toEqual(['A', 'B', 'C']);
    expect(days[0]!.rows.map((r) => r.thread_id)).toEqual(['T1', 'T3']);
  });

  it('loses no row and invents no day', () => {
    expect(groupByDay([])).toEqual([]);
    const rows = [row('T1', 'A'), row('T2', 'A')];
    expect(groupByDay(rows).flatMap((day) => day.rows)).toEqual(rows);
  });
});

describe('archiveRefusal', () => {
  it('tells a retention deletion from an unseen number', () => {
    expect(archiveRefusal(refusal(404, { reason: 'retention_expired' }))).toBe('retention_expired');
    expect(archiveRefusal(refusal(404))).toBe('not_found');
    expect(archiveRefusal(refusal(404, { reason: 'something_else' }))).toBe('not_found');
  });

  it('treats everything else as a failure worth retrying', () => {
    expect(archiveRefusal(refusal(500))).toBe('other');
    expect(archiveRefusal(new Error('offline'))).toBe('other');
    expect(archiveRefusal(null)).toBe('other');
  });
});
