/**
 * Traffic's "Match all filters" condition list (FR-MOD-13.2, 13.2-h) — a pure
 * conditions-array → query-string compiler mirroring 13.2-f's parameter names
 * 1:1 (`activity`, `page_url_contains`, `came_from_contains`, `country_code`,
 * `is_lead`, `group_id`), plus the client-side pre-validation FR-EK-A.1
 * requires before a request is allowed to fire.
 *
 * Each field can appear at most once in the list: "Add filter" only ever
 * offers a field not already present (`availableFields`), so two rows never
 * fight over the same parameter and "remove" is unambiguous by field name
 * alone. `activity` is one of the six here too — 13.2-g's tab strip is a
 * shortcut for the common case, but the panel can still narrow (or widen,
 * while the tab sits on "All") by activity like any other condition; see
 * `resolveActivity` for how the two combine into one request.
 */
import { TRAFFIC_TABS } from './traffic-tabs.js';
import type { TrafficActivity } from './types.js';

export type TrafficConditionField =
  'activity' | 'page_url_contains' | 'came_from_contains' | 'country_code' | 'is_lead' | 'group_id';

export interface TrafficCondition {
  field: TrafficConditionField;
  /** Raw, as typed/selected — interpretation and validation depend on the field. */
  value: string;
}

interface TrafficFieldOption {
  value: string;
  /** Catalogue key — `TrafficFilters.tsx` translates it. */
  labelKey: string;
}

export interface TrafficFieldDef {
  field: TrafficConditionField;
  /** Catalogue key, not words: this file stays language-free (tm 259.18). */
  labelKey: string;
  kind: 'select' | 'text';
  /**
   * The choices of a closed select. `group_id` has none here: its choices are
   * the workspace's own teams, which only the wrapper can load.
   */
  options?: readonly TrafficFieldOption[];
  placeholder?: string;
  /** What a freshly added row starts with. */
  initialValue: string;
}

// Reuses 13.2-g's tab labels (the same `traffic.tab.*` keys) rather than
// restating them, so the two surfaces can never disagree on what to call a state.
const ACTIVITY_OPTIONS: readonly TrafficFieldOption[] = TRAFFIC_TABS.filter(
  (tab) => tab.id !== 'all',
).map((tab) => ({ value: tab.id, labelKey: `traffic.tab.${tab.id}` }));

const LEAD_OPTIONS: readonly TrafficFieldOption[] = [
  { value: 'true', labelKey: 'traffic.filters.option.lead' },
  { value: 'false', labelKey: 'traffic.filters.option.notLead' },
];

export const TRAFFIC_FIELD_DEFS: readonly TrafficFieldDef[] = [
  {
    field: 'activity',
    labelKey: 'traffic.filters.field.activity',
    kind: 'select',
    options: ACTIVITY_OPTIONS,
    initialValue: ACTIVITY_OPTIONS[0]!.value,
  },
  {
    field: 'page_url_contains',
    labelKey: 'traffic.filters.field.pageUrl',
    kind: 'text',
    placeholder: '/pricing',
    initialValue: '',
  },
  {
    field: 'came_from_contains',
    labelKey: 'traffic.filters.field.cameFrom',
    kind: 'text',
    placeholder: 'google.com',
    initialValue: '',
  },
  {
    field: 'country_code',
    labelKey: 'traffic.filters.field.country',
    kind: 'text',
    placeholder: 'US',
    initialValue: '',
  },
  {
    field: 'is_lead',
    labelKey: 'traffic.filters.field.lead',
    kind: 'select',
    options: LEAD_OPTIONS,
    initialValue: 'true',
  },
  {
    field: 'group_id',
    labelKey: 'traffic.filters.field.team',
    kind: 'select',
    initialValue: '',
  },
];

const FIELD_DEF_BY_FIELD = new Map<TrafficConditionField, TrafficFieldDef>(
  TRAFFIC_FIELD_DEFS.map((def) => [def.field, def]),
);

export function fieldDef(field: TrafficConditionField): TrafficFieldDef {
  const def = FIELD_DEF_BY_FIELD.get(field);
  // i18n-ignore: a developer error (a field outside the closed catalogue), never shown.
  if (!def) throw new Error(`Unknown traffic filter field: ${field}`);
  return def;
}

