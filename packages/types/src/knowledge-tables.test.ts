import { describe, expect, it } from 'vitest';
import {
  AI_ACCESS_INFO_CACHE_SECONDS,
  KNOWLEDGE_TABLES,
  KNOWLEDGE_TABLE_COLUMNS,
  KNOWLEDGE_TABLE_REQUIRED_FIELDS,
  KNOWLEDGE_TABLE_PATH_SEGMENTS,
  KNOWLEDGE_TABLE_REVIEW_INTERVAL_DAYS,
  KNOWLEDGE_TABLE_SQL_NAMES,
  PAYMENT_REFERENCE_FORMATS,
  PAYMENT_REFERENCE_FORMAT_PATTERNS,
  findKnowledgeTableConflicts,
  formatMinutesTr,
  formatWorkingHoursTr,
  isKnowledgeTable,
  isKnowledgeTableRowStale,
  knowledgeTableBrandScopesClash,
  knowledgeTableRowLabel,
  knowledgeTableRowReviewDueAt,
  knowledgeTableRowServesBrand,
  matchesPaymentReferenceFormat,
  normalizeKnowledgeTableName,
  preferBrandRows,
  renderRowText,
  validateAiAccessInfo,
  validateBonus,
  validateKbRule,
  validateKnowledgeTableRow,
  validateKycDocument,
  validatePaymentMethod,
  validatePaymentWorkingHours,
  type BonusFields,
  type KbRuleFields,
  type KnowledgeTableProblem,
  type KycDocumentFields,
  type PaymentMethodFields,
  type PaymentWorkingHours,
} from './knowledge-tables.js';
import { KNOWLEDGE_REVIEW_INTERVAL_DAYS } from './knowledge-store.js';

const BRAND_A = '11111111-1111-4111-8111-111111111111';
const BRAND_B = '22222222-2222-4222-8222-222222222222';
const METHOD_ID = '33333333-3333-4333-8333-333333333333';

/** The research's example row: Papara · deposit · expected 30 min · delayed past 60 · 7/24. */
const PAPARA: PaymentMethodFields = {
  name: 'Papara',
  aliases: ['PPR'],
  direction: 'deposit',
  currency: 'TRY',
  min_amount: 100,
  max_amount: 50_000,
  expected_minutes: 30,
  delay_threshold_minutes: 60,
  working_hours: null,
  requires_site_request: false,
  reference_instructions: 'Açıklamaya kullanıcı adınızı yazın.',
  reference_format: 'username',
  receipt_required: true,
  third_party_allowed: false,
  networks: [],
  common_errors: [
    {
      code: 'NAME_MISMATCH',
      title: 'İsim uyuşmazlığı',
      customer_text: 'Gönderen hesap adı üyelik adınızla aynı olmalıdır.',
      agent_hint: 'Finans ekibine isim kontrolü için aktar.',
    },
  ],
  customer_notes: null,
  active: true,
};

/** EFT: weekdays in two windows, closed on bank holidays. */
const EFT_HOURS: PaymentWorkingHours = {
  timezone: 'Europe/Istanbul',
  windows: [
    { day: 'monday', start: '09:00', end: '12:00' },
    { day: 'monday', start: '13:00', end: '17:00' },
    { day: 'tuesday', start: '09:00', end: '17:00' },
  ],
  closed_on_bank_holidays: true,
};

const BONUS: BonusFields = {
  name: 'Hoş Geldin',
  aliases: ['ilk yatırım bonusu'],
  type: 'welcome',
  min_deposit: 100,
  wagering_multiplier: 10,
  wagering_base: 'bonus_plus_deposit',
  contributing: [
    { category: 'slot', percent: 100 },
    { category: 'canlı casino', percent: 10 },
  ],
  min_odds: 1.5,
  max_bet: 50,
  max_cashout: 5000,
  validity_days: 7,
  claim_method: 'code',
  promo_code: 'HOSGELDIN',
  excluded_method_ids: [METHOD_ID],
  active_from: '2026-10-01T00:00:00+03:00',
  active_to: '2026-10-31T23:59:00+03:00',
  terms_text: null,
};

const KYC: KycDocumentFields = {
  doc_type: 'Kimlik kartı',
  acceptance_criteria: ['Ön ve arka yüz', 'Süresi geçmemiş'],
  when_required: 'İlk çekimden önce.',
  review_hours: 24,
  upload_path_text: 'Hesabım › Belgeler',
  chat_upload_allowed: false,
};

