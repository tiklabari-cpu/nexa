import { describe, expect, it } from 'vitest';
import {
  SENSITIVE_SLOT_CATEGORIES,
  SLOT_DEF_DEFAULTS,
  SLOT_MAX_PER_PROCEDURE,
  SLOT_PROBLEM_CODES,
  SLOT_SETTLED_STATUSES,
  SLOT_STATUSES,
  SLOT_TYPES,
  type SensitiveSlotCategory,
  type SlotProblem,
  type SlotProblemCode,
  type SlotType,
  foldForSensitiveMatch,
  sensitiveSlotCategory,
  slotProblemDetails,
  validateSlotDef,
  validateSlotDefs,
} from './slots.js';

/** A definition that passes, to vary one field at a time. */
const amount = {
  name: 'tutar',
  label: 'Tutar',
  type: 'money',
  ask: 'Ne kadar yatırdınız?',
  validate: { min: 50, max: 50000 },
};

function problemsOf(def: Record<string, unknown>): SlotProblem[] {
  return validateSlotDef(def).problems;
}

function codesOf(def: Record<string, unknown>): SlotProblemCode[] {
  return problemsOf(def).map((problem) => problem.code);
}

describe('slot vocabulary (AI-04 §2, §5)', () => {
  it('lists the seventeen types and the seven statuses', () => {
    expect(SLOT_TYPES).toEqual([
      'text',
      'enum',
      'number',
      'money',
      'datetime',
      'date',
      'duration',
      'boolean',
      'username',
      'email',
      'phone',
      'txid',
      'crypto_network',
      'iban_last4',
      'reference_code',
      'file',
      'url',
    ]);
    expect(SLOT_STATUSES).toEqual([
      'missing',
      'filled',
      'partial',
      'invalid',
      'refused',
      'unknown',
      'carried',
    ]);
  });

  it('does not ask again about a filled or a carried slot', () => {
    expect(SLOT_SETTLED_STATUSES).toEqual(['filled', 'carried']);
  });
});

describe('validateSlotDef — a definition that passes', () => {
  it('fills the defaults: required always, pii none, shown on the card, asked twice, never confirmed', () => {
    const { slot, problems } = validateSlotDef(amount);
    expect(problems).toEqual([]);
    expect(slot).toEqual({
      name: 'tutar',
      label: 'Tutar',
      type: 'money',
      required: 'always',
      ask: 'Ne kadar yatırdınız?',
      validate: { min: 50, max: 50000 },
      pii: 'none',
      show_in_card: true,
      max_attempts: 2,
      confirm: 'never',
    });
    expect(SLOT_DEF_DEFAULTS.max_attempts).toBe(2);
  });

  it('keeps every field an author sets', () => {
    const { slot, problems } = validateSlotDef({
      name: 'yontem',
      label: 'Yöntem',
      type: 'enum',
      required: { when: { slot: { name: 'tutar', op: 'exists' } } },
      ask: 'Hangi yöntemle yatırdınız?',
      ask_variants: ['Papara mı, havale mi, kripto mu?'],
      validate: { enum_source: 'payment_methods.deposit' },
      pii: 'low',
      show_in_card: false,
      card_label: 'Yatırım yöntemi',
      max_attempts: 3,
      confirm: 'if_inferred',
    });
    expect(problems).toEqual([]);
    expect(slot?.required).toEqual({ when: { slot: { name: 'tutar', op: 'exists' } } });
    expect(slot?.ask_variants).toEqual(['Papara mı, havale mi, kripto mu?']);
    expect(slot?.card_label).toBe('Yatırım yöntemi');
    expect(slot?.confirm).toBe('if_inferred');
  });

  it('takes an enum from written-out values', () => {
    expect(
      problemsOf({
        name: 'oyun',
        label: 'Oyun',
        type: 'enum',
        ask: 'Hangi oyunda?',
        validate: { enum_values: ['Slot', 'Casino', 'Spor'] },
      }),
    ).toEqual([]);
  });

  it('lets an iban_last4 slot name the IBAN and a txid slot follow the network', () => {
    expect(
      problemsOf({
        name: 'iban_son4',
        label: 'IBAN son 4 hane',
        type: 'iban_last4',
        ask: "IBAN'ınızın son 4 hanesini yazar mısınız?",
        pii: 'low',
      }),
    ).toEqual([]);
    expect(
      problemsOf({
        name: 'txid',
        label: 'TXID',
        type: 'txid',
        ask: 'İşlemin TXID’sini paylaşır mısınız?',
        validate: { network_aware: true },
      }),
    ).toEqual([]);
  });
});

