/**
 * Settings › Company › "Danger zone": hand the workspace over (RL-05 · tm 328.2).
 *
 * A pure consumer of `/ownership-transfers…` (tm 328.1). The owner (Kurucu)
 * names an active member, proves it is them again — the password, and a
 * second-factor code when the account has one — and types the workspace's name
 * so the click cannot be an accident. The member then has 72 hours to accept
 * with the token mailed to them; until then nothing changes and the owner can
 * take the offer back. Every rule — who may be offered it, one offer at a time,
 * the password and code — is the server's; this screen shows what it said.
 *
 * Owner only: the section is not drawn for anyone else, because the route would
 * only answer 403. Admins and the member offered the workspace see the pending
 * offer in the banner every page carries (`OwnershipTransferBanner`).
 *
 * **The second-factor box is always there, optional.** Whether the account has
 * two-factor authentication on is a fact this screen cannot read, and the
 * server answers a missing code with `two_factor_required`; a field that
 * appeared only after that answer would make the owner type the password twice.
 * An account without a password proves itself with the code alone, which is why
 * neither box is required on its own.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactElement } from 'react';
import type { CompanyDetails as CompanyDetailsValue } from '@siyahtus/types';
import { Card, ErrorNotice, Section } from '../../components/Page.js';
import { Modal, useConfirm } from '../../components/ui/index.js';
import { ApiClientError, errorMessageKey } from '../../lib/api-client.js';
import { useApiClient, useAuth } from '../../lib/auth-store.js';
import { FieldError, required, useForm } from '../../lib/form.js';
import { formatDateTime } from '../../lib/format.js';
import { useTranslate, type TFunction } from '../../lib/i18n.js';
import { reasonMessage } from '../../lib/reason-message.js';
import {
  OWNERSHIP_TRANSFER_KEY,
  partyLabel,
  useCurrentOwnershipTransfer,
  type OwnershipTransfer,
} from './ownership-transfer.js';

interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: string;
  suspended: boolean;
}

interface StartResult {
  transfer: OwnershipTransfer;
  mail: 'sent' | 'failed';
}

const REASON_PREFIX = 'settings.ownership.reason';

/**
 * The sentence for a refused start. The reasons have wording of their own; a
 * wrong password (`authentication`) is not "your session has expired", which is
 * what the type's general sentence says.
 */
function startFailure(t: TFunction, error: unknown): string {
  if (error instanceof ApiClientError && error.type === 'authentication') {
    return t('settings.ownership.wrongCredential');
  }
  return reasonMessage(t, error, REASON_PREFIX) ?? t(errorMessageKey(error));
}

export function OwnershipTransferZone({ isOwner }: { isOwner: boolean }): ReactElement | null {
  if (!isOwner) return null;
  return <OwnershipTransferZoneSection />;
}

function OwnershipTransferZoneSection(): ReactElement {
  const t = useTranslate();
  const current = useCurrentOwnershipTransfer();
  const [offering, setOffering] = useState(false);
  const [mail, setMail] = useState<'sent' | 'failed' | null>(null);

  return (
    <Section
      id="section-ownership"
      title={t('settings.ownership.title')}
      description={t('settings.ownership.description')}
    >
      <Card className="border-danger/40">
        <div className="flex flex-col gap-3 p-4">
          {current.isPending ? (
            <p className="text-sm text-content-secondary">{t('settings.loading')}</p>
          ) : current.error ? (
            <ErrorNotice message={t('settings.ownership.loadError')} />
          ) : current.data ? (
            <PendingOffer transfer={current.data} mail={mail} />
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{t('settings.ownership.heading')}</p>
                <p className="text-xs text-content-secondary">{t('settings.ownership.body')}</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setMail(null);
                  setOffering(true);
                }}
                className="rounded-md border border-danger px-3 py-1.5 text-sm font-medium text-danger transition-colors hover:bg-danger/10"
              >
                {t('settings.ownership.offerButton')}
              </button>
            </div>
          )}
        </div>
      </Card>
      {offering && (
        <OfferModal
          onClose={() => setOffering(false)}
          onOffered={(result) => {
            setMail(result.mail);
            setOffering(false);
          }}
        />
      )}
    </Section>
  );
}

