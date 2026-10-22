/**
 * Which other records this customer may be, and which an agent confirmed
 * (SiyahTuş analysis ID-03 · owner decision K4 · tm 287.4).
 *
 * A member on another device, or in a browser that lost its member token, is a
 * new customer: nothing a visitor types joins two records. What they typed is
 * still worth showing — another record with the same pre-chat username or
 * e-mail is a **possible match**, labelled unverified, for the agent to ask
 * about. A team lead or above (admin and above until RL-03 scopes a Team
 * Lead's controls to their teams) then links the two; the link joins this
 * view only, and the AI keeps answering each record from its own
 * conversations. Both are undoable, and both are audited server-side.
 *
 * "Forget this person's browsers" lives here too, beside the records it is
 * about: it refuses every member token this person's browsers hold, so each
 * starts again as a new visitor — the step after a link turns out to be wrong,
 * or after a shared computer.
 */
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { Card } from '../../components/Page.js';
import { StatusDot } from '../../components/StatusDot.js';
import { useConfirm } from '../../components/ui/ConfirmDialog.js';
import { errorMessageKey } from '../../lib/api-client.js';
import { useApiClient } from '../../lib/auth-store.js';
import { formatDate, formatDateTime } from '../../lib/format.js';
import { useTranslate } from '../../lib/i18n.js';
import type { CustomerDetail } from './types.js';

/** `CustomerMatchSummary` — just enough of another record to say who it is. */
export interface CustomerMatchSummary {
  id: string;
  name: string | null;
  username: string | null;
  email: string | null;
  last_activity_at: string | null;
}

export interface PossibleMatchList {
  items: Array<{
    customer: CustomerMatchSummary;
    matched_on: Array<'username' | 'email'>;
    linked: boolean;
  }>;
  /** False when the workspace turned possible matches off. */
  enabled: boolean;
}

export interface CustomerIdentityLink {
  customer_id: string;
  linked_customer: CustomerMatchSummary;
  linked_at: string;
  linked_by: string;
}

export const possibleMatchesKey = (customerId: string) =>
  ['customers', 'possible-matches', customerId] as const;
const linksKey = (customerId: string) => ['customers', 'links', customerId] as const;

const SECTION_HEADING =
  'border-b border-border px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-content-tertiary';

/** "Same username" / "Same e-mail" — what the two records share, never proof. */
export function matchedOnLabel(field: 'username' | 'email'): string {
  return field === 'username'
    ? 'customers.identity.matches.sameUsername'
    : 'customers.identity.matches.sameEmail';
}

function useInvalidateIdentity(): (ids: string[]) => void {
  const queryClient = useQueryClient();
  return (ids) => {
    for (const id of ids) {
      void queryClient.invalidateQueries({ queryKey: possibleMatchesKey(id) });
      void queryClient.invalidateQueries({ queryKey: linksKey(id) });
    }
  };
}

function Who({ summary }: { summary: CustomerMatchSummary }): ReactElement {
  const t = useTranslate();
  const details = [summary.username, summary.email].filter(Boolean).join(' · ');
  return (
    <div className="min-w-0 flex-1">
      <p className="truncate text-sm">
        {summary.name ?? (
          <span className="italic text-content-tertiary">
            {t('customers.detail.unnamedVisitor')}
          </span>
        )}
      </p>
      {details && (
        <p className="truncate text-2xs text-content-tertiary" title={details}>
          {details}
        </p>
      )}
    </div>
  );
}

/**
 * The unverified possible matches. Nothing renders when there are none, or
 * when the workspace turned them off — an empty card on every profile would be
 * noise, and the switch is the admin's own choice.
 */
