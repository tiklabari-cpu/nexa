import { describe, expect, it } from 'vitest';
import { AI_BOT_ID, QA_EXCERPT_MESSAGES_MAX, QA_EXCERPT_TEXT_MAX } from '@siyahtus/types';
import {
  localHour,
  qaDueAt,
  qaExcerptOf,
  qaReasonsFor,
  qaSampleDraw,
  qaSampledAtRandom,
  qaSamplingDays,
  type QaExcerptRow,
  type QaMandatoryFlags,
} from './sampler.js';

const IST = { timezone: 'Europe/Istanbul', hour: 0 };
const ids = Array.from({ length: 1000 }, (_, i) => `T${String(i).padStart(9, '0')}`);
const none: QaMandatoryFlags = {
  risk_flag: false,
  low_bsat: false,
  repeat_72h: false,
  guardrail_scan: false,
  mandatory_handoff: false,
  handoff_insufficient: false,
};

describe('the QA draw (tm 319.1 · AI-24 §2)', () => {
  it('is deterministic per licence, day and connection, and independent across days and workspaces', () => {
    expect(qaSampleDraw(7n, '2026-10-19', 'ABC')).toBe(qaSampleDraw('7', '2026-10-19', 'ABC'));
    const draw = qaSampleDraw(7n, '2026-10-19', 'ABC');
    expect(draw).toBeGreaterThanOrEqual(0);
    expect(draw).toBeLessThan(1);
    expect(qaSampleDraw(7n, '2026-10-20', 'ABC')).not.toBe(draw);
    expect(qaSampleDraw(8n, '2026-10-19', 'ABC')).not.toBe(draw);
  });

  it('picks about 50 of 1,000 connections at 5 %, the same 50 every time (AI-24 KK 1)', () => {
    const pick = () => ids.filter((id) => qaSampledAtRandom(1n, '2026-10-19', id, 5));
    const first = pick();
    expect(first.length).toBeGreaterThanOrEqual(35);
    expect(first.length).toBeLessThanOrEqual(65);
    expect(pick()).toEqual(first);
    // Another day draws another list; a higher rate keeps the lower one's.
    const nextDay = ids.filter((id) => qaSampledAtRandom(1n, '2026-10-20', id, 5));
    expect(nextDay).not.toEqual(first);
    const at20 = ids.filter((id) => qaSampledAtRandom(1n, '2026-10-19', id, 20));
    expect(at20.length).toBeGreaterThan(150);
    expect(first.every((id) => at20.includes(id))).toBe(true);
  });
});

describe('qaReasonsFor', () => {
  it('lists the draw and every mandatory flag, in QA_REASONS order; nothing when neither', () => {
    expect(qaReasonsFor(false, none)).toEqual([]);
    expect(qaReasonsFor(true, none)).toEqual(['random']);
    expect(
      qaReasonsFor(true, { ...none, handoff_insufficient: true, risk_flag: true, low_bsat: true }),
    ).toEqual(['random', 'risk_flag', 'low_bsat', 'handoff_insufficient']);
  });
});

describe('when a day is sampled', () => {
  it('is the previous conversation day from 02:00 on the workspace clock, with two days of catch-up', () => {
    // 01:30 on the 20th in Istanbul.
    expect(qaSamplingDays(new Date('2026-10-19T22:30:00Z'), IST)).toEqual([
      '2026-10-16',
      '2026-10-17',
      '2026-10-18',
    ]);
    // 02:00 on the 20th.
    expect(qaSamplingDays(new Date('2026-10-19T23:00:00Z'), IST)).toEqual([
      '2026-10-17',
      '2026-10-18',
      '2026-10-19',
    ]);
  });

  it('waits for a later day boundary to pass', () => {
    const six = { timezone: 'Europe/Istanbul', hour: 6 };
    // 05:59 on the 20th: the 19th runs until 06:00.
    expect(qaSamplingDays(new Date('2026-10-20T02:59:00Z'), six).at(-1)).toBe('2026-10-18');
    expect(qaSamplingDays(new Date('2026-10-20T03:00:00Z'), six).at(-1)).toBe('2026-10-19');
  });

  it('reads the wall-clock hour in the zone', () => {
    expect(localHour(new Date('2026-10-19T23:30:00Z'), 'Europe/Istanbul')).toBe(2);
    expect(localHour(new Date('2026-10-19T23:30:00Z'), 'America/New_York')).toBe(19);
  });
});

