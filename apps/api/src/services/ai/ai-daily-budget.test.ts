/**
 * The daily AI caps' clock and refusal (tm 257.8) — what needs no database:
 * the UTC day a call is counted on, the `Retry-After` to the next UTC
 * midnight, the refusal's shape, and which settings feed which cap. The
 * counting itself is Postgres's and is driven through the real server in
 * `test/integration/ai-daily-caps.test.ts`.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ApiError } from '../../lib/api-error.js';
import {
  AiDailyCapError,
  aiDailyCaps,
  secondsUntilUtcMidnight,
  utcDayKey,
} from './ai-daily-budget.js';
import { LlmProviderError } from './provider/llm-error.js';

// A zone far from UTC for the whole file, so a day or a midnight read from
// local time cannot pass by accident on a machine that happens to run in UTC.
const zone = process.env['TZ'];
beforeEach(() => {
  process.env['TZ'] = 'Pacific/Kiritimati'; // UTC+14
});
afterEach(() => {
  if (zone === undefined) delete process.env['TZ'];
  else process.env['TZ'] = zone;
});

describe('utcDayKey', () => {
  it('names the UTC day, not the server’s', () => {
    // 2026-10-02 10:30 UTC is already 2026-10-03 in UTC+14.
    const at = new Date(Date.UTC(2026, 9, 2, 10, 30));
    expect(at.getDate()).toBe(3);
    expect(utcDayKey(at)).toBe('20261002');
  });

  it('turns over at 00:00 UTC exactly', () => {
    expect(utcDayKey(new Date(Date.UTC(2026, 9, 2, 23, 59, 59, 999)))).toBe('20261002');
    expect(utcDayKey(new Date(Date.UTC(2026, 9, 3, 0, 0, 0, 0)))).toBe('20261003');
  });

  it('pads month and day, and crosses the year', () => {
    expect(utcDayKey(new Date(Date.UTC(2026, 0, 5, 12)))).toBe('20260105');
    expect(utcDayKey(new Date(Date.UTC(2026, 11, 31, 23, 59, 59)))).toBe('20261231');
    expect(utcDayKey(new Date(Date.UTC(2027, 0, 1, 0, 0, 0)))).toBe('20270101');
  });
});

describe('secondsUntilUtcMidnight', () => {
  it('counts down to the next 00:00 UTC, rounding up', () => {
    expect(secondsUntilUtcMidnight(new Date(Date.UTC(2026, 9, 2, 0, 0, 0)))).toBe(86_400);
    expect(secondsUntilUtcMidnight(new Date(Date.UTC(2026, 9, 2, 23, 0, 0)))).toBe(3_600);
    expect(secondsUntilUtcMidnight(new Date(Date.UTC(2026, 9, 2, 23, 59, 59, 1)))).toBe(1);
    expect(secondsUntilUtcMidnight(new Date(Date.UTC(2026, 9, 2, 12, 0, 0, 500)))).toBe(43_200);
  });
});

describe('AiDailyCapError', () => {
  it('is a 429 limit_reached naming the cap, with Retry-After — never a provider failure', () => {
    const error = new AiDailyCapError('llm', 'global', 1234);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).not.toBeInstanceOf(LlmProviderError);
    expect(error.type).toBe('limit_reached');
    expect(error.status).toBe(429);
    expect(error.details).toEqual({ reason: 'ai_daily_cap', meter: 'llm', scope: 'global' });
    expect(error.headers).toEqual({ 'Retry-After': '1234' });
    expect(error.toBody('req-1').error).toMatchObject({
      type: 'limit_reached',
      details: { reason: 'ai_daily_cap', scope: 'global' },
    });
    expect(new AiDailyCapError('llm', 'workspace', 5).message).toMatch(/this workspace/);
  });
});

describe('aiDailyCaps', () => {
  it('reads each of the four settings into its own meter and scope', () => {
    expect(
      aiDailyCaps({
        AI_DAILY_LLM_TOKENS_PER_WORKSPACE: 1,
        AI_DAILY_LLM_TOKENS_GLOBAL: 2,
        AI_DAILY_EMBEDDING_TOKENS_PER_WORKSPACE: 3,
        AI_DAILY_EMBEDDING_TOKENS_GLOBAL: 4,
      }),
    ).toEqual({ llm: { workspace: 1, global: 2 }, embedding: { workspace: 3, global: 4 } });
  });
});
