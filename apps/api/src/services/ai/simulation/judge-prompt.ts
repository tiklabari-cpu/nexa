/**
 * What the scenario judge is told, and what the stub answers in its place
 * (tm 314.3 · SiyahTuş analysis AI-19 §4, AI-24 rubric). The judge
 * (`judge.ts`) makes the call; this file only writes the prompt and reads the
 * reply, so the in-process stub can import it without the provider (the
 * simulated player's layout, `player-prompt.ts`).
 */
import {
  AI_TEST_CHECK_KINDS,
  AI_TEST_JUDGE_COMMENT_MAX,
  AI_TEST_JUDGE_CRITERIA,
  AI_TEST_JUDGE_SCORE_MAX,
  AI_TEST_JUDGE_SCORE_MIN,
  SCENARIO_OUTCOMES,
  type AiTestCheckKind,
  type AiTestJudgeCriterion,
  type AiTestJudgeVerdict,
  type AiTestTranscriptEntry,
  type ScenarioOutcome,
} from '@siyahtus/types';
import { maskSensitive } from '../../../lib/sensitive-mask.js';
import type { JsonSchema } from '../provider/json-schema.js';
import type { LlmCompletionRequest, LlmResponseFormat } from '../provider/llm-provider.js';
import type { ScenarioPlay, SimulatedScenario } from './runner.js';

/** `response_format.json_schema.name` — and what the mock answers by. */
export const SCENARIO_JUDGE_RESPONSE_NAME = 'scenario_judge';

export const SCENARIO_JUDGE_MARKER = '--- scenario judge context (JSON, last line) ---';

/** The judge's reply is a score and a sentence or two; its ceiling, in tokens. */
export const SCENARIO_JUDGE_MAX_OUTPUT_TOKENS = 400;

/** Each message the judge reads is cut to this: the judge scores a conversation, not an essay. */
export const SCENARIO_JUDGE_MESSAGE_MAX = 1_000;

/** The two criteria that only mean something when the conversation was handed over. */
const HANDOFF_CRITERIA: ReadonlySet<AiTestJudgeCriterion> = new Set([
  'handoff_timing',
  'handoff_summary',
]);

/** What each criterion asks — the model's instruction. */
const CRITERION_TEXT: Readonly<Record<AiTestJudgeCriterion, string>> = {
  topic: 'the assistant understood what the player wanted and took the right path for it',
  required_info: 'it collected what the matter needs before acting, without asking twice',
  faithfulness: 'it said nothing the knowledge sources or the procedure did not support',
  guardrails: 'it stayed within responsible gaming and the site rules — no promise, no pressure',
  handoff_timing: 'it handed over when it should, neither too early nor too late',
  handoff_summary: 'the hand-over carried what the person taking over needs',
  tone: 'it was clear, polite and fitting for the player’s mood',
};

/** One message as the judge reads it; an AI message says what it decided. */
export interface JudgedMessage {
  readonly role: 'player' | 'ai';
  readonly text: string;
  readonly procedure?: string | null;
  readonly sources?: readonly string[];
  readonly handoff?: string | null;
}

/** What the judge is given. */
export interface ScenarioJudgeGrounding {
  readonly language: string;
  readonly persona: string;
  readonly goal: string | null;
  readonly expected: ScenarioOutcome;
  readonly outcome: ScenarioOutcome | null;
  readonly handedOver: boolean;
  /** The kinds of the hard checks that failed — context for the comment, not a decision. */
  readonly failedChecks: readonly AiTestCheckKind[];
  readonly transcript: readonly JudgedMessage[];
}

/** A reply that passed the schema. */
export interface ScenarioJudgeReply {
  score: number;
  comment: string;
  criteria: Record<AiTestJudgeCriterion, number | null>;
}

const SCORE: JsonSchema = {
  type: 'integer',
  minimum: AI_TEST_JUDGE_SCORE_MIN,
  maximum: AI_TEST_JUDGE_SCORE_MAX,
};

