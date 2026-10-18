/**
 * Information collecting — slots (tm 295.1 · SiyahTuş analysis AI-04).
 *
 * A procedure (AI-03, #296) names what it needs from the player before it can
 * act — the method, the amount, when it happened, the TXID, the receipt — as a
 * list of slot definitions. The AI pulls each value out of the player's own
 * words, checks it, keeps it in `ai_conversations.slots` and asks again only for
 * what is still missing; the handoff card (AI-10) shows what it collected.
 *
 * This module is the vocabulary and the save-time judgement, shared so the
 * procedure editor (web) and the endpoint that stores a procedure (api) refuse
 * the same definitions with the same codes:
 *
 *   - the closed lists — slot types, statuses, sources, sensitivity levels;
 *   - `SlotDef`, the definition an author writes, and `SlotValue`, the record
 *     the engine keeps per slot (`conversation/slots/extract.ts` writes it);
 *   - the sensitive-request list (G11): a slot whose name, label or question
 *     reads as asking for a password, a one-time code, a full card number, a
 *     card security code, a seed phrase or private key, online banking
 *     credentials or a full IBAN is refused on save — `slot_sensitive_forbidden`.
 *     The TR and EN patterns live here and nowhere else;
 *   - `validateSlotDefs`, every problem in a slot list as a stable code.
 *
 * Turning the player's words into values — Turkish amounts, dates, yes/no,
 * TXIDs per network — is the API's (`conversation/slots/`, #295.2/#295.3); it
 * runs on player text, this runs on what an author wrote.
 */

/**
 * What kind of value a slot holds (AI-04 §2).
 *
 *   - `money`          — an amount with its currency; the tenant's currency when
 *                        the player names none.
 *   - `datetime`       — a moment, read in the tenant's time zone (ID-04); a day
 *                        without a time is `partial`.
 *   - `txid`           — a crypto transaction id, checked against its network.
 *   - `iban_last4`     — the last four characters of an IBAN, never the IBAN.
 *   - `reference_code` — a code the operator issued (bonus, promotion, ticket).
 *   - `file`           — an attachment the player sent on the same connection.
 */
export const SLOT_TYPES = [
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
] as const;
export type SlotType = (typeof SLOT_TYPES)[number];

/** The types a `min`/`max` bound applies to — the ones that hold a quantity. */
export const SLOT_RANGE_TYPES: readonly SlotType[] = ['number', 'money', 'duration'];

/**
 * The types an author's `regex` may further narrow — the ones held as free
 * text. A type with its own format (email, TXID, IBAN, a date) is checked by
 * that format, not by a pattern on top.
 */
export const SLOT_REGEX_TYPES: readonly SlotType[] = ['text', 'username', 'reference_code'];

/**
 * How sensitive a collected value is. `high` values never reach the decision
 * record or the operator log — only their status does (AI-04 §9).
 */
export const SLOT_PII_LEVELS = ['none', 'low', 'high'] as const;
export type SlotPii = (typeof SLOT_PII_LEVELS)[number];

/**
 * When the AI reads a value back to the player before relying on it:
 * `if_inferred` — only when it came from inference rather than the player's
 * plain words.
 */
export const SLOT_CONFIRM_MODES = ['never', 'if_inferred', 'always'] as const;
export type SlotConfirm = (typeof SLOT_CONFIRM_MODES)[number];

/**
 * Where a slot stands in a conversation (AI-04 §5).
 *
 *   - `missing` — not given yet.
 *   - `filled`  — given and valid.
 *   - `partial` — given in part: "dün akşam" is a day without a time.
 *   - `invalid` — given but wrong: a malformed TXID, a time in the future.
 *   - `refused` — asked `max_attempts` times without an answer; the card shows
 *                 "not given" and the policy decides (a required one hands over).
 *   - `unknown` — the player said they do not know.
 *   - `carried` — brought over from an earlier connection today (AI-02).
 */
export const SLOT_STATUSES = [
  'missing',
  'filled',
  'partial',
  'invalid',
  'refused',
  'unknown',
  'carried',
] as const;
export type SlotStatus = (typeof SLOT_STATUSES)[number];

/** The statuses the AI does not ask about again (AI-04 §6). */
export const SLOT_SETTLED_STATUSES: readonly SlotStatus[] = ['filled', 'carried'];

