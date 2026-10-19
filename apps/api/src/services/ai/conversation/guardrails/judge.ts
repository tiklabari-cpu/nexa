/**
 * The judge (tm 301.3 · AI-08 §7, AI-08-S3): one structured call — LLM #3 —
 * that reads a draft against the rules a lexicon cannot hold: the locked
 * catalogue's lines, and the workspace's own rules that block a reply or hand
 * a message over. `{ ok, violations: [{ rule_id, quote }] }`.
 *
 * It runs only where the workspace turned it on (`ai_guardrail_settings.
 * judge_enabled`) and only on a message about money, the account, a bonus or
 * responsible gaming (AI-08-S3: it costs a call and its wait) — the groups
 * the no-answer reply sorts messages into (`noAnswerCategory`). Elsewhere a
 * workspace rule is a line in the prompt and nothing more.
 *
 * **A reading, never a decision**, like the understanding call: a rule id
 * the call was not given is no violation, and a quote the draft — or, for a
 * hand-over rule, the player — did not write is no quote (the traceability
 * shield). What a violation does is the turn's: the draft is written once
 * more, and a second one the judge still faults is not sent. A workspace rule
 * that hands over (`force_handoff`) is read against the player's message: when
 * the judge finds the message falls under it, the turn hands over.
 *
 * Like the other structured calls, the context is one JSON line after a
 * marker at the end of the instructions; the in-process stub reads it there
 * (`mockJudge`) and finds nothing — the deterministic output check is the
 * stub's whole judgement, and a test that wants a verdict scripts one.
 */
import { PLATFORM_GUARDRAILS, isGuardrailId, type GuardrailHitRule } from '@siyahtus/types';
import type { JsonSchema } from '../../provider/json-schema.js';
import type { LlmCompletionRequest, LlmResponseFormat } from '../../provider/llm-provider.js';
import { tracesTo } from '../slots/extract.js';
import type { GuardrailRuleConfig } from './config.js';
import type { OutputViolation } from './output-check.js';

/** `response_format.json_schema.name` — and what the mock answers by. */
export const JUDGE_RESPONSE_NAME = 'guardrail_judge';

export const JUDGE_MARKER = '--- judge context (JSON, last line) ---';

/** A rule as the judge is given it: the key a violation names, the rule's words, what it is about. */
export interface JudgeRule {
  /** `G7` or `rule:<uuid>` (`guardrailHitRuleKey`). */
  readonly id: string;
  readonly text: string;
  /** `reply`: the draft must not break it. `message`: the player's message falls under it — hand over. */
  readonly about: 'reply' | 'message';
}

export interface JudgeGrounding {
  readonly message: string;
  readonly draft: string;
  readonly rules: readonly JudgeRule[];
}

const JUDGE_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    ok: {
      type: 'boolean',
      description: 'True when the draft breaks no rule and no hand-over rule applies.',
    },
    violations: {
      type: 'array',
      maxItems: 20,
      items: {
        type: 'object',
        properties: {
          rule_id: { type: 'string', description: 'The id of the rule, as listed.' },
          quote: {
            type: 'string',
            description:
              "The exact words that break it: the draft's for a reply rule, the customer's for a hand-over rule.",
          },
        },
        required: ['rule_id', 'quote'],
        additionalProperties: false,
      },
    },
  },
  required: ['ok', 'violations'],
  additionalProperties: false,
};

export const JUDGE_RESPONSE_FORMAT: LlmResponseFormat = {
  name: JUDGE_RESPONSE_NAME,
  schema: JUDGE_SCHEMA,
};

/** A reply that passed the schema — the model's words, not yet checked. */
export interface JudgeReply {
  ok: boolean;
  violations: Array<{ rule_id: string; quote: string }>;
}

/**
 * The rules the judge reads a draft against: every locked rule a reply can
 * break — G4 only on a risk-flagged conversation — and the workspace's rules
 * that block a reply or hand a message over.
 */
export function judgeRules(input: {
  riskFlagged: boolean;
  workspaceRules: readonly GuardrailRuleConfig[];
}): JudgeRule[] {
  const platform = PLATFORM_GUARDRAILS.filter(
    (rule) =>
      rule.output !== null &&
      (rule.appliesWhen === 'always' || input.riskFlagged) &&
      rule.action !== 'warn',
  ).map((rule): JudgeRule => ({ id: rule.id, text: rule.prompt.en, about: 'reply' }));
  const workspace = input.workspaceRules
    .filter((rule) => rule.action !== 'prompt_only')
    .map((rule): JudgeRule => ({
      id: `rule:${rule.id}`,
      text: `${rule.title}: ${rule.body.replace(/\s+/g, ' ').trim()}`,
      about: rule.action === 'force_handoff' ? 'message' : 'reply',
    }));
  return [...platform, ...workspace];
}

