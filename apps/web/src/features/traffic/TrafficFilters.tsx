/**
 * "Match all filters" — the traffic board's condition panel (FR-MOD-13.2,
 * 13.2-h). "Add filter" offers whichever of 13.2-f's six fields is not
 * already in the list; each row can be edited or removed on its own, and
 * "Clear" drops them all at once.
 *
 * State lives here as a local, uncontrolled list (`rows`) — exactly the
 * `CustomersPage` search-box shape (immediate value, debounced commit) but
 * per row and per field kind: a `select` commits the moment it changes (no
 * continuous typing to wait out), a `text` field commits 250ms after the
 * last keystroke. A row is never reported upward — the query never fires,
 * the URL never changes — while it fails its own validator (FR-EK-A.1): the
 * caller's `onChange` is only ever called with an already-valid list, so a
 * still-invalid edit simply cannot reach a request.
 */
import { useEffect, useRef, useState, type ReactElement } from 'react';
import { Dropdown } from '../../components/ui/index.js';
import { FieldError } from '../../lib/form.js';
import {
  availableFields,
  conditionError,
  conditionsAreValid,
  fieldDef,
  newCondition,
  type TrafficCondition,
  type TrafficConditionField,
} from './traffic-filters.js';

const TEXT_COMMIT_DELAY_MS = 250;

interface TrafficFiltersProps {
  /** The panel's condition list at mount — from the URL, so a reload restores it. */
  initialConditions: readonly TrafficCondition[];
  /** Called with the full list, but only once every condition in it is valid. */
  onChange: (conditions: TrafficCondition[]) => void;
}

export function TrafficFilters({ initialConditions, onChange }: TrafficFiltersProps): ReactElement {
  const [rows, setRows] = useState<TrafficCondition[]>(() => [...initialConditions]);
  const [touched, setTouched] = useState<Partial<Record<TrafficConditionField, boolean>>>({});
  const timers = useRef<Partial<Record<TrafficConditionField, ReturnType<typeof setTimeout>>>>({});

  // Pending debounce timers belong to this component instance only.
  useEffect(() => {
    return () => {
      for (const timer of Object.values(timers.current)) if (timer) clearTimeout(timer);
    };
  }, []);

  function commit(next: TrafficCondition[]): void {
    if (conditionsAreValid(next)) onChange(next);
  }

  function clearTimer(field: TrafficConditionField): void {
    const timer = timers.current[field];
    if (timer) clearTimeout(timer);
    delete timers.current[field];
  }

  function addField(field: TrafficConditionField): void {
    const next = [...rows, newCondition(field)];
    setRows(next);
    commit(next);
  }

  function removeField(field: TrafficConditionField): void {
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
    for (const field of Object.keys(timers.current) as TrafficConditionField[]) clearTimer(field);
    setRows([]);
    setTouched({});
    onChange([]);
  }

  function updateValue(field: TrafficConditionField, value: string): void {
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

  function handleBlur(field: TrafficConditionField): void {
    setTouched((current) => (current[field] ? current : { ...current, [field]: true }));
  }

  const addable = availableFields(rows);

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border bg-surface p-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Match all filters</h2>
        <div className="flex items-center gap-2">
          {rows.length > 0 && (
            <button
              type="button"
              onClick={clearAll}
              className="rounded-md px-2 py-1 text-xs font-medium text-content-tertiary hover:text-content"
            >
              Clear
            </button>
          )}
          <Dropdown
            label="Add filter"
            trigger="+ Add filter"
            triggerClassName="rounded-md border border-border bg-inset px-2.5 py-1.5 text-xs font-medium text-content-secondary transition-colors hover:text-content"
            panelClassName="right-0 top-full mt-1 w-56 p-1"
          >
            {({ close }) =>
              addable.length === 0 ? (
                <p className="px-2 py-1.5 text-xs text-content-tertiary">Every filter is already applied.</p>
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
        <p className="text-xs text-content-tertiary">No filters applied — every visitor is shown.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((row) => {
            const def = fieldDef(row.field);
            const error = touched[row.field] ? conditionError(row) : null;
            const inputId = `traffic-filter-${row.field}`;
            const errorId = `${inputId}-error`;
            return (
              <li key={row.field} className="flex items-start gap-2">
                <label htmlFor={inputId} className="w-40 shrink-0 pt-1.5 text-xs text-content-secondary">
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
                      type="text"
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
                  aria-label={`Remove ${def.label} filter`}
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
