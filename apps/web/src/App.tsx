import { useEffect, type ReactElement } from 'react';
import { SignInPage } from './features/auth/SignInPage.js';
import { InboxPage } from './features/inbox/InboxPage.js';
import { useAuth } from './lib/auth-store.js';

export function App(): ReactElement {
  const status = useAuth((s) => s.status);
  const restore = useAuth((s) => s.restore);

  useEffect(() => {
    if (status === 'unknown') void restore();
  }, [status, restore]);

  if (status === 'unknown') {
    return (
      <div className="flex min-h-full items-center justify-center bg-canvas">
        <p role="status" className="text-sm text-content-secondary">
          Loading…
        </p>
      </div>
    );
  }

  return status === 'signed-in' ? <InboxPage /> : <SignInPage />;
}
