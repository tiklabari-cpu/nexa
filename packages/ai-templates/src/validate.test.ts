import { describe, expect, it } from 'vitest';
import {
  AI_TEMPLATE_PACK_KEYS,
  DEPOSIT_NOT_CREDITED,
  IGAMING_CORE_PACK,
  IGAMING_TEMPLATES_TR,
  IGAMING_TEMPLATE_KEYS,
  LOCKED_TEMPLATE_KEYS,
  igamingTemplate,
  isLockedTemplateKey,
  type AiTemplate,
} from './index.js';
import {
  AI_TEMPLATE_PROBLEM_CODES,
  validateAiCatalogue,
  validateAiTemplate,
  type AiTemplateProblemCode,
} from './validate.js';

/** The worked example, deep-copied, with one change. */
function deposit(edit: (template: AiTemplate) => void = () => {}): AiTemplate {
  const copy = JSON.parse(JSON.stringify(DEPOSIT_NOT_CREDITED)) as AiTemplate;
  edit(copy);
  return copy;
}

function codes(template: AiTemplate): AiTemplateProblemCode[] {
  return validateAiTemplate(template).map((problem) => problem.code);
}

describe('the catalogue', () => {
  it('every template passes the template validator, and the pack names only catalogue templates', () => {
    expect(validateAiCatalogue(IGAMING_TEMPLATES_TR, [IGAMING_CORE_PACK])).toEqual([]);
  });

  it('names the twenty topics once each, two of them locked, the responsible gambling key spelt as the queue role', () => {
    expect(IGAMING_TEMPLATE_KEYS).toHaveLength(20);
    expect(new Set(IGAMING_TEMPLATE_KEYS).size).toBe(20);
    expect(LOCKED_TEMPLATE_KEYS).toEqual(['self_exclusion', 'responsible_gambling_signal']);
    expect(IGAMING_TEMPLATE_KEYS).not.toContain('responsible_gaming_signal');
    for (const key of LOCKED_TEMPLATE_KEYS) expect(isLockedTemplateKey(key)).toBe(true);
    expect(isLockedTemplateKey('deposit_not_credited')).toBe(false);
  });

  it('every template in the catalogue has a key of the twenty and the lock the key says', () => {
    for (const template of IGAMING_TEMPLATES_TR) {
      expect(IGAMING_TEMPLATE_KEYS).toContain(template.key);
      expect(template.locked, template.key).toBe(isLockedTemplateKey(template.key));
      expect(igamingTemplate(template.key)).toBe(template);
    }
    expect(igamingTemplate('order_status')).toBeNull();
  });

  it('the igaming_core pack is every catalogue template, in catalogue order', () => {
    expect(AI_TEMPLATE_PACK_KEYS).toEqual(['igaming_core']);
    expect(IGAMING_CORE_PACK).toMatchObject({
      key: 'igaming_core',
      industry: 'igaming',
      lang: 'tr',
    });
    expect(IGAMING_CORE_PACK.template_keys).toEqual(IGAMING_TEMPLATES_TR.map((t) => t.key));
  });

  it('a key twice in the catalogue, and a pack naming a template twice or one not there, are refused', () => {
    const problems = validateAiCatalogue(
      [DEPOSIT_NOT_CREDITED, DEPOSIT_NOT_CREDITED],
      [
        {
          ...IGAMING_CORE_PACK,
          template_keys: ['deposit_not_credited', 'deposit_not_credited', 'withdrawal_pending'],
          default_rules: [],
        },
      ],
    ).filter(
      (problem) => problem.code !== 'template_unknown_key' || problem.message.includes('twice'),
    );
    expect(problems.map((problem) => [problem.code, problem.at])).toEqual([
      ['template_unknown_key', undefined],
      ['template_bad_pack', 'deposit_not_credited'],
      ['template_bad_pack', 'withdrawal_pending'],
    ]);
  });
});

