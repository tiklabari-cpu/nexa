/**
 * The screens someone sees before they have a workspace (PRD FR-MOD-00.2–00.4,
 * and the receiving half of 04.4).
 *
 * All four sit outside the signed-in tree, so they share a card rather than the
 * app shell. Each ends by handing off to the same sign-in the product already
 * had — creating a workspace and joining one both leave you with credentials,
 * and issuing tokens from three places would mean three places to get wrong.
 *
 * Validation is the one form primitive (FR-EK-A.1): each field owns its
 * error line and Submit stays disabled until every field passes — no bespoke
 * `email.includes('@')` or `valid` boolean per page.
 */
import { useEffect, useState, type ReactElement, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { DEFAULT_REGION, REGIONS, type Region } from '@siyahtus/types';
import { ApiClient, ApiClientError } from '../../lib/api-client.js';
import { useAuth } from '../../lib/auth-store.js';
import { useDeployment } from '../../lib/deployment.js';
import { usePageTitle } from '../../lib/document-title.js';
import { useTranslate, type TFunction } from '../../lib/i18n.js';
import { Banner } from '../../components/ui/index.js';
import { LegalLink, LegalLinks } from './LegalLinks.js';
import {
  FieldError,
  compose,
  email as emailRule,
  minLength,
  required,
  useForm,
} from '../../lib/form.js';

const anonymous = new ApiClient();

function AuthCard({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
  footer?: ReactNode;
}): ReactElement {
  usePageTitle(title);
  return (
    <main className="flex min-h-full items-center justify-center bg-canvas p-6">
      <div className="w-full max-w-sm">
        <header className="mb-6 flex items-center gap-2.5">
          <span
            aria-hidden="true"
            className="flex h-9 w-9 items-center justify-center rounded-md bg-brand-500 text-sm font-bold text-white"
          >
            S
          </span>
          <div>
            <h1 className="text-lg font-semibold">{title}</h1>
            <p className="text-xs text-content-secondary">{subtitle}</p>
          </div>
        </header>
        <div className="rounded-lg border border-border bg-surface p-5">{children}</div>
        {footer && <p className="mt-4 text-center text-xs text-content-tertiary">{footer}</p>}
        {/* Every public screen, the deployment's documents (tm 257.9). */}
        <LegalLinks />
      </div>
    </main>
  );
}

/**
 * One input row wired to the form primitive: it shows the field-under error and
 * points `aria-describedby` at it (and at any hint), so every public page spells
 * "invalid" the same way (FR-EK-A.1).
 */
function Field({
  id,
  label,
  type = 'text',
  value,
  onChange,
  onBlur,
  error,
  hint,
  autoFocus,
}: {
  id: string;
  label: string;
  type?: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  error?: string | null;
  hint?: string;
  autoFocus?: boolean;
}): ReactElement {
  const describedBy =
    [error ? `${id}-error` : null, hint ? `${id}-hint` : null].filter(Boolean).join(' ') ||
    undefined;
  return (
    <div className="mb-4">
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium">
        {label}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        autoFocus={autoFocus}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onBlur}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className="w-full rounded-md border border-border bg-inset px-3 py-2 text-sm"
      />
      <FieldError id={`${id}-error`} message={error ?? null} />
      {hint && (
        <p id={`${id}-hint`} className="mt-1 text-2xs text-content-tertiary">
          {hint}
        </p>
      )}
    </div>
  );
}

function Submit({ children, disabled }: { children: ReactNode; disabled: boolean }): ReactElement {
  return (
    <button
      type="submit"
      disabled={disabled}
      className="w-full rounded-md bg-brand-500 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
    >
      {children}
    </button>
  );
}

function ErrorNote({ message }: { message: string | null }): ReactElement | null {
  if (!message) return null;
  return (
    <p role="alert" className="mb-4 text-sm text-danger">
      {message}
    </p>
  );
}

const MIN_PASSWORD = 12;

/** How long "send the link again" waits after a link went out (tm 257.16). */
const RESEND_COOLDOWN_SECONDS = 60;

