import { describe, expect, it } from 'vitest';
import {
  COND_DEPTH_MAX,
  PROCEDURE_COLLECT_SLOTS_MAX,
  PROCEDURE_PROBLEM_CODES,
  PROCEDURE_STEPS_MAX,
  PROCEDURE_TEMPLATES_MAX,
  SKILL_PROCEDURE_FIELDS,
  type Procedure,
  type ProcedureProblem,
  type ProcedureProblemCode,
  type ProcedureValidationContext,
  fallbackTakenProblem,
  parseProcedureReference,
  procedureAiQuestions,
  procedureProblemDetails,
  splitSkillProcedure,
  templateReferences,
  validateProcedure,
  validateSkillProcedure,
  validateSkillSelection,
} from './procedure.js';
import type { SlotProblemCode } from './slots.js';

type Json = Record<string, unknown>;

/**
 * Araştırma §3.1 "Para yatırdım hesabıma geçmedi", written in this language:
 * method and time → elapsed vs expected (template A) → working hours
 * (template B) → site request (C) / sender (third party) → amount against the
 * method's range → reference and receipt → the passive lookup → finance; the
 * wait ends `resolved_waiting`.
 */
function deposit(): Json {
  return {
    when_to_use: 'Oyuncu yaptığı yatırımın hesabına geçmediğini söylüyor.',
    examples: [
      'param yatmadı',
      'yatırım yaptım bakiyem gelmedi',
      'havale attım gözükmüyor',
      'papara ile yatırdım düşmedi',
      'usdt gönderdim gelmedi',
    ],
    priority: 50,
    slots: [
      {
        name: 'kullanici_adi',
        label: 'Kullanıcı adı',
        type: 'username',
        ask: 'Kullanıcı adınızı yazar mısınız?',
      },
      {
        name: 'yontem',
        label: 'Ödeme yöntemi',
        type: 'enum',
        ask: 'Hangi yöntemle yatırım yaptınız?',
        validate: { enum_source: 'payment_methods.deposit' },
      },
      { name: 'tutar', label: 'Tutar', type: 'money', ask: 'Ne kadar yatırdınız?' },
      {
        name: 'islem_zamani',
        label: 'İşlem zamanı',
        type: 'datetime',
        ask: 'Saat kaçta yatırdınız?',
      },
      {
        name: 'talep_olusturuldu',
        label: 'Site talebi',
        type: 'boolean',
        ask: 'Göndermeden önce site üzerinden yatırım talebi oluşturdunuz mu?',
      },
      {
        name: 'gonderen_kendisi',
        label: 'Gönderen kendisi',
        type: 'boolean',
        ask: 'Gönderim kendi adınıza kayıtlı hesaptan mı yapıldı?',
      },
      {
        name: 'referans',
        label: 'Referans no',
        type: 'reference_code',
        ask: 'İşlemin referans numarasını paylaşır mısınız?',
        required: { when: { fact: { path: 'method.receipt_required', op: 'eq', value: false } } },
      },
      {
        name: 'dekont',
        label: 'Dekont',
        type: 'file',
        ask: 'Dekontu ya da ekran görüntüsünü paylaşabilir misiniz?',
        required: { when: { fact: { path: 'method.receipt_required', op: 'eq', value: true } } },
      },
    ],
    steps: [
      { id: 'karsilama', type: 'say', template_key: 'giris' },
      { id: 'yontem_zaman', type: 'collect', slots: ['yontem', 'islem_zamani'] },
      {
        id: 'sure_icinde',
        type: 'check',
        when: {
          fn: {
            name: 'elapsed_minutes',
            args: ['islem_zamani'],
            op: 'lt',
            value: { fact: 'method.expected_minutes' },
          },
        },
        then: { goto: 'bekleme' },
      },
      {
        id: 'mesai_disi',
        type: 'check',
        when: { not: { fn: { name: 'within_working_hours', args: ['method', 'islem_zamani'] } } },
        then: { goto: 'mesai' },
      },
      { id: 'surec', type: 'collect', slots: ['talep_olusturuldu', 'gonderen_kendisi'] },
      {
        id: 'talep_yok',
        type: 'check',
        when: { slot: { name: 'talep_olusturuldu', op: 'eq', value: false } },
        then: { goto: 'talep_kalibi' },
      },
      {
        id: 'ucuncu_kisi',
        type: 'check',
        when: { slot: { name: 'gonderen_kendisi', op: 'eq', value: false } },
        then: {
          type: 'handoff',
          reason_code: 'third_party_payment',
          instruction: 'Üçüncü kişi ödemesi kuralını kısaca anlat.',
        },
      },
      { id: 'tutar_sor', type: 'collect', slots: ['tutar'] },
      {
        id: 'tutar_disi',
        type: 'check',
        when: {
          any: [
            { slot: { name: 'tutar', op: 'lt', value: { fact: 'method.min_amount' } } },
            { slot: { name: 'tutar', op: 'gt', value: { fact: 'method.max_amount' } } },
          ],
        },
        then: { type: 'handoff', reason_code: 'amount_out_of_range' },
      },
      { id: 'kullanici', type: 'collect', slots: ['kullanici_adi'] },
      { id: 'kanit', type: 'collect', slots: ['referans', 'dekont'] },
      {
        id: 'yatirim_sorgula',
        type: 'tool',
        tool_key: 'deposit_lookup',
        inputs: { user_id: 'kullanici_adi', amount: 'tutar', time: 'islem_zamani' },
        active: false,
      },
      { id: 'finansa_devir', type: 'handoff', reason_code: 'expected_time_exceeded' },
      { id: 'talep_kalibi', type: 'say', template_key: 'talep_yok' },
      { id: 'talep_devir', type: 'handoff', reason_code: 'no_site_request' },
      { id: 'bekleme', type: 'say', template_key: 'normal_sure' },
      {
        id: 'bekleme_bitti',
        type: 'resolve',
        outcome: 'resolved_waiting',
        followup_template: 'takip',
      },
      { id: 'mesai', type: 'say', template_key: 'mesai_disi' },
      { id: 'mesai_bitti', type: 'resolve', outcome: 'resolved_waiting' },
    ],
    templates: [
      {
        key: 'giris',
        text: 'Yaşadığınız durumu anlıyorum, hemen birlikte bakalım. Birkaç bilgiye ihtiyacım var.',
      },
      {
        key: 'normal_sure',
        text: '{yontem} ile yapılan yatırımlar genellikle {method.expected_minutes} dakika içinde hesaba yansır. İşleminiz {elapsed_minutes(islem_zamani)} dakika önce yapılmış, yani hâlâ normal süre içinde.',
      },
      {
        key: 'mesai_disi',
        text: '{yontem} işlemleri {method.working_hours} arasında işlenir. Talebiniz bir sonraki işlem penceresinde ({next_window(method)}) değerlendirilecek.',
      },
      {
        key: 'talep_yok',
        text: 'Bu yöntemle gönderimden önce site üzerinden yatırım talebi oluşturulması gerekiyor. Bilgilerinizi finans ekibimize iletiyorum.',
      },
      {
        key: 'takip',
        text: '{method.expected_minutes} dakika dolduğunda bakiye görünmezse bu sohbete yazın.',
      },
    ],
    handoff: {
      conditions: [{ slot: { name: 'tutar', op: 'gt', value: 100000 } }],
      target: { topic: 'finance' },
      card_fields: [
        'method.expected_minutes',
        'method.delay_threshold_minutes',
        'elapsed_minutes(islem_zamani)',
      ],
      next_step_hint: '{yontem} referansı ile ödeme sağlayıcı panelinde eşleştirme.',
    },
    limits: { max_turns: 12 },
  };
}

