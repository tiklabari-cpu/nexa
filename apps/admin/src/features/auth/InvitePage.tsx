/**
 * Accepting an operator invitation (tm 389.6 · FR-ADMIN-03).
 *
 * The invitation mail links to `/invite#token=…`. The token is in the URL *fragment*, which the
 * browser never sends to a server or puts in a Referer, and it is read once here and then
 * dropped from the address bar. Accepting sets the password (12+ characters) and opens a
 * `password`-stage session whose next step is always the authenticator enrolment — never a
 * session that skips it.
 */
import { useState, type ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { ApiClientError, errorMessageKey } from '../../lib/api-client.js';
import { useAuth } from '../../lib/auth-store.js';
import { FieldError, compose, required, useForm } from '../../lib/form.js';
import { useTranslate } from '../../lib/i18n.js';
import { AuthLayout, INPUT_CLASS, LINK_BUTTON_CLASS, PRIMARY_BUTTON_CLASS } from './AuthLayout.js';

/** `#token=abc` → `abc`; anything else → null. */
export function inviteTokenFromHash(hash: string): string | null {
  const value = new URLSearchParams(hash.replace(/^#/, '')).get('token');
  return value && value.length <= 128 ? value : null;
}

export function InvitePage(): ReactElement {
  const t = useTranslate();
  const acceptInvite = useAuth((s) => s.acceptInvite);
  // Read once, then taken out of the address bar and the history entry.
  const [token] = useState(() => {
    const found = inviteTokenFromHash(globalThis.location?.hash ?? '');
    if (found) globalThis.history?.replaceState(null, '', globalThis.location.pathname);
    return found;
  });

  const form = useForm({
    initial: { password: '' },
    // Length is counted as typed: a password's spaces are part of it (no trimming).
    validators: {
      password: compose(required(), (value) =>
        value.length >= 12 ? null : t('ui.form.minLength', { count: 12 }),
      ),
    },
    async onSubmit(values, { setSubmitError }) {
      if (token === null) return;
      try {
        await acceptInvite(token, values.password);
      } catch (error) {
        setSubmitError(
          error instanceof ApiClientError && error.status === 401
            ? t('auth.invite.invalid')
            : t(errorMessageKey(error)),
        );
      }
    },
  });

  if (token === null) {
    return (
      <AuthLayout title={t('auth.invite.title')}>
        <p role="alert" className="text-sm text-danger">
          {t('auth.invite.missingToken')}
        </p>
        <Link to="/" className={`${LINK_BUTTON_CLASS} mt-4 inline-block`}>
          {t('auth.invite.signIn')}
        </Link>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title={t('auth.invite.title')} description={t('auth.invite.description')}>
      <form onSubmit={form.handleSubmit} noValidate className="flex flex-col gap-4">
        <div>
          <label htmlFor="invite-password" className="text-sm font-medium">
            {t('auth.invite.password')}
          </label>
          <input
            id="invite-password"
            type="password"
            autoComplete="new-password"
            autoFocus
            value={form.values.password}
            onChange={(event) => form.setValue('password', event.target.value)}
            onBlur={() => form.blur('password')}
            aria-invalid={form.errorFor('password') ? 'true' : undefined}
            aria-describedby="invite-password-hint invite-password-error"
            className={INPUT_CLASS}
          />
          <p id="invite-password-hint" className="mt-1 text-xs text-content-secondary">
            {t('auth.invite.passwordHint')}
          </p>
          <FieldError id="invite-password-error" message={form.errorFor('password')} />
        </div>
        {form.submitError && (
          <p role="alert" className="text-sm text-danger">
            {form.submitError}
          </p>
        )}
        <button type="submit" disabled={form.isSubmitting} className={PRIMARY_BUTTON_CLASS}>
          {form.isSubmitting ? t('auth.invite.submitting') : t('auth.invite.submit')}
        </button>
      </form>
    </AuthLayout>
  );
}
