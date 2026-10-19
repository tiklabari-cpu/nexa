import {
  AI_DECISION_DETAILS_MAX_BYTES,
  type AiDecision,
  type ResolutionRecord,
} from '@siyahtus/types';
import { describe, expect, it, vi } from 'vitest';
import type { TenantClient } from '../../lib/tenant.js';
import { AiDailyCapError } from './ai-daily-budget.js';
import {
  boundedDetails,
  MAX_TRACE_STEPS,
  recordAiDecision,
  skillDecision,
  stepRecords,
  toDecisionRow,
  type AiDecisionInput,
} from './decision-log.js';
import type { StepDecision } from './conversation/procedure/executor.js';
import {
  emptyTurnState,
  type TenantRunner,
  type TurnDecisions,
  type TurnResult,
  type TurnSideEffect,
} from './conversation/turn.js';

const LICENSE = 7n;
const TENANT = { licenseId: LICENSE, organizationId: '6f1d3c2a-4b5e-4f60-8a71-92b3c4d5e6f7' };
const SKILL = '0b6c7a8e-1f2d-4c3b-9a4e-5d6f7a8b9c0d';
const SOURCE = '2c3d4e5f-6a7b-4c8d-9e0f-1a2b3c4d5e6f';

/** A turn: the decisions it overrides, plus its reply and side effects. */
function run(
  overrides: Partial<TurnDecisions> & {
    reply?: string | null;
    sideEffects?: TurnSideEffect[];
  } = {},
): TurnResult {
  const { reply = 'Three to five days.', sideEffects = [], ...decided } = overrides;
  return {
    reply,
    decisions: {
      outcome: 'answered',
      skillId: SKILL,
      skillName: 'Delivery',
      replyKind: 'answer',
      failure: null,
      capped: null,
      usage: { llmInputTokens: 120, llmOutputTokens: 30, embeddingTokens: 8 },
      log: [
        { step: 'detect_intent', detail: 'matched "delivery"', ok: true },
        { step: 'send_message', detail: 'answered from "Delivery" (0.91)', ok: true },
      ],
      ...decided,
    },
    nextState: emptyTurnState(),
    sideEffects,
  };
}

describe('toDecisionRow', () => {
  it('keeps every field that fits its column', () => {
    const input: AiDecisionInput = {
      decision: 'answered',
      chatId: 'C1234567890A',
      threadId: 'T1234567890A',
      customerId: TENANT.organizationId,
      triggerEventId: 'T1234567890A_3',
      replyEventId: 'T1234567890A_4',
      requestId: 'req-12345678',
      jobId: 'follow-up:7:C1234567890A',
      procedureId: SKILL,
      procedureVersion: 3,
      step: 'send_message',
      knowledgeSourceIds: [SOURCE],
      chunkIds: [SKILL],
      retrievalScores: [0.91, 0.62],
      guardrailHits: ['pii_mask'],
      handoffReason: 'transfer_to_team',
      riskFlags: ['self_exclusion'],
      model: 'mock-llm',
      llmInputTokens: 120,
      llmOutputTokens: 30,
      latencyMs: 412.6,
      errorType: null,
      details: { outcome: 'answered' },
      configVersionId: SOURCE,
    };
    expect(toDecisionRow(LICENSE, input)).toEqual({
      licenseId: LICENSE,
      decision: 'answered',
      chatId: 'C1234567890A',
      threadId: 'T1234567890A',
      customerId: TENANT.organizationId,
      triggerEventId: 'T1234567890A_3',
      replyEventId: 'T1234567890A_4',
      requestId: 'req-12345678',
      jobId: 'follow-up:7:C1234567890A',
      procedureId: SKILL,
      procedureVersion: 3,
      step: 'send_message',
      knowledgeSourceIds: [SOURCE],
      chunkIds: [SKILL],
      retrievalScores: [0.91, 0.62],
      guardrailHits: ['pii_mask'],
      handoffReason: 'transfer_to_team',
      riskFlags: ['self_exclusion'],
      model: 'mock-llm',
      llmInputTokens: 120,
      llmOutputTokens: 30,
      latencyMs: 413,
      errorType: null,
      details: { outcome: 'answered' },
      configVersionId: SOURCE,
    });
  });

  it('leaves out an id that does not fit its column rather than refusing the turn', () => {
    const row = toDecisionRow(LICENSE, {
      decision: 'silent',
      chatId: 'far-too-long-for-a-chat-id',
      threadId: 'has space',
      customerId: 'not-a-uuid',
      requestId: 'short',
      procedureId: '12345',
      knowledgeSourceIds: [SOURCE, 'nope', ''],
      chunkIds: ['x'],
    });
    expect(row).toMatchObject({
      decision: 'silent',
      chatId: null,
      threadId: null,
      customerId: null,
      requestId: null,
      procedureId: null,
      knowledgeSourceIds: [SOURCE],
      chunkIds: [],
    });
  });

  it('clamps counts to non-negative integers and drops scores that are not numbers', () => {
    const row = toDecisionRow(LICENSE, {
      decision: 'answered',
      llmInputTokens: -4,
      llmOutputTokens: Number.NaN,
      latencyMs: Number.POSITIVE_INFINITY,
      procedureVersion: 0,
      retrievalScores: [0.5, Number.NaN, Number.POSITIVE_INFINITY, -0.1],
    });
    expect(row).toMatchObject({
      llmInputTokens: 0,
      llmOutputTokens: 0,
      latencyMs: null,
      procedureVersion: 1,
      retrievalScores: [0.5, -0.1],
    });
  });

  it('caps lists and labels', () => {
    const row = toDecisionRow(LICENSE, {
      decision: 'blocked',
      guardrailHits: Array.from({ length: 80 }, (_, i) => `rule_${i}`),
      riskFlags: ['  ', 'minor'],
      step: 'x'.repeat(500),
    });
    expect(row.guardrailHits).toHaveLength(50);
    expect(row.riskFlags).toEqual(['minor']);
    expect(row.step).toHaveLength(200);
  });

  it('refuses a decision outside AI_DECISIONS', () => {
    expect(() => toDecisionRow(LICENSE, { decision: 'maybe' as AiDecision })).toThrow(
      /unknown AI decision/,
    );
  });
});

