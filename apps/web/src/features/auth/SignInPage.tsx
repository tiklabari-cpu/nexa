import { useState, type ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { useAuth, type Membership } from '../../lib/auth-store.js';
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
 */
export function SignInPage(): ReactElement {
  const [workspaces, setWorkspaces] = useState<Membership[] | null>(null);
  const [chooseError, setChooseError] = useState<string | null>(null);

  const busy = useAuth((s) => s.busy);
  const listWorkspaces = useAuth((s) => s.listWorkspaces);
  const signIn = useAuth((s) => s.signIn);

  const form = useForm({
    initial: { email: '', password: '' },
    validators: {
      email: compose(required('Enter your email.'), emailRule()),
      password: required('Enter your password.'),
    },
    onSubmit: async (values, { setSubmitError }) => {
      try {
        const memberships = await listWorkspaces(values.email, values.password);
        if (memberships.length === 0) {
          setSubmitError('This account is not a member of any workspace.');
          return;
        }
        if (memberships.length === 1) {
          await signIn(values.email, values.password, memberships[0]!.license_id);
          return;
        }
        setWorkspaces(memberships);
      } catch {
        // One message for a wrong password and an unknown address alike — the
        // server does not distinguish them and neither should the UI.
        setSubmitError('Invalid email or password.');
      }
    },
  });

  const choose = async (licenseId: string): Promise<void> => {
    setChooseError(null);
    try {
      await signIn(form.values.email, form.values.password, licenseId);
    } catch {
      setChooseError('Could not open that workspace.');
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
            <p className="text-xs text-content-secondary">Sign in to your workspace</p>
          </div>
        </header>

        {workspaces ? (
          <section
            aria-label="Choose a workspace"
            className="rounded-lg border border-border bg-surface p-4 shadow-xs"
          >
            <h2 className="mb-3 text-sm font-medium">Choose a workspace</h2>
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
                      {workspace.role}
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
                Email
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
                Password
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
              {busy || form.isSubmitting ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        )}

        <p className="mt-4 text-center text-xs text-content-secondary">
          <Link to="/forgot-password" className="text-content-brand underline">
            Forgot your password?
          </Link>
        </p>
        <p className="mt-2 text-center text-xs text-content-secondary">
          New here?{' '}
          <Link to="/signup" className="text-content-brand underline">
            Create a workspace
          </Link>
        </p>

        <p className="mt-4 text-center text-2xs text-content-tertiary">
          Demo: owner@acme.localhost / nexa-demo-password
        </p>
      </div>
    </main>
  );
}
