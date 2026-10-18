import { describe, expect, it } from 'vitest';
import type { KnowledgeSource, Skill, SkillStep } from './types.js';
import { evaluateReadiness } from './readiness.js';

function src(chunk_count: number): Pick<KnowledgeSource, 'chunk_count'> {
  return { chunk_count };
}

function skill(steps: SkillStep[], active = true): Pick<Skill, 'steps' | 'active'> {
  return { steps, active };
}

const A_STEP: SkillStep = { type: 'send_message', source: 'text', text: 'Hi' };

describe('AI agent readiness', () => {
  it('is not ready and blocks activation when both knowledge and skills are empty', () => {
    const r = evaluateReadiness([], []);
    expect(r.ready).toBe(false);
    expect(r.hasKnowledge).toBe(false);
    expect(r.hasSkill).toBe(false);
    expect(r.reason).toBeTruthy();
  });

  it('is not ready with only knowledge and no runnable skill', () => {
    const r = evaluateReadiness([src(3)], []);
    expect(r.hasKnowledge).toBe(true);
    expect(r.hasSkill).toBe(false);
    expect(r.ready).toBe(false);
    expect(r.reason).toBeTruthy();
  });

  it('is not ready with only a runnable skill and no knowledge', () => {
    const r = evaluateReadiness([], [skill([A_STEP])]);
    expect(r.hasKnowledge).toBe(false);
    expect(r.hasSkill).toBe(true);
    expect(r.ready).toBe(false);
    expect(r.reason).toBeTruthy();
  });

  it('is ready with both indexed knowledge and a runnable skill', () => {
    const r = evaluateReadiness([src(3)], [skill([A_STEP])]);
    expect(r.ready).toBe(true);
    expect(r.reason).toBeNull();
  });

  it('treats an un-indexed (empty) source as no knowledge', () => {
    const r = evaluateReadiness([src(0)], [skill([A_STEP])]);
    expect(r.hasKnowledge).toBe(false);
    expect(r.ready).toBe(false);
  });

  it('treats a stepless skill as nothing to run', () => {
    const r = evaluateReadiness([src(3)], [skill([])]);
    expect(r.hasSkill).toBe(false);
    expect(r.ready).toBe(false);
  });

  it('does not count a skill with steps that is inactive', () => {
    const r = evaluateReadiness([src(3)], [skill([A_STEP], false)]);
    expect(r.hasSkill).toBe(false);
    expect(r.ready).toBe(false);
  });
});

describe('AI agent readiness — procedure skills (AI-03)', () => {
  const procedure = {
    steps: [{ id: 'sor', type: 'collect' as const, slots: ['yontem'] }],
    templates: [],
    handoff: { conditions: [], card_fields: [] },
    limits: { max_turns: 12 },
  };

  it('counts an active procedure as a runnable skill — its steps live in its definition', () => {
    const r = evaluateReadiness(
      [src(3)],
      [{ steps: [], active: true, mode: 'procedure', procedure }],
    );
    expect(r.hasSkill).toBe(true);
    expect(r.ready).toBe(true);
  });

  it('does not count a procedure with no steps, or one switched off', () => {
    const empty = { ...procedure, steps: [] };
    expect(
      evaluateReadiness(
        [src(3)],
        [{ steps: [], active: true, mode: 'procedure', procedure: empty }],
      ).hasSkill,
    ).toBe(false);
    expect(
      evaluateReadiness([src(3)], [{ steps: [], active: false, mode: 'procedure', procedure }])
        .hasSkill,
    ).toBe(false);
  });
});
