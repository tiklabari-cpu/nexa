/**
 * Structured knowledge tables (tm 310 · SiyahTuş analysis AI-13, owner decision
 * K13; ADR-14b §2.12) — the vocabulary the schema
 * (`20261021120000_knowledge_tables`), the contract (`KbPaymentMethod`,
 * `KbBonus`, `KbKycDocument`, `KbRule`, `AiAccessInfo`), the writer and the
 * AI's fact resolver share.
 *
 * "My deposit has not arrived" is judged by comparing when the transaction was
 * made with the method's expected time; a number inside a prose article is one
 * the AI may misread and cannot compute with. So the figures players ask about
 * live in four fixed tables (AI-13-S1) — payment methods, bonuses, KYC
 * documents, limits and rules — and the AI answers them from the row, exactly.
 *
 * - **Brands (AI-13-S3).** A row names the brands it is for (`brand_ids`,
 *   empty: every brand). A brand's own row beats the every-brand row with the
 *   same name ({@link preferBrandRows}); a conversation whose brand is not
 *   known reads the every-brand rows only ({@link knowledgeTableRowServesBrand},
 *   the knowledge store's rule).
 * - **Unique names.** A name, an alias, a document or a key is unique within a
 *   direction (payment methods) and an overlapping brand scope
 *   ({@link findKnowledgeTableConflicts}) — no index can say that.
 * - **Review (AI-13-S2).** A row is due a fresh look `review_interval_days`
 *   after `reviewed_at` — 14 days for payment methods, 30 for bonuses (and at
 *   the campaign's end), 90 for KYC and rules. A due row is warned about and
 *   still used.
 * - **No tenant regex.** The reference a transfer carries is checked against a
 *   fixed format list ({@link PAYMENT_REFERENCE_FORMATS}): a pattern a tenant
 *   types is a ReDoS risk.
 *
 * Plus the access information setting (K13 · AI-08 G14): what the AI says when
 * a player cannot reach the site — only what the workspace entered.
 *
 * Validators return every problem as `{ field, code }` — stable codes the
 * writer turns into 400 `validation` details and the panel into sentences. A
 * blank optional text counts as not given; the writer stores it as null.
 */
import { isIanaTimeZone } from './company.js';
import { isUuid } from './ids.js';
import {
  KNOWLEDGE_REVIEW_INTERVAL_DAYS,
  KNOWLEDGE_SCOPE_IDS_MAX,
  knowledgeReviewDueAt,
} from './knowledge-store.js';
import {
  WORK_SCHEDULE_DAYS,
  WORK_SCHEDULE_TIME_PATTERN,
  type WorkScheduleDay,
} from './work-schedule.js';

// ===========================================================================
// The tables
// ===========================================================================

/** The four tables (AI-13-S1: fixed tables; a flexible one comes later). */
export const KNOWLEDGE_TABLES = ['payment_methods', 'bonuses', 'kyc_documents', 'rules'] as const;
export type KnowledgeTable = (typeof KNOWLEDGE_TABLES)[number];

export function isKnowledgeTable(value: unknown): value is KnowledgeTable {
  return typeof value === 'string' && (KNOWLEDGE_TABLES as readonly string[]).includes(value);
}

/**
 * Each table's name in the database — also what a rendered row's knowledge
 * source records as `source_table` (tm 310.2).
 */
export const KNOWLEDGE_TABLE_SQL_NAMES = Object.freeze({
  payment_methods: 'kb_payment_methods',
  bonuses: 'kb_bonuses',
  kyc_documents: 'kb_kyc_documents',
  rules: 'kb_rules',
} as const satisfies Record<KnowledgeTable, string>);

/** Each table's segment in `/knowledge-tables/{segment}`. */
export const KNOWLEDGE_TABLE_PATH_SEGMENTS = Object.freeze({
  payment_methods: 'payment-methods',
  bonuses: 'bonuses',
  kyc_documents: 'kyc-documents',
  rules: 'rules',
} as const satisfies Record<KnowledgeTable, string>);

/**
 * A new row's review interval, in days (AI-13-S2) — the column defaults. The
 * bounds are the knowledge store's ({@link KNOWLEDGE_REVIEW_INTERVAL_DAYS}).
 */
export const KNOWLEDGE_TABLE_REVIEW_INTERVAL_DAYS = Object.freeze({
  payment_methods: 14,
  bonuses: 30,
  kyc_documents: 90,
  rules: 90,
} as const satisfies Record<KnowledgeTable, number>);

/**
 * Who filled a row: a person (`manual`) or an integration (`integration`, F2),
 * whose rows are not edited by hand.
 */
export const KNOWLEDGE_TABLE_ROW_SOURCES = ['manual', 'integration'] as const;
export type KnowledgeTableRowSource = (typeof KNOWLEDGE_TABLE_ROW_SOURCES)[number];

/** Rows one table holds per workspace — a typo guard, not a plan limit. */
export const KNOWLEDGE_TABLE_ROWS_MAX = 500;

/** The lengths and counts the validators and the CHECKs hold (characters). */
export const KNOWLEDGE_TABLE_LIMITS = Object.freeze({
  nameMax: 80,
  aliasesMax: 20,
  aliasMax: 60,
  ruleTitleMax: 120,
  shortTextMax: 1000,
  longTextMax: 2000,
  termsTextMax: 10_000,
  networksMax: 10,
  commonErrorsMax: 20,
  commonErrorTitleMax: 80,
  contributingMax: 20,
  contributionCategoryMax: 40,
  excludedMethodsMax: 50,
  acceptanceCriteriaMax: 20,
  acceptanceCriterionMax: 200,
  unitMax: 20,
  /** Minutes: thirty days. */
  minutesMax: 43_200,
  reviewHoursMax: 720,
  validityDaysMax: 3650,
  wageringMultiplierMax: 1000,
  /** An amount's ceiling — far below `DECIMAL(18,2)`'s. */
  amountMax: 1_000_000_000_000,
} as const);

// ===========================================================================
// Payment methods
// ===========================================================================

export const PAYMENT_DIRECTIONS = ['deposit', 'withdrawal'] as const;
export type PaymentDirection = (typeof PAYMENT_DIRECTIONS)[number];

/**
 * The reference a transfer carries (AI-13 §6) — a fixed list, never a pattern
 * the workspace types (ReDoS). `none`: the method needs none.
 */
export const PAYMENT_REFERENCE_FORMATS = [
  'none',
  'username',
  'digits',
  'alphanumeric',
  'txid_trc20',
  'txid_evm',
  'phone',
  'email',
] as const;
export type PaymentReferenceFormat = (typeof PAYMENT_REFERENCE_FORMATS)[number];

/**
 * Each format's pattern — anchored, no nested quantifiers, so each runs in
 * linear time. TRC20 transaction ids are 64 hex without `0x`; ERC20/BEP20
 * (EVM) ones `0x` + 64 hex (the AI-04 slot validators' rule).
 */
