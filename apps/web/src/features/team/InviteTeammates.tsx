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
import { useState, type ReactElement } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiClientError } from '../../lib/api-client.js';
import { useApiClient } from '../../lib/auth-store.js';
import { FieldError, emailList, splitList, useForm } from '../../lib/form.js';
import { formatMoney } from '../../lib/format.js';
import { useCloseGuard } from '../../lib/dirty-guard.js';
import { useTranslate } from '../../lib/i18n.js';
import { Modal } from '../../components/ui/index.js';

interface Invitation {
  id: string;
  email: string;
  role: 'admin' | 'agent';
  invited_by_name: string | null;
  expires_at: string;
  accept_url?: string;
}

/** What accepting these invitations would cost (FR-MOD-04.4). */
interface SeatSummary {
  headcount: number;
  /** `null` on a trial — nothing has been bought, so joining costs nothing yet. */
  purchased: number | null;
  /** `null` on a quoted plan: Enterprise's price lives in a contract, not here. */
  unit_price_cents: number | null;
  ceiling: number;
}

interface InvitationList {
  items: Invitation[];
  seats: SeatSummary;
}

export function usePendingInvitations(options: { enabled?: boolean } = {}) {
  const api = useApiClient();
  return useQuery({
    queryKey: ['invitations'],
    queryFn: () => api.get<InvitationList>('/invitations'),
    ...(options.enabled === undefined ? {} : { enabled: options.enabled }),
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

export function InviteTeammates({
  trigger,
}: {
  /**
   * Custom trigger renderer, given the `open` callback. Lets a caller (the
   * shell's rail, FR-MOD-01.1.5) reuse this exact modal — its form state,
   * validation and mutation — under its own button instead of a second copy
   * of the component. Omitted, this renders its own default pill button
   * (TeamPage's usage).
   */
  trigger?: (open: () => void) => ReactElement;
} = {}): ReactElement {
  const t = useTranslate();
  const [open, setOpen] = useState(false);
  const [role, setRole] = useState<'admin' | 'agent'>('admin');
  const [copied, setCopied] = useState<string | null>(null);

  const api = useApiClient();
  const client = useQueryClient();

  // Only while the modal is open. The rail renders this component on every
  // screen (FR-MOD-01.1.5), and a seat summary fetched app-wide to answer a
  // question nobody has asked yet is a request per page load for nothing.
  const pending = usePendingInvitations({ enabled: open });

  const invite = useMutation({
    mutationFn: (body: { emails: string[]; role: string }) =>
      api.post<{ items: Invitation[] }>('/invitations', body),
    onSuccess: async (result) => {
      await client.invalidateQueries({ queryKey: ['invitations'] });
      const link = result.items[0]?.accept_url;
      if (link) setCopied(link);
    },
  });

  // The one validation primitive: the address list is valid when it is non-empty
  // and every line parses, and Submit stays disabled until it is (FR-EK-A.1).
  const form = useForm({
    initial: { emails: '' },
    validators: { emails: emailList() },
    onSubmit: async (values, { setFieldError, setSubmitError, reset }) => {
      try {
        await invite.mutateAsync({ emails: splitList(values.emails), role });
        reset();
      } catch (failure) {
        // The server is the final word on an address; surface its verdict under
        // the same field the person was typing into.
        if (failure instanceof ApiClientError && failure.type === 'validation') {
          const bad = failure.details?.['invalid_emails'];
          if (Array.isArray(bad)) {
            setFieldError(
              'emails',
              t('team.invite.error.invalidEmails', { emails: (bad as string[]).join(', ') }),
            );
            return;
          }
        }
        setSubmitError(
          failure instanceof ApiClientError && failure.type === 'authorization'
            ? t('team.invite.error.aboveRole')
            : t('team.invite.error.generic'),
        );
      }
    },
  });

  const emailsError = form.errorFor('emails');
  const emailCount = splitList(form.values.emails).length;

  // Half-typed input is work; losing ten addresses to a stray click is not a
  // small thing. The shared dirty guard asks before discarding and lets a clean
  // (or already-sent) form close without nagging (FR-EK-A.2).
  const close = useCloseGuard({
    isDirty: form.isDirty,
    message: t('team.invite.discardConfirm'),
    onClose: () => {
      setOpen(false);
      setRole('admin');
      setCopied(null);
      form.reset();
      invite.reset();
    },
  });

  if (!open) {
    if (trigger) return trigger(() => setOpen(true));
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white"
      >
        {t('team.invite.title')}
      </button>
    );
  }

  return (
    <Modal
      onClose={close}
      title={t('team.invite.title')}
      description={t('team.invite.description')}
    >
      <form onSubmit={form.handleSubmit} noValidate>
        {form.submitError && (
          <p role="alert" className="mb-3 text-sm text-danger">
            {form.submitError}
          </p>
        )}

        <label htmlFor="invite-emails" className="mb-1.5 block text-sm font-medium">
          {t('team.invite.emailsLabel')}
        </label>
        <textarea
          id="invite-emails"
          rows={4}
          value={form.values.emails}
          autoFocus
          onChange={(event) => form.setValue('emails', event.target.value)}
          onBlur={() => form.blur('emails')}
          aria-invalid={emailsError ? true : undefined}
          aria-describedby={emailsError ? 'invite-emails-error' : undefined}
          className="mb-1 w-full rounded-md border border-border bg-inset px-3 py-2 text-sm"
        />
        <FieldError id="invite-emails-error" message={emailsError} />

        <label htmlFor="invite-role" className="mb-1.5 mt-3 block text-sm font-medium">
          {t('team.invite.roleLabel')}
        </label>
        <select
          id="invite-role"
          value={role}
          onChange={(event) => setRole(event.target.value as 'admin')}
          className="mb-4 w-full rounded-md border border-border bg-inset px-2 py-1.5 text-sm"
        >
          <option value="admin">{t('team.role.admin')}</option>
          <option value="agent">{t('team.role.agent')}</option>
        </select>

        {pending.data && !copied && (
          <SeatNotice
            seats={pending.data.seats}
            outstanding={pending.data.items.length}
            adding={emailCount}
          />
        )}

        {copied && (
          <div className="mb-4 rounded-md border border-border bg-inset p-3">
            <p role="status" className="mb-2 text-xs text-content-secondary">
              {t('team.invite.linkSentNotice')}
            </p>
            <button
              type="button"
              onClick={() => void navigator.clipboard?.writeText(copied)}
              className="rounded-md border border-border px-2.5 py-1 text-xs font-medium"
            >
              {t('team.invite.copyLink')}
            </button>
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={close}
            className="rounded-md border border-border px-3 py-1.5 text-sm"
          >
            {copied ? t('team.invite.done') : t('team.invite.cancel')}
          </button>
          <button
            type="submit"
            disabled={!form.canSubmit}
            className="rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
          >
            {form.isSubmitting
              ? t('team.invite.sending')
              : emailCount > 0
                ? t('team.invite.submitCount', { count: emailCount })
                : t('team.invite.submit')}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/**
 * What these invitations will do to the bill, before any of them is sent
 * (FR-MOD-04.4, "koltuk faturaya yansır" — the half of that criterion facing
 * the person who is about to click).
 *
 * A seat is counted when somebody *joins*, not when they are invited, so the
 * wording is deliberately conditional ("once they accept"): an invitation that
 * is revoked or left to expire never reaches the bill. Saying "adds a seat"
 * here would be the copy promising something the server does not do.
 */
function SeatNotice({
  seats,
  outstanding,
  adding,
}: {
  seats: SeatSummary;
  outstanding: number;
  adding: number;
}): ReactElement {
  const t = useTranslate();
  const price = formatMoney(seats.unit_price_cents);
  const projected = seats.headcount + adding;
  // The server counts members plus every outstanding invitation plus this
  // request; mirrored here so the refusal is predictable rather than a
  // surprise at submit time.
  const overCeiling = seats.headcount + outstanding + adding > seats.ceiling;

  return (
    <div className="mb-4 rounded-md border border-border bg-inset p-3 text-xs text-content-secondary">
      <p>
        {seats.purchased === null
          ? t('team.invite.seats.trial')
          : t('team.invite.seats.inUse', {
              headcount: seats.headcount,
              purchased: seats.purchased,
            })}
      </p>
      <p className="mt-1">
        {adding === 0
          ? price
            ? t('team.invite.seats.rule', { price })
            : t('team.invite.seats.ruleQuoted')
          : seats.purchased !== null && projected <= seats.purchased
            ? t('team.invite.seats.within', { count: adding, purchased: seats.purchased })
            : t('team.invite.seats.projected', { count: adding, projected })}
      </p>
      {overCeiling && (
        <p role="status" className="mt-1 text-danger">
          {t('team.invite.seats.overCeiling', { ceiling: seats.ceiling })}
        </p>
      )}
    </div>
  );
}

export function PendingInvitations(): ReactElement | null {
  const t = useTranslate();
  const invitations = usePendingInvitations();
  const revoke = useRevokeInvitation();
  const items = invitations.data?.items ?? [];

  if (items.length === 0) return null;

  return (
    <table className="w-full text-sm">
      <caption className="sr-only">{t('team.invite.pending.caption')}</caption>
      <thead>
        <tr className="border-b border-border text-left">
          <th className="px-4 py-2 text-2xs font-medium uppercase tracking-wide text-content-tertiary">
            {t('team.invite.pending.email')}
          </th>
          <th className="px-4 py-2 text-2xs font-medium uppercase tracking-wide text-content-tertiary">
            {t('team.invite.pending.role')}
          </th>
          <th className="px-4 py-2 text-2xs font-medium uppercase tracking-wide text-content-tertiary">
            {t('team.invite.pending.invitedBy')}
          </th>
          <th className="px-4 py-2" />
        </tr>
      </thead>
      <tbody>
        {items.map((invite) => (
          <tr key={invite.id} className="border-b border-border last:border-0">
            <td className="px-4 py-2.5">{invite.email}</td>
            <td className="px-4 py-2.5 text-content-secondary">{t(`team.role.${invite.role}`)}</td>
            <td className="px-4 py-2.5 text-content-secondary">{invite.invited_by_name ?? '—'}</td>
            <td className="px-4 py-2.5 text-right">
              <button
                type="button"
                onClick={() => revoke.mutate(invite.id)}
                disabled={revoke.isPending}
                className="text-xs text-danger underline"
              >
                {t('team.invite.pending.revoke')}
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
