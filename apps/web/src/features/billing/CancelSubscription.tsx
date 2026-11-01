/**
 * Cancelling the subscription (tm 384 · BL-03) — the Billing page's last
 * section.
 *
 * Three states, read from `GET /billing/subscription`'s `cancellation`:
 *
 *   - **Running** — the owner sees "Cancel subscription": a dialog with the
 *     reason, what happens next (it ends with the period, read-only after,
 *     30 days to export, deletion by the retention setting, no refund) and the
 *     workspace's name typed as the confirmation.
 *   - **Cancelled, period still running** — when it ends and "Undo
 *     cancellation".
 *   - **Ended** — read-only until when, deleted when, and where to export
 *     (Reports and Archive).
 *
 * Only the owner changes it (K7): everyone else reads the state and gets no
 * buttons, the way the rest of the page works.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent, type ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { CANCEL_REASONS, type CancelReason } from '@siyahtus/types';
import { Card, Section } from '../../components/Page.js';
import { Banner, Modal } from '../../components/ui/index.js';
import { ApiClientError, errorMessageKey } from '../../lib/api-client.js';
import { useApiClient } from '../../lib/auth-store.js';
import { formatDate } from '../../lib/format.js';
import { useTranslate, type TFunction } from '../../lib/i18n.js';

export interface SubscriptionCancellation {
  scheduled: boolean;
  reason: string | null;
  requested_at: string | null;
  takes_effect_at: string | null;
  ended_at: string | null;
  export_until: string | null;
  data_deletion_at: string | null;
  can_cancel: boolean;
  can_resume: boolean;
  workspace_name: string;
}

/** The server's comparison: case and surrounding spaces do not matter. */
function sameName(typed: string, name: string): boolean {
  return typed.trim().toLocaleLowerCase('tr') === name.trim().toLocaleLowerCase('tr');
}

function errorText(t: TFunction, error: unknown): string {
  if (error instanceof ApiClientError) {
    const reason = (error.details as { reason?: unknown } | undefined)?.reason;
    if (reason === 'confirmation_mismatch') return t('billing.cancel.error.confirmation');
    if (reason === 'subscription_ended') return t('billing.cancel.error.ended');
    if (reason === 'no_subscription') return t('billing.cancel.error.noSubscription');
    return t(errorMessageKey(error));
  }
  return t('billing.cancel.error.generic');
}

export function CancelSubscriptionSection({
  cancellation,
  canManage,
}: {
  cancellation: SubscriptionCancellation;
  canManage: boolean;
}): ReactElement | null {
  const t = useTranslate();
  const api = useApiClient();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  const onView = (view: unknown) => {
    queryClient.setQueryData(['billing', 'subscription'], view);
    void queryClient.invalidateQueries({ queryKey: ['billing'] });
  };

  const resume = useMutation({
    mutationFn: () => api.post<unknown>('/billing/subscription/resume', {}),
    onSuccess: onView,
  });

  const day = (iso: string | null) => (iso ? (formatDate(iso) ?? iso) : '');

  if (cancellation.ended_at) {
    return (
      <Section title={t('billing.cancel.title')}>
        <Banner tone="warning" title={t('billing.cancel.ended.title')}>
          <p>{t('billing.cancel.ended.exportUntil', { date: day(cancellation.export_until) })}</p>
          <p className="mt-1">
            {cancellation.data_deletion_at
              ? t('billing.cancel.ended.deletionAt', { date: day(cancellation.data_deletion_at) })
              : t('billing.cancel.ended.kept')}
          </p>
          <p className="mt-2 flex flex-wrap gap-3" data-testid="cancel-export-links">
            <Link className="font-medium underline" to="/app/reports">
              {t('billing.cancel.ended.exportReports')}
            </Link>
            <Link className="font-medium underline" to="/app/archive">
              {t('billing.cancel.ended.exportArchive')}
            </Link>
          </p>
        </Banner>
      </Section>
    );
  }

  if (cancellation.scheduled) {
    return (
      <Section title={t('billing.cancel.title')}>
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-3 p-4">
            <p role="status" data-testid="cancel-scheduled" className="text-sm">
              {t('billing.cancel.scheduled', { date: day(cancellation.takes_effect_at) })}
            </p>
            {canManage && cancellation.can_resume && (
              <button
                type="button"
                onClick={() => resume.mutate()}
                disabled={resume.isPending}
                className="rounded-md bg-brand-500 px-3 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-60"
              >
                {t('billing.cancel.resume')}
              </button>
            )}
          </div>
          {resume.error && (
            <p role="alert" className="px-4 pb-4 text-2xs text-danger">
              {errorText(t, resume.error)}
            </p>
          )}
        </Card>
      </Section>
    );
  }

  if (!canManage || !cancellation.can_cancel) return null;

  return (
    <Section title={t('billing.cancel.title')} description={t('billing.cancel.description')}>
      <Card>
        <div className="p-4">
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="rounded-md border border-danger px-3 py-2 text-sm font-medium text-danger transition-colors hover:bg-danger/10"
          >
            {t('billing.cancel.open')}
          </button>
        </div>
      </Card>
      {open && (
        <CancelDialog
          workspaceName={cancellation.workspace_name}
          onClose={() => setOpen(false)}
          onDone={(view) => {
            onView(view);
            setOpen(false);
          }}
        />
      )}
    </Section>
  );
}