export const PAYMENT_REFERENCE_FORMAT_PATTERNS = Object.freeze({
  username: /^[\p{L}\p{N}._-]{1,64}$/u,
  digits: /^\d{4,20}$/,
  alphanumeric: /^[A-Za-z0-9]{4,32}$/,
  txid_trc20: /^[0-9a-fA-F]{64}$/,
  txid_evm: /^0x[0-9a-fA-F]{64}$/,
  phone: /^\+?\d{10,15}$/,
  email: /^[^\s@]{1,64}@[^\s@.]{1,63}(\.[^\s@.]{1,63}){1,8}$/,
} as const satisfies Record<Exclude<PaymentReferenceFormat, 'none'>, RegExp>);

/** Whether `value` is a reference of `format`. Trims; a value past 256 characters is not one. */
export function matchesPaymentReferenceFormat(
  format: PaymentReferenceFormat,
  value: string,
): boolean {
  if (format === 'none') return true;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 256) return false;
  return PAYMENT_REFERENCE_FORMAT_PATTERNS[format].test(trimmed);
}

/** A crypto network's name (`TRC20`, `ERC20`, `BEP20`). */
export const PAYMENT_NETWORK_PATTERN = /^[A-Za-z0-9_-]{1,20}$/;

/** A usual error's code (`IBAN_MISMATCH`, `limit.daily`). */
export const PAYMENT_ERROR_CODE_PATTERN = /^[A-Za-z0-9_.-]{1,40}$/;

/** One opening window of a weekday, in the method's time zone. */
export interface PaymentWorkingWindow {
  day: WorkScheduleDay;
  /** 24h `HH:MM`. */
  start: string;
  /** 24h `HH:MM`, after `start`; `24:00` is the end of the day. */
  end: string;
}

/**
 * When a method processes transactions (AI-13): weekly windows in a time zone,
 * and whether it stops on bank holidays. Null on the row: around the clock.
 */
export interface PaymentWorkingHours {
  /** IANA zone, e.g. `Europe/Istanbul`. */
  timezone: string;
  /** Several per day allowed (`09:00–12:00`, `13:00–17:00`); never overlapping. */
  windows: PaymentWorkingWindow[];
  closed_on_bank_holidays: boolean;
}

/** Windows one method holds — three a day. */
export const PAYMENT_WORKING_WINDOWS_MAX = 21;

/** A window's end: a time, or `24:00`. */
export const PAYMENT_WINDOW_END_PATTERN = /^(([01]\d|2[0-3]):[0-5]\d|24:00)$/;

/** A usual error and what to tell the player; `agent_hint` is for agents only. */
export interface PaymentCommonError {
  code: string;
  title: string;
  customer_text: string;
  agent_hint: string | null;
}

/** What a payment method row says — the writable fields. */
export interface PaymentMethodFields {
  name: string;
  aliases: string[];
  direction: PaymentDirection;
  /** ISO 4217 alpha-3. */
  currency: string;
  min_amount: number | null;
  max_amount: number | null;
  expected_minutes: number | null;
  delay_threshold_minutes: number | null;
  working_hours: PaymentWorkingHours | null;
  requires_site_request: boolean;
  reference_instructions: string | null;
  reference_format: PaymentReferenceFormat;
  receipt_required: boolean;
  third_party_allowed: boolean;
  networks: string[];
  common_errors: PaymentCommonError[];
  customer_notes: string | null;
  active: boolean;
}

// ===========================================================================
// Bonuses
// ===========================================================================

export const BONUS_TYPES = [
  'welcome',
  'deposit',
  'reload',
  'cashback',
  'free_spins',
  'free_bet',
  'loss_bonus',
  'loyalty',
  'other',
] as const;
export type BonusType = (typeof BONUS_TYPES)[number];

/** What the wagering multiplier multiplies. */
export const BONUS_WAGERING_BASES = ['bonus', 'bonus_plus_deposit'] as const;
export type BonusWageringBase = (typeof BONUS_WAGERING_BASES)[number];

export const BONUS_CLAIM_METHODS = ['auto', 'live_support', 'code'] as const;
export type BonusClaimMethod = (typeof BONUS_CLAIM_METHODS)[number];

/** A promotion code's shape. */
export const BONUS_PROMO_CODE_PATTERN = /^[A-Za-z0-9_-]{1,40}$/;

/** How much a game category's stakes count towards wagering, in percent. */
export interface BonusContribution {
  category: string;
  percent: number;
}

export interface BonusFields {
  name: string;
  aliases: string[];
  type: BonusType;
  min_deposit: number | null;
  /** Null: no wagering. */
  wagering_multiplier: number | null;
  /** With a multiplier, and only then. */
  wagering_base: BonusWageringBase | null;
  contributing: BonusContribution[];
  min_odds: number | null;
  max_bet: number | null;
  max_cashout: number | null;
  validity_days: number | null;
  claim_method: BonusClaimMethod;
  /** Required when `claim_method` is `code`. */
  promo_code: string | null;
  /** Payment methods (`kb_payment_methods.id`) whose deposits do not qualify. */
  excluded_method_ids: string[];
  /** ISO 8601. */
  active_from: string | null;
  active_to: string | null;
  terms_text: string | null;
}

// ===========================================================================
// KYC documents
// ===========================================================================

export interface KycDocumentFields {
  /** The document's name ("Kimlik kartı"). */
  doc_type: string;
  acceptance_criteria: string[];
  when_required: string | null;
  review_hours: number | null;
  upload_path_text: string | null;
  chat_upload_allowed: boolean;
}

// ===========================================================================
// Limits and rules
// ===========================================================================

export const KB_RULE_CATEGORIES = ['limits', 'account', 'betting', 'withdrawal', 'other'] as const;
export type KbRuleCategory = (typeof KB_RULE_CATEGORIES)[number];

/** A rule's key: lower snake_case (`daily_withdrawal_limit`). */
export const KB_RULE_KEY_PATTERN = /^[a-z][a-z0-9_]{0,62}$/;

/** A rule says something: text, a number, or both. */
export interface KbRuleFields {
  key: string;
  category: KbRuleCategory;
  title: string;
  value_text: string | null;
  numeric_value: number | null;
  unit: string | null;
  description: string | null;
}

// ===========================================================================
// Rows
// ===========================================================================