/** A small procedure that passes, to vary one part at a time. */
function base(): Json {
  return {
    when_to_use: 'Oyuncu yatırımının hesabına geçmediğini söylüyor.',
    slots: [
      {
        name: 'yontem',
        label: 'Yöntem',
        type: 'enum',
        ask: 'Hangi yöntemle yatırdınız?',
        validate: { enum_source: 'payment_methods.deposit' },
      },
      { name: 'tutar', label: 'Tutar', type: 'money', ask: 'Ne kadar yatırdınız?' },
      { name: 'islem_zamani', label: 'İşlem zamanı', type: 'datetime', ask: 'Saat kaçta?' },
      { name: 'talep', label: 'Talep', type: 'boolean', ask: 'Talep oluşturdunuz mu?' },
      {
        name: 'kanal',
        label: 'Kanal',
        type: 'enum',
        ask: 'Hangi kanaldan?',
        validate: { enum_values: ['Web', 'Mobil'] },
      },
      { name: 'not', label: 'Not', type: 'text', ask: 'Eklemek istediğiniz bir şey var mı?' },
    ],
    steps: [
      { id: 'sor', type: 'collect', slots: ['yontem', 'tutar'] },
      { id: 'bekle', type: 'say', template_key: 'bekle' },
      { id: 'devir', type: 'handoff', reason_code: 'needs_finance' },
    ],
    templates: [
      { key: 'bekle', text: '{yontem} genellikle {method.expected_minutes} dakikada geçer.' },
    ],
  };
}

function withSteps(...steps: Json[]): Json {
  return { ...base(), steps };
}

/** A procedure whose single `check` step tests `when`. */
function withCondition(when: unknown): Json {
  return withSteps(
    { id: 'sor', type: 'collect', slots: ['yontem'] },
    { id: 'kontrol', type: 'check', when, then: { type: 'say', instruction: 'Bekleyin.' } },
    { id: 'devir', type: 'handoff', reason_code: 'needs_finance' },
  );
}

function problemsOf(value: unknown, context?: ProcedureValidationContext): ProcedureProblem[] {
  const result = validateProcedure(value, context);
  return result.ok ? [] : result.problems;
}

function codesOf(
  value: unknown,
  context?: ProcedureValidationContext,
): Array<ProcedureProblemCode | SlotProblemCode> {
  return problemsOf(value, context).map((problem) => problem.code);
}

function valid(value: unknown, context?: ProcedureValidationContext): Procedure {
  const result = validateProcedure(value, context);
  if (!result.ok) throw new Error(JSON.stringify(result.problems, null, 2));
  return result.procedure;
}

describe('the §3.1 deposit procedure (AI-03 acceptance)', () => {
  it('passes: branches on elapsed vs expected time, working hours, request, sender and amount', () => {
    const result = validateProcedure(deposit(), {
      groupIds: new Set([7]),
      topics: new Set(['finance']),
    });
    expect(result).toMatchObject({ ok: true, warnings: [] });
    if (!result.ok) return;
    const { procedure } = result;
    expect(procedure.steps.map((step) => step.type)).toEqual([
      'say',
      'collect',
      'check',
      'check',
      'collect',
      'check',
      'check',
      'collect',
      'check',
      'collect',
      'collect',
      'tool',
      'handoff',
      'say',
      'handoff',
      'say',
      'resolve',
      'say',
      'resolve',
    ]);
    expect(procedure.steps.at(-3)).toEqual({
      id: 'bekleme_bitti',
      type: 'resolve',
      outcome: 'resolved_waiting',
      followup_template: 'takip',
    });
    // The slots come back with their defaults (`SLOT_DEF_DEFAULTS`).
    expect(procedure.slots[0]).toMatchObject({ required: 'always', max_attempts: 2, pii: 'none' });
    expect(procedure.handoff.target).toEqual({ topic: 'finance' });
    expect(procedure.limits).toEqual({ max_turns: 12 });
  });

  it('fills every default of a minimal procedure', () => {
    expect(
      valid({
        when_to_use: '  Selamlaşma  ',
        steps: [{ id: 's', type: 'say', instruction: ' Merhaba de. ' }],
      }),
    ).toEqual({
      when_to_use: 'Selamlaşma',
      examples: [],
      priority: 100,
      slots: [],
      steps: [{ id: 's', type: 'say', instruction: 'Merhaba de.' }],
      templates: [],
      handoff: { conditions: [], card_fields: [] },
      limits: { max_turns: 12 },
    });
  });
});

describe('save refuses what AI-03 §9 lists (acceptance)', () => {
  it('a goto to a step that is not there', () => {
    const problems = problemsOf(
      withSteps(
        { id: 'sor', type: 'collect', slots: ['tutar'] },
        {
          id: 'kontrol',
          type: 'check',
          when: { slot: { name: 'tutar', op: 'exists' } },
          then: { goto: 'yok' },
        },
      ),
    );
    expect(problems).toEqual([
      expect.objectContaining({
        code: 'procedure_unknown_goto',
        section: 'steps',
        index: 1,
        step_id: 'kontrol',
        field: 'then',
        reference: 'yok',
      }),
    ]);
  });

  it('a loop nothing in which waits for the player', () => {
    const problems = problemsOf(
      withSteps(
        { id: 'aciklama', type: 'say', instruction: 'Kuralı anlat.' },
        {
          id: 'tekrar',
          type: 'check',
          when: { slot: { name: 'tutar', op: 'missing' } },
          then: { goto: 'aciklama' },
        },
        { id: 'devir', type: 'handoff', reason_code: 'needs_finance' },
      ),
    );
    expect(problems).toEqual([
      expect.objectContaining({
        code: 'procedure_loop_without_collect',
        step_id: 'tekrar',
        field: 'then',
        reference: 'aciklama',
      }),
    ]);
  });

  it(`a collect of ${PROCEDURE_COLLECT_SLOTS_MAX + 1} slots`, () => {
    expect(
      codesOf(
        withSteps({ id: 'sor', type: 'collect', slots: ['yontem', 'tutar', 'islem_zamani'] }),
      ),
    ).toEqual(['procedure_collect_too_many_slots']);
  });

  it('a template variable that names nothing', () => {
    const procedure = {
      ...base(),
      templates: [{ key: 'bekle', text: '{yöntem} ile {tutarr} geldi.' }],
    };
    expect(problemsOf(procedure)).toEqual([
      expect.objectContaining({
        code: 'procedure_unknown_variable',
        section: 'templates',
        template_key: 'bekle',
        reference: 'yöntem',
      }),
      expect.objectContaining({ code: 'procedure_unknown_variable', reference: 'tutarr' }),
    ]);
  });

  it('a "şifre" slot (G11, via slots.ts)', () => {
    const procedure = base();
    (procedure['slots'] as Json[]).push({
      name: 'sifre',
      label: 'Şifre',
      type: 'text',
      ask: 'Şifreniz?',
    });
    const problems = problemsOf(procedure);
    expect(problems[0]).toMatchObject({
      code: 'slot_sensitive_forbidden',
      section: 'slots',
      index: 6,
      slot: 'sifre',
      field: 'name',
      category: 'password',
    });
    expect(problems.map((p) => [p.code, p.field])).toEqual([
      ['slot_sensitive_forbidden', 'name'],
      ['slot_sensitive_forbidden', 'label'],
      ['slot_sensitive_forbidden', 'ask'],
    ]);
  });

  it('a team the license does not have — in a step and in the hand-over', () => {
    const procedure = {
      ...withSteps({
        id: 'devir',
        type: 'handoff',
        reason_code: 'needs_finance',
        target: { group_id: 9 },
      }),
      handoff: { target: { group_id: 8 } },
    };
    const context = { groupIds: new Set([7]) };
    expect(problemsOf(procedure, context)).toEqual([
      expect.objectContaining({
        code: 'procedure_unknown_target',
        section: 'steps',
        field: 'target',
        reference: '9',
      }),
      expect.objectContaining({
        code: 'procedure_unknown_target',
        section: 'handoff',
        field: 'target',
        reference: '8',
      }),
    ]);
    // Without the license's teams the shape alone is judged.
    expect(validateProcedure(procedure).ok).toBe(true);
    expect(validateProcedure(procedure, { groupIds: new Set([8, 9]) }).ok).toBe(true);
  });
});