/** Where a value came from. */
export const SLOT_SOURCES = ['player', 'carried', 'inferred'] as const;
export type SlotSource = (typeof SLOT_SOURCES)[number];

/**
 * The structured tables an `enum` slot may take its values from (AI-13, #310):
 * a method the player names is matched, fuzzily, against the rows' names and
 * aliases ("papara", "PPR" → the canonical method).
 */
export const SLOT_ENUM_SOURCES = [
  'payment_methods.deposit',
  'payment_methods.withdrawal',
  'bonuses',
  'kyc_documents',
] as const;
export type SlotEnumSource = (typeof SLOT_ENUM_SOURCES)[number];

/** How often a slot is asked before it is `refused` (AI-04-S2: twice, worded differently). */
export const DEFAULT_SLOT_MAX_ATTEMPTS = 2;
export const SLOT_MAX_ATTEMPTS_MIN = 1;
export const SLOT_MAX_ATTEMPTS_MAX = 5;

/** How many slot questions one AI message may carry (AI-07 `max_questions_per_message`). */
export const DEFAULT_MAX_QUESTIONS_PER_MESSAGE = 2;

/** At most this many slots in one procedure. */
export const SLOT_MAX_PER_PROCEDURE = 20;

/** Lower snake_case, starting with a letter: `islem_zamani`, `txid`. */
export const SLOT_NAME_PATTERN = /^[a-z][a-z0-9_]{0,39}$/;

export const SLOT_LABEL_MAX = 80;
export const SLOT_ASK_MAX = 300;
export const SLOT_ASK_VARIANTS_MAX = 3;
export const SLOT_REGEX_MAX = 200;
export const SLOT_ENUM_VALUES_MAX = 50;

/**
 * When a slot is required: always, never, or when a condition holds. The
 * condition language is the procedure's (`Cond`, #296.1); here it is only
 * required to be an object, and the procedure validator judges it.
 */
export type SlotRequired<C = SlotCondition> = 'always' | 'never' | { when: C };

/** A condition as this module sees it — an object the procedure validator reads. */
export type SlotCondition = Readonly<Record<string, unknown>>;

export interface SlotValidate {
  /** Inclusive bounds on a quantity. Outside them the value is kept and marked `out_of_range`. */
  min?: number;
  max?: number;
  /** An `enum` slot's values from a structured table… */
  enum_source?: SlotEnumSource;
  /** …or written out by the author. Exactly one of the two. */
  enum_values?: string[];
  /** A further pattern for a free-text type (`SLOT_REGEX_TYPES`). */
  regex?: string;
  /** A `txid` is checked against the network the conversation collected. */
  network_aware?: boolean;
}

/** A slot as an author defines it, with every default filled in (AI-04 §1). */
export interface SlotDef<C = SlotCondition> {
  name: string;
  label: string;
  type: SlotType;
  required: SlotRequired<C>;
  /** The question; `ask_variants` word the later attempts. */
  ask: string;
  ask_variants?: string[];
  validate?: SlotValidate;
  pii: SlotPii;
  show_in_card: boolean;
  card_label?: string;
  max_attempts: number;
  confirm: SlotConfirm;
}

/** The defaults an omitted field takes. */
export const SLOT_DEF_DEFAULTS = {
  required: 'always',
  pii: 'none',
  show_in_card: true,
  max_attempts: DEFAULT_SLOT_MAX_ATTEMPTS,
  confirm: 'never',
} as const satisfies Partial<SlotDef>;

/** An amount: major units, rounded to two decimals, and an ISO 4217 code. */
export interface SlotMoney {
  amount: number;
  currency: string;
}

/**
 * A moment as far as the player gave it: the day (`YYYY-MM-DD`) and, when known,
 * the time (`HH:MM`), in the tenant's time zone. A day alone is `partial`;
 * `part_of_day` keeps "akşam" for the card and the follow-up question.
 */
export interface SlotDateTime {
  date: string;
  time: string | null;
  time_zone: string;
  part_of_day?: 'morning' | 'afternoon' | 'evening' | 'night';
}

/** A value as the engine keeps it: plain for the scalar types, structured for the rest. */
export type SlotScalar = string | number | boolean | SlotMoney | SlotDateTime;

