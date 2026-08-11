/**
 * IP allowlist and session policy (FR-MOD-08.9.6).
 *
 * Two controls that share one `security_settings` row: the allowlist is its
 * own CRUD resource (`/settings/ip-allowlist`, one row per entry), while
 * enforcement and the two session limits are three columns on the same
 * settings row `FileSharing` and `BannedCustomerIps` read — so a save here
 * goes through that same `['settings','security']` cache and both screens
 * stay in step. All validation, self-lockout rejection and enforcement happen
 * server-side (08.9.6-c/d/e/g); this screen only lists, submits and shows
 * what the server says.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent, type ReactElement } from 'react';
import { Card, ErrorNotice, Section } from '../../components/Page.js';
import { EmptyState } from '../../components/EmptyState.js';
import { StatusDot } from '../../components/StatusDot.js';
import { ApiClientError } from '../../lib/api-client.js';
import { useApiClient } from '../../lib/auth-store.js';

interface IpAllowlistEntry {
  id: string;
  entry: string;
  label: string | null;
  created_at: string;
}

interface SecuritySettings {
  banned_customer_ips: string[];
  file_sharing_enabled: boolean;
  allowed_file_types: string[];
  max_file_size_bytes: number;
  spam_filter_enabled: boolean;
  require_two_factor: boolean;
  ip_allowlist_enforced: boolean;
  session_idle_timeout_seconds: number | null;
  max_concurrent_sessions: number | null;
  updated_at: string | null;
}

export function IpAllowlist({ canEdit }: { canEdit: boolean }): ReactElement {
  return (
    <>
      <IpAllowlistEntries canEdit={canEdit} />
      <SessionPolicy canEdit={canEdit} />
    </>
  );
}

// --- Allowlist entries --------------------------------------------------------

function IpAllowlistEntries({ canEdit }: { canEdit: boolean }): ReactElement {
  const api = useApiClient();
  const queryClient = useQueryClient();
  const [entry, setEntry] = useState('');
  const [label, setLabel] = useState('');

  const list = useQuery({
    queryKey: ['settings', 'ip-allowlist'],
    queryFn: () => api.get<{ items: IpAllowlistEntry[] }>('/settings/ip-allowlist'),
  });

  const invalidate = () =>
    void queryClient.invalidateQueries({ queryKey: ['settings', 'ip-allowlist'] });

  const add = useMutation({
    mutationFn: (body: { entry: string; label: string | null }) =>
      api.post<IpAllowlistEntry>('/settings/ip-allowlist', body),
    onSuccess: () => {
      setEntry('');
      setLabel('');
      invalidate();
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/settings/ip-allowlist/${id}`),
    onSuccess: invalidate,
  });

  function submit(event: FormEvent): void {
    event.preventDefault();
    const value = entry.trim();
    if (!value) return;
    add.mutate({ entry: value, label: label.trim() || null });
  }

  return (
    <Section
      title="IP allowlist"
      description="Sources allowed to reach the agent/admin panel once enforcement is on below. A saved list can never exclude the address you are connecting from — the server refuses a change that would lock you out."
    >
      {list.error ? (
        <ErrorNotice message="Could not load the IP allowlist." />
      ) : (
        <Card>
          {canEdit && (
            <form
              onSubmit={submit}
              className="flex flex-wrap items-end gap-3 border-b border-border p-4"
            >
              <label htmlFor="new-allowlist-entry" className="flex min-w-56 flex-1 flex-col gap-1">
                <span className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
                  Address or CIDR range
                </span>
                <input
                  id="new-allowlist-entry"
                  value={entry}
                  onChange={(event) => setEntry(event.target.value)}
                  placeholder="10.0.0.0/24"
                  className="rounded-md border border-border bg-inset px-2 py-1.5 font-mono text-sm outline-none placeholder:text-content-tertiary"
                />
              </label>

              <label htmlFor="new-allowlist-label" className="flex w-48 flex-col gap-1">
                <span className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
                  Label (optional)
                </span>
                <input
                  id="new-allowlist-label"
                  value={label}
                  onChange={(event) => setLabel(event.target.value)}
                  placeholder="Office VPN"
                  className="rounded-md border border-border bg-inset px-2 py-1.5 text-sm outline-none placeholder:text-content-tertiary"
                />
              </label>

              <button
                type="submit"
                disabled={!entry.trim() || add.isPending}
                className="rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-50"
              >
                {add.isPending ? 'Adding…' : 'Add entry'}
              </button>

              {add.isError && (
                <p role="alert" className="w-full text-2xs text-danger">
                  {add.error instanceof ApiClientError
                    ? add.error.message
                    : 'Could not add that entry.'}
                </p>
              )}
            </form>
          )}

          {list.isPending ? (
            <p className="p-4 text-sm text-content-secondary">Loading…</p>
          ) : list.data.items.length === 0 ? (
            <EmptyState
              title="No allowlist entries"
              description="Nothing is restricted yet. Add the addresses your team connects from before turning enforcement on below."
            />
          ) : (
            <ul className="divide-y divide-border">
              {list.data.items.map((item) => (
                <li key={item.id} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="flex-1 font-mono text-sm">
                    {item.entry}
                    {item.label && (
                      <span className="ml-2 font-sans text-2xs text-content-tertiary">
                        {item.label}
                      </span>
                    )}
                  </span>
                  {canEdit && (
                    <button
                      type="button"
                      onClick={() => remove.mutate(item.id)}
                      className="rounded-md border border-border px-2 py-1 text-2xs text-content-secondary transition-colors hover:bg-surface-2"
                    >
                      Remove
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </Section>
  );
}

// --- Session policy ------------------------------------------------------------

function SessionPolicy({ canEdit }: { canEdit: boolean }): ReactElement {
  const api = useApiClient();
  const queryClient = useQueryClient();
  const [idleMinutes, setIdleMinutes] = useState<string | null>(null);
  const [maxSessions, setMaxSessions] = useState<string | null>(null);

  const settings = useQuery({
    queryKey: ['settings', 'security'],
    queryFn: () => api.get<SecuritySettings>('/settings/security'),
  });

  const save = useMutation({
    mutationFn: (body: Partial<SecuritySettings>) =>
      api.patch<SecuritySettings>('/settings/security', body),
    onSuccess: (data) => {
      queryClient.setQueryData(['settings', 'security'], data);
      setIdleMinutes(null);
      setMaxSessions(null);
    },
  });

  if (settings.error) return <ErrorNotice message="Could not load the session policy." />;

  const current = settings.data;
  // `?? current` throughout: the inputs are uncontrolled drafts until touched,
  // so an unsaved edit survives a background refetch (FileSharing's pattern).
  const idleDraft =
    idleMinutes ??
    (current?.session_idle_timeout_seconds != null
      ? String(Math.round(current.session_idle_timeout_seconds / 60))
      : '');
  const maxDraft =
    maxSessions ??
    (current?.max_concurrent_sessions != null ? String(current.max_concurrent_sessions) : '');

  function submit(event: FormEvent): void {
    event.preventDefault();
    if (!current) return;

    const idleValue = idleDraft.trim();
    const maxValue = maxDraft.trim();
    const minutes = idleValue === '' ? null : Number(idleValue);
    const sessions = maxValue === '' ? null : Number(maxValue);
    if (minutes !== null && (!Number.isFinite(minutes) || minutes < 1)) return;
    if (sessions !== null && (!Number.isInteger(sessions) || sessions < 1)) return;

    save.mutate({
      session_idle_timeout_seconds: minutes === null ? null : Math.round(minutes * 60),
      max_concurrent_sessions: sessions,
    });
  }

  return (
    <Section
      title="Session policy"
      description="Whether the allowlist above is enforced, how long a session may sit idle, and how many may run at once for one owner. Leave a limit blank to turn it off."
    >
      <Card>
        {settings.isPending ? (
          <p className="p-4 text-sm text-content-secondary">Loading…</p>
        ) : !canEdit ? (
          <div className="flex flex-col gap-2 p-4 text-sm text-content-secondary">
            <p className="flex items-center gap-2">
              IP allowlist enforcement
              <StatusDot
                tone={current!.ip_allowlist_enforced ? 'success' : 'neutral'}
                label={current!.ip_allowlist_enforced ? 'On' : 'Off'}
              />
            </p>
            <p>
              Idle timeout:{' '}
              {current!.session_idle_timeout_seconds != null
                ? `${Math.round(current!.session_idle_timeout_seconds / 60)} minutes`
                : 'Off'}
            </p>
            <p>Max concurrent sessions: {current!.max_concurrent_sessions ?? '25 (default)'}</p>
          </div>
        ) : (
          <form onSubmit={submit} className="flex flex-col gap-4 p-4">
            <label className="flex items-start gap-3">
              <input
                type="checkbox"
                checked={current!.ip_allowlist_enforced}
                disabled={save.isPending}
                onChange={(event) => save.mutate({ ip_allowlist_enforced: event.target.checked })}
              />
              <span className="flex-1 text-sm">
                Enforce the IP allowlist
                <span className="block text-2xs text-content-tertiary">
                  Once on, only the addresses above may reach the agent/admin panel.
                </span>
              </span>
            </label>

            <div className="flex flex-wrap items-end gap-3">
              <label htmlFor="idle-timeout" className="flex w-40 flex-col gap-1">
                <span className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
                  Idle timeout (minutes)
                </span>
                <input
                  id="idle-timeout"
                  type="number"
                  min={1}
                  value={idleDraft}
                  onChange={(event) => setIdleMinutes(event.target.value)}
                  placeholder="Off"
                  className="rounded-md border border-border bg-inset px-2 py-1.5 text-sm outline-none placeholder:text-content-tertiary"
                />
              </label>

              <label htmlFor="max-sessions" className="flex w-40 flex-col gap-1">
                <span className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
                  Max concurrent sessions
                </span>
                <input
                  id="max-sessions"
                  type="number"
                  min={1}
                  value={maxDraft}
                  onChange={(event) => setMaxSessions(event.target.value)}
                  placeholder="25 (default)"
                  className="rounded-md border border-border bg-inset px-2 py-1.5 text-sm outline-none placeholder:text-content-tertiary"
                />
              </label>

              <button
                type="submit"
                disabled={save.isPending}
                className="rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-50"
              >
                {save.isPending ? 'Saving…' : 'Save'}
              </button>
            </div>

            {save.isError && (
              <p role="alert" className="text-2xs text-danger">
                {save.error instanceof ApiClientError
                  ? save.error.message
                  : 'Could not save the session policy.'}
              </p>
            )}
          </form>
        )}
      </Card>
    </Section>
  );
}