/** What every row carries besides its fields. */
export interface KnowledgeTableRowMeta {
  id: string;
  /** Empty: every brand. */
  brand_ids: string[];
  owner_id: string | null;
  /** ISO 8601. */
  reviewed_at: string;
  review_interval_days: number;
  source: KnowledgeTableRowSource;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export type KbPaymentMethodRow = KnowledgeTableRowMeta & PaymentMethodFields;
export type KbBonusRow = KnowledgeTableRowMeta & BonusFields;
export type KbKycDocumentRow = KnowledgeTableRowMeta & KycDocumentFields;
export type KbRuleRow = KnowledgeTableRowMeta & KbRuleFields;

/** Each table's row. */
export interface KnowledgeTableRows {
  payment_methods: KbPaymentMethodRow;
  bonuses: KbBonusRow;
  kyc_documents: KbKycDocumentRow;
  rules: KbRuleRow;
}

/** Each table's writable fields. */
export interface KnowledgeTableFields {
  payment_methods: PaymentMethodFields;
  bonuses: BonusFields;
  kyc_documents: KycDocumentFields;
  rules: KbRuleFields;
}

// ===========================================================================
// Validation
// ===========================================================================

/**
 * Why a field was refused.
 *
 * - `required` — missing or blank; `invalid` — the wrong type, shape or
 *   spelling; `too_long` / `too_many` — past a limit; `out_of_range` — a
 *   number outside its bounds or with too many decimals; `repeated` — said
 *   twice in one row.
 * - `min_above_max`, `delay_below_expected` (AI-13 §6), `window_overlap`,
 *   `wagering_base_required`, `promo_code_required`, `active_to_before_from`,
 *   `value_required` (a rule with neither text nor number).
 * - `taken` — another row of an overlapping brand scope already uses the name
 *   ({@link findKnowledgeTableConflicts}).
 */
export const KNOWLEDGE_TABLE_PROBLEM_CODES = [
  'required',
  'invalid',
  'too_long',
  'too_many',
  'out_of_range',
  'repeated',
  'min_above_max',
  'delay_below_expected',
  'window_overlap',
  'wagering_base_required',
  'promo_code_required',
  'active_to_before_from',
  'value_required',
  'taken',
] as const;
export type KnowledgeTableProblemCode = (typeof KNOWLEDGE_TABLE_PROBLEM_CODES)[number];

/** One refused field; `field` is a path (`aliases[2]`, `working_hours.windows[0].end`). */
export interface KnowledgeTableProblem {
  field: string;
  code: KnowledgeTableProblemCode;
}

type Fields = Readonly<Record<string, unknown>>;
type Report = (field: string, code: KnowledgeTableProblemCode) => void;

function isRecord(value: unknown): value is Fields {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function given(value: unknown): boolean {
  return (
    value !== undefined && value !== null && !(typeof value === 'string' && value.trim() === '')
  );
}

/** A text field: required or not, at most `max` characters. */
function checkText(
  report: Report,
  field: string,
  value: unknown,
  max: number,
  required: boolean,
): void {
  if (!given(value)) {
    if (required) report(field, 'required');
    return;
  }
  if (typeof value !== 'string') report(field, 'invalid');
  else if (value.length > max) report(field, 'too_long');
}

interface NumberRule {
  min: number;
  max: number;
  integer?: boolean;
  /** Most decimals allowed; 2 by default. */
  decimals?: number;
  /** `min` itself not allowed. */
  exclusiveMin?: boolean;
}

function checkNumber(report: Report, field: string, value: unknown, rule: NumberRule): void {
  if (value === undefined || value === null) return;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    report(field, 'invalid');
    return;
  }
  const scale = 10 ** (rule.integer ? 0 : (rule.decimals ?? 2));
  const scaled = value * scale;
  if (
    value < rule.min ||
    value > rule.max ||
    (rule.exclusiveMin === true && value === rule.min) ||
    Math.abs(scaled - Math.round(scaled)) > 1e-6
  ) {
    report(field, 'out_of_range');
  }
}

function checkBoolean(report: Report, field: string, value: unknown): void {
  if (value !== undefined && typeof value !== 'boolean') report(field, 'invalid');
}

function checkEnum(
  report: Report,
  field: string,
  value: unknown,
  list: readonly string[],
  required: boolean,
): void {
  if (value === undefined || value === null) {
    if (required) report(field, 'required');
    return;
  }
  if (typeof value !== 'string' || !list.includes(value)) report(field, 'invalid');
}

/** A list field; returns its items when it is one, null otherwise (reported). */
function checkList(report: Report, field: string, value: unknown, max: number): unknown[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    report(field, 'invalid');
    return null;
  }
  if (value.length > max) report(field, 'too_many');
  return value;
}

/** An ISO 8601 moment with its offset (`2026-10-21T09:00:00Z`). */
const ISO_MOMENT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:\d{2})$/;

function moment(report: Report, field: string, value: unknown): number | null {
  if (value === undefined || value === null) return null;
  const at = typeof value === 'string' && ISO_MOMENT.test(value) ? Date.parse(value) : Number.NaN;
  if (Number.isNaN(at)) {
    report(field, 'invalid');
    return null;
  }
  return at;
}

/**
 * A name as uniqueness compares it: trimmed, inner spaces collapsed, lowered
 * the Turkish way (`PAPARA`, ` papara ` and `Papara` are one name; `IBAN` is
 * `ıban`).
 */
export function normalizeKnowledgeTableName(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('tr-TR');
}

/** A row's names and aliases: each a text, none repeating another or the name. */
function checkNameAndAliases(report: Report, row: Fields): void {
  checkText(report, 'name', row['name'], KNOWLEDGE_TABLE_LIMITS.nameMax, true);
  const aliases = checkList(report, 'aliases', row['aliases'], KNOWLEDGE_TABLE_LIMITS.aliasesMax);
  if (aliases === null) return;
  const seen = new Set<string>();
  if (typeof row['name'] === 'string') seen.add(normalizeKnowledgeTableName(row['name']));
  aliases.forEach((alias, i) => {
    const field = `aliases[${i}]`;
    if (typeof alias !== 'string') return report(field, 'invalid');
    if (alias.trim() === '') return report(field, 'required');
    if (alias.length > KNOWLEDGE_TABLE_LIMITS.aliasMax) return report(field, 'too_long');
    const key = normalizeKnowledgeTableName(alias);
    if (seen.has(key)) return report(field, 'repeated');
    seen.add(key);
  });
}

/** The fields every row carries: brands, owner, review interval, source. */
function checkMeta(report: Report, row: Fields): void {
  const brands = checkList(report, 'brand_ids', row['brand_ids'], KNOWLEDGE_SCOPE_IDS_MAX);
  if (brands !== null) {
    const seen = new Set<string>();
    brands.forEach((id, i) => {
      if (!isUuid(id)) return report(`brand_ids[${i}]`, 'invalid');
      if (seen.has(id.toLowerCase())) return report(`brand_ids[${i}]`, 'repeated');
      seen.add(id.toLowerCase());
    });
  }
  if (row['owner_id'] !== undefined && row['owner_id'] !== null && !isUuid(row['owner_id'])) {
    report('owner_id', 'invalid');
  }
  checkNumber(report, 'review_interval_days', row['review_interval_days'], {
    min: KNOWLEDGE_REVIEW_INTERVAL_DAYS.min,
    max: KNOWLEDGE_REVIEW_INTERVAL_DAYS.max,
    integer: true,
  });
  checkEnum(report, 'source', row['source'], KNOWLEDGE_TABLE_ROW_SOURCES, false);
}

