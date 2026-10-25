/**
 * Step two of the operator sign-in: the second factor (tm 389.6 · FR-ADMIN-02).
 *
 * The password earned a `password`-stage session and the server says which code is owed:
 * `totp_enroll` for an operator with no authenticator yet (the bootstrap superadmin, an accepted
 * invitation, a reset factor) and `totp_verify` for everyone else. Both end the same way — a new
 * token under which the session is `active` — and the enrolment also issues the recovery sheet,
 * which `RecoveryCodesPage` holds the shell back for.
 *
 * A reloaded tab lands here too: `restore()` learns the step from the 403
 * `platform_totp_required` that `GET /auth/me` answers a `password`-stage session with.
 */
import { useEffect, useState, type ReactElement } from 'react';
import { ApiClientError, errorMessageKey } from '../../lib/api-client.js';
import { useAuth } from '../../lib/auth-store.js';
import { FieldError, compose, minLength, required, useForm } from '../../lib/form.js';
import { useTranslate } from '../../lib/i18n.js';
import { AuthLayout, INPUT_CLASS, LINK_BUTTON_CLASS, PRIMARY_BUTTON_CLASS } from './AuthLayout.js';

export function ChallengePage(): ReactElement {
  const step = useAuth((s) => s.step);
  return step === 'totp_enroll' ? <EnrollPanel /> : <VerifyPanel />;
}

function CancelButton(): ReactElement {
  const t = useTranslate();
  const cancel = useAuth((s) => s.cancelChallenge);
  return (
    <button type="button" onClick={() => void cancel()} className={LINK_BUTTON_CLASS}>
      {t('auth.cancel')}
    </button>
  );
}

function VerifyPanel(): ReactElement {
  const t = useTranslate();
  const verify = useAuth((s) => s.verify);
  const [useRecovery, setUseRecovery] = useState(false);

  const form = useForm({
    initial: { code: '' },
    validators: { code: compose(required(), minLength(6)) },
    async onSubmit(values, { setSubmitError }) {
      try {
        await verify(useRecovery ? { recoveryCode: values.code.trim() } : { code: values.code });
      } catch (error) {
        setSubmitError(
          error instanceof ApiClientError && error.status === 401
            ? t('auth.verify.invalid')
            : t(errorMessageKey(error)),
        );
      }
    },
  });

  function toggle(): void {
    setUseRecovery((current) => !current);
    form.reset();
  }

  return (
    <AuthLayout title={t('auth.verify.title')} description={t('auth.verify.description')}>
      <form onSubmit={form.handleSubmit} noValidate className="flex flex-col gap-4">
        <div>
          <label htmlFor="verify-code" className="text-sm font-medium">
            {useRecovery ? t('auth.verify.recoveryCode') : t('auth.verify.code')}
          </label>
          <input
            id="verify-code"
            type="text"
            inputMode={useRecovery ? 'text' : 'numeric'}
            autoComplete="one-time-code"
            autoFocus
            value={form.values.code}
            onChange={(event) => form.setValue('code', event.target.value)}
            onBlur={() => form.blur('code')}
            aria-invalid={form.errorFor('code') ? 'true' : undefined}
            aria-describedby="verify-code-error"
            className={`${INPUT_CLASS} tabular`}
          />
          <FieldError id="verify-code-error" message={form.errorFor('code')} />
        </div>
        {form.submitError && (
          <p role="alert" className="text-sm text-danger">
            {form.submitError}
          </p>
        )}
        <button type="submit" disabled={form.isSubmitting} className={PRIMARY_BUTTON_CLASS}>
          {form.isSubmitting ? t('auth.verify.submitting') : t('auth.verify.submit')}
        </button>
        <div className="flex flex-wrap justify-between gap-2">
          <button type="button" onClick={toggle} className={LINK_BUTTON_CLASS}>
            {useRecovery ? t('auth.verify.useApp') : t('auth.verify.useRecovery')}
          </button>
          <CancelButton />
        </div>
      </form>
    </AuthLayout>
  );
}

/** The base32 secret in groups of four, so it can be read out and typed without losing the place. */
function groupSecret(secret: string): string {
  return secret
    .replace(/\s+/g, '')
    .replace(/(.{4})/g, '$1 ')
    .trim();
}

function EnrollPanel(): ReactElement {
  const t = useTranslate();
  const enrollment = useAuth((s) => s.enrollment);
  const startEnrollment = useAuth((s) => s.startEnrollment);
  const activate = useAuth((s) => s.activate);
  const [startError, setStartError] = useState<unknown>(null);

  useEffect(() => {
    startEnrollment().catch((error: unknown) => setStartError(error));
  }, [startEnrollment]);

  const form = useForm({
    initial: { code: '' },
    validators: { code: compose(required(), minLength(6)) },
    async onSubmit(values, { setSubmitError }) {
      try {
        await activate(values.code);
      } catch (error) {
        setSubmitError(
          error instanceof ApiClientError && error.status === 401
            ? t('auth.enroll.invalid')
            : t(errorMessageKey(error)),
        );
      }
    },
  });

  return (
    <AuthLayout title={t('auth.enroll.title')} description={t('auth.enroll.description')}>
      {startError !== null ? (
        <div className="flex flex-col gap-4">
          <p role="alert" className="text-sm text-danger">
            {t(errorMessageKey(startError))}
          </p>
          <CancelButton />
        </div>
      ) : enrollment === null ? (
        <p role="status" className="text-sm text-content-secondary">
          {t('auth.enroll.starting')}
        </p>
      ) : (
        <form onSubmit={form.handleSubmit} noValidate className="flex flex-col gap-4">
          <div>
            <p className="text-sm font-medium">{t('auth.enroll.secretLabel')}</p>
            <p
              data-testid="enroll-secret"
              className="tabular mt-1 select-all break-all rounded-md bg-surface-2 px-3 py-2 font-mono text-sm"
            >
              {groupSecret(enrollment.secret)}
            </p>
            <p className="mt-1 text-xs text-content-secondary">{t('auth.enroll.secretHint')}</p>
            <a href={enrollment.otpauth_uri} className={`${LINK_BUTTON_CLASS} mt-1 inline-block`}>
              {t('auth.enroll.openLink')}
            </a>
          </div>
          <div>
            <label htmlFor="enroll-code" className="text-sm font-medium">
              {t('auth.enroll.code')}
            </label>
            <input
              id="enroll-code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              value={form.values.code}
              onChange={(event) => form.setValue('code', event.target.value)}
              onBlur={() => form.blur('code')}
              aria-invalid={form.errorFor('code') ? 'true' : undefined}
              aria-describedby="enroll-code-error"
              className={`${INPUT_CLASS} tabular`}
            />
            <FieldError id="enroll-code-error" message={form.errorFor('code')} />
          </div>
          {form.submitError && (
            <p role="alert" className="text-sm text-danger">
              {form.submitError}
            </p>
          )}
          <button type="submit" disabled={form.isSubmitting} className={PRIMARY_BUTTON_CLASS}>
            {form.isSubmitting ? t('auth.enroll.submitting') : t('auth.enroll.submit')}
          </button>
          <CancelButton />
        </form>
      )}
    </AuthLayout>
  );
}
