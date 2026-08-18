/**
 * The custom fields for one ticket or contact (FR-MOD-08.7.6), shown on the
 * Details pane and in the CRM.
 *
 * It renders one control per defined field, typed to the definition — a
 * checkbox-like true/false for a boolean, a date picker for a date, a number
 * input for a number — and validates each value against its definition with the
 * same rule the server enforces (`customFieldError` from `@nexa/types`), so a
 * bad value shows a field-under error and keeps Save disabled rather than
 * round-tripping to a 400. Save sends only what changed; a cleared field is an
 * explicit null. When nothing is defined for the entity it renders nothing.
 *
 * The component owns the draft and validation; the parent owns persistence and
 * cache handling, passed in as `save`, because a ticket and a contact invalidate
 * different queries.
 */
import { useEffect, useMemo, useState, type FormEvent, type ReactElement } from 'react';
import { customFieldError, type CustomFieldValue } from '@nexa/types';
import { errorMessageKey } from '../../lib/api-client.js';
import { useTranslate } from '../../lib/i18n.js';

interface Props {
  fields: CustomFieldValue[];
  canEdit: boolean;
  /** Persist the changed values (definition id → value, null clears). */
  save: (values: Record<string, string | null>) => Promise<void>;
}

export function CustomFields({ fields, canEdit, save }: Props): ReactElement | null {
  const t = useTranslate();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-seed the drafts whenever the field set or any stored value changes — a
  // refetch after saving, or switching to another ticket/contact, must not keep
  // a stale draft. The key changes only when something the form cares about does.
  const seedKey = fields.map((field) => `${field.definition_id}:${field.value ?? ''}`).join('|');
  useEffect(() => {
    setDrafts(Object.fromEntries(fields.map((field) => [field.definition_id, field.value ?? ''])));
    setError(null);
  }, [seedKey]);

  const errorFor = useMemo(() => {
    const map = new Map<string, string | null>();
    for (const field of fields) {
      map.set(
        field.definition_id,
        canEdit ? customFieldError(field, drafts[field.definition_id] ?? '') : null,
      );
    }
    return map;
  }, [fields, drafts, canEdit]);

  if (fields.length === 0) return null;

  const hasError = [...errorFor.values()].some(Boolean);
  const dirty = fields.some(
    (field) => (drafts[field.definition_id] ?? '').trim() !== (field.value ?? ''),
  );

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!dirty || hasError || saving) return;

    const changes: Record<string, string | null> = {};
    for (const field of fields) {
      const draft = (drafts[field.definition_id] ?? '').trim();
      const current = field.value ?? '';
      if (draft !== current) changes[field.definition_id] = draft === '' ? null : draft;
    }

    setSaving(true);
    setError(null);
    try {
      await save(changes);
    } catch (cause) {
      setError(t(errorMessageKey(cause)));
    } finally {
      setSaving(false);
    }
  }

  if (!canEdit) {
    return (
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-sm">
        {fields.map((field) => (
          <FragmentRow key={field.definition_id} label={field.label}>
            {field.value ?? '—'}
          </FragmentRow>
        ))}
      </dl>
    );
  }

  return (
    <form onSubmit={(event) => void submit(event)} noValidate className="flex flex-col gap-2.5">
      {fields.map((field) => {
        const id = `cf-${field.definition_id}`;
        const message = errorFor.get(field.definition_id) ?? null;
        const value = drafts[field.definition_id] ?? '';
        const set = (next: string): void =>
          setDrafts((current) => ({ ...current, [field.definition_id]: next }));

        return (
          <label key={field.definition_id} htmlFor={id} className="flex flex-col gap-1">
            <span className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
              {field.label}
              {field.required && (
                <span aria-hidden="true" className="text-danger">
                  {' '}
                  *
                </span>
              )}
            </span>

            {field.type === 'boolean' ? (
              <select
                id={id}
                value={value}
                onChange={(event) => set(event.target.value)}
                className="rounded-md border border-border bg-inset px-2 py-1.5 text-sm outline-none"
              >
                {!field.required && <option value="">—</option>}
                <option value="true">{t('customFields.booleanYes')}</option>
                <option value="false">{t('customFields.booleanNo')}</option>
              </select>
            ) : (
              <input
                id={id}
                type={field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text'}
                value={value}
                onChange={(event) => set(event.target.value)}
                aria-invalid={message ? true : undefined}
                aria-describedby={message ? `${id}-error` : undefined}
                maxLength={field.type === 'text' ? 5000 : undefined}
                className="rounded-md border border-border bg-inset px-2 py-1.5 text-sm outline-none"
              />
            )}

            {message && (
              <p id={`${id}-error`} role="alert" className="text-2xs text-danger">
                {message}
              </p>
            )}
          </label>
        );
      })}

      {error && (
        <p role="alert" className="text-2xs text-danger">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={!dirty || hasError || saving}
        className="mt-0.5 self-start rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-50"
      >
        {saving ? t('customFields.saving') : t('customFields.save')}
      </button>
    </form>
  );
}

function FragmentRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): ReactElement {
  return (
    <>
      <dt className="text-content-secondary">{label}</dt>
      <dd className="truncate">{children}</dd>
    </>
  );
}
