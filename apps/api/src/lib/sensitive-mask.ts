/**
 * Sensitive-data masking at write time (tm 300 · SiyahTuş analysis AI-26 ·
 * guardrail G11 · K12: masking runs before the model sees the text).
 *
 * A player in a panic types whatever the "support agent" on the other line
 * asks for — a password, the SMS code, a card and its CVV, a wallet's seed
 * phrase. `maskSensitive(text, { author })` replaces every such value the
 * author's policy (`DEFAULT_SENSITIVE_POLICY`, AI-26-S2) covers and says what it
 * replaced and where. It is the superset of the GL-5 card masker: `cc-mask.ts`
 * now delegates here with a cards-only policy. It is pure — the original value
 * is not kept, logged or returned, only its type.
 *
 * The detectors (AI-26 §1):
 *
 *   card                Luhn-valid 13–19 digits, grouped by single spaces or
 *                       hyphens — the GL-5 rule unchanged; the mask keeps the
 *                       last four (`**** **** **** 1234`).
 *   iban                a registered country code, that country's exact length
 *                       and the mod-97 check; the mask keeps the country and the
 *                       last four (AI-26-S1: `TR** **** … **13 26`).
 *   cvv                 3–4 digits within 30 characters of cvv / cvc /
 *                       güvenlik kodu / "arkadaki 3 hane".
 *   otp                 4–8 digits within 30 characters of kod / sms / otp /
 *                       doğrulama / şifre (AI-26-S3). A bare number is never an
 *                       OTP, nor is an amount ("2500 TL"), a part of a reference
 *                       ("PPR-20261014-482913"), a decimal ("2.500"), a grouped
 *                       phone number or anything inside a hex string (a TXID).
 *   password            şifrem / parolam / password / pw and the token after it.
 *   seed_phrase         12 or more BIP-39 English words in a row.
 *   private_key         a WIF key (51–52 base58 characters from 5/K/L), or 64
 *                       hex digits within 30 characters of "private key" /
 *                       "özel anahtar" — 64 hex digits alone are a TXID, which
 *                       the deposit hand-off needs whole.
 *   banking_credential  müşteri no / internet şubesi, a number, then a password:
 *                       the number and the password are masked.
 *
 * Every keyword is matched on a folded copy of the text (Turkish letters to
 * ASCII, lower case) whose offsets equal the original's, so "ŞİFREM", "şifrem"
 * and "sifrem" are one keyword.
 *
 * Where two detections overlap, the wider wins (AI-26 §1). On a tie the one with
 * the stronger evidence wins: a checksum (card, IBAN), then the most context
 * (`PRIORITY`).
 *
 * Every pattern is compiled once, at module load, and written so a failed match
 * cannot backtrack more than a bounded number of steps (no nested or adjacent
 * unbounded quantifiers over the same characters; every repetition is either
 * fixed-width, bounded, or followed by a character it cannot also match). The
 * cost is linear in the text — `sensitive-mask.test.ts` pins that with
 * adversarial 10,000-character inputs.
 */
import {
  DEFAULT_SENSITIVE_POLICY,
  SENSITIVE_TYPES,
  type SensitiveAuthor,
  type SensitivePolicy,
  type SensitiveType,
} from '@siyahtus/types';
import { BIP39_ENGLISH } from './bip39-english.js';

/** One masked value, by offsets into the **masked** text (the mask that replaced it). */
export interface SensitiveDetection {
  type: SensitiveType;
  start: number;
  end: number;
}

export interface MaskSensitiveResult {
  text: string;
  /** In text order; empty when nothing was masked. */
  detections: SensitiveDetection[];
}

export interface MaskSensitiveOptions {
  author: SensitiveAuthor;
  /** The types masked per author; `DEFAULT_SENSITIVE_POLICY` when absent. */
  policy?: SensitivePolicy;
}

