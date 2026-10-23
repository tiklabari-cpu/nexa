import { describe, expect, it } from 'vitest';
import { ARCHIVE_FIRST_MESSAGE_MAX } from '@siyahtus/types';
import { ApiError } from '../../lib/api-error.js';
import { decodeArchiveCursor, encodeArchiveCursor, preview } from './archive-service.js';

describe('archive cursor', () => {
  it('round-trips a closed row to the microsecond, and an open one', () => {
    // 2026-10-23T12:00:00.123456Z — a JS Date would keep only .123.
    const closed = { closedKey: 1_792_756_800_123_456n, id: 'TJ1H8CFKRV' };
    expect(decodeArchiveCursor(encodeArchiveCursor(closed))).toEqual(closed);
    const open = { closedKey: null, id: 'AB12CD34EF56' };
    expect(decodeArchiveCursor(encodeArchiveCursor(open))).toEqual(open);
  });

  it('refuses anything it did not write as a 400', () => {
    for (const pageId of [
      'garbage',
      Buffer.from('12.short').toString('base64url'),
      Buffer.from('-5.TJ1H8CFKRV').toString('base64url'),
      Buffer.from("open.TJ1H8CFKRV' OR 1=1").toString('base64url'),
      // A chat-list cursor is another list's.
      Buffer.from(JSON.stringify({ a: '2026-10-23T00:00:00Z', i: 'TJ1H8CFKRV' })).toString(
        'base64url',
      ),
    ]) {
      expect(() => decodeArchiveCursor(pageId), pageId).toThrow(ApiError);
    }
  });
});

describe('first message preview', () => {
  it('is one line, masked, and cut at the limit with an ellipsis', () => {
    expect(preview(null)).toBeNull();
    expect(preview('  \n ')).toBeNull();
    expect(preview('Merhaba,\n\nçekimim   nerede?')).toBe('Merhaba, çekimim nerede?');
    expect(preview('Kartım 4111 1111 1111 1111')).toBe('Kartım **** **** **** 1111');

    const long = preview('ğ'.repeat(ARCHIVE_FIRST_MESSAGE_MAX + 50))!;
    expect(Array.from(long)).toHaveLength(ARCHIVE_FIRST_MESSAGE_MAX);
    expect(long.endsWith('…')).toBe(true);
    // Never splits a character made of two UTF-16 units.
    const emoji = preview('🎰'.repeat(ARCHIVE_FIRST_MESSAGE_MAX + 1))!;
    expect(
      Array.from(emoji)
        .slice(0, -1)
        .every((c) => c === '🎰'),
    ).toBe(true);
  });
});
