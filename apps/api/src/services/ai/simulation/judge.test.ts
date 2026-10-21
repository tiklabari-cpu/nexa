/**
 * The scenario judge (tm 314.3 · SiyahTuş analysis AI-19 §4, AI-19-S3): what
 * it is told, what the stub answers, what is kept of a reply, and that it is
 * advice — asked only of a conversation that was played, on the test meter,
 * inside the simulation context, and never able to fail the scenario's
 * result or the run for its own sake.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  AI_TEST_JUDGE_COMMENT_MAX,
  AI_TEST_JUDGE_CRITERIA,
  type AiTestCheck,
  type AiTestExpectations,
  type AiTestTranscriptEntry,
  type AiTestTurnTrace,
} from '@siyahtus/types';
import { simulationScope } from '../../../lib/simulation-context.js';
import type { TenantContext } from '../../../lib/tenant.js';
import { AiDailyCapError } from '../ai-daily-budget.js';
import type { LlmCompletionRequest, LlmProvider } from '../provider/llm-provider.js';
import { MockLlmProvider } from '../provider/mock-llm-provider.js';
import { judgeable, ScenarioJudge } from './judge.js';
import {
  buildScenarioJudgePrompt,
  judgeGrounding,
  mockScenarioJudge,
  readScenarioJudgeGrounding,
  readScenarioJudgeReply,
  SCENARIO_JUDGE_MAX_OUTPUT_TOKENS,
  SCENARIO_JUDGE_MESSAGE_MAX,
  SCENARIO_JUDGE_RESPONSE_NAME,
  type ScenarioJudgeGrounding,
} from './judge-prompt.js';
import type { ScenarioPlay, SimulatedScenario } from './runner.js';

const TENANT: TenantContext = { licenseId: 7n, organizationId: 'org-judge' };
const AT = '2026-10-19T12:15:00.000Z';

function trace(overrides: Partial<AiTestTurnTrace> = {}): AiTestTurnTrace {
  return {
    decision: 'asked',
    procedure: { skill_id: 'skill-1', name: 'Yatırım geçmedi', reason: 'intent_match' },
    slots: {},
    sources: [{ source_id: 'src-1', title: 'Yatırım rehberi', page: null }],
    guardrails: [],
    handoff: null,
    flags: [],
    tokens: 15,
    ...overrides,
  };
}

const TRANSCRIPT: AiTestTranscriptEntry[] = [
  { role: 'player', text: 'param yatmadı', at: AT },
  { role: 'ai', text: 'Hangi yöntemle yatırdınız?', at: AT, trace: trace() },
  { role: 'player', text: 'Papara 13:40', at: AT },
  {
    role: 'ai',
    text: 'Finans ekibine aktarıyorum.',
    at: AT,
    trace: trace({
      decision: 'handoff',
      handoff: { reason: 'deposit_overdue', topic: 'finance', team_id: 4 },
    }),
  },
  { role: 'system', text: 'a note', at: AT },
];

function scenario(overrides: Partial<SimulatedScenario> = {}): SimulatedScenario {
  return {
    key: '2c3d4e5f-6a7b-4c8d-9e0f-1a2b3c4d5e6f',
    name: 'Papara yatırım geçmedi',
    mode: 'scripted',
    persona: 'sabirsiz',
    language: 'tr',
    turns: ['param yatmadı', 'Papara 13:40'],
    goal: null,
    facts: {},
    expectations: { outcome: 'handoff', max_turns: 6 } satisfies AiTestExpectations,
    simulatedNow: null,
    toolOutputs: {},
    brandId: null,
    ...overrides,
  };
}

const held = (kind: AiTestCheck['kind']): AiTestCheck => ({ kind, passed: true });
const broke = (kind: AiTestCheck['kind']): AiTestCheck => ({ kind, passed: false });

function play(overrides: Partial<ScenarioPlay> = {}): ScenarioPlay {
  return {
    status: 'passed',
    stopReason: 'handoff',
    outcome: 'handoff',
    handoffTeamId: 4,
    transcript: TRANSCRIPT,
    checks: [held('outcome'), held('forbidden_phrase'), held('language')],
    tokens: 30,
    durationMs: 12,
    capped: false,
    ...overrides,
  };
}

/** A provider that answers like the mock and records what it was asked. */
function recording(answer?: (request: LlmCompletionRequest) => Promise<string> | string) {
  const mock = new MockLlmProvider();
  const calls: LlmCompletionRequest[] = [];
  const scopes: unknown[] = [];
  const llm: LlmProvider = {
    id: 'openai',
    complete: async (request) => {
      calls.push(request);
      scopes.push(simulationScope());
      if (answer)
        return { text: await answer(request), usage: { inputTokens: 120, outputTokens: 30 } };
      const reply = await mock.complete(request);
      return { ...reply, usage: { inputTokens: 120, outputTokens: 30 } };
    },
  };
  return { llm, calls, scopes };
}

