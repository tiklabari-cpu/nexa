/**
 * "Match all filters" — the traffic board's condition panel (FR-MOD-13.2,
 * 13.2-h), now a thin wrapper around the shared `ConditionFilters` panel
 * (extracted for FR-MOD-03.2.1, the Contacts filter panel) — this file only
 * supplies traffic's own field catalogue and translated chrome.
 *
 * `traffic-filters.ts` hands over catalogue keys; the words are resolved here
 * (tm 259.18). The team filter used to ask for a "Group ID" — a number nobody
 * outside the database knows — and is now a picker over the workspace's own
 * teams, which only this wrapper can load. The wire parameter is unchanged
 * (`group_id=<id>`), so a link saved before this still restores.
 */
import { useQuery } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { ConditionFilters, type ConditionFieldDef } from '../../components/ui/index.js';
import { useApiClient } from '../../lib/auth-store.js';
import { useTranslate } from '../../lib/i18n.js';
import {
  availableFields,
  conditionErrorKey,
  conditionsAreValid,
  fieldDef,
  newCondition,
  type TrafficCondition,
  type TrafficConditionField,
  type TrafficFieldDef,
} from './traffic-filters.js';

interface TrafficFiltersProps {
  /** The panel's condition list at mount — from the URL, so a reload restores it. */
  initialConditions: readonly TrafficCondition[];
  /** Called with the full list, but only once every condition in it is valid. */
  onChange: (conditions: TrafficCondition[]) => void;
}

interface Team {
  id: number;
  name: string;
}

export function TrafficFilters({ initialConditions, onChange }: TrafficFiltersProps): ReactElement {
  const t = useTranslate();
  const api = useApiClient();

  // The `['team', 'groups']` cache key Teams/Tags/CannedResponses already list
  // under, so opening this panel never doubles that request. Every agent holds
  // `groups--my:ro`, so the list is readable here whatever the role.
  const teamsQuery = useQuery({
    queryKey: ['team', 'groups'],
    queryFn: () => api.get<{ items: Team[] }>('/groups'),
  });
  const teams = teamsQuery.data?.items ?? [];

  function translateDef(
    def: TrafficFieldDef,
    current?: string,
  ): ConditionFieldDef<TrafficConditionField> {
    const base: ConditionFieldDef<TrafficConditionField> = {
      field: def.field,
      label: t(def.labelKey),
      kind: def.kind,
      initialValue: def.initialValue,
    };
    if (def.placeholder !== undefined) base.placeholder = def.placeholder;
    if (def.field === 'group_id') {
      const options = teams.map((team) => ({ value: String(team.id), label: team.name }));
      // A team deleted since the link was saved (or one the list has not
      // returned yet) must still be a visible, selected choice — a select
      // whose value matches no option silently shows the first team instead.
      if (current && !options.some((option) => option.value === current)) {
        options.unshift({
          value: current,
          label: t('traffic.filters.team.unknown', { id: current }),
        });
      }
      base.options = options;
      base.initialValue = options[0]?.value ?? '';
    } else if (def.options) {
      base.options = def.options.map((o) => ({ value: o.value, label: t(o.labelKey) }));
    }
    return base;
  }

  const currentValue = new Map<string, string>();
  for (const condition of initialConditions) currentValue.set(condition.field, condition.value);

  return (
    <ConditionFilters
      initialConditions={initialConditions}
      onChange={onChange}
      fieldDef={(field) => translateDef(fieldDef(field), currentValue.get(field))}
      // With no team to pick, the team filter is not offered at all.
      availableFields={(conditions) =>
        availableFields(conditions)
          .filter((def) => def.field !== 'group_id' || teams.length > 0)
          .map((def) => translateDef(def))
      }
      newCondition={(field) =>
        field === 'group_id'
          ? { field, value: translateDef(fieldDef(field)).initialValue }
          : newCondition(field)
      }
      conditionError={(condition) => {
        const key = conditionErrorKey(condition);
        return key === null ? null : t(key);
      }}
      conditionsAreValid={conditionsAreValid}
      labels={{
        heading: t('traffic.filters.heading'),
        addFilter: t('traffic.filters.addFilter'),
        addFilterTrigger: t('traffic.filters.addFilterTrigger'),
        clear: t('traffic.filters.clear'),
        empty: t('traffic.filters.empty'),
        allApplied: t('traffic.filters.allApplied'),
        removeField: (label) => t('traffic.filters.removeField', { label }),
      }}
    />
  );
}