describe('boundedDetails', () => {
  it('never keeps conversation text, at any depth', () => {
    expect(
      boundedDetails({
        text: 'I am 17',
        Message: 'hello',
        outcome: 'answered',
        nested: { prompt: 'system: …', reply: 'hi', kept: 1, list: [{ body: 'x', n: 2 }] },
      }),
    ).toEqual({ outcome: 'answered', nested: { kept: 1, list: [{ n: 2 }] } });
  });

  it('replaces details over the ceiling with a note of their size', () => {
    const large = { blob: 'x'.repeat(AI_DECISION_DETAILS_MAX_BYTES) };
    const bounded = boundedDetails(large);
    expect(bounded).toEqual({ truncated: true, bytes: expect.any(Number) });
    expect(bounded['bytes']).toBeGreaterThan(AI_DECISION_DETAILS_MAX_BYTES);
  });

  it('masks a secret left under a key nobody named (tm 300.2 · AI-26)', () => {
    expect(
      boundedDetails({
        slots: { note: 'şifrem Ali1234!', code: 'SMS kodu 482913' },
        step: 'collect',
      }),
    ).toEqual({
      slots: { note: 'şifrem ********', code: 'SMS kodu ********' },
      step: 'collect',
    });
  });

  it('turns a non-object into {} and a bigint into its digits', () => {
    expect(boundedDetails(undefined)).toEqual({});
    expect(boundedDetails([1, 2] as unknown as Record<string, unknown>)).toEqual({});
    expect(boundedDetails({ license: 9007199254740993n })).toEqual({
      license: '9007199254740993',
    });
  });
});

