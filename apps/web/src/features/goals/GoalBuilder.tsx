/**
 * The New goal builder (FR-MOD-13.3, FR-EK-A.1).
 *
 * A goal is a name plus a trigger — one of the funnel's four predicates
 * (204.1): the visitor-page URL, a tracked sale, a captured lead, or a
 * resolved chat. Both name and trigger are required, and for the URL type
 * the trigger is the typed needle itself; for the other three, choosing the
 * type *is* the trigger — there is nothing further to fill in. The same
 * threshold the server enforces ("a goal needs something to match on") holds
 * Submit disabled here, so the two can never disagree. There is no edit form
 * in this slice (13.3-h) — creating and the active toggle on the list are
 * the whole write surface; an existing `url_contains` goal is unaffected by
 * this form, which only ever creates.
 */
import { useMutation } from '@tanstack/react-query';
import { useState, type ReactElement } from 'react';
import { Modal } from '../../components/ui/index.js';
import { errorMessageKey, type ApiClient } from '../../lib/api-client.js';
import { FieldError, required, useForm } from '../../lib/form.js';
import { useCloseGuard } from '../../lib/dirty-guard.js';
import { useTranslate } from '../../lib/i18n.js';
import {
  GOAL_TRIGGER_TYPES,
  GOAL_TRIGGER_TYPE_LABEL_KEY,
  buildGoalDefinition,
  type GoalTriggerType,
} from './goals.js';
import type { Goal } from '@nexa/types';

export function GoalBuilder({
  api,
  onClose,
  onSaved,
}: {
  api: ApiClient;
  onClose: () => void;
  onSaved: (goal: Goal) => void;
}): ReactElement {
  const t = useTranslate();
  const [type, setType] = useState<GoalTriggerType>('url_contains');
  const isUrlType = type === 'url_contains';
  const save = useMutation({
    mutationFn: (body: unknown) => api.post<Goal>('/goals', body),
  });

  const form = useForm({
    initial: { name: '', url_contains: '' },
    validators: {
      name: required(t('goals.builder.nameRequired')),
      // Only the URL type needs its own field filled in — for the other three,
      // picking the radio already sets the whole predicate, so nothing here can
      // be blank in a way the server would reject.
      url_contains: isUrlType ? required(t('goals.builder.triggerRequired')) : () => null,
    },
    onSubmit: async (values, { setSubmitError }) => {
      try {
        const saved = await save.mutateAsync({
          name: values.name,
          definition: buildGoalDefinition(type, values.url_contains),
        });
        onSaved(saved);
      } catch (failure) {
        setSubmitError(t(errorMessageKey(failure)));
      }
    },
  });

  const close = useCloseGuard({
    isDirty: form.isDirty || !isUrlType,
    message: t('goals.builder.discardConfirm'),
    onClose,
  });

  const nameError = form.errorFor('name');
  const triggerError = form.errorFor('url_contains');

  return (
    <Modal
      onClose={close}
      title={t('goals.builder.title')}
      description={t('goals.builder.description')}
      align="top"
    >
      <form onSubmit={form.handleSubmit} noValidate className="flex flex-col gap-3">
        {form.submitError && (
          <p role="alert" className="text-sm text-danger">
            {form.submitError}
          </p>
        )}

        <Field label={t('goals.builder.nameLabel')} htmlFor="goal-name" error={nameError}>
          <input
            id="goal-name"
            autoFocus
            value={form.values.name}
            onChange={(event) => form.setValue('name', event.target.value)}
            onBlur={() => form.blur('name')}
            aria-invalid={nameError ? true : undefined}
            className="w-full rounded-md border border-border bg-inset px-3 py-2 text-sm"
          />
        </Field>

        <fieldset className="flex flex-col gap-1.5 border-0 p-0">
          <legend className="mb-1 block text-sm font-medium">
            {t('goals.builder.typeLegend')}
          </legend>
          <div className="flex flex-wrap gap-2">
            {GOAL_TRIGGER_TYPES.map((option) => (
              <label
                key={option}
                className={`flex cursor-pointer items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-sm transition-colors ${
                  type === option
                    ? 'border-brand-500 bg-brand-100 text-content dark:bg-brand-950'
                    : 'border-border text-content-secondary hover:bg-surface-2'
                }`}
              >
                <input
                  type="radio"
                  name="goal-trigger-type"
                  checked={type === option}
                  onChange={() => setType(option)}
                  className="sr-only"
                />
                {t(GOAL_TRIGGER_TYPE_LABEL_KEY[option])}
              </label>
            ))}
          </div>
        </fieldset>

        {isUrlType && (
          <Field
            label={t('goals.builder.triggerLabel')}
            htmlFor="goal-trigger"
            hint={t('goals.builder.triggerHint')}
            error={triggerError}
          >
            <input
              id="goal-trigger"
              value={form.values.url_contains}
              onChange={(event) => form.setValue('url_contains', event.target.value)}
              onBlur={() => form.blur('url_contains')}
              aria-invalid={triggerError ? true : undefined}
              placeholder="/thank-you"
              className="w-full rounded-md border border-border bg-inset px-3 py-2 text-sm"
            />
          </Field>
        )}

        <div className="mt-2 flex justify-end gap-2">
          <button
            type="button"
            onClick={close}
            className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-content-secondary hover:bg-surface-2"
          >
            {t('goals.builder.cancel')}
          </button>
          <button
            type="submit"
            disabled={!form.canSubmit}
            className="rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {form.isSubmitting ? t('goals.builder.saving') : t('goals.builder.create')}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function Field({
  label,
  htmlFor,
  hint,
  error,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  error?: string | null;
  children: ReactElement;
}): ReactElement {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-1 block text-sm font-medium">
        {label}
      </label>
      {children}
      {hint && !error && <p className="mt-1 text-2xs text-content-tertiary">{hint}</p>}
      <FieldError id={`${htmlFor}-error`} message={error ?? null} />
    </div>
  );
}
