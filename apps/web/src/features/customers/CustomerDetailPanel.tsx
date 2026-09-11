/**
 * One customer: details, edit form, visit history and conversations.
 *
 * The edit form sends only the fields that changed. Sending the whole record
 * back would mean two agents editing different fields overwrite each other,
 * and the last one to press save silently wins.
 *
 * Erasure (GDPR Art. 17 · NFR-C8) lives here too, under its own scope and
 * behind a confirmation — the `Sandbox.tsx` destructive-confirmation pattern.
 * It sits beside the ban button on purpose and is worded to say what separates
 * them: a ban can be lifted and keeps the history; this deletes it.
 */
import { useMutation, useQuery } from '@tanstack/react-query';
import { useState, type ReactElement } from 'react';
import { Card, CardSkeleton } from '../../components/Page.js';
import { StatusDot } from '../../components/StatusDot.js';
import { Modal } from '../../components/ui/Modal.js';
import { ApiClientError, errorMessageKey } from '../../lib/api-client.js';
import { useApiClient } from '../../lib/auth-store.js';
import { formatDate } from '../../lib/format.js';
import { email, FieldError, optional, useForm } from '../../lib/form.js';
import { useTranslate } from '../../lib/i18n.js';
import { CustomFields } from '../custom-fields/CustomFields.js';
import type { CustomerDetail } from './types.js';

interface Props {
  customerId: string | null;
  canEdit: boolean;
  canBan: boolean;
  /** `customers.erase:rw` — narrower than `canEdit`, and never implied by it. */
  canErase: boolean;
  onChanged: () => void;
  onBanToggle: (id: string, banned: boolean) => void;
  banPending: boolean;
  /** Clears the selection once the person this panel is showing no longer exists. */
  onErased: (id: string) => void;
}

