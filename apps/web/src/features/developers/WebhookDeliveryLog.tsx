/**
 * The delivery log of one webhook — KN-03 (tm 375).
 *
 * `webhook_deliveries` has been written since the dispatcher existed and was
 * shown nowhere: a developer whose receiver "never got it" could not see
 * whether the platform tried, what the receiver answered, or why it stopped.
 * This is that table, opened from a webhook's row as a slide-over, with the
 * three things you want next to it:
 *
 *   * **Redeliver** — sends a queued or exhausted attempt again through the
 *     server's normal, guarded sender; the new attempt lands at the top of the
 *     table. Offered only where the server says `can_redeliver` (a delivered
 *     body is not kept; an exhausted one is kept 72 hours).
 *   * **Send test event** — a signed ping, so a receiver can be checked before
 *     any real event reaches it. Shown as a test row, never retried.
 *   * the state filter, and "Load more" (the log is read newest-first, a page at
 *     a time — a busy webhook's history is not one response).
 *
 * The error column shows the server's cleaned text as it is (`http_503`,
 * `ssrf_blocked`): it is already stripped of secrets, URLs and bodies there,
 * and this screen does not second-guess it. Whether the signed-in person may
 * redeliver or test is the caller's `canEdit` (scope `webhooks--all:rw`); the
 * server enforces it regardless.
 */
import { useState, type ReactElement } from 'react';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { EmptyState } from '../../components/EmptyState.js';
import { LoadError } from '../../components/LoadError.js';
import { StatusDot, type StatusTone } from '../../components/StatusDot.js';
import { Modal } from '../../components/ui/index.js';
import { errorMessageKey } from '../../lib/api-client.js';
import { useApiClient } from '../../lib/auth-store.js';
import { formatDateTime } from '../../lib/format.js';
import { useTranslate } from '../../lib/i18n.js';
import { reasonMessage } from '../../lib/reason-message.js';

export const DELIVERY_STATES = ['pending', 'delivered', 'failed', 'exhausted'] as const;
export type DeliveryState = (typeof DELIVERY_STATES)[number];

export interface WebhookDelivery {
  id: string;
  event_id: string | null;
  action: string;
  attempt: number;
  state: DeliveryState;
  ok: boolean;
  status_code: number | null;
  error: string | null;
  test: boolean;
  created_at: string;
  next_attempt_at: string | null;
  can_redeliver: boolean;
}

interface DeliveryPage {
  items: WebhookDelivery[];
  next_cursor: string | null;
}

const TONE: Record<DeliveryState, StatusTone> = {
  delivered: 'success',
  pending: 'info',
  failed: 'warning',
  exhausted: 'danger',
};

const PAGE_SIZE = 25;

export function deliveriesKey(webhookId: string, state: DeliveryState | ''): readonly unknown[] {
  return ['developers', 'webhooks', webhookId, 'deliveries', state];
}