describe('skillDecision', () => {
  it('is null when no skill ran — a message no intent matched is not an AI turn', () => {
    expect(skillDecision(run({ skillId: null, outcome: 'skipped', reply: null }))).toBeNull();
  });

  it.each<[string, Parameters<typeof run>[0], AiDecision]>([
    ['an answer', {}, 'answered'],
    ['a question', { replyKind: 'question', reply: 'Your order number?' }, 'asked'],
    [
      'a transfer',
      { outcome: 'handed_off', sideEffects: [{ kind: 'handoff', team: 'Support' }] },
      'handoff',
    ],
    ['a miss', { outcome: 'skipped', reply: null, replyKind: null }, 'silent'],
    [
      'the cap',
      { outcome: 'handed_off', reply: null, capped: new AiDailyCapError('llm', 'workspace', 60) },
      'cap_reached',
    ],
  ])('files %s as %s', (_, overrides, decision) => {
    expect(skillDecision(run(overrides))?.decision).toBe(decision);
  });

  it('names the skill, the last step, the cost and why it handed off', () => {
    const decided = skillDecision(
      run({
        outcome: 'handed_off',
        reply: null,
        replyKind: null,
        failure: {
          provider: 'llm',
          kind: 'timeout',
          transient: true,
          status: null,
          code: null,
          requestId: null,
          reason: null,
        },
        log: [
          { step: 'detect_intent', detail: 'matched', ok: true },
          { step: 'send_message', detail: 'the model could not answer (timeout)', ok: false },
        ],
      }),
    );
    expect(decided).toEqual({
      decision: 'handoff',
      procedureId: SKILL,
      step: 'send_message',
      handoffReason: 'llm_failure',
      errorType: 'llm:timeout',
      llmInputTokens: 120,
      llmOutputTokens: 30,
      details: {
        outcome: 'handed_off',
        steps: ['detect_intent', 'send_message'],
        failed_steps: ['send_message'],
        embedding_tokens: 8,
        transient: true,
      },
    });
  });

  it('keeps no run-log wording — it can quote what the customer was asked for', () => {
    const decided = skillDecision(
      run({
        replyKind: 'question',
        reply: 'What is your date of birth?',
        log: [{ step: 'request_info', detail: 'asked for date_of_birth', ok: true }],
      }),
    );
    expect(JSON.stringify(decided)).not.toMatch(/date_of_birth|date of birth/);
  });

  it('files a single-message turn without a step trace — the record it always wrote', () => {
    const details = skillDecision(run())?.details ?? {};
    expect(Object.keys(details).sort()).toEqual([
      'embedding_tokens',
      'failed_steps',
      'outcome',
      'steps',
    ]);
  });
});