describe('sensitive slots are refused on save (AI-04 §3 · G11)', () => {
  it('refuses a slot named "şifre" and one whose question asks for the SMS code — slot_sensitive_forbidden', () => {
    const named = problemsOf({
      ...amount,
      name: 'sifre',
      label: 'Şifre',
      type: 'text',
      validate: undefined,
    });
    expect(named).toContainEqual(
      expect.objectContaining({
        code: 'slot_sensitive_forbidden',
        field: 'name',
        category: 'password',
      }),
    );
    expect(named).toContainEqual(
      expect.objectContaining({ code: 'slot_sensitive_forbidden', field: 'label' }),
    );

    const asked = problemsOf({
      name: 'kod',
      label: 'Kod',
      type: 'text',
      ask: 'SMS kodunuzu yazın',
    });
    expect(asked).toEqual([
      expect.objectContaining({
        code: 'slot_sensitive_forbidden',
        field: 'ask',
        category: 'one_time_code',
        name: 'kod',
      }),
    ]);
    expect(slotProblemDetails(asked[0]!)).toEqual({
      reason: 'slot_sensitive_forbidden',
      slot: 1,
      name: 'kod',
      field: 'ask',
      category: 'one_time_code',
    });
  });

  it('reads the raw name too, so a Turkish-lettered name is refused for both reasons', () => {
    expect(codesOf({ ...amount, name: 'şifre', type: 'text', validate: undefined })).toEqual([
      'slot_bad_name',
      'slot_sensitive_forbidden',
    ]);
  });

  it('reads the question variants and the card label', () => {
    expect(
      problemsOf({ ...amount, ask_variants: ['Tutarı yazar mısınız?', 'Kartın CVV kodu?'] }),
    ).toEqual([expect.objectContaining({ field: 'ask_variants', category: 'card_security_code' })]);
    expect(problemsOf({ ...amount, card_label: 'Kart numarası' })).toEqual([
      expect.objectContaining({ field: 'card_label', category: 'card_number' }),
    ]);
  });

  const refused: Array<[string, SensitiveSlotCategory]> = [
    ['Şifrenizi yazar mısınız?', 'password'],
    ['ŞİFRENİZİ YAZIN', 'password'],
    ['Hesap parolanız', 'password'],
    ['Your password, please', 'password'],
    ['PIN kodunuz nedir?', 'password'],
    ['Giriş bilgilerinizi paylaşın', 'password'],
    ['SMS kodunuzu yazın', 'one_time_code'],
    ['smsKodu', 'one_time_code'],
    ['Telefonunuza gelen kodu yazar mısınız?', 'one_time_code'],
    ['Doğrulama kodu', 'one_time_code'],
    ['Enter the verification code', 'one_time_code'],
    ['OTP', 'one_time_code'],
    ['Tek kullanımlık şifre', 'password'],
    ['Google Authenticator kodunuz', 'one_time_code'],
    ['2FA kodunuz', 'one_time_code'],
    ['Kart numaranızı yazın', 'card_number'],
    ['Kartınızın numarası', 'card_number'],
    ['Kredi kartı bilgileriniz', 'card_number'],
    ['cardNumber', 'card_number'],
    ['Card number', 'card_number'],
    ['16 haneli numara', 'card_number'],
    ['CVV', 'card_security_code'],
    ['CVC2 nedir?', 'card_security_code'],
    ['Kartın güvenlik kodu', 'card_security_code'],
    ['Kartın arkasındaki 3 hane', 'card_security_code'],
    ['Seed phrase', 'seed_or_private_key'],
    ['Cüzdanınızın kurtarma kelimeleri', 'seed_or_private_key'],
    ['12 kelimelik ifade', 'seed_or_private_key'],
    ['Özel anahtarınız', 'seed_or_private_key'],
    ['Wallet private key', 'seed_or_private_key'],
    ['İnternet bankacılığı bilgileriniz', 'online_banking'],
    ['Online banking username', 'online_banking'],
    ['Müşteri numaranız ve şifreniz', 'password'],
    ['IBAN numaranız', 'full_iban'],
    ['TR ile başlayan 26 haneli hesap', 'full_iban'],
  ];
  it.each(refused)('"%s" → %s', (text, category) => {
    expect(sensitiveSlotCategory(text, 'text')).toBe(category);
  });

  const allowed = [
    'Hangi yöntemle yatırdınız?',
    'Kredi kartı ile mi yatırdınız?',
    'Online bankacılıkla mı ödediniz?',
    'Hangi bankadan gönderdiniz?',
    'Bonus kodunuz nedir?',
    'Promosyon kodu',
    'Referans kodu',
    'Kullanıcı adınız nedir?',
    'Hesabınıza giriş yapabiliyor musunuz?',
    'İşlem saatini yazar mısınız?',
    'Ne kadar yatırdınız?',
    'Kartınızın son 4 hanesi',
    'Kart numaranızın son 4 hanesi',
    'Free spin hakkınız',
    'Pinterest kullanıcı adınız',
    'Cüzdan adresiniz',
    'Which network did you use?',
    'TXID’yi paylaşır mısınız?',
    'Dekontunuzu gönderir misiniz?',
    'Kayıtlı telefon numaranız',
    '2 farklı hesap mı?',
  ];
  it.each(allowed)('"%s" is allowed', (text) => {
    expect(sensitiveSlotCategory(text, 'text')).toBeNull();
  });

  it('frees an IBAN only for iban_last4, and never the whole of it', () => {
    const tail = "IBAN'ınızın son 4 hanesi";
    expect(sensitiveSlotCategory(tail, 'iban_last4')).toBeNull();
    expect(sensitiveSlotCategory(tail, 'text')).toBe('full_iban');
    expect(sensitiveSlotCategory("IBAN'ınızın tamamını yazın", 'iban_last4')).toBe('full_iban');
    expect(sensitiveSlotCategory('Tam IBAN', 'iban_last4')).toBe('full_iban');
    expect(sensitiveSlotCategory('Full IBAN', 'iban_last4')).toBe('full_iban');
  });

  it('folds Turkish letters, case, camelCase and punctuation before matching', () => {
    expect(foldForSensitiveMatch('ŞİFRENİZİ Yazın: ığüşöç')).toBe('sifrenizi yazin igusoc');
    expect(foldForSensitiveMatch('smsCode_value')).toBe('sms code value');
    expect(foldForSensitiveMatch("IBAN'ınız")).toBe('iban iniz');
  });

  it('names a category the list knows', () => {
    const named = new Set(refused.map(([, category]) => category));
    expect([...named].sort()).toEqual([...SENSITIVE_SLOT_CATEGORIES].sort());
  });
});