function checkAmount(report: Report, field: string, value: unknown, positive = false): void {
  checkNumber(report, field, value, {
    min: 0,
    max: KNOWLEDGE_TABLE_LIMITS.amountMax,
    exclusiveMin: positive,
  });
}

function minutesOf(time: string): number {
  return Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
}

/** The problems in a method's working hours; none for null (around the clock). */
export function validatePaymentWorkingHours(
  value: unknown,
  field = 'working_hours',
): KnowledgeTableProblem[] {
  const problems: KnowledgeTableProblem[] = [];
  const report: Report = (f, code) => void problems.push({ field: f, code });
  if (value === undefined || value === null) return problems;
  if (!isRecord(value)) {
    report(field, 'invalid');
    return problems;
  }
  if (!given(value['timezone'])) report(`${field}.timezone`, 'required');
  else if (!isIanaTimeZone(value['timezone'])) report(`${field}.timezone`, 'invalid');
  checkBoolean(report, `${field}.closed_on_bank_holidays`, value['closed_on_bank_holidays']);
  const windows = value['windows'];
  if (!Array.isArray(windows) || windows.length === 0) {
    report(
      `${field}.windows`,
      Array.isArray(windows) || windows === undefined ? 'required' : 'invalid',
    );
    return problems;
  }
  if (windows.length > PAYMENT_WORKING_WINDOWS_MAX) report(`${field}.windows`, 'too_many');
  const byDay = new Map<string, Array<{ start: number; end: number; i: number }>>();
  windows.forEach((window: unknown, i) => {
    const at = `${field}.windows[${i}]`;
    if (!isRecord(window)) return report(at, 'invalid');
    const day = window['day'];
    const start = window['start'];
    const end = window['end'];
    let ok = true;
    if (typeof day !== 'string' || !(WORK_SCHEDULE_DAYS as readonly string[]).includes(day)) {
      report(`${at}.day`, 'invalid');
      ok = false;
    }
    if (typeof start !== 'string' || !WORK_SCHEDULE_TIME_PATTERN.test(start)) {
      report(`${at}.start`, 'invalid');
      ok = false;
    }
    if (typeof end !== 'string' || !PAYMENT_WINDOW_END_PATTERN.test(end)) {
      report(`${at}.end`, 'invalid');
      ok = false;
    }
    if (!ok) return;
    const span = { start: minutesOf(start as string), end: minutesOf(end as string), i };
    if (span.start >= span.end) return report(`${at}.end`, 'out_of_range');
    const list = byDay.get(day as string) ?? [];
    list.push(span);
    byDay.set(day as string, list);
  });
  for (const list of byDay.values()) {
    list.sort((a, b) => a.start - b.start);
    for (let k = 1; k < list.length; k++) {
      if (list[k]!.start < list[k - 1]!.end)
        report(`${field}.windows[${list[k]!.i}]`, 'window_overlap');
    }
  }
  return problems;
}

/** Every problem in a payment method's fields (and its meta fields). */
export function validatePaymentMethod(input: unknown): KnowledgeTableProblem[] {
  const problems: KnowledgeTableProblem[] = [];
  const report: Report = (field, code) => void problems.push({ field, code });
  if (!isRecord(input)) return [{ field: '', code: 'invalid' }];
  const row = input;
  const L = KNOWLEDGE_TABLE_LIMITS;
  checkMeta(report, row);
  checkNameAndAliases(report, row);
  checkEnum(report, 'direction', row['direction'], PAYMENT_DIRECTIONS, true);
  if (
    row['currency'] !== undefined &&
    (typeof row['currency'] !== 'string' || !/^[A-Z]{3}$/.test(row['currency']))
  ) {
    report('currency', 'invalid');
  }
  checkAmount(report, 'min_amount', row['min_amount']);
  checkAmount(report, 'max_amount', row['max_amount']);
  if (
    typeof row['min_amount'] === 'number' &&
    typeof row['max_amount'] === 'number' &&
    row['min_amount'] > row['max_amount']
  ) {
    report('min_amount', 'min_above_max');
  }
  const minutes: NumberRule = { min: 0, max: L.minutesMax, integer: true };
  checkNumber(report, 'expected_minutes', row['expected_minutes'], minutes);
  checkNumber(report, 'delay_threshold_minutes', row['delay_threshold_minutes'], minutes);
  if (
    typeof row['expected_minutes'] === 'number' &&
    typeof row['delay_threshold_minutes'] === 'number' &&
    row['delay_threshold_minutes'] < row['expected_minutes']
  ) {
    report('delay_threshold_minutes', 'delay_below_expected');
  }
  problems.push(...validatePaymentWorkingHours(row['working_hours']));
  for (const flag of [
    'requires_site_request',
    'receipt_required',
    'third_party_allowed',
    'active',
  ]) {
    checkBoolean(report, flag, row[flag]);
  }
  checkText(report, 'reference_instructions', row['reference_instructions'], L.shortTextMax, false);
  checkEnum(report, 'reference_format', row['reference_format'], PAYMENT_REFERENCE_FORMATS, false);
  const networks = checkList(report, 'networks', row['networks'], L.networksMax);
  const seenNetworks = new Set<string>();
  networks?.forEach((network, i) => {
    if (typeof network !== 'string' || !PAYMENT_NETWORK_PATTERN.test(network)) {
      return report(`networks[${i}]`, 'invalid');
    }
    if (seenNetworks.has(network.toUpperCase())) return report(`networks[${i}]`, 'repeated');
    seenNetworks.add(network.toUpperCase());
  });
  const errors = checkList(report, 'common_errors', row['common_errors'], L.commonErrorsMax);
  const seenCodes = new Set<string>();
  errors?.forEach((error, i) => {
    const at = `common_errors[${i}]`;
    if (!isRecord(error)) return report(at, 'invalid');
    const code = error['code'];
    if (!given(code)) report(`${at}.code`, 'required');
    else if (typeof code !== 'string' || !PAYMENT_ERROR_CODE_PATTERN.test(code))
      report(`${at}.code`, 'invalid');
    else if (seenCodes.has(code.toLowerCase())) report(`${at}.code`, 'repeated');
    else seenCodes.add(code.toLowerCase());
    checkText(report, `${at}.title`, error['title'], L.commonErrorTitleMax, true);
    checkText(report, `${at}.customer_text`, error['customer_text'], L.shortTextMax, true);
    checkText(report, `${at}.agent_hint`, error['agent_hint'], L.shortTextMax, false);
  });
  checkText(report, 'customer_notes', row['customer_notes'], L.longTextMax, false);
  return problems;
}

