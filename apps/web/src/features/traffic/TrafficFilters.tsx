/**
 * "Match all filters" — the traffic board's condition panel (FR-MOD-13.2,
 * 13.2-h), now a thin wrapper around the shared `ConditionFilters` panel
 * (extracted for FR-MOD-03.2.1, the Contacts filter panel) — this file only
 * supplies traffic's own field catalogue and translated chrome.
 */
import type { ReactElement } from 'react';
import { ConditionFilters } from '../../components/ui/index.js';
import { useTranslate } from '../../lib/i18n.js';
import {
  availableFields,
  conditionError,
  conditionsAreValid,
  fieldDef,
  newCondition,
  type TrafficCondition,
} from './traffic-filters.js';

interface TrafficFiltersProps {
  /** The panel's condition list at mount — from the URL, so a reload restores it. */
  initialConditions: readonly TrafficCondition[];
  /** Called with the full list, but only once every condition in it is valid. */
  onChange: (conditions: TrafficCondition[]) => void;
}

export function TrafficFilters({ initialConditions, onChange }: TrafficFiltersProps): ReactElement {
  const t = useTranslate();

  return (
    <ConditionFilters
      initialConditions={initialConditions}
      onChange={onChange}
      fieldDef={fieldDef}
      availableFields={availableFields}
      newCondition={newCondition}
      conditionError={conditionError}
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