describe('skillDecision on a procedure turn (AI-03 KAYIT · ID-08)', () => {
  const HASH = 'a'.repeat(64);
  const TRACE: StepDecision[] = [
    { step_id: 'giris', type: 'say', cond_result: null, detail: 'template giris' },
    { step_id: 'sor', type: 'collect', cond_result: null, detail: 'nothing left to ask' },
    { step_id: 'sure', type: 'check', cond_result: true, detail: 'then: go to bekle' },
    {
      step_id: 'etiket',
      type: 'tag',
      cond_result: 'unknown',
      detail: 'passed — its condition does not hold',
    },
    { step_id: 'bekle', type: 'say', cond_result: null, detail: 'template bekle' },
    { step_id: 'bitti', type: 'resolve', cond_result: null, detail: 'resolved (resolved_waiting)' },
  ];

  /** A procedure turn: the trace, the hash and the connection's turn count after it. */
  function procedureRun(trace: StepDecision[], turns = 3): TurnResult {
    const result = run({
      trace,
      procedureHash: HASH,
      log: [
        ...trace.map((entry) => ({ step: entry.step_id, detail: entry.detail, ok: true })),
        { step: 'bekle', detail: 'composed the reply', ok: true },
        { step: 'procedure', detail: 'asked whether to go back to Bonus', ok: true },
      ],
    });
    return { ...result, nextState: { ...emptyTurnState(), counters: { turns } } };
  }

  it('files every step decision with the turn, and the hash of the definition it ran on', () => {
    const decided = skillDecision(procedureRun(TRACE));
    expect(decided?.details).toEqual({
      outcome: 'answered',
      steps: ['giris', 'sor', 'sure', 'etiket', 'bekle', 'bitti', 'bekle', 'procedure'],
      failed_steps: [],
      embedding_tokens: 8,
      turn: 3,
      trace: TRACE,
      procedure_hash: HASH,
    });
    // The step it stopped on is the last one it decided, not the log's last line.
    expect(decided?.step).toBe('bitti');
  });

  it('files the "resolved" decision — what, by whose criteria and why, by name (K9 · tm 303.4)', () => {
    const resolution: ResolutionRecord = {
      decision: 'asked',
      reason: 'awaiting_confirmation',
      basis: 'platform',
      result: 'unknown',
      unknown: ['fn player_confirmed'],
      confirmation: null,
      outcome: 'resolved_waiting',
      step_id: 'bitti',
    };
    const decided = skillDecision({
      ...procedureRun(TRACE),
      decisions: { ...procedureRun(TRACE).decisions, resolution },
    });
    expect(decided?.details).toMatchObject({ resolution });
    expect(toDecisionRow(1n, { ...decided!, decision: 'answered' }).details).toMatchObject({
      resolution,
    });
    // A turn that decided nothing about it files nothing.
    expect(skillDecision(procedureRun(TRACE))?.details).not.toHaveProperty('resolution');
  });

  it('keeps the steps’ ids and codes, never a tag’s wording', () => {
    const decided = skillDecision(
      procedureRun([
        { step_id: 'etiket', type: 'tag', cond_result: null, detail: 'tagged "Zehra Hanım VIP"' },
        {
          step_id: 'sure',
          type: 'check',
          cond_result: true,
          detail: 'then: tagged "acil – 5000 TL"',
        },
      ]),
    );
    expect(decided?.details?.['trace']).toEqual([
      { step_id: 'etiket', type: 'tag', cond_result: null, detail: 'tagged "…"' },
      { step_id: 'sure', type: 'check', cond_result: true, detail: 'then: tagged "…"' },
    ]);
    expect(JSON.stringify(decided)).not.toMatch(/Zehra|VIP|5000/);
  });

  it('falls back to the log for the step when no step ran — a turn handed over on max_turns', () => {
    const result = run({
      outcome: 'handed_off',
      reply: null,
      replyKind: null,
      handoffReason: 'max_turns',
      trace: [],
      procedureHash: HASH,
      log: [{ step: 'sor', detail: 'handing over — max_turns', ok: true }],
    });
    const decided = skillDecision({
      ...result,
      nextState: { ...emptyTurnState(), counters: { turns: 13 } },
    });
    expect(decided).toMatchObject({
      decision: 'handoff',
      step: 'sor',
      handoffReason: 'max_turns',
      details: { turn: 13, trace: [], procedure_hash: HASH },
    });
  });

  it('caps a long trace at its last steps, and counts what it let go', () => {
    const long: StepDecision[] = Array.from({ length: MAX_TRACE_STEPS + 6 }, (_, n) => ({
      step_id: `s${n}`,
      type: 'check',
      cond_result: false,
      detail: 'does not hold — on to the next step',
    }));
    const details = skillDecision(procedureRun(long))?.details as {
      trace: StepDecision[];
      trace_dropped: number;
    };
    expect(details.trace).toEqual(long.slice(6));
    expect(details.trace_dropped).toBe(6);
  });

  it('lets the earliest steps go until the row fits its ceiling — the outcome is never replaced by a size note', () => {
    const long: StepDecision[] = Array.from({ length: MAX_TRACE_STEPS }, (_, n) => ({
      step_id: `s${n}`.padEnd(40, 'x'),
      type: 'check',
      cond_result: 'unknown',
      detail: `does not hold — on to the next step ${'·'.repeat(400)}`,
    }));
    const decided = skillDecision(procedureRun(long));
    const details = decided?.details as { trace: StepDecision[]; trace_dropped: number };
    expect(details.trace.length).toBeGreaterThan(0);
    expect(details.trace.length).toBeLessThan(MAX_TRACE_STEPS);
    expect(details.trace.at(-1)?.step_id).toBe(long.at(-1)?.step_id);
    expect(details.trace_dropped).toBe(MAX_TRACE_STEPS - details.trace.length);
    expect(details.trace.every((entry) => entry.detail.length <= 120)).toBe(true);
    // The whole row, as the writer stores it, is kept — not replaced by a size note.
    const row = toDecisionRow(LICENSE, decided!);
    expect(row.details).toMatchObject({ outcome: 'answered', turn: 3 });
    expect(Buffer.byteLength(JSON.stringify(row.details))).toBeLessThanOrEqual(
      AI_DECISION_DETAILS_MAX_BYTES,
    );
  });

  it('keeps no conversation text: a reply and a slot value never reach the row', () => {
    const decided = skillDecision({
      ...procedureRun(TRACE),
      reply: 'Papara yatırımları 30 dakika içinde yansır.',
    });
    expect(JSON.stringify(decided)).not.toMatch(/Papara|yansır/);
    expect(stepRecords(TRACE)).toEqual({ trace: TRACE });
  });
});

describe('recordAiDecision', () => {
  it('writes through the tenant runner under the tenant licence', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'row-1' });
    const db: TenantRunner = (fn) => fn({ aiDecisionLog: { create } } as unknown as TenantClient);
    const log = { error: vi.fn() };

    const id = await recordAiDecision(db, TENANT, { decision: 'answered', chatId: 'C1' }, log);

    expect(id).toBe('row-1');
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({ licenseId: LICENSE, decision: 'answered', chatId: 'C1' }),
      select: { id: true },
    });
    expect(log.error).not.toHaveBeenCalled();
  });

  it('never throws: a failed write is one error line and null', async () => {
    const db: TenantRunner = () => Promise.reject(new Error('connection terminated'));
    const log = { error: vi.fn() };

    await expect(recordAiDecision(db, TENANT, { decision: 'handoff' }, log)).resolves.toBeNull();
    expect(log.error).toHaveBeenCalledTimes(1);
    expect(log.error).toHaveBeenCalledWith(
      expect.objectContaining({ decision: 'handoff', err: expect.any(Error) }),
      expect.stringContaining('not held back'),
    );
  });
});