describe('qaDueAt', () => {
  it('gives a risk-flagged review two business days, skipping the weekend on the workspace clock', () => {
    // Tuesday 02:30 → Thursday 02:30.
    expect(qaDueAt(new Date('2026-10-19T23:30:00Z'), 'risk', 'Europe/Istanbul').toISOString()).toBe(
      '2026-10-21T23:30:00.000Z',
    );
    // Friday 10:00 → Tuesday 10:00; Saturday 10:00 → Tuesday 10:00.
    expect(qaDueAt(new Date('2026-10-23T07:00:00Z'), 'risk', 'Europe/Istanbul').toISOString()).toBe(
      '2026-10-27T07:00:00.000Z',
    );
    expect(qaDueAt(new Date('2026-10-24T07:00:00Z'), 'risk', 'Europe/Istanbul').toISOString()).toBe(
      '2026-10-27T07:00:00.000Z',
    );
  });

  it('gives every other review seven days', () => {
    const from = new Date('2026-10-23T07:00:00Z');
    for (const priority of ['guardrail', 'normal'] as const) {
      expect(qaDueAt(from, priority, 'Europe/Istanbul').toISOString()).toBe(
        '2026-10-30T07:00:00.000Z',
      );
    }
  });
});

describe('qaExcerptOf', () => {
  const at = new Date('2026-10-19T09:00:00Z');
  const row = (id: string, author_type: string, text: string, author_id: string | null = 'x') =>
    ({ id, author_type, author_id, text, created_at: at }) satisfies QaExcerptRow;

  it('keeps the AI’s part and the hand-over up to the third agent message, masked', () => {
    const excerpt = qaExcerptOf([
      row('e1', 'customer', 'Kartım 4111 1111 1111 1111'),
      row('e2', 'bot', 'Aktarıyorum.', AI_BOT_ID),
      row('e3', 'system', 'transferred'),
      row('e4', 'agent', 'Merhaba'),
      row('e5', 'bot', 'Menü', 'rule-bot'),
      row('e6', 'agent', 'Bakıyorum'),
      row('e7', 'customer', 'Tamam'),
      row('e8', 'agent', 'Çözüldü'),
      row('e9', 'agent', 'İyi günler'),
    ]);
    expect(excerpt.map((m) => m.event_id)).toEqual(['e1', 'e2', 'e4', 'e5', 'e6', 'e7', 'e8']);
    expect(excerpt[0]!.text).not.toContain('4111 1111 1111 1111');
    expect(excerpt.filter((m) => m.is_ai).map((m) => m.event_id)).toEqual(['e2']);
    expect(excerpt[1]).toMatchObject({ author_type: 'bot', created_at: at.toISOString() });
  });

  it('holds at most QA_EXCERPT_MESSAGES_MAX messages of QA_EXCERPT_TEXT_MAX characters', () => {
    const long = Array.from({ length: QA_EXCERPT_MESSAGES_MAX + 5 }, (_, i) =>
      row(`e${i}`, 'customer', 'a'.repeat(QA_EXCERPT_TEXT_MAX + 10)),
    );
    const excerpt = qaExcerptOf(long);
    expect(excerpt).toHaveLength(QA_EXCERPT_MESSAGES_MAX);
    expect(excerpt[0]!.text).toHaveLength(QA_EXCERPT_TEXT_MAX);
  });
});