describe('the template validator refuses each kind of defect', () => {
  const cases: Array<[string, (template: AiTemplate) => void, AiTemplateProblemCode]> = [
    [
      'a key outside the twenty',
      (t) => ((t as { key: string }).key = 'order_status'),
      'template_unknown_key',
    ],
    ['version 0', (t) => (t.version = 0), 'template_bad_version'],
    ['a fractional version', (t) => (t.version = 1.5), 'template_bad_version'],
    [
      'an unknown industry',
      (t) => ((t as { industry: string }).industry = 'ecommerce'),
      'template_bad_meta',
    ],
    ['an English-only language', (t) => ((t as { lang: string }).lang = 'en'), 'template_bad_meta'],
    ['an empty name', (t) => (t.name = ' '), 'template_bad_meta'],
    ['a summary past its length', (t) => (t.summary = 'x'.repeat(301)), 'template_bad_meta'],
    ['a lock on an open topic', (t) => (t.locked = true), 'template_lock_mismatch'],
    [
      'a goto to no step',
      (t) => {
        const step = t.procedure.steps.find((s) => s.id === 'sure_icinde');
        if (step?.type === 'check') step.then = { goto: 'yok_boyle_adim' };
      },
      'template_procedure_invalid',
    ],
    [
      'a step nothing reaches',
      (t) => t.procedure.steps.push({ id: 'yetim', type: 'say', template_key: 'giris' }),
      'template_unreachable_step',
    ],
    [
      'a hand-over to a team id',
      (t) => (t.procedure.handoff.target = { group_id: 7 }),
      'template_team_by_id',
    ],
    [
      'a hand-over topic that is no queue role',
      (t) => {
        const step = t.procedure.steps.find((s) => s.id === 'talep_devir');
        if (step?.type === 'handoff') step.target = { topic: 'general' };
      },
      'template_unknown_topic',
    ],
    [
      'a placeholder key with Turkish letters',
      (t) =>
        t.tenant_must_fill.push({
          kind: 'placeholder',
          key: 'şikâyet_süresi',
          label: 'Şikâyet süresi',
          example: '4 hafta',
        }),
      'template_bad_placeholder',
    ],
    [
      'a placeholder named like a slot',
      (t) => {
        t.tenant_must_fill.push({ kind: 'placeholder', key: 'tutar', label: 'x', example: 'y' });
      },
      'template_bad_placeholder',
    ],
    [
      'a placeholder without an example',
      (t) => {
        t.procedure.templates[0]!.text += ' {finans_mesai}';
        t.tenant_must_fill.push({
          kind: 'placeholder',
          key: 'finans_mesai',
          label: 'Finans mesaisi',
          example: '',
        });
      },
      'template_bad_placeholder',
    ],
    [
      'a placeholder declared and used nowhere',
      (t) =>
        t.tenant_must_fill.push({
          kind: 'placeholder',
          key: 'adr_kurumu',
          label: 'ADR kurumu',
          example: 'Örnek Uyuşmazlık Kurulu',
        }),
      'template_placeholder_unused',
    ],
    [
      'a placeholder used and not declared',
      (t) => (t.procedure.templates[0]!.text += ' {kriz_hatti}'),
      'template_procedure_invalid',
    ],
    [
      'a fact read that the checklist does not list',
      (t) => {
        const table = t.tenant_must_fill.find((item) => item.kind === 'table');
        if (table?.kind === 'table')
          table.columns = table.columns.filter((c) => c !== 'method.min_amount');
      },
      'template_fact_undeclared',
    ],
    [
      'a column of another table',
      (t) => {
        const table = t.tenant_must_fill.find((item) => item.kind === 'table');
        if (table?.kind === 'table') table.columns.push('bonus.max_bet');
      },
      'template_fact_undeclared',
    ],
    [
      'a column the procedure never reads',
      (t) => {
        const table = t.tenant_must_fill.find((item) => item.kind === 'table');
        if (table?.kind === 'table') table.columns.push('method.delay_threshold_minutes');
      },
      'template_table_column_unused',
    ],
    [
      'a reply that claims to have checked the account',
      (t) => (t.procedure.templates[0]!.text = 'Kontrol ettim, sistemde görünüyor.'),
      'template_guardrail_hit',
    ],
    [
      'a reply that carries one of its forbidden phrases',
      (t) => (t.procedure.templates[0]!.text = 'Lütfen tekrar yatırın.'),
      'template_forbidden_phrase_hit',
    ],
    [
      'a forbidden phrase that does not compile',
      (t) => t.forbidden_phrases.push({ phrase: '(a+)+', match: 'regex', why: 'x' }),
      'template_forbidden_phrase_invalid',
    ],
    [
      'a forbidden phrase without a why',
      (t) => t.forbidden_phrases.push({ phrase: 'garanti', match: 'word', why: '' }),
      'template_forbidden_phrase_invalid',
    ],
    [
      'a reply in the familiar "sen"',
      (t) => (t.procedure.templates[0]!.text = 'Sana hemen yardımcı olayım.'),
      'template_familiar_address',
    ],
    [
      'a slot question in the familiar "sen"',
      (t) => (t.procedure.slots[0]!.ask = 'Senin kullanıcı adın ne?'),
      'template_familiar_address',
    ],
    ['two scenarios', (t) => (t.scenarios = t.scenarios.slice(0, 2)), 'template_too_few_scenarios'],
  ];

  it.each(cases)('%s', (_name, edit, code) => {
    expect(codes(deposit(edit))).toContain(code);
  });

  it('every code but the pack’s is reachable from one template', () => {
    const reached = new Set(cases.map(([, , code]) => code));
    const unreached = AI_TEMPLATE_PROBLEM_CODES.filter(
      (code) =>
        !reached.has(code) && code !== 'template_bad_scenario' && code !== 'template_bad_pack',
    );
    expect(unreached).toEqual([]);
  });

  it('a declared placeholder used in a text is not an undefined variable', () => {
    const template = deposit((t) => {
      t.procedure.templates[0]!.text += ' Finans ekibimiz {finans_mesai} arasında çalışır.';
      t.tenant_must_fill.push({
        kind: 'placeholder',
        key: 'finans_mesai',
        label: 'Finans ekibinin çalışma saatleri',
        example: '09:00–23:00',
      });
    });
    expect(validateAiTemplate(template)).toEqual([]);
  });
});