const JUDGE_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    score: { ...SCORE, description: 'The conversation overall, 1 (poor) to 5 (right).' },
    comment: {
      type: 'string',
      description:
        'One or two sentences: what went well or wrong, for the person who wrote the AI.',
    },
    criteria: {
      type: 'object',
      properties: Object.fromEntries(
        AI_TEST_JUDGE_CRITERIA.map((key): [string, JsonSchema] => [
          key,
          {
            type: ['integer', 'null'],
            minimum: AI_TEST_JUDGE_SCORE_MIN,
            maximum: AI_TEST_JUDGE_SCORE_MAX,
            description: `1–5: ${CRITERION_TEXT[key]}; null when it does not apply.`,
          },
        ]),
      ),
      required: AI_TEST_JUDGE_CRITERIA,
      additionalProperties: false,
    },
  },
  required: ['score', 'comment', 'criteria'],
  additionalProperties: false,
};

export const SCENARIO_JUDGE_RESPONSE_FORMAT: LlmResponseFormat = {
  name: SCENARIO_JUDGE_RESPONSE_NAME,
  schema: JUDGE_SCHEMA,
};

/** What the judge reads of a played scenario. */
export function judgeGrounding(
  scenario: Pick<SimulatedScenario, 'language' | 'persona' | 'goal' | 'expectations'>,
  play: Pick<ScenarioPlay, 'outcome' | 'transcript' | 'checks'>,
): ScenarioJudgeGrounding {
  const cut = (text: string) => text.slice(0, SCENARIO_JUDGE_MESSAGE_MAX);
  const transcript = play.transcript.flatMap((entry: AiTestTranscriptEntry): JudgedMessage[] => {
    if (entry.role === 'player') return [{ role: 'player', text: cut(entry.text) }];
    if (entry.role !== 'ai') return [];
    const trace = entry.trace;
    return [
      {
        role: 'ai',
        text: cut(entry.text),
        ...(trace
          ? {
              procedure: trace.procedure?.name ?? null,
              sources: trace.sources.map((source) => source.title),
              handoff: trace.handoff?.reason ?? null,
            }
          : {}),
      },
    ];
  });
  return {
    language: scenario.language,
    persona: scenario.persona,
    goal: scenario.goal,
    expected: scenario.expectations.outcome,
    outcome: play.outcome,
    handedOver: play.outcome === 'handoff',
    failedChecks: play.checks.filter((check) => !check.passed).map((check) => check.kind),
    transcript,
  };
}

