/**
 * "Match all filters" — the Contacts filter panel (FR-MOD-03.2.1), a thin
 * wrapper around the shared `ConditionFilters` panel (`TrafficFilters.tsx`'s
 * own wrapper for its board) supplying Contacts' field catalogue and
 * translated chrome.
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
  type CustomerCondition,
} from './customers-filters.js';

interface CustomersFiltersProps {
  /** The panel's condition list at mount — from the URL, so a reload restores it. */
  initialConditions: readonly CustomerCondition[];
  /** Called with the full list, but only once every condition in it is valid. */
  onChange: (conditions: CustomerCondition[]) => void;
}

export function CustomersFilters({
  initialConditions,
  onChange,
}: CustomersFiltersProps): ReactElement {
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
        heading: t('customers.filters.heading'),
        addFilter: t('customers.filters.addFilter'),
        addFilterTrigger: t('customers.filters.addFilterTrigger'),
        clear: t('customers.filters.clear'),
        empty: t('customers.filters.empty'),
        allApplied: t('customers.filters.allApplied'),
        removeField: (label) => t('customers.filters.removeField', { label }),
      }}
    />
  );
}
