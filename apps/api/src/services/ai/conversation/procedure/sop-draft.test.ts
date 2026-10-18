/**
 * The SOP → draft procedure writers (tm 296.4 · AI-03 §11): the rule-based
 * skeleton the `mock` provider gets, the mapping of a model's structured
 * answer, and the save-time verdict both carry.
 */
import { describe, expect, it } from 'vitest';
import { validateSkillProcedure } from '@siyahtus/types';
import {
  assertStrictJsonSchema,
  exampleForSchema,
  validateJson,
} from '../../provider/json-schema.js';
import {
  SOP_DRAFT_SCHEMA,
  SOP_HANDOFF_REASON,
  draftFromModel,
  judgeDraft,
  skeletonFromSop,
  type SopModelDraft,
} from './sop-draft.js';

/** The research §3.1 SOP, as a support lead writes it for people. */
const DEPOSIT_SOP = [
  'Yatırım geçmedi:',
  'Oyuncu "param yatmadı" ya da "yatırımım gelmedi" der.',
  '1. Oyuncuya hemen bakacağımızı söyle.',
  '2. Ödeme yöntemini ve işlem saatini sor.',
  '3. Beklenen süreyle karşılaştır.',
  '4. Eğer süre geçtiyse dekontu iste.',
  '5. Finans ekibine devret.',
].join('\n');

const types = (steps: Array<Record<string, unknown>>) => steps.map((step) => step['type']);