/**
 * One slot's record in `ai_conversations.slots` (AI-04 §9). `display` is what
 * the card, the daily digest (AI-02) and the next question read — null while
 * nothing usable was given. A correction overwrites `value` and keeps the old
 * one in `previous_values`.
 */
export interface SlotValue {
  value: SlotScalar | null;
  display: string | null;
  status: SlotStatus;
  source: SlotSource;
  confidence: number | null;
  /** The AI turn that last wrote the slot. */
  turn: number;
  /** How many times the AI has asked for it. */
  attempts: number;
  previous_values: SlotScalar[];
  /** A quantity outside `validate.min`/`max` — kept, flagged for the procedure's conditions. */
  out_of_range?: 'below_min' | 'above_max';
  /** Why the latest words were not a value, while `invalid` — the re-ask explains it. */
  invalid_reason?: string;
  /**
   * Set on a `pii: 'high'` slot's record: its value stays here, for the card,
   * and goes nowhere else — not the daily digest, not a log (AI-04 §9).
   */
  pii?: 'high';
}

// ---------------------------------------------------------------------------
// The sensitive-request list (G11).
// ---------------------------------------------------------------------------

/** What a refused slot reads as asking for. */
export const SENSITIVE_SLOT_CATEGORIES = [
  'password',
  'one_time_code',
  'card_number',
  'card_security_code',
  'seed_or_private_key',
  'online_banking',
  'full_iban',
] as const;
export type SensitiveSlotCategory = (typeof SENSITIVE_SLOT_CATEGORIES)[number];

/**
 * Lower-cased with Turkish rules, Turkish letters folded to ASCII (ş→s, ı→i,
 * ğ→g, ü→u, ö→o, ç→c), camelCase split, and every run of punctuation —
 * `_`, `-`, an apostrophe before a suffix — made one space. The patterns below
 * are written against this form, so "ŞİFRENİZİ", "Şifreniz" and `sifre_no`
 * read alike.
 */