describe('an identity document is not taken through the chat (AI-04-S1 · G12)', () => {
  const receipt = {
    name: 'dekont',
    label: 'Dekont',
    type: 'file',
    ask: 'Dekontu ya da ekran görüntüsünü paylaşabilir misiniz?',
  };

  it.each([
    ['ask', 'Kimliğinizin ön yüzünün fotoğrafını gönderir misiniz?'],
    ['ask', 'Nüfus cüzdanınızı yükler misiniz?'],
    ['label', 'Pasaport'],
    ['label', 'Ehliyet fotoğrafı'],
    ['ask', 'Kimliğinizle bir özçekim (selfie) gönderin.'],
    ['label', 'İkametgah belgesi'],
    ['ask', 'Please upload a photo of your ID card.'],
    ['ask', "Send us your driver's license."],
    ['card_label', 'Proof of address'],
    ['ask_variants', 'KYC belgenizi buradan iletin.'],
  ])('refuses a file slot whose %s reads "%s"', (field, text) => {
    const def =
      field === 'ask_variants'
        ? { ...receipt, ask_variants: [text] }
        : { ...receipt, [field]: text };
    expect(problemsOf(def)).toEqual([
      {
        code: 'slot_identity_document_forbidden',
        index: 0,
        name: 'dekont',
        field,
        message: `slot dekont: ${field} asks for an identity document, which the AI never takes through the chat`,
      },
    ]);
  });

  it('takes a receipt or a screenshot, and lets a non-file slot name an identity', () => {
    expect(codesOf(receipt)).toEqual([]);
    expect(codesOf({ ...receipt, ask: 'Ödeme ekranının görüntüsünü paylaşır mısınız?' })).toEqual(
      [],
    );
    expect(
      codesOf({
        name: 'kimlik_turu',
        label: 'Kimlik türü',
        type: 'text',
        ask: 'Hangi kimlikle kayıt oldunuz?',
      }),
    ).toEqual([]);
  });
});

