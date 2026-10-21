/**
 * The structured tables' facts (tm 310.3 · SiyahTuş analysis AI-13 §1, §2, §4;
 * AI-03 §1 `fact` / `fn`; AI-06 §3).
 *
 * "Param yatmadı" turns on one comparison — the transaction's time against
 * the method's expected time — and a free-text article cannot make it. The
 * AI-13 tables can, and this module is where the AI reads them:
 *
 *   - **One brand's view, read once** (`readFactTables`): the four tables as
 *     the conversation's brand sees them (`readKnowledgeTableRows`), a brand's
 *     own row over the every-brand row of the same name (`preferBrandRows`,
 *     AI-13 §5) — an inactive brand row too, so a brand can switch a method
 *     off — and only the bonuses whose campaign is running. A stale row is
 *     still read: AI-13-S2 warns about it in the panel, the AI goes on using it.
 *   - **A procedure's facts** (`procedureFactsOf`): the slot whose
 *     `enum_source` is a table names the row — `yontem` = "Papara" is the
 *     active deposit row called Papara — and `method.expected_minutes`,
 *     `within_working_hours(method, islem_zamani)` and `next_window(method)`
 *     read it. The options such a slot is filled from are the same rows
 *     (`tableSlotOptions`), so a value the slot takes always names a row.
 *   - **The working hours** (`withinWorkingHours`, `nextWorkingWindow`): the
 *     method's weekly windows on its own zone's wall clock, daylight saving
 *     included. No working hours on the row means around the clock. There is
 *     no bank-holiday calendar in the product, so `closed_on_bank_holidays` is
 *     said in the row's text and not computed (PLAN §D310).
 *   - **The exact answer** (`answerFromTables`, AI-06 §3): a question that
 *     names one row and one of its properties — "Papara ile en az ne kadar
 *     yatırabilirim?" — is answered from the row by a fixed sentence, the
 *     value exactly as stored; no passage, no model, nothing to invent. A
 *     question it cannot place on one row and a property it holds goes on to
 *     the knowledge search, where the same rows are passages (tm 310.2).
 *     Wagering is only ever a general example (multiplier × base, on the
 *     amount the player names); what is left on the player's own account is
 *     never said — the AI cannot see it (research §3 item 6).
 *
 * `is_delayed` and `amount_in_range` (AI-13 §1) are conditions in the
 * procedure language, not functions of their own: `elapsed_minutes(slot) gt
 * method.delay_threshold_minutes` and `tutar lt method.min_amount` — the
 * function list stays fixed (AI-03 risk note). `amountInRange` serves the
 * exact answer to "50 TL yatırabilir miyim?".
 *
 * Until tm 316 versions the configuration the tables are read live; afterwards
 * from the published package (ADR-14b §2.4) — only `readFactTables` changes.
 */
import {
  KNOWLEDGE_TABLE_SAMPLE_SOURCE,
  KNOWLEDGE_TABLES,
  PROCEDURE_FACT_ENTITIES,
  formatMinutesTr,
  formatWorkingHoursTr,
  normalizeKnowledgeTableName,
  preferBrandRows,
  type BonusFields,
  type CondScalar,
  type KbRuleFields,
  type KnowledgeTable,
  type KnowledgeTableFields,
  type KycDocumentFields,
  type PaymentDirection,
  type PaymentMethodFields,
  type PaymentWorkingHours,
  type PersonaLanguage,
  type ProcedureFactEntity,
  type ProcedureFactPath,
  type SlotDef,
  type SlotEnumSource,
} from '@siyahtus/types';
import type { TenantClient } from '../../../lib/tenant.js';
import { knowledgeTableFieldsOf } from '../../knowledge-tables/records.js';
import { readKnowledgeTableRows } from '../../knowledge-tables/rows.js';
import type { FactAnswer, KnowledgeFacts } from './knowledge-answer.js';
import { slotValue, zonedInstant, type ProcedureFacts } from './procedure/conditions.js';
import { foldTr, parseAmountTr } from './slots/normalize-tr.js';
import { matchEnumOption, type SlotEnumOption } from './slots/validators.js';
import type { AiStateObject } from './state-store.js';
import type { TenantRunner } from './turn.js';

// ---------------------------------------------------------------------------
// The tables, as one conversation reads them.
// ---------------------------------------------------------------------------

/** One row: its id (the decision record's), its brands, its fields. */
export interface FactRow<F> {
  id: string;
  brandIds: readonly string[];
  fields: F;
}

/** The four tables as one brand's conversation sees them. */
export interface FactTables {
  payment_methods: ReadonlyArray<FactRow<PaymentMethodFields>>;
  bonuses: ReadonlyArray<FactRow<BonusFields>>;
  kyc_documents: ReadonlyArray<FactRow<KycDocumentFields>>;
  rules: ReadonlyArray<FactRow<KbRuleFields>>;
}

