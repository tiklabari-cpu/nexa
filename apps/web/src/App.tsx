import { useEffect, type ReactElement } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/AppShell.js';
import { AuthCallbackPage } from './features/auth/AuthCallbackPage.js';
import { SignInPage } from './features/auth/SignInPage.js';
import {
  ForgotPasswordPage,
  JoinPage,
  ResetPasswordPage,
  SignUpPage,
} from './features/auth/PublicPages.js';
import { BillingPage } from './features/billing/BillingPage.js';
import { CustomersPage } from './features/customers/CustomersPage.js';
import { TrafficPage } from './features/traffic/TrafficPage.js';
import { CampaignsPage } from './features/campaigns/CampaignsPage.js';
import { GoalsPage } from './features/goals/GoalsPage.js';
import { PlaybookPage } from './features/playbook/PlaybookPage.js';
import { SettingsPage } from './features/settings/SettingsPage.js';
import { AuditLogPage } from './features/audit/AuditLogPage.js';
import { AppsMarketplacePage } from './features/apps/AppsMarketplace.js';
import { DeveloperPortalPage } from './features/developers/DeveloperPortal.js';
import { InboxPage } from './features/inbox/InboxPage.js';
import { HomePage } from './features/home/HomePage.js';
import { ReportsPage } from './features/reports/ReportsPage.js';
import { TeamPage } from './features/team/TeamPage.js';
import { TeamAiAgentsPage } from './features/team/TeamAiAgentsPage.js';
import { TeamsPage } from './features/team/TeamsPage.js';
import { OnboardingWizard } from './features/onboarding/OnboardingWizard.js';
import { useAuth } from './lib/auth-store.js';

export function App(): ReactElement {
  const status = useAuth((s) => s.status);
  const restore = useAuth((s) => s.restore);
  const agent = useAuth((s) => s.agent);

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
  // dead token, so the whole tree collapses to the signed-out routes rather
  // than redirecting.
  //
  // Those routes are a real router rather than a single page because four of
  // them arrive carrying something in the URL that a sign-in form would throw
  // away: `/join` and `/reset-password` a token from an email, and
  // `/auth/callback` the authorization code a federated sign-in just earned
  // (NFR-S11 · S11-i).
  if (status !== 'signed-in') {
    return (
      <Routes>
        <Route path="/signup" element={<SignUpPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/join" element={<JoinPage />} />
        <Route path="/auth/callback" element={<AuthCallbackPage />} />
        <Route path="*" element={<SignInPage />} />
      </Routes>
    );
  }

  // A workspace created through signup opens empty, so a brand-new owner is sent
  // through the first-run wizard before the shell. The flag is explicitly `false`
  // only for such a workspace; older sessions without the field are treated as
  // already set up, so this never traps an existing user. While it holds, every
  // path leads to the wizard — deep-linking to a module cannot slip past setup.
  if (agent?.onboarding_completed === false) {
    return (
      <Routes>
        <Route path="/app/onboarding" element={<OnboardingWizard />} />
        <Route path="*" element={<Navigate to="/app/onboarding" replace />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route path="/app" element={<AppShell />}>
        <Route index element={<Navigate to="/app/inbox" replace />} />
        <Route path="home" element={<HomePage />} />
        <Route path="inbox" element={<InboxPage />} />
        <Route path="customers" element={<CustomersPage />} />
        <Route path="customers/real-time" element={<TrafficPage />} />
        <Route path="customers/campaigns" element={<CampaignsPage />} />
        <Route path="customers/goals" element={<GoalsPage />} />
        <Route path="team" element={<TeamPage />} />
        <Route path="team/ai-agents" element={<TeamAiAgentsPage />} />
        <Route path="team/teams" element={<TeamsPage />} />
        <Route path="reports" element={<ReportsPage />} />
        <Route path="billing" element={<BillingPage />} />
        <Route path="playbook" element={<PlaybookPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="settings/audit-log" element={<AuditLogPage />} />
        <Route path="apps" element={<AppsMarketplacePage />} />
        <Route path="developers" element={<DeveloperPortalPage />} />
      </Route>
      {/* Anything else, including the OAuth callback path, lands in the inbox. */}
      <Route path="*" element={<Navigate to="/app/inbox" replace />} />
    </Routes>
  );
}