export function CustomerDetailPanel({
  customerId,
  canEdit,
  canBan,
  canErase,
  onChanged,
  onBanToggle,
  banPending,
  onErased,
}: Props): ReactElement {
  const t = useTranslate();
  const api = useApiClient();

  const detail = useQuery({
    queryKey: ['customers', 'detail', customerId],
    queryFn: () => api.get<CustomerDetail>(`/customers/${customerId!}`),
    enabled: customerId !== null,
  });

  if (!customerId) {
    return (
      <Card>
        <p className="p-6 text-center text-sm text-content-secondary">
          {t('customers.detail.emptySelection')}
        </p>
      </Card>
    );
  }

  if (detail.isPending) return <CardSkeleton rows={6} />;
  if (detail.error || !detail.data) {
    return (
      <Card>
        <p role="alert" className="p-6 text-sm text-danger">
          {t('customers.detail.loadError')}
        </p>
      </Card>
    );
  }

  const customer = detail.data;

  const saveCustomFields = async (values: Record<string, string | null>): Promise<void> => {
    await api.put<CustomerDetail>(`/customers/${customer.id}/custom-fields`, { values });
    void detail.refetch();
    onChanged();
  };

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <div className="border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold">
            {customer.name ?? (
              <span className="italic text-content-tertiary">
                {t('customers.detail.unnamedVisitor')}
              </span>
            )}
          </h2>
          <p className="text-2xs text-content-tertiary">
            {t('customers.detail.firstSeen', { date: formatDate(customer.created_at) ?? '' })}
          </p>
          {customer.banned && (
            <p className="mt-1.5">
              <StatusDot
                tone="danger"
                label={t('customers.detail.bannedAt', {
                  date: formatDate(customer.banned_at) ?? '',
                }).trim()}
              />
            </p>
          )}
        </div>

        <EditForm
          key={customer.id}
          customer={customer}
          canEdit={canEdit}
          onSaved={() => {
            void detail.refetch();
            onChanged();
          }}
        />

        <dl className="grid grid-cols-2 gap-x-3 gap-y-2 border-t border-border px-4 py-3 text-sm">
          <dt className="text-content-secondary">{t('customers.detail.conversations')}</dt>
          <dd className="tabular text-right">{customer.chats_count}</dd>
          <dt className="text-content-secondary">{t('customers.detail.tickets')}</dt>
          <dd className="tabular text-right">{customer.tickets_count}</dd>
          <dt className="text-content-secondary">{t('customers.detail.visits')}</dt>
          <dd className="flex items-center justify-end gap-1.5">
            <span className="tabular">{customer.visits_count}</span>
            {customer.visits_count > 1 && (
              <StatusDot tone="info" label={t('customers.detail.returningVisitor')} />
            )}
          </dd>
          <dt className="text-content-secondary">{t('customers.detail.country')}</dt>
          <dd className="text-right">{customer.country ?? customer.country_code ?? '—'}</dd>
          <dt className="text-content-secondary">{t('customers.detail.lastActive')}</dt>
          <dd className="text-right">
            {formatDate(customer.last_activity_at) ?? t('customers.detail.never')}
          </dd>
        </dl>

        {canBan && (
          <div className="border-t border-border px-4 py-3">
            <button
              type="button"
              disabled={banPending}
              onClick={() => onBanToggle(customer.id, !customer.banned)}
              className={`w-full rounded-md border px-3 py-1.5 text-sm transition-colors disabled:opacity-50 ${
                customer.banned
                  ? 'border-border hover:bg-surface-2'
                  : 'border-danger text-danger hover:bg-danger/10'
              }`}
            >
              {customer.banned ? t('customers.detail.liftBan') : t('customers.detail.banCustomer')}
            </button>
            <p className="mt-1.5 text-2xs text-content-tertiary">
              {customer.banned
                ? t('customers.detail.bannedHint')
                : t('customers.detail.notBannedHint')}
            </p>
          </div>
        )}

        {canErase && <EraseCustomer customerId={customer.id} onErased={onErased} />}
      </Card>

      {customer.custom_fields.length > 0 && (
        <Card>
          <h3 className="border-b border-border px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-content-tertiary">
            {t('customers.detail.customFieldsHeading')}
          </h3>
          <div className="px-4 py-3">
            <CustomFields
              fields={customer.custom_fields}
              canEdit={canEdit}
              save={saveCustomFields}
            />
          </div>
        </Card>
      )}

      <Card>
        <h3 className="border-b border-border px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-content-tertiary">
          {t('customers.detail.visitedPages')}
        </h3>
        {customer.visits.length === 0 ? (
          <p className="px-4 py-3 text-sm text-content-secondary">
            {t('customers.detail.noVisits')}
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {customer.visits.map((visit) => (
              <li key={visit.id} className="px-4 py-2.5">
                <p className="text-2xs text-content-tertiary">
                  {formatDate(visit.started_at)}
                  {visit.browser ? ` · ${visit.browser}` : ''}
                  {visit.os ? ` · ${visit.os}` : ''}
                </p>
                {visit.came_from && (
                  // Visitor-supplied, rendered as text, never as a link — same
                  // reasoning as the page URLs below.
                  <p
                    className="mt-0.5 truncate text-2xs text-content-tertiary"
                    title={visit.came_from}
                  >
                    {t('customers.detail.cameFrom', { source: visit.came_from })}
                  </p>
                )}
                <ul className="mt-1 flex flex-col gap-0.5">
                  {visit.pages.map((page, index) => (
                    <li
                      key={`${visit.id}-${index}`}
                      // Visitor-supplied URLs are rendered as text, never as a
                      // link: a link would be a one-click path to whatever a
                      // stranger put in the address bar.
                      className="truncate text-xs text-content-secondary"
                      title={page.url}
                    >
                      {page.url ?? t('customers.detail.unknownPage')}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <h3 className="border-b border-border px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-content-tertiary">
          {t('customers.detail.conversations')}
        </h3>
        {customer.chats.length === 0 ? (
          <p className="px-4 py-3 text-sm text-content-secondary">
            {t('customers.detail.noConversations')}
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {customer.chats.map((chat) => (
              <li key={chat.id} className="flex items-center gap-2 px-4 py-2.5 text-sm">
                <span className="font-mono text-2xs text-content-tertiary">{chat.id}</span>
                <span className="flex-1 text-2xs text-content-secondary">
                  {formatDate(chat.created_at)}
                </span>
                <StatusDot
                  tone={chat.active ? 'success' : 'neutral'}
                  label={
                    chat.active ? t('customers.detail.chatOpen') : t('customers.detail.chatClosed')
                  }
                />
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <h3 className="border-b border-border px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-content-tertiary">
          {t('customers.detail.groups')}
        </h3>
        {customer.groups.length === 0 ? (
          <p className="px-4 py-3 text-sm text-content-secondary">
            {t('customers.detail.noGroups')}
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {customer.groups.map((group) => (
              <li key={group.id} className="px-4 py-2.5 text-sm">
                {group.name}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function EditForm({
  customer,
  canEdit,
  onSaved,
}: {
  customer: CustomerDetail;
  canEdit: boolean;
  onSaved: () => void;
}): ReactElement {
  const t = useTranslate();
  const api = useApiClient();

  const save = useMutation({
    mutationFn: (changes: Record<string, string | null>) =>
      api.patch<CustomerDetail>(`/customers/${customer.id}`, changes),
    onSuccess: onSaved,
  });

  // Remounted by the caller's `key={customer.id}` whenever the record changes
  // identity, so `useForm`'s seed-once `initial` never goes stale — and a
  // refetch after saving (same identity) leaves an in-flight edit alone.
  const form = useForm({
    initial: {
      name: customer.name ?? '',
      email: customer.email ?? '',
      phone: customer.phone ?? '',
    },
    validators: {
      email: optional(email(t('customers.detail.field.emailError'))),
      // No format check: the server (`customers.ts`) stores this as a plain
      // string up to 40 characters, not the channel adapters' delivery-address
      // format `phoneNumber` mirrors — an already-saved "+44 77 1234 5678"
      // must stay editable, not get silently stuck on Save.
    },
    onSubmit: async (values, { setSubmitError }) => {
      // Only what changed. An empty field means "clear it", which the API accepts
      // as an explicit null.
      const changes: Record<string, string | null> = {};
      if (values.name !== (customer.name ?? '')) changes['name'] = values.name.trim() || null;
      if (values.email !== (customer.email ?? '')) changes['email'] = values.email.trim() || null;
      if (values.phone !== (customer.phone ?? '')) changes['phone'] = values.phone.trim() || null;
      try {
        await save.mutateAsync(changes);
      } catch (error) {
        setSubmitError(t(errorMessageKey(error)));
      }
    },
  });
  const emailError = form.errorFor('email');

  if (!canEdit) {
    return (
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 px-4 py-3 text-sm">
        <dt className="text-content-secondary">{t('customers.detail.field.email')}</dt>
        <dd className="truncate">{customer.email ?? '—'}</dd>
        <dt className="text-content-secondary">{t('customers.detail.field.phone')}</dt>
        <dd className="truncate">{customer.phone ?? '—'}</dd>
      </dl>
    );
  }

  return (
    <form onSubmit={form.handleSubmit} noValidate className="flex flex-col gap-2 px-4 py-3">
      <Field
        id="customer-name"
        label={t('customers.detail.field.name')}
        value={form.values.name}
        onChange={(value) => form.setValue('name', value)}
      />
      <Field
        id="customer-email"
        label={t('customers.detail.field.email')}
        value={form.values.email}
        onChange={(value) => form.setValue('email', value)}
        onBlur={() => form.blur('email')}
        error={emailError}
        type="email"
      />
      <Field
        id="customer-phone"
        label={t('customers.detail.field.phone')}
        value={form.values.phone}
        onChange={(value) => form.setValue('phone', value)}
        type="tel"
      />

      {form.submitError && (
        <p role="alert" className="text-2xs text-danger">
          {form.submitError}
        </p>
      )}

      <button
        type="submit"
        disabled={!form.canSubmit || !form.isDirty}
        className="mt-1 rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-50"
      >
        {form.isSubmitting ? t('customers.detail.saving') : t('customers.detail.saveChanges')}
      </button>
    </form>
  );
}

function Field({
  id,
  label,
  value,
  onChange,
  onBlur,
  error,
  type = 'text',
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  error?: string | null;
  type?: string;
}): ReactElement {
  return (
    <label htmlFor={id} className="flex flex-col gap-1">
      <span className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
        {label}
      </span>
      <input
        id={id}
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onBlur}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        className="rounded-md border border-border bg-inset px-2 py-1.5 text-sm outline-none"
      />
      <FieldError id={`${id}-error`} message={error ?? null} />
    </label>
  );
}

/**
 * Right to erasure (GDPR Art. 17 · NFR-C8).
 *
 * Two clicks and a sentence that names the consequence, because the action is
 * irreversible and its neighbour above it is not — `Sandbox.tsx`'s
 * destructive-confirmation shape.
 *
 * One refusal is worth explaining rather than passing through ADR-06's generic
 * sentence: the server declines while the person is in a live conversation
 * (`details.reason === 'active_chat'`), and "close the conversation first" is
 * an instruction somebody can act on, where "not allowed" reads as a
 * permissions problem and sends them to an admin who cannot help.
 */
function EraseCustomer({
  customerId,
  onErased,
}: {
  customerId: string;
  onErased: (id: string) => void;
}): ReactElement {
  const t = useTranslate();
  const api = useApiClient();
  const [confirming, setConfirming] = useState(false);

  const erase = useMutation({
    mutationFn: () => api.post(`/customers/${customerId}/erase`),
    onSuccess: () => {
      setConfirming(false);
      onErased(customerId);
    },
  });

  const activeChat =
    erase.error instanceof ApiClientError && erase.error.details?.['reason'] === 'active_chat';

  return (
    <div className="border-t border-border px-4 py-3">
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="w-full rounded-md border border-danger px-3 py-1.5 text-sm text-danger transition-colors hover:bg-danger/10"
      >
        {t('customers.detail.eraseCustomer')}
      </button>
      <p className="mt-1.5 text-2xs text-content-tertiary">{t('customers.detail.eraseHint')}</p>

      {confirming && (
        <Modal
          onClose={() => setConfirming(false)}
          title={t('customers.detail.eraseModalTitle')}
          description={t('customers.detail.eraseModalDescription')}
        >
          {erase.error !== null && (
            <p role="alert" className="text-2xs text-danger">
              {activeChat
                ? t('customers.detail.eraseActiveChatError')
                : t(errorMessageKey(erase.error))}
            </p>
          )}
          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="rounded-md border border-border px-3 py-1.5 text-sm"
            >
              {t('customers.detail.eraseCancel')}
            </button>
            <button
              type="button"
              onClick={() => erase.mutate()}
              disabled={erase.isPending}
              className="rounded-md border border-danger px-3 py-1.5 text-sm font-medium text-danger transition-colors hover:bg-danger/10 disabled:opacity-50"
            >
              {erase.isPending ? t('customers.detail.erasing') : t('customers.detail.eraseConfirm')}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