describe('a scenario the procedure cannot end as written is refused', () => {
  const scenarioCases: Array<[string, (scenario: AiTemplate['scenarios'][number]) => void]> = [
    ['a key that is not snake_case', (s) => (s.key = 'Talep Yok')],
    ['an unknown persona', (s) => ((s as { persona: string }).persona = 'robot')],
    ['a moment without its offset', (s) => (s.simulated_now = '2026-10-18T13:50:00')],
    ['a next window that is no moment', (s) => (s.next_window = 'yarın sabah')],
    ['no turns', (s) => (s.turns = [])],
    ['more turns than the procedure allows', (s) => (s.turns = Array(13).fill('evet'))],
    ['an empty turn', (s) => (s.turns = ['param yatmadı', ' '])],
    ['a fact that is no fact', (s) => ((s.facts as Record<string, unknown>)['method.fee'] = 0)],
    ['a fact the procedure reads, missing', (s) => delete s.facts['method.expected_minutes']],
    ['options for a slot that is no enum', (s) => (s.options = { tutar: [{ value: '100' }] })],
    ['an unknown outcome', (s) => ((s.expect as { outcome: string }).outcome = 'closed')],
    [
      'a hand-over with a reason the procedure does not have',
      (s) =>
        (s.expect = { ...s.expect, outcome: 'handoff', reason_code: 'max_bet', topic: 'finance' }),
    ],
    [
      'a hand-over to a topic the template does not name',
      (s) =>
        (s.expect = {
          ...s.expect,
          outcome: 'handoff',
          reason_code: 'no_site_request',
          topic: 'bonus',
        }),
    ],
    [
      'a wait with a reason',
      (s) =>
        (s.expect = { ...s.expect, outcome: 'resolved_waiting', reason_code: 'no_site_request' }),
    ],
    [
      'an outcome no resolve step ends with',
      (s) => (s.expect = { outcome: 'resolved', required_slots: [] }),
    ],
    ['a required slot that is no slot', (s) => s.expect.required_slots.push('sifre')],
    ['a value for a slot it does not require', (s) => (s.expect.values = { referans: 'REF1' })],
    ['an empty value', (s) => (s.expect.values = { yontem: ' ' })],
    ['an empty forbidden phrase', (s) => (s.expect.forbidden_phrases = [''])],
  ];

  it.each(scenarioCases)('%s', (_name, edit) => {
    const template = deposit((t) => edit(t.scenarios[0]!));
    expect(validateAiTemplate(template)).toEqual([
      expect.objectContaining({
        code: 'template_bad_scenario',
        at: `scenarios.${template.scenarios[0]!.key}`,
      }),
    ]);
  });

  it('two scenarios with one key', () => {
    const template = deposit((t) => (t.scenarios[1]!.key = t.scenarios[0]!.key));
    expect(validateAiTemplate(template)).toContainEqual(
      expect.objectContaining({
        code: 'template_bad_scenario',
        message: `key ${template.scenarios[0]!.key} is used twice`,
      }),
    );
  });
});
