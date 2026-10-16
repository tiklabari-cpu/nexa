import { describe, expect, it } from 'vitest';
import { generateShortId } from './ids.js';
import {
  isAcceptableRequestId,
  LOG_KEY_LIST,
  LOG_KEYS,
  logContextValue,
  REQUEST_ID_RE,
} from './log-keys.js';

describe('LOG_KEYS (ID-08)', () => {
  it('spells every identity key in snake_case, as the camelCase name it replaces would read', () => {
    for (const [camel, snake] of Object.entries(LOG_KEYS)) {
      expect(snake).toMatch(/^[a-z]+(_[a-z]+)+$/);
      expect(snake).toBe(camel.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`));
    }
    expect(new Set(LOG_KEY_LIST).size).toBe(LOG_KEY_LIST.length);
  });

  it('uses the code names for the two conversation numbers, never the panel names (ID-01 · K1 = A)', () => {
    expect(LOG_KEYS.chatId).toBe('chat_id');
    expect(LOG_KEYS.threadId).toBe('thread_id');
    expect(LOG_KEY_LIST.join(' ')).not.toMatch(/day|connection|panel/);
  });
});

describe('REQUEST_ID_RE', () => {
  it('accepts the shapes a client or a tracer actually sends', () => {
    for (const id of [
      crypto.randomUUID(),
      generateShortId(),
      '01HZY3K9V7M2Q4R8T6W0XAB5CD',
      'client-supplied-abc123',
      'trace.ID_0042-abc',
      'a'.repeat(64),
    ]) {
      expect(isAcceptableRequestId(id), id).toBe(true);
    }
  });

  it('refuses anything that could forge, collide or bloat a log line', () => {
    for (const id of [
      'short12',
      'a'.repeat(65),
      'has spaces in it',
      'line\nbreak-1234',
      '{"level":60}',
      'ümlaut-id-12345',
      '',
    ]) {
      expect(REQUEST_ID_RE.test(id), id).toBe(false);
    }
    expect(isAcceptableRequestId(undefined)).toBe(false);
    expect(isAcceptableRequestId(['abcdefgh', 'ijklmnop'])).toBe(false);
  });
});

describe('logContextValue', () => {
  it('writes a bigint licence id in full, and drops what is absent', () => {
    expect(logContextValue(9_007_199_254_740_993n)).toBe('9007199254740993');
    expect(logContextValue(42)).toBe('42');
    expect(logContextValue('TJ1H8CFKRV')).toBe('TJ1H8CFKRV');
    expect(logContextValue(null)).toBeUndefined();
    expect(logContextValue(undefined)).toBeUndefined();
  });
});
