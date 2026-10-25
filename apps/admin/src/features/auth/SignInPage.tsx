/**
 * Step one of the operator sign-in: email and password (tm 389.6 · FR-ADMIN-01).
 *
 * The answer is one 401 for an unknown address, a wrong password and a disabled operator, so
 * the screen says exactly that much and no more. What the password earns is not a session but
 * the right to show the second factor — `signIn` moves the app to the code step, and the
 * routes in `App.tsx` do the rest.
 */
import type { ReactElement } from 'react';
import { ApiClientError, errorMessageKey } from '../../lib/api-client.js';
import { useAuth } from '../../lib/auth-store.js';
import { FieldError, compose, email as emailRule, required, useForm } from '../../lib/form.js';
import { useTranslate } from '../../lib/i18n.js';
import { AuthLayout, INPUT_CLASS, PRIMARY_BUTTON_CLASS } from './AuthLayout.js';

export function SignInPage(): ReactElement {
  const t = useTranslate();
  const signIn = useAuth((s) => s.signIn);
  const sessionEnded = useAuth((s) => s.sessionEnded);

  const form = useForm({
    initial: { email: '', password: '' },
    validators: { email: compose(required(), emailRule()), password: required() },
    async onSubmit(values, { setSubmitError }) {
      try {
        await signIn(values.email.trim(), values.password);
      } catch (error) {
        setSubmitError(
          error instanceof ApiClientError && error.status === 401
            ? t('auth.signIn.invalid')
            : t(errorMessageKey(error)),
        );
      }
    },
  });

  return (
    <AuthLayout title={t('auth.signIn.title')} description={t('auth.signIn.description')}>
      {sessionEnded && (
        <p role="status" className="mb-4 rounded-md bg-surface-2 px-3 py-2 text-sm">
          {t('auth.sessionEnded')}
        </p>
      )}
      <form onSubmit={form.handleSubmit} noValidate className="flex flex-col gap-4">
        <div>
          <label htmlFor="signin-email" className="text-sm font-medium">
            {t('auth.signIn.email')}
          </label>
          <input
            id="signin-email"
            type="email"
            autoComplete="username"
            autoFocus
            value={form.values.email}
            onChange={(event) => form.setValue('email', event.target.value)}
            onBlur={() => form.blur('email')}
            aria-invalid={form.errorFor('email') ? 'true' : undefined}
            aria-describedby="signin-email-error"
            className={INPUT_CLASS}
          />
          <FieldError id="signin-email-error" message={form.errorFor('email')} />
        </div>
        <div>
          <label htmlFor="signin-password" className="text-sm font-medium">
            {t('auth.signIn.password')}
          </label>
          <input
            id="signin-password"
            type="password"
            autoComplete="current-password"
            value={form.values.password}
            onChange={(event) => form.setValue('password', event.target.value)}
            onBlur={() => form.blur('password')}
            aria-invalid={form.errorFor('password') ? 'true' : undefined}
            aria-describedby="signin-password-error"
            className={INPUT_CLASS}
          />
          <FieldError id="signin-password-error" message={form.errorFor('password')} />
        </div>
        {form.submitError && (
          <p role="alert" className="text-sm text-danger">
            {form.submitError}
          </p>
        )}
        <button type="submit" disabled={form.isSubmitting} className={PRIMARY_BUTTON_CLASS}>
          {form.isSubmitting ? t('auth.signIn.submitting') : t('auth.signIn.submit')}
        </button>
      </form>
    </AuthLayout>
  );
}
