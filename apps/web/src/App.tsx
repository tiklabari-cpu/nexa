import { useEffect, useRef, type ReactElement } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AppShell } from './components/AppShell.js';
import { ImpersonationBanner } from './components/ImpersonationBanner.js';
import { LoadingPage } from './components/LoadingPage.js';
import { NotFoundPage } from './components/NotFoundPage.js';
import { PilotHidden } from './components/PilotHidden.js';
import { IMPERSONATION_CONSOLE_PATH } from '@siyahtus/types';
import { AuthCallbackPage } from './features/auth/AuthCallbackPage.js';
import { ImpersonatePage, ImpersonationEndedPage } from './features/auth/ImpersonatePage.js';
import { ReconnectingPage } from './features/auth/ReconnectingPage.js';
import { SignInPage } from './features/auth/SignInPage.js';
import {
  ForgotPasswordPage,
  JoinPage,
  ResetPasswordPage,
  SignUpPage,
  VerifyEmailPage,
} from './features/auth/PublicPages.js';
import { BillingPage } from './features/billing/BillingPage.js';
import { CustomersPage } from './features/customers/CustomersPage.js';
import { TrafficPage } from './features/traffic/TrafficPage.js';
import { CampaignsPage } from './features/campaigns/CampaignsPage.js';
import { GoalsPage } from './features/goals/GoalsPage.js';
import { PlaybookPage } from './features/playbook/PlaybookPage.js';
import { SettingsIndex, SettingsLayout, SettingsPage } from './features/settings/SettingsPage.js';
import { AuditLogPage } from './features/audit/AuditLogPage.js';
import { AppsMarketplacePage } from './features/apps/AppsMarketplace.js';
import { DeveloperPortalPage } from './features/developers/DeveloperPortal.js';
import { ArchivePage } from './features/archive/ArchivePage.js';
import { InboxPage } from './features/inbox/InboxPage.js';
import { HomePage } from './features/home/HomePage.js';
import { ReportsPage } from './features/reports/ReportsPage.js';
import { AiQualityPage } from './features/reports/qa/AiQualityPage.js';
import { QaReviewPage } from './features/reports/qa/QaReview.js';
import { SHARED_REPORT_PATH } from './features/reports/ShareControl.js';
import { SharedReportPage } from './features/reports/SharedReportPage.js';
import { TeamPage } from './features/team/TeamPage.js';
import { TeamAiAgentsPage } from './features/team/TeamAiAgentsPage.js';
import { TeamsPage } from './features/team/TeamsPage.js';
import { OnboardingWizard } from './features/onboarding/OnboardingWizard.js';
import { useAuth } from './lib/auth-store.js';

export function App(): ReactElement {
  const status = useAuth((s) => s.status);
  const restore = useAuth((s) => s.restore);
  const agent = useAuth((s) => s.agent);
  const impersonationEnded = useAuth((s) => s.impersonationEnded);
  /**
   * A shared report (FR-MOD-07.3.1) is read by somebody with no account, so it
   * has to sit outside every branch below — including the "restoring a session"
   * one, which would otherwise show a recipient a loading screen while the app
   * tries to refresh a token they do not have. The token itself is in the URL
   * fragment and is never touched here; the page reads it.
   */
  const { pathname } = useLocation();
  const sharedReport = pathname === SHARED_REPORT_PATH;
  /**
   * "Enter as the customer" (tm 389.15) lands here with a one-time code. Like
   * the shared report it sits outside the branches below, and nothing is
   * restored first: this tab is about to become the member's, and the
   * browser's own stored session belongs to its other tabs.
   */
  const impersonating = pathname === IMPERSONATION_CONSOLE_PATH;
  const reconnecting = status === 'reconnecting';
  const shell = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Not merely unnecessary on the shared page — a restore attempt would put a
    // refresh request in a log line belonging to a caller who is not a user.
    if (status === 'unknown' && !sharedReport && !impersonating) void restore();
  }, [status, restore, sharedReport, impersonating]);

  // Out of reach while the session reconnects (tm 259.2): nothing typed or
  // clicked under the overlay could be sent. An attribute rather than a prop —
  // React 18 does not know `inert`.
  useEffect(() => {
    shell.current?.toggleAttribute('inert', reconnecting);
  }, [reconnecting]);

  if (sharedReport) return <SharedReportPage />;
  if (impersonating && status !== 'signed-in') return <ImpersonatePage />;

  if (status === 'unknown') return <LoadingPage />;

  // A page load that cannot reach the server (tm 259.2): still signed in — the
  // token is kept — but with no profile yet there is no shell to show.
  if (reconnecting && agent === null) return <ReconnectingPage />;

  // Signing out mid-session must not leave a module route rendering against a
  // dead token, so the whole tree collapses to the signed-out routes rather
  // than redirecting.
  //
  // Those routes are a real router rather than a single page because five of
  // them arrive carrying something in the URL that a sign-in form would throw
  // away: `/join`, `/reset-password` and `/verify-email` a token from an email, and
  // `/auth/callback` the authorization code a federated sign-in just earned
  // (NFR-S11 · S11-i).
  // An impersonation tab whose session is over has nothing to sign in to.
  if (status !== 'signed-in' && !reconnecting && impersonationEnded) {
    return <ImpersonationEndedPage reason={impersonationEnded} />;
  }

  if (status !== 'signed-in' && !reconnecting) {
    return (
      <Routes>
        <Route path="/signup" element={<SignUpPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/join" element={<JoinPage />} />
        <Route path="/verify-email" element={<VerifyEmailPage />} />
        <Route path="/auth/callback" element={<AuthCallbackPage />} />
        <Route path="*" element={<SignInPage />} />
      </Routes>
    );
  }

  // A session that runs out mid-outage keeps the shell mounted under the
  // reconnecting screen (tm 259.2): a half-typed reply lives in component state,
  // and unmounting for a two-minute outage would throw it away. The wrapper is
  // there in both states, so toggling it does not remount what is inside.
  return (
    <>
      <div ref={shell} className="contents">
        <SignedInRoutes onboarding={agent?.onboarding_completed === false} />
      </div>
      {reconnecting && <ReconnectingPage overShell />}
    </>
  );
}