export function WebhookDeliveryLog({
  webhook,
  canEdit,
  eventLabel,
  onClose,
}: {
  webhook: { id: string; url: string; action: string; enabled: boolean };
  canEdit: boolean;
  /** The webhook's event in the console's words (the manifest label). */
  eventLabel: (action: string) => string;
  onClose: () => void;
}): ReactElement {
  const api = useApiClient();
  const t = useTranslate();
  const queryClient = useQueryClient();
  const [state, setState] = useState<DeliveryState | ''>('');
  const [notice, setNotice] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);

  const list = useInfiniteQuery({
    queryKey: deliveriesKey(webhook.id, state),
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
      if (state) params.set('state', state);
      if (pageParam) params.set('cursor', pageParam);
      return api.get<DeliveryPage>(`/webhooks/${webhook.id}/deliveries?${params.toString()}`);
    },
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next_cursor,
  });

  const refresh = (): Promise<void> =>
    queryClient.invalidateQueries({ queryKey: ['developers', 'webhooks', webhook.id] });

  const redeliver = useMutation({
    mutationFn: (delivery: WebhookDelivery) =>
      api.post<WebhookDelivery>(`/webhooks/${webhook.id}/deliveries/${delivery.id}/redeliver`),
    onSuccess: async (attempt) => {
      setNotice(outcomeNotice(attempt, 'redeliver'));
      await refresh();
    },
    onError: (error) => {
      setNotice({
        tone: 'bad',
        text:
          reasonMessage(t, error, 'apps.developers.webhooks.deliveries.reason') ??
          t(errorMessageKey(error)),
      });
    },
  });

  const sendTest = useMutation({
    mutationFn: () => api.post<WebhookDelivery>(`/webhooks/${webhook.id}/test`),
    onSuccess: async (attempt) => {
      setNotice(outcomeNotice(attempt, 'test'));
      await refresh();
    },
    onError: (error) => setNotice({ tone: 'bad', text: t(errorMessageKey(error)) }),
  });

  function outcomeNotice(
    attempt: WebhookDelivery,
    kind: 'redeliver' | 'test',
  ): { tone: 'ok' | 'bad'; text: string } {
    if (attempt.ok) {
      return {
        tone: 'ok',
        text: t(`apps.developers.webhooks.deliveries.${kind}.ok`, {
          status: attempt.status_code ?? '—',
        }),
      };
    }
    return {
      tone: 'bad',
      text: t(`apps.developers.webhooks.deliveries.${kind}.failed`, {
        reason: attempt.status_code
          ? `HTTP ${attempt.status_code}`
          : (attempt.error ?? t('apps.developers.webhooks.deliveries.noAnswer')),
      }),
    };
  }

  const rows = list.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <Modal
      onClose={onClose}
      dock="right"
      title={t('apps.developers.webhooks.deliveries.title')}
      description={
        <span className="flex flex-wrap items-center gap-x-2">
          <code className="break-all text-2xs">{webhook.url}</code>
          <span className="rounded-sm bg-inset px-1.5 py-0.5 text-2xs">
            {eventLabel(webhook.action)}
          </span>
        </span>
      }
      className="w-[48rem] max-w-full"
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <label htmlFor="delivery-state" className="flex flex-col gap-1">
            <span className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
              {t('apps.developers.webhooks.deliveries.filterLabel')}
            </span>
            <select
              id="delivery-state"
              value={state}
              onChange={(event) => {
                setNotice(null);
                setState(event.target.value as DeliveryState | '');
              }}
              className="rounded-md border border-border bg-inset px-2 py-1.5 text-sm outline-none"
            >
              <option value="">{t('apps.developers.webhooks.deliveries.stateAll')}</option>
              {DELIVERY_STATES.map((value) => (
                <option key={value} value={value}>
                  {t(`apps.developers.webhooks.deliveries.state.${value}`)}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={() => void list.refetch()}
            className="rounded-md border border-border px-3 py-1.5 text-sm"
          >
            {t('apps.developers.webhooks.deliveries.refresh')}
          </button>
          {canEdit && (
            <button
              type="button"
              disabled={sendTest.isPending}
              onClick={() => {
                setNotice(null);
                sendTest.mutate();
              }}
              className="rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-50"
            >
              {sendTest.isPending
                ? t('apps.developers.webhooks.deliveries.testing')
                : t('apps.developers.webhooks.deliveries.test')}
            </button>
          )}
        </div>

        {notice && (
          <p
            role={notice.tone === 'bad' ? 'alert' : 'status'}
            className={`text-2xs ${notice.tone === 'bad' ? 'text-danger' : 'text-success'}`}
          >
            {notice.text}
          </p>
        )}

        {list.isPending ? (
          <p className="p-4 text-sm text-content-secondary">{t('apps.common.loading')}</p>
        ) : list.error ? (
          <LoadError
            title={t('apps.developers.webhooks.deliveries.loadError')}
            error={list.error}
            onRetry={() => void list.refetch()}
          />
        ) : rows.length === 0 ? (
          <EmptyState
            title={t('apps.developers.webhooks.deliveries.emptyTitle')}
            description={t('apps.developers.webhooks.deliveries.emptyDescription')}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-2xs">
              <caption className="sr-only">
                {t('apps.developers.webhooks.deliveries.title')}
              </caption>
              <thead className="text-content-tertiary">
                <tr>
                  <th scope="col" className="px-2 py-1.5 font-medium">
                    {t('apps.developers.webhooks.deliveries.col.time')}
                  </th>
                  <th scope="col" className="px-2 py-1.5 font-medium">
                    {t('apps.developers.webhooks.deliveries.col.event')}
                  </th>
                  <th scope="col" className="px-2 py-1.5 font-medium">
                    {t('apps.developers.webhooks.deliveries.col.attempt')}
                  </th>
                  <th scope="col" className="px-2 py-1.5 font-medium">
                    {t('apps.developers.webhooks.deliveries.col.status')}
                  </th>
                  <th scope="col" className="px-2 py-1.5 font-medium">
                    {t('apps.developers.webhooks.deliveries.col.http')}
                  </th>
                  <th scope="col" className="px-2 py-1.5 font-medium">
                    {t('apps.developers.webhooks.deliveries.col.error')}
                  </th>
                  <th scope="col" className="px-2 py-1.5 font-medium">
                    <span className="sr-only">
                      {t('apps.developers.webhooks.deliveries.col.actions')}
                    </span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((row) => (
                  <tr key={row.id} data-testid={`delivery-${row.id}`} className="align-top">
                    <td className="whitespace-nowrap px-2 py-2">
                      {formatDateTime(row.created_at)}
                    </td>
                    <td className="px-2 py-2">
                      <span className="rounded-sm bg-inset px-1.5 py-0.5">
                        {row.test
                          ? t('apps.developers.webhooks.deliveries.testRow')
                          : eventLabel(row.action)}
                      </span>
                    </td>
                    <td className="px-2 py-2">{row.attempt}</td>
                    <td className="px-2 py-2">
                      <StatusDot
                        tone={TONE[row.state]}
                        label={t(`apps.developers.webhooks.deliveries.state.${row.state}`)}
                      />
                      {row.state === 'pending' && row.next_attempt_at && (
                        <div className="text-content-tertiary">
                          {t('apps.developers.webhooks.deliveries.nextTry', {
                            at: formatDateTime(row.next_attempt_at) ?? '',
                          })}
                        </div>
                      )}
                    </td>
                    <td className="px-2 py-2 font-mono">{row.status_code ?? '—'}</td>
                    <td className="max-w-56 break-words px-2 py-2 font-mono text-content-secondary">
                      {row.error ?? '—'}
                    </td>
                    <td className="px-2 py-2 text-right">
                      {canEdit && row.can_redeliver && (
                        <button
                          type="button"
                          disabled={redeliver.isPending}
                          onClick={() => {
                            setNotice(null);
                            redeliver.mutate(row);
                          }}
                          aria-label={t('apps.developers.webhooks.deliveries.redeliverFor', {
                            time: formatDateTime(row.created_at) ?? '',
                          })}
                          className="rounded-md border border-border px-2 py-1 text-2xs transition-colors hover:bg-surface-2 disabled:opacity-50"
                        >
                          {t('apps.developers.webhooks.deliveries.redeliver')}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {list.hasNextPage && (
          <button
            type="button"
            disabled={list.isFetchingNextPage}
            onClick={() => void list.fetchNextPage()}
            className="self-start rounded-md border border-border px-3 py-1.5 text-sm disabled:opacity-50"
          >
            {t('apps.developers.webhooks.deliveries.more')}
          </button>
        )}

        <div className="mt-1 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-border px-3 py-1.5 text-sm"
          >
            {t('apps.common.done')}
          </button>
        </div>
      </div>
    </Modal>
  );
}