export function PossibleMatchesCard({
  customerId,
  customerName,
  canLink,
  onOpen,
}: {
  customerId: string;
  customerName: string | null;
  /** `customers:rw` and the admin rank — what `POST /customers/{id}/links` asks for. */
  canLink: boolean;
  onOpen: (customerId: string) => void;
}): ReactElement | null {
  const t = useTranslate();
  const api = useApiClient();
  const { confirm, dialog } = useConfirm();
  const invalidate = useInvalidateIdentity();

  const matches = useQuery({
    queryKey: possibleMatchesKey(customerId),
    queryFn: () => api.get<PossibleMatchList>(`/customers/${customerId}/possible-matches`),
  });

  const link = useMutation({
    mutationFn: (otherId: string) =>
      api.post<CustomerIdentityLink>(`/customers/${customerId}/links`, { customer_id: otherId }),
    onSuccess: (_link, otherId) => invalidate([customerId, otherId]),
  });

  const items = matches.data?.enabled === true ? matches.data.items : [];
  if (items.length === 0) return dialog;

  return (
    <Card>
      <h3 className={SECTION_HEADING}>
        {t('customers.identity.matches.heading')}{' '}
        <span className="normal-case tracking-normal text-warning">
          ({t('customers.identity.matches.unverified')})
        </span>
      </h3>
      <p className="px-4 pt-2.5 text-2xs text-content-tertiary">
        {t('customers.identity.matches.hint')}
      </p>
      <ul className="divide-y divide-border">
        {items.map(({ customer, matched_on, linked }) => (
          <li key={customer.id} className="flex flex-col gap-1.5 px-4 py-2.5">
            <div className="flex items-start gap-2">
              <Who summary={customer} />
              <button
                type="button"
                onClick={() => onOpen(customer.id)}
                aria-label={t('customers.identity.openNamed', {
                  name: customer.name ?? t('customers.detail.unnamedVisitor'),
                })}
                className="shrink-0 rounded-md border border-border px-2 py-0.5 text-2xs hover:bg-surface-2"
              >
                {t('customers.identity.open')}
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {matched_on.map((field) => (
                <span
                  key={field}
                  className="rounded-full bg-surface-2 px-2 py-0.5 text-2xs text-content-secondary"
                >
                  {t(matchedOnLabel(field))}
                </span>
              ))}
              {linked ? (
                <StatusDot tone="success" label={t('customers.identity.matches.linked')} />
              ) : (
                canLink && (
                  <button
                    type="button"
                    onClick={() => {
                      const theirs = customer.name ?? t('customers.detail.unnamedVisitor');
                      confirm({
                        title: t('customers.identity.linkConfirm.title', {
                          name: theirs,
                          current: customerName ?? t('customers.detail.thisCustomer'),
                        }),
                        description: t('customers.identity.linkConfirm.description'),
                        confirmLabel: t('customers.identity.linkConfirm.confirm'),
                        failureTitle: t('customers.identity.linkConfirm.failure'),
                        onConfirm: () => link.mutateAsync(customer.id),
                      });
                    }}
                    className="ml-auto rounded-md border border-border px-2 py-0.5 text-2xs font-medium hover:bg-surface-2"
                  >
                    {t('customers.identity.link')}
                  </button>
                )
              )}
            </div>
          </li>
        ))}
      </ul>
      {dialog}
    </Card>
  );
}

/**
 * The records an agent confirmed as this person, each with its own
 * conversations — the merged history view. Hidden when there are none.
 */
