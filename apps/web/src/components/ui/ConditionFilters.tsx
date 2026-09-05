/**
 * "Match all filters" — a generic condition-list panel, extracted from the
 * traffic board's original (13.2-h) so the Contacts filter panel
 * (FR-MOD-03.2.1) could reuse the exact same interaction rather than growing
 * a second one: two panels that look alike but behave differently would have
 * a caller learning two filter languages in the same product.
 *
 * All of the copy is handed in already translated (`labels`) — this file
 * renders none of its own, the same shape as `Dropdown`/`Modal` — and all of
 * the field catalogue (definitions, validators, defaults) is handed in too,
 * so a caller's field set can be closed (traffic's six, Contacts' four)
 * without this file knowing what either of them are.
 *
 * State lives here as a local, uncontrolled list (`rows`) — an immediate
 * value with a debounced commit for `text` fields; `select` and `date`
 * commit the moment they change, since neither is something a caller keeps
 * typing through. A row is never reported upward while it fails its own
 * validator: the caller's `onChange` only ever sees an already-valid list.
 */
import { useEffect, useRef, useState, type ReactElement } from 'react';
import { Dropdown } from './Dropdown.js';
import { FieldError } from '../../lib/form.js';

const TEXT_COMMIT_DELAY_MS = 250;

export interface ConditionFieldOption {
  value: string;
  label: string;
}

export interface ConditionFieldDef<Field extends string> {
  field: Field;
  label: string;
  kind: 'select' | 'text' | 'date';
  options?: readonly ConditionFieldOption[];
  placeholder?: string;
  /** What a freshly added row starts with. */
  initialValue: string;
}

export interface Condition<Field extends string> {
  field: Field;
  /** Raw, as typed/selected — interpretation and validation depend on the field. */
  value: string;
}

export interface ConditionFiltersLabels {
  heading: string;
  addFilter: string;
  addFilterTrigger: string;
  clear: string;
  empty: string;
  allApplied: string;
  removeField: (label: string) => string;
}

interface ConditionFiltersProps<Field extends string> {
  /** The panel's condition list at mount — from the URL, so a reload restores it. */
  initialConditions: readonly Condition<Field>[];
  /** Called with the full list, but only once every condition in it is valid. */
  onChange: (conditions: Condition<Field>[]) => void;
  fieldDef: (field: Field) => ConditionFieldDef<Field>;
  /** Fields not yet present in the list — what "Add filter" offers next. */
  availableFields: (conditions: readonly Condition<Field>[]) => readonly ConditionFieldDef<Field>[];
  newCondition: (field: Field) => Condition<Field>;
  /** `null` when the value is acceptable; the field-under message otherwise. */
  conditionError: (condition: Condition<Field>) => string | null;
  conditionsAreValid: (conditions: readonly Condition<Field>[]) => boolean;
  labels: ConditionFiltersLabels;
}