/** Every problem in a bonus's fields (and its meta fields). */
export function validateBonus(input: unknown): KnowledgeTableProblem[] {
  const problems: KnowledgeTableProblem[] = [];
  const report: Report = (field, code) => void problems.push({ field, code });
  if (!isRecord(input)) return [{ field: '', code: 'invalid' }];
  const row = input;
  const L = KNOWLEDGE_TABLE_LIMITS;
  checkMeta(report, row);
  checkNameAndAliases(report, row);
  checkEnum(report, 'type', row['type'], BONUS_TYPES, false);
  checkAmount(report, 'min_deposit', row['min_deposit']);
  checkNumber(report, 'wagering_multiplier', row['wagering_multiplier'], {
    min: 0,
    max: L.wageringMultiplierMax,
    exclusiveMin: true,
  });
  checkEnum(report, 'wagering_base', row['wagering_base'], BONUS_WAGERING_BASES, false);
  const hasMultiplier =
    row['wagering_multiplier'] !== undefined && row['wagering_multiplier'] !== null;
  const hasBase = row['wagering_base'] !== undefined && row['wagering_base'] !== null;
  if (hasMultiplier && !hasBase) report('wagering_base', 'wagering_base_required');
  if (hasBase && !hasMultiplier) report('wagering_multiplier', 'required');
  const contributing = checkList(report, 'contributing', row['contributing'], L.contributingMax);
  const seenCategories = new Set<string>();
  contributing?.forEach((entry, i) => {
    const at = `contributing[${i}]`;
    if (!isRecord(entry)) return report(at, 'invalid');
    const category = entry['category'];
    checkText(report, `${at}.category`, category, L.contributionCategoryMax, true);
    if (typeof category === 'string' && category.trim() !== '') {
      const key = normalizeKnowledgeTableName(category);
      if (seenCategories.has(key)) report(`${at}.category`, 'repeated');
      seenCategories.add(key);
    }
    if (entry['percent'] === undefined || entry['percent'] === null)
      report(`${at}.percent`, 'required');
    else
      checkNumber(report, `${at}.percent`, entry['percent'], { min: 0, max: 100, integer: true });
  });
  checkNumber(report, 'min_odds', row['min_odds'], { min: 1, max: 1000 });
  checkAmount(report, 'max_bet', row['max_bet'], true);
  checkAmount(report, 'max_cashout', row['max_cashout'], true);
  checkNumber(report, 'validity_days', row['validity_days'], {
    min: 1,
    max: L.validityDaysMax,
    integer: true,
  });
  checkEnum(report, 'claim_method', row['claim_method'], BONUS_CLAIM_METHODS, false);
  const promo = row['promo_code'];
  if (given(promo) && (typeof promo !== 'string' || !BONUS_PROMO_CODE_PATTERN.test(promo))) {
    report('promo_code', 'invalid');
  }
  if (row['claim_method'] === 'code' && !given(promo)) report('promo_code', 'promo_code_required');
  const excluded = checkList(
    report,
    'excluded_method_ids',
    row['excluded_method_ids'],
    L.excludedMethodsMax,
  );
  const seenMethods = new Set<string>();
  excluded?.forEach((id, i) => {
    if (!isUuid(id)) return report(`excluded_method_ids[${i}]`, 'invalid');
    if (seenMethods.has(id.toLowerCase())) return report(`excluded_method_ids[${i}]`, 'repeated');
    seenMethods.add(id.toLowerCase());
  });
  const from = moment(report, 'active_from', row['active_from']);
  const to = moment(report, 'active_to', row['active_to']);
  if (from !== null && to !== null && to < from) report('active_to', 'active_to_before_from');
  checkText(report, 'terms_text', row['terms_text'], L.termsTextMax, false);
  return problems;
}

/** Every problem in a KYC document's fields (and its meta fields). */
export function validateKycDocument(input: unknown): KnowledgeTableProblem[] {
  const problems: KnowledgeTableProblem[] = [];
  const report: Report = (field, code) => void problems.push({ field, code });
  if (!isRecord(input)) return [{ field: '', code: 'invalid' }];
  const row = input;
  const L = KNOWLEDGE_TABLE_LIMITS;
  checkMeta(report, row);
  checkText(report, 'doc_type', row['doc_type'], L.nameMax, true);
  const criteria = checkList(
    report,
    'acceptance_criteria',
    row['acceptance_criteria'],
    L.acceptanceCriteriaMax,
  );
  criteria?.forEach((criterion, i) => {
    checkText(report, `acceptance_criteria[${i}]`, criterion, L.acceptanceCriterionMax, true);
  });
  checkText(report, 'when_required', row['when_required'], L.shortTextMax, false);
  checkNumber(report, 'review_hours', row['review_hours'], {
    min: 0,
    max: L.reviewHoursMax,
    integer: true,
  });
  checkText(report, 'upload_path_text', row['upload_path_text'], L.shortTextMax, false);
  checkBoolean(report, 'chat_upload_allowed', row['chat_upload_allowed']);
  return problems;
}

/** Every problem in a rule's fields (and its meta fields). */
export function validateKbRule(input: unknown): KnowledgeTableProblem[] {
  const problems: KnowledgeTableProblem[] = [];
  const report: Report = (field, code) => void problems.push({ field, code });
  if (!isRecord(input)) return [{ field: '', code: 'invalid' }];
  const row = input;
  const L = KNOWLEDGE_TABLE_LIMITS;
  checkMeta(report, row);
  const key = row['key'];
  if (!given(key)) report('key', 'required');
  else if (typeof key !== 'string' || !KB_RULE_KEY_PATTERN.test(key)) report('key', 'invalid');
  checkEnum(report, 'category', row['category'], KB_RULE_CATEGORIES, false);
  checkText(report, 'title', row['title'], L.ruleTitleMax, true);
  checkText(report, 'value_text', row['value_text'], L.longTextMax, false);
  checkNumber(report, 'numeric_value', row['numeric_value'], {
    min: -L.amountMax,
    max: L.amountMax,
    decimals: 4,
  });
  if (
    !given(row['value_text']) &&
    (row['numeric_value'] === undefined || row['numeric_value'] === null)
  ) {
    report('value_text', 'value_required');
  }
  checkText(report, 'unit', row['unit'], L.unitMax, false);
  checkText(report, 'description', row['description'], L.longTextMax, false);
  return problems;
}

/** Every problem in a row of `table`. */
export function validateKnowledgeTableRow(
  table: KnowledgeTable,
  input: unknown,
): KnowledgeTableProblem[] {
  switch (table) {
    case 'payment_methods':
      return validatePaymentMethod(input);
    case 'bonuses':
      return validateBonus(input);
    case 'kyc_documents':
      return validateKycDocument(input);
    case 'rules':
      return validateKbRule(input);
  }
}

// ===========================================================================
// Names across rows, and brands
// ===========================================================================

