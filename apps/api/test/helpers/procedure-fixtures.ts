/**
 * The procedure the AI-03 acceptance runs on (tm 296.3): research §3.1 "Para
 * yatırdım hesabıma geçmedi", as the procedure language writes it — method
 * and time, then the elapsed time against the method's expected time (A: wait),
 * the method's working hours (B: next window), the site request (C: finance),
 * the sender, the amount against the method's range, the username and the
 * reference, the passive lookup, and finance (D) — with the payment-method
 * table it reads as fixture facts (AI-13 lands with #310).
 */
import { validateProcedure, type Procedure } from '@siyahtus/types';
import {
  fixtureFacts,
  type FactsFixture,
  type ProcedureFacts,
} from '../../src/services/ai/conversation/procedure/conditions.js';
import type { ProcedureUnderstanding } from '../../src/services/ai/conversation/procedure/understanding.js';
import type { SlotEnumOption } from '../../src/services/ai/conversation/slots/validators.js';

export const DEPOSIT_TEMPLATES = {
  giris: 'Yaşadığınız durumu anlıyorum, hemen birlikte bakalım.',
  normal_sure:
    '{yontem} ile yapılan yatırımlar genellikle {method.expected_minutes} içinde hesaba yansır. İşleminiz {elapsed_minutes(islem_zamani)} önce yapılmış; hâlâ normal süre içinde.',
  mesai_disi:
    '{yontem} işlemleri {method.working_hours} arasında işlenir. Talebiniz bir sonraki işlem penceresinde ({next_window(method)}) değerlendirilecek.',
  talep_yok:
    'Bu yöntemle gönderimden önce site üzerinden yatırım talebi oluşturulması gerekiyor. Bilgilerinizi finans ekibimize iletiyorum.',
  takip: '{method.expected_minutes} dolduğunda bakiye görünmezse bu sohbete yazın.',
} as const;

/** The definition as an author writes it — what `POST /skills` takes. */
export function depositDefinition(): Record<string, unknown> {
  return {
    when_to_use: 'Oyuncu yaptığı yatırımın hesabına geçmediğini söylüyor.',
    examples: [
      'param yatmadı',
      'yatırım yaptım bakiyem gelmedi',
      'havale attım gözükmüyor',
      'papara ile yatırdım düşmedi',
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
      {
        id: 'bekleme',
        type: 'say',
        template_key: 'normal_sure',
        instruction: 'Yatırımın hâlâ normal süre içinde olduğunu söyle, biraz beklemesini rica et.',
      },
      {
        id: 'bekleme_bitti',
        type: 'resolve',
        outcome: 'resolved_waiting',
        followup_template: 'takip',
      },
      {
        id: 'mesai',
        type: 'say',
        template_key: 'mesai_disi',
        instruction: 'Yöntemin mesai saatleri dışında işlendiğini söyle.',
      },
      { id: 'mesai_bitti', type: 'resolve', outcome: 'resolved_waiting' },
    ],
    templates: Object.entries(DEPOSIT_TEMPLATES).map(([key, text]) => ({ key, text })),
    handoff: {
      conditions: [{ slot: { name: 'tutar', op: 'gt', value: 100000 } }],
      target: { topic: 'finance' },
      card_fields: ['method.expected_minutes', 'elapsed_minutes(islem_zamani)'],
      next_step_hint: '{yontem} referansı ile ödeme sağlayıcı panelinde eşleştirme.',
    },
    limits: { max_turns: 12 },
  };
}

/** The definition, validated — every default filled in, as a snapshot holds it. */
export function depositProcedure(edit?: (raw: Record<string, unknown>) => void): Procedure {
  const raw = depositDefinition();
  edit?.(raw);
  const result = validateProcedure(raw);
  if (!result.ok) throw new Error(JSON.stringify(result.problems, null, 2));
  return result.procedure;
}

/** The payment-method table's Papara row, as facts (AI-13). */
export function depositFacts(overrides: FactsFixture = {}): ProcedureFacts {
  return fixtureFacts({
    facts: {
      'method.name': 'Papara',
      'method.expected_minutes': 30,
      'method.delay_threshold_minutes': 60,
      'method.working_hours': '09:00–18:00',
      'method.min_amount': 100,
      'method.max_amount': 50000,
      'method.receipt_required': false,
      'method.requires_site_request': true,
      ...overrides.facts,
    },
    withinWorkingHours: overrides.withinWorkingHours ?? (() => true),
    nextWindow: overrides.nextWindow ?? (() => new Date('2026-10-19T06:00:00Z')),
  });
}

/** The deposit methods `yontem` names (the table's rows, #310). */
export const DEPOSIT_OPTIONS: Readonly<Record<string, readonly SlotEnumOption[]>> = {
  yontem: [{ value: 'Papara' }, { value: 'Havale', aliases: ['eft'] }],
};

/**
 * An understanding that heard `items` — `[slot, the player's words]` — as an
 * answer to the question the AI is waiting on.
 */
export function heard(...items: Array<[string, string]>): ProcedureUnderstanding {
  return {
    intent: { procedure_key: null, confidence: 0, is_continuation: true },
    answers_pending_question: items.length > 0,
    yes_no: null,
    extracted: items.map(([slot, raw_text]) => ({ slot, raw_text, confidence: 0.9 })),
    ai_conditions: {},
  };
}