export function ConditionFilters<Field extends string>({
  initialConditions,
  onChange,
  fieldDef,
  availableFields,
  newCondition,
  conditionError,
  conditionsAreValid,
  labels,
}: ConditionFiltersProps<Field>): ReactElement {
  const [rows, setRows] = useState<Condition<Field>[]>(() => [...initialConditions]);
  const [touched, setTouched] = useState<Partial<Record<Field, boolean>>>({});
  const timers = useRef<Partial<Record<Field, ReturnType<typeof setTimeout>>>>({});

  // Pending debounce timers belong to this component instance only.
  //
  // `Object.keys(...) as Field[]` rather than `Object.values(...)`: with a
  // generic `Field` the latter cannot see past the mapped type's abstract key
  // set and widens every value to `{}`, which `clearTimeout` then rejects.
  useEffect(() => {
    return () => {
      for (const field of Object.keys(timers.current) as Field[]) {
        const timer = timers.current[field];
        if (timer) clearTimeout(timer);
      }
    };
  }, []);

  function commit(next: Condition<Field>[]): void {
    if (conditionsAreValid(next)) onChange(next);
  }

  function clearTimer(field: Field): void {
    const timer = timers.current[field];
    if (timer) clearTimeout(timer);
    delete timers.current[field];
  }

  function addField(field: Field): void {
    const next = [...rows, newCondition(field)];
    setRows(next);
    commit(next);
  }

  function removeField(field: Field): void {
    clearTimer(field);
    const next = rows.filter((row) => row.field !== field);
    setRows(next);
    setTouched((current) => {
      if (!(field in current)) return current;
      const copy = { ...current };
      delete copy[field];
      return copy;
    });
    commit(next);
  }

  function clearAll(): void {
    for (const field of Object.keys(timers.current) as Field[]) clearTimer(field);
    setRows([]);
    setTouched({});
    onChange([]);
  }

  function updateValue(field: Field, value: string): void {
    const next = rows.map((row) => (row.field === field ? { field, value } : row));
    setRows(next);
    setTouched((current) => (current[field] ? current : { ...current, [field]: true }));

    if (fieldDef(field).kind === 'text') {
      clearTimer(field);
      timers.current[field] = setTimeout(() => commit(next), TEXT_COMMIT_DELAY_MS);
    } else {
      commit(next);
    }
  }

  function handleBlur(field: Field): void {
    setTouched((current) => (current[field] ? current : { ...current, [field]: true }));
  }

  const addable = availableFields(rows);

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border bg-surface p-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{labels.heading}</h2>
        <div className="flex items-center gap-2">
          {rows.length > 0 && (
            <button
              type="button"
              onClick={clearAll}
              className="rounded-md px-2 py-1 text-xs font-medium text-content-tertiary hover:text-content"
            >
              {labels.clear}
            </button>
          )}
          <Dropdown
            label={labels.addFilter}
            trigger={labels.addFilterTrigger}
            triggerClassName="rounded-md border border-border bg-inset px-2.5 py-1.5 text-xs font-medium text-content-secondary transition-colors hover:text-content"
            panelClassName="right-0 top-full mt-1 w-56 p-1"
          >
            {({ close }) =>
              addable.length === 0 ? (
                <p className="px-2 py-1.5 text-xs text-content-tertiary">{labels.allApplied}</p>
              ) : (
                <ul className="flex flex-col gap-0.5">
                  {addable.map((def) => (
                    <li key={def.field}>
                      <button
                        type="button"
                        onClick={() => {
                          addField(def.field);
                          close();
                        }}
                        className="w-full rounded-md px-2 py-1.5 text-left text-sm text-content-secondary transition-colors hover:bg-surface-2"
                      >
                        {def.label}
                      </button>
                    </li>
                  ))}
                </ul>
              )
            }
          </Dropdown>
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="text-xs text-content-tertiary">{labels.empty}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((row) => {
            const def = fieldDef(row.field);
            const error = touched[row.field] ? conditionError(row) : null;
            const inputId = `condition-filter-${def.field}`;
            const errorId = `${inputId}-error`;
            return (
              <li key={row.field} className="flex items-start gap-2">
                <label
                  htmlFor={inputId}
                  className="w-40 shrink-0 pt-1.5 text-xs text-content-secondary"
                >
                  {def.label}
                </label>
                <div className="flex-1">
                  {def.kind === 'select' ? (
                    <select
                      id={inputId}
                      value={row.value}
                      onChange={(event) => updateValue(row.field, event.target.value)}
                      onBlur={() => handleBlur(row.field)}
                      className="w-full rounded-md border border-border bg-inset px-2 py-1.5 text-sm outline-none"
                    >
                      {def.options!.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      id={inputId}
                      type={def.kind === 'date' ? 'date' : 'text'}
                      value={row.value}
                      placeholder={def.placeholder}
                      onChange={(event) => updateValue(row.field, event.target.value)}
                      onBlur={() => handleBlur(row.field)}
                      aria-invalid={error ? true : undefined}
                      aria-describedby={error ? errorId : undefined}
                      className="w-full rounded-md border border-border bg-inset px-2 py-1.5 text-sm outline-none placeholder:text-content-tertiary"
                    />
                  )}
                  <FieldError id={errorId} message={error} />
                </div>
                <button
                  type="button"
                  onClick={() => removeField(row.field)}
                  aria-label={labels.removeField(def.label)}
                  className="shrink-0 rounded-md px-1.5 py-1 text-2xs text-content-tertiary hover:text-danger"
                >
                  ✕
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