/** What a secret becomes — fixed width, so the mask does not give away its length. */
export const SECRET_MASK = '********';
/** The card mask the GL-5 KK names verbatim; the last four digits are kept. */
const CARD_MASK_PREFIX = '**** **** **** ';
/** How many characters may stand between a keyword and the value it qualifies (AI-26 §1). */
const NEAR = 30;
/** A password token is at most this long (AI-26 §1); a longer run is not one. */
const SECRET_MAX = 64;
/** The shortest seed phrase BIP-39 defines. */
const SEED_MIN_WORDS = 12;

/** Tie-break between equally wide detections — lower wins. */
const PRIORITY: Readonly<Record<SensitiveType, number>> = {
  card: 0,
  iban: 1,
  banking_credential: 2,
  private_key: 3,
  seed_phrase: 4,
  cvv: 5,
  password: 6,
  otp: 7,
};

interface Candidate {
  type: SensitiveType;
  start: number;
  end: number;
  replacement: string;
}

type Span = readonly [start: number, end: number];

// ---------------------------------------------------------------------------
// Folding
// ---------------------------------------------------------------------------

/**
 * Turkish and Azerbaijani letters folded to ASCII, one code unit for one, so
 * offsets in the folded text are offsets in the original. `İ` is mapped by
 * hand: `toLowerCase` turns it into two code units.
 */
const FOLD: Readonly<Record<string, string>> = {
  İ: 'i',
  I: 'i',
  ı: 'i',
  Î: 'i',
  î: 'i',
  Ş: 's',
  ş: 's',
  Ğ: 'g',
  ğ: 'g',
  Ü: 'u',
  ü: 'u',
  Û: 'u',
  û: 'u',
  Ö: 'o',
  ö: 'o',
  Ç: 'c',
  ç: 'c',
  Â: 'a',
  â: 'a',
  Ə: 'e',
  ə: 'e',
};