export function buildJudgePrompt(
  grounding: JudgeGrounding,
): Pick<LlmCompletionRequest, 'system' | 'messages'> {
  const reply = grounding.rules.filter((rule) => rule.about === 'reply');
  const message = grounding.rules.filter((rule) => rule.about === 'message');
  const lines = [
    "You check a customer-support assistant's draft reply before it is sent to a customer of an online gaming business.",
    'Rules the draft must not break:',
    ...reply.map((rule) => `- ${rule.id}: ${rule.text}`),
    ...(message.length > 0
      ? [
          "Rules about the customer's message — when the message falls under one, report it with the customer's words:",
          ...message.map((rule) => `- ${rule.id}: ${rule.text}`),
        ]
      : []),
    'Reply with one JSON object. ok: true when the draft breaks no rule and no rule about the message applies. violations: one item per rule broken, with rule_id exactly as listed and quote the exact words that break it. Report only what the text says, never what it might imply.',
    JUDGE_MARKER,
    JSON.stringify(grounding),
  ];
  return {
    system: lines.join('\n'),
    messages: [
      {
        role: 'user',
        content: `Customer's message:\n${grounding.message}\n\nDraft reply:\n${grounding.draft}`,
      },
    ],
  };
}

/** The grounding `buildJudgePrompt` wrote, or null for any other prompt. */
export function readJudgeGrounding(system: string): JudgeGrounding | null {
  const lines = system.split('\n');
  const at = lines.lastIndexOf(JUDGE_MARKER);
  if (at < 0 || at + 1 >= lines.length) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(lines[at + 1]!);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const { message, draft, rules } = parsed as Record<string, unknown>;
  if (typeof message !== 'string' || typeof draft !== 'string' || !Array.isArray(rules)) {
    return null;
  }
  const valid = rules.every(
    (rule): rule is JudgeRule =>
      typeof rule === 'object' &&
      rule !== null &&
      typeof (rule as JudgeRule).id === 'string' &&
      typeof (rule as JudgeRule).text === 'string' &&
      ((rule as JudgeRule).about === 'reply' || (rule as JudgeRule).about === 'message'),
  );
  return valid ? { message, draft, rules: rules as JudgeRule[] } : null;
}

/** The stub's verdict: nothing found — its output check is the deterministic one. */
export function mockJudge(_grounding: JudgeGrounding): JudgeReply {
  return { ok: true, violations: [] };
}

export interface JudgeVerdict {
  /** What the draft broke: rewritten once, then not sent. */
  readonly violations: OutputViolation[];
  /** The workspace hand-over rules the message falls under: the turn hands over. */
  readonly handoff: OutputViolation[];
  /** What was dropped by the shield — a run-log note each, naming the field, never the words. */
  readonly dropped: string[];
}

/** The reply, checked against what the call was given. */
export function readJudgeReply(reply: JudgeReply, grounding: JudgeGrounding): JudgeVerdict {
  const verdict: JudgeVerdict = { violations: [], handoff: [], dropped: [] };
  const seen = new Set<string>();
  for (const item of reply.violations) {
    const rule = grounding.rules.find((candidate) => candidate.id === item.rule_id);
    if (!rule) {
      verdict.dropped.push('a violations rule_id was not given');
      continue;
    }
    const quote = item.quote.trim();
    if (!tracesTo(quote, rule.about === 'message' ? grounding.message : grounding.draft)) {
      verdict.dropped.push(`violations quote for ${rule.id} is not in the ${rule.about}`);
      continue;
    }
    if (seen.has(rule.id)) continue;
    seen.add(rule.id);
    const found: OutputViolation = {
      rule: hitRuleOf(rule.id),
      quote,
      pattern: null,
      note: `${rule.text} (it said: "${quote}")`,
    };
    if (rule.about === 'message') verdict.handoff.push(found);
    else verdict.violations.push(found);
  }
  return verdict;
}

/** A listed rule id as a hit's rule: `G7`, or a workspace rule's `rule:<uuid>`. */
function hitRuleOf(id: string): GuardrailHitRule {
  return isGuardrailId(id)
    ? { source: 'platform', id }
    : { source: 'rule', id: id.slice('rule:'.length) };
}