export const NO_TABLE_ROWS: FactTables = Object.freeze({
  payment_methods: [],
  bonuses: [],
  kyc_documents: [],
  rules: [],
});

/** What reading the tables needs: where, for which brand, at which moment. */
export interface FactTableRead {
  db: TenantRunner;
  /** The conversation's brand; null — not known: the every-brand rows only. */
  brandId: string | null;
  now: Date;
}

/** Where a turn gets its tables. The engine asks once per turn. */
export interface FactTableReader {
  read(input: FactTableRead): Promise<FactTables>;
}

/** No tables: every fact is unknown, no slot has table options. */
export const NO_FACT_TABLE_READER: FactTableReader = Object.freeze({
  read: async () => NO_TABLE_ROWS,
});

type RowsByTable = { [T in KnowledgeTable]: Array<FactRow<KnowledgeTableFields[T]>> };

/**
 * The rows that serve one brand, as the AI uses them (see the file header):
 * brand priority first — an inactive brand row still shadows the every-brand
 * one — then only the bonuses whose campaign is running at `now`.
 */
export function factTablesOf(served: RowsByTable, now: Date): FactTables {
  const prefer = <T extends KnowledgeTable>(table: T): Array<FactRow<KnowledgeTableFields[T]>> =>
    preferBrandRows(
      table,
      served[table].map((row) => ({ ...row.fields, brand_ids: row.brandIds, row })),
    ).map((identity) => identity.row as FactRow<KnowledgeTableFields[T]>);
  const at = now.getTime();
  return {
    payment_methods: prefer('payment_methods'),
    bonuses: prefer('bonuses').filter(
      ({ fields }) =>
        (fields.active_from === null || new Date(fields.active_from).getTime() <= at) &&
        (fields.active_to === null || at <= new Date(fields.active_to).getTime()),
    ),
    kyc_documents: prefer('kyc_documents'),
    rules: prefer('rules'),
  };
}

/** The tables for a conversation of `brandId` (`readKnowledgeTableRows`), as the AI uses them. */
export async function readFactTables(
  tx: TenantClient,
  reader: { brandId: string | null; now: Date },
): Promise<FactTables> {
  const served = {} as RowsByTable;
  for (const table of KNOWLEDGE_TABLES) {
    const records = await readKnowledgeTableRows(tx, table, reader);
    // An "örnek — doğrulayın" row is not a fact until a person confirms it (AI-15-S1).
    (served as Record<KnowledgeTable, unknown[]>)[table] = records
      .filter((record) => record.source !== KNOWLEDGE_TABLE_SAMPLE_SOURCE)
      .map((record) => ({
        id: record.id,
        brandIds: record.brandIds,
        fields: knowledgeTableFieldsOf(table, record),
      }));
  }
  return factTablesOf(served, reader.now);
}

// ---------------------------------------------------------------------------
// Working hours.
// ---------------------------------------------------------------------------

const weekdayFormatters = new Map<string, Intl.DateTimeFormat>();

/** The weekday and the minute of the day on `timeZone`'s wall clock; null for a zone `Intl` does not know. */
function wallClock(
  at: Date,
  timeZone: string,
): { day: string; date: string; minute: number } | null {
  let formatter = weekdayFormatters.get(timeZone);
  try {
    if (formatter === undefined) {
      formatter = new Intl.DateTimeFormat('en-US', {
        timeZone,
        hourCycle: 'h23',
        weekday: 'long',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });
      weekdayFormatters.set(timeZone, formatter);
    }
    const parts: Record<string, string> = {};
    for (const part of formatter.formatToParts(at)) parts[part.type] = part.value;
    return {
      day: (parts['weekday'] ?? '').toLowerCase(),
      date: `${parts['year']}-${parts['month']}-${parts['day']}`,
      minute: Number(parts['hour']) * 60 + Number(parts['minute']),
    };
  } catch {
    return null;
  }
}

function minuteOf(time: string): number {
  return time === '24:00' ? 1440 : Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
}

/**
 * Whether a method with these working hours processes at `at`: inside one of
 * the day's windows (start included, end not) on the method's own wall clock.
 * No hours: around the clock. Null: the zone cannot be read.
 */
export function withinWorkingHours(hours: PaymentWorkingHours | null, at: Date): boolean | null {
  if (hours === null) return true;
  const clock = wallClock(at, hours.timezone);
  if (clock === null) return null;
  return hours.windows.some(
    (window) =>
      window.day === clock.day &&
      minuteOf(window.start) <= clock.minute &&
      clock.minute < minuteOf(window.end),
  );
}

