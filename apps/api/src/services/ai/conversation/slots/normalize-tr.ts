/**
 * Turkish player text → slot values (tm 295.2 · SiyahTuş analysis AI-04 §4).
 *
 * The understanding call (#297) points at the words a value came from —
 * `raw_text` — and proposes a value. The model is not trusted with the value:
 * these readers turn the player's own words into it, deterministically, and say
 * how far the words got:
 *
 *   - "2,5 bin", "2.500", "2500tl", "₺2.500,00"  → 2500 TRY, `filled`;
 *   - "13:40"                                    → today 13:40 in the tenant's zone;
 *   - "dün akşam", "az önce"                     → a day without a time, `partial`
 *                                                  (the next question asks the time);
 *   - a moment in the future or over 30 days ago → `invalid`;
 *   - "evet", "yok", "olmadı", "göndermedim"     → a boolean;
 *   - "bilmiyorum", "hatırlamıyorum"             → `unknown`.
 *
 * Every reader is a pure function of the text and a {@link NormalizeContext} —
 * the moment the player wrote, the tenant's zone (ID-04) and currency. Nothing
 * here reads a table or the clock. `validators.ts` adds the formats (TXID per
 * network, IBAN last four, e-mail, phone, enum options) and `readSlot`, the one
 * entry the extractor (#295.3) calls by slot type.
 *
 * The calendar the player speaks in is the wall calendar — "bugün" is today
 * from midnight, whatever hour the tenant's conversation day starts at — so the
 * date of a moment is `localDayKey` with a midnight boundary.
 */
import { localDayKey, type SlotDateTime, type SlotMoney, type SlotScalar } from '@siyahtus/types';

/** What the readers need besides the text. */
export interface NormalizeContext {
  /** The moment the player wrote: "today", "an hour ago" and "the future" are read against it. */
  now: Date;
  /** The tenant's IANA zone (ID-04 · tm 285); Europe/Istanbul when it has none. */
  timeZone: string;
  /** The tenant's currency (ISO 4217), taken when the player names none. */
  currency: string;
}

/**
 * Why words were not a usable value. The extractor keeps the slot `invalid`
 * (or falls back to the model's value for `unreadable`) and the next question
 * can say what was wrong.
 */
export const SLOT_INVALID_REASONS = [
  /** No value of the slot's kind in the words. */
  'unreadable',
  /** Two different values in the words ("500 ile 1000 arası", "evet… olmadı"). */
  'ambiguous',
  /** An amount or a duration of zero. */
  'not_positive',
  /** A moment after the player wrote. */
  'future',
  /** A moment more than {@link SLOT_MAX_AGE_DAYS} days back. */
  'too_old',
  /** Shaped like the value but malformed: a 63-character TXID, a five-digit "last four". */
  'bad_format',
  /** A TXID of another network's shape than the one collected. */
  'network_mismatch',
  /** A wallet address where a transaction id was asked for. */
  'address_not_txid',
  /** Free text the author's `regex` does not match. */
  'pattern_mismatch',
  /** An enum answer matching none of the options. */
  'not_an_option',
  /** Longer than {@link SLOT_TEXT_MAX} characters. */
  'too_long',
  /** A `file` slot: filled by an attachment, never by words. */
  'attachment_only',
] as const;
export type SlotInvalidReason = (typeof SLOT_INVALID_REASONS)[number];

/**
 * What a reader made of the words. `filled` and `partial` carry the value and
 * the `display` the card, the daily digest and the next question read.
 */
export type SlotReading<T extends SlotScalar = SlotScalar> =
  | {
      status: 'filled';
      value: T;
      display: string;
      /** A quantity outside `validate.min`/`max` — kept, flagged for the procedure (AI-04 §4). */
      out_of_range?: 'below_min' | 'above_max';
    }
  | { status: 'partial'; value: T; display: string }
  | { status: 'invalid'; reason: SlotInvalidReason }
  | { status: 'unknown' };

/** A moment older than this many days is `too_old` (AI-04 §4). */
export const SLOT_MAX_AGE_DAYS = 30;

/** A moment this far ahead of `now` is still "now" — the player's clock and ours differ. */
export const SLOT_FUTURE_SKEW_MINUTES = 5;

/** Words longer than this are not a value — a span the model pointed at, not a paragraph. */
export const SLOT_TEXT_MAX = 500;

/** Amounts above this are not read (a pasted account number is not an amount). */
const AMOUNT_MAX = 1e12;

export function invalid(reason: SlotInvalidReason): SlotReading<never> {
  return { status: 'invalid', reason };
}

// ---------------------------------------------------------------------------
// Folding.
// ---------------------------------------------------------------------------

/**
 * Lower-cased with Turkish rules, Turkish letters folded to ASCII (ş→s, ı→i,
 * ğ→g, ü→u, ö→o, ç→c), a letter repeated three times or more squashed to one
 * ("evettt", "yoook"), whitespace collapsed. Digits and punctuation stay:
 * "13:40" and "2.500,00" must survive, which is why this is not
 * `foldForSensitiveMatch`.
 */