const RULE: KbRuleFields = {
  key: 'daily_withdrawal_limit',
  category: 'withdrawal',
  title: 'Günlük çekim limiti',
  value_text: null,
  numeric_value: 50_000,
  unit: 'TRY',
  description: null,
};

const fields = (problems: KnowledgeTableProblem[]) => problems.map((p) => `${p.field}:${p.code}`);

describe('knowledge tables — vocabulary (AI-13 · tm 310.1)', () => {
  it('names the four fixed tables, their database names, URL segments and review intervals (AI-13-S1 · S2)', () => {
    expect(KNOWLEDGE_TABLES).toEqual(['payment_methods', 'bonuses', 'kyc_documents', 'rules']);
    expect(KNOWLEDGE_TABLE_SQL_NAMES).toEqual({
      payment_methods: 'kb_payment_methods',
      bonuses: 'kb_bonuses',
      kyc_documents: 'kb_kyc_documents',
      rules: 'kb_rules',
    });
    expect(Object.values(KNOWLEDGE_TABLE_PATH_SEGMENTS)).toEqual([
      'payment-methods',
      'bonuses',
      'kyc-documents',
      'rules',
    ]);
    expect(KNOWLEDGE_TABLE_REVIEW_INTERVAL_DAYS).toEqual({
      payment_methods: 14,
      bonuses: 30,
      kyc_documents: 90,
      rules: 90,
    });
    for (const days of Object.values(KNOWLEDGE_TABLE_REVIEW_INTERVAL_DAYS)) {
      expect(days).toBeGreaterThanOrEqual(KNOWLEDGE_REVIEW_INTERVAL_DAYS.min);
      expect(days).toBeLessThanOrEqual(KNOWLEDGE_REVIEW_INTERVAL_DAYS.max);
    }
    expect(isKnowledgeTable('rules')).toBe(true);
    expect(isKnowledgeTable('kb_rules')).toBe(false);
  });

  it('has a pattern for every reference format but `none`', () => {
    expect(Object.keys(PAYMENT_REFERENCE_FORMAT_PATTERNS).sort()).toEqual(
      PAYMENT_REFERENCE_FORMATS.filter((f) => f !== 'none').sort(),
    );
  });

  it.each([
    ['txid_trc20', 'a'.repeat(64), true],
    ['txid_trc20', `0x${'a'.repeat(64)}`, false],
    ['txid_evm', `0x${'A1'.repeat(32)}`, true],
    ['txid_evm', 'a'.repeat(64), false],
    ['digits', ' 123456 ', true],
    ['digits', '12a456', false],
    ['username', 'mira_92', true],
    ['username', 'mira 92', false],
    ['phone', '+905551112233', true],
    ['email', 'oyuncu@ornek.com.tr', true],
    ['email', 'oyuncu@ornek', false],
    ['none', 'anything', true],
  ] as const)('reference format %s: %j → %s', (format, value, ok) => {
    expect(matchesPaymentReferenceFormat(format, value)).toBe(ok);
  });

  it('refuses a reference past 256 characters before any pattern runs — no tenant regex, no ReDoS (AI-13 §6)', () => {
    const started = Date.now();
    for (const format of PAYMENT_REFERENCE_FORMATS.filter((f) => f !== 'none')) {
      expect(matchesPaymentReferenceFormat(format, `${'a@.'.repeat(333_334)}x`)).toBe(false);
    }
    expect(Date.now() - started).toBeLessThan(1000);
  });
});