describe('skeletonFromSop — the rule-based draft (AI-03 §11)', () => {
  it('drafts the §3.1 SOP: heading, quoted examples, one step a line, a valid definition', () => {
    const { draft, unrecognised } = skeletonFromSop(DEPOSIT_SOP);

    expect(draft.source).toBe('rules');
    expect(draft.name).toBe('Yatırım geçmedi');
    expect(draft.when_to_use).toBe('Yatırım geçmedi');
    expect(draft.examples).toEqual(['param yatmadı', 'yatırımım gelmedi']);
    expect(types(draft.procedure.steps)).toEqual(['say', 'collect', 'handoff']);
    expect(draft.procedure.steps[0]).toEqual({
      id: 'say_1',
      type: 'say',
      instruction: 'Oyuncuya hemen bakacağımızı söyle.',
    });
    expect(draft.procedure.steps[1]).toEqual({
      id: 'collect_1',
      type: 'collect',
      slots: ['odeme_yontemini', 'islem_saatini'],
    });
    // No team: routing decides until the author names one (AI-12).
    expect(draft.procedure.steps[2]).toEqual({
      id: 'handoff_1',
      type: 'handoff',
      reason_code: SOP_HANDOFF_REASON,
      instruction: 'Finans ekibine devret.',
    });
    expect(draft.slots).toEqual([
      {
        name: 'odeme_yontemini',
        label: 'Ödeme yöntemini',
        type: 'text',
        ask: 'Ödeme yöntemini paylaşır mısınız?',
      },
      {
        name: 'islem_saatini',
        label: 'İşlem saatini',
        type: 'datetime',
        ask: 'İşlem saatini paylaşır mısınız?',
      },
    ]);
    // Judged as a save would judge it — and a save would store it.
    expect(draft.problems).toEqual([]);
    expect(validateSkillProcedure(draft).ok).toBe(true);

    // Every line that compares or branches is the author's to write as a condition.
    expect(unrecognised).toEqual([
      'Oyuncu "param yatmadı" ya da "yatırımım gelmedi" der.',
      'Beklenen süreyle karşılaştır.',
      'Eğer süre geçtiyse dekontu iste.',
    ]);
  });

  it('never writes a condition: no check, no when, no hand-over condition', () => {
    const { draft } = skeletonFromSop(
      'yöntem/saat sor → beklenen süreyle karşılaştır → bekleme ya da talep/hesap/dekont sor → çöz ya da finansa devret',
    );
    for (const step of draft.procedure.steps) {
      expect(step['type']).not.toBe('check');
      expect(step).not.toHaveProperty('when');
    }
    expect(draft).not.toHaveProperty('handoff');
    expect(types(draft.procedure.steps)).toEqual(['collect']);
  });

  it('splits on arrows, "sonra" and list markers, and asks at most two slots a step', () => {
    const { draft } = skeletonFromSop(
      'Kullanıcı adı, e-posta, telefon ve tutarı sor sonra dekontu iste → bekle',
    );
    expect(draft.procedure.steps).toEqual([
      { id: 'collect_1', type: 'collect', slots: ['kullanici_adi', 'e_posta'] },
      { id: 'collect_2', type: 'collect', slots: ['telefon', 'tutari'] },
      { id: 'collect_3', type: 'collect', slots: ['dekontu'] },
      {
        id: 'resolve_1',
        type: 'resolve',
        outcome: 'resolved_waiting',
        instruction: 'bekle',
      },
    ]);
    expect(draft.slots.map((slot) => [slot['name'], slot['type']])).toEqual([
      ['kullanici_adi', 'username'],
      ['e_posta', 'email'],
      ['telefon', 'phone'],
      ['tutari', 'money'],
      ['dekontu', 'file'],
    ]);
    expect(draft.slots.at(-1)?.['ask']).toBe('Dekontu gönderebilir misiniz?');
    expect(draft.problems).toEqual([]);
  });

  it('reads an English SOP the same way, with English questions', () => {
    const { draft, unrecognised } = skeletonFromSop(
      [
        'Deposit missing',
        '- Ask for the payment method and the time',
        '- Tell them deposits arrive within 30 minutes',
        '- If it is later than that, ask for the receipt',
        '- Answer from the knowledge base',
        '- Tag it as deposit_issue',
        '- Hand over to finance',
      ].join('\n'),
    );
    expect(draft.name).toBe('Deposit missing');
    expect(types(draft.procedure.steps)).toEqual([
      'collect',
      'say',
      'answer_from_knowledge',
      'tag',
      'handoff',
    ]);
    expect(draft.procedure.steps[3]).toEqual({ id: 'tag_1', type: 'tag', tag: 'deposit_issue' });
    expect(draft.slots.map((slot) => slot['ask'])).toEqual([
      'Could you share your payment method?',
      'Could you share your time?',
    ]);
    expect(unrecognised).toEqual(['If it is later than that, ask for the receipt']);
    expect(draft.problems).toEqual([]);
  });

  it('asks for one slot once: the same words on two lines are the same slot', () => {
    const { draft } = skeletonFromSop(
      'Tutarı sor.\nTutarı tekrar teyit etmek için sor.\nTutarı sor.',
    );
    expect(draft.slots.map((slot) => slot['name'])).toEqual([
      'tutari',
      'tutari_tekrar_teyit_etmek_icin',
    ]);
    expect(draft.procedure.steps.map((step) => step['slots'])).toEqual([
      ['tutari'],
      ['tutari_tekrar_teyit_etmek_icin'],
      ['tutari'],
    ]);
  });

  it('shows a forbidden slot as the problem a save would refuse — it does not hide it', () => {
    const { draft } = skeletonFromSop('Hesap şifresini sor.\nFinansa devret.');
    expect(draft.problems).toContainEqual(
      expect.objectContaining({ reason: 'slot_sensitive_forbidden', section: 'slots' }),
    );
    expect(validateSkillProcedure(draft).ok).toBe(false);
  });

  it('a text with no step in it is a draft with the problem named, never an invented step', () => {
    const { draft, unrecognised } = skeletonFromSop('Genel bilgi\nBu konu önemlidir.');
    expect(draft.procedure.steps).toEqual([]);
    expect(draft.problems).toContainEqual(
      expect.objectContaining({ reason: 'procedure_needs_steps' }),
    );
    expect(unrecognised).toEqual(['Bu konu önemlidir.']);
  });
});