export function LinkedRecordsCard({
  customerId,
  canLink,
  onOpen,
}: {
  customerId: string;
  canLink: boolean;
  onOpen: (customerId: string) => void;
}): ReactElement | null {
  const t = useTranslate();
  const api = useApiClient();
  const { confirm, dialog } = useConfirm();
  const invalidate = useInvalidateIdentity();

  const links = useQuery({
    queryKey: linksKey(customerId),
    queryFn: () => api.get<{ items: CustomerIdentityLink[] }>(`/customers/${customerId}/links`),
  });
  const items = links.data?.items ?? [];

  // The linked records' own histories, read through the detail every profile
  // already loads (same query key, so opening one of them is instant).
  const histories = useQueries({
    queries: items.map((item) => ({
      queryKey: ['customers', 'detail', item.linked_customer.id],
      queryFn: () => api.get<CustomerDetail>(`/customers/${item.linked_customer.id}`),
    })),
  });

  const unlink = useMutation({
    mutationFn: (otherId: string) => api.delete(`/customers/${customerId}/links/${otherId}`),
    onSuccess: (_result, otherId) => invalidate([customerId, otherId]),
  });

  if (items.length === 0) return dialog;

  return (
    <Card>
      <h3 className={SECTION_HEADING}>{t('customers.identity.links.heading')}</h3>
      <p className="px-4 pt-2.5 text-2xs text-content-tertiary">
        {t('customers.identity.links.hint')}
      </p>
      <ul className="divide-y divide-border">
        {items.map((item, index) => {
          const other = item.linked_customer;
          const chats = histories[index]?.data?.chats ?? [];
          return (
            <li key={other.id} className="flex flex-col gap-1.5 px-4 py-2.5">
              <div className="flex items-start gap-2">
                <Who summary={other} />
                <button
                  type="button"
                  onClick={() => onOpen(other.id)}
                  aria-label={t('customers.identity.openNamed', {
                    name: other.name ?? t('customers.detail.unnamedVisitor'),
                  })}
                  className="shrink-0 rounded-md border border-border px-2 py-0.5 text-2xs hover:bg-surface-2"
                >
                  {t('customers.identity.open')}
                </button>
                {canLink && (
                  <button
                    type="button"
                    onClick={() =>
                      confirm({
                        title: t('customers.identity.unlinkConfirm.title', {
                          name: other.name ?? t('customers.detail.unnamedVisitor'),
                        }),
                        description: t('customers.identity.unlinkConfirm.description'),
                        confirmLabel: t('customers.identity.unlinkConfirm.confirm'),
                        failureTitle: t('customers.identity.unlinkConfirm.failure'),
                        onConfirm: () => unlink.mutateAsync(other.id),
                      })
                    }
                    className="shrink-0 rounded-md border border-border px-2 py-0.5 text-2xs hover:bg-surface-2"
                  >
                    {t('customers.identity.unlink')}
                  </button>
                )}
              </div>
              <p className="text-2xs text-content-tertiary">
                {t('customers.identity.links.linkedOn', {
                  date: formatDate(item.linked_at) ?? '',
                })}
              </p>
              {chats.length === 0 ? (
                <p className="text-2xs text-content-secondary">
                  {t('customers.identity.links.noConversations')}
                </p>
              ) : (
                <ul className="flex flex-col gap-1">
                  {chats.map((chat) => (
                    <li key={chat.id} className="flex items-center gap-2 text-xs">
                      <Link
                        to={`/app/inbox?chat=${encodeURIComponent(chat.id)}`}
                        className="flex-1 text-content-brand underline underline-offset-2"
                      >
                        {t('customers.detail.chatLink', {
                          date: formatDate(chat.created_at) ?? '',
                        })}
                      </Link>
                      <StatusDot
                        tone={chat.active ? 'success' : 'neutral'}
                        label={
                          chat.active
                            ? t('customers.detail.chatOpen')
                            : t('customers.detail.chatClosed')
                        }
                      />
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
      {dialog}
    </Card>
  );
}

/**
 * "Forget this person's browsers" (`POST /customers/{id}/revoke-member-tokens`).
 * Asks first and says what it does and does not do: every browser starts again
 * as a new visitor; nothing is deleted, nobody is banned.
 */
export function ForgetBrowsers({
  customerId,
  customerName,
}: {
  customerId: string;
  customerName: string | null;
}): ReactElement {
  const t = useTranslate();
  const api = useApiClient();
  const { confirm, dialog } = useConfirm();
  const [revokedAt, setRevokedAt] = useState<string | null>(null);

  const revoke = useMutation({
    mutationFn: () =>
      api.post<{ customer_id: string; revoked_at: string }>(
        `/customers/${customerId}/revoke-member-tokens`,
      ),
    onSuccess: (revocation) => setRevokedAt(revocation.revoked_at),
  });

  return (
    <div className="border-t border-border px-4 py-3">
      <button
        type="button"
        onClick={() => {
          const who = customerName ?? t('customers.detail.thisCustomer');
          confirm({
            title: t('customers.identity.forget.confirmTitle', { name: who }),
            description: t('customers.identity.forget.confirmDescription'),
            confirmLabel: t('customers.identity.forget.confirm'),
            failureTitle: t('customers.identity.forget.failure'),
            onConfirm: () => revoke.mutateAsync(),
          });
        }}
        className="w-full rounded-md border border-border px-3 py-1.5 text-sm transition-colors hover:bg-surface-2"
      >
        {t('customers.identity.forget.button')}
      </button>
      {revokedAt ? (
        <p role="status" className="mt-1.5 text-2xs text-content-secondary">
          {t('customers.identity.forget.done', { date: formatDateTime(revokedAt) ?? '' })}
        </p>
      ) : (
        <p className="mt-1.5 text-2xs text-content-tertiary">
          {t('customers.identity.forget.hint')}
        </p>
      )}
      {revoke.isError && !dialog && (
        <p role="alert" className="mt-1.5 text-2xs text-danger">
          {t('customers.identity.forget.failure')} {t(errorMessageKey(revoke.error))}
        </p>
      )}
      {dialog}
    </div>
  );
}