describe('knowledge tables — payment method validator (AI-13 §6)', () => {
  it('accepts the Papara row', () => {
    expect(validatePaymentMethod(PAPARA)).toEqual([]);
    expect(
      validateKnowledgeTableRow('payment_methods', { ...PAPARA, working_hours: EFT_HOURS }),
    ).toEqual([]);
  });

  it('needs a name and a direction; the rest takes its defaults', () => {
    expect(fields(validatePaymentMethod({}))).toEqual(['name:required', 'direction:required']);
    expect(validatePaymentMethod({ name: 'FAST', direction: 'withdrawal' })).toEqual([]);
    expect(fields(validatePaymentMethod({ name: '   ', direction: 'sideways' }))).toEqual([
      'name:required',
      'direction:invalid',
    ]);
  });

  it('refuses a minimum above the maximum and a delay threshold below the expected time', () => {
    expect(fields(validatePaymentMethod({ ...PAPARA, min_amount: 500, max_amount: 100 }))).toEqual([
      'min_amount:min_above_max',
    ]);
    expect(
      fields(
        validatePaymentMethod({ ...PAPARA, expected_minutes: 60, delay_threshold_minutes: 30 }),
      ),
    ).toEqual(['delay_threshold_minutes:delay_below_expected']);
    // Equal is allowed: delayed the moment the expected time passes.
    expect(
      validatePaymentMethod({ ...PAPARA, expected_minutes: 60, delay_threshold_minutes: 60 }),
    ).toEqual([]);
    expect(validatePaymentMethod({ ...PAPARA, min_amount: 100, max_amount: 100 })).toEqual([]);
  });

  it('holds amounts, minutes and the currency to their shapes', () => {
    expect(
      fields(
        validatePaymentMethod({
          ...PAPARA,
          min_amount: -1,
          max_amount: 10.005,
          expected_minutes: 1.5,
          delay_threshold_minutes: 43_201,
          currency: 'try',
        }),
      ),
    ).toEqual([
      'currency:invalid',
      'min_amount:out_of_range',
      'max_amount:out_of_range',
      'expected_minutes:out_of_range',
      'delay_threshold_minutes:out_of_range',
    ]);
    expect(fields(validatePaymentMethod({ ...PAPARA, min_amount: '100' }))).toEqual([
      'min_amount:invalid',
    ]);
  });

  it('keeps aliases distinct from each other and from the name, the Turkish way', () => {
    expect(
      fields(
        validatePaymentMethod({
          ...PAPARA,
          name: 'IBAN',
          aliases: ['ıban', 'Havale', ' havale ', ''],
        }),
      ),
    ).toEqual(['aliases[0]:repeated', 'aliases[2]:repeated', 'aliases[3]:required']);
    expect(normalizeKnowledgeTableName('  Kredi   KARTI ')).toBe('kredi kartı');
    expect(
      fields(
        validatePaymentMethod({
          ...PAPARA,
          aliases: Array(21)
            .fill('x')
            .map((x, i) => x + i),
        }),
      ),
    ).toEqual(['aliases:too_many']);
  });

  it('checks networks and the usual errors', () => {
    expect(
      fields(
        validatePaymentMethod({
          ...PAPARA,
          networks: ['TRC20', 'trc20', 'ERC 20'],
          common_errors: [
            { code: 'X', title: 'A', customer_text: 'B' },
            { code: 'x', title: '', customer_text: 'B', agent_hint: null },
            'oops',
          ],
        }),
      ),
    ).toEqual([
      'networks[1]:repeated',
      'networks[2]:invalid',
      'common_errors[1].code:repeated',
      'common_errors[1].title:required',
      'common_errors[2]:invalid',
    ]);
  });

  it('checks brands, owner, review interval and source on every row', () => {
    expect(
      fields(
        validatePaymentMethod({
          ...PAPARA,
          brand_ids: [BRAND_A, BRAND_A.toUpperCase(), 'nope'],
          owner_id: 'nope',
          review_interval_days: 366,
          source: 'robot',
        }),
      ),
    ).toEqual([
      'brand_ids[1]:repeated',
      'brand_ids[2]:invalid',
      'owner_id:invalid',
      'review_interval_days:out_of_range',
      'source:invalid',
    ]);
    expect(
      validatePaymentMethod({ ...PAPARA, brand_ids: [BRAND_A, BRAND_B], source: 'integration' }),
    ).toEqual([]);
  });
});