describe('loops: a jump back must pass a step that waits', () => {
  it('accepts asking again through a collect', () => {
    valid(
      withSteps(
        { id: 'sor', type: 'collect', slots: ['tutar'] },
        {
          id: 'az',
          type: 'check',
          when: { slot: { name: 'tutar', op: 'lt', value: 50 } },
          then: { goto: 'sor' },
        },
        { id: 'devir', type: 'handoff', reason_code: 'needs_finance' },
      ),
    );
  });

  it('refuses a check that jumps to itself, through else too', () => {
    expect(
      problemsOf(
        withSteps(
          { id: 'sor', type: 'collect', slots: ['tutar'] },
          {
            id: 'don',
            type: 'check',
            when: { slot: { name: 'tutar', op: 'exists' } },
            then: { type: 'tag', tag: 'tutar_var' },
            else: { goto: 'don' },
          },
        ),
      ),
    ).toEqual([
      expect.objectContaining({
        code: 'procedure_loop_without_collect',
        field: 'else',
        reference: 'don',
      }),
    ]);
  });

  it('does not count a collect with its own `when` — it may be skipped', () => {
    expect(
      codesOf(
        withSteps(
          {
            id: 'sor',
            type: 'collect',
            slots: ['tutar'],
            when: { slot: { name: 'yontem', op: 'exists' } },
          },
          {
            id: 'az',
            type: 'check',
            when: { slot: { name: 'tutar', op: 'lt', value: 50 } },
            then: { goto: 'sor' },
          },
          { id: 'devir', type: 'handoff', reason_code: 'needs_finance' },
        ),
      ),
    ).toEqual(['procedure_loop_without_collect']);
  });

  it('refuses a loop that runs through a jump forward and the fall-through back', () => {
    expect(
      problemsOf(
        withSteps(
          { id: 'sor', type: 'collect', slots: ['tutar'] },
          { id: 'a', type: 'say', instruction: 'Bir.' },
          {
            id: 'ileri',
            type: 'check',
            when: { slot: { name: 'tutar', op: 'exists' } },
            then: { goto: 'c' },
          },
          { id: 'b', type: 'say', instruction: 'İki.' },
          {
            id: 'c',
            type: 'check',
            when: { slot: { name: 'tutar', op: 'exists' } },
            then: { goto: 'a' },
          },
          { id: 'devir', type: 'handoff', reason_code: 'needs_finance' },
        ),
      ),
    ).toEqual([
      expect.objectContaining({
        code: 'procedure_loop_without_collect',
        step_id: 'c',
        reference: 'a',
      }),
    ]);
  });

  it('takes a jump forward, or back past an ending step, as no loop', () => {
    valid(
      withSteps(
        { id: 'sor', type: 'collect', slots: ['tutar'] },
        {
          id: 'ileri',
          type: 'check',
          when: { slot: { name: 'tutar', op: 'exists' } },
          then: { goto: 'son' },
        },
        { id: 'devir', type: 'handoff', reason_code: 'needs_finance' },
        { id: 'son', type: 'resolve', outcome: 'resolved' },
      ),
    );
  });
});

