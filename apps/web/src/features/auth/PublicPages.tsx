/**
 * The screens someone sees before they have a workspace (PRD FR-MOD-00.2–00.4,
 * and the receiving half of 04.4).
 *
 * All four sit outside the signed-in tree, so they share a card rather than the
 * app shell. Each ends by handing off to the same sign-in the product already
 * had — creating a workspace and joining one both leave you with credentials,
 * and issuing tokens from three places would mean three places to get wrong.
 */
import { useEffect, useState, type FormEvent, type ReactElement, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ApiClient, ApiClientError } from '../../lib/api-client.js';
import { useAuth } from '../../lib/auth-store.js';

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

function Field({
  id,
  label,
  type = 'text',
  value,
  onChange,
  hint,
  autoFocus,
}: {
  id: string;
  label: string;
  type?: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  autoFocus?: boolean;
}): ReactElement {
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
        className="w-full rounded-md border border-border bg-inset px-3 py-2 text-sm"
      />
      {hint && (
        <p id={`${id}-hint`} className="mt-1 text-2xs text-content-tertiary">
          {hint}
        </p>
      )}
    </div>
  );
}

function Submit({ children, busy }: { children: ReactNode; busy: boolean }): ReactElement {
  return (
    <button
      type="submit"
      disabled={busy}
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

/** FR-MOD-00.2 — create a workspace and its first owner. */
export function SignUpPage(): ReactElement {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [organization, setOrganization] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const signIn = useAuth((s) => s.signIn);

  const onSubmit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const session = await anonymous.post<{ memberships: Array<{ license_id: string }> }>(
        '/auth/signup',
        { email, password, name, organization_name: organization },
      );
      // Straight into the workspace. Making someone sign in again immediately
      // after choosing a password is a step with nothing behind it.
      await signIn(email, password, session.memberships[0]!.license_id);
    } catch (failure) {
      setError(
        failure instanceof ApiClientError && failure.type === 'account_exists'
          ? 'An account already exists for that email — sign in instead.'
          : 'Could not create that workspace.',
      );
      setBusy(false);
    }
  };

  const valid =
    email.includes('@') && password.length >= MIN_PASSWORD && name.trim() && organization.trim();

  return (
    <AuthCard
      title="Create a workspace"
      subtitle="14 days free. No card."
      footer={
        <>
          Already have an account? <Link to="/signin" className="text-brand-600 underline">Sign in</Link>
        </>
      }
    >
      <form onSubmit={(event) => void onSubmit(event)}>
        <ErrorNote message={error} />
        <Field id="org" label="Workspace name" value={organization} onChange={setOrganization} autoFocus />
        <Field id="name" label="Your name" value={name} onChange={setName} />
        <Field id="email" label="Email" type="email" value={email} onChange={setEmail} />
        <Field
          id="password"
          label="Password"
          type="password"
          value={password}
          onChange={setPassword}
          hint={`At least ${MIN_PASSWORD} characters. Length is the only rule.`}
        />
        {/* Disabled until the form can actually succeed (FR-EK-A.1). */}
        <button
          type="submit"
          disabled={!valid || busy}
          className="w-full rounded-md bg-brand-500 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {busy ? 'Creating…' : 'Create workspace'}
        </button>
      </form>
    </AuthCard>
  );
}

/** FR-MOD-00.3 — ask for a link. The answer never says whether you got one. */
export function ForgotPasswordPage(): ReactElement {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  const onSubmit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    // Deliberately no error branch: the server answers 202 either way, and a UI
    // that showed a failure for one address and not another would reopen the
    // enumeration channel the endpoint closes.
    await anonymous.post('/auth/password-reset', { email }).catch(() => undefined);
    setSent(true);
    setBusy(false);
  };

  return (
    <AuthCard
      title="Reset your password"
      subtitle="We will send you a link."
      footer={<Link to="/signin" className="text-brand-600 underline">Back to sign in</Link>}
    >
      {sent ? (
        <p role="status" className="text-sm text-content-secondary">
          If an account exists for that address, we sent a link. It expires in an hour.
        </p>
      ) : (
        <form onSubmit={(event) => void onSubmit(event)}>
          <Field id="email" label="Email" type="email" value={email} onChange={setEmail} autoFocus />
          <Submit busy={busy || !email.includes('@')}>{busy ? 'Sending…' : 'Send link'}</Submit>
        </form>
      )}
    </AuthCard>
  );
}

/** FR-MOD-00.3 — spend the link. */
export function ResetPasswordPage(): ReactElement {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  const onSubmit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await anonymous.post('/auth/password-reset/confirm', { token, password });
      setDone(true);
    } catch {
      setError('This link is no longer valid. Ask for a new one.');
    }
    setBusy(false);
  };

  return (
    <AuthCard
      title="Choose a new password"
      subtitle="The link works once."
      footer={<Link to="/signin" className="text-brand-600 underline">Back to sign in</Link>}
    >
      {done ? (
        <p role="status" className="text-sm text-content-secondary">
          Your password is set, and any other sessions have been signed out. You can sign in now.
        </p>
      ) : (
        <form onSubmit={(event) => void onSubmit(event)}>
          <ErrorNote message={error} />
          <Field
            id="password"
            label="New password"
            type="password"
            value={password}
            onChange={setPassword}
            hint={`At least ${MIN_PASSWORD} characters.`}
            autoFocus
          />
          <Submit busy={busy || password.length < MIN_PASSWORD}>
            {busy ? 'Saving…' : 'Set password'}
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
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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

  const onSubmit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const session = await anonymous.post<{ memberships: Array<{ license_id: string }> }>(
        '/auth/invitations/accept',
        {
          token,
          ...(preview?.needs_password ? { name, password } : {}),
        },
      );

      if (preview?.needs_password) {
        await signIn(preview.email, password, session.memberships.at(-1)!.license_id);
      } else {
        // They already had an account, and we never asked for its password —
        // so send them to sign in rather than pretending we can log them in.
        navigate('/signin');
      }
    } catch {
      setError('Could not accept that invitation.');
      setBusy(false);
    }
  };

  if (invalid) {
    return (
      <AuthCard title="This invitation is not valid" subtitle="It may have expired or been revoked.">
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

  const valid = !preview.needs_password || (name.trim() && password.length >= MIN_PASSWORD);

  return (
    <AuthCard
      title={`Join ${preview.organization_name}`}
      subtitle={`Invited as ${preview.role} · ${preview.email}`}
    >
      <form onSubmit={(event) => void onSubmit(event)}>
        <ErrorNote message={error} />
        {preview.needs_password ? (
          <>
            <Field id="name" label="Your name" value={name} onChange={setName} autoFocus />
            <Field
              id="password"
              label="Choose a password"
              type="password"
              value={password}
              onChange={setPassword}
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
          disabled={!valid || busy}
          className="w-full rounded-md bg-brand-500 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {busy ? 'Joining…' : 'Join workspace'}
        </button>
      </form>
    </AuthCard>
  );
}