describe('knowledge tables — working hours (AI-13 §6)', () => {
  it('accepts weekly windows, several a day, ending at 24:00', () => {
    expect(validatePaymentWorkingHours(EFT_HOURS)).toEqual([]);
    expect(
      validatePaymentWorkingHours({
        timezone: 'UTC',
        windows: [{ day: 'sunday', start: '18:00', end: '24:00' }],
        closed_on_bank_holidays: false,
      }),
    ).toEqual([]);
    expect(validatePaymentWorkingHours(null)).toEqual([]);
  });

  it('refuses an unknown zone, a bad window and overlapping windows', () => {
    expect(
      fields(
        validatePaymentWorkingHours({
          timezone: 'Europe/Istambul',
          windows: [
            { day: 'monday', start: '09:00', end: '12:00' },
            { day: 'monday', start: '11:00', end: '13:00' },
            { day: 'funday', start: '9:00', end: '25:00' },
            { day: 'tuesday', start: '17:00', end: '09:00' },
          ],
          closed_on_bank_holidays: 'yes',
        }),
      ),
    ).toEqual([
      'working_hours.timezone:invalid',
      'working_hours.closed_on_bank_holidays:invalid',
      'working_hours.windows[2].day:invalid',
      'working_hours.windows[2].start:invalid',
      'working_hours.windows[2].end:invalid',
      'working_hours.windows[3].end:out_of_range',
      'working_hours.windows[1]:window_overlap',
    ]);
    expect(fields(validatePaymentWorkingHours({ timezone: 'UTC', windows: [] }))).toEqual([
      'working_hours.windows:required',
    ]);
    // Touching windows do not overlap.
    expect(
      validatePaymentWorkingHours({
        timezone: 'UTC',
        windows: [
          { day: 'monday', start: '09:00', end: '12:00' },
          { day: 'monday', start: '12:00', end: '13:00' },
        ],
        closed_on_bank_holidays: false,
      }),
    ).toEqual([]);
  });
});

describe('knowledge tables — bonus, KYC and rule validators', () => {
  it('accepts the welcome bonus, the identity card and the withdrawal limit', () => {
    expect(validateBonus(BONUS)).toEqual([]);
    expect(validateKycDocument(KYC)).toEqual([]);
    expect(validateKbRule(RULE)).toEqual([]);
  });

  it('a bonus: wagering base with its multiplier, a code for `code`, the window in order', () => {
    expect(
      fields(
        validateBonus({
          ...BONUS,
          wagering_base: null,
          promo_code: null,
          active_to: '2026-09-30T00:00:00Z',
        }),
      ),
    ).toEqual([
      'wagering_base:wagering_base_required',
      'promo_code:promo_code_required',
      'active_to:active_to_before_from',
    ]);
    expect(fields(validateBonus({ ...BONUS, wagering_multiplier: null }))).toEqual([
      'wagering_multiplier:required',
    ]);
    expect(validateBonus({ ...BONUS, wagering_multiplier: null, wagering_base: null })).toEqual([]);
    expect(
      fields(
        validateBonus({
          ...BONUS,
          wagering_multiplier: 0,
          min_odds: 0.9,
          max_bet: 0,
          contributing: [
            { category: 'Slot', percent: 101 },
            { category: 'slot', percent: 50 },
          ],
          excluded_method_ids: ['nope'],
          active_from: '2026-10-01',
          promo_code: 'İNDİRİM',
        }),
      ),
    ).toEqual([
      'wagering_multiplier:out_of_range',
      'contributing[0].percent:out_of_range',
      'contributing[1].category:repeated',
      'min_odds:out_of_range',
      'max_bet:out_of_range',
      'promo_code:invalid',
      'excluded_method_ids[0]:invalid',
      'active_from:invalid',
    ]);
  });

  it('a KYC document needs its name; its criteria are bounded', () => {
    expect(fields(validateKycDocument({ acceptance_criteria: ['', 'x'.repeat(201)] }))).toEqual([
      'doc_type:required',
      'acceptance_criteria[0]:required',
      'acceptance_criteria[1]:too_long',
    ]);
    expect(fields(validateKycDocument({ ...KYC, review_hours: 721 }))).toEqual([
      'review_hours:out_of_range',
    ]);
  });

  it('a rule needs a snake_case key, a title and a value — text, a number, or both', () => {
    expect(fields(validateKbRule({ key: 'Daily limit', title: 'Limit' }))).toEqual([
      'key:invalid',
      'value_text:value_required',
    ]);
    expect(
      validateKbRule({ ...RULE, numeric_value: null, value_text: 'Hafta sonu çekim yapılmaz.' }),
    ).toEqual([]);
    expect(fields(validateKbRule({ ...RULE, numeric_value: 1.23456 }))).toEqual([
      'numeric_value:out_of_range',
    ]);
    expect(validateKbRule({ ...RULE, numeric_value: 1.2345 })).toEqual([]);
  });

  it('refuses what is not an object', () => {
    for (const table of KNOWLEDGE_TABLES) {
      expect(validateKnowledgeTableRow(table, null)).toEqual([{ field: '', code: 'invalid' }]);
    }
  });
});