describe('steps', () => {
  it.each<[string, Json, ProcedureProblemCode | SlotProblemCode]>([
    ['a step that is not an object', 'sor' as unknown as Json, 'procedure_step_not_object'],
    [
      'an id that is not snake_case',
      { id: 'Sor', type: 'say', instruction: 'x' },
      'procedure_step_bad_id',
    ],
    ['an unknown type', { id: 'sor', type: 'goto' }, 'procedure_step_unknown_type'],
    [
      'an unknown field',
      { id: 'sor', type: 'say', instruction: 'x', next: 'b' },
      'procedure_unknown_field',
    ],
    ['a say with nothing to say', { id: 'sor', type: 'say' }, 'procedure_say_needs_content'],
    [
      'a say naming no template',
      { id: 'sor', type: 'say', template_key: 'yok' },
      'procedure_unknown_template',
    ],
    [
      'a collect of no slot',
      { id: 'sor', type: 'collect', slots: [] },
      'procedure_collect_needs_slots',
    ],
    [
      'a collect of an undefined slot',
      { id: 'sor', type: 'collect', slots: ['iban'] },
      'slot_unknown_reference',
    ],
    [
      'a collect of one slot twice',
      { id: 'sor', type: 'collect', slots: ['tutar', 'tutar'] },
      'procedure_step_bad_option',
    ],
    [
      'a check with no condition',
      { id: 'k', type: 'check', then: { goto: 'k' } },
      'procedure_check_incomplete',
    ],
    [
      'a check with no then',
      { id: 'k', type: 'check', when: { slot: { name: 'tutar', op: 'exists' } } },
      'procedure_check_incomplete',
    ],
    ['a handoff with no reason', { id: 'd', type: 'handoff' }, 'procedure_step_bad_option'],
    [
      'an unknown outcome',
      { id: 'r', type: 'resolve', outcome: 'done' },
      'procedure_step_bad_option',
    ],
    [
      'a follow-up naming no template',
      { id: 'r', type: 'resolve', outcome: 'resolved', followup_template: 'yok' },
      'procedure_unknown_template',
    ],
    ['an empty tag', { id: 't', type: 'tag', tag: ' ' }, 'procedure_step_bad_option'],
    [
      'an instruction too long',
      { id: 's', type: 'say', instruction: 'x'.repeat(1001) },
      'procedure_step_bad_option',
    ],
    [
      'a long query hint',
      { id: 'a', type: 'answer_from_knowledge', query_hint: 'x'.repeat(301) },
      'procedure_step_bad_option',
    ],
    [
      'an active tool',
      { id: 't', type: 'tool', tool_key: 'deposit_lookup', inputs: {}, active: true },
      'procedure_tool_must_be_inactive',
    ],
    [
      'a tool input naming no slot',
      { id: 't', type: 'tool', tool_key: 'lookup', inputs: { amount: 'miktar' }, active: false },
      'slot_unknown_reference',
    ],
    [
      'a tool key that is not snake_case',
      { id: 't', type: 'tool', tool_key: 'Lookup', active: false },
      'procedure_step_bad_option',
    ],
  ])('refuses %s', (_name, step, code) => {
    expect(codesOf(withSteps(step))).toContain(code);
  });

  it('refuses a step list that is missing, empty or too long', () => {
    expect(codesOf({ ...base(), steps: undefined })).toEqual(['procedure_needs_steps']);
    expect(codesOf({ ...base(), steps: [] })).toEqual(['procedure_needs_steps']);
    const many = Array.from({ length: PROCEDURE_STEPS_MAX + 1 }, (_, i) => ({
      id: `s${i}`,
      type: 'say',
      instruction: 'x',
    }));
    expect(codesOf({ ...base(), steps: many })).toEqual(['procedure_too_many_steps']);
    expect(validateProcedure({ ...base(), steps: many.slice(0, PROCEDURE_STEPS_MAX) }).ok).toBe(
      true,
    );
  });

  it('refuses an id used twice, at the second', () => {
    expect(
      problemsOf(
        withSteps({ id: 'a', type: 'say', instruction: 'x' }, { id: 'a', type: 'tag', tag: 'y' }),
      ),
    ).toEqual([
      expect.objectContaining({ code: 'procedure_step_duplicate_id', index: 1, step_id: 'a' }),
    ]);
  });

  it('keeps an inactive tool step with its inputs (AI-28 F1)', () => {
    const procedure = valid(
      withSteps(
        { id: 'sor', type: 'collect', slots: ['tutar', 'islem_zamani'] },
        {
          id: 'bak',
          type: 'tool',
          tool_key: 'deposit_lookup',
          inputs: { amount: 'tutar' },
          active: false,
        },
        { id: 'devir', type: 'handoff', reason_code: 'needs_finance' },
      ),
    );
    expect(procedure.steps[1]).toEqual({
      id: 'bak',
      type: 'tool',
      tool_key: 'deposit_lookup',
      inputs: { amount: 'tutar' },
      active: false,
    });
  });

  it('takes a step in place of a goto in a branch, but not a collect, check or tool', () => {
    const procedure = valid(
      withSteps(
        { id: 'sor', type: 'collect', slots: ['tutar'] },
        {
          id: 'k',
          type: 'check',
          when: { slot: { name: 'tutar', op: 'gt', value: 1000 } },
          then: { type: 'tag', tag: 'buyuk' },
          else: { type: 'say', template_key: 'bekle' },
        },
        { id: 'devir', type: 'handoff', reason_code: 'needs_finance' },
      ),
    );
    expect(procedure.steps[1]).toMatchObject({ then: { type: 'tag', tag: 'buyuk' } });

    for (const then of [
      { type: 'collect', slots: ['tutar'] },
      { type: 'tool', tool_key: 'x', active: false },
      { goto: 'devir', type: 'say' },
      'devir',
    ]) {
      expect(
        codesOf(
          withSteps(
            { id: 'sor', type: 'collect', slots: ['tutar'] },
            { id: 'k', type: 'check', when: { slot: { name: 'tutar', op: 'exists' } }, then },
          ),
        ),
      ).toEqual(['procedure_step_bad_option']);
    }
    // An id or a guard has no place on a step inside a branch.
    expect(
      codesOf(
        withSteps({
          id: 'k',
          type: 'check',
          when: { slot: { name: 'tutar', op: 'exists' } },
          then: { id: 'x', type: 'tag', tag: 'y' },
        }),
      ),
    ).toEqual(['procedure_unknown_field']);
  });
});