/** What uniqueness and brand priority compare: a row's identity, as far as it has one. */
export interface KnowledgeTableIdentity {
  id?: string;
  brand_ids: readonly string[];
  name?: string;
  aliases?: readonly string[];
  direction?: string;
  doc_type?: string;
  key?: string;
}

/** The field and normalised term of each name a row answers to. */
function namesOf(
  table: KnowledgeTable,
  row: KnowledgeTableIdentity,
): Array<{ field: string; term: string }> {
  if (table === 'kyc_documents') {
    return typeof row.doc_type === 'string'
      ? [{ field: 'doc_type', term: normalizeKnowledgeTableName(row.doc_type) }]
      : [];
  }
  if (table === 'rules')
    return typeof row.key === 'string' ? [{ field: 'key', term: row.key }] : [];
  const names =
    typeof row.name === 'string'
      ? [{ field: 'name', term: normalizeKnowledgeTableName(row.name) }]
      : [];
  (row.aliases ?? []).forEach((alias, i) => {
    if (typeof alias === 'string')
      names.push({ field: `aliases[${i}]`, term: normalizeKnowledgeTableName(alias) });
  });
  return names;
}

/**
 * Whether two rows' brand scopes clash: both for every brand, or both for
 * brands they share. A brand's row beside an every-brand row does not clash —
 * it overrides it ({@link preferBrandRows}).
 */
export function knowledgeTableBrandScopesClash(
  a: readonly string[],
  b: readonly string[],
): boolean {
  if (a.length === 0 || b.length === 0) return a.length === 0 && b.length === 0;
  return a.some((id) => b.includes(id));
}

/**
 * The names of `row` another row already uses (`taken`) — within the same
 * direction for payment methods, in a clashing brand scope
 * ({@link knowledgeTableBrandScopesClash}). `others` may include `row` itself
 * (matched by id) — it is skipped.
 */
export function findKnowledgeTableConflicts(
  table: KnowledgeTable,
  row: KnowledgeTableIdentity,
  others: readonly KnowledgeTableIdentity[],
): KnowledgeTableProblem[] {
  const taken = new Set<string>();
  for (const other of others) {
    if (row.id !== undefined && other.id === row.id) continue;
    if (table === 'payment_methods' && other.direction !== row.direction) continue;
    if (!knowledgeTableBrandScopesClash(row.brand_ids, other.brand_ids)) continue;
    for (const { term } of namesOf(table, other)) taken.add(term);
  }
  return namesOf(table, row)
    .filter(({ term }) => taken.has(term))
    .map(({ field }) => ({ field, code: 'taken' as const }));
}

/**
 * Whether a row of `brandIds` serves a conversation of `brandId` — the
 * knowledge store's rule (`knowledgeSourceServes`): an every-brand row serves
 * all, a brand's row its brands only, and a conversation whose brand is not
 * known (null) the every-brand rows only.
 */
export function knowledgeTableRowServesBrand(
  brandIds: readonly string[],
  brandId: string | null,
): boolean {
  if (brandIds.length === 0) return true;
  return brandId !== null && brandIds.includes(brandId);
}

/**
 * Brand priority (AI-13 §5): of rows that serve one brand, an every-brand row
 * gives way to a brand row with the same name (and direction, for payment
 * methods). Order is kept.
 */
export function preferBrandRows<T extends KnowledgeTableIdentity>(
  table: KnowledgeTable,
  rows: readonly T[],
): T[] {
  const primary = (row: T): string | null => {
    const first = namesOf(table, row)[0];
    if (first === undefined) return null;
    return table === 'payment_methods' ? `${row.direction ?? ''}:${first.term}` : first.term;
  };
  const branded = new Set<string>();
  for (const row of rows) {
    const key = primary(row);
    if (row.brand_ids.length > 0 && key !== null) branded.add(key);
  }
  return rows.filter((row) => {
    if (row.brand_ids.length > 0) return true;
    const key = primary(row);
    return key === null || !branded.has(key);
  });
}

// ===========================================================================
// Review
// ===========================================================================

/** What a review's due date is computed from. */
export interface KnowledgeTableReviewState {
  reviewed_at: Date | string;
  review_interval_days: number;
  /** A bonus's campaign end: due then too. */
  active_to?: Date | string | null;
}

/**
 * When a row falls due for review (AI-13-S2): `review_interval_days` after
 * `reviewed_at`, or a bonus's campaign end if that comes first.
 */
export function knowledgeTableRowReviewDueAt(
  table: KnowledgeTable,
  row: KnowledgeTableReviewState,
): Date {
  const due = knowledgeReviewDueAt(new Date(row.reviewed_at), row.review_interval_days);
  if (table !== 'bonuses' || row.active_to === undefined || row.active_to === null) return due;
  const end = new Date(row.active_to);
  return end.getTime() < due.getTime() ? end : due;
}

/** Whether a row is stale at `now` — warned about, still used. */
export function isKnowledgeTableRowStale(
  table: KnowledgeTable,
  row: KnowledgeTableReviewState,
  now: Date,
): boolean {
  return knowledgeTableRowReviewDueAt(table, row).getTime() < now.getTime();
}

// ===========================================================================
// Row text (Turkish)
// ===========================================================================

/** How `renderRowText` names what a row only points at. */
export interface RenderRowTextOptions {
  /** Payment method names by id — a bonus's excluded methods. */
  methodNames?: Readonly<Record<string, string>>;
  /** The zone a bonus's campaign dates are written in; `Europe/Istanbul` by default. */
  timeZone?: string;
}

const DAY_NAMES_TR: Readonly<Record<WorkScheduleDay, string>> = Object.freeze({
  monday: 'Pazartesi',
  tuesday: 'Salı',
  wednesday: 'Çarşamba',
  thursday: 'Perşembe',
  friday: 'Cuma',
  saturday: 'Cumartesi',
  sunday: 'Pazar',
});

const DIRECTION_TR: Readonly<Record<PaymentDirection, string>> = Object.freeze({
  deposit: 'yatırım',
  withdrawal: 'çekim',
});

const REFERENCE_FORMAT_TR: Readonly<Record<PaymentReferenceFormat, string>> = Object.freeze({
  none: 'gerekmez',
  username: 'kullanıcı adı',
  digits: 'yalnız rakam',
  alphanumeric: 'harf ve rakam',
  txid_trc20: 'TRC20 işlem numarası (64 karakter)',
  txid_evm: 'ERC20/BEP20 işlem numarası (0x ile başlar)',
  phone: 'telefon numarası',
  email: 'e-posta adresi',
});

const BONUS_TYPE_TR: Readonly<Record<BonusType, string>> = Object.freeze({
  welcome: 'hoş geldin bonusu',
  deposit: 'yatırım bonusu',
  reload: 'yeniden yükleme bonusu',
  cashback: 'kayıp iadesi (cashback)',
  free_spins: 'bedava dönüş',
  free_bet: 'bedava bahis',
  loss_bonus: 'kayıp bonusu',
  loyalty: 'sadakat bonusu',
  other: 'bonus',
});

