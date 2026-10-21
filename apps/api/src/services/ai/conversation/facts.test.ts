/**
 * The structured tables' facts (tm 310.3 · AI-13 §1, §4, §5; AI-03 `fact` /
 * `fn`; AI-06 §3): brand priority, the working hours on the method's own
 * clock, the facts a procedure reads from the row its slot names — the §3.1
 * deposit procedure's 20- and 95-minute branches on real rows — and the exact
 * answer to a question about one row.
 *
 * Pure: the rows are written out; reading them under a tenant is the
 * integration test's (`knowledge-tables-facts.test.ts`).
 */
import { describe, expect, it } from 'vitest';
import {
  type BonusFields,
  type KbRuleFields,
  type KycDocumentFields,
  type PaymentMethodFields,
  type PaymentWorkingHours,
  type SlotDef,
} from '@siyahtus/types';
import {
  DEPOSIT_TEMPLATES,
  depositProcedure,
  depositThresholdProcedure,
  heard,
} from '../../../../test/helpers/procedure-fixtures.js';
import {
  amountInRange,
  answerFromTables,
  factTablesOf,
  nextWorkingWindow,
  procedureFactsOf,
  tableSlotOptions,
  withinWorkingHours,
  type FactRow,
  type FactTables,
} from './facts.js';
import { runProcedureTurn, type ProcedureTurnResult } from './procedure/executor.js';
import type { ProcedureUnderstanding } from './procedure/understanding.js';

const BRAND_A = '00000000-0000-4000-8000-00000000000a';

/** Monday to Friday, 09:00–18:00 in Istanbul (UTC+3 all year). */
const WEEKDAYS_9_TO_6: PaymentWorkingHours = {
  timezone: 'Europe/Istanbul',
  windows: (['monday', 'tuesday', 'wednesday', 'thursday', 'friday'] as const).map((day) => ({
    day,
    start: '09:00',
    end: '18:00',
  })),
  closed_on_bank_holidays: true,
};

function method(overrides: Partial<PaymentMethodFields> = {}): PaymentMethodFields {
  return {
    name: 'Papara',
    aliases: ['PPR'],
    direction: 'deposit',
    currency: 'TRY',
    min_amount: 100,
    max_amount: 50000,
    expected_minutes: 30,
    delay_threshold_minutes: 60,
    working_hours: null,
    requires_site_request: true,
    reference_instructions: null,
    reference_format: 'none',
    receipt_required: false,
    third_party_allowed: false,
    networks: [],
    common_errors: [],
    customer_notes: null,
    active: true,
    ...overrides,
  };
}

function bonus(overrides: Partial<BonusFields> = {}): BonusFields {
  return {
    name: 'Hoş geldin bonusu',
    aliases: ['hoşgeldin'],
    type: 'welcome',
    min_deposit: 250,
    wagering_multiplier: 10,
    wagering_base: 'bonus',
    contributing: [],
    min_odds: 1.5,
    max_bet: 500,
    max_cashout: 5000,
    validity_days: 7,
    claim_method: 'code',
    promo_code: 'HOSGELDIN',
    excluded_method_ids: [],
    active_from: null,
    active_to: null,
    terms_text: null,
    ...overrides,
  };
}

function kyc(overrides: Partial<KycDocumentFields> = {}): KycDocumentFields {
  return {
    doc_type: 'Kimlik kartı',
    acceptance_criteria: ['Ön ve arka yüz', 'Süresi geçmemiş'],
    when_required: null,
    review_hours: 24,
    upload_path_text: 'Hesabım › Doğrulama',
    chat_upload_allowed: false,
    ...overrides,
  };
}

function rule(overrides: Partial<KbRuleFields> = {}): KbRuleFields {
  return {
    key: 'daily_withdrawal_limit',
    category: 'limits',
    title: 'Günlük çekim limiti',
    value_text: null,
    numeric_value: 100000,
    unit: 'TRY',
    description: null,
    ...overrides,
  };
}

let ids = 0;
function row<F>(fields: F, brandIds: string[] = []): FactRow<F> {
  ids += 1;
  return { id: `row-${ids}`, brandIds, fields };
}

function tables(rows: Partial<FactTables> = {}): FactTables {
  return { payment_methods: [], bonuses: [], kyc_documents: [], rules: [], ...rows };
}

