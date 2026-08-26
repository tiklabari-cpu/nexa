/**
 * Account settings — two-factor authentication (NFR-S11 · FR-MOD-00.1 · S11-2FA-f).
 *
 * A pure consumer of the four endpoints S11-2FA-d built and the enforcement
 * S11-2FA-e reads: `POST /auth/2fa/enroll` mints a secret, `POST /auth/2fa/activate`
 * confirms it and hands back the recovery sheet, `DELETE /auth/2fa` and
 * `POST /auth/2fa/recovery-codes` both re-authenticate first. Status itself has no
 * endpoint of its own — it rides on `GET /auth/me`'s `two_factor` object, which is
 * this screen's only reason to exist (S11-2FA-d's doc comment).
 *
 * NO QR CODE: a new QR-rendering dependency is a bundle and maintenance cost for
 * something an `otpauth://` URI already solves — every authenticator app accepts
 * manual entry, and the secret is shown as copyable text for exactly that. A
 * deliberate decision, not a gap.
 *
 * The recovery sheet is shown once, the same "shown once" contract
 * `DeveloperPortal.tsx`'s `SecretOncePanel` established for a client secret —
 * closing the panel drops the codes from component state and nothing else ever
 * held a copy. Unlike that panel, closing here is guarded (`lib/dirty-guard.tsx`,
 * EK-A.2) until the "I saved these" box is checked: a client secret can be
 * rotated again on demand, a lost recovery sheet cannot be recovered at all.
 *
 * Removing the factor or reissuing the sheet re-authenticates first
 * (`twoFactorReauthentication`): normally the account password, or — for an
 * SSO-provisioned account with no password — a current TOTP or recovery code.
 * Which one the server wants is a fact about the account this screen cannot see in
 * advance, so the reauth form defaults to a password field and switches to a code
 * field the moment the server answers `two_factor_required`, which is exactly the
 * signal `reauthenticate()` sends for that case.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactElement } from 'react';
import { Card, ErrorNotice, Section } from '../../components/Page.js';
import { Modal } from '../../components/ui/index.js';
import { ApiClientError, errorMessageKey } from '../../lib/api-client.js';
import { useApiClient, useAuth } from '../../lib/auth-store.js';
import { useCloseGuard } from '../../lib/dirty-guard.js';
import { FieldError, required, useForm } from '../../lib/form.js';
import { useTranslate, type TFunction } from '../../lib/i18n.js';

interface TwoFactorStatus {
  enabled: boolean;
  pending: boolean;
  recovery_codes_remaining: number;
}

interface EnrollmentStart {
  secret: string;
  otpauth_uri: string;
  issuer: string;
  account_name: string;
}

interface ActivationResult {
  enabled: true;
  recovery_codes: string[];
  recovery_codes_remaining: number;
}

interface RecoveryCodesResult {
  recovery_codes: string[];
  recovery_codes_remaining: number;
}

type ReauthAction = 'disable' | 'regenerate';

const QUERY_KEY = ['settings', 'two-factor'];

/** Ready for an `<a download>` / `URL.createObjectURL` link — `BulkImportForm.tsx`'s pattern. */
function downloadRecoveryCodes(codes: string[]): void {
  const blob = new Blob([codes.join('\n') + '\n'], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'nexa-recovery-codes.txt';
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function workspaceNames(details: Record<string, unknown> | undefined): string[] {
  const raw = details?.['workspaces'];
  return Array.isArray(raw) ? raw.filter((v): v is string => typeof v === 'string') : [];
}

export function TwoFactor(): ReactElement {
  const t = useTranslate();
  const api = useApiClient();
  const queryClient = useQueryClient();
  const scopes = useAuth((s) => s.agent?.scopes ?? []);
  // Own-account resource, not a workspace setting: gated on the session's own
  // scope rather than a `canEdit` prop `SettingsPage.tsx` would compute from a
  // workspace role. `DEFAULT_AGENT_SCOPES` not yet carrying this scope for the
  // plain `agent` role is a known, separately-tracked gap (tm 152.5 HANDOFF) —
  // this screen renders read-only for a session that lacks it, the same shape
  // every other settings section falls back to.
  const canEdit = scopes.includes('accounts--my:rw');

  const status = useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => api.get<{ two_factor: TwoFactorStatus }>('/auth/me').then((r) => r.two_factor),
  });

  const [enrollment, setEnrollment] = useState<EnrollmentStart | null>(null);
  const [recoverySheet, setRecoverySheet] = useState<string[] | null>(null);
  const [reauthAction, setReauthAction] = useState<ReauthAction | null>(null);

  const enroll = useMutation({
    mutationFn: () => api.post<EnrollmentStart>('/auth/2fa/enroll'),
    onSuccess: (data) => setEnrollment(data),
  });

  function applyStatus(next: TwoFactorStatus): void {
    queryClient.setQueryData<TwoFactorStatus>(QUERY_KEY, next);
  }

  if (status.error) return <ErrorNotice message={t('settings.twoFactor.loadError')} />;

  return (
    <Section
      id="section-two-factor"
      title={t('settings.twoFactor.title')}
      description={t('settings.twoFactor.description')}
    >
      <Card>
        {status.isPending ? (
          <p className="p-4 text-sm text-content-secondary">{t('settings.loading')}</p>
        ) : (
          <TwoFactorStatusPanel
            t={t}
            status={status.data}
            canEdit={canEdit}
            onEnable={() => enroll.mutate()}
            enabling={enroll.isPending}
            enableErrorMessage={enroll.isError ? t(errorMessageKey(enroll.error)) : null}
            onDisable={() => setReauthAction('disable')}
            onRegenerate={() => setReauthAction('regenerate')}
          />
        )}
      </Card>

      {enrollment && (
        <EnrollmentModal
          enrollment={enrollment}
          onClose={() => setEnrollment(null)}
          onActivated={(result) => {
            applyStatus({
              enabled: true,
              pending: false,
              recovery_codes_remaining: result.recovery_codes_remaining,
            });
            setEnrollment(null);
            setRecoverySheet(result.recovery_codes);
          }}
        />
      )}

      {recoverySheet && (
        <RecoveryCodesModal codes={recoverySheet} onClose={() => setRecoverySheet(null)} />
      )}

      {reauthAction && (
        <ReauthModal
          action={reauthAction}
          onClose={() => setReauthAction(null)}
          onDisabled={() => {
            applyStatus({ enabled: false, pending: false, recovery_codes_remaining: 0 });
            setReauthAction(null);
          }}
          onRegenerated={(result) => {
            applyStatus({
              enabled: true,
              pending: false,
              recovery_codes_remaining: result.recovery_codes_remaining,
            });
            setReauthAction(null);
            setRecoverySheet(result.recovery_codes);
          }}
        />
      )}
    </Section>
  );
}