describe('conditions — the fixed language (no free expression)', () => {
  it.each<[string, unknown, ProcedureProblemCode | SlotProblemCode]>([
    ['not an object', 'tutar > 5', 'procedure_bad_condition'],
    [
      'two keys',
      { slot: { name: 'tutar', op: 'exists' }, ai: { question: 'x' } },
      'procedure_bad_condition',
    ],
    ['an unknown key', { expr: 'tutar > 5' }, 'procedure_bad_condition'],
    ['an empty all', { all: [] }, 'procedure_bad_condition'],
    [
      'eleven conditions in an any',
      { any: Array.from({ length: 11 }, () => ({ slot: { name: 'tutar', op: 'exists' } })) },
      'procedure_bad_condition',
    ],
    [
      'an extra field in slot',
      { slot: { name: 'tutar', op: 'exists', eval: '1' } },
      'procedure_bad_condition',
    ],
    [
      'a slot that is not defined',
      { slot: { name: 'bakiye', op: 'exists' } },
      'slot_unknown_reference',
    ],
    [
      'an unknown operator',
      { slot: { name: 'tutar', op: 'between', value: 5 } },
      'procedure_bad_comparison',
    ],
    [
      'an ordering on text',
      { slot: { name: 'not', op: 'gt', value: 'a' } },
      'procedure_bad_comparison',
    ],
    [
      'matches on a quantity',
      { slot: { name: 'tutar', op: 'matches', value: '^1' } },
      'procedure_bad_comparison',
    ],
    [
      'an ordering on a moment',
      { slot: { name: 'islem_zamani', op: 'lt', value: 5 } },
      'procedure_bad_comparison',
    ],
    [
      'exists with a value',
      { slot: { name: 'tutar', op: 'exists', value: 5 } },
      'procedure_bad_comparison',
    ],
    ['eq with no value', { slot: { name: 'tutar', op: 'eq' } }, 'procedure_bad_comparison'],
    [
      'a yes/no compared with text',
      { slot: { name: 'talep', op: 'eq', value: 'evet' } },
      'procedure_bad_comparison',
    ],
    [
      'an amount compared with text',
      { slot: { name: 'tutar', op: 'gt', value: '1000' } },
      'procedure_bad_comparison',
    ],
    [
      'an empty in list',
      { slot: { name: 'kanal', op: 'in', value: [] } },
      'procedure_bad_comparison',
    ],
    [
      'an option the slot does not have',
      { slot: { name: 'kanal', op: 'eq', value: 'Telefon' } },
      'procedure_bad_comparison',
    ],
    [
      'an option list with one the slot does not have',
      { slot: { name: 'kanal', op: 'in', value: ['web', 'Masaüstü'] } },
      'procedure_bad_comparison',
    ],
    [
      'a pattern that repeats a repeated group',
      { slot: { name: 'not', op: 'matches', value: '(a+)+$' } },
      'procedure_bad_comparison',
    ],
    [
      'a pattern that does not compile',
      { slot: { name: 'not', op: 'matches', value: '(' } },
      'procedure_bad_comparison',
    ],
    [
      'text compared with a quantity fact',
      { slot: { name: 'not', op: 'eq', value: { fact: 'method.min_amount' } } },
      'procedure_bad_comparison',
    ],
    [
      'a value that is two references',
      { slot: { name: 'tutar', op: 'eq', value: { slot: 'tutar', fact: 'method.min_amount' } } },
      'procedure_bad_comparison',
    ],
    [
      'a reference to an undefined slot',
      { slot: { name: 'tutar', op: 'gt', value: { slot: 'limit' } } },
      'slot_unknown_reference',
    ],
    ['an unknown fact', { fact: { path: 'method.fee', op: 'exists' } }, 'procedure_unknown_fact'],
    [
      'an unknown fact as a value',
      { slot: { name: 'tutar', op: 'gt', value: { fact: 'method.fee' } } },
      'procedure_unknown_fact',
    ],
    [
      'a bonus fact with no bonus slot',
      { fact: { path: 'bonus.max_bet', op: 'gt', value: 5 } },
      'procedure_fact_without_source',
    ],
    [
      'an unknown function',
      { fn: { name: 'now', args: [], op: 'exists' } },
      'procedure_unknown_function',
    ],
    [
      'a function with too few arguments',
      { fn: { name: 'within_working_hours', args: ['method'] } },
      'procedure_bad_function_args',
    ],
    [
      'a function given a non-datetime slot',
      { fn: { name: 'elapsed_minutes', args: ['tutar'], op: 'gt', value: 30 } },
      'procedure_bad_function_args',
    ],
    [
      'a function given something other than method',
      { fn: { name: 'next_window', args: ['yontem'], op: 'exists' } },
      'procedure_bad_function_args',
    ],
    [
      'a function given an undefined slot',
      { fn: { name: 'elapsed_minutes', args: ['zaman'], op: 'gt', value: 30 } },
      'slot_unknown_reference',
    ],
    [
      'a quantity function with no operator',
      { fn: { name: 'elapsed_minutes', args: ['islem_zamani'] } },
      'procedure_bad_comparison',
    ],
    [
      'a function with a value but no operator',
      { fn: { name: 'within_working_hours', args: ['method', 'islem_zamani'], value: true } },
      'procedure_bad_comparison',
    ],
    ['an ai condition with no question', { ai: { question: ' ' } }, 'procedure_bad_condition'],
    [
      'two ai questions in one step',
      { all: [{ ai: { question: 'Sinirli mi?' } }, { not: { ai: { question: 'Acil mi?' } } }] },
      'procedure_ai_condition_repeated',
    ],
    [
      `nesting deeper than ${COND_DEPTH_MAX}`,
      { not: { not: { not: { not: { not: { slot: { name: 'tutar', op: 'exists' } } } } } } },
      'procedure_condition_too_deep',
    ],
  ])('refuses %s', (_name, when, code) => {
    expect(codesOf(withCondition(when))).toEqual([code]);
  });

  it('places a problem inside the condition it is in', () => {
    expect(
      problemsOf(
        withCondition({
          all: [
            { slot: { name: 'tutar', op: 'exists' } },
            { not: { slot: { name: 'x', op: 'exists' } } },
          ],
        }),
      ),
    ).toEqual([
      expect.objectContaining({
        code: 'slot_unknown_reference',
        step_id: 'kontrol',
        field: 'when',
        path: 'when.all[1].not.slot',
        slot: 'x',
      }),
    ]);
  });

  it.each<[string, unknown]>([
    [
      'a quantity against a fact',
      { slot: { name: 'tutar', op: 'lt', value: { fact: 'method.min_amount' } } },
    ],
    [
      'a quantity against another slot',
      { slot: { name: 'tutar', op: 'gte', value: { slot: 'tutar' } } },
    ],
    ['an option, in any case', { slot: { name: 'kanal', op: 'in', value: ['web', 'MOBİL'] } }],
    ['a pattern on text', { slot: { name: 'not', op: 'matches', value: '^PPR-\\d+$' } }],
    ['a yes/no slot', { slot: { name: 'talep', op: 'neq', value: true } }],
    ['a moment that is there', { slot: { name: 'islem_zamani', op: 'missing' } }],
    [
      'a fact of the method',
      { fact: { path: 'method.requires_site_request', op: 'eq', value: true } },
    ],
    [
      'a yes/no function on its own',
      { fn: { name: 'within_working_hours', args: ['method', 'islem_zamani'] } },
    ],
    [
      'a quantity function',
      {
        fn: {
          name: 'elapsed_minutes',
          args: ['islem_zamani'],
          op: 'gt',
          value: { fact: 'method.delay_threshold_minutes' },
        },
      },
    ],
    ['the next window, known', { fn: { name: 'next_window', args: ['method'], op: 'exists' } }],
    [
      'nesting five deep',
      { not: { not: { not: { not: { slot: { name: 'tutar', op: 'exists' } } } } } },
    ],
    [
      'one ai question',
      {
        any: [
          { ai: { question: 'Oyuncu sinirli mi?' } },
          { slot: { name: 'tutar', op: 'exists' } },
        ],
      },
    ],
  ])('accepts %s', (_name, when) => {
    valid(withCondition(when));
  });

  it('reads the method from the payment-method slot: without one, method facts and functions are unknown', () => {
    const noMethod = withCondition({
      fn: { name: 'within_working_hours', args: ['method', 'islem_zamani'] },
    });
    (noMethod['slots'] as Json[]).splice(0, 1);
    noMethod['steps'] = (noMethod['steps'] as Json[]).slice(1);
    noMethod['templates'] = [];
    expect(problemsOf(noMethod)).toEqual([
      expect.objectContaining({ code: 'procedure_fact_without_source', reference: 'method' }),
    ]);
  });

  it('judges a slot’s required.when in the same language', () => {
    const procedure = base();
    (procedure['slots'] as Json[]).push({
      name: 'txid',
      label: 'TXID',
      type: 'txid',
      ask: 'TXID nedir?',
      required: { when: { slot: { name: 'ag', op: 'exists' } } },
    });
    expect(problemsOf(procedure)).toEqual([
      expect.objectContaining({
        code: 'slot_unknown_reference',
        section: 'slots',
        index: 6,
        slot: 'txid',
        field: 'required',
        path: 'required.when.slot',
        reference: 'ag',
      }),
    ]);
  });

  it('keys each ai question by its step, slot or hand-over condition', () => {
    const procedure = base();
    procedure['steps'] = [
      {
        id: 'sor',
        type: 'collect',
        slots: ['yontem'],
        when: { ai: { question: 'Oyuncu yöntem belirtti mi?' } },
      },
      {
        id: 'devir',
        type: 'handoff',
        reason_code: 'needs_finance',
        when: { not: { ai: { question: 'Konu kapandı mı?' } } },
      },
    ];
    (procedure['slots'] as Json[]).push({
      name: 'dekont',
      label: 'Dekont',
      type: 'file',
      ask: 'Dekontu paylaşır mısınız?',
      required: { when: { ai: { question: 'Oyuncu dekontu olduğunu söyledi mi?' } } },
    });
    procedure['handoff'] = {
      conditions: [
        { slot: { name: 'tutar', op: 'exists' } },
        { ai: { question: 'Oyuncu çok sinirli mi?' } },
      ],
    };
    expect(procedureAiQuestions(valid(procedure))).toEqual([
      { key: 'sor', question: 'Oyuncu yöntem belirtti mi?' },
      { key: 'devir', question: 'Konu kapandı mı?' },
      { key: 'slot.dekont', question: 'Oyuncu dekontu olduğunu söyledi mi?' },
      { key: 'handoff.1', question: 'Oyuncu çok sinirli mi?' },
    ]);
  });
});