describe('the working hours, on the method’s own clock (AI-13 §1)', () => {
  it('is open inside a window — start included, end not — and closed outside it or on a day off', () => {
    const at = (iso: string) => withinWorkingHours(WEEKDAYS_9_TO_6, new Date(iso));
    // Monday 19 October 2026, Istanbul = UTC+3.
    expect(at('2026-10-19T05:59:00Z')).toBe(false);
    expect(at('2026-10-19T06:00:00Z')).toBe(true);
    expect(at('2026-10-19T14:59:00Z')).toBe(true);
    expect(at('2026-10-19T15:00:00Z')).toBe(false);
    // Saturday at noon.
    expect(at('2026-10-24T09:00:00Z')).toBe(false);
  });

  it('reads no hours as around the clock, a 24:00 end as the end of the day, and an unreadable zone as unknown', () => {
    expect(withinWorkingHours(null, new Date('2026-10-24T23:30:00Z'))).toBe(true);
    const lateShift: PaymentWorkingHours = {
      timezone: 'Europe/Istanbul',
      windows: [{ day: 'monday', start: '20:00', end: '24:00' }],
      closed_on_bank_holidays: false,
    };
    expect(withinWorkingHours(lateShift, new Date('2026-10-19T20:59:00Z'))).toBe(true);
    expect(withinWorkingHours(lateShift, new Date('2026-10-19T21:00:00Z'))).toBe(false);
    expect(
      withinWorkingHours(
        { ...lateShift, timezone: 'Mars/Olympus' },
        new Date('2026-10-19T20:00:00Z'),
      ),
    ).toBeNull();
  });

  it('gives the next window: now when open, today’s opening, after the lunch break, Monday after a Friday evening', () => {
    expect(nextWorkingWindow(WEEKDAYS_9_TO_6, new Date('2026-10-19T08:00:00Z'))).toEqual(
      new Date('2026-10-19T08:00:00Z'),
    );
    expect(nextWorkingWindow(WEEKDAYS_9_TO_6, new Date('2026-10-19T04:00:00Z'))).toEqual(
      new Date('2026-10-19T06:00:00Z'),
    );
    // Friday 23 October, 19:00 in Istanbul → Monday 26 October, 09:00.
    expect(nextWorkingWindow(WEEKDAYS_9_TO_6, new Date('2026-10-23T16:00:00Z'))).toEqual(
      new Date('2026-10-26T06:00:00Z'),
    );
    const split: PaymentWorkingHours = {
      timezone: 'Europe/Istanbul',
      windows: [
        { day: 'monday', start: '09:00', end: '12:00' },
        { day: 'monday', start: '13:00', end: '17:00' },
      ],
      closed_on_bank_holidays: false,
    };
    expect(nextWorkingWindow(split, new Date('2026-10-19T09:30:00Z'))).toEqual(
      new Date('2026-10-19T10:00:00Z'),
    );
    expect(nextWorkingWindow(null, new Date('2026-10-24T23:30:00Z'))).toEqual(
      new Date('2026-10-24T23:30:00Z'),
    );
  });

  it('keeps a window at its local time across a daylight-saving change (London, 25 October 2026)', () => {
    const london: PaymentWorkingHours = {
      timezone: 'Europe/London',
      windows: [
        { day: 'friday', start: '09:00', end: '17:00' },
        { day: 'monday', start: '09:00', end: '17:00' },
      ],
      closed_on_bank_holidays: false,
    };
    // Friday 08:30 BST (UTC+1) → 09:00 BST = 08:00Z.
    expect(nextWorkingWindow(london, new Date('2026-10-23T07:30:00Z'))).toEqual(
      new Date('2026-10-23T08:00:00Z'),
    );
    // Saturday → Monday 09:00 GMT = 09:00Z, after the clocks went back.
    expect(nextWorkingWindow(london, new Date('2026-10-24T12:00:00Z'))).toEqual(
      new Date('2026-10-26T09:00:00Z'),
    );
    expect(withinWorkingHours(london, new Date('2026-10-26T08:30:00Z'))).toBe(false);
    expect(withinWorkingHours(london, new Date('2026-10-26T09:00:00Z'))).toBe(true);
  });

  it('holds an amount to the limits the row sets, an unset one not bounding', () => {
    expect(amountInRange(method(), 99)).toBe(false);
    expect(amountInRange(method(), 100)).toBe(true);
    expect(amountInRange(method(), 50000)).toBe(true);
    expect(amountInRange(method(), 50001)).toBe(false);
    expect(amountInRange(method({ min_amount: null, max_amount: null }), 1)).toBe(true);
  });
});

