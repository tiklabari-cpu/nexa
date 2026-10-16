import { AI_DECISION_DETAILS_MAX_BYTES, type AiDecision } from '@siyahtus/types';
import { describe, expect, it, vi } from 'vitest';
import type { TenantClient } from '../../lib/tenant.js';
import { AiDailyCapError } from './ai-daily-budget.js';
import {
  boundedDetails,
  recordAiDecision,
  skillDecision,
  toDecisionRow,
  type AiDecisionInput,
} from './decision-log.js';
import type { SkillRunResult, TenantRunner } from './skill-engine.js';

const LICENSE = 7n;
const TENANT = { licenseId: LICENSE, organizationId: '6f1d3c2a-4b5e-4f60-8a71-92b3c4d5e6f7' };
const SKILL = '0b6c7a8e-1f2d-4c3b-9a4e-5d6f7a8b9c0d';
const SOURCE = '2c3d4e5f-6a7b-4c8d-9e0f-1a2b3c4d5e6f';

function run(overrides: Partial<SkillRunResult> = {}): SkillRunResult {
  return {
    outcome: 'answered',
    skillId: SKILL,
    skillName: 'Delivery',
    reply: 'Three to five days.',
    replyFrom: 'send_message',
    tags: [],
    transferTo: null,
    summary: null,
    failure: null,
    capped: null,
    usage: { llmInputTokens: 120, llmOutputTokens: 30, embeddingTokens: 8 },
    log: [
      { step: 'detect_intent', detail: 'matched "delivery"', ok: true },
      { step: 'send_message', detail: 'answered from "Delivery" (0.91)', ok: true },
    ],
    ...overrides,
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

  it.each<[string, Partial<SkillRunResult>, AiDecision]>([
    ['an answer', {}, 'answered'],
    ['a question', { replyFrom: 'request_info', reply: 'Your order number?' }, 'asked'],
    ['a transfer', { outcome: 'handed_off', transferTo: 'Support' }, 'handoff'],
    ['a miss', { outcome: 'skipped', reply: null, replyFrom: null }, 'silent'],
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
        replyFrom: null,
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
        replyFrom: 'request_info',
        reply: 'What is your date of birth?',
        log: [{ step: 'request_info', detail: 'asked for date_of_birth', ok: true }],
      }),
    );
    expect(JSON.stringify(decided)).not.toMatch(/date_of_birth|date of birth/);
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
