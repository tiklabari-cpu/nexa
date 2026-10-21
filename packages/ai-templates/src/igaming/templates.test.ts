import { describe, expect, it } from 'vitest';
import {
  FORBIDDEN_PHRASES_PER_AGENT_MAX,
  KNOWLEDGE_TABLES,
  QUEUE_TOPIC_ROLES,
  scanGuardrails,
  validateKnowledgeTableRow,
  validateProcedure,
  type ProcStep,
} from '@siyahtus/types';
import {
  IGAMING_TEMPLATE_KEYS,
  LOCKED_TEMPLATE_KEYS,
  TEMPLATE_SCENARIOS_MIN,
  templatePlaceholders,
  templateTopics,
  type AiTemplate,
  type AiTemplatePack,
} from '../catalogue.js';
import { templateOutputRules, validateAiCatalogue, validateAiTemplate } from '../validate.js';
import {
  IGAMING_CORE_PACK,
  IGAMING_DEFAULT_RULES,
  IGAMING_PERSONA_STYLE,
  IGAMING_SAMPLE_ROWS,
  IGAMING_TEMPLATES_TR,
  igamingTemplate,
} from './index.js';

function template(key: (typeof IGAMING_TEMPLATE_KEYS)[number]): AiTemplate {
  const found = igamingTemplate(key);
  if (found === null) throw new Error(`no template ${key}`);
  return JSON.parse(JSON.stringify(found)) as AiTemplate;
}

function pack(edit: (pack: AiTemplatePack) => void): AiTemplatePack {
  const copy = JSON.parse(JSON.stringify(IGAMING_CORE_PACK)) as AiTemplatePack;
  edit(copy);
  return copy;
}

/** The steps a procedure runs, straight down from its first, until one waits, branches or ends. */
function firstRun(steps: readonly ProcStep[]): ProcStep[] {
  const out: ProcStep[] = [];
  for (const step of steps) {
    out.push(step);
    if (['collect', 'check', 'handoff', 'resolve'].includes(step.type)) break;
  }
  return out;
}

describe('the twenty iGaming templates (AI-15 · tm 311.2)', () => {
  it('the catalogue is the twenty, once each, in the research order', () => {
    expect(IGAMING_TEMPLATES_TR).toHaveLength(20);
    expect(IGAMING_TEMPLATES_TR.map((t) => t.key)).toEqual([...IGAMING_TEMPLATE_KEYS]);
    expect(IGAMING_CORE_PACK.template_keys).toEqual([...IGAMING_TEMPLATE_KEYS]);
  });

  it('every template passes the template validator and AI-03’s, with no warning', () => {
    expect(validateAiCatalogue(IGAMING_TEMPLATES_TR, [IGAMING_CORE_PACK])).toEqual([]);
    for (const t of IGAMING_TEMPLATES_TR) {
      const result = validateProcedure(t.procedure, {
        topics: new Set(QUEUE_TOPIC_ROLES),
        placeholders: new Set(templatePlaceholders(t)),
      });
      expect(result.ok, t.key).toBe(true);
      expect(result.warnings, t.key).toEqual([]);
    }
  });

  it.each(IGAMING_TEMPLATES_TR.map((t) => [t.key, t] as const))(
    '%s: version 1, Turkish, at least three scenarios, hands over only to queue roles',
    (_key, t) => {
      expect(t).toMatchObject({ version: 1, industry: 'igaming', lang: 'tr' });
      expect(t.scenarios.length).toBeGreaterThanOrEqual(TEMPLATE_SCENARIOS_MIN);
      expect(templateTopics(t).length).toBeGreaterThan(0);
      for (const topic of templateTopics(t)) expect(QUEUE_TOPIC_ROLES).toContain(topic);
      // AI-07: at most two questions in one message.
      for (const step of t.procedure.steps) {
        if (step.type === 'collect') expect(step.slots.length, step.id).toBeLessThanOrEqual(2);
      }
    },
  );

  it('every template’s scenarios reach at least one of its hand-overs', () => {
    for (const t of IGAMING_TEMPLATES_TR) {
      expect(
        t.scenarios.some((s) => s.expect.outcome === 'handoff'),
        t.key,
      ).toBe(true);
    }
  });
});