function judge(llm: LlmProvider, logger = { warn: vi.fn() }) {
  return {
    logger,
    judge: new ScenarioJudge({
      llm,
      maxOutputTokens: 800,
      timeoutMs: 2_000,
      maxPromptChars: 16_000,
      logger,
    }),
  };
}

const input = (s: SimulatedScenario = scenario()) => ({
  tenant: TENANT,
  configVersionId: null,
  scenario: s,
});

describe('what the judge reads (AI-19 §4)', () => {
  it('the conversation, each AI message with its procedure, sources and hand-over; no system notes', () => {
    const grounding = judgeGrounding(
      scenario(),
      play({ checks: [broke('team'), held('outcome')] }),
    );
    expect(grounding).toEqual({
      language: 'tr',
      persona: 'sabirsiz',
      goal: null,
      expected: 'handoff',
      outcome: 'handoff',
      handedOver: true,
      failedChecks: ['team'],
      transcript: [
        { role: 'player', text: 'param yatmadı' },
        {
          role: 'ai',
          text: 'Hangi yöntemle yatırdınız?',
          procedure: 'Yatırım geçmedi',
          sources: ['Yatırım rehberi'],
          handoff: null,
        },
        { role: 'player', text: 'Papara 13:40' },
        {
          role: 'ai',
          text: 'Finans ekibine aktarıyorum.',
          procedure: 'Yatırım geçmedi',
          sources: ['Yatırım rehberi'],
          handoff: 'deposit_overdue',
        },
      ],
    });
  });

  it('cuts each message to the judge’s bound', () => {
    const long = 'a'.repeat(SCENARIO_JUDGE_MESSAGE_MAX + 50);
    const grounding = judgeGrounding(
      scenario(),
      play({ transcript: [{ role: 'player', text: long, at: AT }] }),
    );
    expect(grounding.transcript[0]!.text).toHaveLength(SCENARIO_JUDGE_MESSAGE_MAX);
  });

  it('the context line reads back as it was written; any other prompt has none', () => {
    const grounding = judgeGrounding(scenario(), play());
    const { system, messages } = buildScenarioJudgePrompt(grounding);
    expect(readScenarioJudgeGrounding(system)).toEqual(grounding);
    expect(messages).toHaveLength(1);
    for (const key of AI_TEST_JUDGE_CRITERIA) expect(system).toContain(`- ${key}:`);
    expect(readScenarioJudgeGrounding('You answer questions.')).toBeNull();
    const broken = system.replace('"failedChecks":[]', '"failedChecks":["vibes"]');
    expect(readScenarioJudgeGrounding(broken)).toBeNull();
  });
});

describe('the stub’s advice (CI)', () => {
  const grounding = (overrides: Partial<ScenarioJudgeGrounding> = {}) => ({
    ...judgeGrounding(scenario(), play()),
    ...overrides,
  });

  it('every criterion 5 when every hard check held; the hand-over ones only after a hand-over', () => {
    expect(mockScenarioJudge(grounding())).toEqual({
      score: 5,
      comment: 'Stub judge: every hard check held.',
      criteria: Object.fromEntries(AI_TEST_JUDGE_CRITERIA.map((key) => [key, 5])),
    });
    const resolved = mockScenarioJudge(grounding({ handedOver: false }));
    expect(resolved.criteria.handoff_timing).toBeNull();
    expect(resolved.criteria.handoff_summary).toBeNull();
    expect(resolved.score).toBe(5);
  });

  it('a criterion a failed hard check speaks to scores 2, and the score is the mean rounded down', () => {
    const advice = mockScenarioJudge(
      grounding({ handedOver: false, failedChecks: ['forbidden_phrase', 'must_flags'] }),
    );
    expect(advice.criteria.guardrails).toBe(2);
    expect(advice.criteria.tone).toBe(5);
    // Five criteria scored: 5 + 5 + 5 + 2 + 5 → 4.4 → 4.
    expect(advice.score).toBe(4);
    // One fault among seven is still no 5: 32 / 7 → 4.
    expect(mockScenarioJudge(grounding({ failedChecks: ['outcome'] })).score).toBe(4);
    expect(advice.comment).toBe('Stub judge: 2 hard checks failed (forbidden_phrase, must_flags).');
  });

  it('the mock provider answers the judge’s request with it', async () => {
    const g = grounding({ failedChecks: ['required_slots'] });
    const reply = await new MockLlmProvider().complete({
      ...buildScenarioJudgePrompt(g),
      maxOutputTokens: 400,
      timeoutMs: 1_000,
      responseFormat: { name: SCENARIO_JUDGE_RESPONSE_NAME, schema: { type: 'object' } },
    });
    expect(JSON.parse(reply.text)).toEqual(mockScenarioJudge(g));
  });
});

