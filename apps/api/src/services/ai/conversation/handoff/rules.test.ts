/**
 * The workspace's hand-over rules, pure (tm 303.3 · AI-09, K9): the words a
 * topic and a phrase match, the first rule in order, routing. Through the
 * engine: `../handoff-turn.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import { HANDOFF_RULE_TOPICS, type HandoffReason } from '@siyahtus/types';
import {
  holdsPhrase,
  inputRule,
  mentionsTopic,
  morePressing,
  procedureRule,
  routingRule,
  ruleTarget,
  type HandoffRuleConfig,
} from './rules.js';

function rule(
  id: string,
  trigger: HandoffRuleConfig['trigger'],
  target: HandoffRuleConfig['target'] = null,
): HandoffRuleConfig {
  return { id, title: id, trigger, target, priority: 'normal' };
}

const NO_INPUT = { text: '', activeProcedureId: null, riskFlags: [] };

describe('topics', () => {
  it.each([
    ['deposit', 'Param yatmadı'],
    ['deposit', 'dün 500 TL yatırdım görünmüyor'],
    ['deposit', 'My deposit is missing'],
    ['withdrawal', 'Çekim talebim ne oldu?'],
    ['withdrawal', 'I cannot withdraw my winnings'],
    ['account_recovery', 'Şifremi unuttum'],
    ['account_recovery', 'hesabıma giremiyorum'],
    ['account_recovery', "I can't log in"],
    ['bonus', 'Free spin hakkım nerede'],
    ['verification', 'Kimlik belgemi nereye yükleyeceğim'],
  ] as const)('%s: “%s”', (topic, text) => {
    expect(mentionsTopic(text, topic)).toBe(true);
  });

  it('a message about something else names none of them', () => {
    for (const topic of HANDOFF_RULE_TOPICS) {
      expect(mentionsTopic('merhaba, nasılsınız', topic)).toBe(false);
    }
  });

  it('a word is matched from its start, not inside another word', () => {
    // "kapandı" holds "pan" inside, not at its start; "bonusum" starts with "bonus".
    expect(holdsPhrase('ödeme kapandı', 'pan')).toBe(false);
    expect(mentionsTopic('superbonus geldi', 'bonus')).toBe(false);
    expect(mentionsTopic('bonusum yüklenmedi', 'bonus')).toBe(true);
  });
});

describe('phrases', () => {
  it('case, Turkish letters, punctuation and word endings do not matter', () => {
    expect(holdsPhrase('ŞİFREMİ SIFIRLAMAK istiyorum!', 'şifre sıfırla')).toBe(true);
    expect(holdsPhrase('Paramı, yatırdım.', 'para yatır')).toBe(true);
  });

  it('the words in a row, in their order', () => {
    expect(holdsPhrase('yatırdım param', 'para yatır')).toBe(false);
    expect(holdsPhrase('para hemen yatırdım', 'para yatır')).toBe(false);
  });

  it('a phrase of no words matches nothing', () => {
    expect(holdsPhrase('her şey', '!!!')).toBe(false);
  });
});

describe('the first rule in order', () => {
  const phrase = rule('phrase', { type: 'phrase', value: 'para yatır' });
  const topic = rule('topic', { type: 'topic', value: 'deposit' });
  const flag = rule('flag', { type: 'risk_flag', value: 'fraud_suspected' });
  const procedure = rule('procedure', { type: 'procedure', value: 'skill-1' });
  const routing = rule('routing', { type: 'ai_unresolved', value: null });

  it('the input: the first matching firing rule, whatever its kind', () => {
    const input = { text: 'paramı yatırdım', activeProcedureId: null, riskFlags: [] };
    expect(inputRule([phrase, topic], input)?.id).toBe('phrase');
    expect(inputRule([topic, phrase], input)?.id).toBe('topic');
    expect(inputRule([routing], input)).toBeNull();
  });

  it('a risk flag the conversation carries; the procedure in progress', () => {
    expect(inputRule([flag], { ...NO_INPUT, riskFlags: ['fraud_suspected'] })?.id).toBe('flag');
    expect(inputRule([flag], { ...NO_INPUT, riskFlags: ['abusive'] })).toBeNull();
    expect(inputRule([procedure], { ...NO_INPUT, activeProcedureId: 'skill-1' })?.id).toBe(
      'procedure',
    );
    expect(inputRule([procedure], { ...NO_INPUT, activeProcedureId: 'skill-2' })).toBeNull();
  });

  it('the procedure the understanding named', () => {
    expect(procedureRule([topic, procedure], 'skill-1')?.id).toBe('procedure');
    expect(procedureRule([procedure], 'skill-2')).toBeNull();
    expect(procedureRule([procedure], null)).toBeNull();
  });
});

describe('routing', () => {
  const unresolved = rule('unresolved', { type: 'ai_unresolved', value: null }, { group_id: 4 });
  const asked = rule('asked', { type: 'player_request', value: null }, { topic: 'general' });

  it.each([
    'no_knowledge',
    'not_understood',
    'loop_detected',
    'max_turns',
    'missing_required_info',
    'player_said_unresolved',
    'unsupported_language',
    'ai_failure',
  ] as const)('"AI çözemedi" routes %s', (reason) => {
    expect(routingRule([unresolved], [reason])?.id).toBe('unresolved');
  });

  it.each(['guardrail_rg', 'negative_sentiment', 'risk_flag', 'procedure_rule'] as const)(
    '"AI çözemedi" does not route %s',
    (reason: HandoffReason) => {
      expect(routingRule([unresolved], [reason])).toBeNull();
    },
  );

  it('a person asked for; the first that applies; never a rule-made hand-over', () => {
    expect(routingRule([unresolved, asked], ['player_request'])?.id).toBe('asked');
    expect(routingRule([asked, unresolved], ['player_request', 'no_knowledge'])?.id).toBe('asked');
    expect(routingRule([unresolved, asked], ['player_request', 'no_knowledge'])?.id).toBe(
      'unresolved',
    );
    expect(routingRule([unresolved, asked], ['tenant_rule', 'player_request'])).toBeNull();
  });

  it('the target as the side effect carries it; the more pressing priority', () => {
    expect(ruleTarget(unresolved)).toEqual({ groupId: 4 });
    expect(ruleTarget(asked)).toEqual({ topic: 'general' });
    expect(ruleTarget(rule('none', { type: 'ai_unresolved', value: null }))).toEqual({});
    expect(morePressing('normal', 'high')).toBe('high');
    expect(morePressing('urgent', 'high')).toBe('urgent');
    expect(morePressing('high', 'normal')).toBe('high');
  });
});
