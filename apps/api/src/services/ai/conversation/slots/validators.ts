/**
 * Slot formats and the one reader by slot type (tm 295.2 · SiyahTuş analysis
 * AI-04 §4).
 *
 * `normalize-tr.ts` reads what Turkish speech says — amounts, moments, yes/no.
 * This module checks what has a format: a TXID against the crypto network the
 * conversation collected (TRC20 64 hex; ERC20/BEP20 `0x` + 64 hex), a wallet
 * address pasted where a TXID was asked, the last four characters of an IBAN
 * (never the IBAN), an e-mail, a phone number, a URL, a username, an operator's
 * reference code, and an enum answer matched — fuzzily — against its options
 * ("papara", "PPR" → the canonical method, AI-13).
 *
 * {@link readSlot} is what the extractor (#295.3) calls with a slot's
 * definition and the words the model pointed at. It never throws on player
 * text: words are `filled`, `partial`, `unknown` or `invalid` with a reason.
 */
import {
  foldForSensitiveMatch,
  type SlotDateTime,
  type SlotDef,
  type SlotMoney,
  type SlotScalar,
} from '@siyahtus/types';
import {
  SLOT_TEXT_MAX,
  invalid,
  isUnknownAnswer,
  parseAmountTr,
  parseBooleanTr,
  parseDateTimeTr,
  parseDurationTr,
  parseNumberTr,
  type NormalizeContext,
  type SlotReading,
} from './normalize-tr.js';

// ---------------------------------------------------------------------------
// Crypto: networks, transaction ids, wallet addresses.
// ---------------------------------------------------------------------------

/**
 * The networks a USDT deposit travels on (research §3.2). TRON's transaction
 * ids are 64 hex characters; the EVM chains' are `0x` + 64 hex.
 */
export const CRYPTO_NETWORKS = ['TRC20', 'ERC20', 'BEP20'] as const;
export type CryptoNetwork = (typeof CRYPTO_NETWORKS)[number];

/** The network a player names, on `foldForSensitiveMatch` text ("trc-20" → "trc 20"). */
const NETWORK_NAMES: ReadonlyArray<readonly [RegExp, CryptoNetwork]> = [
  [/\b(trc ?20|tron\w*|trx)\b|\btrc ?20/, 'TRC20'],
  [/\b(erc ?20|ethereum\w*|eth|ether)\b|\berc ?20/, 'ERC20'],
  [/\b(bep ?20|bsc|bnb|bnb chain|binance( smart)? chain)\b|\bbep ?20/, 'BEP20'],
];

/** A TRON address: `T` + 33 base58 characters. */
const TRON_ADDRESS = /(?<![0-9A-Za-z])T[1-9A-HJ-NP-Za-km-z]{33}(?![0-9A-Za-z])/;
/** An EVM address: `0x` + 40 hex. */
const EVM_ADDRESS = /(?<![0-9A-Za-z])0x[0-9a-fA-F]{40}(?![0-9A-Za-z])/;
/** A transaction id: 64 hex, `0x` or not. */
const TXID = /(?<![0-9A-Za-z])(0x)?([0-9a-fA-F]{64})(?![0-9A-Za-z])/g;
/** A long hex run of another length — a TXID cut short or run on. */
const HEX_RUN = /(?<![0-9A-Za-z])(?:0x)?[0-9a-fA-F]{20,}(?![0-9A-Za-z])/;

/** The network a wallet address belongs to: TRC20, "EVM" (ERC20 or BEP20 — the same shape), or null. */
export function walletAddressNetwork(text: string): 'TRC20' | 'EVM' | null {
  if (TRON_ADDRESS.test(text)) return 'TRC20';
  if (EVM_ADDRESS.test(text)) return 'EVM';
  return null;
}

/**
 * The crypto network the words name: "TRC-20", "tron ağı", "ERC20",
 * "ethereum'dan", "BSC", "BEP20". A TRON address names TRC20; an EVM address
 * could be either EVM chain and names none.
 */