describe('templates and their {variables}', () => {
  it('parses the three kinds of variable and nothing else', () => {
    expect(parseProcedureReference(' yontem ')).toEqual({ kind: 'slot', name: 'yontem' });
    expect(parseProcedureReference('method.expected_minutes')).toEqual({
      kind: 'fact',
      path: 'method.expected_minutes',
    });
    expect(parseProcedureReference('within_working_hours(method, islem_zamani)')).toEqual({
      kind: 'fn',
      name: 'within_working_hours',
      args: ['method', 'islem_zamani'],
    });
    expect(parseProcedureReference('now()')).toEqual({ kind: 'fn', name: 'now', args: [] });
    for (const text of ['yöntem', 'a b', 'a.b.c', 'Yontem', '1x', 'f(g(x))', '']) {
      expect(parseProcedureReference(text)).toBeNull();
    }
    expect(templateReferences('{a} ve {b.c} — {} {f(x)} } {')).toEqual(['a', 'b.c', '', 'f(x)']);
  });

  it.each<[string, string, ProcedureProblemCode | SlotProblemCode]>([
    ['a Turkish name', '{yöntem}', 'procedure_unknown_variable'],
    ['an undefined slot', '{bakiye}', 'procedure_unknown_variable'],
    ['an unknown fact', '{method.fee}', 'procedure_unknown_variable'],
    ['an unknown function', '{now()}', 'procedure_unknown_variable'],
    ['empty braces', 'Merhaba {}', 'procedure_unknown_variable'],
    ['a function given the wrong slot', '{elapsed_minutes(tutar)}', 'procedure_bad_function_args'],
    ['a fact with no source slot', '{bonus.max_bet}', 'procedure_fact_without_source'],
  ])('refuses %s', (_name, text, code) => {
    expect(codesOf({ ...base(), templates: [{ key: 'bekle', text }] })).toEqual([code]);
  });

  it('allows the placeholders a template leaves for the tenant', () => {
    const procedure = {
      ...base(),
      templates: [{ key: 'bekle', text: 'Şikâyetiniz {şikâyet_süresi} içinde yanıtlanır.' }],
    };
    expect(codesOf(procedure)).toEqual(['procedure_unknown_variable']);
    expect(validateProcedure(procedure, { placeholders: new Set(['şikâyet_süresi']) }).ok).toBe(
      true,
    );
  });

  it('refuses a malformed template list or template', () => {
    expect(codesOf({ ...base(), templates: 'bekle' })).toContain('procedure_bad_template');
    const many = Array.from({ length: PROCEDURE_TEMPLATES_MAX + 1 }, (_, i) => ({
      key: `k${i}`,
      text: 'x',
    }));
    expect(codesOf({ ...base(), templates: many })).toContain('procedure_bad_template');
    expect(
      problemsOf({
        ...base(),
        templates: [
          { key: 'bekle', text: 'a' },
          { key: 'bekle', text: 'b' },
          { key: 'Kalip A', text: 'c' },
          { key: 'bos', text: ' ' },
          { key: 'yasal', text: 'd', verbatim: 'evet' },
          { key: 'ek', text: 'e', lang: 'tr' },
          'f',
        ],
      }).map((p) => [p.code, p.index, p.field]),
    ).toEqual([
      ['procedure_duplicate_template', 1, 'key'],
      ['procedure_bad_template', 2, 'key'],
      ['procedure_bad_template', 3, 'text'],
      ['procedure_bad_template', 4, 'verbatim'],
      ['procedure_unknown_field', 5, 'lang'],
      ['procedure_bad_template', 6, undefined],
    ]);
  });

  it('keeps a verbatim notice as written', () => {
    const procedure = valid({
      ...base(),
      templates: [
        { key: 'bekle', text: 'x' },
        { key: 'yasal', text: ' Kumar bağımlılık yapabilir. ', verbatim: true },
      ],
    });
    expect(procedure.templates[1]).toEqual({
      key: 'yasal',
      text: 'Kumar bağımlılık yapabilir.',
      verbatim: true,
    });
  });
});

describe('the hand-over (AI-09, AI-10, AI-12)', () => {
  it.each<[string, unknown, ProcedureProblemCode]>([
    ['a team name', 'Finans', 'procedure_bad_target'],
    ['a team id of zero', { group_id: 0 }, 'procedure_bad_target'],
    ['a team id as text', { group_id: '7' }, 'procedure_bad_target'],
    ['a team and a topic', { group_id: 7, topic: 'finance' }, 'procedure_bad_target'],
    ['a topic that is not a key', { topic: 'Finans Ekibi' }, 'procedure_bad_target'],
    ['a topic the routes do not have', { topic: 'trading' }, 'procedure_unknown_target'],
  ])('refuses %s as the target', (_name, target, code) => {
    expect(
      codesOf(
        { ...base(), handoff: { target } },
        { groupIds: new Set([7]), topics: new Set(['finance']) },
      ),
    ).toEqual([code]);
  });

  it('checks the conditions, the card fields and the next-step hint', () => {
    const problems = problemsOf({
      ...base(),
      handoff: {
        conditions: [
          { slot: { name: 'tutar', op: 'gt', value: 5000 } },
          { slot: { name: 'limit', op: 'exists' } },
        ],
        card_fields: ['tutar', 'method.expected_minutes', 'bakiye', 'method.fee', 'now()', 'a b'],
        next_step_hint: '{yontem} için {panel} kontrolü',
      },
    });
    expect(problems.map((p) => [p.code, p.field, p.index ?? p.reference])).toEqual([
      ['slot_unknown_reference', 'conditions', 1],
      ['slot_unknown_reference', 'card_fields', 'bakiye'],
      ['procedure_unknown_fact', 'card_fields', 'method.fee'],
      ['procedure_unknown_function', 'card_fields', 'now()'],
      ['procedure_unknown_variable', 'card_fields', 'a b'],
      ['procedure_unknown_variable', 'next_step_hint', 'panel'],
    ]);
  });

  it('refuses a hand-over that is not an object, or has unknown or malformed fields', () => {
    expect(codesOf({ ...base(), handoff: [] })).toEqual(['procedure_bad_handoff']);
    expect(codesOf({ ...base(), handoff: { team: 7 } })).toEqual(['procedure_unknown_field']);
    expect(codesOf({ ...base(), handoff: { conditions: {} } })).toEqual(['procedure_bad_handoff']);
    expect(codesOf({ ...base(), handoff: { card_fields: ['tutar', 'tutar'] } })).toEqual([
      'procedure_bad_handoff',
    ]);
    expect(codesOf({ ...base(), handoff: { next_step_hint: '' } })).toEqual([
      'procedure_bad_handoff',
    ]);
  });
});

