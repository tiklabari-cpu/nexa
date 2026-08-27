import { useEffect, useRef, useState, type ReactElement } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth, type Membership, type TwoFactorEnrollment } from '../../lib/auth-store.js';
import { ApiClientError } from '../../lib/api-client.js';
import { useTranslate } from '../../lib/i18n.js';
import { FieldError, compose, email as emailRule, required, useForm } from '../../lib/form.js';
import { downloadRecoveryCodes } from '../../lib/recovery-codes.js';

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
 * session no matter what is typed here (`details.enrollment_required`) — and
 * since S11-2FA-k that is no longer a dead end: the refusal carries a
 * short-lived credential good for the two enrollment endpoints only, so
 * `EnrollmentPanel` at the foot of this file sets the factor up in place and
 * hands the person on to the code box. A server that sends no such credential
 * still gets the old panel, which says why and points at Account Settings.
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

/**
 * What the enrollment panel needs to take somebody from "refused" to "signed
 * in" without leaving this screen (NFR-S11 · S11-2FA-k).
 *
 * The credentials are the same ones `CodeStep` keeps and for the same reason:
 * the sign-in has to be repeated once the factor exists, and asking for a
 * password that was already proved correct would be the screen forgetting what
 * it just did.
 */
interface EnrollmentRequired {
  organizationName: string;
  email: string;
  password: string;
  licenseId: string;
  /**
   * Absent when the server minted none — an older build, or a mint that failed
   * and correctly did not turn a refusal into a 500. The panel then reads
   * exactly as it did before this existed: it says why, and points at Account
   * Settings.
   */
  ticket?: string;
}

/**
 * The enrollment credential out of a `two_factor_required` refusal, if the
 * server sent one.
 *
 * `error.details` is `Record<string, unknown>` read off the wire, so this is a
 * narrowing rather than a cast: a server that sends the wrong shape leaves the
 * panel in its no-ticket state, which is a working screen, instead of putting
 * `[object Object]` in an Authorization header.
 */