export function readCryptoNetwork(text: string): SlotReading<string> {
  const folded = foldForSensitiveMatch(text);
  const named = new Set(
    NETWORK_NAMES.filter(([pattern]) => pattern.test(folded)).map(([, network]) => network),
  );
  if (named.size === 0 && walletAddressNetwork(text) === 'TRC20') named.add('TRC20');
  if (named.size === 0) return invalid('unreadable');
  if (named.size > 1) return invalid('ambiguous');
  const network = [...named][0] as CryptoNetwork;
  return { status: 'filled', value: network, display: network };
}

/**
 * A transaction id, checked against `network` when the slot is network-aware
 * and the conversation has collected one (AI-04 §4):
 *
 *   - TRC20 — 64 hex without `0x`; an `0x` id is an EVM transaction → `network_mismatch`;
 *   - ERC20/BEP20 — `0x` + 64 hex; a bare 64-hex id is TRON's shape → `network_mismatch`;
 *   - no network yet — either shape is `filled`.
 *
 * A wallet address is not a transaction id (`address_not_txid`); a hex run of
 * another length is `bad_format`. The id is kept lower-cased, as explorers
 * treat it.
 */
export function readTxid(text: string, network: CryptoNetwork | null): SlotReading<string> {
  const ids = new Set(
    [...text.matchAll(TXID)].map(([, prefix, hex]) => `${prefix ?? ''}${hex}`.toLowerCase()),
  );
  if (ids.size > 1) return invalid('ambiguous');
  const id = [...ids][0];
  if (id === undefined) {
    if (walletAddressNetwork(text) !== null) return invalid('address_not_txid');
    return invalid(HEX_RUN.test(text) ? 'bad_format' : 'unreadable');
  }
  const evmShaped = id.startsWith('0x');
  if (network === 'TRC20' && evmShaped) return invalid('network_mismatch');
  if ((network === 'ERC20' || network === 'BEP20') && !evmShaped) {
    return invalid('network_mismatch');
  }
  return { status: 'filled', value: id, display: id };
}

/** The network a slot's collected value names, or null — for `readSlot`'s context. */
export function asCryptoNetwork(value: unknown): CryptoNetwork | null {
  return typeof value === 'string' && (CRYPTO_NETWORKS as readonly string[]).includes(value)
    ? (value as CryptoNetwork)
    : null;
}

// ---------------------------------------------------------------------------
// IBAN last four.
// ---------------------------------------------------------------------------

/**
 * A whole IBAN, spaces allowed between groups: a Turkish one (TR, two check
 * digits, 22 digits) in any case, or any other in capitals — lower-case
 * words after it must not run into it.
 */
const IBAN = [/\bTR\d{2}(?:\s?\d){22}(?!\d)/i, /\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]){11,30}\b/];

/**
 * The last four digits of an IBAN (AI-04 §2 `iban_last4`): "8841", "son 4
 * hanesi 8841", "****8841". A whole IBAN pasted anyway gives its last four —
 * the rest is never kept or shown. A digit run of another length is
 * `bad_format`; two different fours are `ambiguous`.
 *
 * **Assumption:** digits only — a Turkish IBAN ends in digits, and a letter
 * among "the last four" is more often a typo than a foreign IBAN.
 */
export function readIbanLast4(text: string): SlotReading<string> {
  const iban = IBAN.map((pattern) => pattern.exec(text)).find((match) => match !== null);
  if (iban != null) {
    const compact = iban[0].replace(/\s/g, '');
    const last4 = compact.slice(-4);
    if (/^\d{4}$/.test(last4)) return { status: 'filled', value: last4, display: last4 };
    return invalid('bad_format');
  }
  const runs = text.match(/\d+/g) ?? [];
  const fours = new Set(runs.filter((run) => run.length === 4));
  if (fours.size > 1) return invalid('ambiguous');
  const four = [...fours][0];
  if (four !== undefined) return { status: 'filled', value: four, display: four };
  return invalid(runs.some((run) => run.length > 4) ? 'bad_format' : 'unreadable');
}

