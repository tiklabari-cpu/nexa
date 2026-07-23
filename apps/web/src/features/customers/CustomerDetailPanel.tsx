/**
 * One customer: details, edit form, visit history and conversations.
 *
 * The edit form sends only the fields that changed. Sending the whole record
 * back would mean two agents editing different fields overwrite each other,
 * and the last one to press save silently wins.
 */
import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent, type ReactElement } from 'react';
import { Card, CardSkeleton } from '../../components/Page.js';
import { StatusDot } from '../../components/StatusDot.js';
import { ApiClientError } from '../../lib/api-client.js';
import { useApiClient } from '../../lib/auth-store.js';
import { formatDate } from '../../lib/format.js';
import type { CustomerDetail } from './types.js';

interface Props {
  customerId: string | null;
  canEdit: boolean;
  canBan: boolean;
  onChanged: () => void;
  onBanToggle: (id: string, banned: boolean) => void;
  banPending: boolean;
}

export function CustomerDetailPanel({
  customerId,
  canEdit,
  canBan,
  onChanged,
  onBanToggle,
  banPending,
}: Props): ReactElement {
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
          Select someone to see their history.
        </p>
      </Card>
    );
  }

  if (detail.isPending) return <CardSkeleton rows={6} />;
  if (detail.error || !detail.data) {
    return (
      <Card>
        <p role="alert" className="p-6 text-sm text-danger">
          Could not load this customer.
        </p>
      </Card>
    );
  }

  const customer = detail.data;

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <div className="border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold">
            {customer.name ?? <span className="italic text-content-tertiary">Unnamed visitor</span>}
          </h2>
          <p className="text-2xs text-content-tertiary">
            First seen {formatDate(customer.created_at)}
          </p>
          {customer.banned && (
            <p className="mt-1.5">
              <StatusDot
                tone="danger"
                label={`Banned ${formatDate(customer.banned_at) ?? ''}`.trim()}
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
          <dt className="text-content-secondary">Conversations</dt>
          <dd className="tabular text-right">{customer.chats_count}</dd>
          <dt className="text-content-secondary">Tickets</dt>
          <dd className="tabular text-right">{customer.tickets_count}</dd>
          <dt className="text-content-secondary">Country</dt>
          <dd className="text-right">{customer.country ?? customer.country_code ?? '—'}</dd>
          <dt className="text-content-secondary">Last active</dt>
          <dd className="text-right">{formatDate(customer.last_activity_at) ?? 'Never'}</dd>
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
              {customer.banned ? 'Lift ban' : 'Ban customer'}
            </button>
            <p className="mt-1.5 text-2xs text-content-tertiary">
              {customer.banned
                ? 'They will be able to start conversations again.'
                : 'Blocks new conversations. History is kept.'}
            </p>
          </div>
        )}
      </Card>

      <Card>
        <h3 className="border-b border-border px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-content-tertiary">
          Visited pages
        </h3>
        {customer.visits.length === 0 ? (
          <p className="px-4 py-3 text-sm text-content-secondary">
            No visits recorded. Pages are captured when someone messages from the widget.
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
                      {page.url ?? 'Unknown page'}
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
          Conversations
        </h3>
        {customer.chats.length === 0 ? (
          <p className="px-4 py-3 text-sm text-content-secondary">No conversations yet.</p>
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
                  label={chat.active ? 'Open' : 'Closed'}
                />
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
  const api = useApiClient();
  const [name, setName] = useState(customer.name ?? '');
  const [email, setEmail] = useState(customer.email ?? '');
  const [phone, setPhone] = useState(customer.phone ?? '');

  // A refetch after saving must not clobber what the agent is currently typing,
  // so the form is only re-seeded when the record itself changes identity.
  useEffect(() => {
    setName(customer.name ?? '');
    setEmail(customer.email ?? '');
    setPhone(customer.phone ?? '');
  }, [customer.id]);

  const save = useMutation({
    mutationFn: (changes: Record<string, string | null>) =>
      api.patch<CustomerDetail>(`/customers/${customer.id}`, changes),
    onSuccess: onSaved,
  });

  const dirty =
    name !== (customer.name ?? '') ||
    email !== (customer.email ?? '') ||
    phone !== (customer.phone ?? '');

  function submit(event: FormEvent): void {
    event.preventDefault();
    if (!dirty) return;

    // Only what changed. An empty field means "clear it", which the API accepts
    // as an explicit null.
    const changes: Record<string, string | null> = {};
    if (name !== (customer.name ?? '')) changes['name'] = name.trim() || null;
    if (email !== (customer.email ?? '')) changes['email'] = email.trim() || null;
    if (phone !== (customer.phone ?? '')) changes['phone'] = phone.trim() || null;

    save.mutate(changes);
  }

  if (!canEdit) {
    return (
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 px-4 py-3 text-sm">
        <dt className="text-content-secondary">Email</dt>
        <dd className="truncate">{customer.email ?? '—'}</dd>
        <dt className="text-content-secondary">Phone</dt>
        <dd className="truncate">{customer.phone ?? '—'}</dd>
      </dl>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-2 px-4 py-3">
      <Field id="customer-name" label="Name" value={name} onChange={setName} />
      <Field id="customer-email" label="Email" value={email} onChange={setEmail} type="email" />
      <Field id="customer-phone" label="Phone" value={phone} onChange={setPhone} type="tel" />

      {save.isError && (
        <p role="alert" className="text-2xs text-danger">
          {save.error instanceof ApiClientError && save.error.type === 'validation'
            ? save.error.message
            : 'Could not save. Try again.'}
        </p>
      )}

      <button
        type="submit"
        disabled={!dirty || save.isPending}
        className="mt-1 rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-50"
      >
        {save.isPending ? 'Saving…' : 'Save changes'}
      </button>
    </form>
  );
}

function Field({
  id,
  label,
  value,
  onChange,
  type = 'text',
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
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
        className="rounded-md border border-border bg-inset px-2 py-1.5 text-sm outline-none"
      />
    </label>
  );
}