function readTicket(details: Record<string, unknown>): string | undefined {
  const ticket = details['enrollment_ticket'];
  return typeof ticket === 'string' && ticket.length > 0 ? ticket : undefined;
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
          setEnrollmentRequired({
            organizationName,
            email,
            password,
            licenseId,
            ticket: readTicket(error.details),
          });
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
          // another tab mid-retry) — the same dead end as a first attempt, and
          // the same way out of it: this refusal carries its own fresh ticket.
          setEnrollmentRequired({
            organizationName: codeStep.organizationName,
            email: codeStep.email,
            password: codeStep.password,
            licenseId: codeStep.licenseId,
            ticket: readTicket(error.details ?? {}),
          });
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
          <EnrollmentPanel
            context={enrollmentRequired}
            onCancel={dismissEnrollmentRequired}
            onEnrolled={() => {
              // Straight into the code step rather than signing in from here.
              // The code that confirmed the enrollment is spent — its RFC 6238
              // step became the replay floor — so the next one has to be typed,
              // and the box that asks for it already exists two branches down.
              setCodeStep({
                email: enrollmentRequired.email,
                password: enrollmentRequired.password,
                licenseId: enrollmentRequired.licenseId,
                organizationName: enrollmentRequired.organizationName,
              });
              setEnrollmentRequired(null);
            }}
          />
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

/**
 * Setting up a second factor from the sign-in screen (NFR-S11 · S11-2FA-k).
 *
 * The panel S11-2FA-g left here was honest about a dead end: a workspace that
 * requires two-factor authentication refuses an account that has none, and the
 * only enrollment endpoints wanted a session that refusal makes unobtainable.
 * It said so and pointed at Account Settings, which is behind the same sign-in.
 *
 * The server now hands the refusal a credential that opens exactly two
 * endpoints (`details.enrollment_ticket`), so the dead end has an exit and this
 * walks it: start enrollment, show the setup key, take the first code, show the
 * recovery sheet, hand back to the code step. It is three states rather than
 * three screens for the same reason the code box replaced a second sign-in
 * page — the person is in the middle of one action.
 *
 * No QR code, matching Account Settings and for the same measured reason: every
 * authenticator app accepts manual entry, so a QR-rendering dependency would be
 * bundle and maintenance cost for a convenience the setup key already covers.
 *
 * The recovery sheet is the one thing here that cannot be recovered later.
 * Continue stays disabled until the box is checked — a stronger version of what
 * Account Settings does with a close guard, because there is nowhere here to
 * "go back and look again": the codes exist in this component's state and
 * nowhere else in the world.
 */
function EnrollmentPanel({
  context,
  onCancel,
  onEnrolled,
}: {
  context: EnrollmentRequired;
  onCancel: () => void;
  onEnrolled: () => void;
}): ReactElement {
  const t = useTranslate();
  const enrollWithTicket = useAuth((s) => s.enrollWithTicket);
  const activateWithTicket = useAuth((s) => s.activateWithTicket);

  const [enrollment, setEnrollment] = useState<TwoFactorEnrollment | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [saved, setSaved] = useState(false);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [copied, setCopied] = useState<'secret' | 'uri' | null>(null);

  const { ticket } = context;

  const start = async (): Promise<void> => {
    if (!ticket) return;
    setStarting(true);
    setStartError(null);
    try {
      setEnrollment(await enrollWithTicket(ticket));
    } catch (error) {
      // A ticket that has expired or been replaced by a later attempt is the
      // common failure and it is not recoverable here — the way to a fresh one
      // is another sign-in, which is what this says.
      setStartError(
        error instanceof ApiClientError && error.status === 401
          ? t('auth.signin.enroll.expired')
          : t('auth.signin.enroll.failed'),
      );
    } finally {
      setStarting(false);
    }
  };

  const codeForm = useForm({
    initial: { code: '' },
    validators: { code: required(t('auth.signin.enroll.codeRequired')) },
    onSubmit: async (values, { setFieldError }) => {
      if (!ticket) return;
      try {
        setRecoveryCodes(await activateWithTicket(ticket, values.code.trim()));
      } catch (error) {
        if (error instanceof ApiClientError && error.type === 'not_found') {
          // The ticket died between starting and confirming. Under the field
          // would be a lie — nothing is wrong with the code.
          setStartError(t('auth.signin.enroll.expired'));
          setEnrollment(null);
          return;
        }
        setFieldError('code', t('auth.signin.enroll.codeInvalid'));
      }
    },
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

  const codeError = codeForm.errorFor('code');

  return (
    <section
      aria-label={t('auth.signin.enrollmentRequiredTitle')}
      className="rounded-lg border border-border bg-surface p-4 shadow-xs"
    >
      <h2 className="mb-1 text-sm font-medium">{t('auth.signin.enrollmentRequiredTitle')}</h2>

      {recoveryCodes ? (
        <>
          <p className="mb-3 text-sm text-content-secondary">
            {t('auth.signin.enroll.recoveryBody')}
          </p>
          <ul className="mb-3 grid grid-cols-2 gap-1.5 rounded-md border border-border bg-inset p-3">
            {recoveryCodes.map((code) => (
              <li key={code}>
                <code className="text-2xs">{code}</code>
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() => downloadRecoveryCodes(recoveryCodes)}
            className="mb-3 rounded-md border border-border px-3 py-1.5 text-sm"
          >
            {t('auth.signin.enroll.downloadButton')}
          </button>
          <label className="mb-3 flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={saved}
              onChange={(event) => setSaved(event.target.checked)}
            />
            <span>{t('auth.signin.enroll.savedConfirm')}</span>
          </label>
          <button
            type="button"
            onClick={onEnrolled}
            disabled={!saved}
            className="w-full rounded-md bg-brand-500 px-3 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50"
          >
            {t('auth.signin.enroll.continueButton')}
          </button>
        </>
      ) : enrollment ? (
        <>
          <p className="mb-3 text-sm text-content-secondary">{t('auth.signin.enroll.scanBody')}</p>

          <div className="mb-3 flex flex-col gap-1">
            <span className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
              {t('auth.signin.enroll.secretLabel')}
            </span>
            <div className="flex items-center gap-2">
              <code className="flex-1 truncate rounded-md border border-border bg-inset px-2 py-1.5 text-2xs">
                {enrollment.secret}
              </code>
              <button
                type="button"
                onClick={() => copy('secret', enrollment.secret)}
                aria-label={t('auth.signin.enroll.copySecretAriaLabel')}
                className="shrink-0 rounded-md bg-brand-500 px-2.5 py-1 text-2xs font-medium text-white hover:bg-brand-600"
              >
                {copied === 'secret'
                  ? t('auth.signin.enroll.copied')
                  : t('auth.signin.enroll.copy')}
              </button>
            </div>
          </div>

          <div className="mb-3 flex flex-col gap-1">
            <span className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
              {t('auth.signin.enroll.uriLabel')}
            </span>
            <div className="flex items-center gap-2">
              <code className="flex-1 truncate rounded-md border border-border bg-inset px-2 py-1.5 text-2xs">
                {enrollment.otpauth_uri}
              </code>
              <button
                type="button"
                onClick={() => copy('uri', enrollment.otpauth_uri)}
                aria-label={t('auth.signin.enroll.copyUriAriaLabel')}
                className="shrink-0 rounded-md bg-brand-500 px-2.5 py-1 text-2xs font-medium text-white hover:bg-brand-600"
              >
                {copied === 'uri' ? t('auth.signin.enroll.copied') : t('auth.signin.enroll.copy')}
              </button>
            </div>
          </div>

          <form onSubmit={codeForm.handleSubmit} noValidate className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <label htmlFor="enroll-code" className="text-xs font-medium">
                {t('auth.signin.enroll.codeLabel')}
              </label>
              <input
                id="enroll-code"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                value={codeForm.values.code}
                onChange={(event) =>
                  codeForm.setValue('code', event.target.value.replace(/\D/g, '').slice(0, 6))
                }
                onBlur={() => codeForm.blur('code')}
                aria-invalid={codeError ? true : undefined}
                aria-describedby={codeError ? 'enroll-code-error' : undefined}
                className="rounded-md border border-border bg-inset px-3 py-2 text-sm tracking-widest"
              />
              <FieldError id="enroll-code-error" message={codeError} />
            </div>
            <button
              type="submit"
              disabled={!codeForm.canSubmit}
              className="rounded-md bg-brand-500 px-3 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50"
            >
              {codeForm.isSubmitting
                ? t('auth.signin.enroll.activating')
                : t('auth.signin.enroll.activateButton')}
            </button>
          </form>
        </>
      ) : (
        <>
          <p className="mb-4 text-sm text-content-secondary">
            {t(
              ticket ? 'auth.signin.enrollmentRequiredHere' : 'auth.signin.enrollmentRequiredBody',
              { organization: context.organizationName },
            )}
          </p>
          {startError && (
            <p role="alert" className="mb-3 text-xs text-danger">
              {startError}
            </p>
          )}
          {ticket ? (
            <button
              type="button"
              onClick={() => void start()}
              disabled={starting}
              className="w-full rounded-md bg-brand-500 px-3 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50"
            >
              {starting ? t('auth.signin.enroll.starting') : t('auth.signin.enroll.startButton')}
            </button>
          ) : (
            <Link to="/app/settings" className="text-xs text-content-brand underline">
              {t('auth.signin.enrollmentRequiredLink')}
            </Link>
          )}
        </>
      )}

      <div className="mt-3 flex justify-end text-xs">
        <button type="button" onClick={onCancel} className="text-content-secondary underline">
          {t('auth.common.backToSignIn')}
        </button>
      </div>
    </section>
  );
}