// ---------------------------------------------------------------------------
// E-mail, phone, URL, username, reference code, free text.
// ---------------------------------------------------------------------------

const EMAIL = /[^\s@<>()"',;:]+@[^\s@<>()"',;:.]+(?:\.[^\s@<>()"',;:.]+)+/g;

/** An e-mail address in the words, lower-cased. */
export function readEmail(text: string): SlotReading<string> {
  const found = new Set(
    (text.match(EMAIL) ?? []).map((email) => email.replace(/\.$/, '').toLowerCase()),
  );
  if (found.size > 1) return invalid('ambiguous');
  const email = [...found][0];
  if (email === undefined) return invalid(text.includes('@') ? 'bad_format' : 'unreadable');
  if (email.length > 254) return invalid('bad_format');
  return { status: 'filled', value: email, display: email };
}

/**
 * A phone number as E.164. A Turkish number is read in its local forms —
 * "0532 123 45 67", "532 123 45 67", "+90 (532) 123-4567" → `+905321234567`;
 * any other needs its `+` country code.
 */
export function readPhone(text: string): SlotReading<string> {
  const runs = text.match(/\+?\d[\d\s().-]{5,22}\d/g) ?? [];
  const numbers = new Set(runs.map(e164).filter((phone): phone is string => phone !== null));
  if (numbers.size > 1) return invalid('ambiguous');
  const phone = [...numbers][0];
  if (phone === undefined) return invalid(runs.length > 0 ? 'bad_format' : 'unreadable');
  return { status: 'filled', value: phone, display: displayPhone(phone) };
}

function e164(run: string): string | null {
  const digits = run.replace(/\D/g, '');
  if (run.trim().startsWith('+')) {
    return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  }
  if (digits.length === 12 && digits.startsWith('90')) return `+${digits}`;
  if (digits.length === 11 && digits.startsWith('0')) return `+90${digits.slice(1)}`;
  if (digits.length === 10 && /^[2-5]/.test(digits)) return `+90${digits}`;
  return null;
}

/** "+90 532 123 45 67" for a Turkish number, E.164 for the rest. */
function displayPhone(phone: string): string {
  const tr = /^\+90(\d{3})(\d{3})(\d{2})(\d{2})$/.exec(phone);
  return tr === null ? phone : `+90 ${tr[1]} ${tr[2]} ${tr[3]} ${tr[4]}`;
}