describe('the procedure’s own fields', () => {
  it.each<[string, Json, ProcedureProblemCode]>([
    ['no when_to_use', { when_to_use: undefined }, 'procedure_needs_when_to_use'],
    ['a blank when_to_use', { when_to_use: '  ' }, 'procedure_needs_when_to_use'],
    ['examples that are not a list', { examples: 'param yatmadı' }, 'procedure_bad_examples'],
    ['an empty example', { examples: ['param yatmadı', ''] }, 'procedure_bad_examples'],
    ['a priority of zero', { priority: 0 }, 'procedure_bad_priority'],
    ['a fractional priority', { priority: 1.5 }, 'procedure_bad_priority'],
    ['max_turns of zero', { limits: { max_turns: 0 } }, 'procedure_bad_limits'],
    ['max_turns over fifty', { limits: { max_turns: 51 } }, 'procedure_bad_limits'],
    ['an unknown limit', { limits: { max_turns: 12, max_minutes: 30 } }, 'procedure_bad_limits'],
    ['an unknown field', { workflow: { nodes: [] } }, 'procedure_unknown_field'],
  ])('refuses %s', (_name, change, code) => {
    expect(codesOf({ ...base(), ...change })).toEqual([code]);
  });

  it('refuses what is not an object at all', () => {
    for (const value of [null, 'procedure', [], 5]) {
      expect(validateProcedure(value)).toEqual({
        ok: false,
        problems: [
          {
            code: 'procedure_not_object',
            section: 'procedure',
            message: 'procedure must be an object',
          },
        ],
        warnings: [],
      });
    }
  });

  it('refuses a slot list that is not one, as slots.ts words it', () => {
    expect(problemsOf({ ...base(), slots: {} })[0]).toEqual({
      code: 'slots_not_array',
      section: 'slots',
      message: 'slots must be an array',
    });
  });
});

describe('locked procedures: texts and the team change, the structure does not', () => {
  const stored = valid(deposit());
  const locked = { locked: stored };

  it('accepts the stored procedure as it is', () => {
    expect(validateProcedure(deposit(), locked).ok).toBe(true);
  });

  it('accepts new wording and a new team', () => {
    const next = deposit();
    (next['templates'] as Json[])[0] = { key: 'giris', text: 'Anlıyorum, birlikte bakalım.' };
    (next['steps'] as Json[])[6] = {
      ...(next['steps'] as Json[])[6],
      then: {
        type: 'handoff',
        reason_code: 'third_party_payment',
        instruction: 'Kuralı nazikçe anlat.',
      },
    };
    (next['steps'] as Json[])[12] = { ...(next['steps'] as Json[])[12], target: { group_id: 4 } };
    (next['slots'] as Json[])[2] = {
      ...(next['slots'] as Json[])[2],
      label: 'Miktar',
      ask: 'Yatırdığınız tutar nedir?',
    };
    next['handoff'] = {
      ...(next['handoff'] as Json),
      target: { group_id: 4 },
      next_step_hint: 'Sağlayıcı panelinde eşleştir.',
    };
    expect(validateProcedure(next, locked).ok).toBe(true);
  });

  it.each<[string, (next: Json) => void, string]>([
    [
      'a step type',
      (next) => ((next['steps'] as Json[])[0] = { id: 'karsilama', type: 'answer_from_knowledge' }),
      'steps',
    ],
    ['a step removed', (next) => (next['steps'] as Json[]).splice(11, 1), 'steps'],
    [
      'a branch target',
      (next) =>
        ((next['steps'] as Json[])[2] = {
          ...(next['steps'] as Json[])[2],
          then: { goto: 'mesai' },
        }),
      'steps',
    ],
    ['the trigger', (next) => (next['when_to_use'] = 'Her mesaj.'), 'procedure'],
    ['an example', (next) => (next['examples'] as string[]).pop(), 'procedure'],
    [
      'a slot type',
      (next) =>
        ((next['slots'] as Json[])[2] = { ...(next['slots'] as Json[])[2], type: 'number' }),
      'slots',
    ],
    [
      'a template added',
      (next) => (next['templates'] as Json[]).push({ key: 'yeni', text: 'x' }),
      'templates',
    ],
    [
      'a template made verbatim',
      (next) => ((next['templates'] as Json[])[0] = { key: 'giris', text: 'x', verbatim: true }),
      'templates',
    ],
    [
      'a hand-over condition',
      (next) => (next['handoff'] = { ...(next['handoff'] as Json), conditions: [] }),
      'handoff',
    ],
    ['the turn limit', (next) => (next['limits'] = { max_turns: 20 }), 'limits'],
  ])('refuses a change to %s', (_name, change, section) => {
    const next = deposit();
    change(next);
    const result = validateProcedure(next, locked);
    expect(result.ok ? [] : result.problems.map((p) => [p.code, p.section])).toEqual([
      ['procedure_locked_change', section],
    ]);
  });
});

describe('warnings: a step nothing reaches is saved and flagged', () => {
  it('flags the steps after an ending step that no goto names', () => {
    const result = validateProcedure(
      withSteps(
        { id: 'devir', type: 'handoff', reason_code: 'needs_finance' },
        { id: 'unutulan', type: 'say', instruction: 'x' },
        { id: 'son', type: 'resolve', outcome: 'resolved' },
      ),
    );
    expect(result.ok).toBe(true);
    expect(result.warnings).toEqual([
      {
        code: 'procedure_unreachable_step',
        section: 'steps',
        index: 1,
        step_id: 'unutulan',
        message: 'step unutulan: no path from the first step reaches it',
      },
      expect.objectContaining({ index: 2, step_id: 'son' }),
    ]);
  });

  it('reaches past an ending step with a guard, and anything a goto names', () => {
    expect(
      validateProcedure(
        withSteps(
          { id: 'sor', type: 'collect', slots: ['tutar'] },
          {
            id: 'k',
            type: 'check',
            when: { slot: { name: 'tutar', op: 'gt', value: 5 } },
            then: { goto: 'buyuk' },
          },
          {
            id: 'devir',
            type: 'handoff',
            reason_code: 'needs_finance',
            when: { slot: { name: 'talep', op: 'eq', value: false } },
          },
          { id: 'kucuk', type: 'resolve', outcome: 'resolved' },
          { id: 'buyuk', type: 'handoff', reason_code: 'large_amount' },
        ),
      ).warnings,
    ).toEqual([]);
  });
});