export function buildScenarioJudgePrompt(
  grounding: ScenarioJudgeGrounding,
): Pick<LlmCompletionRequest, 'system' | 'messages'> {
  const lines = [
    "You review a test conversation between an online gaming site's support assistant and a simulated player. Score how well the assistant handled it.",
    'The criteria, each 1 (poor) to 5 (right):',
    ...AI_TEST_JUDGE_CRITERIA.map(
      (key) =>
        `- ${key}: ${CRITERION_TEXT[key]}${HANDOFF_CRITERIA.has(key) ? ' (null unless the conversation was handed over)' : ''}.`,
    ),
    'The context below has the player, what the conversation should have ended in, how it ended, the hard checks that failed (already decided — explain them, do not re-decide them) and the conversation, each assistant message with the procedure it followed, the knowledge it used and why it handed over.',
    'Write the comment in English, at most two sentences, without quoting personal data.',
    'Reply with one JSON object: score, comment and criteria.',
    SCENARIO_JUDGE_MARKER,
    JSON.stringify(grounding),
  ];
  return {
    system: lines.join('\n'),
    messages: [{ role: 'user', content: 'Score the conversation.' }],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The grounding `buildScenarioJudgePrompt` wrote, or null for any other prompt. */
export function readScenarioJudgeGrounding(system: string): ScenarioJudgeGrounding | null {
  const lines = system.split('\n');
  const at = lines.lastIndexOf(SCENARIO_JUDGE_MARKER);
  if (at < 0 || at + 1 >= lines.length) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(lines[at + 1]!);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  const outcomes = SCENARIO_OUTCOMES as readonly unknown[];
  const kinds = AI_TEST_CHECK_KINDS as readonly unknown[];
  const g = parsed;
  if (
    typeof g['language'] !== 'string' ||
    typeof g['persona'] !== 'string' ||
    !(g['goal'] === null || typeof g['goal'] === 'string') ||
    !outcomes.includes(g['expected']) ||
    !(g['outcome'] === null || outcomes.includes(g['outcome'])) ||
    typeof g['handedOver'] !== 'boolean' ||
    !Array.isArray(g['failedChecks']) ||
    !g['failedChecks'].every((kind) => kinds.includes(kind)) ||
    !Array.isArray(g['transcript']) ||
    !g['transcript'].every(
      (m) =>
        isRecord(m) &&
        (m['role'] === 'player' || m['role'] === 'ai') &&
        typeof m['text'] === 'string',
    )
  ) {
    return null;
  }
  return g as unknown as ScenarioJudgeGrounding;
}

/** Which criterion a failed hard check speaks to — the stub's reading. */
const CHECK_CRITERION: Readonly<Record<AiTestCheckKind, AiTestJudgeCriterion>> = {
  outcome: 'topic',
  team: 'handoff_timing',
  topic: 'topic',
  procedure: 'topic',
  reason_code: 'handoff_timing',
  required_slots: 'required_info',
  values: 'required_info',
  forbidden_phrase: 'guardrails',
  sensitive_request: 'guardrails',
  must_flags: 'guardrails',
  must_not_flags: 'guardrails',
  turn_count: 'required_info',
  language: 'tone',
};

/**
 * The stub's advice: every criterion 5, a criterion a failed hard check speaks
 * to 2, the hand-over ones null without a hand-over; the score their mean,
 * rounded down — one fault is never a 5. Deterministic, and never more than
 * the hard checks already said.
 */
export function mockScenarioJudge(grounding: ScenarioJudgeGrounding): ScenarioJudgeReply {
  const faulted = new Set(grounding.failedChecks.map((kind) => CHECK_CRITERION[kind]));
  const criteria = Object.fromEntries(
    AI_TEST_JUDGE_CRITERIA.map((key) => [
      key,
      HANDOFF_CRITERIA.has(key) && !grounding.handedOver ? null : faulted.has(key) ? 2 : 5,
    ]),
  ) as Record<AiTestJudgeCriterion, number | null>;
  const scored = Object.values(criteria).filter((value): value is number => value !== null);
  const score = Math.floor(scored.reduce((sum, value) => sum + value, 0) / scored.length);
  const failed = grounding.failedChecks.length;
  return {
    score,
    comment:
      failed === 0
        ? 'Stub judge: every hard check held.'
        : `Stub judge: ${failed} hard check${failed === 1 ? '' : 's'} failed (${grounding.failedChecks.join(', ')}).`,
    criteria,
  };
}

function isScore(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= AI_TEST_JUDGE_SCORE_MIN &&
    value <= AI_TEST_JUDGE_SCORE_MAX
  );
}

/**
 * The advice as the result keeps it, or null when the reply cannot be one: a
 * whole score, a comment masked like a player’s message — it may quote one — (AI-26) and cut,
 * the criteria that were scored. The schema gate checked the shape; this is
 * the second wall, for a provider that does not enforce it.
 */
export function readScenarioJudgeReply(reply: unknown): AiTestJudgeVerdict | null {
  if (!isRecord(reply) || !isScore(reply['score']) || typeof reply['comment'] !== 'string') {
    return null;
  }
  const comment = maskSensitive(reply['comment'].trim(), { author: 'customer' }).text.slice(
    0,
    AI_TEST_JUDGE_COMMENT_MAX,
  );
  const criteria: Partial<Record<AiTestJudgeCriterion, number>> = {};
  if (isRecord(reply['criteria'])) {
    for (const key of AI_TEST_JUDGE_CRITERIA) {
      const value = reply['criteria'][key];
      if (isScore(value)) criteria[key] = value;
    }
  }
  return {
    score: reply['score'],
    comment,
    ...(Object.keys(criteria).length > 0 ? { criteria } : {}),
  };
}
