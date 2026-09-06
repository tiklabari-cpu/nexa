/**
 * The visitor 360° panel (FR-MOD-13.2), opened in place from a Traffic row.
 *
 * 203.1 rendered the first cut: identity, visit count, "came from" and the
 * teams this visitor's conversations have been routed to. This slice (203.2)
 * adds the PRD's remaining two fields — visited pages and pre-chat form
 * answers — both already present on `GET /customers/:id`.
 *
 * Visited pages read `visit.pages` sanitised server-side by the same
 * `visitedPagesOf` the Inbox Details visitor uses (`chat-service.ts`) — one
 * reader for the free-form jsonb column, so the two panels cannot show
 * different pages for the same visit, and a manually edited row cannot crash
 * either one. Pre-chat form answers are `custom_fields` narrowed to
 * `form_placement === 'pre_chat'` with a value — a plain CRM field or an
 * unanswered question is not "what the visitor said before the chat started".
 *
 * Two honesty rules the row action's caller (`TrafficPage`) hands in rather
 * than this file deciding on its own:
 *  - `canViewPii` — without the customers write scope, name and email are
 *    withheld rather than the panel refusing to open at all. Visit count,
 *    "came from" and group names are not treated as PII here (unlike name/
 *    email they do not identify the person on their own) and stay visible,
 *    so a supervising agent who cannot edit contacts still gets the
 *    situational awareness the board itself is for.
 *  - `stillOnBoard` — the board polls; a visitor already open in the panel
 *    can drop off the next refresh (chat closed, visit aged out). Rather than
 *    silently going blank, the panel says so and keeps showing what it
 *    already loaded.
 */
import { useQuery } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { CardSkeleton } from '../../components/Page.js';
import { StatusDot } from '../../components/StatusDot.js';
import { Modal } from '../../components/ui/Modal.js';
import { useApiClient } from '../../lib/auth-store.js';
import { formatDate } from '../../lib/format.js';
import { useTranslate } from '../../lib/i18n.js';
import type { CustomerDetail } from '../customers/types.js';

interface Props {
  customerId: string;
  canViewPii: boolean;
  stillOnBoard: boolean;
  onClose: () => void;
}

export function VisitorPanel({
  customerId,
  canViewPii,
  stillOnBoard,
  onClose,
}: Props): ReactElement {
  const t = useTranslate();
  const api = useApiClient();

  // Same query key `CustomerDetailPanel` uses for the identical endpoint — a
  // visitor already loaded on the Customers page (or vice versa) is served
  // from cache rather than fetched twice.
  const detail = useQuery({
    queryKey: ['customers', 'detail', customerId],
    queryFn: () => api.get<CustomerDetail>(`/customers/${customerId}`),
  });

  const customer = detail.data;
  const title = canViewPii
    ? (customer?.name ?? t('customers.detail.unnamedVisitor'))
    : t('traffic.panel.hiddenName');
  // A plain CRM field or an unanswered question is not "what the visitor said
  // before the chat started" — only an answered pre-chat field qualifies.
  const preChatAnswers = (customer?.custom_fields ?? []).filter(
    (field) => field.form_placement === 'pre_chat' && field.value !== null,
  );

  return (
    <Modal onClose={onClose} dock="right" title={title}>
      {!stillOnBoard && (
        <p className="mb-3 rounded-md bg-inset px-3 py-2 text-2xs text-content-secondary">
          {t('traffic.panel.offBoard')}
        </p>
      )}

      {detail.isPending ? (
        <CardSkeleton rows={4} />
      ) : detail.error || !customer ? (
        <p role="alert" className="text-sm text-danger">
          {t('customers.detail.loadError')}
        </p>
      ) : (
        <div className="flex flex-col gap-4 text-sm">
          {canViewPii ? (
            <p className="truncate text-content-secondary">
              {customer.email ?? t('traffic.page.noContactDetails')}
            </p>
          ) : (
            <p className="text-content-secondary">{t('traffic.panel.piiHidden')}</p>
          )}

          {preChatAnswers.length > 0 && (
            <div>
              <h3 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-content-tertiary">
                {t('traffic.panel.preChatForm')}
              </h3>
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5">
                {preChatAnswers.map((field) => (
                  <div key={field.definition_id} className="contents">
                    <dt className="text-content-secondary">{field.label}</dt>
                    <dd className="truncate text-right" title={field.value ?? undefined}>
                      {field.value}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          )}

          <dl className="grid grid-cols-2 gap-x-3 gap-y-2">
            <dt className="text-content-secondary">{t('customers.detail.visits')}</dt>
            <dd className="flex items-center justify-end gap-1.5">
              <span className="tabular">{customer.visits_count}</span>
              {customer.visits_count > 1 && (
                <StatusDot tone="info" label={t('customers.detail.returningVisitor')} />
              )}
            </dd>
          </dl>

          {customer.visits[0]?.came_from && (
            // Visitor-supplied, rendered as text, never as a link — same
            // reasoning as `CustomerDetailPanel`'s visit history.
            <p
              className="truncate text-2xs text-content-tertiary"
              title={customer.visits[0].came_from}
            >
              {t('customers.detail.cameFrom', { source: customer.visits[0].came_from })}
            </p>
          )}

          <div>
            <h3 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-content-tertiary">
              {t('customers.detail.groups')}
            </h3>
            {customer.groups.length === 0 ? (
              <p className="text-content-secondary">{t('customers.detail.noGroups')}</p>
            ) : (
              <ul className="flex flex-col gap-1">
                {customer.groups.map((group) => (
                  <li key={group.id}>{group.name}</li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <h3 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-content-tertiary">
              {t('customers.detail.visitedPages')}
            </h3>
            {customer.visits.length === 0 ? (
              <p className="text-content-secondary">{t('customers.detail.noVisits')}</p>
            ) : (
              <ul className="flex flex-col gap-2.5">
                {customer.visits.map((visit) => (
                  <li key={visit.id}>
                    <p className="text-2xs text-content-tertiary">{formatDate(visit.started_at)}</p>
                    {visit.pages.length === 0 ? (
                      <p className="text-xs text-content-secondary">
                        {t('traffic.panel.noPagesForVisit')}
                      </p>
                    ) : (
                      <ul className="mt-0.5 flex flex-col gap-0.5">
                        {visit.pages.map((page, index) => (
                          <li
                            key={`${visit.id}-${index}`}
                            // Visitor-supplied URLs are rendered as text, never
                            // as a link — same reasoning as "came from" above.
                            className="truncate text-xs text-content-secondary"
                            title={page.url}
                          >
                            {page.url}
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