describe('the locked templates: self-exclusion and the responsible gambling signal (G1, G2)', () => {
  it.each(LOCKED_TEMPLATE_KEYS.map((key) => [key] as const))(
    '%s hands over to responsible gambling in its first turn, asking nothing',
    (key) => {
      const t = template(key);
      expect(t.locked).toBe(true);
      expect(t.procedure.slots).toEqual([]);
      const run = firstRun(t.procedure.steps);
      expect(run.map((step) => step.type)).toEqual(['say', 'tag', 'handoff']);
      expect(t.procedure.handoff.target).toEqual({ topic: 'responsible_gambling' });
      for (const s of t.scenarios) {
        expect(s.turns, s.key).toHaveLength(1);
        expect(s.expect, s.key).toMatchObject({
          outcome: 'handoff',
          topic: 'responsible_gambling',
        });
      }
    },
  );

  it('are held to G4: no bonus, promotion or deposit encouragement in their texts', () => {
    for (const key of LOCKED_TEMPLATE_KEYS) {
      expect(templateOutputRules(template(key))).toContain('G4');
      const edited = template(key);
      edited.procedure.templates[0]!.text += ' Size özel bir bonus da tanımlayabiliriz.';
      expect(validateAiTemplate(edited)).toContainEqual(
        expect.objectContaining({ code: 'template_guardrail_hit', detail: 'G4' }),
      );
    }
  });

  it('an open template may name a bonus — G4 is the risk-flagged conversation’s, not the template’s', () => {
    const bonus = template('bonus_claim');
    expect(templateOutputRules(bonus)).not.toContain('G4');
    expect(bonus.procedure.templates.some((reply) => /bonus/i.test(reply.text))).toBe(true);
    expect(validateAiTemplate(bonus)).toEqual([]);
  });

  it('self-exclusion’s examples are requests G1 hands over on by itself — the deferral the locked procedure answers', () => {
    for (const example of template('self_exclusion').procedure.examples) {
      expect(scanGuardrails(example, 'input', { rules: ['G1'] }), example).not.toEqual([]);
    }
  });

  it('the responsible gambling signal’s Turkish examples carry G2’s evidence', () => {
    const turkish = template('responsible_gambling_signal').procedure.examples.filter(
      (example) => !/^I /.test(example),
    );
    for (const example of turkish) {
      expect(scanGuardrails(example, 'input', { rules: ['G2'] }), example).not.toEqual([]);
    }
  });

  it('the help resources are the tenant’s to fill in, and the crisis text is on the checklist', () => {
    expect(templatePlaceholders(template('self_exclusion'))).toEqual(['sorumlu_oyun_kaynaklari']);
    const signal = template('responsible_gambling_signal');
    expect(templatePlaceholders(signal)).toEqual(['yardim_kaynaklari']);
    expect(signal.tenant_must_fill).toContainEqual(
      expect.objectContaining({ kind: 'setting', setting: 'crisis' }),
    );
  });
});

describe('the compliance-shaped templates', () => {
  it('complaint_formal says the complaint procedure verbatim with the tenant’s time and ADR body', () => {
    const t = template('complaint_formal');
    expect(templatePlaceholders(t)).toEqual(['sikayet_suresi', 'adr_kurumu']);
    const procedure = t.procedure.templates.find((reply) => reply.key === 'sikayet_proseduru');
    expect(procedure).toMatchObject({ verbatim: true });
    expect(procedure!.text).toContain('{sikayet_suresi}');
    expect(procedure!.text).toContain('{adr_kurumu}');
    expect(templateTopics(t)).toEqual(['complaint']);
  });

  it('site_access answers only from the access information setting (K13), never from its own text', () => {
    const t = template('site_access');
    expect(t.procedure.steps).toContainEqual(
      expect.objectContaining({ type: 'answer_from_knowledge' }),
    );
    expect(t.tenant_must_fill).toEqual([
      expect.objectContaining({ kind: 'setting', setting: 'access_info' }),
    ]);
    for (const s of t.scenarios) expect(s.access_info, s.key).toEqual(expect.any(String));
    // The template's own words carry no address and no way around a block (G14).
    for (const reply of t.procedure.templates) expect(reply.text).not.toMatch(/https?:|vpn|dns/i);
  });

  it('limit_change never makes a raise easier: raising or removing hands over', () => {
    const t = template('limit_change');
    const raise = t.procedure.steps.find((step) => step.id === 'artis');
    expect(raise).toMatchObject({
      type: 'check',
      when: { slot: { name: 'yon', op: 'in', value: ['Yükselt', 'Kaldır'] } },
      then: { goto: 'artis_bilgi' },
    });
    expect(t.procedure.steps.find((step) => step.id === 'artis_devir')).toMatchObject({
      type: 'handoff',
      reason_code: 'limit_increase_request',
    });
  });

  it('login_password never asks for the password: no slot text names it', () => {
    for (const slot of template('login_password').procedure.slots) {
      expect(`${slot.label} ${slot.ask}`, slot.name).not.toMatch(/şifre|parola|password|kod/i);
    }
  });

  it('a scenario’s access information must be text', () => {
    const t = template('site_access');
    t.scenarios[0]!.access_info = ' ';
    expect(validateAiTemplate(t)).toEqual([
      expect.objectContaining({
        code: 'template_bad_scenario',
        at: `scenarios.${t.scenarios[0]!.key}`,
      }),
    ]);
  });
});

