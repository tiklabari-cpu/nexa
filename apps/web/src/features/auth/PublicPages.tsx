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

const REGION_LABELS: Record<Region, string> = {
  eu: 'European Union',
  us: 'United States',
};

/** FR-MOD-00.2 — create a workspace and its first owner. */
export function SignUpPage(): ReactElement {
  const signIn = useAuth((s) => s.signIn);
  // Not a form field (ADR-12): a `<select>` next to a warning, not something a
  // string validator has an opinion about — the same split `InviteTeammates`
  // uses for its role picker.
  const [region, setRegion] = useState<Region>(DEFAULT_REGION);

  const form = useForm({
    initial: { organization: '', name: '', email: '', password: '' },
    validators: {
      organization: required('Enter a workspace name.'),
      name: required('Enter your name.'),
      email: compose(required('Enter your email.'), emailRule()),
      password: minLength(MIN_PASSWORD, `Use at least ${MIN_PASSWORD} characters.`),
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
        setSubmitError(
          failure instanceof ApiClientError && failure.type === 'account_exists'
            ? 'An account already exists for that email — sign in instead.'
            : 'Could not create that workspace.',
        );
      }
    },
  });

  return (
    <AuthCard
      title="Create a workspace"
      subtitle="14 days free. No card."
      footer={
        <>
          Already have an account?{' '}
          <Link to="/signin" className="text-content-brand underline">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={form.handleSubmit} noValidate>
        <ErrorNote message={form.submitError} />
        <Field
          id="org"
          label="Workspace name"
          value={form.values.organization}
          onChange={(value) => form.setValue('organization', value)}
          onBlur={() => form.blur('organization')}
          error={form.errorFor('organization')}
          autoFocus
        />
        <div className="mb-4">
          <label htmlFor="signup-region" className="mb-1.5 block text-sm font-medium">
            Data region
          </label>
          <select
            id="signup-region"
            value={region}
            onChange={(event) => setRegion(event.target.value as Region)}
            className="w-full rounded-md border border-border bg-inset px-3 py-2 text-sm"
          >
            {REGIONS.map((value) => (
              <option key={value} value={value}>
                {REGION_LABELS[value]}
              </option>
            ))}
          </select>
        </div>
        <Banner tone="warning" className="mb-4">
          This is where your workspace's data will live. It cannot be changed after your workspace
          is created.
        </Banner>
        <Field
          id="name"
          label="Your name"
          value={form.values.name}
          onChange={(value) => form.setValue('name', value)}
          onBlur={() => form.blur('name')}
          error={form.errorFor('name')}
        />
        <Field
          id="email"
          label="Email"
          type="email"
          value={form.values.email}
          onChange={(value) => form.setValue('email', value)}
          onBlur={() => form.blur('email')}
          error={form.errorFor('email')}
        />
        <Field
          id="password"
          label="Password"
          type="password"
          value={form.values.password}
          onChange={(value) => form.setValue('password', value)}
          onBlur={() => form.blur('password')}
          error={form.errorFor('password')}
          hint={`At least ${MIN_PASSWORD} characters. Length is the only rule.`}
        />
        {/* Disabled until the form can actually succeed (FR-EK-A.1). */}
        <button
          type="submit"
          disabled={!form.canSubmit}
          className="w-full rounded-md bg-brand-500 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {form.isSubmitting ? 'Creating…' : 'Create workspace'}
        </button>
      </form>
    </AuthCard>
  );
}