describe('one brand’s view of the tables (AI-13 §5, §7)', () => {
  const NOW = new Date('2026-10-19T10:00:00Z');

  it('lets a brand’s row win over the every-brand row of the same name and direction — an inactive one too', () => {
    const everyBrand = row(method({ expected_minutes: 30 }));
    const brands = row(method({ expected_minutes: 15 }), [BRAND_A]);
    const withdrawal = row(method({ direction: 'withdrawal', expected_minutes: 120 }));
    const havale = row(method({ name: 'Havale', aliases: [] }));
    const offForBrand = row(method({ name: 'Havale', aliases: [], active: false }), [BRAND_A]);
    const read = factTablesOf(
      {
        payment_methods: [everyBrand, brands, withdrawal, havale, offForBrand],
        bonuses: [],
        kyc_documents: [],
        rules: [],
      },
      NOW,
    );
    expect(read.payment_methods.map((r) => r.id)).toEqual([
      brands.id,
      withdrawal.id,
      offForBrand.id,
    ]);
    // The brand switched Havale off: no option, and the every-brand row does not come back.
    expect(tableSlotOptions(read, depositProcedure().slots as SlotDef[])).toEqual({
      yontem: [{ value: 'Papara', aliases: ['PPR'] }],
    });
  });

  it('reads only the bonuses whose campaign is running', () => {
    const running = row(bonus({ name: 'A', aliases: [], active_from: '2026-10-01T00:00:00Z' }));
    const over = row(bonus({ name: 'B', aliases: [], active_to: '2026-10-18T00:00:00Z' }));
    const later = row(bonus({ name: 'C', aliases: [], active_from: '2026-11-01T00:00:00Z' }));
    const always = row(bonus({ name: 'D', aliases: [] }));
    const read = factTablesOf(
      {
        payment_methods: [],
        bonuses: [running, over, later, always],
        kyc_documents: [],
        rules: [],
      },
      NOW,
    );
    expect(read.bonuses.map((r) => r.id)).toEqual([running.id, always.id]);
  });
});

describe('the facts a procedure reads from the row its slot names (AI-03 · AI-13 §1)', () => {
  const defs = depositProcedure().slots as SlotDef[];
  const papara = row(method({ working_hours: WEEKDAYS_9_TO_6 }));
  const paparaOut = row(method({ direction: 'withdrawal', expected_minutes: 240 }));
  const off = row(method({ name: 'Havale', aliases: ['EFT'], active: false }));
  const read = tables({ payment_methods: [papara, paparaOut, off] });
  const facts = procedureFactsOf(read, defs);
  const named = (value: string) => ({
    yontem: { status: 'filled', value, display: value, source: 'player' },
  });

  it('answers from the active deposit row the slot names — nothing before it is named, nothing for an inactive one', () => {
    expect(facts.get('method.expected_minutes', named('Papara'))).toBe(30);
    expect(facts.get('method.min_amount', named('Papara'))).toBe(100);
    expect(facts.get('method.requires_site_request', named('Papara'))).toBe(true);
    expect(facts.get('method.reference_instructions', named('Papara'))).toBeNull();
    expect(facts.get('method.working_hours', named('Papara'))).toBe(
      'Pazartesi 09:00–18:00; Salı 09:00–18:00; Çarşamba 09:00–18:00; Perşembe 09:00–18:00; Cuma 09:00–18:00; diğer günler kapalı (saat dilimi: Europe/Istanbul); banka tatillerinde işlem yapılmaz',
    );
    expect(facts.get('method.expected_minutes', {})).toBeNull();
    expect(facts.get('method.expected_minutes', named('Havale'))).toBeNull();
    expect(facts.get('bonus.min_deposit', named('Papara'))).toBeNull();
  });

  it('reads the working hours of that row, and the next window after a moment', () => {
    expect(facts.withinWorkingHours(new Date('2026-10-24T09:00:00Z'), named('Papara'))).toBe(false);
    expect(facts.nextWindow(new Date('2026-10-24T09:00:00Z'), named('Papara'))).toEqual(
      new Date('2026-10-26T06:00:00Z'),
    );
    expect(facts.withinWorkingHours(new Date('2026-10-24T09:00:00Z'), {})).toBeNull();
  });

  it('a withdrawal slot reads the withdrawal row of the same name', () => {
    const withdrawalDefs = defs.map((def) =>
      def.name === 'yontem'
        ? { ...def, validate: { enum_source: 'payment_methods.withdrawal' as const } }
        : def,
    );
    expect(
      procedureFactsOf(read, withdrawalDefs).get('method.expected_minutes', named('Papara')),
    ).toBe(240);
  });
});