const DAY_MS = 86_400_000;
const WEEKDAYS_FROM_SUNDAY = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
];

/**
 * The first moment at or after `after` the method processes: `after` itself
 * inside a window, else the next window's opening — on the method's wall
 * clock, so a window after a daylight-saving change opens at its local time.
 * No hours: `after`. Null: no window in the coming week, or the zone cannot be read.
 */
export function nextWorkingWindow(hours: PaymentWorkingHours | null, after: Date): Date | null {
  const within = withinWorkingHours(hours, after);
  if (within === null) return null;
  if (within || hours === null) return after;
  const clock = wallClock(after, hours.timezone);
  if (clock === null) return null;
  const today = Date.parse(`${clock.date}T00:00:00Z`);
  for (let offset = 0; offset <= 7; offset++) {
    const day = new Date(today + offset * DAY_MS);
    const weekday = WEEKDAYS_FROM_SUNDAY[day.getUTCDay()];
    const date = day.toISOString().slice(0, 10);
    const opens = hours.windows
      .filter((window) => window.day === weekday)
      .map((window) => zonedInstant(date, window.start, hours.timezone))
      .filter((moment): moment is Date => moment !== null && moment.getTime() > after.getTime())
      .sort((a, b) => a.getTime() - b.getTime());
    if (opens[0] !== undefined) return opens[0];
  }
  return null;
}

/** Whether an amount is within the method's limits; an unset limit does not bound. */
export function amountInRange(
  method: Pick<PaymentMethodFields, 'min_amount' | 'max_amount'>,
  amount: number,
): boolean {
  return (
    (method.min_amount === null || amount >= method.min_amount) &&
    (method.max_amount === null || amount <= method.max_amount)
  );
}

// ---------------------------------------------------------------------------
// A procedure's facts.
// ---------------------------------------------------------------------------

/** The rows an `enum_source` names — a payment method only while it is active. */
function sourceRows(
  tables: FactTables,
  source: SlotEnumSource,
): Array<{ id: string; name: string; aliases: readonly string[] }> {
  switch (source) {
    case 'payment_methods.deposit':
    case 'payment_methods.withdrawal': {
      const direction = source.slice('payment_methods.'.length) as PaymentDirection;
      return tables.payment_methods
        .filter(({ fields }) => fields.active && fields.direction === direction)
        .map(({ id, fields }) => ({ id, name: fields.name, aliases: fields.aliases }));
    }
    case 'bonuses':
      return tables.bonuses.map(({ id, fields }) => ({
        id,
        name: fields.name,
        aliases: fields.aliases,
      }));
    case 'kyc_documents':
      return tables.kyc_documents.map(({ id, fields }) => ({
        id,
        name: fields.doc_type,
        aliases: [],
      }));
  }
}

function tableSource(def: SlotDef): SlotEnumSource | null {
  return def.type === 'enum' ? (def.validate?.enum_source ?? null) : null;
}

/** Whether any of these slots takes its values from a table — the turn needs the tables. */
export function readsTables(defs: readonly SlotDef[]): boolean {
  return defs.some((def) => tableSource(def) !== null);
}

/**
 * The options of each table-sourced enum slot: its rows' names and aliases
 * (AI-04 §4 matches "paparayla", "PPR" against them). A slot whose table has
 * no row gets none — it cannot be filled, as before there were tables.
 */
export function tableSlotOptions(
  tables: FactTables,
  defs: readonly SlotDef[],
): Record<string, SlotEnumOption[]> {
  const options: Record<string, SlotEnumOption[]> = {};
  for (const def of defs) {
    const source = tableSource(def);
    if (source === null) continue;
    const rows = sourceRows(tables, source);
    if (rows.length === 0) continue;
    options[def.name] = rows.map((row) =>
      row.aliases.length > 0 ? { value: row.name, aliases: [...row.aliases] } : { value: row.name },
    );
  }
  return options;
}

/** The fields of the row the entity's slot names, or null — no such slot settled, or no such row. */
function entityRow(
  tables: FactTables,
  defs: readonly SlotDef[],
  entity: ProcedureFactEntity,
  slots: AiStateObject,
): { id: string; fields: Record<string, unknown> } | null {
  const sources = PROCEDURE_FACT_ENTITIES[entity] as readonly SlotEnumSource[];
  for (const def of defs) {
    const source = tableSource(def);
    if (source === null || !sources.includes(source)) continue;
    const value = slotValue(slots, def.name);
    if (!value.known || value.value.kind !== 'text') continue;
    const named = normalizeKnowledgeTableName(value.value.value);
    const row = sourceRows(tables, source).find(
      (candidate) =>
        normalizeKnowledgeTableName(candidate.name) === named ||
        candidate.aliases.some((alias) => normalizeKnowledgeTableName(alias) === named),
    );
    if (row === undefined) continue;
    const table: KnowledgeTable =
      entity === 'method' ? 'payment_methods' : entity === 'bonus' ? 'bonuses' : 'kyc_documents';
    const found = (tables[table] as ReadonlyArray<FactRow<object>>).find((r) => r.id === row.id);
    if (found) return { id: found.id, fields: found.fields as Record<string, unknown> };
  }
  return null;
}