function PendingOffer({
  transfer,
  mail,
}: {
  transfer: OwnershipTransfer;
  mail: 'sent' | 'failed' | null;
}): ReactElement {
  const t = useTranslate();
  const api = useApiClient();
  const queryClient = useQueryClient();
  const { confirm, dialog } = useConfirm();
  const to = partyLabel(transfer.to_agent);

  const cancel = useMutation({
    mutationFn: () => api.request<undefined>('DELETE', `/ownership-transfers/${transfer.id}`),
    onSettled: () => queryClient.invalidateQueries({ queryKey: OWNERSHIP_TRANSFER_KEY }),
  });

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">
            {t('settings.ownership.pendingTitle', { name: to })}
          </p>
          <p className="text-xs text-content-secondary">
            {t('settings.ownership.pendingBody', {
              email: transfer.to_agent.email,
              expires: formatDateTime(transfer.expires_at) ?? '',
            })}
          </p>
        </div>
        <button
          type="button"
          disabled={cancel.isPending}
          onClick={() =>
            confirm({
              title: t('settings.ownership.cancelConfirmTitle', { name: to }),
              description: t('settings.ownership.cancelConfirmBody'),
              confirmLabel: t('settings.ownership.cancelConfirmButton'),
              failureTitle: t('settings.ownership.cancelFailed'),
              onConfirm: () => cancel.mutateAsync(),
            })
          }
          className="rounded-md border border-danger px-3 py-1.5 text-sm font-medium text-danger transition-colors hover:bg-danger/10 disabled:opacity-50"
        >
          {t('settings.ownership.cancelButton')}
        </button>
      </div>
      {mail === 'failed' && (
        <p role="alert" className="text-xs text-danger">
          {t('settings.ownership.mailFailed', { email: transfer.to_agent.email })}
        </p>
      )}
      {mail === 'sent' && (
        <p role="status" className="text-xs text-content-secondary">
          {t('settings.ownership.mailSent', { email: transfer.to_agent.email })}
        </p>
      )}
      {dialog}
    </div>
  );
}

type OfferValues = Record<'target' | 'password' | 'totp' | 'confirmName', string>;

