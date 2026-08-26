import { useEffect, useRef, useState, type ReactElement } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth, type Membership } from '../../lib/auth-store.js';
import { ApiClientError } from '../../lib/api-client.js';
import { useTranslate } from '../../lib/i18n.js';
import { FieldError, compose, email as emailRule, required, useForm } from '../../lib/form.js';

/**
 * Sign-in.
 *
 * Two steps, because an account can belong to several workspaces and picking
 * one afterwards is worse than picking it here: the agent would land in the
 * wrong inbox and have to work out why.
 *
 * The single step is skipped automatically when there is only one workspace.
 *
 * Credentials go through the one form primitive (FR-EK-A.1): each field carries
 * its own error line and Submit stays disabled until both are filled and the
 * email is well formed.
 *
 * A workspace that requires single sign-on (NFR-S11 · S11-h) reports
 * `password_login_available: false`, and this never spends the password on a
 * call the server will refuse. It hands the browser to that workspace's
 * identity provider instead (S11-i) — the membership carries the connection and
 * the client id, so pressing Sign in leads somewhere rather than to a refusal
 * dressed as "Invalid email or password", which would be a lie: the password
 * was right.
 *
 * `?sso=<connectionId>` is the other way in, and the one an SSO-only person
 * uses — they have no password to type. The ACS sends an accepted unsolicited
 * assertion back here rather than completing it, because no browser proved it
 * asked for that login; arriving with that parameter, this page immediately
 * starts an ordinary SP-initiated one of its own. It redirects without asking
 * because the person already clicked something — their identity provider's Nexa
 * tile — and their session there makes the second leg silent. Nothing in the
 * URL decides where they go: the destination comes from the connection row.
 *
 * A two-factor account (NFR-S11 · FR-MOD-00.1 · S11-2FA-g) is this branch's
 * sibling: `/auth/authorize` answers a first attempt with `two_factor_required`
 * — a protocol prompt, not a failed one — and this page swaps the password box
 * for a code box rather than a second sign-in screen, exactly as it swaps to
 * "Continue with SSO" above. A wrong code stays right there (never back to
 * retyping the password, which was already proved correct) and a code that is
 * actually a recovery sheet entry is the same field under a label toggle — the
 * server tells the two shapes apart, this screen does not have to. An account
 * with no factor at all, in a workspace that demands one, cannot be issued a
 * session no matter what is typed here (`details.enrollment_required`): there
 * is no signed-out enrollment endpoint (`POST /auth/2fa/enroll` requires a
 * bearer token), so this screen states the reason plainly and points at Account
 * Settings rather than rendering a code box nothing can satisfy.
 */

/**
 * Whether a password still opens this workspace.
 *
 * Absent means "before enforcement existed", which was always yes — an older
 * server must not turn every sign-in into a refusal.
 */
function passwordWorks(membership: Membership): boolean {
  return membership.password_login_available !== false;
}

/** What the code step needs to resubmit `/auth/authorize` — never the password step again. */
interface CodeStep {
  email: string;
  password: string;
  licenseId: string;
  organizationName: string;
}

interface EnrollmentRequired {
  organizationName: string;
}

/** A field-under or form-level reporter, named so its arrow never sits next to
 *  a generic return type on one signature (the i18n prose scanner reads that
 *  span as JSX text — see `attemptSignIn` below). */
type ReportFailure = (message: string) => void;

