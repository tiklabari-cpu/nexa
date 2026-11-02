/**
 * `/app/ownership-transfer?transfer=<id>&token=<token>` — the page the offer's
 * e-mail leads to (RL-05 · tm 328.2).
 *
 * The member offered the workspace reads who is offering it and until when,
 * and accepts with the token from that mail. Accepting is the whole point of
 * the page, so it asks nothing it does not need: the signed-in session is the
 * identity, the token is the proof the mail reached them, and the server checks
 * both (`403` for anyone else, a wrong token, a transfer no longer pending).
 *
 * **Coming back from sign-in is free.** A member who opens the link signed out
 * meets the sign-in form at this very address (`App` renders it for every path
 * while there is no session), and the router never leaves the address — so once
 * they are in, this page is what renders, token and all.
 *
 * The token stays in the address until the offer is accepted: it is the only
 * copy the member has besides the mail, and a reload must not lose it. It is
 * single-use and goes dead the moment the transfer is decided, and then this
 * page takes it out of the address. When it is not there at all (the banner
 * leads here without one) the page asks for it.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactElement } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Card, ErrorNotice, Page } from '../../components/Page.js';
import { ApiClientError, errorMessageKey } from '../../lib/api-client.js';
import { useApiClient, useAuth } from '../../lib/auth-store.js';
import { useDeployment } from '../../lib/deployment.js';
import { FieldError, required, useForm } from '../../lib/form.js';
import { formatDateTime } from '../../lib/format.js';
import { useTranslate, type TFunction } from '../../lib/i18n.js';
import { reasonMessage } from '../../lib/reason-message.js';
import {
  OWNERSHIP_TRANSFER_KEY,
  partyLabel,
  useCurrentOwnershipTransfer,
  type BillingContactOutcome,
  type OwnershipTransfer,
} from './ownership-transfer.js';

interface Accepted {
  transfer: OwnershipTransfer;
  billing_contact: BillingContactOutcome;
}

const REASON_PREFIX = 'settings.ownership.reason';

function acceptFailure(t: TFunction, error: unknown): string {
  return reasonMessage(t, error, REASON_PREFIX) ?? t(errorMessageKey(error));
}

export function OwnershipTransferPage(): ReactElement {
  const t = useTranslate();
  const [params, setParams] = useSearchParams();
  const transferId = params.get('transfer') ?? '';
  const urlToken = params.get('token') ?? '';
  const selfId = useAuth((s) => s.agent?.account_id ?? null);
  const selfEmail = useAuth((s) => s.agent?.email ?? '');
  const current = useCurrentOwnershipTransfer();
  const [accepted, setAccepted] = useState<Accepted | null>(null);

  const title = t('settings.ownership.accept.title');

  if (accepted) {
    return (
      <Page title={t('settings.ownership.accept.doneTitle')}>
        <AcceptedNotice accepted={accepted} />
      </Page>
    );
  }

  const transfer = current.data ?? null;
  // An offer is only this page's business while it is the pending one the link
  // names; anything else — taken back, run out, already accepted — reads the same.
  const open = transfer !== null && transfer.state === 'pending' && transfer.id === transferId;

  return (
    <Page title={title} description={t('settings.ownership.accept.description')}>
      <Card>
        <div className="flex flex-col gap-3 p-4">
          {current.isPending ? (
            <p className="text-sm text-content-secondary">{t('settings.loading')}</p>
          ) : current.error ? (
            <ErrorNotice message={t('settings.ownership.loadError')} />
          ) : !open ? (
            <ClosedNotice />
          ) : transfer.to_agent.id !== selfId ? (
            <p role="alert" className="text-sm text-danger">
              {t('settings.ownership.accept.wrongAccount', {
                email: transfer.to_agent.email,
                current: selfEmail,
              })}
            </p>
          ) : (
            <AcceptForm
              transfer={transfer}
              urlToken={urlToken}
              onAccepted={(result) => {
                setAccepted(result);
                // The token is dead now; take it out of the address.
                setParams({ transfer: result.transfer.id }, { replace: true });
              }}
            />
          )}
        </div>
      </Card>
    </Page>
  );
}

function ClosedNotice(): ReactElement {
  const t = useTranslate();
  return (
    <div className="flex flex-col items-start gap-3">
      <p className="text-sm text-content-secondary">{t('settings.ownership.accept.closed')}</p>
      <Link
        to="/app/inbox"
        className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-content-secondary hover:bg-surface-2"
      >
        {t('shell.notFound.back')}
      </Link>
    </div>
  );
}

function AcceptForm({
  transfer,
  urlToken,
  onAccepted,
}: {
  transfer: OwnershipTransfer;
  urlToken: string;
  onAccepted: (result: Accepted) => void;
}): ReactElement {
  const t = useTranslate();
  const api = useApiClient();
  const queryClient = useQueryClient();
  const refreshAccess = useAuth((s) => s.refreshAccess);
  const from = partyLabel(transfer.from_agent);

  const accept = useMutation({
    mutationFn: (token: string) =>
      api.post<Accepted>(`/ownership-transfers/${transfer.id}/accept`, { token }),
  });

  const form = useForm<{ token: string }>({
    initial: { token: urlToken },
    // Only asked for when the link did not carry it.
    validators:
      urlToken === '' ? { token: required(t('settings.ownership.accept.tokenRequired')) } : {},
    onSubmit: async (values, { setSubmitError }) => {
      try {
        const result = await accept.mutateAsync(values.token.trim());
        // The role changed at once on the server; this tab's profile was read
        // before. A failed re-read leaves the old profile until the next
        // sign-in, which the confirmation below does not depend on.
        await refreshAccess().catch(() => undefined);
        queryClient.setQueryData(OWNERSHIP_TRANSFER_KEY, null);
        onAccepted(result);
        // Everything the old role cached — the roster, the navigation, the
        // settings this member could not open — is read again.
        void queryClient.invalidateQueries();
      } catch (error) {
        // A transfer that is no longer pending (or whose owner changed) should
        // stop being offered here.
        if (error instanceof ApiClientError && error.type === 'ownership_transfer_state') {
          void queryClient.invalidateQueries({ queryKey: OWNERSHIP_TRANSFER_KEY });
        }
        setSubmitError(acceptFailure(t, error));
      }
    },
  });

  const tokenError = form.errorFor('token');

  return (
    <form onSubmit={form.handleSubmit} noValidate className="flex flex-col gap-3">
      <p className="text-sm">
        {t('settings.ownership.accept.offer', {
          name: from,
          email: transfer.from_agent.email,
        })}
      </p>
      <p className="text-xs text-content-secondary">
        {t('settings.ownership.accept.consequence', {
          name: from,
          expires: formatDateTime(transfer.expires_at) ?? '',
        })}
      </p>
      {transfer.sso_enforced && (
        <p className="text-xs text-content-secondary">
          {t('settings.ownership.accept.sso', { name: from })}
        </p>
      )}

      {urlToken === '' && (
        <div className="flex max-w-md flex-col gap-1">
          <label
            htmlFor="ownership-accept-token"
            className="text-2xs font-medium uppercase tracking-wide text-content-tertiary"
          >
            {t('settings.ownership.accept.tokenLabel')}
          </label>
          <input
            id="ownership-accept-token"
            type="text"
            autoComplete="off"
            value={form.values.token}
            onChange={(event) => form.setValue('token', event.target.value)}
            onBlur={() => form.blur('token')}
            aria-invalid={tokenError ? true : undefined}
            aria-describedby={tokenError ? 'ownership-accept-token-error' : undefined}
            className="rounded-md border border-border bg-inset px-2 py-1.5 text-sm outline-none"
          />
          <p className="text-2xs text-content-tertiary">
            {t('settings.ownership.accept.tokenHint')}
          </p>
          <FieldError id="ownership-accept-token-error" message={tokenError} />
        </div>
      )}

      {form.submitError && (
        <p role="alert" className="text-xs text-danger">
          {form.submitError}
        </p>
      )}

      <div>
        <button
          type="submit"
          disabled={!form.canSubmit}
          className="rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-50"
        >
          {form.isSubmitting
            ? t('settings.ownership.accept.accepting')
            : t('settings.ownership.accept.button')}
        </button>
      </div>
    </form>
  );
}

function AcceptedNotice({ accepted }: { accepted: Accepted }): ReactElement {
  const t = useTranslate();
  const { pilot_mode: pilotMode } = useDeployment();
  const from = partyLabel(accepted.transfer.from_agent);

  return (
    <Card>
      <div className="flex flex-col gap-3 p-4">
        <p role="status" className="text-sm font-medium">
          {t('settings.ownership.accept.done', { name: from })}
        </p>
        <p className="text-xs text-content-secondary">
          {t('settings.ownership.accept.doneRoles', { name: from })}
        </p>
        {accepted.transfer.sso_enforced && (
          <p className="text-xs text-content-secondary">
            {t('settings.ownership.accept.sso', { name: from })}
          </p>
        )}
        {accepted.billing_contact === 'moved' && (
          <p className="text-xs text-content-secondary">
            {t('settings.ownership.accept.billingMoved')}
          </p>
        )}
        {accepted.billing_contact === 'kept' && (
          <p className="text-xs text-content-secondary">
            {t('settings.ownership.accept.billingKept')}
            {!pilotMode && (
              <>
                {' '}
                <Link to="/app/billing" className="text-content-brand underline">
                  {t('settings.ownership.accept.billingLink')}
                </Link>
              </>
            )}
          </p>
        )}
        <div>
          <Link
            to="/app/inbox"
            className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-content-secondary hover:bg-surface-2"
          >
            {t('shell.notFound.back')}
          </Link>
        </div>
      </div>
    </Card>
  );
}
