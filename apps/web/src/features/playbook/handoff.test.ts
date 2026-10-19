/**
 * What the hand-over screen decides without drawing (tm 303.5 · AI-09): the
 * sentence a refusal gets, the body a rule form sends, what a new order sends,
 * and which counts the triggers card refuses.
 */
import { DEFAULT_HANDOFF_TRIGGERS } from '@siyahtus/types';
import { describe, expect, it } from 'vitest';
import { ApiClientError } from '../../lib/api-client.js';
import {
  BLANK_RULE_DRAFT,
  afterHoursChanged,
  draftOfRule,
  exampleBody,
  exampleInstalled,
  handoffErrorKey,
  messagesChange,
  messagesFormOf,
  reorderedIds,
  resolutionProblem,
  ruleBody,
  ruleDraftProblems,
  triggersBody,
  triggersFormChanged,
  triggersFormOf,
  triggersProblems,
  type HandoffRule,
  type HandoffRuleExampleRow,
  type HandoffSettings,
} from './handoff.js';

function settings(over: Partial<HandoffSettings> = {}): HandoffSettings {
  return {
    ai_agent_id: 'agent-1',
    assignment_mode: 'parallel',
    ai_stall_timeout_seconds: 60,
    triggers: structuredClone(DEFAULT_HANDOFF_TRIGGERS) as HandoffSettings['triggers'],
    messages: {},
    after_hours: { text: null },
    resolution_criteria: null,
    ...over,
  };
}

function rule(id: string, over: Partial<HandoffRule> = {}): HandoffRule {
  return {
    id,
    ai_agent_id: 'agent-1',
    position: 1,
    active: true,
    title: `Rule ${id}`,
    trigger: { type: 'topic', value: 'deposit' },
    target: { topic: 'finance' },
    priority: 'high',
    ...over,
  };
}

function refusal(details: Record<string, unknown>): ApiClientError {
  return new ApiClientError({
    type: 'validation',
    status: 400,
    message: 'raw english from the server',
    requestId: 'r-1',
    details,
  });
}

describe('handoffErrorKey (AI-09)', () => {
  it('words each refusal the hand-over routes name', () => {
    for (const reason of [
      'handoff_trigger_locked',
      'handoff_rule_unknown_procedure',
      'handoff_rule_unknown_team',
      'handoff_rules_order_mismatch',
      'handoff_rules_limit',
    ]) {
      expect(handoffErrorKey(refusal({ reason }))).toBe(`playbook.handoff.error.${reason}`);
    }
  });

  it('falls back to the generic sentence for a reason it does not know', () => {
    expect(handoffErrorKey(refusal({ reason: 'something_new' }))).toBe('common.errors.validation');
    expect(handoffErrorKey(new Error('x'))).toBe('common.errors.unknown');
  });
});

describe('resolutionProblem (AI-09)', () => {
  it('reads the procedure problem a refused criteria carries', () => {
    const details = {
      reason: 'procedure_bad_condition',
      section: 'handoff',
      field: 'resolution_criteria',
    };
    expect(resolutionProblem(refusal(details))).toStrictEqual(details);
  });

  it('is null for any other refusal', () => {
    expect(resolutionProblem(refusal({ reason: 'handoff_rules_limit' }))).toBeNull();
    expect(
      resolutionProblem(
        refusal({ reason: 'procedure_bad_condition', section: 'steps', field: 'when' }),
      ),
    ).toBeNull();
    expect(resolutionProblem(new Error('x'))).toBeNull();
  });
});

describe('reorderedIds (AI-09)', () => {
  const rules = [rule('a'), rule('b'), rule('c')];

  it('moves a rule and sends every id once', () => {
    expect(reorderedIds(rules, 0, 2)).toStrictEqual(['b', 'c', 'a']);
    expect(reorderedIds(rules, 2, 1)).toStrictEqual(['a', 'c', 'b']);
  });

  it('leaves the order alone for a move off either end', () => {
    expect(reorderedIds(rules, 0, -1)).toStrictEqual(['a', 'b', 'c']);
    expect(reorderedIds(rules, 2, 3)).toStrictEqual(['a', 'b', 'c']);
  });
});