/**
 * Seconds left on the resend button, and a way to start the wait over.
 *
 * Kept as a deadline rather than a counter that ticks down: a throttled
 * background tab fires its timers late, and a counter would then be minutes
 * wrong where a deadline is only a second stale.
 */
function useCooldown(initialSeconds: number): [number, () => void] {
  const [until, setUntil] = useState(() => Date.now() + initialSeconds * 1000);
  const [now, setNow] = useState(() => Date.now());
  const left = Math.max(0, Math.ceil((until - now) / 1000));
  const waiting = left > 0;

  useEffect(() => {
    if (!waiting) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [waiting]);

  const start = (): void => {
    const current = Date.now();
    setNow(current);
    setUntil(current + RESEND_COOLDOWN_SECONDS * 1000);
  };
  return [left, start];
}

/**
 * "Send the confirmation link again" for an address the person has already
 * typed (tm 257.16). The server answers 202 whatever the address holds, so the
 * sentence below the button is the same whether the call worked, was refused
 * or never arrived — a page that reported a failure for some addresses would
 * hand back the enumeration channel the endpoint closes.
 */
export function ResendVerification({
  email,
  initialWait = 0,
}: {
  email: string;
  initialWait?: number;
}): ReactElement {
  const t = useTranslate();
  const [left, start] = useCooldown(initialWait);
  const [sent, setSent] = useState(false);

  const resend = async (): Promise<void> => {
    start();
    await anonymous.post('/auth/verify-email/resend', { email }).catch(() => undefined);
    setSent(true);
  };

  return (
    <div>
      <p role="status" className="mb-3 text-sm text-content-secondary">
        {sent ? t('auth.verify.resendSent') : null}
      </p>
      <button
        type="button"
        onClick={() => void resend()}
        disabled={left > 0}
        className="w-full rounded-md border border-border px-3 py-2 text-sm font-medium disabled:opacity-50"
      >
        {left > 0 ? t('auth.verify.resendWait', { seconds: left }) : t('auth.verify.resend')}
      </button>
    </div>
  );
}

/** The same resend, for somebody who has no address on screen yet. */
function ResendByAddress(): ReactElement {
  const t = useTranslate();
  const [left, start] = useCooldown(0);
  const [sent, setSent] = useState(false);

  const form = useForm({
    initial: { email: '' },
    validators: {
      email: compose(
        required(t('auth.validation.emailRequired')),
        emailRule(t('auth.validation.emailInvalid')),
      ),
    },
    // Deliberately no error branch — see `ResendVerification`.
    onSubmit: async (values) => {
      start();
      await anonymous
        .post('/auth/verify-email/resend', { email: values.email.trim() })
        .catch(() => undefined);
      setSent(true);
    },
  });

  return (
    <section aria-labelledby="resend-title" className="mt-5 border-t border-border pt-4">
      <h2 id="resend-title" className="mb-3 text-sm font-medium">
        {t('auth.verify.resendTitle')}
      </h2>
      <form onSubmit={form.handleSubmit} noValidate>
        <Field
          id="resend-email"
          label={t('auth.fields.email')}
          type="email"
          value={form.values.email}
          onChange={(value) => form.setValue('email', value)}
          onBlur={() => form.blur('email')}
          error={form.errorFor('email')}
          hint={t('auth.verify.resendHint')}
        />
        <p role="status" className="mb-3 text-sm text-content-secondary">
          {sent ? t('auth.verify.resendSent') : null}
        </p>
        <Submit disabled={!form.canSubmit || left > 0}>
          {left > 0
            ? t('auth.verify.resendWait', { seconds: left })
            : form.isSubmitting
              ? t('auth.verify.resendSubmitting')
              : t('auth.verify.resendSubmit')}
        </Submit>
      </form>
    </section>
  );
}

/**
 * What to put on the form when signup fails (C4-h).
 *
 * The residency branch replaces a message that was actively misleading:
 * "Could not create that workspace." was shown after the server had created
 * it — in the wrong region, unreachable ever after. Now nothing is created, and
 * the sentence has to say so, because the person is about to try again and the
 * only useful next move is picking the region this address actually serves.
 * `served_region` is the half of `details` the client cannot work out for
 * itself; the region they chose is already on screen.
 */
function signupFailureMessage(failure: unknown, t: TFunction): string {
  if (!(failure instanceof ApiClientError)) return t('auth.signup.errorGeneric');

  if (failure.type === 'account_exists') {
    return t('auth.signup.errorAccountExists');
  }

  // A deployment that has closed sign-up (tm 256.3). The generic sentence would
  // send the person round again; this one says retrying cannot work and names
  // the way in that still does.
  if (failure.type === 'not_allowed' && failure.details?.['reason'] === 'signup_closed') {
    return t('auth.signup.errorSignupClosed');
  }

  // Terms of service (tm 257.9). Two different asks, so two sentences: an
  // unticked box is ticked; a stale version means the terms changed under an
  // open form, and only a reload shows the new ones — ticking again cannot.
  if (failure.type === 'validation' && failure.details?.['reason'] === 'terms_not_accepted') {
    return t('auth.signup.errorTermsNotAccepted');
  }
  if (failure.type === 'validation' && failure.details?.['reason'] === 'terms_outdated') {
    return t('auth.signup.errorTermsOutdated');
  }

  // The hourly sign-up limit per network (tm 257.14): nothing was created,
  // and trying again straight away cannot work — the sentence says when.
  if (failure.type === 'limit_reached' && failure.details?.['reason'] === 'signup_rate') {
    return t('common.limits.signupRate');
  }

  if (failure.type === 'misdirected_request') {
    const served = failure.details?.['served_region'];
    if (isRegion(served)) {
      return t('auth.signup.errorRegionMismatch', { region: t(`auth.signup.region.${served}`) });
    }
    return t('auth.signup.errorRegionUnknown');
  }

  return t('auth.signup.errorGeneric');
}

function isRegion(value: unknown): value is Region {
  return typeof value === 'string' && (REGIONS as readonly string[]).includes(value);
}

/** FR-MOD-00.2 — create a workspace and its first owner. */
export function SignUpPage(): ReactElement {
  const t = useTranslate();
  const signIn = useAuth((s) => s.signIn);
  // Not a form field (ADR-12): a `<select>` next to a warning, not something a
  // string validator has an opinion about — the same split `InviteTeammates`
  // uses for its role picker.
  const [region, setRegion] = useState<Region>(DEFAULT_REGION);
  // The pilot is one deployment in one region (tm 257.4): there is nothing to
  // choose, and the server files the workspace where it runs. Hiding the
  // picker is not enough — the state still holds 'eu', and sending it would
  // get every sign-up refused (421) by a deployment that serves 'us'.
  const {
    pilot_mode: pilotMode,
    terms_url: termsUrl,
    terms_version: termsVersion,
    privacy_policy_url: privacyUrl,
  } = useDeployment();
  // The terms box (tm 257.9) sits outside the form primitive, like the region
  // picker: a tick is not a string a validator has an opinion about, and the
  // four fields' rules stay exactly as they were. Shown only when the
  // deployment names terms; when it does not, or the answer never came, there
  // is no box — and the server still refuses a sign-up without acceptance.
  const termsRequired = Boolean(termsUrl && termsVersion);
  const [termsAccepted, setTermsAccepted] = useState(false);
  // The address a confirmation link was just sent to; set instead of signing in
  // when the deployment verifies addresses.
  const [checkInboxFor, setCheckInboxFor] = useState<string | null>(null);

  const form = useForm({
    initial: { organization: '', name: '', email: '', password: '' },
    validators: {
      organization: required(t('auth.validation.organizationRequired')),
      name: required(t('auth.validation.nameRequired')),
      email: compose(
        required(t('auth.validation.emailRequired')),
        emailRule(t('auth.validation.emailInvalid')),
      ),
      password: minLength(
        MIN_PASSWORD,
        t('auth.validation.passwordMinLength', { count: MIN_PASSWORD }),
      ),
    },
    onSubmit: async (values, { setSubmitError }) => {
      try {
        const session = await anonymous.post<{
          memberships?: Array<{ license_id: string }>;
        }>('/auth/signup', {
          email: values.email.trim(),
          password: values.password,
          name: values.name.trim(),
          organization_name: values.organization.trim(),
          ...(pilotMode ? {} : { region }),
          // The version the person was shown, which the server compares
          // with its own (`terms_outdated` when they differ).
          ...(termsRequired && termsAccepted ? { terms_version: termsVersion } : {}),
        });
        // A deployment that verifies addresses answers 202 with no session
        // (tm 257.16): nothing to sign in to until the link has been opened,
        // and the answer is the same for an address that already had an
        // account, so this page cannot say more than "check your inbox".
        const first = session?.memberships?.[0];
        if (!first) {
          setCheckInboxFor(values.email.trim());
          return;
        }
        // Straight into the workspace. Making someone sign in again immediately
        // after choosing a password is a step with nothing behind it.
        await signIn(values.email.trim(), values.password, first.license_id);
      } catch (failure) {
        setSubmitError(signupFailureMessage(failure, t));
      }
    },
  });

  if (checkInboxFor) {
    return (
      <AuthCard
        title={t('auth.verify.checkTitle')}
        subtitle={t('auth.verify.checkSubtitle')}
        footer={
          <Link to="/signin" className="text-content-brand underline">
            {t('auth.common.backToSignIn')}
          </Link>
        }
      >
        <p className="mb-4 text-sm text-content-secondary">
          {t('auth.verify.checkBody', { email: checkInboxFor })}
        </p>
        {/* The mail went out a moment ago, so the button starts out waiting. */}
        <ResendVerification email={checkInboxFor} initialWait={RESEND_COOLDOWN_SECONDS} />
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title={t('auth.signup.title')}
      subtitle={t('auth.signup.subtitle')}
      footer={
        <>
          {t('auth.signup.alreadyHaveAccount')}{' '}
          <Link to="/signin" className="text-content-brand underline">
            {t('auth.signup.signIn')}
          </Link>
        </>
      }
    >
      <form onSubmit={form.handleSubmit} noValidate>
        <ErrorNote message={form.submitError} />
        <Field
          id="org"
          label={t('auth.fields.workspaceName')}
          value={form.values.organization}
          onChange={(value) => form.setValue('organization', value)}
          onBlur={() => form.blur('organization')}
          error={form.errorFor('organization')}
          autoFocus
        />
        {!pilotMode && (
          <>
            <div className="mb-4">
              <label htmlFor="signup-region" className="mb-1.5 block text-sm font-medium">
                {t('auth.fields.dataRegion')}
              </label>
              <select
                id="signup-region"
                value={region}
                onChange={(event) => setRegion(event.target.value as Region)}
                className="w-full rounded-md border border-border bg-inset px-3 py-2 text-sm"
              >
                {REGIONS.map((value) => (
                  <option key={value} value={value}>
                    {t(`auth.signup.region.${value}`)}
                  </option>
                ))}
              </select>
            </div>
            <Banner tone="warning" className="mb-4">
              {t('auth.signup.regionWarning')}
            </Banner>
          </>
        )}
        <Field
          id="name"
          label={t('auth.fields.yourName')}
          value={form.values.name}
          onChange={(value) => form.setValue('name', value)}
          onBlur={() => form.blur('name')}
          error={form.errorFor('name')}
        />
        <Field
          id="email"
          label={t('auth.fields.email')}
          type="email"
          value={form.values.email}
          onChange={(value) => form.setValue('email', value)}
          onBlur={() => form.blur('email')}
          error={form.errorFor('email')}
        />
        <Field
          id="password"
          label={t('auth.fields.password')}
          type="password"
          value={form.values.password}
          onChange={(value) => form.setValue('password', value)}
          onBlur={() => form.blur('password')}
          error={form.errorFor('password')}
          hint={t('auth.signup.passwordHint', { count: MIN_PASSWORD })}
        />
        {termsRequired && termsUrl && (
          <div className="mb-4 flex items-start gap-2">
            <input
              id="signup-terms"
              type="checkbox"
              checked={termsAccepted}
              onChange={(event) => setTermsAccepted(event.target.checked)}
              aria-describedby="signup-terms-links"
              className="mt-0.5"
            />
            <div className="text-xs">
              {/* The label is the sentence only; the links are their own line,
                  so neither leaks into the other's accessible name. */}
              <label htmlFor="signup-terms" className="block font-medium">
                {privacyUrl ? t('auth.signup.termsAgree') : t('auth.signup.termsAgreeTermsOnly')}
              </label>
              <p id="signup-terms-links" className="mt-0.5 text-content-secondary">
                <LegalLink href={termsUrl}>{t('auth.legal.terms')}</LegalLink>
                {privacyUrl && (
                  <>
                    <span aria-hidden="true"> · </span>
                    <LegalLink href={privacyUrl}>{t('auth.legal.privacy')}</LegalLink>
                  </>
                )}
              </p>
            </div>
          </div>
        )}
        {/* Disabled until the form can actually succeed (FR-EK-A.1). */}
        <button
          type="submit"
          disabled={!form.canSubmit || (termsRequired && !termsAccepted)}
          className="w-full rounded-md bg-brand-500 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {form.isSubmitting ? t('auth.signup.submitting') : t('auth.signup.submit')}
        </button>
      </form>
    </AuthCard>
  );
}

/** FR-MOD-00.3 — ask for a link. The answer never says whether you got one. */
export function ForgotPasswordPage(): ReactElement {
  const t = useTranslate();
  const [sent, setSent] = useState(false);

  const form = useForm({
    initial: { email: '' },
    validators: {
      email: compose(
        required(t('auth.validation.emailRequired')),
        emailRule(t('auth.validation.emailInvalid')),
      ),
    },
    // Deliberately no error branch: the server answers 202 either way, and a UI
    // that showed a failure for one address and not another would reopen the
    // enumeration channel the endpoint closes.
    onSubmit: async (values) => {
      await anonymous
        .post('/auth/password-reset', { email: values.email.trim() })
        .catch(() => undefined);
      setSent(true);
    },
  });

  return (
    <AuthCard
      title={t('auth.forgotPassword.title')}
      subtitle={t('auth.forgotPassword.subtitle')}
      footer={
        <Link to="/signin" className="text-content-brand underline">
          {t('auth.common.backToSignIn')}
        </Link>
      }
    >
      {sent ? (
        <p role="status" className="text-sm text-content-secondary">
          {t('auth.forgotPassword.sent')}
        </p>
      ) : (
        <form onSubmit={form.handleSubmit} noValidate>
          <Field
            id="email"
            label={t('auth.fields.email')}
            type="email"
            value={form.values.email}
            onChange={(value) => form.setValue('email', value)}
            onBlur={() => form.blur('email')}
            error={form.errorFor('email')}
            autoFocus
          />
          <Submit disabled={!form.canSubmit}>
            {form.isSubmitting
              ? t('auth.forgotPassword.submitting')
              : t('auth.forgotPassword.submit')}
          </Submit>
        </form>
      )}
    </AuthCard>
  );
}

/** FR-MOD-00.3 — spend the link. */
export function ResetPasswordPage(): ReactElement {
  const t = useTranslate();
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [done, setDone] = useState(false);

  const form = useForm({
    initial: { password: '' },
    validators: {
      password: minLength(
        MIN_PASSWORD,
        t('auth.validation.passwordMinLength', { count: MIN_PASSWORD }),
      ),
    },
    onSubmit: async (values, { setSubmitError }) => {
      try {
        await anonymous.post('/auth/password-reset/confirm', { token, password: values.password });
        setDone(true);
      } catch {
        setSubmitError(t('auth.resetPassword.errorInvalidLink'));
      }
    },
  });

  return (
    <AuthCard
      title={t('auth.resetPassword.title')}
      subtitle={t('auth.resetPassword.subtitle')}
      footer={
        <Link to="/signin" className="text-content-brand underline">
          {t('auth.common.backToSignIn')}
        </Link>
      }
    >
      {done ? (
        <p role="status" className="text-sm text-content-secondary">
          {t('auth.resetPassword.done')}
        </p>
      ) : (
        <form onSubmit={form.handleSubmit} noValidate>
          <ErrorNote message={form.submitError} />
          <Field
            id="password"
            label={t('auth.fields.newPassword')}
            type="password"
            value={form.values.password}
            onChange={(value) => form.setValue('password', value)}
            onBlur={() => form.blur('password')}
            error={form.errorFor('password')}
            hint={t('auth.resetPassword.hint', { count: MIN_PASSWORD })}
            autoFocus
          />
          <Submit disabled={!form.canSubmit}>
            {form.isSubmitting
              ? t('auth.resetPassword.submitting')
              : t('auth.resetPassword.submit')}
          </Submit>
        </form>
      )}
    </AuthCard>
  );
}

/** The bounds `POST /auth/verify-email` puts on a token. */
const VERIFY_TOKEN_MIN = 20;
const VERIFY_TOKEN_MAX = 200;

/**
 * FR-MOD-00.2 — spend the confirmation link (tm 257.16).
 *
 * The link proves the mailbox and the password proves the person, so the page
 * asks for both and the API checks both before it opens a session. Success
 * hands straight to the same sign-in everything else ends in.
 *
 * Every refusal reads the same — unknown, expired, used, wrong password — and
 * a wrong password leaves the link working, so the form stays to be tried again
 * and the new-link form appears beside it rather than instead of it. A browser
 * that is already signed in never reaches this page: the signed-in router's
 * catch-all takes the URL, as it does for `/join`.
 */
export function VerifyEmailPage(): ReactElement {
  const t = useTranslate();
  const [params] = useSearchParams();
  // A token outside the API's own length bounds (`verifyBody`: 20–200) can
  // never be a real link — a truncated or hand-typed address. It is treated as
  // no link at all, so the person is not asked for a password only to be told
  // the link was bad (UX audit D10). A well-formed but unknown or spent token
  // cannot be told apart without a new unauthenticated endpoint that would say
  // which links are real, so that case still asks first.
  const rawToken = params.get('token') ?? '';
  const token =
    rawToken.length >= VERIFY_TOKEN_MIN && rawToken.length <= VERIFY_TOKEN_MAX ? rawToken : '';
  const signIn = useAuth((s) => s.signIn);
  const [refused, setRefused] = useState(false);

  const form = useForm({
    initial: { password: '' },
    validators: {
      password: minLength(
        MIN_PASSWORD,
        t('auth.validation.passwordMinLength', { count: MIN_PASSWORD }),
      ),
    },
    onSubmit: async (values, { setSubmitError }) => {
      let session: { account: { email: string }; memberships: Array<{ license_id: string }> };
      try {
        session = await anonymous.post('/auth/verify-email', { token, password: values.password });
      } catch {
        setRefused(true);
        setSubmitError(t('auth.verify.errorInvalid'));
        return;
      }
      // Past this point the address is confirmed, and the sentence must not
      // send the person back to a link that has just been spent.
      try {
        await signIn(session.account.email, values.password, session.memberships[0]!.license_id);
      } catch {
        setSubmitError(t('auth.verify.errorSignIn'));
      }
    },
  });

  return (
    <AuthCard
      title={t('auth.verify.title')}
      subtitle={t('auth.verify.subtitle')}
      footer={
        <Link to="/signin" className="text-content-brand underline">
          {t('auth.common.backToSignIn')}
        </Link>
      }
    >
      {token ? (
        <form onSubmit={form.handleSubmit} noValidate>
          <ErrorNote message={form.submitError} />
          <Field
            id="password"
            label={t('auth.fields.password')}
            type="password"
            value={form.values.password}
            onChange={(value) => form.setValue('password', value)}
            onBlur={() => form.blur('password')}
            error={form.errorFor('password')}
            hint={t('auth.verify.passwordHint')}
            autoFocus
          />
          <Submit disabled={!form.canSubmit}>
            {form.isSubmitting ? t('auth.verify.submitting') : t('auth.verify.submit')}
          </Submit>
        </form>
      ) : (
        <p role="alert" className="text-sm text-danger">
          {t('auth.verify.noToken')}
        </p>
      )}
      {(refused || !token) && <ResendByAddress />}
    </AuthCard>
  );
}

interface Preview {
  organization_name: string;
  email: string;
  role: string;
  needs_password: boolean;
}

/** The receiving half of FR-MOD-04.4 — what an invited person lands on. */
export function JoinPage(): ReactElement {
  const t = useTranslate();
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const navigate = useNavigate();

  const [preview, setPreview] = useState<Preview | null>(null);
  const [invalid, setInvalid] = useState(false);

  const signIn = useAuth((s) => s.signIn);
  // No box here (tm 257.9 · ADR K-f): the party to the terms is the workspace,
  // and its owner accepted them at sign-up. A joiner is told, and given the
  // links under the card.
  const { terms_url: termsUrl } = useDeployment();

  useEffect(() => {
    let cancelled = false;
    anonymous
      .get<Preview>(`/auth/invitations/preview?token=${encodeURIComponent(token)}`)
      .then((result) => {
        if (!cancelled) setPreview(result);
      })
      .catch(() => {
        if (!cancelled) setInvalid(true);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  // An existing account only accepts — no fields, so nothing to validate. A new
  // account must name itself and pick a password before Join enables.
  const needsPassword = preview?.needs_password ?? false;
  const form = useForm({
    initial: { name: '', password: '' },
    validators: needsPassword
      ? {
          name: required(t('auth.validation.nameRequired')),
          password: minLength(
            MIN_PASSWORD,
            t('auth.validation.passwordMinLength', { count: MIN_PASSWORD }),
          ),
        }
      : undefined,
    onSubmit: async (values, { setSubmitError }) => {
      try {
        const session = await anonymous.post<{ memberships: Array<{ license_id: string }> }>(
          '/auth/invitations/accept',
          {
            token,
            ...(needsPassword ? { name: values.name.trim(), password: values.password } : {}),
          },
        );

        if (needsPassword && preview) {
          await signIn(preview.email, values.password, session.memberships.at(-1)!.license_id);
        } else {
          // They already had an account, and we never asked for its password —
          // so send them to sign in rather than pretending we can log them in.
          navigate('/signin');
        }
      } catch {
        setSubmitError(t('auth.join.errorGeneric'));
      }
    },
  });

  if (invalid) {
    return (
      <AuthCard title={t('auth.join.invalidTitle')} subtitle={t('auth.join.invalidSubtitle')}>
        <p className="text-sm text-content-secondary">{t('auth.join.invalidBody')}</p>
      </AuthCard>
    );
  }

  if (!preview) {
    return (
      <AuthCard title={t('auth.join.checkingTitle')} subtitle={t('auth.join.checkingSubtitle')}>
        <p role="status" className="text-sm text-content-secondary">
          {t('auth.join.loading')}
        </p>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title={t('auth.join.title', { organization: preview.organization_name })}
      subtitle={t('auth.join.subtitle', { role: preview.role, email: preview.email })}
    >
      <form onSubmit={form.handleSubmit} noValidate>
        <ErrorNote message={form.submitError} />
        {preview.needs_password ? (
          <>
            <Field
              id="name"
              label={t('auth.fields.yourName')}
              value={form.values.name}
              onChange={(value) => form.setValue('name', value)}
              onBlur={() => form.blur('name')}
              error={form.errorFor('name')}
              autoFocus
            />
            <Field
              id="password"
              label={t('auth.fields.choosePassword')}
              type="password"
              value={form.values.password}
              onChange={(value) => form.setValue('password', value)}
              onBlur={() => form.blur('password')}
              error={form.errorFor('password')}
              hint={t('auth.join.passwordHint', { count: MIN_PASSWORD })}
            />
          </>
        ) : (
          <p className="mb-4 text-sm text-content-secondary">
            {t('auth.join.existingAccountNotice')}
          </p>
        )}
        {termsUrl && (
          <p className="mb-4 text-xs text-content-secondary">{t('auth.join.termsNotice')}</p>
        )}
        <button
          type="submit"
          disabled={!form.canSubmit}
          className="w-full rounded-md bg-brand-500 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {form.isSubmitting ? t('auth.join.submitting') : t('auth.join.submit')}
        </button>
      </form>
    </AuthCard>
  );
}