describe('knowledge tables — names across rows and brands (AI-13 §5 · §6 · AI-13-S3)', () => {
  const pm = (id: string, brand_ids: string[], name: string, extra: object = {}) => ({
    id,
    brand_ids,
    name,
    aliases: [] as string[],
    direction: 'deposit',
    ...extra,
  });

  it('clashes two every-brand rows, or two brand rows sharing a brand — never a brand row over the every-brand row', () => {
    expect(knowledgeTableBrandScopesClash([], [])).toBe(true);
    expect(knowledgeTableBrandScopesClash([BRAND_A], [BRAND_A, BRAND_B])).toBe(true);
    expect(knowledgeTableBrandScopesClash([BRAND_A], [BRAND_B])).toBe(false);
    expect(knowledgeTableBrandScopesClash([BRAND_A], [])).toBe(false);
  });

  it('finds a name or alias another row of the same direction and scope already uses', () => {
    const others = [pm('1', [], 'Papara', { aliases: ['PPR'] }), pm('2', [BRAND_A], 'Havale')];
    expect(
      fields(findKnowledgeTableConflicts('payment_methods', pm('9', [], 'papara'), others)),
    ).toEqual(['name:taken']);
    expect(
      fields(
        findKnowledgeTableConflicts(
          'payment_methods',
          pm('9', [], 'Payfix', { aliases: ['ppr'] }),
          others,
        ),
      ),
    ).toEqual(['aliases[0]:taken']);
    // A brand's own Papara overrides the every-brand one; withdrawal is another list.
    expect(
      findKnowledgeTableConflicts('payment_methods', pm('9', [BRAND_A], 'Papara'), others),
    ).toEqual([]);
    expect(
      findKnowledgeTableConflicts(
        'payment_methods',
        pm('9', [], 'Papara', { direction: 'withdrawal' }),
        others,
      ),
    ).toEqual([]);
    // A row is not its own conflict.
    expect(findKnowledgeTableConflicts('payment_methods', others[0]!, others)).toEqual([]);
    expect(
      fields(
        findKnowledgeTableConflicts(
          'payment_methods',
          pm('9', [BRAND_B, BRAND_A], 'HAVALE'),
          others,
        ),
      ),
    ).toEqual(['name:taken']);
  });

  it('compares a KYC document by name and a rule by key', () => {
    expect(
      fields(
        findKnowledgeTableConflicts('kyc_documents', { brand_ids: [], doc_type: 'kimlik KARTI' }, [
          { id: '1', brand_ids: [], doc_type: 'Kimlik kartı' },
        ]),
      ),
    ).toEqual(['doc_type:taken']);
    expect(
      fields(
        findKnowledgeTableConflicts('rules', { brand_ids: [], key: 'daily_withdrawal_limit' }, [
          { id: '1', brand_ids: [], key: 'daily_withdrawal_limit' },
        ]),
      ),
    ).toEqual(['key:taken']);
  });

  it('a row serves its brands; a conversation of unknown brand reads the every-brand rows only', () => {
    expect(knowledgeTableRowServesBrand([], BRAND_A)).toBe(true);
    expect(knowledgeTableRowServesBrand([], null)).toBe(true);
    expect(knowledgeTableRowServesBrand([BRAND_A], BRAND_A)).toBe(true);
    expect(knowledgeTableRowServesBrand([BRAND_A], BRAND_B)).toBe(false);
    expect(knowledgeTableRowServesBrand([BRAND_A], null)).toBe(false);
  });

  it("a brand's own row beats the every-brand row with the same name and direction", () => {
    const rows = [
      pm('all-papara', [], 'Papara'),
      pm('a-papara', [BRAND_A], 'PAPARA'),
      pm('all-papara-out', [], 'Papara', { direction: 'withdrawal' }),
      pm('all-havale', [], 'Havale'),
    ];
    expect(preferBrandRows('payment_methods', rows).map((r) => r.id)).toEqual([
      'a-papara',
      'all-papara-out',
      'all-havale',
    ]);
  });
});

