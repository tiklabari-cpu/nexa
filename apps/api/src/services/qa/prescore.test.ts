/**
 * The QA pre-score's prompt, stub and evidence check (tm 319.2 · AI-24 §3),
 * and the consistency job's pairing (AI-24 §6) — the pure parts.
 */
import { describe, expect, it } from 'vitest';
import { PLATFORM_QA_RUBRIC, type QaExcerptMessage } from '@siyahtus/types';
import { MockLlmProvider } from '../ai/provider/mock-llm-provider.js';
import { completeStructured } from '../ai/provider/structured-output.js';
import {
  qaConsistencyPairs,
  qaConsistencyWeek,
  type QaConsistencyCandidate,
} from './consistency.js';
import {
  QA_PRESCORE_RESPONSE_FORMAT,
  buildQaPrescorePrompt,
  mockQaPrescore,
  prescoreGrounding,
  readQaPrescoreGrounding,
  readQaPrescoreReply,
} from './prescore-prompt.js';

const rubric = PLATFORM_QA_RUBRIC.map((c) => ({ ...c }));
const excerpt: QaExcerptMessage[] = [
  {
    event_id: 'T1_1',
    author_type: 'customer',
    is_ai: false,
    text: 'Çekimim nerede?',
    created_at: '2026-10-27T10:00:00.000Z',
  },
  {
    event_id: 'T1_2',
    author_type: 'bot',
    is_ai: true,
    text: 'Kontrol ediyorum.',
    created_at: '2026-10-27T10:00:05.000Z',
  },
];
const trace = { procedures: [], guardrail_hits: [], handoff_reasons: [], risk_flags: [] };
const own = new Set(['T1_1', 'T1_2', 'T1_3']);
const at = new Date('2026-10-28T02:00:00.000Z');

describe('the QA pre-score (tm 319.2 · AI-24 §3)', () => {
  it('the stub reads the context the prompt writes and cites this conversation’s AI message', async () => {
    const grounding = prescoreGrounding({ reasons: ['random'], rubric, excerpt, trace });
    expect(readQaPrescoreGrounding(buildQaPrescorePrompt(grounding).system)).toEqual(grounding);
    const { value } = await completeStructured(new MockLlmProvider(), {
      ...buildQaPrescorePrompt(grounding),
      maxOutputTokens: 1000,
      timeoutMs: 5000,
      responseFormat: QA_PRESCORE_RESPONSE_FORMAT,
    });
    const kept = readQaPrescoreReply(value, rubric, own, at);
    expect('prescore' in kept && kept.prescore).toMatchObject({
      overall: 'pass',
      critical_candidates: [],
      scored_at: at.toISOString(),
    });
    if (!('prescore' in kept)) throw new Error('dropped');
    expect(kept.prescore.criteria.map((c) => [c.key, c.value])).toEqual([
      ['topic', 'pass'],
      ['required_info', 'pass'],
      ['faithfulness', 'pass'],
      ['guardrails', 'pass'],
      ['handoff_timing', 'pass'],
      ['handoff_summary', null],
      ['tone', 5],
    ]);
    expect(kept.prescore.criteria.every((c) => c.evidence_event_ids[0] === 'T1_2')).toBe(true);
  });

  it('the stub fails guardrails on a warning the trail recorded, and names it a critical candidate', () => {
    const reply = mockQaPrescore(
      prescoreGrounding({
        reasons: ['guardrail_scan'],
        rubric,
        excerpt,
        trace: { ...trace, guardrail_hits: [{ rule: 'G7', stage: 'output', action: 'warn' }] },
      }),
    );
    const kept = readQaPrescoreReply(reply, rubric, own, at);
    if (!('prescore' in kept)) throw new Error('dropped');
    expect(kept.prescore).toMatchObject({ overall: 'fail', critical_candidates: ['guardrails'] });
  });

  it('drops the whole pre-score when one cited event is not this conversation’s (AI-24 KK)', () => {
    const reply = mockQaPrescore(
      prescoreGrounding({ reasons: ['random'], rubric, excerpt, trace }),
    );
    reply.criteria[2]!.evidence_event_ids = ['T1_2', 'OTHER_9'];
    expect(readQaPrescoreReply(reply, rubric, own, at)).toEqual({
      refused: { reason: 'foreign_evidence', event_id: 'OTHER_9' },
    });
  });

  it('drops a reply with a criterion the rubric lacks, a value its criterion cannot hold, or no criteria', () => {
    const base = () => mockQaPrescore(prescoreGrounding({ reasons: [], rubric, excerpt, trace }));
    const unknown = base();
    unknown.criteria[0]!.key = 'made_up';
    expect(readQaPrescoreReply(unknown, rubric, own, at)).toEqual({
      refused: { reason: 'unknown_criterion', key: 'made_up' },
    });
    const wrong = base();
    wrong.criteria[3]!.value = null;
    expect(readQaPrescoreReply(wrong, rubric, own, at)).toEqual({
      refused: { reason: 'malformed' },
    });
    expect(readQaPrescoreReply({}, rubric, own, at)).toEqual({ refused: { reason: 'malformed' } });
  });

  it('masks and cuts a rationale that quotes the player', () => {
    const reply = mockQaPrescore(prescoreGrounding({ reasons: [], rubric, excerpt, trace }));
    reply.criteria[0]!.rationale = `Kart 4111 1111 1111 1111 ${'x'.repeat(900)}`;
    const kept = readQaPrescoreReply(reply, rubric, own, at);
    if (!('prescore' in kept)) throw new Error('dropped');
    expect(kept.prescore.criteria[0]!.rationale).not.toContain('4111 1111 1111 1111');
    expect(kept.prescore.criteria[0]!.rationale.length).toBeLessThanOrEqual(500);
  });
});

describe('the consistency job’s pairs (tm 319.2 · AI-24 §6)', () => {
  const candidate = (
    thread: string,
    ending: 'settled' | 'handed_off',
    procedure: string | null,
    slots = 'method',
  ): QaConsistencyCandidate => ({
    thread_id: thread,
    chat_id: `C${thread}`,
    group_id: null,
    brand_id: null,
    config_version_id: null,
    ending,
    procedure_id: procedure,
    slot_keys: slots,
  });

  it('pairs the first settled and the first handed-over connection of a group answered two ways', () => {
    const pairs = qaConsistencyPairs([
      candidate('T3', 'settled', 'p1'),
      candidate('T1', 'settled', 'p1'),
      candidate('T2', 'handed_off', 'p1'),
      candidate('T4', 'settled', 'p2'),
      candidate('T5', 'settled', 'p2'),
      candidate('T6', 'handed_off', 'p1', 'amount,method'),
      candidate('T7', 'handed_off', null),
      candidate('T8', 'settled', null),
    ]);
    expect(pairs.map((p) => [p.group, p.settled.thread_id, p.handedOff.thread_id])).toEqual([
      ['p1|method', 'T1', 'T2'],
    ]);
  });

  it('compares the previous Monday to Sunday of the workspace’s days', () => {
    const boundary = { timezone: 'Europe/Istanbul', hour: 0 };
    // Wednesday 2026-10-28 → the week of Monday 2026-10-19.
    expect(qaConsistencyWeek(new Date('2026-10-28T09:00:00Z'), boundary)).toEqual({
      from: '2026-10-19',
      to: '2026-10-26',
    });
    // Monday 2026-10-26 at 01:00 Istanbul is already Monday there.
    expect(qaConsistencyWeek(new Date('2026-10-25T22:30:00Z'), boundary)).toEqual({
      from: '2026-10-19',
      to: '2026-10-26',
    });
  });
});