describe('the model draft (ADR §6a structured output)', () => {
  it('asks for a schema inside the strict subset, which its own example satisfies', () => {
    expect(() => assertStrictJsonSchema('sop_procedure_draft', SOP_DRAFT_SCHEMA)).not.toThrow();
    expect(validateJson(exampleForSchema(SOP_DRAFT_SCHEMA), SOP_DRAFT_SCHEMA)).toBeNull();
  });

  const answer: SopModelDraft = {
    name: 'Yatırım geçmedi',
    when_to_use: 'Oyuncu yatırımının hesaba geçmediğini söylüyor.',
    examples: [' param yatmadı ', ''],
    slots: [
      { name: 'yontem', label: 'Ödeme yöntemi', type: 'text', ask: 'Hangi yöntemle yatırdınız?' },
      { name: 'zaman', label: 'İşlem zamanı', type: 'datetime', ask: 'Ne zaman yatırdınız?' },
    ],
    steps: [
      {
        id: 'giris',
        type: 'say',
        instruction: null,
        slots: [],
        template_key: 'giris',
        reason_code: 'ignored_on_a_say',
        outcome: null,
        tag: null,
      },
      {
        id: 'sor',
        type: 'collect',
        instruction: null,
        slots: ['yontem', 'zaman'],
        template_key: null,
        reason_code: null,
        outcome: 'resolved',
        tag: null,
      },
      {
        id: 'devir',
        type: 'handoff',
        instruction: 'Finansa devret.',
        slots: [],
        template_key: null,
        reason_code: null,
        outcome: null,
        tag: null,
      },
    ],
    templates: [{ key: 'giris', text: 'Hemen bakalım.' }],
    unrecognised: ['Beklenen süreyle karşılaştır.', ' '],
  };

  it('keeps only the fields each step type has, and is judged like a save', () => {
    const { draft, unrecognised } = draftFromModel(answer);
    expect(draft.source).toBe('model');
    expect(draft.examples).toEqual(['param yatmadı']);
    expect(draft.procedure.steps).toEqual([
      { id: 'giris', type: 'say', template_key: 'giris' },
      { id: 'sor', type: 'collect', slots: ['yontem', 'zaman'] },
      {
        id: 'devir',
        type: 'handoff',
        reason_code: SOP_HANDOFF_REASON,
        instruction: 'Finansa devret.',
      },
    ]);
    expect(draft.problems).toEqual([]);
    expect(unrecognised).toEqual(['Beklenen süreyle karşılaştır.']);
  });

  it('passes a mistake the model made on to the validator, named, rather than fixing it', () => {
    const wrong: SopModelDraft = {
      ...answer,
      steps: [
        { ...answer.steps[1]!, slots: ['yontem', 'hesap_no'] },
        { ...answer.steps[0]!, template_key: 'yok_boyle_kalip' },
      ],
    };
    const { draft } = draftFromModel(wrong);
    expect(draft.problems.map((problem) => problem.reason)).toEqual(
      expect.arrayContaining(['slot_unknown_reference', 'procedure_unknown_template']),
    );
  });

  it('judges against the license teams it is given, as the save does', () => {
    const { draft } = draftFromModel(answer);
    const withTeam = {
      ...draft,
      procedure: {
        ...draft.procedure,
        steps: [
          ...draft.procedure.steps.slice(0, 2),
          { id: 'devir', type: 'handoff', reason_code: 'x', target: { group_id: 9 } },
        ],
      },
    };
    expect(judgeDraft(withTeam, 'model', { groupIds: new Set([1]) }).problems).toContainEqual(
      expect.objectContaining({ reason: 'procedure_unknown_target' }),
    );
    expect(judgeDraft(withTeam, 'model', { groupIds: new Set([9]) }).problems).toEqual([]);
  });
});