function SignedInRoutes({ onboarding }: { onboarding: boolean }): ReactElement {
  // A workspace created through signup opens empty, so a brand-new owner is sent
  // through the first-run wizard before the shell. The flag is explicitly `false`
  // only for such a workspace; older sessions without the field are treated as
  // already set up, so this never traps an existing user. While it holds, every
  // path leads to the wizard — deep-linking to a module cannot slip past setup.
  if (onboarding) {
    return (
      <>
        {/* The wizard is outside the shell, and a support session (tm 389.15) is never unmarked. */}
        <ImpersonationBanner />
        <Routes>
          <Route path="/app/onboarding" element={<OnboardingWizard />} />
          <Route path="*" element={<Navigate to="/app/onboarding" replace />} />
        </Routes>
      </>
    );
  }

  return (
    <Routes>
      <Route path="/app" element={<AppShell />}>
        <Route index element={<Navigate to="/app/inbox" replace />} />
        <Route path="home" element={<HomePage />} />
        <Route path="inbox" element={<InboxPage />} />
        <Route path="archive" element={<ArchivePage />} />
        <Route path="customers" element={<CustomersPage />} />
        <Route path="customers/real-time" element={<TrafficPage />} />
        <Route path="customers/campaigns" element={<CampaignsPage />} />
        <Route path="customers/goals" element={<GoalsPage />} />
        <Route path="team" element={<TeamPage />} />
        <Route path="team/ai-agents" element={<TeamAiAgentsPage />} />
        <Route path="team/teams" element={<TeamsPage />} />
        <Route path="reports" element={<ReportsPage />} />
        {/* Raporlar › AI Kalite (AI-24 · tm 319.3): the QA queue, one review. */}
        <Route path="reports/ai-quality" element={<AiQualityPage />} />
        <Route path="reports/ai-quality/:reviewId" element={<QaReviewPage />} />
        {/* The pilot sells nothing (tm 257.2): its Billing address leads to the inbox. */}
        <Route
          path="billing"
          element={
            <PilotHidden>
              <BillingPage />
            </PilotHidden>
          }
        />
        <Route path="playbook" element={<PlaybookPage />} />
        {/* FR-MOD-08.1: one address per section, behind the grouped side
            navigation. The audit log keeps the address it always had. Flat
            rather than nested so every route under the shell stays
            self-closing — the a11y suite's route pin reads them that way. */}
        <Route
          path="settings"
          element={
            <SettingsLayout>
              <SettingsIndex />
            </SettingsLayout>
          }
        />
        <Route
          path="settings/audit-log"
          element={
            <SettingsLayout>
              <AuditLogPage />
            </SettingsLayout>
          }
        />
        <Route
          path="settings/:section"
          element={
            <SettingsLayout>
              <SettingsPage />
            </SettingsLayout>
          }
        />
        {/* The marketplace is mock OAuth and unused API keys (tm 257.18): the pilot's
            Apps address leads to the inbox — unless the deployment runs live
            cards, which are then the whole marketplace (tm 263). */}
        <Route
          path="apps"
          element={
            <PilotHidden unlessLiveApps>
              <AppsMarketplacePage />
            </PilotHidden>
          }
        />
        <Route path="developers" element={<DeveloperPortalPage />} />
        {/* An address under /app that is not a page says so (UX audit D11). */}
        <Route path="*" element={<NotFoundPage />} />
      </Route>
      {/* The wizard's address once setup is done. Finishing the wizard flips the
          gate while the address is still this one, so without this the shell's
          "Page not found" showed for a moment before the inbox (tm 259.26). */}
      <Route path="/app/onboarding" element={<Navigate to="/app/inbox" replace />} />
      {/* Anything outside /app, including the OAuth callback path, lands in the inbox. */}
      <Route path="*" element={<Navigate to="/app/inbox" replace />} />
    </Routes>
  );
}