function TwoFactorStatusPanel({
  t,
  status,
  canEdit,
  onEnable,
  enabling,
  enableErrorMessage,
  onDisable,
  onRegenerate,
}: {
  t: TFunction;
  status: TwoFactorStatus;
  canEdit: boolean;
  onEnable: () => void;
  enabling: boolean;
  enableErrorMessage: string | null;
  onDisable: () => void;
  onRegenerate: () => void;
}): ReactElement {
  if (!status.enabled) {
    return (
      <div className="flex flex-col gap-3 p-4">
        <div className="flex items-center gap-2 text-sm">
          <span className="rounded-sm bg-inset px-1.5 py-0.5 text-2xs font-medium text-content-secondary">
            {t('settings.off')}
          </span>
          <span className="text-content-secondary">{t('settings.twoFactor.offDescription')}</span>
        </div>
        {status.pending && (
          <p className="text-2xs text-content-tertiary">{t('settings.twoFactor.pendingHint')}</p>
        )}
        {enableErrorMessage && <ErrorNotice message={enableErrorMessage} />}
        {canEdit && (
          <div>
            <button
              type="button"
              onClick={onEnable}
              disabled={enabling}
              className="rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-50"
            >
              {enabling ? t('settings.twoFactor.enabling') : t('settings.twoFactor.enableButton')}
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex items-center gap-2 text-sm">
        <span className="rounded-sm bg-success/10 px-1.5 py-0.5 text-2xs font-medium text-success">
          {t('settings.on')}
        </span>
        <span className="text-content-secondary">
          {t('settings.twoFactor.recoveryCodesRemaining', {
            count: status.recovery_codes_remaining,
          })}
        </span>
      </div>
      {canEdit && (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onRegenerate}
            className="rounded-md border border-border px-3 py-1.5 text-sm"
          >
            {t('settings.twoFactor.regenerateButton')}
          </button>
          <button
            type="button"
            onClick={onDisable}
            className="rounded-md border border-danger px-3 py-1.5 text-sm font-medium text-danger transition-colors hover:bg-danger/10"
          >
            {t('settings.twoFactor.disableButton')}
          </button>
        </div>
      )}
    </div>
  );
}

function EnrollmentModal({
  enrollment,
  onClose,
  onActivated,
}: {
  enrollment: EnrollmentStart;
  onClose: () => void;
  onActivated: (result: ActivationResult) => void;
}): ReactElement {
  const t = useTranslate();
  const api = useApiClient();
  const [copied, setCopied] = useState<'secret' | 'uri' | null>(null);

  const activate = useMutation({
    mutationFn: (code: string) => api.post<ActivationResult>('/auth/2fa/activate', { code }),
  });

  const form = useForm<{ code: string }>({
    initial: { code: '' },
    validators: { code: required(t('settings.twoFactor.enroll.codeError')) },
    onSubmit: async (values, { setSubmitError }) => {
      try {
        const result = await activate.mutateAsync(values.code);
        onActivated(result);
      } catch (error) {
        setSubmitError(t(errorMessageKey(error)));
      }
    },
  });

  const close = useCloseGuard({
    isDirty: form.values.code.trim().length > 0,
    message: t('settings.twoFactor.enroll.discardConfirm'),
    onClose,
  });

  function copy(field: 'secret' | 'uri', text: string): void {
    void navigator.clipboard?.writeText(text).then(
      () => {
        setCopied(field);
        window.setTimeout(() => setCopied(null), 1_500);
      },
      () => setCopied(null),
    );
  }

  return (
    <Modal
      onClose={close}
      title={t('settings.twoFactor.enroll.title')}
      description={t('settings.twoFactor.enroll.description')}
      className="w-[28rem]"
    >
      <form onSubmit={form.handleSubmit} noValidate className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <span className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
            {t('settings.twoFactor.enroll.secretLabel')}
          </span>
          <div className="flex items-center gap-2">
            <code className="flex-1 truncate rounded-md border border-border bg-inset px-2 py-1.5 text-2xs">
              {enrollment.secret}
            </code>
            <button
              type="button"
              onClick={() => copy('secret', enrollment.secret)}
              aria-label={t('settings.twoFactor.enroll.copySecretAriaLabel')}
              className="shrink-0 rounded-md bg-brand-500 px-2.5 py-1 text-2xs font-medium text-white transition-colors hover:bg-brand-600"
            >
              {copied === 'secret' ? t('settings.copied') : t('settings.copy')}
            </button>
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
            {t('settings.twoFactor.enroll.uriLabel')}
          </span>
          <div className="flex items-center gap-2">
            <code className="flex-1 truncate rounded-md border border-border bg-inset px-2 py-1.5 text-2xs">
              {enrollment.otpauth_uri}
            </code>
            <button
              type="button"
              onClick={() => copy('uri', enrollment.otpauth_uri)}
              aria-label={t('settings.twoFactor.enroll.copyUriAriaLabel')}
              className="shrink-0 rounded-md bg-brand-500 px-2.5 py-1 text-2xs font-medium text-white transition-colors hover:bg-brand-600"
            >
              {copied === 'uri' ? t('settings.copied') : t('settings.copy')}
            </button>
          </div>
        </div>

        <label htmlFor="two-factor-enroll-code" className="flex flex-col gap-1">
          <span className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
            {t('settings.twoFactor.enroll.codeLabel')}
          </span>
          <input
            id="two-factor-enroll-code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            value={form.values.code}
            onChange={(event) => form.setValue('code', event.target.value)}
            onBlur={() => form.blur('code')}
            aria-invalid={form.errorFor('code') ? true : undefined}
            aria-describedby={form.errorFor('code') ? 'two-factor-enroll-code-error' : undefined}
            className="rounded-md border border-border bg-inset px-2 py-1.5 text-sm outline-none"
          />
        </label>
        <FieldError id="two-factor-enroll-code-error" message={form.errorFor('code')} />

        {form.submitError && (
          <p role="alert" className="text-2xs text-danger">
            {form.submitError}
          </p>
        )}

        <div className="mt-1 flex justify-end gap-2">
          <button
            type="button"
            onClick={close}
            className="rounded-md border border-border px-3 py-1.5 text-sm"
          >
            {t('settings.cancel')}
          </button>
          <button
            type="submit"
            disabled={!form.canSubmit}
            className="rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-50"
          >
            {form.isSubmitting
              ? t('settings.twoFactor.enroll.verifying')
              : t('settings.twoFactor.enroll.verifyButton')}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function RecoveryCodesModal({
  codes,
  onClose,
}: {
  codes: string[];
  onClose: () => void;
}): ReactElement {
  const t = useTranslate();
  const [saved, setSaved] = useState(false);

  // "Dirty" here means "not yet confirmed saved" — the same shape every other
  // dirty guard protects, applied to a one-time secret instead of typed input.
  // Escape/backdrop ask before discarding until the box below is checked;
  // "Done" only exists once it is, so it never needs to ask.
  const close = useCloseGuard({
    isDirty: !saved,
    message: t('settings.twoFactor.recovery.discardConfirm'),
    onClose,
  });

  return (
    <Modal
      onClose={close}
      title={t('settings.twoFactor.recovery.title')}
      description={t('settings.twoFactor.recovery.description')}
      className="w-[28rem]"
    >
      <div className="flex flex-col gap-3">
        <ul className="grid grid-cols-2 gap-1.5 rounded-md border border-border bg-inset p-3">
          {codes.map((code) => (
            <li key={code}>
              <code className="text-2xs">{code}</code>
            </li>
          ))}
        </ul>

        <div>
          <button
            type="button"
            onClick={() => downloadRecoveryCodes(codes)}
            className="rounded-md border border-border px-3 py-1.5 text-sm"
          >
            {t('settings.twoFactor.recovery.downloadButton')}
          </button>
        </div>

        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={saved}
            onChange={(event) => setSaved(event.target.checked)}
          />
          <span>{t('settings.twoFactor.recovery.savedConfirm')}</span>
        </label>

        <div className="mt-1 flex justify-end">
          <button
            type="button"
            onClick={close}
            disabled={!saved}
            className="rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-50"
          >
            {t('settings.twoFactor.recovery.doneButton')}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function ReauthModal({
  action,
  onClose,
  onDisabled,
  onRegenerated,
}: {
  action: ReauthAction;
  onClose: () => void;
  onDisabled: () => void;
  onRegenerated: (result: RecoveryCodesResult) => void;
}): ReactElement {
  const t = useTranslate();
  const api = useApiClient();
  // Which credential the server wants is a fact about the account this screen
  // cannot see in advance (`twoFactorReauthentication`) — defaults to the common
  // case (a password) and switches once the server actually says otherwise.
  const [mode, setMode] = useState<'password' | 'code'>('password');
  const [blockedByWorkspaces, setBlockedByWorkspaces] = useState<string[] | null>(null);

  const submit = useMutation<
    RecoveryCodesResult | undefined,
    unknown,
    { password?: string; code?: string }
  >({
    mutationFn: (body) => {
      // Written as two statements rather than a ternary so the two generic
      // type arguments never sit next to each other on one expression — the
      // i18n prose scanner reads the angle brackets of adjacent `<Type>` calls
      // as a JSX tag pair and the code between them as its text content.
      if (action === 'disable') return api.request<undefined>('DELETE', '/auth/2fa', body);
      return api.post<RecoveryCodesResult>('/auth/2fa/recovery-codes', body);
    },
  });

  const form = useForm<{ credential: string }>({
    initial: { credential: '' },
    validators: { credential: required(t('settings.twoFactor.reauth.credentialError')) },
    onSubmit: async (values, { setSubmitError }) => {
      const body =
        mode === 'password' ? { password: values.credential } : { code: values.credential };
      try {
        const result = await submit.mutateAsync(body);
        if (action === 'disable') onDisabled();
        else onRegenerated(result!);
      } catch (error) {
        if (error instanceof ApiClientError && error.type === 'not_allowed') {
          setBlockedByWorkspaces(workspaceNames(error.details));
          return;
        }
        if (
          error instanceof ApiClientError &&
          error.type === 'two_factor_required' &&
          mode === 'password'
        ) {
          setMode('code');
          form.setValue('credential', '');
          setSubmitError(t(errorMessageKey(error)));
          return;
        }
        setSubmitError(t(errorMessageKey(error)));
      }
    },
  });

  const close = useCloseGuard({
    isDirty: form.values.credential.trim().length > 0,
    message: t('settings.twoFactor.reauth.discardConfirm'),
    onClose,
  });

  const title =
    action === 'disable'
      ? t('settings.twoFactor.reauth.disableTitle')
      : t('settings.twoFactor.reauth.regenerateTitle');

  return (
    <Modal onClose={close} title={title} className="w-[24rem]">
      {blockedByWorkspaces ? (
        <div className="flex flex-col gap-3">
          <ErrorNotice
            message={t('settings.twoFactor.disableBlockedByWorkspaces', {
              names: blockedByWorkspaces.join(', '),
            })}
          />
          <div className="flex justify-end">
            <button
              type="button"
              onClick={close}
              className="rounded-md border border-border px-3 py-1.5 text-sm"
            >
              {t('settings.cancel')}
            </button>
          </div>
        </div>
      ) : (
        <form onSubmit={form.handleSubmit} noValidate className="flex flex-col gap-3">
          <label htmlFor="two-factor-reauth-credential" className="flex flex-col gap-1">
            <span className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
              {mode === 'password'
                ? t('settings.twoFactor.reauth.passwordLabel')
                : t('settings.twoFactor.reauth.codeLabel')}
            </span>
            <input
              id="two-factor-reauth-credential"
              type={mode === 'password' ? 'password' : 'text'}
              autoComplete={mode === 'password' ? 'current-password' : 'one-time-code'}
              value={form.values.credential}
              onChange={(event) => form.setValue('credential', event.target.value)}
              onBlur={() => form.blur('credential')}
              aria-invalid={form.errorFor('credential') ? true : undefined}
              aria-describedby={
                form.errorFor('credential') ? 'two-factor-reauth-credential-error' : undefined
              }
              className="rounded-md border border-border bg-inset px-2 py-1.5 text-sm outline-none"
            />
          </label>
          <FieldError
            id="two-factor-reauth-credential-error"
            message={form.errorFor('credential')}
          />

          {form.submitError && (
            <p role="alert" className="text-2xs text-danger">
              {form.submitError}
            </p>
          )}

          <div className="mt-1 flex justify-end gap-2">
            <button
              type="button"
              onClick={close}
              className="rounded-md border border-border px-3 py-1.5 text-sm"
            >
              {t('settings.cancel')}
            </button>
            <button
              type="submit"
              disabled={!form.canSubmit}
              className="rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-50"
            >
              {form.isSubmitting
                ? t('settings.twoFactor.reauth.confirming')
                : t('settings.twoFactor.reauth.confirmButton')}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