/**
 * The facts a procedure with these slots reads (AI-03 `fact` / `fn`): each
 * answer looks up the row the entity's slot names at that moment.
 */
export function procedureFactsOf(tables: FactTables, defs: readonly SlotDef[]): ProcedureFacts {
  const methodHours = (slots: AiStateObject): { hours: PaymentWorkingHours | null } | null => {
    const row = entityRow(tables, defs, 'method', slots);
    return row
      ? { hours: (row.fields['working_hours'] as PaymentWorkingHours | null) ?? null }
      : null;
  };
  return {
    get(path: ProcedureFactPath, slots: AiStateObject): CondScalar | null {
      const dot = path.indexOf('.');
      const entity = path.slice(0, dot) as ProcedureFactEntity;
      const column = path.slice(dot + 1);
      const row = entityRow(tables, defs, entity, slots);
      if (row === null) return null;
      const value = row.fields[column];
      if (path === 'method.working_hours') {
        return formatWorkingHoursTr((value as PaymentWorkingHours | null) ?? null);
      }
      return typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string'
        ? value
        : null;
    },
    withinWorkingHours(at: Date, slots: AiStateObject): boolean | null {
      const method = methodHours(slots);
      return method === null ? null : withinWorkingHours(method.hours, at);
    },
    nextWindow(after: Date, slots: AiStateObject): Date | null {
      const method = methodHours(slots);
      return method === null ? null : nextWorkingWindow(method.hours, after);
    },
  };
}

// ---------------------------------------------------------------------------
// The exact answer (AI-06 §3).
// ---------------------------------------------------------------------------

/** The languages the sentences are written in; another answers from the knowledge base. */
type FactLanguage = 'tr' | 'en';

const MIN = /\b(en az|minimum|min|en dusuk|alt limit\w*|alt sinir\w*|at least|lowest|smallest)\b/;
const MAX =
  /\b(en fazla|en cok|en yuksek|maksimum|maximum|max|ust limit\w*|ust sinir\w*|at most|highest|largest|up to)\b/;
const LIMIT = /\b(limit\w*|sinir\w*)\b/;
const RANGE_ASK =
  /\b(yatirabilir\w*|cekebilir\w*|gonderebilir\w*|olur mu|mumkun mu|yeterli mi|can i (deposit|withdraw|send))\b/;
const EXPECTED =
  /\b(ne kadar (surede|zamanda|surer|sure|bekle\w*)|kac (dakika|dk|saat|gun)\w*|ne zaman (gecer|yansir|duser|gelir|ulasir|hesab\w*)|how long|how many (minutes|hours))\b/;
const HOURS =
  /\b(mesai\w*|calisma saat\w*|islem saat\w*|hangi saat\w*|saat kac\w*|kaca kadar|hafta ?sonu\w*|7 ?24|working hours|business hours|opening hours|what time|weekends?)\b/;
const RECEIPT = /\b(dekont\w*|receipts?)\b/;
const THIRD_PARTY =
  /\b(baskasi\w*|baska (birinin|birisinin|kisinin|kisi|hesap\w*|isim\w*)|ucuncu (sahis|kisi|taraf)\w*|third party|someone else\w*)\b/;
const SITE_REQUEST = /\b(talep\w*|requests?)\b/;
const DEPOSIT_WORD = /\b(yatir\w*|deposit\w*)\b/;
const WITHDRAWAL_WORD = /\b(cek|ceke\w*|cekim\w*|cekil\w*|cekme\w*|cekt\w*|withdraw\w*)\b/;
const WAGER = /\b(cevrim\w*|cevir\w*|wager\w*|rollover|playthrough)\b/;
const REMAINING = /\b(kalan|kaldi\w*|remaining|left)\b/;
const ODDS = /\b(oran\w*|odds)\b/;
const BET = /\b(bahis\w*|bets?|stakes?)\b/;
const CASHOUT = /\b(cekim\w*|cekebil\w*|kazanc\w*|cash ?out|withdraw\w*)\b/;
const VALIDITY =
  /\b(gecerli\w*|gecerlilik\w*|kac gun|suresi\w*|ne zamana kadar|valid\w*|expir\w*|how many days)\b/;
