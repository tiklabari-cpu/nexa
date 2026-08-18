import { useEffect, useRef, useState, type ReactElement } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth, type Membership } from '../../lib/auth-store.js';
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

export function SignInPage(): ReactElement {
  const t = useTranslate();
  const [workspaces, setWorkspaces] = useState<Membership[] | null>(null);
  const [chooseError, setChooseError] = useState<string | null>(null);

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
          await signIn(values.email, values.password, only.license_id);
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
    // Checked before the call rather than after its 403, so the reason survives:
    // the catch below cannot tell "SSO required" from "the network went away".
    if (workspace && !passwordWorks(workspace)) {
      await continueWithSso(workspace, setChooseError);
      return;
    }
    try {
      await signIn(form.values.email, form.values.password, licenseId);
    } catch {
      setChooseError(t('auth.signin.workspaceOpenFailed'));
    }
  };

  const emailError = form.errorFor('email');
  const passwordError = form.errorFor('password');

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
