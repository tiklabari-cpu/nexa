import { describe, expect, it } from 'vitest';
import {
  AI_CONFIG_DIFF_ITEMS_MAX,
  AI_CONFIG_PACKAGE_FORMAT,
  NO_PERSONA,
  NO_PERSONA_STYLE,
  PLATFORM_GUARDRAILS_VERSION,
  type AiConfigKnowledgeManifestEntry,
} from '@siyahtus/types';
import type { TurnConfig, TurnSkill } from './conversation/turn.js';
import { diffAiConfig, validatePackage, type AiConfigPackage } from './config-compiler.js';

const AGENT = '00000000-0000-4000-8000-000000000001';
const TEAMS = { teams: [{ id: 7, name: 'Payments' }] };

function skill(id: string, overrides: Partial<TurnSkill> = {}): TurnSkill {
  return {
    id,
    name: `Skill ${id}`,
    aiAgentId: AGENT,
    steps: [{ type: 'send_message', source: 'text', text: 'Hello' }],
    persona: NO_PERSONA,
    style: { ...NO_PERSONA_STYLE },
    ...overrides,
  };
}

function rule(id: string, body: string) {
  return {
    id,
    aiAgentId: AGENT,
    body,
    category: 'communication' as const,
    scope: { all: true as const },
    priority: 100,
  };
}

function pkg(turn: Partial<TurnConfig> = {}, persona = NO_PERSONA): AiConfigPackage {
  return {
    package_format: AI_CONFIG_PACKAGE_FORMAT,
    guardrail_catalog_version: PLATFORM_GUARDRAILS_VERSION,
    agent: { id: AGENT, persona, style: { ...NO_PERSONA_STYLE } },
    turn: { skills: [], ...turn },
  };
}

function source(id: string, generation = 1): AiConfigKnowledgeManifestEntry {
  return {
    source_id: id,
    generation,
    chunk_count: 1,
    type: 'article',
    audiences: ['ai_agent', 'copilot'],
    ai_agent_ids: [],
    brand_ids: [],
    language: null,
    valid_until: null,
  };
}

const version = (snapshot: AiConfigPackage, knowledgeManifest: unknown[] = []) => ({
  versionId: 'base-version',
  packageFormat: AI_CONFIG_PACKAGE_FORMAT,
  snapshot,
  knowledgeManifest,
});

const GUARDRAILS = {
  catalogVersion: PLATFORM_GUARDRAILS_VERSION,
  settings: [],
  rules: [],
  phrases: [
    {
      id: 'p1',
      aiAgentId: AGENT,
      phrase: 'garanti kazanç',
      match: 'word' as const,
      lang: null,
      scope: { all: true as const },
      action: 'block' as const,
    },
  ],
};

