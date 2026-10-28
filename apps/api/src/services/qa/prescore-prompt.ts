/**
 * What the QA pre-score's model is told, and what the stub answers in its
 * place (tm 319.2 · SiyahTuş analysis AI-24 §3). The scorer (`prescore.ts`)
 * makes the call; this file writes the prompt, reads the reply and checks its
 * evidence, so the in-process stub can import it without the provider (the
 * scenario judge's layout, `simulation/judge-prompt.ts`).
 *
 * The context is one JSON line after a marker at the end of the instructions:
 * the masked excerpt (each message with its event id), the decision trail
 * (procedure, sources, guardrail checks, hand-over reasons, flags — ids and
 * codes, no text), the review's reasons and the rubric.
 */
import {
  QA_PRESCORE_EVIDENCE_MAX,
  QA_PRESCORE_RATIONALE_MAX,
  isQaScoreValueFor,
  qaScoreFails,
  type QaExcerptMessage,
  type QaPrescore,
  type QaPrescoreCriterion,
  type QaRubricCriterion,
} from '@siyahtus/types';
import { maskSensitive } from '../../lib/sensitive-mask.js';
import type { JsonSchema } from '../ai/provider/json-schema.js';
import type { LlmCompletionRequest, LlmResponseFormat } from '../ai/provider/llm-provider.js';

/** `response_format.json_schema.name` — and what the mock answers by. */
export const QA_PRESCORE_RESPONSE_NAME = 'qa_prescore';

export const QA_PRESCORE_MARKER = '--- qa prescore context (JSON, last line) ---';

/** A rationale per criterion and a list of ids; its ceiling, in tokens. */
export const QA_PRESCORE_MAX_OUTPUT_TOKENS = 1_200;

/** Each message the model reads is cut to this. */
export const QA_PRESCORE_MESSAGE_MAX = 1_000;

/** What the model is given. */
export interface QaPrescoreGrounding {
  readonly reasons: readonly string[];
  readonly rubric: ReadonlyArray<Pick<QaRubricCriterion, 'key' | 'label' | 'type' | 'critical'>>;
  readonly messages: ReadonlyArray<{
    readonly event_id: string;
    readonly author: 'player' | 'ai' | 'bot' | 'agent';
    readonly text: string;
  }>;
  readonly trace: {
    readonly procedures: readonly string[];
    readonly guardrail_hits: ReadonlyArray<{ rule: string; stage: string; action: string }>;
    readonly handoff_reasons: readonly string[];
    readonly risk_flags: readonly string[];
  };
}

/** A reply that passed the schema, before its evidence is checked. */
export interface QaPrescoreReply {
  criteria: Array<{
    key: string;
    value: string | number | null;
    evidence_event_ids: string[];
    rationale: string;
  }>;
  critical_candidates: string[];
  overall: 'pass' | 'fail';
}

const REPLY_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    criteria: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          key: { type: 'string', description: 'The rubric criterion’s key.' },
          value: {
            type: ['string', 'integer', 'null'],
            description:
              'pass or fail for a pass_fail criterion, 1–5 for a score_1_5 one; null when it does not apply (never for a critical one).',
          },
          evidence_event_ids: {
            type: 'array',
            items: { type: 'string' },
            description:
              'The event ids of the messages the value rests on — only ids from the context.',
          },
          rationale: { type: 'string', description: 'One sentence, without personal data.' },
        },
        required: ['key', 'value', 'evidence_event_ids', 'rationale'],
        additionalProperties: false,
      },
    },
    critical_candidates: {
      type: 'array',
      items: { type: 'string' },
      description: 'The keys of the critical criteria that look failed.',
    },
    overall: { type: 'string', enum: ['pass', 'fail'] },
  },
  required: ['criteria', 'critical_candidates', 'overall'],
  additionalProperties: false,
};

export const QA_PRESCORE_RESPONSE_FORMAT: LlmResponseFormat = {
  name: QA_PRESCORE_RESPONSE_NAME,
  schema: REPLY_SCHEMA,
};

/** The grounding of one review: its excerpt as the model reads it, the trail, the rubric. */
export function prescoreGrounding(input: {
  reasons: readonly string[];
  rubric: readonly QaRubricCriterion[];
  excerpt: readonly QaExcerptMessage[];
  trace: QaPrescoreGrounding['trace'];
}): QaPrescoreGrounding {
  return {
    reasons: input.reasons,
    rubric: input.rubric.map(({ key, label, type, critical }) => ({ key, label, type, critical })),
    messages: input.excerpt.map((message) => ({
      event_id: message.event_id,
      author:
        message.author_type === 'customer'
          ? 'player'
          : message.author_type === 'agent'
            ? 'agent'
            : message.is_ai
              ? 'ai'
              : 'bot',
      text: message.text.slice(0, QA_PRESCORE_MESSAGE_MAX),
    })),
    trace: input.trace,
  };
}