const CLAIM =
  /\b(nasil (alir\w*|alin\w*|talep\w*|kazan\w*|aktif\w*)|kod\w*|codes?|claim\w*|how (do|can) i get)\b/;
const REVIEW_TIME = /\b(ne kadar surede|kac (saat|gun)\w*|ne zaman|how long|when)\b/;
const REVIEW_WORD =
  /\b(onay\w*|incele\w*|sonuc\w*|kontrol\w*|dogrula\w*|approv\w*|review\w*|verif\w*)\b/;
const UPLOAD = /\b(yukle\w*|gonder\w*|ilet\w*|upload\w*|send\w*|submit\w*)\b/;
const CRITERIA = /\b(kabul\w*|sart\w*|kosul\w*|nasil olmali|accept\w*|requirement\w*)\b/;

/** The message as the patterns read it: folded, punctuation as spaces. */
function wordsOf(message: string): string {
  return foldTr(message)
    .replace(/[^a-z0-9%/]+/g, ' ')
    .trim();
}

function numberText(value: number, language: FactLanguage, maxDecimals = 2): string {
  return new Intl.NumberFormat(language === 'tr' ? 'tr-TR' : 'en-US', {
    maximumFractionDigits: maxDecimals,
  }).format(value);
}

function moneyText(value: number, currency: string, language: FactLanguage): string {
  return `${numberText(value, language)} ${currency}`;
}

function minutesText(minutes: number, language: FactLanguage): string {
  if (language === 'tr') return formatMinutesTr(minutes);
  if (minutes <= 0) return 'immediately';
  if (minutes % 1440 === 0) return plural(minutes / 1440, 'day');
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return plural(rest, 'minute');
  return rest === 0 ? plural(hours, 'hour') : `${plural(hours, 'hour')} ${plural(rest, 'minute')}`;
}

function plural(count: number, unit: string): string {
  return `${count} ${unit}${count === 1 ? '' : 's'}`;
}

/**
 * The one name the message gives among these rows' names and aliases —
 * matched like a slot's options (AI-04 §4: "paparayla", "PPR") — as its
 * normalised name; `several` when it names more than one, null when none.
 */
function namedKey<R>(
  words: string,
  rows: readonly R[],
  names: (row: R) => readonly string[],
): string | 'several' | null {
  const options = new Map<string, string[]>();
  for (const row of rows) {
    const [name, ...aliases] = names(row);
    if (name === undefined) continue;
    const key = normalizeKnowledgeTableName(name);
    options.set(key, [...(options.get(key) ?? []), name, ...aliases]);
  }
  const match = matchEnumOption(
    words,
    [...options].map(([value, aliases]) => ({ value, aliases })),
  );
  if (match.status === 'filled') return match.value;
  return match.status === 'invalid' && match.reason === 'ambiguous' ? 'several' : null;
}

/** The one row of that normalised name, or null. */
function rowNamed<R>(rows: readonly R[], name: (row: R) => string, key: string): R | null {
  const found = rows.filter((row) => normalizeKnowledgeTableName(name(row)) === key);
  return found.length === 1 ? (found[0] as R) : null;
}

/** A sentence, or null — the row does not hold what was asked. */
type Sentence = string | null;

