/**
 * Choosing and laying out the behaviour rules (tm 299.1 · AI-07 §1–§3):
 * scope, order, the turn's budget, the layer order and the style warnings.
 */
import { describe, expect, it } from 'vitest';
import {
  GUIDANCE_TURN_CHARS_MAX,
  GUIDANCE_TURN_RULES_MAX,
  PROMPT_LAYERS,
  readPersonaStyle,
} from '@siyahtus/types';
import {
  guidanceLayer,
  guidanceRecord,
  inScope,
  mergeGuidanceRecords,
  orderGuidance,
  personaStyleLayer,
  renderLayers,
  selectGuidance,
  styleWarnings,
  type GuidanceRuleConfig,
} from './guidance.js';

function rule(id: string, extra: Partial<GuidanceRuleConfig> = {}): GuidanceRuleConfig {
  return {
    id,
    aiAgentId: 'agent-1',
    body: `Kural ${id}.`,
    category: 'communication',
    scope: { all: true },
    priority: 100,
    ...extra,
  };
}

describe('scope', () => {
  it('every conversation; a procedure only in its own turns; a brand only when the turn knows it', () => {
    expect(inScope({ all: true }, { aiAgentId: 'a', skillId: null })).toBe(true);
    expect(inScope({ skill_ids: ['s1'] }, { aiAgentId: 'a', skillId: 's1' })).toBe(true);
    expect(inScope({ skill_ids: ['s1'] }, { aiAgentId: 'a', skillId: 's2' })).toBe(false);
    expect(inScope({ skill_ids: ['s1'] }, { aiAgentId: 'a', skillId: null })).toBe(false);
    expect(inScope({ brand_ids: ['b1'] }, { aiAgentId: 'a', skillId: null, brandId: 'b1' })).toBe(
      true,
    );
    expect(inScope({ brand_ids: ['b1'] }, { aiAgentId: 'a', skillId: null })).toBe(false);
  });

  it('only the agent’s own rules; no agent, no rules', () => {
    const rules = [rule('mine'), rule('theirs', { aiAgentId: 'agent-2' })];
    expect(
      selectGuidance(rules, { aiAgentId: 'agent-1', skillId: null }).rules.map((r) => r.id),
    ).toEqual(['mine']);
    expect(selectGuidance(rules, { aiAgentId: null, skillId: null }).rules).toEqual([]);
  });
});

describe('order', () => {
  it('priority first (1 first), then prohibitions before style, then id', () => {
    const ordered = orderGuidance([
      rule('c', { priority: 5, category: 'communication' }),
      rule('b', { priority: 5, category: 'prohibition' }),
      rule('a', { priority: 9 }),
      rule('d', { priority: 1, category: 'other' }),
      rule('e', { priority: 5, category: 'prohibition' }),
    ]);
    expect(ordered.map((r) => r.id)).toEqual(['d', 'b', 'e', 'c', 'a']);
  });
});

describe('the turn’s budget (AI-07 §2)', () => {
  it(`at most ${GUIDANCE_TURN_RULES_MAX} rules: the lowest priorities are dropped`, () => {
    const rules = Array.from({ length: GUIDANCE_TURN_RULES_MAX + 2 }, (_, n) =>
      rule(`r${n}`, { priority: n + 1 }),
    );
    const selection = selectGuidance(rules, { aiAgentId: 'agent-1', skillId: null });
    expect(selection.rules).toHaveLength(GUIDANCE_TURN_RULES_MAX);
    expect(selection.dropped).toEqual([
      `r${GUIDANCE_TURN_RULES_MAX}`,
      `r${GUIDANCE_TURN_RULES_MAX + 1}`,
    ]);
  });

  it(`at most ${GUIDANCE_TURN_CHARS_MAX} characters: the rule that does not fit and every one after it go`, () => {
    const long = 'x'.repeat(2500);
    const rules = [
      rule('a', { priority: 1, body: long }),
      rule('b', { priority: 2, body: long }),
      rule('c', { priority: 3, body: long }),
      rule('d', { priority: 4, body: 'kısa' }),
    ];
    const selection = selectGuidance(rules, { aiAgentId: 'agent-1', skillId: null });
    expect(selection.rules.map((r) => r.id)).toEqual(['a', 'b']);
    expect(selection.dropped).toEqual(['c', 'd']);
    expect(guidanceRecord(selection)).toEqual({
      rule_ids: ['a', 'b'],
      truncated: { dropped: 2, rule_ids: ['c', 'd'] },
    });
  });

  it('no rule in scope is no record', () => {
    expect(guidanceRecord({ rules: [], dropped: [] })).toBeNull();
  });

  it('two calls of one turn make one record; a rule one call dropped and the other carried is carried', () => {
    expect(
      mergeGuidanceRecords(
        { rule_ids: ['a'], truncated: { dropped: 1, rule_ids: ['b'] } },
        { rule_ids: ['a', 'b'] },
      ),
    ).toEqual({ rule_ids: ['a', 'b'] });
    expect(mergeGuidanceRecords(undefined, null)).toBeUndefined();
  });
});