describe('the igaming_core pack (AI-07 defaults, persona style, AI-13 sample rows)', () => {
  it('carries the five AI-07 defaults, the payment one scoped to the payment templates', () => {
    expect(IGAMING_CORE_PACK.default_rules).toBe(IGAMING_DEFAULT_RULES);
    expect(IGAMING_DEFAULT_RULES.map((rule) => rule.key)).toEqual([
      'iki_soru_siniri',
      'odeme_once_bilgi',
      'mukerrer_yatirim_yok',
      'temsilciyle_celisme',
      'siz_hitabi',
    ]);
    const payment = IGAMING_DEFAULT_RULES.find((rule) => rule.key === 'odeme_once_bilgi');
    expect(payment?.template_keys).toEqual([
      'deposit_not_credited',
      'withdrawal_pending',
      'withdrawal_rejected',
      'wrong_account_or_network',
    ]);
    expect(IGAMING_CORE_PACK.persona_style).toEqual({
      address_form: 'siz',
      emoji: 'none',
      max_questions_per_message: 2,
    });
    expect(IGAMING_PERSONA_STYLE).toBe(IGAMING_CORE_PACK.persona_style);
  });

  it('every sample row is a row the AI-13 tables accept, and every table has one', () => {
    for (const table of KNOWLEDGE_TABLES) {
      expect(IGAMING_SAMPLE_ROWS[table].length, table).toBeGreaterThan(0);
      for (const row of IGAMING_SAMPLE_ROWS[table]) {
        expect(validateKnowledgeTableRow(table, row), JSON.stringify(row)).toEqual([]);
      }
    }
    const directions = new Set(IGAMING_SAMPLE_ROWS.payment_methods.map((row) => row.direction));
    expect([...directions].sort()).toEqual(['deposit', 'withdrawal']);
  });

  it('its templates’ forbidden phrases fit on one agent', () => {
    const total = IGAMING_TEMPLATES_TR.flatMap((t) => t.forbidden_phrases).length;
    expect(total).toBeLessThanOrEqual(FORBIDDEN_PHRASES_PER_AGENT_MAX);
  });

  const packCases: Array<[string, (pack: AiTemplatePack) => void]> = [
    ['a rule key that is not snake_case', (p) => (p.default_rules[0]!.key = 'İki Soru')],
    ['a rule key twice', (p) => (p.default_rules[1]!.key = p.default_rules[0]!.key)],
    ['an empty rule body', (p) => (p.default_rules[0]!.body = ' ')],
    ['a rule body past its length', (p) => (p.default_rules[0]!.body = 'x'.repeat(601))],
    [
      'an unknown rule category',
      (p) => ((p.default_rules[0] as { category: string }).category = 'tone'),
    ],
    ['a rule priority of 0', (p) => (p.default_rules[0]!.priority = 0)],
    ['a rule scoped to no template', (p) => (p.default_rules[1]!.template_keys = [])],
    [
      'a rule scoped to a template outside the pack',
      (p) => (p.template_keys = p.template_keys.filter((key) => key !== 'withdrawal_rejected')),
    ],
    [
      'an unknown address form',
      (p) => ((p.persona_style as { address_form: string }).address_form = 'sen ve siz'),
    ],
    ['four questions in one message', (p) => (p.persona_style.max_questions_per_message = 4)],
    ['a sample row the tables refuse', (p) => (p.sample_rows.payment_methods[0]!.currency = 'TL')],
  ];

  it.each(packCases)('%s is refused', (_name, edit) => {
    expect(validateAiCatalogue(IGAMING_TEMPLATES_TR, [pack(edit)])).toEqual([
      expect.objectContaining({ code: 'template_bad_pack', template: 'igaming_core' }),
    ]);
  });

  it('more forbidden phrases than one agent holds is refused', () => {
    const crowded = IGAMING_TEMPLATES_TR.map((t, i) =>
      i === 0
        ? {
            ...t,
            forbidden_phrases: Array.from({ length: FORBIDDEN_PHRASES_PER_AGENT_MAX }, (_, n) => ({
              phrase: `yasak ifade ${n}`,
              match: 'word' as const,
              why: 'Sınır denemesi.',
            })),
          }
        : t,
    );
    expect(validateAiCatalogue(crowded, [IGAMING_CORE_PACK])).toContainEqual(
      expect.objectContaining({ code: 'template_bad_pack', template: 'igaming_core' }),
    );
  });
});
