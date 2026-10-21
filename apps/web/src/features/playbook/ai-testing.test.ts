/**
 * The Test tab's form ↔ body conversion and its refusal reading (tm 314.5 ·
 * AI-19): the editor's body is the one the API validator accepts, a hand-over's
 * own expectations travel only with a hand-over, and a 400's problems find
 * their fields.
 */
import { validateAiTestScenario } from '@siyahtus/types';
import { describe, expect, it } from 'vitest';
import { ApiClientError } from '../../lib/api-client.js';
import {
  expectationsOf,
  factValueOf,
  isOpenRun,
  isoMomentOf,
  localMomentOf,
  problemAt,
  problemsOf,
  scenarioBody,
  scenarioFormOf,
  type TestScenario,
} from './ai-testing.js';

const PAPARA: TestScenario = {
  id: '11111111-1111-4111-8111-111111111111',
  ai_agent_id: '22222222-2222-4222-8222-222222222222',
  brand_id: null,
  name: 'Papara yatırım geçmedi',
  mode: 'scripted',
  persona: 'normal',
  language: 'tr',
  simulated_now: '2026-10-18T10:42:00.000Z',
  goal: null,
  turns: ['Yatırımım geçmedi', 'Papara', '2500 TL, 10:00', 'dekont.pdf'],
  facts: { yontem: 'Papara', tutar: 2500 },
  tool_outputs: {},
  expectations: {
    outcome: 'handoff',
    max_turns: 6,
    team_id: 4,
    topic: 'finance',
    required_slots: ['yontem', 'saat', 'talep', 'dekont'],
    forbidden_phrases: ['kesin yüklenecek'],
    must_not_flags: ['rg_signal'],
  },
  active: true,
  origin: 'manual',
  origin_ref: null,
  created_by: null,
  created_at: '2026-10-18T10:00:00.000Z',
  updated_at: '2026-10-18T10:00:00.000Z',
};

describe('the scenario form', () => {
  it('opens a stored scenario and saves it back unchanged', () => {
    const { body, problems } = scenarioBody(scenarioFormOf(PAPARA));

    expect(problems).toEqual([]);
    expect(body).toEqual({
      name: PAPARA.name,
      mode: 'scripted',
      persona: 'normal',
      language: 'tr',
      simulated_now: PAPARA.simulated_now,
      goal: null,
      turns: PAPARA.turns,
      facts: { yontem: 'Papara', tutar: 2500 },
      tool_outputs: {},
      expectations: PAPARA.expectations,
      active: true,
    });
  });

  it('starts a new scenario scripted, in the given language, with one empty line the validator refuses', () => {
    const form = scenarioFormOf(null, 'en');
    expect(form).toMatchObject({
      mode: 'scripted',
      language: 'en',
      turns: [''],
      outcome: 'resolved',
    });

    const { problems } = scenarioBody(form);
    expect(problems).toEqual(
      expect.arrayContaining([
        { field: 'name', code: 'required' },
        { field: 'turns[0]', code: 'required' },
      ]),
    );
  });

  it('refuses exactly what the API validator refuses', () => {
    const form = { ...scenarioFormOf(PAPARA), maxTurns: '99', language: 'turkish' };
    const { body, problems } = scenarioBody(form);
    expect(problems).toEqual(validateAiTestScenario(body));
    expect(problems).toEqual(
      expect.arrayContaining([
        { field: 'language', code: 'invalid' },
        { field: 'expectations.max_turns', code: 'out_of_range' },
      ]),
    );
  });

  it('drops a hand-over’s team, topic and reason once the outcome is not a hand-over', () => {
    const form = { ...scenarioFormOf(PAPARA), outcome: 'resolved' as const, reasonCode: 'late' };
    const expectations = expectationsOf(form);
    expect(expectations).not.toHaveProperty('team_id');
    expect(expectations).not.toHaveProperty('topic');
    expect(expectations).not.toHaveProperty('reason_code');
    expect(scenarioBody(form).problems).toEqual([]);
  });

  it('keeps a simulated player’s opening lines only when it has some, and asks it for a goal', () => {
    const form = {
      ...scenarioFormOf(null),
      name: 'Sim',
      mode: 'simulated' as const,
      turns: ['  '],
    };
    const { body, problems } = scenarioBody(form);
    expect(body['turns']).toEqual([]);
    expect(problems).toEqual([{ field: 'goal', code: 'required' }]);
  });

  it('reads tool outputs as JSON and says so when they are not', () => {
    const good = { ...scenarioFormOf(PAPARA), toolOutputs: '{"bakiye": {"tutar": 10}}' };
    expect(scenarioBody(good).body['tool_outputs']).toEqual({ bakiye: { tutar: 10 } });

    const bad = { ...scenarioFormOf(PAPARA), toolOutputs: '{not json' };
    expect(scenarioBody(bad).problems).toContainEqual({ field: 'tool_outputs', code: 'invalid' });
  });

  it('reads a fact as a number or a yes/no where it reads as one', () => {
    expect(factValueOf('2500')).toBe(2500);
    expect(factValueOf('-1.5')).toBe(-1.5);
    expect(factValueOf('true')).toBe(true);
    expect(factValueOf('Papara')).toBe('Papara');
    expect(factValueOf('2500 TL')).toBe('2500 TL');
  });

  it('round-trips the frozen clock through the browser’s local time', () => {
    const local = localMomentOf('2026-10-18T10:42:00.000Z');
    expect(local).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    expect(isoMomentOf(local)).toBe('2026-10-18T10:42:00.000Z');
    expect(isoMomentOf('')).toBeNull();
    expect(localMomentOf(null)).toBe('');
  });
});

describe('refusals and runs', () => {
  it('reads the problems of a 400 and finds them by field', () => {
    const error = new ApiClientError({
      type: 'validation',
      status: 400,
      message: 'refused',
      requestId: 'r',
      details: {
        problems: [
          { field: 'turns[1]', code: 'too_long' },
          { field: 'expectations.values.yontem', code: 'invalid' },
          { field: 'x', code: 'not-a-code' },
        ],
      },
    });
    const problems = problemsOf(error);
    expect(problems).toHaveLength(2);
    expect(problemAt(problems, 'turns[1]')).toBe('too_long');
    expect(problemAt(problems, 'turns')).toBe('too_long');
    expect(problemAt(problems, 'expectations.values')).toBe('invalid');
    expect(problemAt(problems, 'name')).toBeNull();
    expect(problemsOf(new Error('x'))).toEqual([]);
  });

  it('counts a queued or running run as open', () => {
    expect(isOpenRun({ status: 'queued' })).toBe(true);
    expect(isOpenRun({ status: 'running' })).toBe(true);
    expect(isOpenRun({ status: 'completed' })).toBe(false);
    expect(isOpenRun({ status: 'failed' })).toBe(false);
  });
});