export function SignInPage(): ReactElement {
  const t = useTranslate();
  const [workspaces, setWorkspaces] = useState<Membership[] | null>(null);
  const [chooseError, setChooseError] = useState<string | null>(null);
  const [codeStep, setCodeStep] = useState<CodeStep | null>(null);
  const [codeMode, setCodeMode] = useState<'totp' | 'recovery'>('totp');
  const [enrollmentRequired, setEnrollmentRequired] = useState<EnrollmentRequired | null>(null);

  const busy = useAuth((s) => s.busy);
  const listWorkspaces = useAuth((s) => s.listWorkspaces);
  const signIn = useAuth((s) => s.signIn);
  const startSsoLogin = useAuth((s) => s.startSsoLogin);

  const [params] = useSearchParams();
  const ssoParam = params.get('sso');
  const [ssoError, setSsoError] = useState<string | null>(null);
  // One attempt per arrival: StrictMode mounts effects twice in development,
  // and a second `location.assign` to the same URL would leave a stale pending
  // record behind whichever navigation won.
  const ssoStarted = useRef(false);

  useEffect(() => {
    if (!ssoParam || ssoStarted.current) return;
    ssoStarted.current = true;
    startSsoLogin(ssoParam).catch((cause: unknown) => {
      // i18n-ignore: a store-thrown message, not raw server prose (see continueWithSso below).
      setSsoError(cause instanceof Error ? cause.message : t('auth.signin.ssoLinkFailed'));
    });
  }, [ssoParam, startSsoLogin, t]);

  /**
   * Hand a workspace's sign-in to its identity provider.
   *
   * Falls back to saying so when the membership names no connection — an older
   * server reports `password_login_available: false` without one, and silently
   * doing nothing would read as a broken button.
   */
  const continueWithSso = async (
    workspace: Membership,
    report: (message: string) => void,
  ): Promise<void> => {
    const connectionId = workspace.sso_enforced_connection_id;
    if (!connectionId) {
      report(t('auth.signin.ssoRequired'));
      return;
    }
    try {
      await startSsoLogin(connectionId, workspace.client_id);
    } catch (cause) {
      // i18n-ignore: see the ssoParam effect above — a store-thrown message, not raw server prose.
      report(cause instanceof Error ? cause.message : t('auth.signin.ssoStartFailed'));
    }
  };

  /**
   * Try to mint a session for one workspace, and branch on the two-factor
   * protocol prompt rather than treating it as an ordinary failure.
   *
   * `genericFailureMessage` is the caller's own wording for "something else
   * went wrong" (invalid credentials from the password form, "could not open
   * that workspace" from the picker) — this helper does not guess which.
   */
  const attemptSignIn = async (
    email: string,
    password: string,
    licenseId: string,
    organizationName: string,
    report: ReportFailure,
    genericFailureMessage: string,
  ): Promise<void> => {
    try {
      await signIn(email, password, licenseId);
    } catch (error) {
      if (error instanceof ApiClientError && error.type === 'two_factor_required') {
        if (error.details?.enrollment_required === true) {
          setEnrollmentRequired({ organizationName });
        } else {
          setCodeStep({ email, password, licenseId, organizationName });
        }
        return;
      }
      report(genericFailureMessage);
    }
  };

  const form = useForm({
    initial: { email: '', password: '' },
    validators: {
      email: compose(
        required(t('auth.validation.emailRequired')),
        emailRule(t('auth.validation.emailInvalid')),
      ),
      password: required(t('auth.validation.passwordRequired')),
    },
    onSubmit: async (values, { setSubmitError }) => {
      try {
        const memberships = await listWorkspaces(values.email, values.password);
        if (memberships.length === 0) {
          setSubmitError(t('auth.signin.noWorkspaces'));
          return;
        }
        if (memberships.length === 1) {
          const only = memberships[0]!;
          if (!passwordWorks(only)) {
            // Pressing Sign in is the click that authorises the redirect, so
            // this leaves for the identity provider rather than stopping to ask
            // again with a second button.
            await continueWithSso(only, setSubmitError);
            return;
          }
          await attemptSignIn(
            values.email,
            values.password,
            only.license_id,
            only.organization_name,
            setSubmitError,
            t('auth.signin.invalidCredentials'),
          );
          return;
        }
        setWorkspaces(memberships);
      } catch {
        // One message for a wrong password and an unknown address alike — the
        // server does not distinguish them and neither should the UI.
        setSubmitError(t('auth.signin.invalidCredentials'));
      }
    },
  });

  const choose = async (licenseId: string): Promise<void> => {
    setChooseError(null);
    const workspace = workspaces?.find((w) => w.license_id === licenseId);
    if (!workspace) return;
    // Checked before the call rather than after its 403, so the reason survives:
    // the catch below cannot tell "SSO required" from "the network went away".
    if (!passwordWorks(workspace)) {
      await continueWithSso(workspace, setChooseError);
      return;
    }
    await attemptSignIn(
      form.values.email,
      form.values.password,
      licenseId,
      workspace.organization_name,
      setChooseError,
      t('auth.signin.workspaceOpenFailed'),
    );
  };

  const codeForm = useForm({
    initial: { code: '' },
    validators: { code: required(t('auth.validation.codeRequired')) },
    onSubmit: async (values, { setFieldError, setSubmitError }) => {
      if (!codeStep) return;
      try {
        await signIn(codeStep.email, codeStep.password, codeStep.licenseId, values.code.trim());
      } catch (error) {
        if (
          error instanceof ApiClientError &&
          error.type === 'two_factor_required' &&
          error.details?.enrollment_required === true
        ) {
          // The factor was live a moment ago and is not now (disabled from
          // another tab mid-retry) — the same dead end as a first attempt.
          setEnrollmentRequired({ organizationName: codeStep.organizationName });
          setCodeStep(null);
          return;
        }
        if (error instanceof ApiClientError && error.type === 'too_many_requests') {
          setSubmitError(t('auth.signin.codeRateLimited'));
          return;
        }
        // Wrong, expired or already spent — stays right here under the field.
        // Never back to the password step: it was already proved correct, and
        // restarting there would waste it on a call that does not need it again.
        setFieldError('code', t('auth.signin.codeInvalid'));
      }
    },
  });

  // Six digits is a complete TOTP code, so this saves the keystroke on Submit
  // without taking anything away from someone who prefers to press it —
  // Enter and the button both still work at any length (NFR-A11Y4). Recovery
  // codes are not all-digits and are never auto-submitted.
  useEffect(() => {
    if (!codeStep || codeMode !== 'totp') return;
    if (codeForm.isSubmitting) return;
    if (!/^[0-9]{6}$/.test(codeForm.values.code)) return;
    codeForm.handleSubmit();
  }, [codeStep, codeMode, codeForm.values.code, codeForm.isSubmitting]);

  const handleCodeChange = (raw: string): void => {
    const next = codeMode === 'totp' ? raw.replace(/\D/g, '').slice(0, 6) : raw.slice(0, 11);
    codeForm.setValue('code', next);
  };

  const toggleCodeMode = (): void => {
    setCodeMode((mode) => (mode === 'totp' ? 'recovery' : 'totp'));
    codeForm.setValue('code', '');
  };

  const cancelCodeStep = (): void => {
    setCodeStep(null);
    setCodeMode('totp');
    codeForm.reset();
    setWorkspaces(null);
  };

  const dismissEnrollmentRequired = (): void => {
    setEnrollmentRequired(null);
    setWorkspaces(null);
  };

  const emailError = form.errorFor('email');
  const passwordError = form.errorFor('password');
  const codeError = codeForm.errorFor('code');

  return (
    <main className="flex min-h-full items-center justify-center bg-canvas p-6">
      <div className="w-full max-w-sm">
        <header className="mb-6 flex items-center gap-2.5">
          <span
            aria-hidden="true"
            className="flex h-9 w-9 items-center justify-center rounded-md bg-brand-500 text-sm font-bold text-white"
          >
            N
          </span>
          <div>
            <h1 className="text-lg font-semibold">Nexa</h1>
            <p className="text-xs text-content-secondary">{t('auth.signin.subtitle')}</p>
          </div>
        </header>

        {ssoError && (
          <p role="alert" className="mb-3 text-xs text-danger">
            {ssoError}
          </p>
        )}

        {ssoParam && !ssoError ? (
          // The redirect is already in flight; a form underneath it would only
          // invite somebody to start typing a password they will lose.
          <p role="status" className="text-sm text-content-secondary">
            {t('auth.signin.ssoRedirecting')}
          </p>
        ) : enrollmentRequired ? (
          <section
            aria-label={t('auth.signin.enrollmentRequiredTitle')}
            className="rounded-lg border border-border bg-surface p-4 shadow-xs"
          >
            <h2 className="mb-1 text-sm font-medium">{t('auth.signin.enrollmentRequiredTitle')}</h2>
            <p className="mb-4 text-sm text-content-secondary">
              {t('auth.signin.enrollmentRequiredBody', {
                organization: enrollmentRequired.organizationName,
              })}
            </p>
            <div className="flex items-center justify-between text-xs">
              <Link to="/app/settings" className="text-content-brand underline">
                {t('auth.signin.enrollmentRequiredLink')}
              </Link>
              <button
                type="button"
                onClick={dismissEnrollmentRequired}
                className="text-content-secondary underline"
              >
                {t('auth.common.backToSignIn')}
              </button>
            </div>
          </section>
        ) : codeStep ? (
          <section
            aria-label={t('auth.signin.codeTitle')}
            className="rounded-lg border border-border bg-surface p-4 shadow-xs"
          >
            <h2 className="mb-1 text-sm font-medium">{t('auth.signin.codeTitle')}</h2>
            <p className="mb-3 text-xs text-content-secondary">
              {t('auth.signin.codeSubtitle', { organization: codeStep.organizationName })}
            </p>
            <form onSubmit={codeForm.handleSubmit} noValidate className="flex flex-col gap-3">
              <div className="flex flex-col gap-1">
                <label htmlFor="two-factor-code" className="text-xs font-medium">
                  {codeMode === 'totp'
                    ? t('auth.fields.twoFactorCode')
                    : t('auth.fields.recoveryCode')}
                </label>
                <input
                  id="two-factor-code"
                  type="text"
                  inputMode={codeMode === 'totp' ? 'numeric' : 'text'}
                  autoComplete="one-time-code"
                  autoFocus
                  value={codeForm.values.code}
                  onChange={(event) => handleCodeChange(event.target.value)}
                  onBlur={() => codeForm.blur('code')}
                  aria-invalid={codeError ? true : undefined}
                  aria-describedby={codeError ? 'code-error' : undefined}
                  className="rounded-md border border-border bg-inset px-3 py-2 text-sm tracking-widest"
                />
                <FieldError id="code-error" message={codeError} />
              </div>

              {codeForm.submitError && (
                <p role="alert" className="text-xs text-danger">
                  {codeForm.submitError}
                </p>
              )}

              <button
                type="submit"
                disabled={!codeForm.canSubmit}
                className="mt-1 rounded-md bg-brand-500 px-3 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50"
              >
                {codeForm.isSubmitting ? t('auth.signin.verifying') : t('auth.signin.verify')}
              </button>
            </form>

            <div className="mt-3 flex items-center justify-between text-xs">
              <button
                type="button"
                onClick={toggleCodeMode}
                className="text-content-brand underline"
              >
                {codeMode === 'totp'
                  ? t('auth.signin.useRecoveryCode')
                  : t('auth.signin.useAuthenticatorCode')}
              </button>
              <button
                type="button"
                onClick={cancelCodeStep}
                className="text-content-secondary underline"
              >
                {t('auth.common.backToSignIn')}
              </button>
            </div>
          </section>
        ) : workspaces ? (
          <section
            aria-label={t('auth.signin.chooseWorkspace')}
            className="rounded-lg border border-border bg-surface p-4 shadow-xs"
          >
            <h2 className="mb-3 text-sm font-medium">{t('auth.signin.chooseWorkspace')}</h2>
            {chooseError && (
              <p role="alert" className="mb-3 text-xs text-danger">
                {chooseError}
              </p>
            )}
            <ul className="flex flex-col gap-1.5">
              {workspaces.map((workspace) => (
                <li key={workspace.license_id}>
                  <button
                    type="button"
                    onClick={() => void choose(workspace.license_id)}
                    disabled={busy}
                    className="flex w-full items-center justify-between rounded-md border border-border px-3 py-2.5 text-left text-sm hover:bg-surface-2 disabled:opacity-50"
                  >
                    <span>{workspace.organization_name}</span>
                    <span className="text-2xs capitalize text-content-tertiary">
                      {passwordWorks(workspace)
                        ? workspace.role
                        : t('auth.signin.ssoRequiredBadge')}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : (
          <form
            onSubmit={form.handleSubmit}
            noValidate
            className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4 shadow-xs"
          >
            <div className="flex flex-col gap-1">
              <label htmlFor="email" className="text-xs font-medium">
                {t('auth.fields.email')}
              </label>
              <input
                id="email"
                type="email"
                autoComplete="username"
                value={form.values.email}
                onChange={(event) => form.setValue('email', event.target.value)}
                onBlur={() => form.blur('email')}
                aria-invalid={emailError ? true : undefined}
                aria-describedby={emailError ? 'email-error' : undefined}
                className="rounded-md border border-border bg-inset px-3 py-2 text-sm"
              />
              <FieldError id="email-error" message={emailError} />
            </div>

            <div className="flex flex-col gap-1">
              <label htmlFor="password" className="text-xs font-medium">
                {t('auth.fields.password')}
              </label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                value={form.values.password}
                onChange={(event) => form.setValue('password', event.target.value)}
                onBlur={() => form.blur('password')}
                aria-invalid={passwordError ? true : undefined}
                aria-describedby={passwordError ? 'password-error' : undefined}
                className="rounded-md border border-border bg-inset px-3 py-2 text-sm"
              />
              <FieldError id="password-error" message={passwordError} />
            </div>

            {form.submitError && (
              <p role="alert" className="text-xs text-danger">
                {form.submitError}
              </p>
            )}

            <button
              type="submit"
              disabled={busy || !form.canSubmit}
              className="mt-1 rounded-md bg-brand-500 px-3 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50"
            >
              {busy || form.isSubmitting ? t('auth.signin.submitting') : t('auth.signin.submit')}
            </button>
          </form>
        )}

        <p className="mt-4 text-center text-xs text-content-secondary">
          <Link to="/forgot-password" className="text-content-brand underline">
            {t('auth.signin.forgotPassword')}
          </Link>
        </p>
        <p className="mt-2 text-center text-xs text-content-secondary">
          {t('auth.signin.newHere')}{' '}
          <Link to="/signup" className="text-content-brand underline">
            {t('auth.signin.createWorkspace')}
          </Link>
        </p>

        <p className="mt-4 text-center text-2xs text-content-tertiary">
          {t('auth.signin.demoCredentials')}
        </p>
      </div>
    </main>
  );
}
