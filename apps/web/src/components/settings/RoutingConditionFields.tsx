/**
 * The condition inputs of a routing rule (AU-02 · tm 373): several page-URL
 * fragments, several exact page URLs, several countries — what the engine has
 * always accepted (`url_contains[]`, `url_equals[]`, `country_codes[]`) and the
 * form used to hide behind one text box.
 *
 * Both URL fields are "chip" inputs: type, press Enter (or "Add"), the value
 * becomes a removable chip. Text still sitting in the box when the form is
 * submitted counts too — see `RoutingRules.tsx` — so a rule with one URL is
 * still "type it, press Add rule".
 */
import { useMemo, type ReactElement } from 'react';
import { COUNTRY_CODES, countryName } from '../../lib/countries.js';
import { FieldError } from '../../lib/form.js';
import { useLocale, useTranslate } from '../../lib/i18n.js';

const INPUT =
  'rounded-md border border-border bg-inset px-2 py-1.5 text-sm outline-none placeholder:text-content-tertiary disabled:opacity-50';

function Chips({
  values,
  label,
  onRemove,
}: {
  values: readonly string[];
  label: (value: string) => string;
  onRemove: (value: string) => void;
}): ReactElement | null {
  const t = useTranslate();
  if (values.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-1">
      {values.map((value) => (
        <li
          key={value}
          className="flex items-center gap-1 rounded-sm bg-inset px-1.5 py-0.5 text-2xs text-content-secondary"
        >
          <span className="max-w-64 truncate">{label(value)}</span>
          <button
            type="button"
            aria-label={t('settings.routing.form.removeValue', { value: label(value) })}
            onClick={() => onRemove(value)}
            className="rounded-sm px-0.5 text-content-tertiary hover:text-content-primary"
          >
            ×
          </button>
        </li>
      ))}
    </ul>
  );
}

export function ChipInput({
  id,
  label,
  values,
  draft,
  placeholder,
  disabled,
  error,
  onValues,
  onDraft,
  onBlur,
}: {
  id: string;
  label: string;
  values: readonly string[];
  draft: string;
  placeholder: string;
  disabled?: boolean;
  error?: string | null | undefined;
  onValues: (next: string[]) => void;
  onDraft: (next: string) => void;
  onBlur?: () => void;
}): ReactElement {
  const t = useTranslate();

  const commit = (): void => {
    const value = draft.trim();
    if (!value) return;
    onDraft('');
    if (!values.includes(value)) onValues([...values, value]);
  };

  return (
    <div className="flex min-w-48 flex-1 flex-col gap-1">
      <label htmlFor={id} className="flex flex-col gap-1">
        <span className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
          {label}
        </span>
        <span className="flex gap-1">
          <input
            id={id}
            value={draft}
            onChange={(event) => onDraft(event.target.value)}
            onBlur={onBlur}
            onKeyDown={(event) => {
              // Enter adds a value; it must not submit the form half-filled.
              if (event.key === 'Enter') {
                event.preventDefault();
                commit();
              }
            }}
            disabled={disabled}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${id}-error` : undefined}
            placeholder={placeholder}
            maxLength={2048}
            className={`${INPUT} min-w-0 flex-1`}
          />
          <button
            type="button"
            disabled={disabled || draft.trim() === ''}
            onClick={commit}
            className="rounded-md border border-border px-2 py-1 text-2xs text-content-secondary transition-colors hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {t('settings.routing.form.addValue')}
          </button>
        </span>
      </label>
      <Chips
        values={values}
        label={(value) => value}
        onRemove={(value) => onValues(values.filter((v) => v !== value))}
      />
      <FieldError id={`${id}-error`} message={error ?? null} />
    </div>
  );
}

export function CountryPicker({
  id,
  label,
  values,
  disabled,
  onValues,
}: {
  id: string;
  label: string;
  values: readonly string[];
  disabled?: boolean;
  onValues: (next: string[]) => void;
}): ReactElement {
  const t = useTranslate();
  const { locale } = useLocale();

  // Sorted by the name in the UI language, not by code: "Türkiye" is not
  // found under "TR" by someone scanning a list.
  const options = useMemo(
    () =>
      COUNTRY_CODES.map((code) => ({ code, name: countryName(code, locale) })).sort((a, b) =>
        a.name.localeCompare(b.name, locale),
      ),
    [locale],
  );
  const nameOf = (code: string): string => {
    const known = options.find((option) => option.code === code);
    return known ? `${known.name} (${code})` : code;
  };

  return (
    <div className="flex min-w-48 flex-1 flex-col gap-1">
      <label htmlFor={id} className="flex flex-col gap-1">
        <span className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
          {label}
        </span>
        <select
          id={id}
          value=""
          disabled={disabled}
          onChange={(event) => {
            const code = event.target.value;
            if (code && !values.includes(code)) onValues([...values, code]);
          }}
          className={INPUT}
        >
          <option value="">{t('settings.routing.form.countryPlaceholder')}</option>
          {options
            .filter((option) => !values.includes(option.code))
            .map((option) => (
              <option key={option.code} value={option.code}>
                {option.name} ({option.code})
              </option>
            ))}
        </select>
      </label>
      <Chips
        values={values}
        label={nameOf}
        onRemove={(code) => onValues(values.filter((v) => v !== code))}
      />
    </div>
  );
}
