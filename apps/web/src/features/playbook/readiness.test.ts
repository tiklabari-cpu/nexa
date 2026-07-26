import { describe, expect, it } from 'vitest';
import type { KnowledgeSource, Skill, SkillStep } from './types.js';
import { evaluateReadiness } from './readiness.js';

function src(chunk_count: number): Pick<KnowledgeSource, 'chunk_count'> {
  return { chunk_count };
}

function skill(steps: SkillStep[]): Pick<Skill, 'steps'> {
  return { steps };
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

  it('treats an un-indexed (empty) source as no knowledge', () => {
    const r = evaluateReadiness([src(0)], []);
    expect(r.hasKnowledge).toBe(false);
    expect(r.ready).toBe(false);
  });

  it('treats a stepless skill as nothing to run', () => {
    const r = evaluateReadiness([], [skill([])]);
    expect(r.hasSkill).toBe(false);
    expect(r.ready).toBe(false);
  });

  it('is ready with indexed knowledge alone', () => {
    const r = evaluateReadiness([src(3)], []);
    expect(r.ready).toBe(true);
    expect(r.reason).toBeNull();
  });

  it('is ready with a skill that has steps alone', () => {
    const r = evaluateReadiness([], [skill([A_STEP])]);
    expect(r.ready).toBe(true);
    expect(r.reason).toBeNull();
  });
});