export function foldTr(text: string): string {
  return text
    .toLocaleLowerCase('tr')
    .replace(/ı/g, 'i')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[’‘`´]/g, "'")
    .replace(/([a-z])\1{2,}/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/** "bilmiyorum", "hatırlamıyorum", "emin değilim" — the player does not know (AI-04 §5 `unknown`). */
const UNKNOWN_ANSWER =
  /\b(bilmiyorum|bilmiyom|bilmiyoruz|bilemiyorum|bilmem|hatirlamiyorum|hatirlamiyom|hatirlayamiyorum|emin degilim|fikrim yok|bilgim yok|unuttum|(i )?(do not|don'?t) know|not sure|no idea|idk|dunno)\b/;

export function isUnknownAnswer(text: string): boolean {
  return UNKNOWN_ANSWER.test(foldTr(text));
}

// ---------------------------------------------------------------------------
// Numbers and amounts.
// ---------------------------------------------------------------------------

/**
 * A number written with digits, Turkish or English separators:
 *
 *   - both `.` and `,` — the last one is the decimal mark ("1.250,50", "1,250.50");
 *   - one kind, more than once — thousands ("1.250.000");
 *   - one kind, once — thousands before exactly three digits ("2.500", "2,500"),
 *     a decimal mark otherwise ("2,5", "12.50").
 *
 * **Assumption:** "2,500" is two thousand five hundred, as "2.500" is — a
 * player who means two and a half writes "2,5".
 */
export function parseDigits(raw: string): number | null {
  if (!/^\d+(?:[.,]\d+)*$/.test(raw)) return null;
  const dots = raw.split('.').length - 1;
  const commas = raw.split(',').length - 1;
  let normalized: string;
  if (dots > 0 && commas > 0) {
    const decimal = raw.lastIndexOf('.') > raw.lastIndexOf(',') ? '.' : ',';
    const thousands = decimal === '.' ? ',' : '.';
    const [whole = '', fraction = ''] = raw.split(thousands).join('').split(decimal);
    if (raw.split(decimal).length > 2) return null;
    normalized = `${whole}.${fraction}`;
  } else if (dots + commas === 0) {
    normalized = raw;
  } else {
    const mark = dots > 0 ? '.' : ',';
    const parts = raw.split(mark);
    if (parts.length > 2) {
      if (!parts.slice(1).every((part) => part.length === 3)) return null;
      normalized = parts.join('');
    } else {
      const [whole = '', fraction = ''] = parts;
      normalized = fraction.length === 3 ? `${whole}${fraction}` : `${whole}.${fraction}`;
    }
  }
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

/** Number words, folded. */
const UNIT_WORDS: Readonly<Record<string, number>> = {
  sifir: 0,
  bir: 1,
  iki: 2,
  uc: 3,
  dort: 4,
  bes: 5,
  alti: 6,
  yedi: 7,
  sekiz: 8,
  dokuz: 9,
  on: 10,
  yirmi: 20,
  otuz: 30,
  kirk: 40,
  elli: 50,
  altmis: 60,
  yetmis: 70,
  seksen: 80,
  doksan: 90,
};
const SCALE_WORDS: Readonly<Record<string, number>> = {
  yuz: 100,
  bin: 1_000,
  k: 1_000,
  milyon: 1_000_000,
  milyar: 1_000_000_000,
};
const NUMBER_VOCABULARY = [...Object.keys(UNIT_WORDS), ...Object.keys(SCALE_WORDS), 'bucuk']
  .filter((word) => word !== 'k')
  .sort((a, b) => b.length - a.length);

/**
 * A run of number words written together — "ikibinbeşyüz" → iki, bin, beş,
 * yüz — or null when the word is not made of them only. Suffixed forms
 * ("bine", "yüzde") are not number words.
 */
function splitNumberWords(word: string): string[] | null {
  const parts: string[] = [];
  let rest = word;
  while (rest.length > 0) {
    const next = NUMBER_VOCABULARY.find((candidate) => rest.startsWith(candidate));
    if (next === undefined) return null;
    parts.push(next);
    rest = rest.slice(next.length);
  }
  return parts;
}

/** A currency named by a symbol or a (suffixed) word — `null` for any other word. */
function currencyOf(token: string): string | null {
  if (token === '₺') return 'TRY';
  if (token === '$') return 'USD';
  if (token === '€') return 'EUR';
  if (token === '£') return 'GBP';
  if (/^(usdt|tether)/.test(token)) return 'USDT';
  if (/^(tl|try$|lira)/.test(token)) return 'TRY';
  if (/^(usd|dolar|dollar)/.test(token)) return 'USD';
  if (/^(eur|euro|avro)/.test(token)) return 'EUR';
  if (/^(gbp|sterlin|pound)/.test(token)) return 'GBP';
  return null;
}

/**
 * A word after a number that makes it something other than an amount: a time
 * ("2 saat"), a count ("3 kere"), a digit count ("son 4 hane").
 */
const NOT_AN_AMOUNT_AFTER =
  /^(saniye|sn$|dakika|dk$|dak$|saat|gun|hafta|ay$|aylik|yil|kere|kez|defa|sefer|adet|tane|hane|rakam|karakter|yas$|yasinda|kisi|numara|no$|nolu|te$|ta$|de$|da$|sularinda|gibi|civari|bucukta)/;
/** A word before a number that makes it something other than an amount. */
const NOT_AN_AMOUNT_BEFORE = /^(saat|son|ilk|no|numara|numarasi|id|kod|kodu)$/;

type Token =
  | { kind: 'number'; value: number; digits: boolean }
  | { kind: 'scale'; value: number }
  | { kind: 'half' }
  | { kind: 'currency'; code: string }
  | { kind: 'word'; text: string }
  | { kind: 'break' };

/**
 * Times ("13:40", "saat 13.40") and dates ("13.10.2026", "2026-10-13") taken
 * out before amounts are read — their digits are not an amount.
 */
const NOT_A_NUMBER =
  /\b\d{4}-\d{1,2}-\d{1,2}\b|\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b|\b\d{1,2}:\d{2}\b|\bsaat \d{1,2}[.]\d{2}\b/g;

const TOKEN = /(\d+(?:[.,]\d+)*)|([a-z]+)|([₺$€£])|(§)/g;

function tokenize(folded: string): Token[] {
  const tokens: Token[] = [];
  const text = folded.replace(NOT_A_NUMBER, ' § ');
  for (const match of text.matchAll(TOKEN)) {
    const [, digits, word, symbol] = match;
    if (digits !== undefined) {
      const value = parseDigits(digits);
      tokens.push(value === null ? { kind: 'break' } : { kind: 'number', value, digits: true });
    } else if (word !== undefined) {
      if (word === 'k' && tokens.at(-1)?.kind === 'number') {
        tokens.push({ kind: 'scale', value: 1_000 });
        continue;
      }
      const code = currencyOf(word);
      if (code !== null) {
        tokens.push({ kind: 'currency', code });
        continue;
      }
      const parts = splitNumberWords(word);
      if (parts === null) {
        tokens.push({ kind: 'word', text: word });
        continue;
      }
      for (const part of parts) {
        if (part === 'bucuk') tokens.push({ kind: 'half' });
        else if (SCALE_WORDS[part] !== undefined) {
          tokens.push({ kind: 'scale', value: SCALE_WORDS[part] });
        } else tokens.push({ kind: 'number', value: UNIT_WORDS[part] ?? 0, digits: false });
      }
    } else if (symbol !== undefined) {
      tokens.push({ kind: 'currency', code: currencyOf(symbol) ?? 'TRY' });
    } else {
      tokens.push({ kind: 'break' });
    }
  }
  return tokens;
}

/** One number the words hold, with what stands around it. */
interface NumberGroup {
  value: number;
  /** Written with digits, at least in part. */
  digits: boolean;
  /** Carried a scale word: "bin", "milyon", "k", "yüz". */
  scaled: boolean;
  currency: string | null;
  /** Something else than an amount: "2 saat", "son 4 hane", "saat 3". */
  notAmount: boolean;
}

/**
 * The numbers in folded text, each read whole: "iki bin beş yüz" is one number
 * (2500), "10 bin 500" is 10500, "2,5 bin" is 2500, "bin buçuk" is 1500. Two
 * plain numbers side by side ("500 1000") are two.
 */
function numberGroups(folded: string): NumberGroup[] {
  const tokens = tokenize(folded);
  const groups: NumberGroup[] = [];
  let i = 0;
  while (i < tokens.length) {
    const first = tokens[i];
    if (first?.kind !== 'number' && first?.kind !== 'scale') {
      i++;
      continue;
    }
    const start = i;
    let total = 0;
    let current = 0;
    let lastScale = Infinity;
    let digits = false;
    let scaled = false;
    let previous: Token | undefined;
    for (; i < tokens.length; i++) {
      const token = tokens[i] as Token;
      if (token.kind === 'number') {
        if (previous?.kind === 'number') {
          // "yirmi beş" adds; "500 1000" and "beş yirmi" are two numbers.
          const adds =
            !token.digits &&
            !previous.digits &&
            current >= 10 &&
            token.value < 10 ** Math.floor(Math.log10(current));
          if (!adds) break;
        }
        if (previous?.kind === 'half') break;
        current += token.value;
        digits ||= token.digits;
      } else if (token.kind === 'scale') {
        scaled = true;
        if (token.value === 100) {
          current = (current || 1) * 100;
        } else {
          if (token.value >= lastScale) break;
          total += (current || 1) * token.value;
          current = 0;
          lastScale = token.value;
        }
      } else if (token.kind === 'half') {
        if (previous?.kind === 'scale') {
          const scale = previous.value;
          if (scale === 100) current += 50;
          else total += scale / 2;
        } else if (previous?.kind === 'number') {
          current += 0.5;
        } else break;
      } else break;
      previous = token;
    }
    const before = tokens[start - 1];
    const after = tokens[i];
    const afterNext = tokens[i + 1];
    let currency: string | null = null;
    if (before?.kind === 'currency') currency = before.code;
    else if (after?.kind === 'currency') currency = after.code;
    else if (after?.kind === 'word' && after.text === 'turk' && afterNext?.kind === 'currency') {
      currency = afterNext.code;
    }
    const notAmount =
      currency === null &&
      ((after?.kind === 'word' && NOT_AN_AMOUNT_AFTER.test(after.text)) ||
        (before?.kind === 'word' && NOT_AN_AMOUNT_BEFORE.test(before.text)));
    groups.push({ value: total + current, digits, scaled, currency, notAmount });
  }
  return groups;
}

/**
 * The one amount the words name. A number with a currency or a scale word
 * ("500 TL", "2,5 bin") outranks a bare one; a bare number counts when it is
 * the only one and written with digits ("2500"). Times, dates, durations and
 * digit counts are not amounts. Two different amounts → `ambiguous`.
 */
export function parseAmountTr(
  text: string,
  ctx: Pick<NormalizeContext, 'currency'>,
): SlotReading<SlotMoney> {
  const groups = numberGroups(foldTr(text)).filter((group) => !group.notAmount);
  const marked = groups.filter((group) => group.currency !== null || group.scaled);
  const pool = marked.length > 0 ? marked : groups.filter((group) => group.digits);
  const distinct = new Map(
    pool.map((group) => [`${round2(group.value)} ${group.currency ?? ''}`, group] as const),
  );
  if (distinct.size === 0) return invalid('unreadable');
  if (distinct.size > 1) return invalid('ambiguous');
  const group = [...distinct.values()][0] as NumberGroup;
  const amount = round2(group.value);
  if (amount > AMOUNT_MAX) return invalid('unreadable');
  if (amount <= 0) return invalid('not_positive');
  const money: SlotMoney = { amount, currency: group.currency ?? ctx.currency };
  return { status: 'filled', value: money, display: formatMoney(money) };
}

/**
 * The one number the words hold — a count, a level, a bet: "3", "üç", "2,5".
 * Number words count here even without a scale.
 */
export function parseNumberTr(text: string): SlotReading<number> {
  const groups = numberGroups(foldTr(text));
  const values = new Set(groups.map((group) => round2(group.value)));
  if (values.size === 0) return invalid('unreadable');
  if (values.size > 1) return invalid('ambiguous');
  const value = [...values][0] as number;
  return { status: 'filled', value, display: formatNumber(value, 0) };
}

/** "2.500 TRY", "1.250,50 TRY" — Turkish grouping, the way the card shows money. */
export function formatMoney(money: SlotMoney): string {
  return `${formatNumber(money.amount, Number.isInteger(money.amount) ? 0 : 2)} ${money.currency}`;
}

function formatNumber(value: number, minimumFractionDigits: number): string {
  return new Intl.NumberFormat('tr-TR', { minimumFractionDigits, maximumFractionDigits: 2 }).format(
    value,
  );
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

// ---------------------------------------------------------------------------
// Durations.
// ---------------------------------------------------------------------------

const DURATION_UNIT_MINUTES: ReadonlyArray<readonly [RegExp, number]> = [
  [/^(saniye|sn$)/, 1 / 60],
  [/^(dakika|dk$|dak$)/, 1],
  [/^saat/, 60],
  [/^gun/, 1_440],
  [/^hafta/, 10_080],
];

/** A count before a unit: "2", "1,5", "yarım", "çeyrek", "bir buçuk", "1 buçuk". */
const DURATION_COUNT = /(\d+(?:[.,]\d+)?|yarim|ceyrek|[a-z]+)( bucuk)?\s*$/;

/**
 * A length of time in whole minutes: "yarım saat" → 30, "1 saat 20 dk" → 80,
 * "1,5 saat" → 90, "2 gün" → 2880.
 */
export function parseDurationTr(text: string): SlotReading<number> {
  const folded = foldTr(text);
  let minutes = 0;
  let found = false;
  for (const match of folded.matchAll(/[a-z]+/g)) {
    const unit = DURATION_UNIT_MINUTES.find(([pattern]) => pattern.test(match[0]));
    if (unit === undefined) continue;
    const before = DURATION_COUNT.exec(folded.slice(0, match.index));
    const count =
      before === null ? null : durationCount(before[1] as string, before[2] !== undefined);
    if (count === null) continue;
    minutes += count * unit[1];
    found = true;
  }
  if (!found) return invalid('unreadable');
  const whole = Math.round(minutes);
  if (whole <= 0) return invalid('not_positive');
  return { status: 'filled', value: whole, display: formatDuration(whole) };
}

/** "2" → 2, "1,5" → 1.5, "yarım" → 0.5, "bir" + "buçuk" → 1.5; null for a word that is no count. */
function durationCount(count: string, andAHalf: boolean): number | null {
  if (count === 'yarim') return 0.5;
  if (count === 'ceyrek') return 0.25;
  const value = parseDigits(count) ?? UNIT_WORDS[count];
  return value === undefined ? null : value + (andAHalf ? 0.5 : 0);
}

/** "45 dk", "1 saat 20 dk", "2 gün 3 saat". */
export function formatDuration(minutes: number): string {
  const days = Math.floor(minutes / 1_440);
  const hours = Math.floor((minutes % 1_440) / 60);
  const rest = minutes % 60;
  const parts = [
    days > 0 ? `${days} gün` : '',
    hours > 0 ? `${hours} saat` : '',
    rest > 0 ? `${rest} dk` : '',
  ].filter(Boolean);
  return parts.join(' ');
}

// ---------------------------------------------------------------------------
// Yes / no.
// ---------------------------------------------------------------------------

const YES_WORDS = new Set([
  'evet',
  'evt',
  'he',
  'hee',
  'aynen',
  'tabii',
  'tabi',
  'tabiki',
  'elbette',
  'kesinlikle',
  'dogru',
  'oldu',
  'var',
  'mevcut',
  'tamam',
  'tamamdir',
  'olur',
  'yes',
  'yep',
  'yeah',
]);
const NO_WORDS = new Set([
  'hayir',
  'hayr',
  'yok',
  'yoktu',
  'olmadi',
  'olmaz',
  'degil',
  'degilim',
  'degildi',
  'yanlis',
  'asla',
  'no',
  'nope',
]);

/** A negated verb: "göndermedim", "oluşturmadım", "gelmedi", "yatmıyor". */
const NEGATED_VERB = /^[a-z]{2,}(?:m[ae]d[iu][a-z]*|m[ae]m[iu]s[a-z]*|m[iu]yor[a-z]*)$/;
/** A verb in the first person past: "gönderdim", "yaptım", "oluşturduk". */
const AFFIRMED_VERB = /^[a-z]{2,}[dt][iu][mk]$/;

/**
 * Yes or no (AI-04 §4): "evet", "var", "oldu" → true; "hayır", "yok",
 * "olmadı", "değil" → false. With none of those words, a verb answers:
 * "gönderdim" → true, "göndermedim" → false. Both answers in the same words →
 * `ambiguous` — the model's value or the next question decides.
 */
export function parseBooleanTr(text: string): SlotReading<boolean> {
  const words = foldTr(text).match(/[a-z]+/g) ?? [];
  let yes = words.some((word) => YES_WORDS.has(word));
  let no = words.some((word) => NO_WORDS.has(word));
  // A verb answers only when no yes/no word does: "kartım yok" is a no, not
  // "kartım" (my card) read as "-dım" (I did).
  if (!yes && !no) {
    no = words.some((word) => NEGATED_VERB.test(word));
    yes = words.some((word) => !NEGATED_VERB.test(word) && AFFIRMED_VERB.test(word));
  }
  if (yes && no) return invalid('ambiguous');
  if (!yes && !no) return invalid('unreadable');
  return { status: 'filled', value: yes, display: yes ? 'Evet' : 'Hayır' };
}

// ---------------------------------------------------------------------------
// Dates and times.
// ---------------------------------------------------------------------------

type PartOfDay = NonNullable<SlotDateTime['part_of_day']>;

const PART_OF_DAY_WORD: Readonly<Record<PartOfDay, string>> = {
  morning: 'sabah',
  afternoon: 'öğleden sonra',
  evening: 'akşam',
  night: 'gece',
};

/** The hour a part of the day has started by — "akşam" before 17:00 is yesterday's. */
const PART_OF_DAY_START: Readonly<Record<PartOfDay, number>> = {
  morning: 6,
  afternoon: 12,
  evening: 17,
  night: 21,
};

const PART_OF_DAY_PATTERNS: ReadonlyArray<readonly [RegExp, PartOfDay]> = [
  [/\b(ogleden sonra|ikindi|oglen?den sonra)/, 'afternoon'],
  // "gece", "gecesi", "geceleyin" — not "geçen" (last), which folds to "gecen".
  [/\b(sabaha karsi|gece(?!n\b))/, 'night'],
  [/\b(aksam)/, 'evening'],
  [/\b(sabah)/, 'morning'],
  [/\b(ogle|oglen|ogleyin)/, 'afternoon'],
];

const MONTHS = [
  'ocak',
  'subat',
  'mart',
  'nisan',
  'mayis',
  'haziran',
  'temmuz',
  'agustos',
  'eylul',
  'ekim',
  'kasim',
  'aralik',
] as const;

/** Sunday first, as `Date#getUTCDay`. "pazar" must not read "pazartesi", nor "cuma" "cumartesi". */
const WEEKDAYS: ReadonlyArray<RegExp> = [
  /\bpazar(?!tesi)/,
  /\bpazartesi/,
  /\bsali\b|\bsaliya|\bsalida/,
  /\bcarsamba/,
  /\bpersembe/,
  /\bcuma(?!rtesi)/,
  /\bcumartesi/,
];

const HOUR_WORDS: Readonly<Record<string, number>> = {
  bir: 1,
  iki: 2,
  uc: 3,
  dort: 4,
  bes: 5,
  alti: 6,
  yedi: 7,
  sekiz: 8,
  dokuz: 9,
  on: 10,
  'on bir': 11,
  'on iki': 12,
};

/** "az önce", "demin" — a moment ago, the time not given (AI-04 §4: the time is asked). */
const JUST_NOW =
  /\b(az once|az evvel|biraz once|biraz evvel|demin|deminden|az onceki|simdi|hemen simdi|just now)\b/;

/** "2 saat önce", "yarım saat önce", "10 dk önce", "bir buçuk saat evvel". */
const AGO =
  /(\d+(?:[.,]\d+)?|yarim|ceyrek|[a-z]+)( bucuk)?\s*(dakika|dk|dak|saat)\w*\s*(once|evvel)/;
/** "3 gün önce", "iki gün önce". */
const DAYS_AGO = /(\d+|[a-z]+)\s*gun\s*(once|evvel)/;

/** A time as written: the hour, the minute, and whether the hour could be either half of the day. */
interface WrittenTime {
  hour: number;
  minute: number;
  /** "3", "9:30" — a 1–11 hour with no leading zero: 03:00 or 15:00. */
  twelveHour: boolean;
}

/**
 * A moment as far as the words give it (AI-04 §4), in the tenant's zone:
 *
 *   - a day ("bugün", "dün", "evvelki gün", "3 gün önce", "salı", "13 ekim",
 *     "13.10.2026") and a time ("13:40", "saat 3", "akşam 8", "9 buçukta")
 *     → `filled`;
 *   - a time alone → its latest occurrence that is not in the future: "23:40"
 *     written at 00:30 is last night, "saat 3" written at 16:00 is 15:00;
 *   - "2 saat önce", "yarım saat önce" → the exact moment, `filled`;
 *   - a day alone, a part of a day ("dün akşam") or "az önce" → `partial`;
 *   - in the future (beyond {@link SLOT_FUTURE_SKEW_MINUTES}) → `invalid` future;
 *     before {@link SLOT_MAX_AGE_DAYS} days ago → `invalid` too_old.
 *
 * `completing` is a `partial` moment collected earlier: a time given now lands
 * on its day ("dün akşam", then "21:30" → yesterday 21:30). "Gece" after
 * midnight belongs to the night that began the day before: "dün gece 2'de" is
 * today 02:00. `dateOnly` reads a `date` slot: the day is enough to be filled.
 */
export function parseDateTimeTr(
  text: string,
  ctx: Pick<NormalizeContext, 'now' | 'timeZone'>,
  options: { completing?: SlotDateTime | null; dateOnly?: boolean } = {},
): SlotReading<SlotDateTime> {
  const folded = foldTr(text);
  const zone = ctx.timeZone;
  const today = localDayKey(ctx.now, zone, 0);
  const latest = stamp(new Date(ctx.now.getTime() + SLOT_FUTURE_SKEW_MINUTES * 60_000), zone);
  const oldest = addDays(today, -SLOT_MAX_AGE_DAYS);

  const settle = (moment: SlotDateTime, exact: boolean): SlotReading<SlotDateTime> => {
    const at = `${moment.date} ${moment.time ?? '00:00'}`;
    if (moment.date > latest.slice(0, 10) || (moment.time !== null && at > latest)) {
      return invalid('future');
    }
    if (moment.date < oldest) return invalid('too_old');
    const value: SlotDateTime = options.dateOnly
      ? { date: moment.date, time: null, time_zone: zone }
      : moment;
    const filled = options.dateOnly || (exact && moment.time !== null);
    return { status: filled ? 'filled' : 'partial', value, display: formatDateTime(value) };
  };

  // "2 saat önce": the exact moment.
  const ago = AGO.exec(folded);
  if (ago !== null) {
    const count = durationCount(ago[1] as string, ago[2] !== undefined);
    if (count !== null) {
      const minutes = count * (ago[3] === 'saat' ? 60 : 1);
      const at = stamp(new Date(ctx.now.getTime() - Math.round(minutes) * 60_000), zone);
      return settle({ date: at.slice(0, 10), time: at.slice(11), time_zone: zone }, true);
    }
  }

  // The day, when the words name one.
  let rest = folded;
  let date: string | null = null;
  const takeIf = (
    pattern: RegExp,
    accept: (match: RegExpExecArray) => boolean,
  ): RegExpExecArray | null => {
    const match = pattern.exec(rest);
    if (match === null || !accept(match)) return null;
    rest = `${rest.slice(0, match.index)} § ${rest.slice(match.index + match[0].length)}`;
    return match;
  };
  const take = (pattern: RegExp) => takeIf(pattern, () => true);

  const iso = take(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/);
  const full = iso ?? take(/\b(\d{1,2})[./-](\d{1,2})[./-](\d{4}|\d{2})\b/);
  if (iso !== null) {
    date = calendarDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
    if (date === null) return invalid('bad_format');
  } else if (full !== null) {
    const year = Number(full[3]);
    date = calendarDate(year < 100 ? 2000 + year : year, Number(full[2]), Number(full[1]));
    if (date === null) return invalid('bad_format');
  } else {
    const named = take(new RegExp(`\\b(\\d{1,2})\\s*(${MONTHS.join('|')})\\w*(?:\\s+(\\d{4}))?`));
    // "13.10" / "13/10": a date when a time is written elsewhere, or a date is
    // all that is asked, or the slash says so — otherwise "13.40" is a time.
    const hasTime = /\b\d{1,2}:\d{2}\b|\bsaat\b/.test(rest);
    const short =
      named === null
        ? takeIf(
            options.dateOnly || hasTime
              ? /(?<!saat )\b(\d{1,2})[./](\d{1,2})\b(?![.:]\d)/
              : /\b(\d{1,2})\/(\d{1,2})\b(?![.:/]\d)/,
            (match) => Number(match[2]) >= 1 && Number(match[2]) <= 12,
          )
        : null;
    const day = named?.[1] ?? short?.[1];
    const month =
      named !== null ? MONTHS.indexOf(named[2] as (typeof MONTHS)[number]) + 1 : short?.[2];
    if (day !== undefined && month !== undefined) {
      const explicitYear = named?.[3];
      const year = Number(explicitYear ?? today.slice(0, 4));
      date = calendarDate(year, Number(month), Number(day));
      if (date === null) return invalid('bad_format');
      // No year: the latest such day not after today.
      if (explicitYear === undefined && date > today) {
        date = calendarDate(year - 1, Number(month), Number(day));
      }
    }
  }

  let dayFromWords = date !== null;
  if (date === null) {
    let offset: number | null = null;
    const daysAgo = take(DAYS_AGO);
    if (daysAgo !== null) {
      const word = daysAgo[1] as string;
      offset = -(parseDigits(word) ?? UNIT_WORDS[word] ?? NaN);
      if (Number.isNaN(offset)) offset = null;
    }
    if (offset === null && take(/\b(evvelki gun|evvelsi gun|onceki gun|dunden once\w*)/) !== null) {
      offset = -2;
    }
    if (offset === null && take(/\bdun\w*/) !== null) offset = -1;
    if (offset === null && take(/\byarin\w*/) !== null) offset = 1;
    if (offset === null && take(/\bbugun\w*/) !== null) offset = 0;
    // "bu akşam": the part of the day stays in the words for what follows.
    if (offset === null && /\bbu (sabah|aksam|gece|ogle)/.test(rest)) offset = 0;
    if (offset === null) {
      const weekday = WEEKDAYS.findIndex((pattern) => pattern.test(rest));
      if (weekday >= 0) {
        const todayDow = new Date(`${today}T00:00:00Z`).getUTCDay();
        offset = -((todayDow - weekday + 7) % 7);
        if (offset === 0 && /\bgecen\b/.test(rest)) offset = -7;
      }
    }
    if (offset !== null) {
      date = addDays(today, offset);
      dayFromWords = true;
    }
  }

  const spokenPart = PART_OF_DAY_PATTERNS.find(([pattern]) => pattern.test(rest))?.[1];
  // A partial moment from earlier lends its day — and its part of the day —
  // to words that name no day of their own.
  const completing =
    date === null && options.completing != null && options.completing.time === null
      ? options.completing
      : null;
  const partOfDay = spokenPart ?? completing?.part_of_day;
  const time = writtenTime(rest, partOfDay);
  if (completing !== null && (time !== null || spokenPart !== undefined)) {
    date = completing.date;
    dayFromWords = true;
  }

  const base = (moment: { date: string; time: string | null }): SlotDateTime => ({
    date: moment.date,
    time: moment.time,
    time_zone: zone,
    ...(partOfDay !== undefined ? { part_of_day: partOfDay } : {}),
  });

  if (time === null) {
    if (date !== null) return settle(base({ date, time: null }), false);
    if (spokenPart !== undefined && partOfDay !== undefined) {
      // "akşam" before the evening has begun is yesterday's.
      const hour = Number(latest.slice(11, 13));
      const started =
        partOfDay === 'night'
          ? hour >= PART_OF_DAY_START.night || hour < 6
          : hour >= PART_OF_DAY_START[partOfDay];
      return settle(base({ date: started ? today : addDays(today, -1), time: null }), false);
    }
    if (JUST_NOW.test(folded)) return settle(base({ date: today, time: null }), false);
    return invalid('unreadable');
  }

  // The hours the written time can be, and the days it can fall on.
  const hours = time.twelveHour ? [time.hour, time.hour + 12] : [time.hour];
  let days = date !== null ? [date] : [today, addDays(today, -1)];
  // "dün gece 2'de": the night that began yesterday, so today 02:00. Today's
  // night before 06:00 ("bu gece 2'de") is already today.
  if (dayFromWords && date !== null && date < today && partOfDay === 'night' && time.hour < 6) {
    days = [addDays(date, 1)];
  }
  const candidates = days
    .flatMap((day) => hours.map((hour) => `${day} ${pad(hour)}:${pad(time.minute)}`))
    .sort()
    .reverse();
  const chosen = candidates.find((candidate) => candidate <= latest);
  if (chosen === undefined) return invalid('future');
  return settle(base({ date: chosen.slice(0, 10), time: chosen.slice(11) }), true);
}

/** After "akşam 2": not a decimal ("akşam 2,5 bin") and not an amount ("akşam 20 TL"). */
const NOT_AN_HOUR = String.raw`(?![.,]\d|\s*(?:tl|try|lira\w*|dolar\w*|usd\w*|euro|bin|milyon|k)\b)`;

/**
 * The time written in the words, the part of the day applied: "akşam 8" →
 * 20:00, "öğleden sonra 3" → 15:00, "gece 11" → 23:00, "gece 12" → 00:00.
 */
function writtenTime(text: string, partOfDay: PartOfDay | undefined): WrittenTime | null {
  let hourText: string | undefined;
  let minute = 0;
  const clock =
    /\b(\d{1,2})[:.](\d{2})\b/.exec(text) ??
    /\bsaat (\d{1,2})(?:[:.](\d{2}))?/.exec(text) ??
    /\b(\d{1,2}) ?(?:bucuk)/.exec(text) ??
    /\b(\d{1,2}) ?'? ?(?:te|ta|de|da|gibi|sularinda|civari)\b/.exec(text) ??
    (partOfDay !== undefined
      ? new RegExp(
          `\\b(?:sabah\\w*|ogleden sonra|ogle\\w*|aksam\\w*|gece\\w*) (\\d{1,2})\\b${NOT_AN_HOUR}`,
        ).exec(text)
      : null);
  if (clock !== null) {
    hourText = clock[1];
    minute = clock[2] !== undefined ? Number(clock[2]) : /bucuk/.test(clock[0]) ? 30 : 0;
  } else {
    const word =
      /\bsaat (on bir|on iki|bir|iki|uc|dort|bes|alti|yedi|sekiz|dokuz|on)\b( bucuk)?/.exec(text);
    if (word === null) return null;
    hourText = String(HOUR_WORDS[word[1] as string]);
    if (word[2] !== undefined) minute = 30;
  }
  let hour = Number(hourText);
  if (hour > 23 || minute > 59) return null;

  const leadingZero = (hourText as string).length === 2 && (hourText as string).startsWith('0');
  if (partOfDay !== undefined && hour <= 12 && !leadingZero) {
    if (partOfDay === 'afternoon' || partOfDay === 'evening') {
      if (hour < 12) hour += 12;
    } else if (partOfDay === 'night') {
      if (hour === 12) hour = 0;
      else if (hour >= 6) hour += 12;
    }
    return { hour, minute, twelveHour: false };
  }
  return { hour, minute, twelveHour: hour >= 1 && hour <= 11 && !leadingZero };
}

/** "13.10.2026 13:40", "13.10.2026 akşam", "13.10.2026". */
export function formatDateTime(value: SlotDateTime): string {
  const [year, month, day] = value.date.split('-');
  const date = `${day}.${month}.${year}`;
  if (value.time !== null) return `${date} ${value.time}`;
  return value.part_of_day !== undefined ? `${date} ${PART_OF_DAY_WORD[value.part_of_day]}` : date;
}

const clockFormatters = new Map<string, Intl.DateTimeFormat>();

/** `YYYY-MM-DD HH:MM` on the zone's wall clock — compared as strings. */
function stamp(at: Date, timeZone: string): string {
  let formatter = clockFormatters.get(timeZone);
  if (formatter === undefined) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      hour: '2-digit',
      minute: '2-digit',
    });
    clockFormatters.set(timeZone, formatter);
  }
  let hour = '00';
  let minute = '00';
  for (const part of formatter.formatToParts(at)) {
    if (part.type === 'hour') hour = part.value;
    else if (part.type === 'minute') minute = part.value;
  }
  return `${localDayKey(at, timeZone, 0)} ${hour}:${minute}`;
}

function addDays(dateKey: string, days: number): string {
  const date = new Date(`${dateKey}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** `YYYY-MM-DD`, or null for a day the calendar does not have (31.02). */
function calendarDate(year: number, month: number, day: number): string | null {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date.toISOString().slice(0, 10);
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}