/** The payment-method answer: every property asked, or null if one is not on the row. */
function methodAnswer(
  method: PaymentMethodFields,
  words: string,
  amount: number | null,
  language: FactLanguage,
): string | null {
  const tr = language === 'tr';
  const name = method.name;
  if (!method.active) {
    return tr ? `${name} şu an kullanılamıyor.` : `${name} is not available at the moment.`;
  }
  const deposit = method.direction === 'deposit';
  const verbTr = deposit ? 'yatırabilirsiniz' : 'çekebilirsiniz';
  const verbEn = deposit ? 'deposit' : 'withdraw';
  const money = (value: number) => moneyText(value, method.currency, language);
  const sentences: Sentence[] = [];
  const asksMin = MIN.test(words) || LIMIT.test(words);
  const asksMax = MAX.test(words) || LIMIT.test(words);

  if (amount !== null && (asksMin || asksMax || RANGE_ASK.test(words))) {
    const limits =
      method.min_amount === null && method.max_amount === null
        ? null
        : [
            method.min_amount === null
              ? null
              : tr
                ? `en az ${money(method.min_amount)}`
                : `at least ${money(method.min_amount)}`,
            method.max_amount === null
              ? null
              : tr
                ? `en fazla ${money(method.max_amount)}`
                : `at most ${money(method.max_amount)}`,
          ]
            .filter(Boolean)
            .join(tr ? ', ' : ', ');
    if (limits === null) return null;
    const fits = amountInRange(method, amount);
    sentences.push(
      tr
        ? `${name} ile ${money(amount)} ${fits ? verbTr : deposit ? 'yatıramazsınız' : 'çekemezsiniz'}; sınırlar: ${limits}.`
        : `You ${fits ? 'can' : 'cannot'} ${verbEn} ${money(amount)} with ${name}; the limits are ${limits}.`,
    );
  } else {
    if (asksMin) {
      sentences.push(
        method.min_amount === null
          ? null
          : tr
            ? `${name} ile en az ${money(method.min_amount)} ${verbTr}.`
            : `With ${name} you can ${verbEn} at least ${money(method.min_amount)}.`,
      );
    }
    if (asksMax) {
      sentences.push(
        method.max_amount === null
          ? null
          : tr
            ? `${name} ile en fazla ${money(method.max_amount)} ${verbTr}.`
            : `With ${name} you can ${verbEn} at most ${money(method.max_amount)}.`,
      );
    }
  }
  if (EXPECTED.test(words)) {
    const minutes = method.expected_minutes;
    sentences.push(
      minutes === null
        ? null
        : tr
          ? deposit
            ? `${name} ile yapılan yatırımlar genellikle ${minutesText(minutes, language)} içinde hesaba geçer.`
            : `${name} ile yapılan çekimler genellikle ${minutesText(minutes, language)} içinde hesabınıza ulaşır.`
          : `${name} ${deposit ? 'deposits' : 'withdrawals'} usually arrive within ${minutesText(minutes, language)}.`,
    );
  }
  if (HOURS.test(words) && !/\bkac saat\b/.test(words)) {
    // The hours in words are Turkish only (`formatWorkingHoursTr`).
    sentences.push(
      tr ? `${name} işlem saatleri: ${formatWorkingHoursTr(method.working_hours)}.` : null,
    );
  }
  if (RECEIPT.test(words)) {
    sentences.push(
      tr
        ? `${name} ile yapılan işlemlerde dekont ${method.receipt_required ? 'gerekir' : 'gerekmez'}.`
        : `A receipt is ${method.receipt_required ? '' : 'not '}required for ${name}.`,
    );
  }
  if (THIRD_PARTY.test(words)) {
    sentences.push(
      tr
        ? method.third_party_allowed
          ? `${name} ile başka birinin hesabından yapılan işlem kabul edilir.`
          : `${name} ile yalnız kendi adınıza kayıtlı hesaptan işlem yapabilirsiniz.`
        : method.third_party_allowed
          ? `${name} accepts a transaction from someone else's account.`
          : `With ${name} only an account in your own name can be used.`,
    );
  }
  if (SITE_REQUEST.test(words)) {
    sentences.push(
      tr
        ? `${name} ile göndermeden önce site üzerinden talep oluşturmanız ${method.requires_site_request ? 'gerekir' : 'gerekmez'}.`
        : `With ${name} you ${method.requires_site_request ? 'need' : 'do not need'} to create a request on the site first.`,
    );
  }
  return joined(sentences);
}

