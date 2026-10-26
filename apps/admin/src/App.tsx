import { useEffect, type ReactElement } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/AppShell.js';
import { AccountsSection } from './features/accounts/AccountsSection.js';
import { LoadingPage } from './components/LoadingPage.js';
import { NotFoundPage } from './components/NotFoundPage.js';
import { RequirePermission } from './components/RequirePermission.js';
import { ChallengePage } from './features/auth/ChallengePage.js';
import { DashboardPage } from './features/dashboard/DashboardPage.js';
import { InvitePage } from './features/auth/InvitePage.js';
import { OperationsPage } from './features/operations/OperationsPage.js';
import { RecoveryCodesPage } from './features/auth/RecoveryCodesPage.js';
import { SignInPage } from './features/auth/SignInPage.js';
import { PlaceholderPage } from './features/placeholder/PlaceholderPage.js';
import { SettingsPage } from './features/settings/SettingsPage.js';
import { SupportPage } from './features/support/SupportPage.js';
import { WorkspacesSection } from './features/workspaces/WorkspacesSection.js';
import { useAuth } from './lib/auth-store.js';
import { NAV_ITEMS, type NavItem } from './lib/navigation.js';

/**
 * Which screen the session is on: nothing drawn until a stored token is checked, then the
 * password page, the code page (`challenge`), the one-time recovery sheet, or the shell.
 *
 * A signed-out tree is a router of two routes rather than a single page because the invitation
 * mail links to `/invite#token=…` and a sign-in form would throw that away.
 */
export function App(): ReactElement {
  const status = useAuth((s) => s.status);
  const recoveryCodes = useAuth((s) => s.recoveryCodes);
  const restore = useAuth((s) => s.restore);

  useEffect(() => {
    if (status === 'unknown') void restore();
  }, [status, restore]);

  if (status === 'unknown') return <LoadingPage />;

  if (status === 'signed-out') {
    return (
      <Routes>
        <Route path="/invite" element={<InvitePage />} />
        <Route path="*" element={<SignInPage />} />
      </Routes>
    );
  }

  if (status === 'challenge') return <ChallengePage />;

  // Held back until the operator has the sheet: it is shown once and cannot be fetched again.
  if (recoveryCodes !== null) return <RecoveryCodesPage />;

  return <SignedInRoutes />;
}

function SignedInRoutes(): ReactElement {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<Navigate to="/dashboard" replace />} />
        {/* `/*`: the pages that arrive later own their sub-addresses (`/workspaces/:id`). */}
        {NAV_ITEMS.map((item) => (
          <Route
            key={item.id}
            path={`${item.path}/*`}
            element={
              <RequirePermission permission={item.permission}>
                <SectionPage item={item} />
              </RequirePermission>
            }
          />
        ))}
        {/* An address that is not a page says so (apps/web, UX audit D11). */}
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}

/** The page a menu entry opens: its feature once built, the empty skeleton until then. */
function SectionPage({ item }: { item: NavItem }): ReactElement {
  switch (item.id) {
    case 'dashboard':
      return <DashboardPage />;
    case 'workspaces':
      return <WorkspacesSection />;
    case 'accounts':
      return <AccountsSection />;
    case 'settings':
      return <SettingsPage />;
    case 'operations':
      return <OperationsPage />;
    case 'support':
      return <SupportPage />;
    default:
      return <PlaceholderPage item={item} />;
  }
}