describe('the §3.1 deposit procedure on table rows (AI-13 acceptance)', () => {
  const procedure = depositThresholdProcedure();
  const papara = row(method({ working_hours: WEEKDAYS_9_TO_6 }));
  const havale = row(method({ name: 'Havale', aliases: ['EFT'], working_hours: WEEKDAYS_9_TO_6 }));
  const read = tables({ payment_methods: [papara, havale] });
  const defs = procedure.slots as SlotDef[];

  function turn(
    now: Date,
    text: string,
    understanding: ProcedureUnderstanding | null,
    before: { at: { stepId: string | null } | null; slots: Record<string, unknown> },
  ): ProcedureTurnResult {
    return runProcedureTurn({
      procedure,
      at: before.at,
      slots: before.slots,
      procedureTurns: 0,
      turn: 1,
      understanding,
      messages: [text],
      now,
      timeZone: 'Europe/Istanbul',
      currency: 'TRY',
      facts: procedureFactsOf(read, defs),
      options: tableSlotOptions(read, defs),
      language: 'tr',
    });
  }

  function twoTurns(now: Date, second: string, time: string): ProcedureTurnResult {
    const first = turn(now, 'param yatmadı', null, { at: null, slots: {} });
    expect(first.end).toEqual({ kind: 'awaiting', stepId: 'yontem_zaman' });
    return turn(now, second, heard(['yontem', second.split(' ')[0]!], ['islem_zamani', time]), {
      at: { stepId: 'yontem_zaman' },
      slots: first.slots,
    });
  }

  it('20 minutes into Papara’s 30: the wait template, with the row’s expected time (AI-13 acceptance 1)', () => {
    // Monday 13:40 → 14:00 in Istanbul.
    const result = twoTurns(new Date('2026-10-19T11:00:00Z'), 'paparayla 13:40', '13:40');
    expect(result.parts[0]).toMatchObject({
      kind: 'template',
      text: 'Papara ile yapılan yatırımlar genellikle 30 dk içinde hesaba yansır. İşleminiz 20 dk önce yapılmış; hâlâ normal süre içinde.',
    });
    expect(result.end).toMatchObject({ kind: 'confirming', stepId: 'bekleme_bitti' });
    expect(result.trace.find((step) => step.step_id === 'sure_icinde')?.cond_result).toBe(true);
  });

  it('95 minutes past Papara’s 60-minute threshold: the threshold branch hands over to finance (AI-13 acceptance 1)', () => {
    // Monday 12:25 → 14:00 in Istanbul, inside the method's hours.
    const result = twoTurns(new Date('2026-10-19T11:00:00Z'), 'papara 12:25', '12:25');
    expect(result.trace.map((step) => [step.step_id, step.cond_result])).toEqual(
      expect.arrayContaining([
        ['sure_icinde', false],
        ['esik_asildi', true],
      ]),
    );
    expect(result.parts[0]).toMatchObject({
      text: 'Papara için 1 saat gecikme sınırı aşıldı (1 saat 35 dk). Sizi finans ekibimize aktarıyorum.',
    });
    expect(result.end).toEqual({
      kind: 'handoff',
      stepId: 'esik_devir',
      reason: 'expected_time_exceeded',
      target: { topic: 'finance' },
    });
  });

  it('an EFT sent on Saturday is outside the working hours: the next processing window (AI-13 acceptance 6)', () => {
    // Saturday 24 October, 11:00 → 11:40 in Istanbul: 40 minutes, past 30, under 60.
    const result = twoTurns(new Date('2026-10-24T08:40:00Z'), 'eft 11:00', '11:00');
    expect(result.trace.find((step) => step.step_id === 'mesai_disi')?.cond_result).toBe(true);
    expect(result.parts[0]).toMatchObject({
      kind: 'template',
      text: expect.stringContaining('bir sonraki işlem penceresinde (26.10.2026 09:00)'),
    });
    expect(result.parts[0]).toMatchObject({
      text: expect.stringMatching(/^Havale işlemleri Pazartesi/),
    });
  });

  it('a method no row names cannot fill the slot, and no fact is read', () => {
    const first = turn(new Date('2026-10-19T11:00:00Z'), 'param yatmadı', null, {
      at: null,
      slots: {},
    });
    const second = turn(
      new Date('2026-10-19T11:00:00Z'),
      'bitcoin 13:40',
      heard(['yontem', 'bitcoin'], ['islem_zamani', '13:40']),
      { at: { stepId: 'yontem_zaman' }, slots: first.slots },
    );
    expect(second.end).toEqual({ kind: 'awaiting', stepId: 'yontem_zaman' });
    expect(DEPOSIT_TEMPLATES.normal_sure).toContain('{method.expected_minutes}');
    expect(second.parts.map((part) => part.kind)).not.toContain('template');
  });
});