function CancelDialog({
  workspaceName,
  onClose,
  onDone,
}: {
  workspaceName: string;
  onClose: () => void;
  onDone: (view: unknown) => void;
}): ReactElement {
  const t = useTranslate();
  const api = useApiClient();
  const [reason, setReason] = useState<CancelReason | null>(null);
  const [confirmation, setConfirmation] = useState('');
  const cancel = useMutation({
    mutationFn: (body: { reason: CancelReason; confirmation: string }) =>
      api.post<unknown>('/billing/subscription/cancel', body),
    onSuccess: onDone,
  });
  const ready = reason !== null && sameName(confirmation, workspaceName);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!reason || !ready) return;
    cancel.mutate({ reason, confirmation });
  };

  return (
    <Modal onClose={onClose} title={t('billing.cancel.dialog.title')} className="max-w-lg">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <fieldset>
          <legend className="text-sm font-medium">{t('billing.cancel.dialog.reason')}</legend>
          <div className="mt-2 flex flex-col gap-1.5">
            {CANCEL_REASONS.map((id) => (
              <label key={id} className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="cancel-reason"
                  value={id}
                  checked={reason === id}
                  onChange={() => setReason(id)}
                />
                {t(`billing.cancel.reason.${id}`)}
              </label>
            ))}
          </div>
        </fieldset>

        <div>
          <p className="text-sm font-medium">{t('billing.cancel.dialog.consequences')}</p>
          <ul className="mt-1 list-disc pl-5 text-sm text-content-secondary">
            <li>{t('billing.cancel.dialog.untilPeriodEnd')}</li>
            <li>{t('billing.cancel.dialog.readOnly')}</li>
            <li>{t('billing.cancel.dialog.export')}</li>
            <li>{t('billing.cancel.dialog.deletion')}</li>
            <li>{t('billing.cancel.dialog.noRefund')}</li>
          </ul>
        </div>

        <label className="flex flex-col gap-1 text-sm">
          <span>{t('billing.cancel.dialog.confirm', { name: workspaceName })}</span>
          <input
            type="text"
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            autoComplete="off"
            className="rounded-md border border-border bg-surface px-3 py-2"
          />
        </label>

        {cancel.error && (
          <p role="alert" className="text-2xs text-danger">
            {errorText(t, cancel.error)}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-border px-3 py-2 text-sm font-medium"
          >
            {t('billing.cancel.dialog.keep')}
          </button>
          <button
            type="submit"
            disabled={!ready || cancel.isPending}
            className="rounded-md bg-danger px-3 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60"
          >
            {t('billing.cancel.dialog.submit')}
          </button>
        </div>
      </form>
    </Modal>
  );
}
