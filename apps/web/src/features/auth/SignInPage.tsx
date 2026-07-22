import { useState, type FormEvent, type ReactElement } from 'react';
import { useAuth, type Membership } from '../../lib/auth-store.js';

/**
 * Sign-in.
 *
 * Two steps, because an account can belong to several workspaces and picking
 * one afterwards is worse than picking it here: the agent would land in the
 * wrong inbox and have to work out why.
 *
 * The single step is skipped automatically when there is only one workspace.
 */
export function SignInPage(): ReactElement {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [workspaces, setWorkspaces] = useState<Membership[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const busy = useAuth((s) => s.busy);
  const listWorkspaces = useAuth((s) => s.listWorkspaces);
  const signIn = useAuth((s) => s.signIn);

  const onSubmit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setError(null);
    try {
      const memberships = await listWorkspaces(email, password);
      if (memberships.length === 0) {
        setError('This account is not a member of any workspace.');
        return;
      }
      if (memberships.length === 1) {
        await signIn(email, password, memberships[0]!.license_id);
        return;
      }
      setWorkspaces(memberships);
    } catch {
      // One message for a wrong password and an unknown address alike — the
      // server does not distinguish them and neither should the UI.
      setError('Invalid email or password.');
    }
  };

  const choose = async (licenseId: string): Promise<void> => {
    setError(null);
    try {
      await signIn(email, password, licenseId);
    } catch {
      setError('Could not open that workspace.');
    }
  };

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
            onSubmit={(event) => void onSubmit(event)}
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
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="rounded-md border border-border bg-inset px-3 py-2 text-sm"
              />
            </div>

            <div className="flex flex-col gap-1">
              <label htmlFor="password" className="text-xs font-medium">
                Password
              </label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="rounded-md border border-border bg-inset px-3 py-2 text-sm"
              />
            </div>

            {error && (
              <p role="alert" className="text-xs text-danger">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={busy}
              className="mt-1 rounded-md bg-brand-500 px-3 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50"
            >
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        )}

        <p className="mt-4 text-center text-2xs text-content-tertiary">
          Demo: owner@acme.localhost / nexa-demo-password
        </p>
      </div>
    </main>
  );
}