function fold(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i += 1) {
    const ch = text.charAt(i);
    const lower = FOLD[ch] ?? ch.toLowerCase();
    out += lower.length === 1 ? lower : ch;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Patterns — compiled once. "folded" patterns run on the folded copy.
// ---------------------------------------------------------------------------

/**
 * GL-5's card candidate: 13–19 digits, groups split by one space or hyphen. The
 * digit lookarounds stop a card-length window being carved out of a longer run.
 */
const CARD_CANDIDATE = /(?<!\d)\d(?:[ -]?\d){12,18}(?!\d)/g;
const CARD_SEPARATORS = /[ -]/g;

/** Where an IBAN may start: two letters, an optional space, two check digits. */
const IBAN_START = /(?<![0-9A-Za-z])[A-Za-z]{2} ?\d{2}/g;

/**
 * A standalone 3–8 digit number (folded): not touching a letter or digit, and
 * not one part of a number joined by `.`, `,`, `/` or `-` (a decimal, a date,
 * a reference like `PPR-20261014-482913`).
 */
const DIGIT_RUN = /(?<![\p{L}\p{N}])(?<!\d[.,/-])\d{3,8}(?![\p{L}\p{N}])(?![.,/-]\d)/gu;

/**
 * Three or more digit groups joined by single separators (folded) — a phone
 * number as people type it ("0532 123 45 67"). With 10+ digits in all it is a
 * reference, and no group inside it is a CVV or an OTP.
 */
const DIGIT_CHAIN = /(?<![\p{L}\p{N}])(?<!\d[ .-])\+?\d+(?:[ .-]\d+){2,}/gu;
const CHAIN_MIN_DIGITS = 10;
const NON_DIGITS = /\D/g;

/** An amount: a currency right after the number (folded, sticky at the number's end). */
const CURRENCY_AFTER = /[ \t]?(?:tl|lira|usdt|usd|eur|euro|dolar|₺|\$|€)(?![a-z])/y;
const CURRENCY_SYMBOLS = '₺$€';

/** A hex string (folded): a TXID, a hash, a key. Card-shaped digits inside it are not a card. */
const HEX_TOKEN = /(?<![\p{L}\p{N}])(?:0x)?[0-9a-f]{32,128}(?![\p{L}\p{N}])/gu;
const PRIVATE_KEY_HEX_LENGTH = 64;

/**
 * A UUID (folded) — an id, never a secret. Its last two groups can be sixteen
 * digits that pass Luhn (`…-8000-000000000011`), and a code-shaped group can sit
 * near a keyword; neither is masked out of it (tm 300.2: an id in a prompt or a
 * log line must survive whole). Fixed width, so it cannot backtrack.
 */
const UUID_TOKEN =
  /(?<![\p{L}\p{N}-])[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?![\p{L}\p{N}-])/gu;

/** A WIF private key: base58, 51 characters from `5` or 52 from `K`/`L`. */
const WIF =
  /(?<![0-9A-Za-z])(?:5[1-9A-HJ-NP-Za-km-z]{50}|[KL][1-9A-HJ-NP-Za-km-z]{51})(?![0-9A-Za-z])/g;

/** Keywords (folded). Each runs to the end of its word, so a gap is measured from the word. */
const CVV_KEYWORD =
  /(?<![a-z0-9])(?:cvv2?|cvc2?|guvenlik (?:kodu|numarasi)|security code|arka(?:daki|sindaki)? ?(?:3|uc) hane)[a-z]*/g;
const OTP_KEYWORD = /(?<![a-z0-9])(?:kod|code|sms|otp|dogrulama|verification|sifre|parola)[a-z]*/g;

/**
 * A number its own label names as a reference (folded, tested against at most
 * `LABEL_WINDOW` characters before it): "SMS order 680112", "sipariş no 482913",
 * "fatura #2041". The word right before the number decides — "SMS kodu 482913"
 * is still a code (tm 300.2: the SMS channel's own order numbers were being
 * masked as one-time codes). Anchored at the end of a bounded slice, so it costs
 * a constant per number.
 */
const REFERENCE_LABEL =
  /(?:^|[^a-z0-9])(?:order|siparis|islem|ref|referans|reference|no|numara|numarasi|number|id|fatura|invoice|takip|tracking|ticket|talep|kargo)[ \t]*[:#.]?[ \t]*$/;
const LABEL_WINDOW = 24;
const PRIVATE_KEY_KEYWORD =
  /(?<![a-z0-9])(?:private[ _-]?key|privkey|(?:ozel|gizli) anahtar|secret key)[a-z]*/g;
const BANKING_KEYWORD =
  /(?<![a-z0-9])(?:musteri ?(?:no|numara)|internet (?:subesi|bankaciligi))[a-z]*/g;

/**
 * "My password" (folded). The bare nouns (`sifre`, `parola`, `pass`) only count
 * before an explicit `:` / `=` — "şifre sıfırlama linki gelmedi" names no
 * password.
 */
const PASSWORD_KEYWORD =
  /(?<![a-z0-9])(sifre(?:miz|niz|m|n)?|parola(?:miz|niz|m|n)?|passwd|password|pass|pwd|pw)(?![a-z])/g;
const BARE_PASSWORD_KEYWORDS: ReadonlySet<string> = new Set(['sifre', 'parola', 'pass']);

/**
 * What may stand between a password keyword and its value (folded, sticky):
 * a few blanks, at most one filler word ("password is …", "şifrem şu: …") that
 * a blank or the colon ends, then an optional `:` / `=` — group 1, the explicit
 * form.
 */
const SECRET_LEAD = /\s{0,3}(?:(?:is|su|sudur|de|da|ise)(?=[ \t:=])[ \t]{0,3})?(?:([:=])\s{0,3})?/y;
/** The value itself: one more than the cap, so an over-long run is recognisable. */
const SECRET_TOKEN = new RegExp(`\\S{1,${SECRET_MAX + 1}}`, 'y');
const TRAILING_PUNCTUATION = /[.,;:!?]+$/;
/** A Turkish suffix after an apostrophe ("SMS'le", "1234'tü") is not part of the word. */
const APOSTROPHE_SUFFIX = /['’]\p{L}+$/u;
/** A digit or a symbol — hyphens and apostrophes are word-internal in Turkish ("e-posta"). */
const DIGIT_OR_SYMBOL = /[^\p{L}'’-]/u;
const UPPERCASE = /\p{Lu}/u;
const LOWERCASE = /\p{Ll}/u;

/** The banking login's number and the password keyword after it (folded, searched in a window). */
const BANK_NUMBER = /(?<![\p{L}\p{N}])\d{5,12}(?![\p{L}\p{N}])/u;
const BANK_SECRET_KEYWORD = /(?<![a-z0-9])(?:sifre|parola|password|pin)[a-z]*/;

/** A word for the seed-phrase scan (folded), and what may separate two seed words. */
const WORD = /[a-z]+/g;
const SEED_GAP = /^[\s\d.,;:()-]{1,8}$/;
const BIP39: ReadonlySet<string> = new Set(BIP39_ENGLISH);

/**
 * The SWIFT IBAN registry: country code and total length. A code not here is
 * not an IBAN, and an IBAN is exactly its country's length.
 */
const IBAN_LENGTHS: ReadonlyMap<string, number> = new Map(
  (
    'AD24 AE23 AL28 AT20 AZ28 BA20 BE16 BG22 BH22 BI27 BR29 BY28 CH21 CR22 CY28 CZ24 ' +
    'DE22 DJ27 DK18 DO28 EE20 EG29 ES24 FI18 FK18 FO18 FR27 GB22 GE22 GI23 GL18 GR27 ' +
    'GT28 HR21 HU28 IE22 IL23 IQ23 IS26 IT27 JO30 KW30 KZ20 LB28 LC32 LI21 LT20 LU20 ' +
    'LV21 LY25 MC27 MD24 ME22 MK19 MN20 MR27 MT31 MU30 NI28 NL18 NO15 OM23 PK24 PL28 ' +
    'PS29 PT25 QA29 RO24 RS22 RU33 SA24 SC31 SD18 SE24 SI19 SK24 SM27 SO23 ST25 SV28 ' +
    'TL23 TN24 TR26 UA29 VA22 VG24 XK20 YE30'
  )
    .split(' ')
    .map((entry): [string, number] => [entry.slice(0, 2), Number(entry.slice(2))]),
);

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

/** Luhn (mod-10) checksum — the check every card network's PAN satisfies. */
function luhnValid(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let d = digits.charCodeAt(i) - 48; // '0' is 48
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

/** ISO 13616 mod-97 over an upper-case, separator-free IBAN. */
function ibanChecksumValid(iban: string): boolean {
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let remainder = 0;
  for (let i = 0; i < rearranged.length; i += 1) {
    const code = rearranged.charCodeAt(i);
    // A digit adds one decimal place; a letter (A = 10 … Z = 35) adds two.
    remainder = code <= 57 ? (remainder * 10 + code - 48) % 97 : (remainder * 100 + code - 55) % 97;
  }
  return remainder === 1;
}

function isAsciiAlnum(code: number): boolean {
  return (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

/** Index of the first span ending after `pos` (spans sorted and disjoint). */
function firstEndingAfter(spans: readonly Span[], pos: number): number {
  let lo = 0;
  let hi = spans.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if ((spans[mid] as Span)[1] <= pos) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function overlapsAny(spans: readonly Span[], start: number, end: number): boolean {
  const span = spans[firstEndingAfter(spans, start)];
  return span !== undefined && span[0] < end;
}

/** Whether a keyword span ends within `NEAR` before [start, end) or starts within `NEAR` after. */
function nearAny(keywords: readonly Span[], start: number, end: number): boolean {
  const i = firstEndingAfter(keywords, start);
  const before = keywords[i - 1];
  if (before !== undefined && start - before[1] <= NEAR) return true;
  const after = keywords[i];
  return after !== undefined && after[0] - end <= NEAR;
}

function spansOf(pattern: RegExp, text: string): Span[] {
  const spans: Span[] = [];
  for (const match of text.matchAll(pattern)) {
    spans.push([match.index, match.index + match[0].length]);
  }
  return spans;
}

/**
 * The first match of a non-global `pattern` starting at most `maxGap`
 * characters after `from`. The window is cut wide enough (`maxLength`) that a
 * match starting inside it is never truncated by the cut.
 */
function searchWithin(
  pattern: RegExp,
  folded: string,
  from: number,
  maxGap: number,
  maxLength: number,
): Span | null {
  const match = pattern.exec(folded.slice(from, from + maxGap + maxLength + 1));
  if (!match || match.index > maxGap) return null;
  return [from + match.index, from + match.index + match[0].length];
}

/**
 * Whether a token reads as a credential rather than a word: four or more
 * characters with a digit, a symbol, or mixed case past the first letter.
 * "ÇALIŞMIYOR" (shouting) and "e-posta" are words; "Ali1234!", "Gs1905" and
 * "GalataSaray" are not.
 */
function looksLikeCredential(core: string): boolean {
  const word = core.replace(APOSTROPHE_SUFFIX, '');
  if (word.length < 4) return false;
  if (DIGIT_OR_SYMBOL.test(word)) return true;
  return UPPERCASE.test(word.slice(1)) && LOWERCASE.test(word);
}

/**
 * The secret after a password keyword ending at `from`, or `null`.
 *
 * After an explicit `:` / `=` any token is the value. Without one the token
 * must look like a credential (`looksLikeCredential`), because "Şifrem
 * çalışmıyor" and "Şifrem 3 kez yanlış girildi" are among the most common
 * sentences in a support inbox and neither names a password. An all-letter
 * password typed after "şifrem" with no colon therefore stays readable: the
 * price of not garbling those sentences.
 */
function readSecret(
  text: string,
  folded: string,
  from: number,
  requireExplicit: boolean,
): Span | null {
  SECRET_LEAD.lastIndex = from;
  const lead = SECRET_LEAD.exec(folded);
  const start = lead ? from + lead[0].length : from;
  const explicit = lead?.[1] !== undefined;
  if (requireExplicit && !explicit) return null;

  SECRET_TOKEN.lastIndex = start;
  const token = SECRET_TOKEN.exec(folded);
  if (!token || token[0].length > SECRET_MAX) return null;
  const end = start + token[0].length;

  const core = text.slice(start, end).replace(TRAILING_PUNCTUATION, '');
  if (core.length === 0) return null;
  if (!explicit && !looksLikeCredential(core)) return null;
  return [start, end];
}

function maskIban(iban: string): string {
  const masked = iban.slice(0, 2) + '*'.repeat(iban.length - 6) + iban.slice(-4);
  const groups: string[] = [];
  for (let i = 0; i < masked.length; i += 4) groups.push(masked.slice(i, i + 4));
  return groups.join(' ');
}

// ---------------------------------------------------------------------------
// Detectors
// ---------------------------------------------------------------------------

function detectCards(text: string, hexTokens: readonly Span[], out: Candidate[]): void {
  for (const match of text.matchAll(CARD_CANDIDATE)) {
    const start = match.index;
    const end = start + match[0].length;
    const digits = match[0].replace(CARD_SEPARATORS, '');
    if (!luhnValid(digits) || overlapsAny(hexTokens, start, end)) continue;
    out.push({ type: 'card', start, end, replacement: CARD_MASK_PREFIX + digits.slice(-4) });
  }
}

/**
 * IBANs: from each possible start, read exactly the country's length in
 * letters and digits (single spaces or hyphens between them allowed), demand
 * that the value ends there, then check mod-97. A scan, not a pattern, so the
 * exact length costs no backtracking.
 */
function detectIbans(text: string, out: Candidate[]): void {
  for (const match of text.matchAll(IBAN_START)) {
    const country = match[0].slice(0, 2).toUpperCase();
    const length = IBAN_LENGTHS.get(country);
    if (length === undefined) continue;

    let normalised = country + match[0].slice(-2);
    let i = match.index + match[0].length;
    while (normalised.length < length) {
      const code = text.charCodeAt(i);
      if (isAsciiAlnum(code)) {
        normalised += text.charAt(i);
        i += 1;
      } else if ((code === 32 || code === 45) && isAsciiAlnum(text.charCodeAt(i + 1))) {
        i += 1;
      } else break;
    }
    if (normalised.length < length || isAsciiAlnum(text.charCodeAt(i))) continue;
    normalised = normalised.toUpperCase();
    if (!ibanChecksumValid(normalised)) continue;
    out.push({ type: 'iban', start: match.index, end: i, replacement: maskIban(normalised) });
  }
}

/** CVVs and OTPs: standalone digit runs that sit near their keyword. */
function detectCodes(
  folded: string,
  ids: readonly Span[],
  wantCvv: boolean,
  wantOtp: boolean,
  out: Candidate[],
): void {
  const cvvKeywords = wantCvv ? spansOf(CVV_KEYWORD, folded) : [];
  const otpKeywords = wantOtp ? spansOf(OTP_KEYWORD, folded) : [];
  if (cvvKeywords.length === 0 && otpKeywords.length === 0) return;

  const chains: Span[] = [];
  for (const match of folded.matchAll(DIGIT_CHAIN)) {
    if (match[0].replace(NON_DIGITS, '').length >= CHAIN_MIN_DIGITS) {
      chains.push([match.index, match.index + match[0].length]);
    }
  }

  for (const match of folded.matchAll(DIGIT_RUN)) {
    const start = match.index;
    const end = start + match[0].length;
    if (isAmount(folded, start, end) || overlapsAny(chains, start, end)) continue;
    if (overlapsAny(ids, start, end)) continue;
    if (REFERENCE_LABEL.test(folded.slice(Math.max(0, start - LABEL_WINDOW), start))) continue;
    const length = end - start;
    if (length <= 4 && nearAny(cvvKeywords, start, end)) {
      out.push({ type: 'cvv', start, end, replacement: SECRET_MASK });
    }
    if (length >= 4 && nearAny(otpKeywords, start, end)) {
      out.push({ type: 'otp', start, end, replacement: SECRET_MASK });
    }
  }
}

function isAmount(folded: string, start: number, end: number): boolean {
  CURRENCY_AFTER.lastIndex = end;
  if (CURRENCY_AFTER.test(folded)) return true;
  const before =
    folded.charAt(start - 1) === ' ' ? folded.charAt(start - 2) : folded.charAt(start - 1);
  return before !== '' && CURRENCY_SYMBOLS.includes(before);
}

function detectPasswords(text: string, folded: string, out: Candidate[]): void {
  for (const match of folded.matchAll(PASSWORD_KEYWORD)) {
    const keyword = match[1] ?? '';
    const secret = readSecret(
      text,
      folded,
      match.index + match[0].length,
      BARE_PASSWORD_KEYWORDS.has(keyword),
    );
    if (secret)
      out.push({ type: 'password', start: secret[0], end: secret[1], replacement: SECRET_MASK });
  }
}

/** 12+ consecutive BIP-39 words, separated only by blanks, punctuation or list numbers. */
function detectSeedPhrases(folded: string, out: Candidate[]): void {
  let count = 0;
  let runStart = 0;
  let runEnd = 0;
  const close = (): void => {
    if (count >= SEED_MIN_WORDS) {
      out.push({ type: 'seed_phrase', start: runStart, end: runEnd, replacement: SECRET_MASK });
    }
    count = 0;
  };
  for (const match of folded.matchAll(WORD)) {
    const start = match.index;
    const isSeedWord = BIP39.has(match[0]);
    if (
      isSeedWord &&
      count > 0 &&
      start - runEnd <= 8 &&
      SEED_GAP.test(folded.slice(runEnd, start))
    ) {
      count += 1;
      runEnd = start + match[0].length;
      continue;
    }
    close();
    if (isSeedWord) {
      count = 1;
      runStart = start;
      runEnd = start + match[0].length;
    }
  }
  close();
}

function detectPrivateKeys(
  text: string,
  folded: string,
  hexTokens: readonly Span[],
  out: Candidate[],
): void {
  for (const match of text.matchAll(WIF)) {
    out.push({
      type: 'private_key',
      start: match.index,
      end: match.index + match[0].length,
      replacement: SECRET_MASK,
    });
  }
  const keywords = spansOf(PRIVATE_KEY_KEYWORD, folded);
  if (keywords.length === 0) return;
  for (const [start, end] of hexTokens) {
    const digits = folded.startsWith('0x', start) ? end - start - 2 : end - start;
    if (digits === PRIVATE_KEY_HEX_LENGTH && nearAny(keywords, start, end)) {
      out.push({ type: 'private_key', start, end, replacement: SECRET_MASK });
    }
  }
}

/** "müşteri no 12345678 şifre 4321": the number and the password, each masked. */
function detectBankingCredentials(text: string, folded: string, out: Candidate[]): void {
  for (const match of folded.matchAll(BANKING_KEYWORD)) {
    const number = searchWithin(BANK_NUMBER, folded, match.index + match[0].length, NEAR, 12);
    if (!number) continue;
    const keyword = searchWithin(BANK_SECRET_KEYWORD, folded, number[1], NEAR, 24);
    if (!keyword) continue;
    const secret = readSecret(text, folded, keyword[1], false);
    if (!secret) continue;
    out.push({
      type: 'banking_credential',
      start: number[0],
      end: number[1],
      replacement: SECRET_MASK,
    });
    out.push({
      type: 'banking_credential',
      start: secret[0],
      end: secret[1],
      replacement: SECRET_MASK,
    });
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Keep the widest of overlapping candidates (ties by `PRIORITY`), in text order.
 * Each accepted candidate claims its characters, so the check is linear in the
 * total width of the candidates.
 */
function resolve(candidates: Candidate[], length: number): Candidate[] {
  candidates.sort(
    (a, b) =>
      b.end - b.start - (a.end - a.start) ||
      PRIORITY[a.type] - PRIORITY[b.type] ||
      a.start - b.start,
  );
  const claimed = new Uint8Array(length);
  const accepted: Candidate[] = [];
  for (const candidate of candidates) {
    if (claimed.subarray(candidate.start, candidate.end).includes(1)) continue;
    claimed.fill(1, candidate.start, candidate.end);
    accepted.push(candidate);
  }
  return accepted.sort((a, b) => a.start - b.start);
}

/**
 * Mask every sensitive value in `text` that the author's policy covers.
 *
 * A type the author may write in clear is not detected at all — with one
 * exception: an IBAN is always detected, and when it is not masked it still
 * claims its characters, so a Luhn-valid run of digits inside an agent's IBAN
 * is never masked out of the middle of it (the player must see that IBAN
 * whole, AI-26-S2).
 */
export function maskSensitive(text: string, options: MaskSensitiveOptions): MaskSensitiveResult {
  if (!text) return { text, detections: [] };
  const policy = options.policy ?? DEFAULT_SENSITIVE_POLICY;
  const masked: ReadonlySet<SensitiveType> = new Set(policy[options.author] ?? SENSITIVE_TYPES);
  const folded = fold(text);

  const candidates: Candidate[] = [];
  const hexTokens =
    masked.has('card') || masked.has('private_key') ? spansOf(HEX_TOKEN, folded) : [];
  const ids = spansOf(UUID_TOKEN, folded);
  if (masked.has('card')) {
    // One sorted list: `overlapsAny` searches by position. The two never overlap.
    const opaque = [...hexTokens, ...ids].sort((a, b) => a[0] - b[0]);
    detectCards(text, opaque, candidates);
  }
  detectIbans(text, candidates);
  if (masked.has('cvv') || masked.has('otp')) {
    detectCodes(folded, ids, masked.has('cvv'), masked.has('otp'), candidates);
  }
  if (masked.has('password')) detectPasswords(text, folded, candidates);
  if (masked.has('seed_phrase')) detectSeedPhrases(folded, candidates);
  if (masked.has('private_key')) detectPrivateKeys(text, folded, hexTokens, candidates);
  if (masked.has('banking_credential')) detectBankingCredentials(text, folded, candidates);
  if (candidates.length === 0) return { text, detections: [] };

  const parts: string[] = [];
  const detections: SensitiveDetection[] = [];
  let cursor = 0;
  let written = 0;
  for (const candidate of resolve(candidates, text.length)) {
    if (!masked.has(candidate.type)) continue; // an IBAN the author may share: kept whole
    const before = text.slice(cursor, candidate.start);
    parts.push(before, candidate.replacement);
    written += before.length;
    detections.push({
      type: candidate.type,
      start: written,
      end: written + candidate.replacement.length,
    });
    written += candidate.replacement.length;
    cursor = candidate.end;
  }
  if (detections.length === 0) return { text, detections };
  parts.push(text.slice(cursor));
  return { text: parts.join(''), detections };
}

// ---------------------------------------------------------------------------
// The write paths' view (tm 300.2)
// ---------------------------------------------------------------------------

/** A text as a write path stores it: masked, and the types that were masked in it. */
export interface MaskedForWrite<T extends string | null | undefined = string> {
  text: T;
  /** Catalogue order, once each; empty when nothing was masked. */
  types: SensitiveType[];
}

/**
 * Mask a value that may be absent, for `author` — the shape a write path
 * carries (`string | null | undefined`). A non-string comes back unchanged
 * with no types, so a caller can pass a field through without widening it.
 */
export function maskForWrite<T extends string | null | undefined>(
  value: T,
  author: SensitiveAuthor,
): MaskedForWrite<T> {
  if (typeof value !== 'string' || value === '') return { text: value, types: [] };
  const { text, detections } = maskSensitive(value, { author });
  if (detections.length === 0) return { text: value, types: [] };
  const seen = new Set(detections.map((d) => d.type));
  return { text: text as T, types: SENSITIVE_TYPES.filter((type) => seen.has(type)) };
}

/**
 * Whose policy an event's `author_type` writes under, or null for the
 * system's own lines (a transfer notice, the warning itself), which no person
 * typed and which are not masked.
 */
export function sensitiveAuthorOf(authorType: string): SensitiveAuthor | null {
  return authorType === 'customer' || authorType === 'agent' || authorType === 'bot'
    ? authorType
    : null;
}

/** How deep {@link maskDeep} walks before it leaves a value as it is. */
const DEEP_MAX = 32;

/**
 * Every string in a JSON value masked for `author` — keys untouched, numbers
 * and booleans as they are. For the AI's own records (`ai_conversations` slots
 * and digest, a run log, a decision's `details`), which are written from text
 * that was already masked: this is the second line, so a value a model
 * reconstructed or a path that skipped the first still comes to rest masked.
 */
export function maskDeep<T>(value: T, author: SensitiveAuthor, depth = 0): T {
  if (typeof value === 'string') return maskSensitive(value, { author }).text as T;
  if (depth >= DEEP_MAX || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((item) => maskDeep(item, author, depth + 1)) as T;
  if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
    return value; // a Date, a Decimal, Prisma's DbNull — not JSON text
  }
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) out[key] = maskDeep(item, author, depth + 1);
  return out as T;
}