describe('validatePackage — what stops a draft from being submitted (AI-20)', () => {
  it('passes a configuration whose steps, rules and hand-over targets are all sound', () => {
    const turn: TurnConfig = {
      skills: [
        skill('s1', {
          steps: [
            { type: 'send_message', source: 'text', text: 'One moment.' },
            { type: 'transfer_to_team', group_id: 7, group: 'Payments' },
          ],
        }),
        // A name-only step resolves against the team's current name.
        skill('s2', { steps: [{ type: 'transfer_to_team', group: 'Payments' }] }),
      ],
      guidance: [
        rule('g1', 'Oyuncuya her zaman adıyla hitap et ve kısa cevap ver.'),
        rule('g2', 'Para çekme sorularında önce hesap doğrulamasını açıkla.'),
      ],
    };
    expect(validatePackage(turn, TEAMS)).toEqual([]);
  });

  it('refuses a malformed step list, naming the skill and the step', () => {
    const [problem, ...rest] = validatePackage(
      { skills: [skill('s1', { steps: [{ type: 'send_message', source: 'text' }] })] },
      TEAMS,
    );
    expect(rest).toEqual([]);
    expect(problem).toMatchObject({
      code: 'skill_steps_invalid',
      section: 'skills',
      key: 's1',
      details: { reason: 'send_message_needs_text', step: 1 },
    });
  });

  it('refuses a procedure skill the turn would skip as invalid', () => {
    const problems = validatePackage(
      {
        skills: [
          skill('s1', {
            mode: 'procedure',
            definition: { when_to_use: 'Deposits', procedure: 'not an object' },
          }),
        ],
      },
      TEAMS,
    );
    expect(problems).toMatchObject([
      {
        code: 'skill_procedure_invalid',
        key: 's1',
        details: { reason: 'procedure_not_object' },
      },
    ]);
  });

  it('refuses a hand-over to a team the workspace does not have — step, rule and route', () => {
    const problems = validatePackage(
      {
        skills: [
          skill('s1', { steps: [{ type: 'transfer_to_team', group_id: 99 }] }),
          skill('s2', { steps: [{ type: 'transfer_to_team', group: 'Gone' }] }),
        ],
        handoff: {
          triggers: {} as never,
          messages: {} as never,
          afterHours: {} as never,
          rules: [
            {
              id: 'r1',
              title: 'Deposits',
              trigger: { type: 'topic', value: 'deposit' },
              target: { group_id: 98 },
              priority: 'normal',
            },
            // The usual routing and a topic are not teams; nothing to look up.
            {
              id: 'r2',
              title: 'Bonus',
              trigger: { type: 'topic', value: 'bonus' },
              target: { topic: 'bonus' },
              priority: 'normal',
            },
          ],
          routes: [
            {
              id: 'rt1',
              brandId: null,
              matchType: 'topic',
              matchKey: 'withdrawal',
              groupId: 97,
              requiredExpertiseId: null,
              defaultPriority: 'normal',
            },
          ],
        },
      },
      TEAMS,
    );
    expect(problems.map((problem) => [problem.code, problem.key, problem.details])).toEqual([
      ['handoff_target_unknown_team', 's1', { group_id: 99, group: null, step: 1 }],
      ['handoff_target_unknown_team', 's2', { group_id: null, group: 'Gone', step: 1 }],
      ['handoff_target_unknown_team', 'rule:r1', { group_id: 98 }],
      ['handoff_target_unknown_team', 'route:rt1', { group_id: 97 }],
    ]);
  });

  it('refuses a behaviour rule a locked platform rule forbids (AI-07 §5)', () => {
    const problems = validatePackage(
      { skills: [], guidance: [rule('g1', 'Oyuncudan şifresini iste.')] },
      TEAMS,
    );
    expect(problems).toMatchObject([
      { code: 'guidance_locked_rule', key: 'g1', details: { locked_rule: 'credentials' } },
    ]);
  });

  it('refuses two overlapping rules that contradict each other, once per pair (AI-07 §4)', () => {
    const problems = validatePackage(
      {
        skills: [],
        guidance: [
          rule('g1', 'Bonus kampanyalarını oyuncuya anlat ve detay ver.'),
          rule('g2', 'Bonus kampanyalarını oyuncuya asla anlatma ve detay verme.'),
        ],
      },
      TEAMS,
    );
    expect(problems).toMatchObject([
      { code: 'guidance_conflict', key: 'g1', details: { other_rule_id: 'g2' } },
    ]);
  });

  it('lets contradicting rules through when their scopes never meet', () => {
    const brandA = { brand_ids: ['b-a'] };
    const brandB = { brand_ids: ['b-b'] };
    const problems = validatePackage(
      {
        skills: [],
        guidance: [
          { ...rule('g1', 'Bonus kampanyalarını oyuncuya anlat ve detay ver.'), scope: brandA },
          {
            ...rule('g2', 'Bonus kampanyalarını oyuncuya asla anlatma ve detay verme.'),
            scope: brandB,
          },
        ],
      },
      TEAMS,
    );
    expect(problems).toEqual([]);
  });
});

