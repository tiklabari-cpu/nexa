/**
 * Goals view logic (FR-MOD-13.3), kept free of React so which tab a goal
 * belongs to and how many fall under each are decided by pure functions a
 * unit test can pin down — the same split campaigns.ts draws for its list.
 */
import {
  CUSTOM_EVENT_NAME_RE,
  GOAL_FILTERS,
  type Goal,
  type GoalDefinition,
  type GoalFilter,
  type GoalFunnel,
} from '@siyahtus/types';

/** The status sub-tabs in display order. */
export const GOAL_TABS: ReadonlyArray<{ id: GoalFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'active', label: 'Active' },
  { id: 'inactive', label: 'Inactive' },
];

/** True for a value the status tabs understand — guards a URL/query param. */
export function isGoalFilter(value: string): value is GoalFilter {
  return (GOAL_FILTERS as readonly string[]).includes(value);
}

/** Narrow a goal list to a status tab; `all` keeps everything. */
export function filterGoals(goals: readonly Goal[], filter: GoalFilter): Goal[] {
  if (filter === 'all') return [...goals];
  const active = filter === 'active';
  return goals.filter((goal) => goal.active === active);
}

/** How many goals fall under each tab — the counts shown beside the labels. */
export function goalCounts(goals: readonly Goal[]): Record<GoalFilter, number> {
  const counts: Record<GoalFilter, number> = { all: goals.length, active: 0, inactive: 0 };
  for (const goal of goals) counts[goal.active ? 'active' : 'inactive'] += 1;
  return counts;
}

/**
 * The funnel a goal can be defined against (FR-MOD-13.3, EN-06) — exactly the
 * five predicates {@link GoalDefinition} carries, in the order the builder offers
 * them and the list describes them. A goal is defined by exactly one of
 * these; combining several in one definition is possible at the data layer
 * (204.1's matcher ANDs whatever is set) but not a shape this form offers —
 * that is a rule engine, and ADR-14 rules one out.
 */
export const GOAL_TRIGGER_TYPES = [
  'url_contains',
  'sale_completed',
  'lead_captured',
  'chat_resolved',
  'custom_event',
] as const;

export type GoalTriggerType = (typeof GOAL_TRIGGER_TYPES)[number];

/** The builder's radio label for each trigger type. */
export const GOAL_TRIGGER_TYPE_LABEL_KEY: Record<GoalTriggerType, string> = {
  url_contains: 'goals.builder.type.urlContains',
  sale_completed: 'goals.builder.type.saleCompleted',
  lead_captured: 'goals.builder.type.leadCaptured',
  chat_resolved: 'goals.builder.type.chatResolved',
  custom_event: 'goals.builder.type.customEvent',
};

const FLAG_DEFINITIONS: Record<
  Exclude<GoalTriggerType, 'url_contains' | 'custom_event'>,
  GoalDefinition
> = {
  sale_completed: { sale_completed: true },
  lead_captured: { lead_captured: true },
  chat_resolved: { chat_resolved: true },
};

/** What the builder's "custom event" fields hold (EN-06). */
export interface GoalEventInput {
  name: string;
  value: string;
}

/**
 * Is this a name the page's `siyahtus('trackEvent', …)` and the API both accept?
 * The same shape the server enforces, so the form can never offer a goal that
 * waits for an event nothing could send.
 */
export function isCustomEventName(name: string): boolean {
  return CUSTOM_EVENT_NAME_RE.test(name);
}

/**
 * The definition body to submit for a chosen trigger type. `url_contains`
 * carries the typed needle and `custom_event` the typed name (and optional
 * value); the other three are flags, so choosing one *is* setting it — there is
 * nothing further to type in.
 */
export function buildGoalDefinition(
  type: GoalTriggerType,
  urlContains: string,
  event: GoalEventInput = { name: '', value: '' },
): GoalDefinition {
  if (type === 'url_contains') return { url_contains: urlContains.trim() };
  if (type === 'custom_event') {
    const value = event.value.trim();
    return { custom_event: { name: event.name.trim(), ...(value ? { value_equals: value } : {}) } };
  }
  return FLAG_DEFINITIONS[type];
}

/** One predicate a goal's definition sets, ready to render — a translation
 *  key plus the interpolation params it needs (only the page and event kinds have any). */
export interface GoalTriggerDescriptor {
  key: string;
  params?: Record<string, string>;
}

/**
 * Every predicate a definition sets, in the funnel's own order — defensive
 * against a definition this form never wrote: a hand-edited row, one saved
 * before 204.1, or one combining predicates the API allows but the builder
 * does not offer. An unreadable shape describes as nothing (the caller shows
 * "no trigger") rather than throwing — the same defensiveness the matcher
 * itself applies to the same jsonb column.
 */
export function describeGoalTriggers(definition: unknown): GoalTriggerDescriptor[] {
  if (!definition || typeof definition !== 'object') return [];
  const raw = definition as Record<string, unknown>;
  const out: GoalTriggerDescriptor[] = [];

  if (typeof raw.url_contains === 'string' && raw.url_contains.trim()) {
    out.push({ key: 'goals.page.trigger.urlContains', params: { value: raw.url_contains.trim() } });
  }
  if (raw.sale_completed === true) out.push({ key: 'goals.page.trigger.saleCompleted' });
  if (raw.lead_captured === true) out.push({ key: 'goals.page.trigger.leadCaptured' });
  if (raw.chat_resolved === true) out.push({ key: 'goals.page.trigger.chatResolved' });

  const event = raw.custom_event;
  if (event && typeof event === 'object') {
    const { name, value_equals: valueEquals } = event as Record<string, unknown>;
    if (typeof name === 'string' && name) {
      if (typeof valueEquals === 'string' && valueEquals) {
        out.push({
          key: 'goals.page.trigger.customEventValue',
          params: { name, value: valueEquals },
        });
      } else {
        out.push({ key: 'goals.page.trigger.customEvent', params: { name } });
      }
    }
  }

  return out;
}

/** One stat card in the funnel display: what to label it, its count, and — only for the final stage — its conversion rate. */
export interface GoalFunnelStage {
  label: string;
  value: number;
  /** Only set on the last stage; `null` when there were no chats to divide by (no NaN/Infinity). */
  rate: number | null;
}

/**
 * The 3-stage funnel (Visitors → Chats → Conversions) as label/value/rate
 * triples a component can render without knowing the field names underneath.
 * Only the last stage carries a rate — `GoalFunnel.conversion_rate` is
 * already null-safe (see its own doc comment), so this just relays it rather
 * than re-deriving it and risking a second, driftable definition.
 */
export function funnelStages(funnel: GoalFunnel): GoalFunnelStage[] {
  return [
    { label: 'Visitors', value: funnel.visitors, rate: null },
    { label: 'Chats', value: funnel.chats, rate: null },
    { label: 'Conversions', value: funnel.conversions, rate: funnel.conversion_rate },
  ];
}