describe('problems on the wire', () => {
  it('gives a 1-based position, the names and no sentence', () => {
    const [problem] = problemsOf(
      withSteps(
        { id: 'sor', type: 'collect', slots: ['tutar'] },
        {
          id: 'k',
          type: 'check',
          when: { slot: { name: 'x', op: 'exists' } },
          then: { goto: 'sor' },
        },
      ),
    );
    expect(problem && procedureProblemDetails(problem)).toEqual({
      reason: 'slot_unknown_reference',
      section: 'steps',
      position: 2,
      step_id: 'k',
      field: 'when',
      path: 'when.slot',
      slot: 'x',
      reference: 'x',
    });
    expect(
      procedureProblemDetails({
        code: 'procedure_needs_steps',
        section: 'steps',
        message: 'steps must be a non-empty list',
      }),
    ).toEqual({ reason: 'procedure_needs_steps', section: 'steps' });
  });

  it('produces every procedure problem code', () => {
    const deep = (n: number): unknown =>
      n === 0 ? { slot: { name: 'tutar', op: 'exists' } } : { not: deep(n - 1) };
    const fixtures: Array<[unknown, ProcedureValidationContext?]> = [
      ['x'],
      [{ ...base(), extra: 1 }],
      [{ ...base(), when_to_use: '' }],
      [{ ...base(), examples: 'x' }],
      [{ ...base(), priority: 0 }],
      [{ ...base(), limits: { max_turns: 0 } }],
      [{ ...base(), steps: [] }],
      [
        {
          ...base(),
          steps: Array.from({ length: PROCEDURE_STEPS_MAX + 1 }, (_, i) => ({
            id: `s${i}`,
            type: 'say',
            instruction: 'x',
          })),
        },
      ],
      [withSteps('x' as unknown as Json)],
      [withSteps({ id: 'X', type: 'say', instruction: 'x' })],
      [withSteps({ id: 'a', type: 'tag', tag: 'x' }, { id: 'a', type: 'tag', tag: 'y' })],
      [withSteps({ id: 'a', type: 'nope' })],
      [withSteps({ id: 'a', type: 'tag', tag: '' })],
      [withSteps({ id: 'a', type: 'say' })],
      [withSteps({ id: 'a', type: 'collect', slots: [] })],
      [withSteps({ id: 'a', type: 'collect', slots: ['yontem', 'tutar', 'talep'] })],
      [withSteps({ id: 'a', type: 'check', when: { slot: { name: 'tutar', op: 'exists' } } })],
      [
        withSteps({
          id: 'a',
          type: 'check',
          when: { slot: { name: 'tutar', op: 'exists' } },
          then: { goto: 'b' },
        }),
      ],
      [
        withSteps({
          id: 'a',
          type: 'check',
          when: { slot: { name: 'tutar', op: 'exists' } },
          then: { goto: 'a' },
        }),
      ],
      [withSteps({ id: 'a', type: 'tool', tool_key: 'x', active: true })],
      [withCondition('x')],
      [withCondition(deep(COND_DEPTH_MAX))],
      [withCondition({ slot: { name: 'tutar', op: 'x' } })],
      [withCondition({ fact: { path: 'x.y', op: 'exists' } })],
      [withCondition({ fact: { path: 'bonus.max_bet', op: 'exists' } })],
      [withCondition({ fn: { name: 'x', args: [] } })],
      [withCondition({ fn: { name: 'next_window', args: [], op: 'exists' } })],
      [withCondition({ all: [{ ai: { question: 'a' } }, { ai: { question: 'b' } }] })],
      [{ ...base(), templates: 'x' }],
      [
        {
          ...base(),
          templates: [
            { key: 'bekle', text: 'a' },
            { key: 'bekle', text: 'b' },
          ],
        },
      ],
      [withSteps({ id: 'a', type: 'say', template_key: 'yok' })],
      [{ ...base(), templates: [{ key: 'bekle', text: '{x y}' }] }],
      [{ ...base(), handoff: 'x' }],
      [{ ...base(), handoff: { target: 'x' } }],
      [{ ...base(), handoff: { target: { group_id: 2 } } }, { groupIds: new Set([1]) }],
      [{ ...base(), priority: 7 }, { locked: valid(base()) }],
    ];
    // The fallback rule needs the agent's other skills, which only the server reads.
    const seen = new Set<string>([fallbackTakenProblem('Genel').code]);
    for (const [fixture, context] of fixtures) {
      for (const code of codesOf(fixture, context)) seen.add(code);
    }
    expect(PROCEDURE_PROBLEM_CODES.filter((code) => !seen.has(code))).toEqual([]);
  });
});

/** `base()` as a skill writes it: the skill's own fields beside `procedure` (#296.2). */
function skillFields(): Json {
  const { when_to_use, examples, priority, slots, ...procedure } = base();
  return { when_to_use, examples, priority, slots, procedure };
}

describe('the skill row: a procedure split across the skill’s fields (#296.2)', () => {
  it('judges the skill’s fields and its procedure as one definition, round-tripping through the split', () => {
    const result = validateSkillProcedure(skillFields());
    if (!result.ok) throw new Error(JSON.stringify(result.problems));
    expect(result.procedure).toStrictEqual(valid(base()));

    const split = splitSkillProcedure(result.procedure);
    expect(Object.keys(split.procedure).sort()).toEqual([...SKILL_PROCEDURE_FIELDS].sort());
    expect(split.priority).toBe(100);
    expect(validateSkillProcedure(split)).toMatchObject({ ok: true, procedure: result.procedure });
  });

  it('refuses what validateProcedure refuses, with the same codes', () => {
    const fields = skillFields();
    const procedure = fields['procedure'] as Json;
    const broken = {
      ...fields,
      procedure: { ...procedure, steps: [{ id: 'sor', type: 'collect', slots: ['a', 'b', 'c'] }] },
    };
    const result = validateSkillProcedure(broken);
    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.problems.map((p) => p.code)).toContain(
      'procedure_collect_too_many_slots',
    );
  });

  it('needs a procedure object, holding only its four fields', () => {
    for (const procedure of [undefined, null, 'x', []]) {
      const result = validateSkillProcedure({ ...skillFields(), procedure });
      expect(result.ok ? null : result.problems.map((p) => [p.code, p.field])).toEqual([
        ['procedure_not_object', 'procedure'],
      ]);
    }
    const fields = skillFields();
    const result = validateSkillProcedure({
      ...fields,
      procedure: { ...(fields['procedure'] as Json), priority: 5, trigger: {} },
    });
    expect(result.ok ? null : result.problems.map((p) => [p.code, p.field])).toEqual([
      ['procedure_unknown_field', 'priority'],
      ['procedure_unknown_field', 'trigger'],
    ]);
  });

  it('gives a null field its default — when_to_use has none', () => {
    const result = validateSkillProcedure({ ...skillFields(), examples: null, priority: null });
    expect(result.ok && [result.procedure.examples, result.procedure.priority]).toEqual([[], 100]);
    const missing = validateSkillProcedure({ ...skillFields(), when_to_use: null });
    expect(missing.ok ? [] : missing.problems.map((p) => p.code)).toEqual([
      'procedure_needs_when_to_use',
    ]);
  });
});

describe('a skill’s selection fields, in either mode (#296.2)', () => {
  it('lets a single skill go without when_to_use, and judges what it gives by the procedure’s rules', () => {
    expect(validateSkillSelection({})).toEqual([]);
    expect(validateSkillSelection({ when_to_use: null, examples: ['a'], priority: 1 })).toEqual([]);
    expect(
      validateSkillSelection({ when_to_use: ' ', examples: ['a', ''], priority: 0 }).map(
        (p) => p.code,
      ),
    ).toEqual(['procedure_needs_when_to_use', 'procedure_bad_examples', 'procedure_bad_priority']);
    expect(validateSkillSelection({ when_to_use: 'x'.repeat(1001) }).map((p) => p.code)).toEqual([
      'procedure_needs_when_to_use',
    ]);
    expect(validateSkillSelection({ priority: 1001 }).map((p) => p.field)).toEqual(['priority']);
    expect(validateSkillSelection({ priority: 2.5 }).map((p) => p.field)).toEqual(['priority']);
  });

  it('is what validateProcedure runs, with when_to_use required', () => {
    expect(codesOf({ ...base(), when_to_use: undefined, priority: 0 })).toEqual([
      'procedure_needs_when_to_use',
      'procedure_bad_priority',
    ]);
  });
});