function OfferModal({
  onClose,
  onOffered,
}: {
  onClose: () => void;
  onOffered: (result: StartResult) => void;
}): ReactElement {
  const t = useTranslate();
  const api = useApiClient();
  const queryClient = useQueryClient();
  const selfId = useAuth((s) => s.agent?.account_id ?? null);

  const team = useQuery({
    queryKey: ['team', 'agents'],
    queryFn: () => api.get<{ items: TeamMember[] }>('/agents'),
  });
  const company = useQuery({
    queryKey: ['settings', 'company'],
    queryFn: () => api.get<CompanyDetailsValue>('/settings/company'),
  });

  const start = useMutation({
    mutationFn: (body: { target_agent_id: string; password?: string; totp?: string }) =>
      api.post<StartResult>('/ownership-transfers', body),
    onSuccess: (result) => {
      queryClient.setQueryData(OWNERSHIP_TRANSFER_KEY, result.transfer);
    },
  });

  // The server decides who can hold the workspace; this only leaves out the
  // rows it would refuse on sight (the owner, a suspended member), so the list
  // is not a menu of certain refusals. Unverified or second-factor-less members
  // stay: the server's reason names what to fix.
  const candidates = (team.data?.items ?? []).filter(
    (member) => member.id !== selfId && member.role !== 'owner' && !member.suspended,
  );
  const workspaceName = company.data?.name ?? '';

  const form = useForm<OfferValues>({
    initial: { target: '', password: '', totp: '', confirmName: '' },
    validators: {
      target: required(t('settings.ownership.targetRequired')),
      confirmName: (value) =>
        workspaceName !== '' && value.trim() === workspaceName
          ? null
          : t('settings.ownership.confirmNameMismatch'),
    },
    onSubmit: async (values, { setSubmitError, setFieldError }) => {
      const password = values.password;
      const totp = values.totp.trim();
      if (password === '' && totp === '') {
        setFieldError('password', t('settings.ownership.credentialRequired'));
        return;
      }
      try {
        const result = await start.mutateAsync({
          target_agent_id: values.target,
          ...(password === '' ? {} : { password }),
          ...(totp === '' ? {} : { totp }),
        });
        onOffered(result);
      } catch (error) {
        setSubmitError(startFailure(t, error));
      }
    },
  });

  const targetError = form.errorFor('target');
  const passwordError = form.errorFor('password');
  const confirmError = form.errorFor('confirmName');

  return (
    <Modal onClose={onClose} title={t('settings.ownership.modalTitle')} className="w-[28rem]">
      <form onSubmit={form.handleSubmit} noValidate className="flex flex-col gap-3">
        <p className="text-xs text-content-secondary">{t('settings.ownership.modalBody')}</p>

        {team.error && <ErrorNotice message={t('settings.ownership.membersError')} />}

        <div className="flex flex-col gap-1">
          <label
            htmlFor="ownership-target"
            className="text-2xs font-medium uppercase tracking-wide text-content-tertiary"
          >
            {t('settings.ownership.targetLabel')}
          </label>
          <select
            id="ownership-target"
            value={form.values.target}
            onChange={(event) => form.setValue('target', event.target.value)}
            onBlur={() => form.blur('target')}
            aria-invalid={targetError ? true : undefined}
            aria-describedby={targetError ? 'ownership-target-error' : undefined}
            className="rounded-md border border-border bg-inset px-2 py-1.5 text-sm outline-none"
          >
            <option value="">{t('settings.ownership.targetPlaceholder')}</option>
            {candidates.map((member) => (
              <option key={member.id} value={member.id}>
                {member.name} ({member.email})
              </option>
            ))}
          </select>
          <FieldError id="ownership-target-error" message={targetError} />
        </div>

        <div className="flex flex-col gap-1">
          <label
            htmlFor="ownership-password"
            className="text-2xs font-medium uppercase tracking-wide text-content-tertiary"
          >
            {t('settings.ownership.passwordLabel')}
          </label>
          <input
            id="ownership-password"
            type="password"
            autoComplete="current-password"
            value={form.values.password}
            onChange={(event) => form.setValue('password', event.target.value)}
            aria-invalid={passwordError ? true : undefined}
            aria-describedby={passwordError ? 'ownership-password-error' : undefined}
            className="rounded-md border border-border bg-inset px-2 py-1.5 text-sm outline-none"
          />
          <FieldError id="ownership-password-error" message={passwordError} />
        </div>

        <div className="flex flex-col gap-1">
          <label
            htmlFor="ownership-totp"
            className="text-2xs font-medium uppercase tracking-wide text-content-tertiary"
          >
            {t('settings.ownership.totpLabel')}
          </label>
          <input
            id="ownership-totp"
            type="text"
            autoComplete="one-time-code"
            value={form.values.totp}
            onChange={(event) => form.setValue('totp', event.target.value)}
            className="rounded-md border border-border bg-inset px-2 py-1.5 text-sm outline-none"
          />
          <p className="text-2xs text-content-tertiary">{t('settings.ownership.totpHint')}</p>
        </div>

        <div className="flex flex-col gap-1">
          <label
            htmlFor="ownership-confirm-name"
            className="text-2xs font-medium uppercase tracking-wide text-content-tertiary"
          >
            {t('settings.ownership.confirmNameLabel')}
          </label>
          <p className="text-xs text-content-secondary">
            {t('settings.ownership.confirmNameHint', { name: workspaceName })}
          </p>
          <input
            id="ownership-confirm-name"
            type="text"
            autoComplete="off"
            value={form.values.confirmName}
            onChange={(event) => form.setValue('confirmName', event.target.value)}
            onBlur={() => form.blur('confirmName')}
            aria-invalid={confirmError ? true : undefined}
            aria-describedby={confirmError ? 'ownership-confirm-name-error' : undefined}
            className="rounded-md border border-border bg-inset px-2 py-1.5 text-sm outline-none"
          />
          <FieldError id="ownership-confirm-name-error" message={confirmError} />
        </div>

        {form.submitError && (
          <p role="alert" className="text-xs text-danger">
            {form.submitError}
          </p>
        )}

        <div className="mt-1 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-border px-3 py-1.5 text-sm"
          >
            {t('settings.cancel')}
          </button>
          <button
            type="submit"
            disabled={!form.canSubmit}
            className="rounded-md border border-danger px-3 py-1.5 text-sm font-medium text-danger transition-colors hover:bg-danger/10 disabled:opacity-50"
          >
            {form.isSubmitting
              ? t('settings.ownership.offering')
              : t('settings.ownership.offerConfirm')}
          </button>
        </div>
      </form>
    </Modal>
  );
}