/** A freshly-added row for a field, seeded with its default value. */
export function newCondition(field: TrafficConditionField): TrafficCondition {
  return { field, value: fieldDef(field).initialValue };
}

/** Fields not yet present in the list — what "Add filter" offers next. */
export function availableFields(
  conditions: readonly TrafficCondition[],
): readonly TrafficFieldDef[] {
  const used = new Set(conditions.map((condition) => condition.field));
  return TRAFFIC_FIELD_DEFS.filter((def) => !used.has(def.field));
}

const COUNTRY_CODE = /^[A-Za-z]{2}$/;
const DIGITS_ONLY = /^\d+$/;
const MAX_TEXT_LENGTH = 2048; // matches 13.2-f's z.string().max(2048)

/**
 * `null` when the value is acceptable; otherwise the catalogue key of the
 * field-under message, which the wrapper resolves in the panel's language.
 */
export function conditionErrorKey(condition: TrafficCondition): string | null {
  const value = condition.value.trim();
  switch (condition.field) {
    case 'activity':
      return ACTIVITY_OPTIONS.some((option) => option.value === value)
        ? null
        : 'traffic.filters.error.activity';
    case 'is_lead':
      return value === 'true' || value === 'false' ? null : 'traffic.filters.error.lead';
    case 'page_url_contains':
      if (!value) return 'traffic.filters.error.pageUrlRequired';
      return value.length <= MAX_TEXT_LENGTH ? null : 'traffic.filters.error.tooLong';
    case 'came_from_contains':
      if (!value) return 'traffic.filters.error.cameFromRequired';
      return value.length <= MAX_TEXT_LENGTH ? null : 'traffic.filters.error.tooLong';
    case 'country_code':
      if (!value) return 'traffic.filters.error.countryRequired';
      return COUNTRY_CODE.test(value) ? null : 'traffic.filters.error.countryFormat';
    case 'group_id':
      if (!value) return 'traffic.filters.error.teamRequired';
      return DIGITS_ONLY.test(value) ? null : 'traffic.filters.error.teamFormat';
  }
}

/** Every condition in the list passes its own validator. */
export function conditionsAreValid(conditions: readonly TrafficCondition[]): boolean {
  return conditions.every((condition) => conditionErrorKey(condition) === null);
}

/**
 * 13.2-f's query parameters for every VALID condition, one field = one
 * parameter, mirroring the backend's names exactly (`country_code` is
 * upper-cased; everything else is trimmed and passed through as typed). An
 * invalid condition contributes nothing — the caller decides separately
 * whether an invalid row should hold back the whole request (it should; see
 * `conditionsAreValid`), this function just never emits a broken parameter.
 */
export function buildTrafficParams(conditions: readonly TrafficCondition[]): URLSearchParams {
  const params = new URLSearchParams();
  for (const condition of conditions) {
    if (conditionErrorKey(condition)) continue;
    const value = condition.value.trim();
    params.append(
      condition.field,
      condition.field === 'country_code' ? value.toUpperCase() : value,
    );
  }
  return params;
}

/**
 * The `activity` values an actual `GET /traffic` request should carry: the
 * panel's own `activity` condition when present (13.2-g's tab is, per the
 * spec, "an already pre-filled activity condition" — once the panel holds its
 * own, that is the one in force), otherwise whatever the selected tab implies.
 */
export function resolveActivity(
  tabActivities: readonly TrafficActivity[] | undefined,
  conditions: readonly TrafficCondition[],
): readonly TrafficActivity[] | undefined {
  const activityCondition = conditions.find(
    (condition) => condition.field === 'activity' && conditionErrorKey(condition) === null,
  );
  if (activityCondition) return [activityCondition.value as TrafficActivity];
  return tabActivities;
}

/**
 * Reconstructs the condition list from URL search parameters — the inverse of
 * how conditions are written back to the URL — so a reload or a shared link
 * restores the same filters, in the fields' catalogue order.
 */
export function conditionsFromSearchParams(searchParams: URLSearchParams): TrafficCondition[] {
  const conditions: TrafficCondition[] = [];
  for (const def of TRAFFIC_FIELD_DEFS) {
    const value = searchParams.get(def.field);
    if (value !== null) conditions.push({ field: def.field, value });
  }
  return conditions;
}