/** An http(s) URL in the words; "www.…" is read as https. */
export function readUrl(text: string): SlotReading<string> {
  const found = text.match(/\b(?:https?:\/\/|www\.)[^\s<>"']+/gi) ?? [];
  if (found.length > 1) return invalid('ambiguous');
  const raw = found[0]?.replace(/[.,;:!?)]+$/, '');
  if (raw === undefined) return invalid('unreadable');
  try {
    const url = new URL(/^www\./i.test(raw) ? `https://${raw}` : raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return invalid('bad_format');
    return { status: 'filled', value: url.href, display: url.href };
  } catch {
    return invalid('bad_format');
  }
}

/** "kullanıcı adım", "üye no:", "username" — the label a player puts before the value. */
const LEAD_IN =
  /^\s*(?:(?:benim\s+)?(?:kullan[ıi]c[ıi]\s+ad[ıi]m?|kullan[ıi]c[ıi]\s+ad[ıi]n[ıi]z|[üu]ye\s+(?:no|numaram|numarası|ad[ıi]m?)|nick(?:im)?|username|user\s*name|login|kod(?:um|u)?|referans(?:\s+no)?|ref(?:erans)?\s*kodu?|i[şs]lem\s+no)\s*(?:[:=-]|is|şu|su)?\s*)/iu;

const USERNAME = /^[\p{L}\p{N}][\p{L}\p{N}._-]{1,39}$/u;
const REFERENCE_CODE = /^[\p{L}\p{N}][\p{L}\p{N}._\-/#]{1,63}$/u;

/**
 * A single-token value: the words with a lead-in label and wrapping quotes
 * taken off must be one token of `shape`. An author's `regex` (validated at
 * save with the `u` flag, tm 295.1) must match it too.
 */
function readToken(text: string, shape: RegExp, regex: string | undefined): SlotReading<string> {
  const token = text
    .replace(LEAD_IN, '')
    .trim()
    .replace(/^["'“”‘’«»`(]+|["'“”‘’«»`).,!?]+$/g, '');
  if (token.length === 0) return invalid('unreadable');
  if (/\s/.test(token)) return invalid('ambiguous');
  if (!shape.test(token)) return invalid('bad_format');
  if (regex !== undefined && !new RegExp(regex, 'u').test(token)) {
    return invalid('pattern_mismatch');
  }
  return { status: 'filled', value: token, display: token };
}

/** Free text, trimmed; the author's `regex` must match it when there is one. */
function readText(text: string, regex: string | undefined): SlotReading<string> {
  const value = text.trim().replace(/\s+/g, ' ');
  if (value.length === 0) return invalid('unreadable');
  if (regex !== undefined && !new RegExp(regex, 'u').test(value)) {
    return invalid('pattern_mismatch');
  }
  return { status: 'filled', value, display: value };
}

// ---------------------------------------------------------------------------
// Enum options.
// ---------------------------------------------------------------------------

/**
 * One value an enum slot may take: an author's `enum_values` entry, or a row
 * of the slot's table source (AI-13 · #310) with its aliases ("PPR").
 */
export interface SlotEnumOption {
  value: string;
  /** What the card shows; the value when absent. */
  label?: string;
  aliases?: readonly string[];
}

/**
 * The option the words name (AI-04 §4 — fuzzy, against names and aliases):
 *
 *   1. a name standing as whole words ("papara ile attım", "Banka Havalesi");
 *   2. otherwise a word starting with a name of four letters or more — the
 *      Turkish suffix ("paparayla", "havaleyle");
 *   3. otherwise a word one edit from a name of five letters or more (two for
 *      eight or more): "parpara", "havle".
 *
 * Names of three letters or fewer ("PPR") match only whole. More than one
 * option at the first step that matches → `ambiguous`; none → `not_an_option`.
 */
export function matchEnumOption(
  text: string,
  options: readonly SlotEnumOption[],
): SlotReading<string> {
  const folded = foldForSensitiveMatch(text);
  if (!folded) return invalid('unreadable');
  const words = folded.split(' ');
  const named = options.map((option) => ({
    option,
    names: [option.value, ...(option.aliases ?? [])].map(foldForSensitiveMatch).filter(Boolean),
  }));

  const steps: Array<(name: string) => boolean> = [
    (name) => ` ${folded} `.includes(` ${name} `),
    (name) =>
      name.length >= 4 && !name.includes(' ') && words.some((word) => word.startsWith(name)),
    (name) =>
      name.length >= 5 &&
      !name.includes(' ') &&
      words.some((word) => withinEdits(word, name, name.length >= 8 ? 2 : 1)),
  ];
  for (const step of steps) {
    const matched = new Map(
      named
        .filter(({ names }) => names.some(step))
        .map(({ option }) => [option.value, option] as const),
    );
    if (matched.size > 1) return invalid('ambiguous');
    const option = [...matched.values()][0];
    if (option !== undefined) {
      return { status: 'filled', value: option.value, display: option.label ?? option.value };
    }
  }
  return invalid('not_an_option');
}

/** Levenshtein distance at most `max`, without computing past it. */
function withinEdits(a: string, b: string, max: number): boolean {
  if (Math.abs(a.length - b.length) > max) return false;
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const value = Math.min(
        (previous[j] as number) + 1,
        (current[j - 1] as number) + 1,
        (previous[j - 1] as number) + cost,
      );
      current.push(value);
      best = Math.min(best, value);
    }
    if (best > max) return false;
    previous = current;
  }
  return (previous[b.length] as number) <= max;
}

// ---------------------------------------------------------------------------
// The one reader by slot type.
// ---------------------------------------------------------------------------

/** What `readSlot` needs besides the definition and the words. */
export interface SlotReadContext extends NormalizeContext {
  /** The crypto network the conversation collected, for a `network_aware` TXID. */
  network?: CryptoNetwork | null;
  /**
   * An enum slot's options when they come from a table (`enum_source`, AI-13);
   * an author's `enum_values` are read from the definition.
   */
  options?: readonly SlotEnumOption[];
  /** The slot's `partial` moment so far: a time given now lands on its day. */
  completing?: SlotDateTime | null;
}

/**
 * The value `text` gives `slot` (AI-04 §4): the type's reader, then the
 * slot's own rules — `min`/`max` flag a quantity `out_of_range` (kept, not
 * refused), an author's `regex` narrows free text, a network-aware TXID is
 * checked against `ctx.network`.
 *
 * Words that say the player does not know ("bilmiyorum") are `unknown` when
 * they carry no value of the slot's kind — "tam saati hatırlamıyorum, akşam 9
 * gibi" is still 21:00.
 */
export function readSlot(slot: SlotDef, text: string, ctx: SlotReadContext): SlotReading {
  if (text.length > SLOT_TEXT_MAX) return invalid('too_long');
  if (slot.type === 'boolean' && isUnknownAnswer(text)) return { status: 'unknown' };
  const reading = readByType(slot, text, ctx);
  if (reading.status === 'invalid' && reading.reason === 'unreadable' && isUnknownAnswer(text)) {
    return { status: 'unknown' };
  }
  if (reading.status === 'filled') {
    const outOfRange = rangeFlag(slot, reading.value, ctx.currency);
    if (outOfRange !== undefined) return { ...reading, out_of_range: outOfRange };
  }
  return reading;
}

function readByType(slot: SlotDef, text: string, ctx: SlotReadContext): SlotReading {
  const regex = slot.validate?.regex;
  switch (slot.type) {
    case 'money':
      return parseAmountTr(text, ctx);
    case 'number':
      return parseNumberTr(text);
    case 'duration':
      return parseDurationTr(text);
    case 'datetime':
      return parseDateTimeTr(text, ctx, { completing: ctx.completing ?? null });
    case 'date':
      return parseDateTimeTr(text, ctx, { dateOnly: true });
    case 'boolean':
      return parseBooleanTr(text);
    case 'txid':
      return readTxid(text, slot.validate?.network_aware ? (ctx.network ?? null) : null);
    case 'crypto_network':
      return readCryptoNetwork(text);
    case 'iban_last4':
      return readIbanLast4(text);
    case 'email':
      return readEmail(text);
    case 'phone':
      return readPhone(text);
    case 'url':
      return readUrl(text);
    case 'username':
      return readToken(text, USERNAME, regex);
    case 'reference_code':
      return readToken(text, REFERENCE_CODE, regex);
    case 'enum': {
      const values = slot.validate?.enum_values;
      const options = values !== undefined ? values.map((value) => ({ value })) : ctx.options;
      return options === undefined || options.length === 0
        ? invalid('not_an_option')
        : matchEnumOption(text, options);
    }
    case 'file':
      return invalid('attachment_only');
    case 'text':
      return readText(text, regex);
  }
}

/**
 * Below `min` or above `max` (AI-04 §4: flagged for the procedure's
 * conditions, not refused). A money bound is in the tenant's currency; an
 * amount in another currency is not compared.
 */
function rangeFlag(
  slot: SlotDef,
  value: SlotScalar,
  currency: string,
): 'below_min' | 'above_max' | undefined {
  const { min, max } = slot.validate ?? {};
  if (min === undefined && max === undefined) return undefined;
  let quantity: number;
  if (typeof value === 'number') quantity = value;
  else if (isMoney(value) && value.currency === currency) quantity = value.amount;
  else return undefined;
  if (min !== undefined && quantity < min) return 'below_min';
  if (max !== undefined && quantity > max) return 'above_max';
  return undefined;
}

function isMoney(value: SlotScalar): value is SlotMoney {
  return typeof value === 'object' && 'amount' in value;
}
