/**
 * Invite teammates (PRD FR-MOD-04.3.1, 04.4).
 *
 * Several addresses at once, comma separated, because that is how a team is
 * actually added. Invalid rows are marked individually rather than rejecting
 * the whole list — retyping four good addresses because the fifth had a typo is
 * the kind of small insult software gets away with too often.
 *
 * "Copy invite link" copies the link for the *first* invitation created. The
 * server only ever returns a token once, so this is the one moment it exists;
 * the list on the team page cannot re-issue it.
 */
import { useState, type FormEvent, type ReactElement } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiClientError } from '../../lib/api-client.js';
import { useApiClient } from '../../lib/auth-store.js';

interface Invitation {
  id: string;
  email: string;
  role: 'admin' | 'agent';
  invited_by_name: string | null;
  expires_at: string;
  accept_url?: string;
}

export function usePendingInvitations() {
  const api = useApiClient();
  return useQuery({
    queryKey: ['invitations'],
    queryFn: () => api.get<{ items: Invitation[] }>('/invitations'),
  });
}

export function useRevokeInvitation() {
  const api = useApiClient();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/invitations/${id}`),
    onSuccess: () => client.invalidateQueries({ queryKey: ['invitations'] }),
  });
}

/** Splits on commas, newlines and spaces — however the addresses were pasted. */
function parseEmails(raw: string): string[] {
  return raw
    .split(/[,\n\s]+/)
    .map((value) => value.trim())
    .filter(Boolean);
}

export function InviteTeammates(): ReactElement {
  const [open, setOpen] = useState(false);
  const [raw, setRaw] = useState('');
  const [role, setRole] = useState<'admin' | 'agent'>('admin');
  const [invalid, setInvalid] = useState<string[]>([]);
  const [copied, setCopied] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const api = useApiClient();
  const client = useQueryClient();

  const invite = useMutation({
    mutationFn: (body: { emails: string[]; role: string }) =>
      api.post<{ items: Invitation[] }>('/invitations', body),
    onSuccess: async (result) => {
      await client.invalidateQueries({ queryKey: ['invitations'] });
      const link = result.items[0]?.accept_url;
      if (link) setCopied(link);
      setRaw('');
      setInvalid([]);
    },
  });

  const emails = parseEmails(raw);

  function close(): void {
    // Half-typed input is work; losing it to a stray click is not a small thing
    // when it was ten addresses (FR-EK-A.2).
    if (raw.trim() && !window.confirm('Discard the addresses you have typed?')) return;
    setOpen(false);
    setRaw('');
    setInvalid([]);
    setError(null);
    setCopied(null);
    invite.reset();
  }

  async function onSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    setInvalid([]);
    try {
      await invite.mutateAsync({ emails, role });
    } catch (failure) {
      if (failure instanceof ApiClientError && failure.type === 'validation') {
        const bad = failure.details?.['invalid_emails'];
        if (Array.isArray(bad)) {
          setInvalid(bad as string[]);
          return;
        }
      }
      setError(
        failure instanceof ApiClientError && failure.type === 'authorization'
          ? 'You cannot invite someone above your own role.'
          : 'Could not send those invitations.',
      );
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white"
      >
        Invite teammates
      </button>
    );
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Invite teammates"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6"
    >
      <div className="w-full max-w-md rounded-lg border border-border bg-surface p-5">
        <h2 className="mb-1 text-base font-semibold">Invite teammates</h2>
        <p className="mb-4 text-xs text-content-secondary">
          One address per line, or separated by commas.
        </p>

        <form onSubmit={(event) => void onSubmit(event)}>
          {error && (
            <p role="alert" className="mb-3 text-sm text-danger">
              {error}
            </p>
          )}

          <label htmlFor="invite-emails" className="mb-1.5 block text-sm font-medium">
            Email addresses
          </label>
          <textarea
            id="invite-emails"
            rows={4}
            value={raw}
            autoFocus
            onChange={(event) => setRaw(event.target.value)}
            className="mb-1 w-full rounded-md border border-border bg-inset px-3 py-2 text-sm"
          />
          {invalid.length > 0 && (
            <ul role="alert" className="mb-3 text-xs text-danger">
              {invalid.map((address) => (
                <li key={address}>Not a valid address: {address}</li>
              ))}
            </ul>
          )}

          <label htmlFor="invite-role" className="mb-1.5 mt-3 block text-sm font-medium">
            Role
          </label>
          <select
            id="invite-role"
            value={role}
            onChange={(event) => setRole(event.target.value as 'admin')}
            className="mb-4 w-full rounded-md border border-border bg-inset px-2 py-1.5 text-sm"
          >
            <option value="admin">Admin</option>
            <option value="agent">Agent</option>
          </select>

          {copied && (
            <div className="mb-4 rounded-md border border-border bg-inset p-3">
              <p role="status" className="mb-2 text-xs text-content-secondary">
                Invitations sent. This link works once and lasts seven days — it is not shown again.
              </p>
              <button
                type="button"
                onClick={() => void navigator.clipboard?.writeText(copied)}
                className="rounded-md border border-border px-2.5 py-1 text-xs font-medium"
              >
                Copy invite link
              </button>
            </div>
          )}

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={close}
              className="rounded-md border border-border px-3 py-1.5 text-sm"
            >
              {copied ? 'Done' : 'Cancel'}
            </button>
            <button
              type="submit"
              disabled={emails.length === 0 || invite.isPending}
              className="rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
            >
              {invite.isPending ? 'Sending…' : `Invite ${emails.length || ''}`.trim()}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function PendingInvitations(): ReactElement | null {
  const invitations = usePendingInvitations();
  const revoke = useRevokeInvitation();
  const items = invitations.data?.items ?? [];

  if (items.length === 0) return null;

  return (
    <table className="w-full text-sm">
      <caption className="sr-only">Invitations not yet accepted</caption>
      <thead>
        <tr className="border-b border-border text-left">
          <th className="px-4 py-2 text-2xs font-medium uppercase tracking-wide text-content-tertiary">
            Email
          </th>
          <th className="px-4 py-2 text-2xs font-medium uppercase tracking-wide text-content-tertiary">
            Role
          </th>
          <th className="px-4 py-2 text-2xs font-medium uppercase tracking-wide text-content-tertiary">
            Invited by
          </th>
          <th className="px-4 py-2" />
        </tr>
      </thead>
      <tbody>
        {items.map((invite) => (
          <tr key={invite.id} className="border-b border-border last:border-0">
            <td className="px-4 py-2.5">{invite.email}</td>
            <td className="px-4 py-2.5 text-content-secondary">{invite.role}</td>
            <td className="px-4 py-2.5 text-content-secondary">
              {invite.invited_by_name ?? '—'}
            </td>
            <td className="px-4 py-2.5 text-right">
              <button
                type="button"
                onClick={() => revoke.mutate(invite.id)}
                disabled={revoke.isPending}
                className="text-xs text-danger underline"
              >
                Revoke
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