function bonusAnswer(
  bonus: BonusFields,
  words: string,
  amount: number | null,
  language: FactLanguage,
): string | null {
  const tr = language === 'tr';
  const name = bonus.name;
  const num = (value: number) => numberText(value, language);
  const sentences: Sentence[] = [];
  const asksOdds = ODDS.test(words);
  const asksBet = BET.test(words) && !asksOdds && (MAX.test(words) || LIMIT.test(words));
  const asksCashout =
    CASHOUT.test(words) && (MAX.test(words) || LIMIT.test(words) || /\bkazanc\w*\b/.test(words));
  if (WAGER.test(words)) {
    const k = bonus.wagering_multiplier;
    if (k === null || bonus.wagering_base === null) {
      sentences.push(
        tr ? `${name} için çevrim şartı yoktur.` : `${name} has no wagering requirement.`,
      );
    } else {
      const ofBonus = bonus.wagering_base === 'bonus';
      sentences.push(
        tr
          ? `${name} için çevrim şartı ${ofBonus ? 'bonus tutarının' : 'bonus ve yatırım tutarının toplamının'} ${num(k)} katıdır.`
          : `${name} must be wagered ${num(k)} times the ${ofBonus ? 'bonus amount' : 'bonus plus deposit'}.`,
      );
      if (amount !== null) {
        const required = Math.round(amount * k * 100) / 100;
        sentences.push(
          tr
            ? `Genel bir örnek: ${ofBonus ? 'bonus' : 'bonus ve yatırım toplamı'} ${num(amount)} ise gerekli çevrim ${num(amount)} × ${num(k)} = ${num(required)} olur.`
            : `A general example: with ${ofBonus ? 'a bonus' : 'bonus plus deposit'} of ${num(amount)}, the wagering is ${num(amount)} × ${num(k)} = ${num(required)}.`,
        );
      }
    }
    if (REMAINING.test(words)) {
      sentences.push(
        tr
          ? 'Hesabınıza özel kalan çevrim tutarını buradan göremiyorum.'
          : 'I cannot see what is left to wager on your own account from here.',
      );
    }
  }
  if (asksOdds) {
    sentences.push(
      bonus.min_odds === null
        ? null
        : tr
          ? `${name} için en düşük oran ${num(bonus.min_odds)}.`
          : `The minimum odds for ${name} are ${num(bonus.min_odds)}.`,
    );
  }
  if (asksBet) {
    sentences.push(
      bonus.max_bet === null
        ? null
        : tr
          ? `${name} kullanılırken en yüksek bahis ${num(bonus.max_bet)}.`
          : `The maximum bet with ${name} is ${num(bonus.max_bet)}.`,
    );
  }
  if (asksCashout) {
    sentences.push(
      bonus.max_cashout === null
        ? null
        : tr
          ? `${name} ile en çok ${num(bonus.max_cashout)} çekilebilir.`
          : `The most that can be withdrawn with ${name} is ${num(bonus.max_cashout)}.`,
    );
  }
  const asksMinDeposit =
    (MIN.test(words) && !asksOdds && !asksBet) ||
    (DEPOSIT_WORD.test(words) && /\bkac (tl|lira|try)\b/.test(words));
  if (asksMinDeposit) {
    sentences.push(
      bonus.min_deposit === null
        ? null
        : tr
          ? `${name} için en az ${num(bonus.min_deposit)} yatırım gerekir.`
          : `${name} needs a deposit of at least ${num(bonus.min_deposit)}.`,
    );
  }
  if (VALIDITY.test(words)) {
    sentences.push(
      bonus.validity_days === null
        ? null
        : tr
          ? `${name} ${bonus.validity_days} gün geçerlidir.`
          : `${name} is valid for ${plural(bonus.validity_days, 'day')}.`,
    );
  }
  if (CLAIM.test(words)) {
    const code = bonus.promo_code?.trim();
    sentences.push(
      bonus.claim_method === 'code'
        ? code
          ? tr
            ? `${name} promosyon koduyla alınır: ${code}.`
            : `${name} is claimed with the promo code ${code}.`
          : null
        : bonus.claim_method === 'auto'
          ? tr
            ? `${name} otomatik olarak tanımlanır.`
            : `${name} is credited automatically.`
          : tr
            ? `${name} canlı destekten talep edilir.`
            : `${name} is claimed through live support.`,
    );
  }
  return joined(sentences);
}

function kycAnswer(doc: KycDocumentFields, words: string, language: FactLanguage): string | null {
  const tr = language === 'tr';
  const name = doc.doc_type;
  const sentences: Sentence[] = [];
  if (REVIEW_TIME.test(words) && REVIEW_WORD.test(words)) {
    sentences.push(
      doc.review_hours === null
        ? null
        : tr
          ? `${name} incelemesi genellikle ${minutesText(doc.review_hours * 60, language)} içinde sonuçlanır.`
          : `${name} is usually reviewed within ${minutesText(doc.review_hours * 60, language)}.`,
    );
  }
  if (UPLOAD.test(words)) {
    const path = doc.upload_path_text?.trim();
    const where = path
      ? tr
        ? `${name} belgesini şuradan yükleyebilirsiniz: ${path}`
        : `You can upload ${name} here: ${path}`
      : null;
    const chat = tr
      ? doc.chat_upload_allowed
        ? 'Belgeyi bu sohbetten de gönderebilirsiniz.'
        : 'Belge bu sohbetten kabul edilmez.'
      : doc.chat_upload_allowed
        ? 'You can also send it in this chat.'
        : 'It cannot be accepted through this chat.';
    sentences.push(where ? `${where.replace(/[.!?]$/, '')}. ${chat}` : chat);
  }
  if (CRITERIA.test(words)) {
    const criteria = doc.acceptance_criteria.map((c) => c.trim()).filter(Boolean);
    sentences.push(
      criteria.length === 0
        ? null
        : tr
          ? `${name} için kabul koşulları: ${criteria.join('; ')}.`
          : `${name} is accepted when: ${criteria.join('; ')}.`,
    );
  }
  return joined(sentences);
}

function ruleAnswer(rule: KbRuleFields, language: FactLanguage): string | null {
  const parts: string[] = [];
  if (rule.numeric_value !== null) {
    const unit = rule.unit?.trim();
    const value = numberText(rule.numeric_value, language, 4);
    parts.push(unit ? `${value} ${unit}` : value);
  }
  const text = rule.value_text?.trim();
  if (text) parts.push(text);
  return parts.length === 0 ? null : `${rule.title.trim()}: ${parts.join(' — ')}.`;
}