export function buildQaPrescorePrompt(
  grounding: QaPrescoreGrounding,
): Pick<LlmCompletionRequest, 'system' | 'messages'> {
  const lines = [
    "You pre-score a real conversation between an online gaming site's support AI and a player, for the quality reviewer who decides. Your scores are a suggestion; a person confirms every critical one.",
    'Score each rubric criterion: pass or fail for pass_fail, 1 (poor) to 5 (excellent) for score_1_5, null when it does not apply (a hand-over criterion without a hand-over); a critical criterion is never null.',
    'For each value give the event ids of the messages it rests on — only ids that appear in the context; any other id makes your whole answer void.',
    'The context has why the conversation was queued, the rubric, the messages (masked, with their event ids) and the decision trail: the procedures followed, the guardrail checks, the hand-over reasons and the risk flags.',
    'Write each rationale in English, one sentence, without quoting personal data.',
    'Reply with one JSON object: criteria, critical_candidates and overall.',
    QA_PRESCORE_MARKER,
    JSON.stringify(grounding),
  ];
  return {
    system: lines.join('\n'),
    messages: [{ role: 'user', content: 'Pre-score the conversation.' }],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The grounding `buildQaPrescorePrompt` wrote, or null for any other prompt. */
export function readQaPrescoreGrounding(system: string): QaPrescoreGrounding | null {
  const lines = system.split('\n');
  const at = lines.lastIndexOf(QA_PRESCORE_MARKER);
  if (at < 0 || at + 1 >= lines.length) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(lines[at + 1]!);
  } catch {
    return null;
  }
  if (
    !isRecord(parsed) ||
    !Array.isArray(parsed['rubric']) ||
    !Array.isArray(parsed['messages']) ||
    !Array.isArray(parsed['reasons']) ||
    !isRecord(parsed['trace'])
  ) {
    return null;
  }
  return parsed as unknown as QaPrescoreGrounding;
}

/**
 * The stub's pre-score: every criterion right — pass, 5, a hand-over one null
 * without a hand-over — except what the trail itself says went wrong: a
 * guardrail that only warned fails `guardrails`. Each value cites the
 * AI's last message (or the conversation's last). Deterministic, and never
 * more than the recorded trail.
 */
export function mockQaPrescore(grounding: QaPrescoreGrounding): QaPrescoreReply {
  const handedOver = grounding.trace.handoff_reasons.length > 0;
  // A warning let the draft through to the player; a rewrite or a hand-over caught it.
  const guardrailBroke = grounding.trace.guardrail_hits.some((hit) => hit.action === 'warn');
  const cited =
    [...grounding.messages].reverse().find((m) => m.author === 'ai') ?? grounding.messages.at(-1);
  const evidence = cited ? [cited.event_id] : [];
  const criteria = grounding.rubric.map((criterion) => {
    const handover = criterion.key === 'handoff_timing' || criterion.key === 'handoff_summary';
    let value: string | number | null = criterion.type === 'pass_fail' ? 'pass' : 5;
    if (handover && !handedOver && !criterion.critical) value = null;
    if (criterion.key === 'guardrails' && guardrailBroke) value = 'fail';
    return {
      key: criterion.key,
      value,
      evidence_event_ids: evidence,
      rationale:
        value === 'fail'
          ? 'Stub pre-score: a guardrail let a draft through with a warning.'
          : 'Stub pre-score: nothing in the decision trail says otherwise.',
    };
  });
  const critical = criteria
    .filter((c) => grounding.rubric.find((r) => r.key === c.key)?.critical && c.value === 'fail')
    .map((c) => c.key);
  return {
    criteria,
    critical_candidates: critical,
    overall: criteria.some((c) => c.value === 'fail') ? 'fail' : 'pass',
  };
}

/** Why a reply is not a pre-score that may be kept — or null when it is one. */
export type QaPrescoreRefusal =
  | { reason: 'malformed' }
  | { reason: 'foreign_evidence'; event_id: string }
  | { reason: 'unknown_criterion'; key: string };

/**
 * The reply as the review keeps it (`qa_reviews.prescore`), or why it is
 * dropped (AI-24 §3): an evidence id that is not one of `ownEventIds` — this
 * connection's messages — voids the whole pre-score, as does a criterion the
 * rubric does not have or a value its criterion cannot hold. A criterion the
 * model left out stays unscored. Rationales are masked like a player's
 * message (they may quote one) and cut.
 */
export function readQaPrescoreReply(
  reply: unknown,
  rubric: readonly QaRubricCriterion[],
  ownEventIds: ReadonlySet<string>,
  scoredAt: Date,
): { prescore: QaPrescore } | { refused: QaPrescoreRefusal } {
  if (!isRecord(reply) || !Array.isArray(reply['criteria'])) {
    return { refused: { reason: 'malformed' } };
  }
  const criteria: QaPrescoreCriterion[] = [];
  const seen = new Set<string>();
  for (const raw of reply['criteria']) {
    if (!isRecord(raw) || typeof raw['key'] !== 'string') {
      return { refused: { reason: 'malformed' } };
    }
    const criterion = rubric.find((c) => c.key === raw['key']);
    if (!criterion) return { refused: { reason: 'unknown_criterion', key: raw['key'] } };
    if (seen.has(criterion.key) || !isQaScoreValueFor(criterion, raw['value'])) {
      return { refused: { reason: 'malformed' } };
    }
    seen.add(criterion.key);
    const evidence = Array.isArray(raw['evidence_event_ids']) ? raw['evidence_event_ids'] : [];
    for (const id of evidence) {
      if (typeof id !== 'string' || !ownEventIds.has(id)) {
        return { refused: { reason: 'foreign_evidence', event_id: String(id) } };
      }
    }
    criteria.push({
      key: criterion.key,
      value: raw['value'],
      evidence_event_ids: [...new Set(evidence as string[])].slice(0, QA_PRESCORE_EVIDENCE_MAX),
      rationale: maskSensitive(String(raw['rationale'] ?? '').trim(), {
        author: 'customer',
      }).text.slice(0, QA_PRESCORE_RATIONALE_MAX),
    });
  }
  const criticalCandidates = criteria
    .filter((c) => rubric.some((r) => r.key === c.key && r.critical) && qaScoreFails(c.value))
    .map((c) => c.key);
  return {
    prescore: {
      criteria,
      critical_candidates: criticalCandidates,
      overall:
        reply['overall'] === 'fail' || criteria.some((c) => qaScoreFails(c.value))
          ? 'fail'
          : 'pass',
      scored_at: scoredAt.toISOString(),
    },
  };
}