const CLAIM_METHOD_TR: Readonly<Record<BonusClaimMethod, string>> = Object.freeze({
  auto: 'otomatik tanımlanır',
  live_support: 'canlı destekten talep edilir',
  code: 'promosyon koduyla alınır',
});

const RULE_CATEGORY_TR: Readonly<Record<KbRuleCategory, string>> = Object.freeze({
  limits: 'limitler',
  account: 'hesap',
  betting: 'bahis',
  withdrawal: 'çekim',
  other: 'genel',
});

/** A number the Turkish way: `50.000`, `1,5`. */
function formatNumberTr(value: number, maxDecimals = 2): string {
  return new Intl.NumberFormat('tr-TR', { maximumFractionDigits: maxDecimals }).format(value);
}

/** A duration in words: `hemen`, `45 dakika`, `1 saat 30 dakika`, `2 gün`. */
export function formatMinutesTr(minutes: number): string {
  if (minutes <= 0) return 'hemen';
  if (minutes % 1440 === 0) return `${minutes / 1440} gün`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest} dakika`;
  return rest === 0 ? `${hours} saat` : `${hours} saat ${rest} dakika`;
}

/** Working hours in words: `7/24`, or each open day's windows in week order. */
export function formatWorkingHoursTr(hours: PaymentWorkingHours | null): string {
  if (hours === null) return '7/24';
  const days = WORK_SCHEDULE_DAYS.filter((day) => hours.windows.some((w) => w.day === day));
  const allDay = (day: WorkScheduleDay) =>
    hours.windows.some((w) => w.day === day && w.start === '00:00' && w.end === '24:00');
  let text: string;
  if (days.length === 7 && WORK_SCHEDULE_DAYS.every(allDay)) {
    text = '7/24';
  } else {
    text = days
      .map((day) => {
        const spans = hours.windows
          .filter((w) => w.day === day)
          .sort((a, b) => a.start.localeCompare(b.start))
          .map((w) => `${w.start}–${w.end}`);
        return `${DAY_NAMES_TR[day]} ${spans.join(', ')}`;
      })
      .join('; ');
    if (days.length < 7) text += '; diğer günler kapalı';
  }
  text += ` (saat dilimi: ${hours.timezone})`;
  if (hours.closed_on_bank_holidays) text += '; banka tatillerinde işlem yapılmaz';
  return text;
}

function present(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

function money(value: number, currency: string): string {
  return `${formatNumberTr(value)} ${currency}`;
}

function renderPaymentMethod(row: PaymentMethodFields): string[] {
  const lines = [`Ödeme yöntemi: ${row.name} (${DIRECTION_TR[row.direction]}).`];
  if (row.aliases.length > 0) lines.push(`Diğer adları: ${row.aliases.join(', ')}.`);
  if (!row.active) lines.push('Bu yöntem şu an kullanılamıyor.');
  lines.push(`Para birimi: ${row.currency}.`);
  if (row.min_amount !== null) lines.push(`En az tutar: ${money(row.min_amount, row.currency)}.`);
  if (row.max_amount !== null) lines.push(`En çok tutar: ${money(row.max_amount, row.currency)}.`);
  if (row.expected_minutes !== null) {
    lines.push(`Beklenen süre: ${formatMinutesTr(row.expected_minutes)}.`);
  }
  if (row.delay_threshold_minutes !== null) {
    lines.push(`${formatMinutesTr(row.delay_threshold_minutes)} geçerse gecikmiş sayılır.`);
  }
  lines.push(`Çalışma saatleri: ${formatWorkingHoursTr(row.working_hours)}.`);
  if (row.requires_site_request) lines.push('İşlem için sitede talep oluşturmak gerekir.');
  if (present(row.reference_instructions) || row.reference_format !== 'none') {
    const format =
      row.reference_format === 'none'
        ? ''
        : ` (biçim: ${REFERENCE_FORMAT_TR[row.reference_format]})`;
    const said = present(row.reference_instructions)
      ? row.reference_instructions.trim()
      : 'Açıklama alanı doldurulmalıdır.';
    lines.push(`Açıklama / referans: ${said}${format}`);
  }
  lines.push(row.receipt_required ? 'Dekont gerekir.' : 'Dekont gerekmez.');
  lines.push(
    row.third_party_allowed
      ? 'Başka birinin hesabından işlem kabul edilir.'
      : 'Başka birinin hesabından işlem kabul edilmez.',
  );
  if (row.networks.length > 0) lines.push(`Ağlar: ${row.networks.join(', ')}.`);
  for (const error of row.common_errors)
    lines.push(`Sık hata — ${error.title}: ${error.customer_text}`);
  if (present(row.customer_notes)) lines.push(`Not: ${row.customer_notes.trim()}`);
  return lines;
}

function renderBonus(row: BonusFields, options: RenderRowTextOptions): string[] {
  const lines = [`Bonus: ${row.name} (${BONUS_TYPE_TR[row.type]}).`];
  if (row.aliases.length > 0) lines.push(`Diğer adları: ${row.aliases.join(', ')}.`);
  if (row.min_deposit !== null) lines.push(`En az yatırım: ${formatNumberTr(row.min_deposit)}.`);
  if (row.wagering_multiplier !== null && row.wagering_base !== null) {
    const base =
      row.wagering_base === 'bonus' ? 'bonus tutarının' : 'bonus ve yatırım tutarının toplamının';
    lines.push(`Çevrim şartı: ${base} ${formatNumberTr(row.wagering_multiplier)} katı.`);
  } else {
    lines.push('Çevrim şartı yoktur.');
  }
  if (row.contributing.length > 0) {
    const parts = row.contributing.map((c) => `${c.category} %${c.percent}`);
    lines.push(`Çevrime katkı: ${parts.join(', ')}.`);
  }
  if (row.min_odds !== null) lines.push(`En düşük oran: ${formatNumberTr(row.min_odds)}.`);
  if (row.max_bet !== null) lines.push(`En yüksek bahis: ${formatNumberTr(row.max_bet)}.`);
  if (row.max_cashout !== null) lines.push(`En çok çekim: ${formatNumberTr(row.max_cashout)}.`);
  if (row.validity_days !== null) lines.push(`Geçerlilik süresi: ${row.validity_days} gün.`);
  lines.push(
    row.claim_method === 'code' && present(row.promo_code)
      ? `Nasıl alınır: ${CLAIM_METHOD_TR.code} (${row.promo_code}).`
      : `Nasıl alınır: ${CLAIM_METHOD_TR[row.claim_method]}.`,
  );
  if (row.excluded_method_ids.length > 0) {
    const names = row.excluded_method_ids
      .map((id) => options.methodNames?.[id])
      .filter((name): name is string => present(name));
    lines.push(
      names.length > 0
        ? `Şu ödeme yöntemleriyle yapılan yatırımlarda geçerli değildir: ${names.join(', ')}.`
        : 'Bazı ödeme yöntemleriyle yapılan yatırımlarda geçerli değildir.',
    );
  }
  if (row.active_from !== null || row.active_to !== null) {
    const date = new Intl.DateTimeFormat('tr-TR', {
      dateStyle: 'long',
      timeZone: options.timeZone ?? 'Europe/Istanbul',
    });
    const from = row.active_from === null ? null : date.format(new Date(row.active_from));
    const to = row.active_to === null ? null : date.format(new Date(row.active_to));
    if (from !== null && to !== null) lines.push(`Kampanya dönemi: ${from} – ${to}.`);
    else if (from !== null) lines.push(`Kampanya başlangıcı: ${from}.`);
    else lines.push(`Kampanya bitişi: ${to}.`);
  }
  if (present(row.terms_text)) lines.push(`Şartlar: ${row.terms_text.trim()}`);
  return lines;
}

function renderKycDocument(row: KycDocumentFields): string[] {
  const lines = [`KYC belgesi: ${row.doc_type}.`];
  const criteria = row.acceptance_criteria.filter(present);
  if (criteria.length > 0) lines.push(`Kabul koşulları: ${criteria.join('; ')}.`);
  if (present(row.when_required)) lines.push(`Ne zaman istenir: ${row.when_required.trim()}`);
  if (row.review_hours !== null)
    lines.push(`İnceleme süresi: ${formatMinutesTr(row.review_hours * 60)}.`);
  if (present(row.upload_path_text)) lines.push(`Nasıl yüklenir: ${row.upload_path_text.trim()}`);
  lines.push(row.chat_upload_allowed ? 'Sohbetten de yüklenebilir.' : 'Sohbetten yüklenmez.');
  return lines;
}

function renderKbRule(row: KbRuleFields): string[] {
  const lines = [`Kural (${RULE_CATEGORY_TR[row.category]}): ${row.title}.`];
  const parts: string[] = [];
  if (row.numeric_value !== null) {
    parts.push(
      present(row.unit)
        ? `${formatNumberTr(row.numeric_value, 4)} ${row.unit.trim()}`
        : formatNumberTr(row.numeric_value, 4),
    );
  }
  if (present(row.value_text)) parts.push(row.value_text.trim());
  if (parts.length > 0) lines.push(`Değer: ${parts.join(' — ')}`);
  if (present(row.description)) lines.push(`Açıklama: ${row.description.trim()}`);
  return lines;
}

/**
 * A row as Turkish text — what its knowledge source holds, so retrieval finds
 * it (tm 310.2), and what an answer quotes. One statement per line; the
 * values exactly as stored; nothing that is for agents only (a usual error's
 * `agent_hint`). Brands are not written: the brand filter is the reader's.
 */
export function renderRowText<T extends KnowledgeTable>(
  table: T,
  row: KnowledgeTableFields[T],
  options: RenderRowTextOptions = {},
): string {
  let lines: string[];
  switch (table) {
    case 'payment_methods':
      lines = renderPaymentMethod(row as PaymentMethodFields);
      break;
    case 'bonuses':
      lines = renderBonus(row as BonusFields, options);
      break;
    case 'kyc_documents':
      lines = renderKycDocument(row as KycDocumentFields);
      break;
    default:
      lines = renderKbRule(row as KbRuleFields);
  }
  return lines.join('\n');
}

// ===========================================================================
// Access information (K13)
// ===========================================================================

/**
 * Where the access answer comes from (K13): `kb_row` — a knowledge source (a
 * table row's included); `dynamic_url` — a URL fetched when asked, cached
 * briefly, its last value used when a fetch fails and a hand-over when there
 * is none; `fixed_link` — one link, said as it is.
 */
export const AI_ACCESS_INFO_SOURCE_TYPES = ['kb_row', 'dynamic_url', 'fixed_link'] as const;
export type AiAccessInfoSourceType = (typeof AI_ACCESS_INFO_SOURCE_TYPES)[number];

/** How long a fetched value is reused, in seconds. */
export const AI_ACCESS_INFO_CACHE_SECONDS = Object.freeze({ default: 300, min: 30, max: 86_400 });

export const AI_ACCESS_INFO_LIMITS = Object.freeze({
  urlMax: 2048,
  fixedTextMax: 1000,
  /** A fetched value is cut to this many characters before it is kept. */
  lastValueMax: 2000,
});

/** The setting as the panel writes it. */
export interface AiAccessInfoFields {
  /** Null: every brand. */
  brand_id: string | null;
  source_type: AiAccessInfoSourceType;
  kb_source_id: string | null;
  url: string | null;
  cache_seconds: number;
  fixed_text: string | null;
}

export interface AiAccessInfoRow extends AiAccessInfoFields {
  id: string;
  last_value: string | null;
  last_fetched_at: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

/** An http(s) URL with a host, no spaces, at most `urlMax` characters. */
export function isAccessInfoUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > AI_ACCESS_INFO_LIMITS.urlMax) return false;
  if (!/^https?:\/\/\S+$/i.test(value)) return false;
  try {
    return new URL(value).hostname !== '';
  } catch {
    return false;
  }
}

/** Every problem in the access information setting. */
export function validateAiAccessInfo(input: unknown): KnowledgeTableProblem[] {
  const problems: KnowledgeTableProblem[] = [];
  const report: Report = (field, code) => void problems.push({ field, code });
  if (!isRecord(input)) return [{ field: '', code: 'invalid' }];
  const row = input;
  if (row['brand_id'] !== undefined && row['brand_id'] !== null && !isUuid(row['brand_id'])) {
    report('brand_id', 'invalid');
  }
  checkEnum(report, 'source_type', row['source_type'], AI_ACCESS_INFO_SOURCE_TYPES, true);
  const kbSource = row['kb_source_id'];
  if (kbSource !== undefined && kbSource !== null && !isUuid(kbSource))
    report('kb_source_id', 'invalid');
  else if (row['source_type'] === 'kb_row' && (kbSource === undefined || kbSource === null)) {
    report('kb_source_id', 'required');
  }
  const url = row['url'];
  if (given(url) && !isAccessInfoUrl(url)) report('url', 'invalid');
  else if (
    (row['source_type'] === 'dynamic_url' || row['source_type'] === 'fixed_link') &&
    !given(url)
  ) {
    report('url', 'required');
  }
  checkNumber(report, 'cache_seconds', row['cache_seconds'], {
    min: AI_ACCESS_INFO_CACHE_SECONDS.min,
    max: AI_ACCESS_INFO_CACHE_SECONDS.max,
    integer: true,
  });
  checkText(report, 'fixed_text', row['fixed_text'], AI_ACCESS_INFO_LIMITS.fixedTextMax, false);
  return problems;
}
