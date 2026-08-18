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
import { DEFAULT_REGION, REGIONS, type Region } from '@nexa/types';
import { ApiClient, ApiClientError } from '../../lib/api-client.js';
import { useAuth } from '../../lib/auth-store.js';
import { useTranslate, type TFunction } from '../../lib/i18n.js';
import { Banner } from '../../components/ui/index.js';
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
            <h1 className="text-lg font-semibold">{title}</h1>
            <p className="text-xs text-content-secondary">{subtitle}</p>
          </div>
        </header>
        <div className="rounded-lg border border-border bg-surface p-5">{children}</div>
        {footer && <p className="mt-4 text-center text-xs text-content-tertiary">{footer}</p>}
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
        const session = await anonymous.post<{ memberships: Array<{ license_id: string }> }>(
          '/auth/signup',
          {
            email: values.email.trim(),
            password: values.password,
            name: values.name.trim(),
            organization_name: values.organization.trim(),
            region,
          },
        );
        // Straight into the workspace. Making someone sign in again immediately
        // after choosing a password is a step with nothing behind it.
        await signIn(values.email.trim(), values.password, session.memberships[0]!.license_id);
      } catch (failure) {
        setSubmitError(signupFailureMessage(failure, t));
      }
    },
  });

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
        {/* Disabled until the form can actually succeed (FR-EK-A.1). */}
        <button
          type="submit"
          disabled={!form.canSubmit}
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
