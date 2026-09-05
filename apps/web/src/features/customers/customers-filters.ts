/**
 * Contacts' "Match all filters" condition list (FR-MOD-03.2.1) — the same
 * shape `traffic-filters.ts` established for the board's own panel, reused
 * through the shared `ConditionFilters` component rather than copied: a
 * pure conditions-array to query-string compiler, plus the client-side
 * pre-validation a condition must pass before it is allowed to reach a
 * request.
 *
 * Four fields, each addable at most once: `country_code` mirrors the
 * board's own field 1:1 (same validator, same upper-casing before it
 * reaches the wire — see `buildCustomerParams`). `last_activity_from`/`_to`
 * are two ends of one range rather than a single two-input field, so each
 * can be added, edited or removed independently like any other condition —
 * the server treats an absent end as unbounded on that side. `has_tickets`
 * is a real relation check (FR-MOD-03.2.1's "sunucu destegi olan alan"
 * requirement) rather than the unmaintained `chats_count`/`tickets_count`
 * columns `customer-service.ts` already warns never to trust.
 */
export type CustomerConditionField =
  'country_code' | 'last_activity_from' | 'last_activity_to' | 'has_tickets';

export interface CustomerCondition {
  field: CustomerConditionField;
  /** Raw, as typed/selected — interpretation and validation depend on the field. */
  value: string;
}

interface CustomerFieldOption {
  value: string;
  label: string;
}

export interface CustomerFieldDef {
  field: CustomerConditionField;
  label: string;
  kind: 'select' | 'text' | 'date';
  options?: readonly CustomerFieldOption[];
  placeholder?: string;
  /** What a freshly added row starts with. */
  initialValue: string;
}

const HAS_TICKETS_OPTIONS: readonly CustomerFieldOption[] = [
  { value: 'true', label: 'Has tickets' },
  { value: 'false', label: 'No tickets' },
];

export const CUSTOMER_FIELD_DEFS: readonly CustomerFieldDef[] = [
  {
    field: 'country_code',
    label: 'Country',
    kind: 'text',
    placeholder: 'US',
    initialValue: '',
  },
  {
    field: 'last_activity_from',
    label: 'Active from',
    kind: 'date',
    initialValue: '',
  },
  {
    field: 'last_activity_to',
    label: 'Active until',
    kind: 'date',
    initialValue: '',
  },
  {
    field: 'has_tickets',
    label: 'Has tickets',
    kind: 'select',
    options: HAS_TICKETS_OPTIONS,
    initialValue: 'true',
  },
];

const FIELD_DEF_BY_FIELD = new Map<CustomerConditionField, CustomerFieldDef>(
  CUSTOMER_FIELD_DEFS.map((def) => [def.field, def]),
);

export function fieldDef(field: CustomerConditionField): CustomerFieldDef {
  const def = FIELD_DEF_BY_FIELD.get(field);
  if (!def) throw new Error(`Unknown customer filter field: ${field}`);
  return def;
}

/** A freshly-added row for a field, seeded with its default value. */
export function newCondition(field: CustomerConditionField): CustomerCondition {
  return { field, value: fieldDef(field).initialValue };
}

/** Fields not yet present in the list — what "Add filter" offers next. */
export function availableFields(
  conditions: readonly CustomerCondition[],
): readonly CustomerFieldDef[] {
  const used = new Set(conditions.map((condition) => condition.field));
  return CUSTOMER_FIELD_DEFS.filter((def) => !used.has(def.field));
}

const COUNTRY_CODE = /^[A-Za-z]{2}$/;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** `null` when the value is acceptable; the field-under message otherwise. */
export function conditionError(condition: CustomerCondition): string | null {
  const value = condition.value.trim();
  switch (condition.field) {
    case 'country_code':
      if (!value) return 'Enter a country code.';
      return COUNTRY_CODE.test(value) ? null : 'Use a 2-letter country code, like US.';
    case 'last_activity_from':
      if (!value) return 'Choose a start date.';
      return DATE_ONLY.test(value) ? null : 'Enter a valid date.';
    case 'last_activity_to':
      if (!value) return 'Choose an end date.';
      return DATE_ONLY.test(value) ? null : 'Enter a valid date.';
    case 'has_tickets':
      return value === 'true' || value === 'false' ? null : 'Choose has tickets or no tickets.';
  }
}

/** Every condition in the list passes its own validator. */
export function conditionsAreValid(conditions: readonly CustomerCondition[]): boolean {
  return conditions.every((condition) => conditionError(condition) === null);
}

/**
 * Query parameters for every VALID condition, one field = one parameter,
 * mirroring the backend's names exactly. `country_code` is upper-cased
 * before it leaves the client — the same normalisation the server applies
 * again on the way in (`routes/customers.ts`), so a lower-case type never
 * relies on the request layer alone to fix it. An invalid condition
 * contributes nothing; the caller decides separately whether an invalid row
 * should hold back the whole request (it should; see `conditionsAreValid`).
 */
export function buildCustomerParams(conditions: readonly CustomerCondition[]): URLSearchParams {
  const params = new URLSearchParams();
  for (const condition of conditions) {
    if (conditionError(condition)) continue;
    const value = condition.value.trim();
    params.append(
      condition.field,
      condition.field === 'country_code' ? value.toUpperCase() : value,
    );
  }
  return params;
}

/**
 * Reconstructs the condition list from URL search parameters — the inverse of
 * how conditions are written back to the URL — so a reload or a shared link
 * restores the same filters, in the fields' catalogue order.
 */
export function conditionsFromSearchParams(searchParams: URLSearchParams): CustomerCondition[] {
  const conditions: CustomerCondition[] = [];
  for (const def of CUSTOMER_FIELD_DEFS) {
    const value = searchParams.get(def.field);
    if (value !== null) conditions.push({ field: def.field, value });
  }
  return conditions;
}
