/**
 * The structured knowledge tables' form, as data (tm 310.5 · AI-13).
 *
 * Four tables share one screen, so they share one form: the writable fields and
 * their kinds are `KNOWLEDGE_TABLE_COLUMNS` — the same list the CSV import and
 * export read, so the form, the file and the server cannot name different
 * fields. What this module adds is only how each field is *typed* by a person
 * (a closed-list value is a select, a long text a textarea, a list one
 * comma-separated line) and the way back from that text to the contract's JSON.
 *
 * Nothing here validates what the server validates (`validateKnowledgeTableRow`
 * is the one judge — min ≤ max, delay ≥ expected, no overlapping windows): the
 * form sends what was typed and shows the server's `details.problems` beside
 * the fields. The only local refusals are the ones with nothing to send — a
 * number that is not a number, JSON that does not parse.
 */
import {
  BONUS_CLAIM_METHODS,
  BONUS_TYPES,
  BONUS_WAGERING_BASES,
  KB_RULE_CATEGORIES,
  KNOWLEDGE_TABLE_COLUMNS,
  KNOWLEDGE_TABLE_PATH_SEGMENTS,
  KNOWLEDGE_TABLE_REQUIRED_FIELDS,
  KNOWLEDGE_TABLE_REVIEW_INTERVAL_DAYS,
  PAYMENT_DIRECTIONS,
  PAYMENT_REFERENCE_FORMATS,
  type KnowledgeTable,
  type KnowledgeTableFieldKind,
  type KnowledgeTableProblem,
  type KnowledgeTableRowMeta,
} from '@siyahtus/types';

/** A row as `GET /knowledge-tables/{table}` returns it: the meta, the review state, the fields. */
export type TableRow = KnowledgeTableRowMeta & {
  review_due_at: string;
  stale: boolean;
} & Record<string, unknown>;

/** The tables in the order the tabs read left to right. */
export const TABLE_TABS: readonly KnowledgeTable[] = [
  'payment_methods',
  'bonuses',
  'kyc_documents',
  'rules',
];

export function segmentOf(table: KnowledgeTable): string {
  return KNOWLEDGE_TABLE_PATH_SEGMENTS[table];
}

/** How a field is drawn. */
export type FieldInput =
  'text' | 'textarea' | 'number' | 'boolean' | 'select' | 'list' | 'json' | 'date' | 'methods';

export interface FieldSpec {
  name: string;
  kind: KnowledgeTableFieldKind;
  input: FieldInput;
  /** The closed list of a select; the first entry is its default. */
  options?: readonly string[];
  /** Whether a select may also be left empty (nothing chosen). */
  optional?: boolean;
  required: boolean;
  /** Whether "cleared" is `null` on the wire; the rest are never null. */
  nullable: boolean;
}

const SELECTS: Readonly<Record<string, { options: readonly string[]; optional?: boolean }>> = {
  direction: { options: PAYMENT_DIRECTIONS },
  reference_format: { options: PAYMENT_REFERENCE_FORMATS },
  type: { options: ['other', ...BONUS_TYPES.filter((type) => type !== 'other')] },
  wagering_base: { options: BONUS_WAGERING_BASES, optional: true },
  claim_method: { options: BONUS_CLAIM_METHODS },
  category: { options: ['other', ...KB_RULE_CATEGORIES.filter((c) => c !== 'other')] },
};
const TEXTAREAS = new Set([
  'reference_instructions',
  'customer_notes',
  'terms_text',
  'when_required',
  'upload_path_text',
  'description',
]);
const DATES = new Set(['active_from', 'active_to']);
/** Text fields the server never stores as null: they have a default. */
const NEVER_NULL = new Set(['currency']);

function inputOf(name: string, kind: KnowledgeTableFieldKind): FieldInput {
  if (name in SELECTS) return 'select';
  if (name === 'excluded_method_ids') return 'methods';
  if (DATES.has(name)) return 'date';
  if (TEXTAREAS.has(name)) return 'textarea';
  return kind;
}

/** Whether clearing a field sends `null` — only optional values; defaults and lists are never null. */
function nullableField(
  name: string,
  input: FieldInput,
  required: boolean,
  optionalSelect: boolean,
): boolean {
  if (input === 'select') return optionalSelect;
  if (input === 'boolean' || input === 'list' || input === 'methods' || input === 'json')
    return false;
  return !required && !NEVER_NULL.has(name);
}