/** All the sentences, or none: a property the row does not hold leaves the question to the search. */
function joined(sentences: readonly Sentence[]): string | null {
  if (sentences.length === 0 || sentences.some((sentence) => sentence === null)) return null;
  return sentences.join(' ');
}

/** The rule whose title (or key, in words) the message holds — one, or none. */
function namedRule(words: string, rules: FactTables['rules']): FactRow<KbRuleFields> | null {
  const padded = ` ${words} `;
  const named = rules.filter(({ fields }) =>
    [fields.title, fields.key.replace(/_/g, ' ')].some((name) => {
      const term = wordsOf(name);
      return term.length > 0 && padded.includes(` ${term} `);
    }),
  );
  return named.length === 1 ? (named[0] as FactRow<KbRuleFields>) : null;
}

/**
 * The tables' answer to a question about one row (AI-06 §3), or null. Exactly
 * one row of one table must be named — a method (the direction from the words
 * when its name is in both), a bonus, a KYC document — and every property
 * asked must be on it; otherwise a rule named by its title; otherwise nothing.
 */
export function answerFromTables(
  tables: FactTables,
  input: { message: string; language: PersonaLanguage | null; currency: string },
): FactAnswer | null {
  const language: FactLanguage | null =
    input.language === null || input.language === 'tr'
      ? 'tr'
      : input.language === 'en'
        ? 'en'
        : null;
  if (language === null) return null;
  const words = wordsOf(input.message);
  if (!words) return null;
  const parsed = parseAmountTr(input.message, { currency: input.currency });
  const amount = parsed.status === 'filled' ? parsed.value.amount : null;

  const method = namedKey(words, tables.payment_methods, (row) => [
    row.fields.name,
    ...row.fields.aliases,
  ]);
  const bonus = namedKey(words, tables.bonuses, (row) => [row.fields.name, ...row.fields.aliases]);
  const doc = namedKey(words, tables.kyc_documents, (row) => [row.fields.doc_type]);
  const named = [method, bonus, doc].filter((key) => key !== null);
  if (named.length > 1 || named.includes('several')) return null;

  if (method !== null) {
    const row = methodRow(tables, method, words);
    if (row === null) return null;
    const text = methodAnswer(row.fields, words, amount, language);
    return text === null ? null : { text, factIds: [row.id] };
  }
  if (bonus !== null) {
    const row = rowNamed(tables.bonuses, (r) => r.fields.name, bonus);
    const text = row === null ? null : bonusAnswer(row.fields, words, amount, language);
    return row === null || text === null ? null : { text, factIds: [row.id] };
  }
  if (doc !== null) {
    const row = rowNamed(tables.kyc_documents, (r) => r.fields.doc_type, doc);
    const text = row === null ? null : kycAnswer(row.fields, words, language);
    return row === null || text === null ? null : { text, factIds: [row.id] };
  }
  const rule = namedRule(words, tables.rules);
  if (rule === null) return null;
  const text = ruleAnswer(rule.fields, language);
  return text === null ? null : { text, factIds: [rule.id] };
}

/** The method row of that normalised name in the direction the words ask — the only one when they do not say. */
function methodRow(
  tables: FactTables,
  key: string,
  words: string,
): FactRow<PaymentMethodFields> | null {
  const rows = tables.payment_methods.filter(
    ({ fields }) => normalizeKnowledgeTableName(fields.name) === key,
  );
  if (rows.length === 1) return rows[0] as FactRow<PaymentMethodFields>;
  const deposit = DEPOSIT_WORD.test(words);
  const withdrawal = WITHDRAWAL_WORD.test(words);
  if (deposit === withdrawal) return null;
  return (
    rows.find(({ fields }) => fields.direction === (deposit ? 'deposit' : 'withdrawal')) ?? null
  );
}

// ---------------------------------------------------------------------------
// The engine's one source.
// ---------------------------------------------------------------------------

/**
 * The tables behind the engine (`ConversationEngineOptions.facts` and
 * `.tables`): a procedure's facts and options, and the knowledge path's
 * exact answer — both from one read under the turn's tenant.
 */
export class KnowledgeTableFacts implements KnowledgeFacts, FactTableReader {
  read(input: FactTableRead): Promise<FactTables> {
    return input.db((tx) => readFactTables(tx, { brandId: input.brandId, now: input.now }));
  }

  async answer(input: Parameters<KnowledgeFacts['answer']>[0]): Promise<FactAnswer | null> {
    return answerFromTables(await this.read(input), input);
  }
}