describe('validateSlotDef — fields', () => {
  it('refuses a name that is not lower snake_case', () => {
    for (const name of ['Tutar', '1tutar', 'tutar-x', '', 'a'.repeat(41), 42]) {
      expect(codesOf({ ...amount, name })).toEqual(['slot_bad_name']);
    }
  });

  it('needs a label, a known type and a question', () => {
    expect(codesOf({ ...amount, label: '  ' })).toEqual(['slot_needs_label']);
    expect(codesOf({ ...amount, label: 'x'.repeat(81) })).toEqual(['slot_needs_label']);
    expect(codesOf({ ...amount, type: 'iban' })).toEqual(['slot_unknown_type']);
    expect(codesOf({ ...amount, ask: undefined })).toEqual(['slot_needs_ask']);
    expect(codesOf({ ...amount, ask: 'x'.repeat(301) })).toEqual(['slot_needs_ask']);
  });

  it('takes required as always, never or one { when } object', () => {
    expect(codesOf({ ...amount, required: 'never' })).toEqual([]);
    for (const required of ['sometimes', { when: 'x' }, { when: {}, else: {} }, true]) {
      expect(codesOf({ ...amount, required })).toEqual(['slot_bad_required']);
    }
  });

  it('refuses an unknown field rather than dropping it', () => {
    expect(problemsOf({ ...amount, requird: 'never' })).toEqual([
      expect.objectContaining({
        code: 'slot_unknown_field',
        message: 'slot tutar: unknown field requird',
      }),
    ]);
  });

  it('checks the options against their lists and bounds', () => {
    const cases: Array<[string, unknown]> = [
      ['pii', 'medium'],
      ['confirm', 'sometimes'],
      ['show_in_card', 'yes'],
      ['max_attempts', 0],
      ['max_attempts', 6],
      ['max_attempts', 1.5],
      ['card_label', ''],
      ['ask_variants', 'Tutar?'],
      ['ask_variants', ['a', 'b', 'c', 'd']],
    ];
    for (const [field, value] of cases) {
      expect(problemsOf({ ...amount, [field]: value })).toEqual([
        expect.objectContaining({ code: 'slot_bad_option', field }),
      ]);
    }
    expect(codesOf({ ...amount, max_attempts: 1 })).toEqual([]);
    expect(codesOf({ ...amount, max_attempts: 5 })).toEqual([]);
  });
});

describe('validateSlotDef — validate', () => {
  const enumSlot = { name: 'yontem', label: 'Yöntem', type: 'enum', ask: 'Hangi yöntem?' };

  it('needs exactly one value source on an enum, and none elsewhere', () => {
    expect(codesOf(enumSlot)).toEqual(['slot_enum_needs_values']);
    expect(codesOf({ ...enumSlot, validate: {} })).toEqual(['slot_enum_needs_values']);
    expect(codesOf({ ...enumSlot, validate: { enum_source: 'casinos' } })).toEqual([
      'slot_unknown_enum_source',
    ]);
    expect(
      codesOf({
        ...enumSlot,
        validate: { enum_source: 'bonuses', enum_values: ['Hoş geldin'] },
      }),
    ).toEqual(['slot_bad_validate']);
    for (const values of [[], ['Papara', 'papara'], ['', 'x'], 'Papara']) {
      expect(codesOf({ ...enumSlot, validate: { enum_values: values } })).toEqual([
        'slot_bad_validate',
      ]);
    }
    expect(codesOf({ ...amount, validate: { enum_source: 'bonuses' } })).toEqual([
      'slot_bad_validate',
    ]);
  });

  it('bounds only a quantity, low to high', () => {
    expect(codesOf({ ...amount, validate: { min: 100, max: 10 } })).toEqual(['slot_bad_validate']);
    expect(codesOf({ ...amount, validate: { min: '10' } })).toEqual(['slot_bad_validate']);
    expect(codesOf({ ...amount, validate: { max: Number.POSITIVE_INFINITY } })).toEqual([
      'slot_bad_validate',
    ]);
    const types: SlotType[] = ['number', 'duration'];
    for (const type of types) expect(codesOf({ ...amount, type })).toEqual([]);
    expect(codesOf({ ...amount, type: 'text' })).toEqual([
      'slot_bad_validate',
      'slot_bad_validate',
    ]);
  });

  it('takes a pattern on free text only, one that compiles and does not repeat a repeated group', () => {
    const code = {
      name: 'bonus_kodu',
      label: 'Bonus kodu',
      type: 'reference_code',
      ask: 'Bonus kodu?',
    };
    expect(codesOf({ ...code, validate: { regex: '^[A-Z0-9]{6,12}$' } })).toEqual([]);
    expect(codesOf({ ...code, validate: { regex: '([a-z' } })).toEqual(['slot_bad_validate']);
    expect(codesOf({ ...code, validate: { regex: '' } })).toEqual(['slot_bad_validate']);
    expect(codesOf({ ...code, validate: { regex: 'x'.repeat(201) } })).toEqual([
      'slot_bad_validate',
    ]);
    for (const regex of ['(a+)+$', '(\\w*)*', '([a-z]+){2,}']) {
      expect(problemsOf({ ...code, validate: { regex } })).toEqual([
        expect.objectContaining({
          code: 'slot_bad_validate',
          message: 'slot bonus_kodu: regex must not repeat a repeated group',
        }),
      ]);
    }
    expect(codesOf({ ...amount, validate: { regex: '^\\d+$' } })).toEqual(['slot_bad_validate']);
  });

  it('follows the network only on a txid, and refuses an unknown key', () => {
    expect(codesOf({ ...amount, validate: { network_aware: true } })).toEqual([
      'slot_bad_validate',
    ]);
    expect(codesOf({ ...amount, validate: { minimum: 5 } })).toEqual(['slot_bad_validate']);
    expect(codesOf({ ...amount, validate: [] })).toEqual(['slot_bad_validate']);
  });
});