describe('knowledge tables — review (AI-13-S2)', () => {
  const reviewed = '2026-10-01T00:00:00.000Z';

  it('falls due after the interval; a bonus at its campaign end if sooner', () => {
    expect(
      knowledgeTableRowReviewDueAt('payment_methods', {
        reviewed_at: reviewed,
        review_interval_days: 14,
      }).toISOString(),
    ).toBe('2026-10-15T00:00:00.000Z');
    expect(
      knowledgeTableRowReviewDueAt('bonuses', {
        reviewed_at: reviewed,
        review_interval_days: 30,
        active_to: '2026-10-10T12:00:00Z',
      }).toISOString(),
    ).toBe('2026-10-10T12:00:00.000Z');
    expect(
      knowledgeTableRowReviewDueAt('bonuses', {
        reviewed_at: reviewed,
        review_interval_days: 30,
        active_to: '2026-12-31T00:00:00Z',
      }).toISOString(),
    ).toBe('2026-10-31T00:00:00.000Z');
    // Only a bonus has a campaign end.
    expect(
      knowledgeTableRowReviewDueAt('rules', {
        reviewed_at: reviewed,
        review_interval_days: 90,
        active_to: '2026-10-02T00:00:00Z',
      }).toISOString(),
    ).toBe('2026-12-30T00:00:00.000Z');
  });

  it('is stale only once the due moment has passed', () => {
    const row = { reviewed_at: new Date(reviewed), review_interval_days: 14 };
    expect(isKnowledgeTableRowStale('payment_methods', row, new Date('2026-10-15T00:00:00Z'))).toBe(
      false,
    );
    expect(isKnowledgeTableRowStale('payment_methods', row, new Date('2026-10-15T00:00:01Z'))).toBe(
      true,
    );
  });
});

describe('knowledge tables — columns and labels (tm 310.2)', () => {
  it('lists each writable field once, a required one among them', () => {
    for (const table of KNOWLEDGE_TABLES) {
      const fields = KNOWLEDGE_TABLE_COLUMNS[table].map(([field]) => field);
      expect(new Set(fields).size).toBe(fields.length);
      for (const required of KNOWLEDGE_TABLE_REQUIRED_FIELDS[table]) {
        expect(fields).toContain(required);
      }
    }
  });

  it("calls a row by its name, its document or its rule's title — null when blank", () => {
    expect(knowledgeTableRowLabel('payment_methods', { name: ' Papara ' })).toBe('Papara');
    expect(knowledgeTableRowLabel('bonuses', { name: 'Hoş geldin' })).toBe('Hoş geldin');
    expect(knowledgeTableRowLabel('kyc_documents', { doc_type: 'Pasaport', name: 'x' })).toBe(
      'Pasaport',
    );
    expect(knowledgeTableRowLabel('rules', { key: 'min_age', title: 'Yaş sınırı' })).toBe(
      'Yaş sınırı',
    );
    expect(knowledgeTableRowLabel('rules', { title: '  ' })).toBeNull();
    expect(knowledgeTableRowLabel('payment_methods', { name: 7 })).toBeNull();
  });
});

