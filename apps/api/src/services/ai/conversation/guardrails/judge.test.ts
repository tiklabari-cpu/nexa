/**
 * The judge (tm 301.3 · AI-08 §7, AI-08-S3): which rules it reads a draft
 * against, the prompt and its context line, the strict schema, and the
 * shield its verdict passes before the turn acts on it.
 */
import { describe, expect, it } from 'vitest';
import { assertStrictJsonSchema } from '../../provider/json-schema.js';
import type { GuardrailRuleConfig } from './config.js';
import {
  buildJudgePrompt,
  JUDGE_RESPONSE_FORMAT,
  judgeRules,
  mockJudge,
  readJudgeGrounding,
  readJudgeReply,
  type JudgeGrounding,
} from './judge.js';

const RULE_ID = '11111111-1111-4111-8111-111111111111';
const HANDOFF_ID = '22222222-2222-4222-8222-222222222222';

function rule(id: string, extra: Partial<GuardrailRuleConfig>): GuardrailRuleConfig {
  return {
    id,
    aiAgentId: 'agent-1',
    title: 'Kural',
    body: 'Kural metni.',
    category: 'money',
    action: 'block_output',
    scope: { all: true },
    ...extra,
  };
}

const WORKSPACE = [
  rule(RULE_ID, { title: 'Çekim süresi', body: 'Çekim için hiçbir süre söyleme.' }),
  rule(HANDOFF_ID, {
    title: 'Hukuki tehdit',
    body: 'Oyuncu dava açacağını söylerse devret.',
    action: 'force_handoff',
  }),
  rule('33333333-3333-4333-8333-333333333333', { action: 'prompt_only', body: 'Yalnız istem.' }),
];

describe('the rules the judge reads (AI-08 §7)', () => {
  it('the locked rules a reply can break, and the workspace rules that block or hand over', () => {
    const rules = judgeRules({ riskFlagged: false, workspaceRules: WORKSPACE });
    const reply = rules.filter((r) => r.about === 'reply').map((r) => r.id);
    expect(reply).toEqual([
      'G7',
      'G8',
      'G9',
      'G10',
      'G11',
      'G12',
      'G13',
      'G14',
      'G16',
      `rule:${RULE_ID}`,
    ]);
    expect(rules.filter((r) => r.about === 'message').map((r) => r.id)).toEqual([
      `rule:${HANDOFF_ID}`,
    ]);
    expect(rules.find((r) => r.id === `rule:${RULE_ID}`)?.text).toBe(
      'Çekim süresi: Çekim için hiçbir süre söyleme.',
    );
  });

  it('G4 only on a risk-flagged conversation', () => {
    expect(judgeRules({ riskFlagged: false, workspaceRules: [] }).map((r) => r.id)).not.toContain(
      'G4',
    );
    expect(judgeRules({ riskFlagged: true, workspaceRules: [] }).map((r) => r.id)).toContain('G4');
  });
});

describe('the call', () => {
  const grounding: JudgeGrounding = {
    message: 'Çekimim ne zaman gelir? Yoksa dava açacağım.',
    draft: 'Çekiminiz 2 saat içinde gelir.',
    rules: judgeRules({ riskFlagged: false, workspaceRules: WORKSPACE }),
  };

  it('asks for a strict schema, and lists the rules by the id a violation names', () => {
    expect(() =>
      assertStrictJsonSchema(JUDGE_RESPONSE_FORMAT.name, JUDGE_RESPONSE_FORMAT.schema),
    ).not.toThrow();
    const prompt = buildJudgePrompt(grounding);
    expect(prompt.system).toContain(
      `- rule:${RULE_ID}: Çekim süresi: Çekim için hiçbir süre söyleme.`,
    );
    expect(prompt.system).toContain(`- rule:${HANDOFF_ID}: Hukuki tehdit`);
    expect(prompt.messages).toEqual([
      {
        role: 'user',
        content: `Customer's message:\n${grounding.message}\n\nDraft reply:\n${grounding.draft}`,
      },
    ]);
  });

  it('its context line reads back whole — the stub answers from it, and finds nothing', () => {
    const read = readJudgeGrounding(buildJudgePrompt(grounding).system);
    expect(read).toEqual(grounding);
    expect(mockJudge(read!)).toEqual({ ok: true, violations: [] });
    expect(readJudgeGrounding('any other prompt')).toBeNull();
  });
});

describe('the verdict’s shield', () => {
  const grounding: JudgeGrounding = {
    message: 'Dava açacağım, param nerede?',
    draft: 'Çekiminiz 2 saat içinde gelir.',
    rules: judgeRules({ riskFlagged: false, workspaceRules: WORKSPACE }),
  };

  it('a reply rule’s violation quotes the draft; a hand-over rule’s quotes the player', () => {
    const verdict = readJudgeReply(
      {
        ok: false,
        violations: [
          { rule_id: `rule:${RULE_ID}`, quote: '2 saat içinde gelir' },
          { rule_id: `rule:${HANDOFF_ID}`, quote: 'Dava açacağım' },
          { rule_id: 'G7', quote: '2 saat içinde gelir' },
        ],
      },
      grounding,
    );
    expect(verdict.violations.map((v) => v.rule)).toEqual([
      { source: 'rule', id: RULE_ID },
      { source: 'platform', id: 'G7' },
    ]);
    expect(verdict.handoff).toEqual([
      expect.objectContaining({ rule: { source: 'rule', id: HANDOFF_ID }, quote: 'Dava açacağım' }),
    ]);
    expect(verdict.dropped).toEqual([]);
  });

  it('drops a rule it was not given and a quote the text does not hold — naming the field, not the words', () => {
    const verdict = readJudgeReply(
      {
        ok: false,
        violations: [
          { rule_id: 'G99', quote: '2 saat' },
          { rule_id: 'G8', quote: 'kontrol ettim' },
          { rule_id: `rule:${HANDOFF_ID}`, quote: '2 saat içinde gelir' },
        ],
      },
      grounding,
    );
    expect(verdict.violations).toEqual([]);
    expect(verdict.handoff).toEqual([]);
    expect(verdict.dropped).toEqual([
      'a violations rule_id was not given',
      'violations quote for G8 is not in the reply',
      `violations quote for rule:${HANDOFF_ID} is not in the message`,
    ]);
  });
});