/** FR-MOD-00.3 — ask for a link. The answer never says whether you got one. */
export function ForgotPasswordPage(): ReactElement {
  const [sent, setSent] = useState(false);

  const form = useForm({
    initial: { email: '' },
    validators: { email: compose(required('Enter your email.'), emailRule()) },
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
      title="Reset your password"
      subtitle="We will send you a link."
      footer={
        <Link to="/signin" className="text-content-brand underline">
          Back to sign in
        </Link>
      }
    >
      {sent ? (
        <p role="status" className="text-sm text-content-secondary">
          If an account exists for that address, we sent a link. It expires in an hour.
        </p>
      ) : (
        <form onSubmit={form.handleSubmit} noValidate>
          <Field
            id="email"
            label="Email"
            type="email"
            value={form.values.email}
            onChange={(value) => form.setValue('email', value)}
            onBlur={() => form.blur('email')}
            error={form.errorFor('email')}
            autoFocus
          />
          <Submit disabled={!form.canSubmit}>{form.isSubmitting ? 'Sending…' : 'Send link'}</Submit>
        </form>
      )}
    </AuthCard>
  );
}

/** FR-MOD-00.3 — spend the link. */
export function ResetPasswordPage(): ReactElement {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [done, setDone] = useState(false);

  const form = useForm({
    initial: { password: '' },
    validators: { password: minLength(MIN_PASSWORD, `Use at least ${MIN_PASSWORD} characters.`) },
    onSubmit: async (values, { setSubmitError }) => {
      try {
        await anonymous.post('/auth/password-reset/confirm', { token, password: values.password });
        setDone(true);
      } catch {
        setSubmitError('This link is no longer valid. Ask for a new one.');
      }
    },
  });

  return (
    <AuthCard
      title="Choose a new password"
      subtitle="The link works once."
      footer={
        <Link to="/signin" className="text-content-brand underline">
          Back to sign in
        </Link>
      }
    >
      {done ? (
        <p role="status" className="text-sm text-content-secondary">
          Your password is set, and any other sessions have been signed out. You can sign in now.
        </p>
      ) : (
        <form onSubmit={form.handleSubmit} noValidate>
          <ErrorNote message={form.submitError} />
          <Field
            id="password"
            label="New password"
            type="password"
            value={form.values.password}
            onChange={(value) => form.setValue('password', value)}
            onBlur={() => form.blur('password')}
            error={form.errorFor('password')}
            hint={`At least ${MIN_PASSWORD} characters.`}
            autoFocus
          />
          <Submit disabled={!form.canSubmit}>
            {form.isSubmitting ? 'Saving…' : 'Set password'}
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
          name: required('Enter your name.'),
          password: minLength(MIN_PASSWORD, `Use at least ${MIN_PASSWORD} characters.`),
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
        setSubmitError('Could not accept that invitation.');
      }
    },
  });

  if (invalid) {
    return (
      <AuthCard
        title="This invitation is not valid"
        subtitle="It may have expired or been revoked."
      >
        <p className="text-sm text-content-secondary">
          Ask whoever invited you to send a new one. Links work once and last seven days.
        </p>
      </AuthCard>
    );
  }

  if (!preview) {
    return (
      <AuthCard title="Checking your invitation" subtitle="One moment.">
        <p role="status" className="text-sm text-content-secondary">
          Loading…
        </p>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title={`Join ${preview.organization_name}`}
      subtitle={`Invited as ${preview.role} · ${preview.email}`}
    >
      <form onSubmit={form.handleSubmit} noValidate>
        <ErrorNote message={form.submitError} />
        {preview.needs_password ? (
          <>
            <Field
              id="name"
              label="Your name"
              value={form.values.name}
              onChange={(value) => form.setValue('name', value)}
              onBlur={() => form.blur('name')}
              error={form.errorFor('name')}
              autoFocus
            />
            <Field
              id="password"
              label="Choose a password"
              type="password"
              value={form.values.password}
              onChange={(value) => form.setValue('password', value)}
              onBlur={() => form.blur('password')}
              error={form.errorFor('password')}
              hint={`At least ${MIN_PASSWORD} characters.`}
            />
          </>
        ) : (
          <p className="mb-4 text-sm text-content-secondary">
            You already have a Nexa account for this address. Accepting adds this workspace to it.
          </p>
        )}
        <button
          type="submit"
          disabled={!form.canSubmit}
          className="w-full rounded-md bg-brand-500 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {form.isSubmitting ? 'Joining…' : 'Join workspace'}
        </button>
      </form>
    </AuthCard>
  );
}
