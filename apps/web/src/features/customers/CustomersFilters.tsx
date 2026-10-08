/**
 * "Match all filters" — the Contacts filter panel (FR-MOD-03.2.1), a thin
 * wrapper around the shared `ConditionFilters` panel (`TrafficFilters.tsx`'s
 * own wrapper for its board) supplying Contacts' field catalogue and
 * translated chrome. `customers-filters.ts` hands over catalogue keys; the
 * words — field labels, options, the message under a field — are resolved
 * here, so the panel follows the console's language (tm 259.18).
 */
import type { ReactElement } from 'react';
import { ConditionFilters, type ConditionFieldDef } from '../../components/ui/index.js';
import { useTranslate } from '../../lib/i18n.js';
import {
  availableFields,
  conditionErrorKey,
  conditionsAreValid,
  fieldDef,
  newCondition,
  type CustomerCondition,
  type CustomerConditionField,
  type CustomerFieldDef,
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

  function translateDef(def: CustomerFieldDef): ConditionFieldDef<CustomerConditionField> {
    return {
      field: def.field,
      label: t(def.labelKey),
      kind: def.kind,
      initialValue: def.initialValue,
      ...(def.placeholder !== undefined ? { placeholder: def.placeholder } : {}),
      ...(def.options
        ? { options: def.options.map((o) => ({ value: o.value, label: t(o.labelKey) })) }
        : {}),
    };
  }

  return (
    <ConditionFilters
      initialConditions={initialConditions}
      onChange={onChange}
      fieldDef={(field) => translateDef(fieldDef(field))}
      availableFields={(conditions) => availableFields(conditions).map(translateDef)}
      newCondition={newCondition}
      conditionError={(condition) => {
        const key = conditionErrorKey(condition);
        return key === null ? null : t(key);
      }}
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