/** The form's fields for `table`, in the CSV's column order. */
export function fieldSpecs(table: KnowledgeTable): FieldSpec[] {
  const required = new Set(KNOWLEDGE_TABLE_REQUIRED_FIELDS[table]);
  return KNOWLEDGE_TABLE_COLUMNS[table].map(([name, kind]) => {
    const select = SELECTS[name];
    const input = inputOf(name, kind);
    return {
      name,
      kind,
      input,
      ...(select ? { options: select.options, optional: select.optional ?? false } : {}),
      required: required.has(name),
      nullable: nullableField(name, input, required.has(name), select?.optional === true),
    };
  });
}

// ===========================================================================
// State
// ===========================================================================

/** What a person has typed: every field as text (or a checkbox), nothing parsed yet. */
export interface TableFormState {
  fields: Record<string, string | boolean>;
  reviewIntervalDays: string;
  brandIds: string[];
  ownerId: string;
  /** For a bonus: the payment methods whose deposits do not qualify. */
  excludedMethodIds: string[];
}

const BOOLEAN_DEFAULTS: Readonly<Record<string, boolean>> = { active: true };

function localDate(iso: string): string {
  const date = new Date(iso);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** A blank form for `table`: the column defaults, nothing else. */
export function emptyState(table: KnowledgeTable): TableFormState {
  const fields: Record<string, string | boolean> = {};
  for (const spec of fieldSpecs(table)) {
    if (spec.input === 'boolean') fields[spec.name] = BOOLEAN_DEFAULTS[spec.name] ?? false;
    else if (spec.input === 'select') fields[spec.name] = spec.optional ? '' : spec.options![0]!;
    else if (spec.name === 'currency') fields[spec.name] = 'TRY';
    else fields[spec.name] = '';
  }
  return {
    fields,
    reviewIntervalDays: String(KNOWLEDGE_TABLE_REVIEW_INTERVAL_DAYS[table]),
    brandIds: [],
    ownerId: '',
    excludedMethodIds: [],
  };
}

/** The form of an existing row, for editing it. */
export function stateOf(table: KnowledgeTable, row: TableRow): TableFormState {
  const state = emptyState(table);
  for (const spec of fieldSpecs(table)) {
    const value = row[spec.name];
    if (spec.input === 'boolean') state.fields[spec.name] = value === true;
    else if (spec.input === 'methods')
      state.excludedMethodIds = Array.isArray(value) ? [...(value as string[])] : [];
    else if (spec.input === 'list') {
      state.fields[spec.name] = Array.isArray(value) ? value.join(', ') : '';
    } else if (spec.input === 'json') {
      const empty =
        value === null || value === undefined || (Array.isArray(value) && value.length === 0);
      state.fields[spec.name] = empty ? '' : JSON.stringify(value, null, 2);
    } else if (spec.input === 'date') {
      state.fields[spec.name] = typeof value === 'string' ? localDate(value) : '';
    } else if (spec.input === 'select') {
      state.fields[spec.name] = typeof value === 'string' ? value : state.fields[spec.name]!;
    } else {
      state.fields[spec.name] = value === null || value === undefined ? '' : String(value);
    }
  }
  state.reviewIntervalDays = String(row.review_interval_days);
  state.brandIds = [...row.brand_ids];
  state.ownerId = row.owner_id ?? '';
  return state;
}

// ===========================================================================
// Payload
// ===========================================================================

/** A refusal that needs no server: `field` and the contract's `code`. */
export type LocalProblem = Pick<KnowledgeTableProblem, 'field' | 'code'>;

export interface TablePayload {
  body: Record<string, unknown>;
  problems: LocalProblem[];
}

/** The start of a local day for a campaign's start, its end for a campaign's end (like a source's `valid_until`). */
function dateToIso(value: string, endOfDay: boolean): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const [, year, month, day] = match;
  const date = endOfDay
    ? new Date(Number(year), Number(month) - 1, Number(day), 23, 59, 59, 0)
    : new Date(Number(year), Number(month) - 1, Number(day), 0, 0, 0, 0);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function splitList(text: string): string[] {
  return text
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter((item) => item !== '');
}

/**
 * The request body for a create (`mode: 'create'`: blank optional fields are
 * left out) or an edit (`'update'`: a cleared optional field is `null`, so
 * clearing it is possible), plus the problems found while turning text into
 * values. A body with problems is not sent.
 */
export function payloadOf(
  table: KnowledgeTable,
  state: TableFormState,
  mode: 'create' | 'update',
): TablePayload {
  const body: Record<string, unknown> = {};
  const problems: LocalProblem[] = [];
  const blank = (spec: FieldSpec): void => {
    if (mode === 'update' && spec.nullable) body[spec.name] = null;
  };

  for (const spec of fieldSpecs(table)) {
    const raw = state.fields[spec.name];
    const text = typeof raw === 'string' ? raw.trim() : '';
    switch (spec.input) {
      case 'boolean':
        body[spec.name] = raw === true;
        break;
      case 'methods':
        body[spec.name] = state.excludedMethodIds;
        break;
      case 'list':
        body[spec.name] = splitList(typeof raw === 'string' ? raw : '');
        break;
      case 'number': {
        if (text === '') {
          blank(spec);
          break;
        }
        const value = Number(text.replace(',', '.'));
        if (!Number.isFinite(value)) problems.push({ field: spec.name, code: 'invalid' });
        else body[spec.name] = value;
        break;
      }
      case 'json': {
        if (text === '') {
          body[spec.name] = spec.name === 'working_hours' ? null : [];
          break;
        }
        try {
          body[spec.name] = JSON.parse(text) as unknown;
        } catch {
          problems.push({ field: spec.name, code: 'invalid' });
        }
        break;
      }
      case 'date': {
        if (text === '') {
          blank(spec);
          break;
        }
        const iso = dateToIso(text, spec.name === 'active_to');
        if (iso === null) problems.push({ field: spec.name, code: 'invalid' });
        else body[spec.name] = iso;
        break;
      }
      default:
        if (text === '') {
          // A required field is always sent, so the server names it `required`.
          if (spec.required) body[spec.name] = '';
          else blank(spec);
        } else body[spec.name] = text;
    }
  }

  const interval = state.reviewIntervalDays.trim();
  if (interval !== '') {
    const days = Number(interval);
    if (!Number.isInteger(days)) problems.push({ field: 'review_interval_days', code: 'invalid' });
    else body['review_interval_days'] = days;
  }
  body['brand_ids'] = state.brandIds;
  if (state.ownerId !== '') body['owner_id'] = state.ownerId;
  else if (mode === 'update') body['owner_id'] = null;

  return { body, problems };
}

// ===========================================================================
// The list
// ===========================================================================

/** The columns a table's list shows (the name column first), by field. */
export const LIST_COLUMNS: Readonly<Record<KnowledgeTable, readonly string[]>> = {
  payment_methods: ['name', 'direction', 'limits', 'expected_minutes', 'active'],
  bonuses: ['name', 'type', 'min_deposit', 'wagering_multiplier', 'active_to'],
  kyc_documents: ['doc_type', 'when_required', 'review_hours', 'chat_upload_allowed'],
  rules: ['key', 'title', 'value', 'category'],
};

export interface CellFormat {
  /** Said for a true / false field. */
  yes: string;
  no: string;
  /** Said for nothing. */
  none: string;
  /** Turns an ISO moment into a date. */
  date: (iso: string) => string;
  /** The label of a closed-list value (`playbook.tables.option.<value>`). */
  option: (value: string) => string;
}

/** The text of one list cell. */
export function cellText(column: string, row: TableRow, format: CellFormat): string {
  if (column === 'limits') {
    const min = row['min_amount'];
    const max = row['max_amount'];
    if (min === null && max === null) return format.none;
    const currency = typeof row['currency'] === 'string' ? ` ${row['currency']}` : '';
    return `${min ?? '…'} – ${max ?? '…'}${currency}`;
  }
  if (column === 'value') {
    const text = row['value_text'];
    const number = row['numeric_value'];
    const unit = typeof row['unit'] === 'string' && row['unit'] !== '' ? ` ${row['unit']}` : '';
    if (typeof text === 'string' && text !== '') return text;
    return number === null || number === undefined ? format.none : `${number}${unit}`;
  }
  const value = row[column];
  if (value === null || value === undefined || value === '') return format.none;
  if (typeof value === 'boolean') return value ? format.yes : format.no;
  if (column === 'direction' || column === 'type' || column === 'category') {
    return format.option(String(value));
  }
  if ((column === 'active_to' || column === 'active_from') && typeof value === 'string') {
    return format.date(value);
  }
  return String(value);
}

/** How many of `rows` are stale. */
export function staleCount(rows: readonly { stale: boolean }[]): number {
  return rows.filter((row) => row.stale).length;
}

/** The problems a refused request names, as `{field, code}` — empty for any other error. */
export function problemsOf(details: Record<string, unknown> | undefined): LocalProblem[] {
  const problems = details?.['problems'];
  if (!Array.isArray(problems)) return [];
  const found: LocalProblem[] = [];
  for (const problem of problems as unknown[]) {
    if (typeof problem !== 'object' || problem === null) continue;
    const { field, code } = problem as Record<string, unknown>;
    if (typeof field === 'string' && typeof code === 'string') {
      found.push({ field, code: code as KnowledgeTableProblem['code'] });
    }
  }
  return found;
}