describe('the layers (AI-07 §1)', () => {
  it('render in the fixed order whatever order they are given in, after the precedence line', () => {
    const lines = renderLayers([
      { key: 'persona', lines: ['P'] },
      { key: 'guidance', lines: ['G'] },
      { key: 'platform_locked', lines: ['L'] },
    ]);
    expect(lines[0]).toContain('Where two conflict, the earlier one wins.');
    expect(lines.slice(1)).toEqual([
      'Platform rules (locked):',
      'L',
      "The business's rules for how you behave:",
      'G',
      'Persona:',
      'P',
    ]);
    expect(PROMPT_LAYERS.indexOf('guidance')).toBeLessThan(PROMPT_LAYERS.indexOf('persona'));
    expect(PROMPT_LAYERS.indexOf('step')).toBeLessThan(PROMPT_LAYERS.indexOf('guidance'));
  });

  it('empty layers render nothing — the prompt stays what it was', () => {
    expect(renderLayers([guidanceLayer([]), personaStyleLayer(null)])).toEqual([]);
  });

  it('a rule is one line, its whitespace flattened', () => {
    expect(guidanceLayer([rule('a', { body: 'Bir\n  iki.' })]).lines).toEqual(['- Bir iki.']);
  });

  it('the style says how to address and whether to use emoji', () => {
    expect(
      personaStyleLayer(readPersonaStyle({ addressForm: 'siz', emoji: 'none' })).lines,
    ).toEqual([
      'Address the customer formally: in Turkish with "siz", never "sen".',
      'Use no emoji.',
    ]);
    expect(personaStyleLayer(readPersonaStyle({ addressForm: 'sen', emoji: 'few' })).lines).toEqual(
      [
        'Address the customer informally: in Turkish with "sen", not "siz".',
        'An emoji or two where it fits; never more.',
      ],
    );
  });
});

describe('style warnings (AI-07 §3)', () => {
  const siz = readPersonaStyle({ addressForm: 'siz', emoji: 'none' });
  it('an emoji under "none", more than two under "few"', () => {
    expect(styleWarnings('Tamam 👍', siz)).toEqual(['emoji']);
    expect(styleWarnings('Tamam 👍👍', readPersonaStyle({ emoji: 'few' }))).toEqual([]);
    expect(styleWarnings('Tamam 👍👍👍', readPersonaStyle({ emoji: 'few' }))).toEqual(['emoji']);
  });

  it('a familiar pronoun under "siz", a formal one under "sen" — pronouns only', () => {
    expect(styleWarnings('Sana yardımcı olayım.', siz)).toEqual(['address_form']);
    expect(styleWarnings('Size yardımcı olayım.', siz)).toEqual([]);
    expect(styleWarnings('Senaryo hazır.', siz)).toEqual([]);
    expect(
      styleWarnings('Size yardımcı olayım.', readPersonaStyle({ addressForm: 'sen' })),
    ).toEqual(['address_form']);
  });

  it('no style, no warning', () => {
    expect(styleWarnings('Sana 👍', undefined)).toEqual([]);
  });
});
