import { useEffect, type ReactElement } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/AppShell.js';
import { SignInPage } from './features/auth/SignInPage.js';
import { BillingPage } from './features/billing/BillingPage.js';
import { CustomersPage } from './features/customers/CustomersPage.js';
import { SettingsPage } from './features/settings/SettingsPage.js';
import { InboxPage } from './features/inbox/InboxPage.js';
import { ReportsPage } from './features/reports/ReportsPage.js';
import { TeamPage } from './features/team/TeamPage.js';
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

  // Signing out mid-session must not leave a module route rendering against a
  // dead token, so the whole tree collapses to sign-in rather than redirecting.
  if (status !== 'signed-in') return <SignInPage />;

  return (
    <Routes>
      <Route path="/app" element={<AppShell />}>
        <Route index element={<Navigate to="/app/inbox" replace />} />
        <Route path="inbox" element={<InboxPage />} />
        <Route path="customers" element={<CustomersPage />} />
        <Route path="team" element={<TeamPage />} />
        <Route path="reports" element={<ReportsPage />} />
        <Route path="billing" element={<BillingPage />} />
        <Route path="settings" element={<SettingsPage />} />
      </Route>
      {/* Anything else, including the OAuth callback path, lands in the inbox. */}
      <Route path="*" element={<Navigate to="/app/inbox" replace />} />
    </Routes>
  );
}