describe('the exact answer from a row (AI-06 §3 · AI-13 §4)', () => {
  const paparaIn = row(method({ working_hours: WEEKDAYS_9_TO_6 }));
  const paparaOut = row(
    method({ direction: 'withdrawal', min_amount: 200, max_amount: null, expected_minutes: 240 }),
  );
  const havale = row(method({ name: 'Havale', aliases: ['EFT'], max_amount: null }));
  const astropay = row(method({ name: 'AstroPay', aliases: [], active: false }));
  const welcome = row(bonus());
  const id = row(kyc());
  const limit = row(rule());
  const read = tables({
    payment_methods: [paparaIn, paparaOut, havale, astropay],
    bonuses: [welcome],
    kyc_documents: [id],
    rules: [limit],
  });
  const ask = (message: string, language: 'tr' | 'en' | 'de' | null = 'tr') =>
    answerFromTables(read, { message, language, currency: 'TRY' });

  it('"Papara ile en az ne kadar yatırabilirim?" is the row’s value exactly (AI-13 acceptance 2)', () => {
    expect(ask('Papara ile en az ne kadar yatırabilirim?')).toEqual({
      text: 'Papara ile en az 100 TRY yatırabilirsiniz.',
      factIds: [paparaIn.id],
    });
    expect(ask('paparayla max kaç tl yatırılır')?.text).toBe(
      'Papara ile en fazla 50.000 TRY yatırabilirsiniz.',
    );
    expect(ask('PPR limitleri nedir, yatırım için?')?.text).toBe(
      'Papara ile en az 100 TRY yatırabilirsiniz. Papara ile en fazla 50.000 TRY yatırabilirsiniz.',
    );
  });

  it('takes the direction from the words when a name is in both, and gives none when they do not say', () => {
    expect(ask('Papara ile en az ne kadar çekebilirim?')).toEqual({
      text: 'Papara ile en az 200 TRY çekebilirsiniz.',
      factIds: [paparaOut.id],
    });
    expect(ask('Papara çekimi ne kadar sürede hesabıma geçer?')?.text).toBe(
      'Papara ile yapılan çekimler genellikle 4 saat içinde hesabınıza ulaşır.',
    );
    expect(ask('Papara en az ne kadar?')).toBeNull();
  });

  it('answers the time, the hours, the receipt, a third party and the site request from the row', () => {
    expect(ask('havale ne kadar sürede hesaba geçer')?.text).toBe(
      'Havale ile yapılan yatırımlar genellikle 30 dakika içinde hesaba geçer.',
    );
    expect(ask('Papara yatırım saat kaça kadar?')?.text).toBe(
      'Papara işlem saatleri: Pazartesi 09:00–18:00; Salı 09:00–18:00; Çarşamba 09:00–18:00; Perşembe 09:00–18:00; Cuma 09:00–18:00; diğer günler kapalı (saat dilimi: Europe/Istanbul); banka tatillerinde işlem yapılmaz.',
    );
    expect(ask('EFT için dekont lazım mı?')?.text).toBe(
      'Havale ile yapılan işlemlerde dekont gerekmez.',
    );
    expect(ask('havale ile başkasının hesabından yatırabilir miyim')?.text).toBe(
      'Havale ile yalnız kendi adınıza kayıtlı hesaptan işlem yapabilirsiniz.',
    );
    expect(ask('Havale için talep oluşturmam gerekir mi?')?.text).toBe(
      'Havale ile göndermeden önce site üzerinden talep oluşturmanız gerekir.',
    );
  });

  it('checks an amount the player names against the limits', () => {
    expect(ask('Papara ile 50 TL yatırabilir miyim?')?.text).toBe(
      'Papara ile 50 TRY yatıramazsınız; sınırlar: en az 100 TRY, en fazla 50.000 TRY.',
    );
    expect(ask('Papara ile 2.500 TL yatırabilir miyim?')?.text).toBe(
      'Papara ile 2.500 TRY yatırabilirsiniz; sınırlar: en az 100 TRY, en fazla 50.000 TRY.',
    );
  });

  it('leaves to the search what the row does not hold, an unknown property, two rows named, and another language', () => {
    expect(ask('Havale ile en fazla ne kadar yatırabilirim?')).toBeNull();
    expect(ask('Papara yatırımı nasıl yapılır?')).toBeNull();
    expect(ask('Papara mı havale mi en az ne kadar yatırılır?')).toBeNull();
    expect(ask('Hoş geldin bonusu Papara yatırımında en az ne kadar?')).toBeNull();
    expect(ask('Papara mindestens Einzahlung?', 'de')).toBeNull();
    expect(ask('Kripto ile en az ne kadar yatırabilirim?')).toBeNull();
  });

  it('says an inactive method is not available', () => {
    expect(ask('AstroPay ile en az ne kadar yatırabilirim?')).toEqual({
      text: 'AstroPay şu an kullanılamıyor.',
      factIds: [astropay.id],
    });
  });

  it('gives wagering only as a general example — never what is left on the player’s account (AI-13 §2)', () => {
    expect(ask('hoş geldin bonusu çevrim şartı ne')?.text).toBe(
      'Hoş geldin bonusu için çevrim şartı bonus tutarının 10 katıdır.',
    );
    expect(ask('hoşgeldin bonusunda 200 TL bonusla ne kadar çevrim yapmam lazım')?.text).toBe(
      'Hoş geldin bonusu için çevrim şartı bonus tutarının 10 katıdır. Genel bir örnek: bonus 200 ise gerekli çevrim 200 × 10 = 2.000 olur.',
    );
    const left = ask('hoşgeldin bonusu kalan çevrimim ne kadar')?.text ?? '';
    expect(left).toContain('Hesabınıza özel kalan çevrim tutarını buradan göremiyorum.');
    expect(left).not.toMatch(/kalan çevriminiz/i);
  });

  it('answers the bonus’s own limits, validity and how it is claimed', () => {
    expect(ask('hoşgeldin bonusu için en az ne kadar yatırmalıyım')?.text).toBe(
      'Hoş geldin bonusu için en az 250 yatırım gerekir.',
    );
    expect(ask('hoşgeldin bonusu minimum oran kaç')?.text).toBe(
      'Hoş geldin bonusu için en düşük oran 1,5.',
    );
    expect(ask('hoşgeldin bonusu max bahis')?.text).toBe(
      'Hoş geldin bonusu kullanılırken en yüksek bahis 500.',
    );
    expect(ask('hoşgeldin bonusu kaç gün geçerli')?.text).toBe(
      'Hoş geldin bonusu 7 gün geçerlidir.',
    );
    expect(ask('hoşgeldin bonusu nasıl alınır')?.text).toBe(
      'Hoş geldin bonusu promosyon koduyla alınır: HOSGELDIN.',
    );
  });

  it('answers a KYC document’s review time, where it is uploaded and what is accepted', () => {
    expect(ask('kimlik kartı ne kadar sürede onaylanır')?.text).toBe(
      'Kimlik kartı incelemesi genellikle 1 gün içinde sonuçlanır.',
    );
    expect(ask('kimlik kartı nereye yüklenir')?.text).toBe(
      'Kimlik kartı belgesini şuradan yükleyebilirsiniz: Hesabım › Doğrulama. Belge bu sohbetten kabul edilmez.',
    );
    expect(ask('kimlik kartı kabul şartları neler')?.text).toBe(
      'Kimlik kartı için kabul koşulları: Ön ve arka yüz; Süresi geçmemiş.',
    );
  });

  it('answers a rule named by its title with its value', () => {
    expect(ask('Günlük çekim limiti ne kadar?')).toEqual({
      text: 'Günlük çekim limiti: 100.000 TRY.',
      factIds: [limit.id],
    });
  });

  it('answers in English when the reply is English', () => {
    expect(ask('What is the minimum deposit with Papara?', 'en')?.text).toBe(
      'With Papara you can deposit at least 100 TRY.',
    );
    expect(ask('How long does a Havale deposit take?', 'en')?.text).toBe(
      'Havale deposits usually arrive within 30 minutes.',
    );
    // The hours in words are Turkish only: the search answers.
    expect(ask('Papara deposit working hours?', 'en')).toBeNull();
  });
});