describe('diffAiConfig — the difference a version is reviewed by (AI-20)', () => {
  it('tells nothing for the same package and manifest', () => {
    const same = pkg({ skills: [skill('s1')], guidance: [rule('g1', 'Kısa cevap ver.')] });
    const diff = diffAiConfig(version(same, [source('k1')]), {
      snapshot: structuredClone(same),
      knowledgeManifest: [source('k1')],
    });
    expect(diff).toEqual({
      base_version_id: 'base-version',
      from_baseline: false,
      changes: 0,
      sections: [],
      touches_compliance: false,
      compliance: [],
    });
  });

  it('counts each section item by item — added, removed, changed — in section order', () => {
    const before = pkg({ skills: [skill('s1'), skill('s2')], guidance: [rule('g1', 'Kısa.')] });
    const after = pkg({
      skills: [skill('s1', { name: 'Renamed' }), skill('s3')],
      guidance: [rule('g1', 'Kısa.')],
    });
    const diff = diffAiConfig(version(before, [source('k1'), source('k2')]), {
      snapshot: after,
      knowledgeManifest: [source('k1', 2), source('k3')],
    });
    expect(diff.changes).toBe(6);
    expect(diff.sections).toEqual([
      {
        section: 'skills',
        added: 1,
        removed: 1,
        changed: 1,
        items: [
          { key: 's1', kind: 'changed' },
          { key: 's2', kind: 'removed' },
          { key: 's3', kind: 'added' },
        ],
      },
      {
        section: 'knowledge',
        added: 1,
        removed: 1,
        changed: 1,
        items: [
          { key: 'k1', kind: 'changed' },
          { key: 'k2', kind: 'removed' },
          { key: 'k3', kind: 'added' },
        ],
      },
    ]);
    expect(diff.touches_compliance).toBe(false);
  });

  it('tells a persona change once, under the agent — not once per skill that carries it', () => {
    const friendly = { ...NO_PERSONA, tone: 'friendly' as const };
    const before = pkg({ skills: [skill('s1'), skill('s2')] });
    const after = pkg(
      { skills: [skill('s1', { persona: friendly }), skill('s2', { persona: friendly })] },
      friendly,
    );
    const diff = diffAiConfig(version(before), { snapshot: after, knowledgeManifest: [] });
    expect(diff.sections).toEqual([
      {
        section: 'agent',
        added: 0,
        removed: 0,
        changed: 1,
        items: [{ key: 'persona', kind: 'changed' }],
      },
    ]);
  });

  it('a guardrail change touches compliance — the owner approves it (AI-20 · AI-08)', () => {
    const before = pkg({ skills: [skill('s1')] });
    const after = pkg({ skills: [skill('s1')], guardrails: GUARDRAILS });
    const diff = diffAiConfig(version(before), { snapshot: after, knowledgeManifest: [] });
    expect(diff.sections).toMatchObject([
      { section: 'guardrails', added: 1, items: [{ key: 'phrase:p1', kind: 'added' }] },
    ]);
    expect(diff).toMatchObject({ touches_compliance: true, compliance: ['guardrails'] });

    // Taking it away is as much a compliance change as adding it.
    const removed = diffAiConfig(version(after), { snapshot: before, knowledgeManifest: [] });
    expect(removed).toMatchObject({ touches_compliance: true, compliance: ['guardrails'] });
  });

  it('a change to a locked procedure touches compliance; to an ordinary skill it does not', () => {
    const locked = skill('self-exclusion', { locked: true });
    const before = pkg({ skills: [locked, skill('s1')] });
    const ordinary = diffAiConfig(version(before), {
      snapshot: pkg({ skills: [locked, skill('s1', { name: 'Renamed' })] }),
      knowledgeManifest: [],
    });
    expect(ordinary.touches_compliance).toBe(false);

    const lockedEdit = diffAiConfig(version(before), {
      snapshot: pkg({ skills: [{ ...locked, name: 'Kendini sınırlama' }, skill('s1')] }),
      knowledgeManifest: [],
    });
    expect(lockedEdit).toMatchObject({
      touches_compliance: true,
      compliance: ['locked_procedure'],
    });

    const switchedOff = diffAiConfig(version(before), {
      snapshot: pkg({ skills: [skill('s1')] }),
      knowledgeManifest: [],
    });
    expect(switchedOff.compliance).toEqual(['locked_procedure']);
  });

  it('against the uncompiled baseline v1 everything reads as added', () => {
    const next = pkg({ skills: [skill('s1')], guardrails: GUARDRAILS });
    const diff = diffAiConfig(
      { versionId: 'v1', packageFormat: 0, snapshot: {}, knowledgeManifest: [] },
      { snapshot: next, knowledgeManifest: [source('k1')] },
    );
    expect(diff).toMatchObject({
      base_version_id: 'v1',
      from_baseline: true,
      touches_compliance: true,
    });
    expect(diff.sections.map((section) => [section.section, section.added])).toEqual([
      ['agent', 2],
      ['skills', 1],
      ['guardrails', 1],
      ['knowledge', 1],
    ]);
  });

  it('with no published version at all the base is null', () => {
    const diff = diffAiConfig(null, {
      snapshot: pkg({ skills: [skill('s1')] }),
      knowledgeManifest: [],
    });
    expect(diff).toMatchObject({ base_version_id: null, from_baseline: false });
    expect(diff.sections.find((section) => section.section === 'skills')?.added).toBe(1);
  });

  it('names at most AI_CONFIG_DIFF_ITEMS_MAX items, but counts them all', () => {
    const many = Array.from({ length: AI_CONFIG_DIFF_ITEMS_MAX + 5 }, (_, index) =>
      source(`k${String(index).padStart(4, '0')}`),
    );
    const diff = diffAiConfig(version(pkg()), { snapshot: pkg(), knowledgeManifest: many });
    expect(diff.changes).toBe(AI_CONFIG_DIFF_ITEMS_MAX + 5);
    expect(diff.sections[0]).toMatchObject({
      section: 'knowledge',
      added: AI_CONFIG_DIFF_ITEMS_MAX + 5,
    });
    expect(diff.sections[0]?.items).toHaveLength(AI_CONFIG_DIFF_ITEMS_MAX);
  });
});