describe('validateSlotDefs — the list', () => {
  it('returns the definitions with defaults when every slot passes', () => {
    const result = validateSlotDefs([
      amount,
      { name: 'islem_zamani', label: 'İşlem zamanı', type: 'datetime', ask: 'Saat kaçta?' },
    ]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.slots.map((slot) => slot.name)).toEqual(['tutar', 'islem_zamani']);
  });

  it('refuses a list that is not one, or is too long', () => {
    expect(validateSlotDefs({ tutar: amount })).toEqual({
      ok: false,
      problems: [{ code: 'slots_not_array', index: -1, message: 'slots must be an array' }],
    });
    const many = Array.from({ length: SLOT_MAX_PER_PROCEDURE + 1 }, (_, i) => ({
      ...amount,
      name: `s${i}`,
    }));
    const result = validateSlotDefs(many);
    expect(result.ok ? [] : result.problems.map((p) => p.code)).toEqual(['slots_too_many']);
    expect(validateSlotDefs(many.slice(0, SLOT_MAX_PER_PROCEDURE)).ok).toBe(true);
  });

  it('reports every problem in list order, with its position', () => {
    const result = validateSlotDefs([amount, 'tutar', { ...amount, ask: 'SMS kodunuz?' }, amount]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems.map((p) => [p.code, p.index])).toEqual([
      ['slot_not_object', 1],
      ['slot_sensitive_forbidden', 2],
      ['slot_duplicate_name', 3],
    ]);
    expect(result.problems.map(slotProblemDetails)).toEqual([
      { reason: 'slot_not_object', slot: 2 },
      {
        reason: 'slot_sensitive_forbidden',
        slot: 3,
        name: 'tutar',
        field: 'ask',
        category: 'one_time_code',
      },
      { reason: 'slot_duplicate_name', slot: 4, name: 'tutar', field: 'name' },
    ]);
  });

  it('gives the list as a whole no position on the wire', () => {
    expect(
      slotProblemDetails({ code: 'slots_not_array', index: -1, message: 'slots must be an array' }),
    ).toEqual({ reason: 'slots_not_array' });
  });

  it('produces every problem code but the procedure validator’s own', () => {
    const fixtures: unknown[] = [
      {},
      [1],
      Array.from({ length: SLOT_MAX_PER_PROCEDURE + 1 }, () => amount),
      [{ ...amount, extra: 1 }],
      [{ ...amount, name: 'X' }],
      [amount, amount],
      [{ ...amount, label: '' }],
      [{ ...amount, type: 'nope' }],
      [{ ...amount, required: 'x' }],
      [{ ...amount, ask: '' }],
      [{ ...amount, pii: 'x' }],
      [{ ...amount, validate: { min: 'x' } }],
      [{ ...amount, type: 'enum', validate: undefined }],
      [{ ...amount, type: 'enum', validate: { enum_source: 'x' } }],
      [{ ...amount, label: 'Şifre' }],
      [{ ...amount, type: 'file', validate: undefined, label: 'Pasaport' }],
    ];
    const seen = new Set<SlotProblemCode>();
    for (const fixture of fixtures) {
      const result = validateSlotDefs(fixture);
      if (!result.ok) for (const problem of result.problems) seen.add(problem.code);
    }
    expect([...seen].sort()).toEqual(
      SLOT_PROBLEM_CODES.filter((code) => code !== 'slot_unknown_reference').sort(),
    );
  });
});