describe('the rule form (AI-09)', () => {
  it('reads a rule into a draft and back into the body it was made from', () => {
    const stored = rule('a', { target: { group_id: 4 }, priority: 'urgent' });
    expect(ruleBody(draftOfRule(stored))).toStrictEqual({
      title: 'Rule a',
      trigger: { type: 'topic', value: 'deposit' },
      target: { group_id: 4 },
      priority: 'urgent',
    });
  });

  it('sends no value for the two triggers that take none, and no target for the usual routing', () => {
    const body = ruleBody({
      ...BLANK_RULE_DRAFT,
      title: ' AI could not solve it ',
      triggerType: 'ai_unresolved',
      triggerValue: 'left over from a topic',
    });
    expect(body).toStrictEqual({
      title: 'AI could not solve it',
      trigger: { type: 'ai_unresolved', value: null },
      target: null,
      priority: 'normal',
    });
  });

  it('holds a draft to what the API takes, one problem per fault', () => {
    expect(ruleDraftProblems({ ...BLANK_RULE_DRAFT, title: 'Deposits' })).toStrictEqual([]);
    expect(ruleDraftProblems(BLANK_RULE_DRAFT)).toStrictEqual([
      'playbook.handoff.rules.problem.titleEmpty',
    ]);
    expect(ruleDraftProblems({ ...BLANK_RULE_DRAFT, title: 'x'.repeat(81) })).toStrictEqual([
      'playbook.handoff.rules.problem.titleLong',
    ]);
    expect(
      ruleDraftProblems({
        ...BLANK_RULE_DRAFT,
        title: 'a',
        triggerType: 'phrase',
        triggerValue: ' ',
      }),
    ).toStrictEqual(['playbook.handoff.rules.problem.phraseEmpty']);
    expect(
      ruleDraftProblems({
        ...BLANK_RULE_DRAFT,
        title: 'a',
        triggerType: 'procedure',
        triggerValue: '',
      }),
    ).toStrictEqual(['playbook.handoff.rules.problem.procedureEmpty']);
    expect(
      ruleDraftProblems({ ...BLANK_RULE_DRAFT, title: 'a', targetKind: 'team', groupId: '' }),
    ).toStrictEqual(['playbook.handoff.rules.problem.teamEmpty']);
    expect(
      ruleDraftProblems({
        ...BLANK_RULE_DRAFT,
        title: 'a',
        targetKind: 'topic',
        topic: 'Finance!',
      }),
    ).toStrictEqual(['playbook.handoff.rules.problem.topicBad']);
  });
});

describe('the ready-made rules (AI-09)', () => {
  const example: HandoffRuleExampleRow = {
    key: 'deposit',
    title: { tr: 'Para yatırma', en: 'Deposits' },
    trigger: { type: 'topic', value: 'deposit' },
    target: { topic: 'finance' },
    priority: 'high',
  };

  it('posts the example in the console’s language', () => {
    expect(exampleBody(example, 'tr').title).toBe('Para yatırma');
    expect(exampleBody(example, 'en')).toStrictEqual({
      title: 'Deposits',
      trigger: { type: 'topic', value: 'deposit' },
      target: { topic: 'finance' },
      priority: 'high',
    });
  });

  it('counts an example as added once a rule has its trigger', () => {
    expect(exampleInstalled(example, [])).toBe(false);
    expect(exampleInstalled(example, [rule('a')])).toBe(true);
    expect(
      exampleInstalled(example, [rule('a', { trigger: { type: 'topic', value: 'bonus' } })]),
    ).toBe(false);
  });
});

describe('the triggers form (AI-09)', () => {
  it('is clean as read and changed once a count moves', () => {
    const stored = settings();
    const form = triggersFormOf(stored);
    expect(triggersFormChanged(form, stored)).toBe(false);
    expect(triggersProblems(form)).toStrictEqual([]);
    form.triggers.max_turns.turns = 20;
    expect(triggersFormChanged(form, stored)).toBe(true);
  });

  it('refuses a count outside its bounds, an emptied box and a non-whole number', () => {
    const form = triggersFormOf(settings({ assignment_mode: 'ai_first' }));
    form.triggers.not_understood.turns = 0;
    form.triggers.negative_sentiment.consecutive = Number.NaN;
    form.triggers.abuse.warnings = 6;
    form.triggers.max_turns.turns = 1.5;
    form.stallSeconds = 10;
    expect(triggersProblems(form)).toStrictEqual([
      'notUnderstoodTurns',
      'negativeConsecutive',
      'abuseWarnings',
      'maxTurns',
      'stallSeconds',
    ]);
  });

  it('judges the wait only while the agent answers first', () => {
    const form = triggersFormOf(settings({ assignment_mode: 'parallel' }));
    form.stallSeconds = 1;
    expect(triggersProblems(form)).toStrictEqual([]);
    expect(triggersBody(form)).not.toHaveProperty('ai_stall_timeout_seconds');
    expect(triggersFormChanged(form, settings({ assignment_mode: 'parallel' }))).toBe(false);
    expect(triggersBody({ ...form, assignmentMode: 'ai_first', stallSeconds: 90 })).toMatchObject({
      assignment_mode: 'ai_first',
      ai_stall_timeout_seconds: 90,
    });
  });
});

describe('the messages form (AI-09)', () => {
  it('sends only the reasons whose sentence changed, and null for a cleared one', () => {
    const stored = settings({ messages: { abuse: 'Please be kind.', ai_failure: 'Sorry.' } });
    const form = messagesFormOf(stored);
    expect(messagesChange(form, stored)).toStrictEqual({});
    form.abuse = '   ';
    form.not_understood = ' We will find someone. ';
    expect(messagesChange(form, stored)).toStrictEqual({
      abuse: null,
      not_understood: 'We will find someone.',
    });
  });

  it('notices the after-hours text only when it changed', () => {
    expect(afterHoursChanged('', settings())).toBe(false);
    expect(afterHoursChanged(' Back at 9. ', settings())).toBe(true);
    expect(afterHoursChanged('Back at 9.', settings({ after_hours: { text: 'Back at 9.' } }))).toBe(
      false,
    );
  });
});
