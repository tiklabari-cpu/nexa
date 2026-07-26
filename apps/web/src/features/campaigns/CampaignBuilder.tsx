/**
 * The New / Edit campaign builder (FR-MOD-03.3.2/.3).
 *
 * A trigger and a message are both required — Submit stays disabled until they
 * are given, the same rule the server enforces (a campaign that could not target
 * or say anything is not saved). Scheduling is optional: leave the dates empty
 * and the campaign runs now; set a start in the future and it saves as scheduled.
 * Saving a running campaign fires it at the matching visitors, so the success
 * toast reports how many it reached.
 */
import { useMutation } from '@tanstack/react-query';
import { type ReactElement } from 'react';
import { Modal } from '../../components/ui/index.js';
import { ApiClientError, type ApiClient } from '../../lib/api-client.js';
import { FieldError, required, useForm } from '../../lib/form.js';
import { useCloseGuard } from '../../lib/dirty-guard.js';
import type { Campaign } from '@nexa/types';

/** An ISO instant as the `YYYY-MM-DDTHH:mm` a `datetime-local` input wants. */
function toDateTimeLocal(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** `YYYY-MM-DDTHH:mm` from the input back to an ISO instant, or null when blank. */
function fromDateTimeLocal(value: string): string | null {
  const trimmed = value.trim();
  return trimmed ? new Date(trimmed).toISOString() : null;
}

export function CampaignBuilder({
  campaign,
  api,
  onClose,
  onSaved,
}: {
  /** The campaign to edit, or null to create a new one. */
  campaign: Campaign | null;
  api: ApiClient;
  onClose: () => void;
  onSaved: (result: { campaign: Campaign; reached: number }) => void;
}): ReactElement {
  const save = useMutation({
    mutationFn: (body: unknown) =>
      campaign
        ? api.patch<Campaign>(`/campaigns/${campaign.id}`, body)
        : api.post<Campaign>('/campaigns', body),
  });

  const form = useForm({
    initial: {
      name: campaign?.name ?? '',
      url_contains: campaign?.conditions.url_contains ?? '',
      message: campaign?.content.message ?? '',
      starts_at: toDateTimeLocal(campaign?.starts_at ?? null),
      ends_at: toDateTimeLocal(campaign?.ends_at ?? null),
    },
    validators: {
      name: required('Give the campaign a name.'),
      url_contains: required('A campaign needs a trigger to know who to reach.'),
      message: required('A campaign needs a message to send.'),
    },
    onSubmit: async (values, { setFieldError, setSubmitError }) => {
      try {
        const saved = await save.mutateAsync({
          name: values.name,
          conditions: { url_contains: values.url_contains.trim() },
          content: { message: values.message.trim() },
          starts_at: fromDateTimeLocal(values.starts_at),
          ends_at: fromDateTimeLocal(values.ends_at),
        });
        // `performance.displayed` is how many it just reached; on an edit that
        // re-fires, only newly-matched visitors add to it.
        onSaved({ campaign: saved, reached: saved.performance.displayed });
      } catch (failure) {
        if (failure instanceof ApiClientError && failure.type === 'validation') {
          // The window check is the one field-specific server verdict worth pinning.
          if (failure.message.toLowerCase().includes('ends_at')) {
            setFieldError('ends_at', 'The end must be after the start.');
            return;
          }
          setSubmitError(failure.message);
          return;
        }
        setSubmitError('Could not save the campaign. Please try again.');
      }
    },
  });

  const close = useCloseGuard({
    isDirty: form.isDirty,
    message: 'Discard this campaign?',
    onClose,
  });

  const nameError = form.errorFor('name');
  const triggerError = form.errorFor('url_contains');
  const messageError = form.errorFor('message');
  const endsError = form.errorFor('ends_at');

  return (
    <Modal
      onClose={close}
      title={campaign ? 'Edit campaign' : 'New campaign'}
      description="Reach the visitors on a matching page with a proactive message."
      align="top"
    >
      <form onSubmit={form.handleSubmit} noValidate className="flex flex-col gap-3">
        {form.submitError && (
          <p role="alert" className="text-sm text-danger">
            {form.submitError}
          </p>
        )}

        <Field label="Name" htmlFor="campaign-name" error={nameError}>
          <input
            id="campaign-name"
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
          htmlFor="campaign-trigger"
          hint="e.g. /pricing — the message fires for visitors on a matching page."
          error={triggerError}
        >
          <input
            id="campaign-trigger"
            value={form.values.url_contains}
            onChange={(event) => form.setValue('url_contains', event.target.value)}
            onBlur={() => form.blur('url_contains')}
            aria-invalid={triggerError ? true : undefined}
            placeholder="/pricing"
            className="w-full rounded-md border border-border bg-inset px-3 py-2 text-sm"
          />
        </Field>

        <Field label="Message" htmlFor="campaign-message" error={messageError}>
          <textarea
            id="campaign-message"
            rows={3}
            value={form.values.message}
            onChange={(event) => form.setValue('message', event.target.value)}
            onBlur={() => form.blur('message')}
            aria-invalid={messageError ? true : undefined}
            placeholder="Hi there — can I help you find the right plan?"
            className="w-full rounded-md border border-border bg-inset px-3 py-2 text-sm"
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Starts (optional)" htmlFor="campaign-starts">
            <input
              id="campaign-starts"
              type="datetime-local"
              value={form.values.starts_at}
              onChange={(event) => form.setValue('starts_at', event.target.value)}
              className="w-full rounded-md border border-border bg-inset px-2 py-2 text-sm"
            />
          </Field>
          <Field label="Ends (optional)" htmlFor="campaign-ends" error={endsError}>
            <input
              id="campaign-ends"
              type="datetime-local"
              value={form.values.ends_at}
              onChange={(event) => form.setValue('ends_at', event.target.value)}
              onBlur={() => form.blur('ends_at')}
              aria-invalid={endsError ? true : undefined}
              className="w-full rounded-md border border-border bg-inset px-2 py-2 text-sm"
            />
          </Field>
        </div>

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
            {form.isSubmitting ? 'Saving…' : campaign ? 'Save changes' : 'Create campaign'}
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