describe('what is kept of a reply', () => {
  it('a whole score 1–5, a trimmed comment, the criteria that were scored', () => {
    expect(
      readScenarioJudgeReply({
        score: 3,
        comment: '  Asked for the receipt twice.  ',
        criteria: { tone: 4, handoff_timing: null, required_info: 2, vibes: 5 },
      }),
    ).toEqual({
      score: 3,
      comment: 'Asked for the receipt twice.',
      criteria: { required_info: 2, tone: 4 },
    });
    expect(readScenarioJudgeReply({ score: 3, comment: 'x', criteria: {} })).toEqual({
      score: 3,
      comment: 'x',
    });
  });

  it('no advice from a score outside 1–5 or a reply without a comment', () => {
    for (const score of [0, 6, 2.5, '4', null]) {
      expect(
        readScenarioJudgeReply({ score, comment: 'x', criteria: {} }),
        String(score),
      ).toBeNull();
    }
    expect(readScenarioJudgeReply({ score: 4, criteria: {} })).toBeNull();
    expect(readScenarioJudgeReply('4')).toBeNull();
  });

  it('a criterion outside 1–5 is dropped, not clamped', () => {
    expect(
      readScenarioJudgeReply({ score: 4, comment: 'x', criteria: { tone: 9, topic: 0 } }),
    ).toEqual({ score: 4, comment: 'x' });
  });

  it('masks the comment (AI-26) and cuts it', () => {
    const masked = readScenarioJudgeReply({
      score: 2,
      comment: 'The player wrote 4111 1111 1111 1111 and the AI repeated it.',
      criteria: {},
    })!;
    expect(masked.comment).not.toContain('4111 1111 1111 1111');
    const long = readScenarioJudgeReply({ score: 2, comment: 'b'.repeat(900), criteria: {} })!;
    expect(long.comment).toHaveLength(AI_TEST_JUDGE_COMMENT_MAX);
  });
});

describe('asking the judge (AI-19-S3: advice, on the test meter)', () => {
  it('one fast structured call inside the simulation context; its tokens are counted', async () => {
    const { llm, calls, scopes } = recording();
    const judged = await judge(llm).judge.judge(input(), play());
    expect(judged).toEqual({
      verdict: {
        score: 5,
        comment: 'Stub judge: every hard check held.',
        criteria: Object.fromEntries(AI_TEST_JUDGE_CRITERIA.map((key) => [key, 5])),
      },
      tokens: 150,
      capped: false,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      tier: 'fast',
      maxOutputTokens: SCENARIO_JUDGE_MAX_OUTPUT_TOKENS,
      responseFormat: { name: SCENARIO_JUDGE_RESPONSE_NAME },
    });
    expect(scopes).toEqual([{ kind: 'test_run', licenseId: TENANT.licenseId }]);
  });

  it('asks nothing of an errored scenario or one the AI never answered', async () => {
    const { llm, calls } = recording();
    const { judge: j } = judge(llm);
    const errored = play({ status: 'errored', stopReason: 'timeout', outcome: null });
    expect(judgeable(errored)).toBe(false);
    expect(await j.judge(input(), errored)).toEqual({ verdict: null, tokens: 0, capped: false });
    const silent = play({
      status: 'failed',
      transcript: [{ role: 'player', text: 'merhaba', at: AT }],
    });
    expect(await j.judge(input(), silent)).toEqual({ verdict: null, tokens: 0, capped: false });
    expect(calls).toHaveLength(0);
  });

  it('a failing provider leaves the result without advice, logged; it never throws', async () => {
    const { llm } = recording(() => {
      throw new Error('provider down');
    });
    const { judge: j, logger } = judge(llm);
    expect(await j.judge(input(), play())).toEqual({ verdict: null, tokens: 0, capped: false });
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn.mock.calls[0]![0]).toMatchObject({ scenario_key: scenario().key });
  });

  it('a reply outside the schema, twice, is no advice', async () => {
    const { llm, calls } = recording(() => '{"score": 9, "comment": "x", "criteria": {}}');
    expect((await judge(llm).judge.judge(input(), play())).verdict).toBeNull();
    expect(calls).toHaveLength(2);
  });

  it('a prompt past LLM_MAX_PROMPT_CHARS is never sent', async () => {
    const { llm, calls } = recording();
    const j = new ScenarioJudge({
      llm,
      maxOutputTokens: 800,
      timeoutMs: 2_000,
      maxPromptChars: 200,
    });
    expect((await j.judge(input(), play())).verdict).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('a spent test allowance is no advice and says so (capped)', async () => {
    const { llm } = recording(() => {
      throw new AiDailyCapError('llm_test', 'workspace', 60);
    });
    const { judge: j, logger } = judge(llm);
    expect(await j.judge(input(), play())).toEqual({ verdict: null, tokens: 0, capped: true });
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('a low score leaves a passing play passing — the judge returns advice, not a status', async () => {
    const { llm } = recording(() =>
      JSON.stringify({
        score: 1,
        comment: 'Rude.',
        criteria: Object.fromEntries(AI_TEST_JUDGE_CRITERIA.map((key) => [key, 1])),
      }),
    );
    const passing = play();
    const judged = await judge(llm).judge.judge(input(), passing);
    expect(judged.verdict?.score).toBe(1);
    expect(Object.keys(judged).sort()).toEqual(['capped', 'tokens', 'verdict']);
    expect(passing.status).toBe('passed');
  });
});
