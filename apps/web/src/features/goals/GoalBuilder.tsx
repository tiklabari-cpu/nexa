/**
 * The New goal builder (FR-MOD-13.3, FR-EK-A.1).
 *
 * A goal is a name plus a trigger — the visitor-page URL a conversion is
 * defined by. Both are required: the server rejects a definition with
 * nothing to match on ("a goal needs something to match on"), and the same
 * rule holds Submit disabled here so the two can never disagree. There is no
 * edit form in this slice (13.3-h) — creating and the active toggle on the
 * list are the whole write surface.
 */
import { useMutation } from '@tanstack/react-query';
import { type ReactElement } from 'react';
import { Modal } from '../../components/ui/index.js';
import { ApiClientError, type ApiClient } from '../../lib/api-client.js';
import { FieldError, required, useForm } from '../../lib/form.js';
import { useCloseGuard } from '../../lib/dirty-guard.js';
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
  const save = useMutation({
    mutationFn: (body: unknown) => api.post<Goal>('/goals', body),
  });

  const form = useForm({
    initial: { name: '', url_contains: '' },
    validators: {
      name: required('Give the goal a name.'),
      url_contains: required('A goal needs a trigger to know what counts as a conversion.'),
    },
    onSubmit: async (values, { setSubmitError }) => {
      try {
        const saved = await save.mutateAsync({
          name: values.name,
          definition: { url_contains: values.url_contains.trim() },
        });
        onSaved(saved);
      } catch (failure) {
        if (failure instanceof ApiClientError && failure.type === 'validation') {
          setSubmitError(failure.message);
          return;
        }
        setSubmitError('Could not save the goal. Please try again.');
      }
    },
  });

  const close = useCloseGuard({
    isDirty: form.isDirty,
    message: 'Discard this goal?',
    onClose,
  });

  const nameError = form.errorFor('name');
  const triggerError = form.errorFor('url_contains');

  return (
    <Modal
      onClose={close}
      title="New goal"
      description="Define a page a visitor reaching it counts as a conversion."
      align="top"
    >
      <form onSubmit={form.handleSubmit} noValidate className="flex flex-col gap-3">
        {form.submitError && (
          <p role="alert" className="text-sm text-danger">
            {form.submitError}
          </p>
        )}

        <Field label="Name" htmlFor="goal-name" error={nameError}>
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

        <Field
          label="Trigger — page URL contains"
          htmlFor="goal-trigger"
          hint="e.g. /thank-you — a visitor reaching a matching page has converted."
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

        <div className="mt-2 flex justify-end gap-2">
          <button
            type="button"
            onClick={close}
            className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-content-secondary hover:bg-surface-2"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!form.canSubmit}
            className="rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {form.isSubmitting ? 'Saving…' : 'Create goal'}
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