describe('knowledge tables — row text (AI-13 §3)', () => {
  it('writes the Papara row with its values exactly, and nothing for agents only', () => {
    const text = renderRowText('payment_methods', PAPARA);
    expect(text.split('\n')).toEqual([
      'Ödeme yöntemi: Papara (yatırım).',
      'Diğer adları: PPR.',
      'Para birimi: TRY.',
      'En az tutar: 100 TRY.',
      'En çok tutar: 50.000 TRY.',
      'Beklenen süre: 30 dakika.',
      '1 saat geçerse gecikmiş sayılır.',
      'Çalışma saatleri: 7/24.',
      'Açıklama / referans: Açıklamaya kullanıcı adınızı yazın. (biçim: kullanıcı adı)',
      'Dekont gerekir.',
      'Başka birinin hesabından işlem kabul edilmez.',
      'Sık hata — İsim uyuşmazlığı: Gönderen hesap adı üyelik adınızla aynı olmalıdır.',
    ]);
    expect(text).not.toContain('Finans ekibine');
  });

  it('writes working hours day by day, with the zone and bank holidays', () => {
    expect(formatWorkingHoursTr(EFT_HOURS)).toBe(
      'Pazartesi 09:00–12:00, 13:00–17:00; Salı 09:00–17:00; diğer günler kapalı ' +
        '(saat dilimi: Europe/Istanbul); banka tatillerinde işlem yapılmaz',
    );
    const always: PaymentWorkingHours = {
      timezone: 'UTC',
      windows: (
        ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const
      ).map((day) => ({ day, start: '00:00', end: '24:00' })),
      closed_on_bank_holidays: false,
    };
    expect(formatWorkingHoursTr(always)).toBe('7/24 (saat dilimi: UTC)');
  });

  it.each([
    [0, 'hemen'],
    [45, '45 dakika'],
    [60, '1 saat'],
    [90, '1 saat 30 dakika'],
    [2880, '2 gün'],
  ])('a duration of %i minutes reads "%s"', (minutes, words) => {
    expect(formatMinutesTr(minutes)).toBe(words);
  });

  it('writes a bonus — wagering as a rule, never a remaining amount — with excluded methods by name', () => {
    const text = renderRowText('bonuses', BONUS, { methodNames: { [METHOD_ID]: 'Papara' } });
    expect(text).toContain('Çevrim şartı: bonus ve yatırım tutarının toplamının 10 katı.');
    expect(text).toContain('Çevrime katkı: slot %100, canlı casino %10.');
    expect(text).toContain('En düşük oran: 1,5.');
    expect(text).toContain('Nasıl alınır: promosyon koduyla alınır (HOSGELDIN).');
    expect(text).toContain('Şu ödeme yöntemleriyle yapılan yatırımlarda geçerli değildir: Papara.');
    expect(text).toContain('Kampanya dönemi: 1 Ekim 2026 – 31 Ekim 2026.');
    expect(text).not.toMatch(/kalan/i);
    expect(
      renderRowText('bonuses', { ...BONUS, wagering_multiplier: null, wagering_base: null }),
    ).toContain('Çevrim şartı yoktur.');
  });

  it('writes a KYC document and a rule', () => {
    expect(renderRowText('kyc_documents', KYC).split('\n')).toEqual([
      'KYC belgesi: Kimlik kartı.',
      'Kabul koşulları: Ön ve arka yüz; Süresi geçmemiş.',
      'Ne zaman istenir: İlk çekimden önce.',
      'İnceleme süresi: 1 gün.',
      'Nasıl yüklenir: Hesabım › Belgeler',
      'Sohbetten yüklenmez.',
    ]);
    expect(renderRowText('rules', RULE).split('\n')).toEqual([
      'Kural (çekim): Günlük çekim limiti.',
      'Değer: 50.000 TRY',
    ]);
  });
});

describe('access information (K13)', () => {
  it('needs what each source type needs', () => {
    expect(
      validateAiAccessInfo({ source_type: 'fixed_link', url: 'https://giris.ornek.com' }),
    ).toEqual([]);
    expect(
      validateAiAccessInfo({
        source_type: 'dynamic_url',
        url: 'https://api.ornek.com/adres.json',
        cache_seconds: AI_ACCESS_INFO_CACHE_SECONDS.default,
        brand_id: BRAND_A,
      }),
    ).toEqual([]);
    expect(validateAiAccessInfo({ source_type: 'kb_row', kb_source_id: METHOD_ID })).toEqual([]);
    expect(fields(validateAiAccessInfo({ source_type: 'kb_row' }))).toEqual([
      'kb_source_id:required',
    ]);
    expect(fields(validateAiAccessInfo({ source_type: 'dynamic_url' }))).toEqual(['url:required']);
    expect(fields(validateAiAccessInfo({}))).toEqual(['source_type:required']);
  });

  it('refuses a URL that is not http(s), a cache window out of bounds and a long text', () => {
    expect(
      fields(
        validateAiAccessInfo({
          source_type: 'fixed_link',
          url: 'javascript:alert(1)',
          cache_seconds: 10,
          fixed_text: 'x'.repeat(1001),
          brand_id: 'nope',
        }),
      ),
    ).toEqual([
      'brand_id:invalid',
      'url:invalid',
      'cache_seconds:out_of_range',
      'fixed_text:too_long',
    ]);
    expect(
      fields(validateAiAccessInfo({ source_type: 'fixed_link', url: 'https://bad host' })),
    ).toEqual(['url:invalid']);
  });
});