export function foldForSensitiveMatch(text: string): string {
  return text
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLocaleLowerCase('tr')
    .replace(/ı/g, 'i')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * The patterns, by category, on folded text. A pattern starts at a word but may
 * run into a Turkish suffix — `\bsifre` matches "şifrenizi". Each names the
 * thing being asked for, not a topic near it: "kredi kartı ile mi yatırdınız?"
 * and "bonus kodu" stay allowed, "kart numaranız" and "SMS kodu" do not.
 */
const SENSITIVE_PATTERNS: Readonly<Record<SensitiveSlotCategory, readonly RegExp[]>> = {
  password: [
    /\b(sifre|parola|password|passwd|passcode|pass word)/,
    /\bpin\b/,
    /\b(giris bilgi|login (bilgi|details|credential)|credential)/,
  ],
  one_time_code: [
    /\b(otp|one time (pass|code|pin)|tek kullanimlik)/,
    /\bsms ?(kod|code|sifre|onay)/,
    /\b(sms|mesaj\w*|telefon\w*) (ile |la |le )?gelen (kod|sifre|numara)/,
    /\b(dogrulama|onay|aktivasyon|verification|verify|activation|auth) (kod|code)/,
    /\b(2 ?fa\b|iki (faktor|asamali|adimli)|two (factor|step)|authenticator)/,
  ],
  card_number: [
    /\bkart\w* (numara|no\b|bilgi|uzerindeki (numara|rakam))/,
    /\bcard\w* (number|no\b|num\b|details|info)/,
    /\b(pan\b|16 hane)/,
  ],
  card_security_code: [
    /\b(cvv|cvc|cvn|cav2|cid\b)/,
    /\b(guvenlik kod|security code|card verification)/,
    /\barka(sindaki|daki) (3|uc) (hane|rakam)/,
  ],
  seed_or_private_key: [
    /\b(seed|mnemonic|keystore|privkey)/,
    /\b(kurtarma|recovery) (ifade|kelime|cumle|anahtar|phrase|word|seed|key)/,
    /\b(ozel|gizli) anahtar/,
    /\b(private|secret) (key|phrase)/,
    /\b(cuzdan|wallet)\w* (sifre|anahtar|kelime|password|key|phrase|seed)/,
    /\b(12|24) (kelime|word)/,
  ],
  online_banking: [
    /\b(internet|online|mobil|mobile|net) bank\w* (bilgi|sifre|giris|kullanici|musteri|credential|login|password|username|details)/,
    /\bbankacilik (sifre|bilgi|giris)/,
    /\bbank\w* (login|credential|password|username)/,
    /\bmusteri (numara|no)\w* ve sifre/,
  ],
  full_iban: [/\biban/, /\b26 (hane|karakter|digit|character)/],
};

/** "son 4 hane" / "last 4 digits" — asking for the tail of a number, not the number. */
const LAST_FOUR = /\b(son (4|dort) (hane|rakam|karakter)|last (4|four) (digit|character|number))/;

/** An `iban_last4` slot may name the IBAN; it may not ask for the whole of it. */
const WHOLE_IBAN = [
  /\b(tam|tum|butun|full|complete|entire|whole) iban/,
  /\biban\w*( \w+)? (tam|tum|butun|full|complete|entire|whole)/,
  /\b26 (hane|karakter|digit|character)/,
];

/**
 * The category a piece of slot text reads as asking for, or null. `type` is the
 * slot's: only an `iban_last4` slot may mention an IBAN, and then not the whole
 * of it; any other mention of an IBAN asks for one (AI-04 §3). A card number
 * asked for by its last four digits is not a card number.
 */
export function sensitiveSlotCategory(text: string, type?: SlotType): SensitiveSlotCategory | null {
  const folded = foldForSensitiveMatch(text);
  if (!folded) return null;
  for (const category of SENSITIVE_SLOT_CATEGORIES) {
    if (category === 'full_iban' && type === 'iban_last4') {
      if (WHOLE_IBAN.some((pattern) => pattern.test(folded))) return category;
      continue;
    }
    if (category === 'card_number' && LAST_FOUR.test(folded)) continue;
    if (SENSITIVE_PATTERNS[category].some((pattern) => pattern.test(folded))) return category;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Save-time validation.
// ---------------------------------------------------------------------------

/**
 * Why a slot list was refused, as a stable code the editor words in its own
 * language. A write answers 400 `validation` with the first problem's
 * `slotProblemDetails` in `error.details`; the editor shows all of them.
 *
 * `slot_unknown_reference` is the procedure validator's (#296.1): a `collect`
 * step, a template variable or a condition naming a slot the procedure does
 * not define. It is listed here so the codes have one home.
 */
export const SLOT_PROBLEM_CODES = [
  'slots_not_array',
  'slots_too_many',
  'slot_not_object',
  'slot_unknown_field',
  'slot_bad_name',
  'slot_duplicate_name',
  'slot_needs_label',
  'slot_unknown_type',
  'slot_bad_required',
  'slot_needs_ask',
  'slot_bad_option',
  'slot_bad_validate',
  'slot_enum_needs_values',
  'slot_unknown_enum_source',
  'slot_sensitive_forbidden',
  'slot_unknown_reference',
] as const;
export type SlotProblemCode = (typeof SLOT_PROBLEM_CODES)[number];

/** The fields of a `SlotDef`, as a problem names them. */
export const SLOT_DEF_FIELDS = [
  'name',
  'label',
  'type',
  'required',
  'ask',
  'ask_variants',
  'validate',
  'pii',
  'show_in_card',
  'card_label',
  'max_attempts',
  'confirm',
] as const;
export type SlotDefField = (typeof SLOT_DEF_FIELDS)[number];

export interface SlotProblem {
  code: SlotProblemCode;
  /** 0-based position in the list; -1 when the list as a whole was refused. */
  index: number;
  /** The slot's name, when it had a readable one. */
  name?: string;
  field?: SlotDefField;
  /** For `slot_sensitive_forbidden`: what the text reads as asking for. */
  category?: SensitiveSlotCategory;
  /** The English sentence, for API callers. */
  message: string;
}

/** What a client needs to word a problem itself — goes in `error.details`. */
export interface SlotProblemDetails {
  reason: SlotProblemCode;
  /** 1-based position of the slot; absent when the list as a whole was refused. */
  slot?: number;
  name?: string;
  field?: SlotDefField;
  category?: SensitiveSlotCategory;
}

export function slotProblemDetails(problem: SlotProblem): SlotProblemDetails {
  return {
    reason: problem.code,
    ...(problem.index >= 0 ? { slot: problem.index + 1 } : {}),
    ...(problem.name !== undefined ? { name: problem.name } : {}),
    ...(problem.field !== undefined ? { field: problem.field } : {}),
    ...(problem.category !== undefined ? { category: problem.category } : {}),
  };
}

const FIELDS: ReadonlySet<string> = new Set(SLOT_DEF_FIELDS);
const VALIDATE_FIELDS: ReadonlySet<string> = new Set([
  'min',
  'max',
  'enum_source',
  'enum_values',
  'regex',
  'network_aware',
]);

/** The fields whose text is read for a sensitive request, in the order they are reported. */
const SENSITIVE_TEXT_FIELDS = ['name', 'label', 'ask', 'ask_variants', 'card_label'] as const;

/**
 * A group around a quantifier, itself quantified — `(a+)+`, `(\w*)*`, `(x+){2,}`.
 * The shape behind catastrophic backtracking; an author's pattern runs on
 * player text, so it is refused rather than timed.
 */
const NESTED_QUANTIFIER = /\((?:[^()\\]|\\.)*[+*](?:[^()\\]|\\.)*\)\s*[+*{]/;

/**
 * Every problem in a slot list, in list order, and the definitions with their
 * defaults filled in when there are none. Unknown fields are refused rather
 * than dropped: a misspelt `requird` would otherwise quietly fall back to the
 * default.
 */
export function validateSlotDefs(
  value: unknown,
): { ok: true; slots: SlotDef[] } | { ok: false; problems: SlotProblem[] } {
  if (!Array.isArray(value)) {
    return {
      ok: false,
      problems: [{ code: 'slots_not_array', index: -1, message: 'slots must be an array' }],
    };
  }
  if (value.length > SLOT_MAX_PER_PROCEDURE) {
    return {
      ok: false,
      problems: [
        {
          code: 'slots_too_many',
          index: -1,
          message: `a procedure may define at most ${SLOT_MAX_PER_PROCEDURE} slots`,
        },
      ],
    };
  }

  const problems: SlotProblem[] = [];
  const slots: SlotDef[] = [];
  const seen = new Set<string>();
  for (const [index, raw] of value.entries()) {
    const result = validateSlotDef(raw, index);
    problems.push(...result.problems);
    const name = result.slot?.name;
    if (name !== undefined) {
      if (seen.has(name)) {
        problems.push({
          code: 'slot_duplicate_name',
          index,
          name,
          field: 'name',
          message: `slot ${name} is defined twice`,
        });
      }
      seen.add(name);
    }
    if (result.slot) slots.push(result.slot);
  }
  return problems.length > 0 ? { ok: false, problems } : { ok: true, slots };
}

/** One definition's problems and, when it has none, the definition with defaults. */
export function validateSlotDef(
  value: unknown,
  index = 0,
): { slot: SlotDef | null; problems: SlotProblem[] } {
  if (!isPlainObject(value)) {
    return {
      slot: null,
      problems: [{ code: 'slot_not_object', index, message: 'slot must be an object' }],
    };
  }

  const problems: SlotProblem[] = [];
  const nameValue = value['name'];
  const name =
    typeof nameValue === 'string' && SLOT_NAME_PATTERN.test(nameValue) ? nameValue : undefined;
  const at = name ?? `#${index + 1}`;
  const push = (code: SlotProblemCode, field: SlotDefField | undefined, message: string) =>
    problems.push({
      code,
      index,
      ...(name !== undefined ? { name } : {}),
      ...(field !== undefined ? { field } : {}),
      message: `slot ${at}: ${message}`,
    });

  for (const key of Object.keys(value)) {
    if (!FIELDS.has(key)) push('slot_unknown_field', undefined, `unknown field ${key}`);
  }

  if (name === undefined) {
    push('slot_bad_name', 'name', 'name must be lower snake_case, at most 40 characters');
  }

  const label = value['label'];
  if (!nonEmptyString(label) || label.length > SLOT_LABEL_MAX) {
    push('slot_needs_label', 'label', `needs a label of at most ${SLOT_LABEL_MAX} characters`);
  }

  const typeValue = value['type'];
  const type = isOneOf(SLOT_TYPES, typeValue) ? typeValue : undefined;
  if (type === undefined) push('slot_unknown_type', 'type', `unknown type ${String(typeValue)}`);

  const required = value['required'] ?? SLOT_DEF_DEFAULTS.required;
  if (
    required !== 'always' &&
    required !== 'never' &&
    !(
      isPlainObject(required) &&
      Object.keys(required).length === 1 &&
      isPlainObject(required['when'])
    )
  ) {
    push('slot_bad_required', 'required', 'required must be always, never or { when: condition }');
  }

  const ask = value['ask'];
  if (!nonEmptyString(ask) || ask.length > SLOT_ASK_MAX) {
    push('slot_needs_ask', 'ask', `needs a question of at most ${SLOT_ASK_MAX} characters`);
  }

  const variants = value['ask_variants'];
  if (
    variants !== undefined &&
    !(
      Array.isArray(variants) &&
      variants.length <= SLOT_ASK_VARIANTS_MAX &&
      variants.every((v) => nonEmptyString(v) && v.length <= SLOT_ASK_MAX)
    )
  ) {
    push(
      'slot_bad_option',
      'ask_variants',
      `ask_variants must be at most ${SLOT_ASK_VARIANTS_MAX} questions`,
    );
  }

  const pii = value['pii'] ?? SLOT_DEF_DEFAULTS.pii;
  if (!isOneOf(SLOT_PII_LEVELS, pii))
    push('slot_bad_option', 'pii', 'pii must be none, low or high');

  const showInCard = value['show_in_card'] ?? SLOT_DEF_DEFAULTS.show_in_card;
  if (typeof showInCard !== 'boolean') {
    push('slot_bad_option', 'show_in_card', 'show_in_card must be true or false');
  }

  const cardLabel = value['card_label'];
  if (
    cardLabel !== undefined &&
    !(nonEmptyString(cardLabel) && cardLabel.length <= SLOT_LABEL_MAX)
  ) {
    push(
      'slot_bad_option',
      'card_label',
      `card_label must be at most ${SLOT_LABEL_MAX} characters`,
    );
  }

  const maxAttempts = value['max_attempts'] ?? SLOT_DEF_DEFAULTS.max_attempts;
  if (
    !Number.isInteger(maxAttempts) ||
    (maxAttempts as number) < SLOT_MAX_ATTEMPTS_MIN ||
    (maxAttempts as number) > SLOT_MAX_ATTEMPTS_MAX
  ) {
    push(
      'slot_bad_option',
      'max_attempts',
      `max_attempts must be a whole number from ${SLOT_MAX_ATTEMPTS_MIN} to ${SLOT_MAX_ATTEMPTS_MAX}`,
    );
  }

  const confirm = value['confirm'] ?? SLOT_DEF_DEFAULTS.confirm;
  if (!isOneOf(SLOT_CONFIRM_MODES, confirm)) {
    push('slot_bad_option', 'confirm', 'confirm must be never, if_inferred or always');
  }

  const validate = value['validate'];
  if (validate !== undefined) {
    for (const [code, message] of validateProblems(validate, type)) push(code, 'validate', message);
  } else if (type === 'enum') {
    push('slot_enum_needs_values', 'validate', 'an enum slot needs enum_source or enum_values');
  }

  for (const field of SENSITIVE_TEXT_FIELDS) {
    const raw = value[field];
    const texts = Array.isArray(raw) ? raw : [raw];
    for (const text of texts) {
      if (typeof text !== 'string') continue;
      const category = sensitiveSlotCategory(text, type);
      if (category === null) continue;
      problems.push({
        code: 'slot_sensitive_forbidden',
        index,
        ...(name !== undefined ? { name } : {}),
        field,
        category,
        message: `slot ${at}: ${field} asks for a ${category.replace(/_/g, ' ')}, which the AI never collects`,
      });
      break;
    }
  }

  if (problems.length > 0) return { slot: null, problems };

  const slot: SlotDef = {
    name: name as string,
    label: (label as string).trim(),
    type: type as SlotType,
    required: required as SlotRequired,
    ask: (ask as string).trim(),
    ...(variants !== undefined
      ? { ask_variants: (variants as string[]).map((v) => v.trim()) }
      : {}),
    ...(validate !== undefined ? { validate: validate as SlotValidate } : {}),
    pii: pii as SlotPii,
    show_in_card: showInCard as boolean,
    ...(cardLabel !== undefined ? { card_label: (cardLabel as string).trim() } : {}),
    max_attempts: maxAttempts as number,
    confirm: confirm as SlotConfirm,
  };
  return { slot, problems: [] };
}

/** The problems in a `validate` block, judged against the slot's type when it is known. */
function validateProblems(
  validate: unknown,
  type: SlotType | undefined,
): Array<[SlotProblemCode, string]> {
  if (!isPlainObject(validate)) return [['slot_bad_validate', 'validate must be an object']];
  const out: Array<[SlotProblemCode, string]> = [];

  for (const key of Object.keys(validate)) {
    if (!VALIDATE_FIELDS.has(key)) out.push(['slot_bad_validate', `unknown validate field ${key}`]);
  }

  const { min, max, enum_source: source, enum_values: values, regex } = validate;
  const networkAware = validate['network_aware'];

  for (const [key, bound] of [
    ['min', min],
    ['max', max],
  ] as const) {
    if (bound === undefined) continue;
    if (typeof bound !== 'number' || !Number.isFinite(bound)) {
      out.push(['slot_bad_validate', `${key} must be a number`]);
    } else if (type !== undefined && !SLOT_RANGE_TYPES.includes(type)) {
      out.push(['slot_bad_validate', `${key} applies only to ${SLOT_RANGE_TYPES.join(', ')}`]);
    }
  }
  if (typeof min === 'number' && typeof max === 'number' && min > max) {
    out.push(['slot_bad_validate', 'min must not be greater than max']);
  }

  if (source !== undefined && !isOneOf(SLOT_ENUM_SOURCES, source)) {
    out.push(['slot_unknown_enum_source', `unknown enum_source ${String(source)}`]);
  }
  if (
    values !== undefined &&
    !(
      Array.isArray(values) &&
      values.length > 0 &&
      values.length <= SLOT_ENUM_VALUES_MAX &&
      values.every(nonEmptyString) &&
      new Set(values.map((v) => (v as string).trim().toLocaleLowerCase('tr'))).size ===
        values.length
    )
  ) {
    out.push([
      'slot_bad_validate',
      `enum_values must be 1 to ${SLOT_ENUM_VALUES_MAX} distinct, non-empty strings`,
    ]);
  }
  if (type === 'enum') {
    if (source === undefined && values === undefined) {
      out.push(['slot_enum_needs_values', 'an enum slot needs enum_source or enum_values']);
    } else if (source !== undefined && values !== undefined) {
      out.push(['slot_bad_validate', 'an enum slot takes enum_source or enum_values, not both']);
    }
  } else if (type !== undefined && (source !== undefined || values !== undefined)) {
    out.push(['slot_bad_validate', 'enum_source and enum_values apply only to an enum slot']);
  }

  if (regex !== undefined) {
    if (typeof regex !== 'string' || regex.length === 0 || regex.length > SLOT_REGEX_MAX) {
      out.push(['slot_bad_validate', `regex must be 1 to ${SLOT_REGEX_MAX} characters`]);
    } else if (type !== undefined && !SLOT_REGEX_TYPES.includes(type)) {
      out.push(['slot_bad_validate', `regex applies only to ${SLOT_REGEX_TYPES.join(', ')}`]);
    } else if (!compiles(regex)) {
      out.push(['slot_bad_validate', 'regex does not compile']);
    } else if (NESTED_QUANTIFIER.test(regex)) {
      out.push(['slot_bad_validate', 'regex must not repeat a repeated group']);
    }
  }

  if (networkAware !== undefined) {
    if (typeof networkAware !== 'boolean') {
      out.push(['slot_bad_validate', 'network_aware must be true or false']);
    } else if (type !== undefined && type !== 'txid') {
      out.push(['slot_bad_validate', 'network_aware applies only to a txid slot']);
    }
  }
  return out;
}

function compiles(pattern: string): boolean {
  try {
    new RegExp(pattern, 'u');
    return true;
  } catch {
    return false;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isOneOf<T extends string>(list: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && (list as readonly string[]).includes(value);
}
