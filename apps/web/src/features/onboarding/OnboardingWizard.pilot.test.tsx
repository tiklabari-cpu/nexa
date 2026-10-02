/**
 * The first-run wizard in the public pilot (tm 257.3 · ADR
 * docs/adr/pilot-public-readiness.md K-d): no channel step — it previews
 * Messenger, WhatsApp, SMS and the rest, which the pilot does not offer — so
 * four steps, "Step N of 4", and no Welcome bullet promising it. Paired with
 * the ordinary five-step wizard `OnboardingWizard.test.tsx` pins, unchanged.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { DeploymentConfig, OnboardingState } from '@siyahtus/types';
import { useAuth } from '../../lib/auth-store.js';

const deployment = vi.hoisted(() => ({ current: null as unknown as DeploymentConfig }));
vi.mock('../../lib/deployment.js', () => ({ useDeployment: () => deployment.current }));

const { OnboardingWizard } = await import('./OnboardingWizard.js');

const PILOT: DeploymentConfig = {
  pilot_mode: true,
  contact_email: null,
  signup_enabled: true,
  email_verification_required: false,
  privacy_policy_url: null,
  terms_url: null,
  terms_version: null,
};
const ORDINARY: DeploymentConfig = {
  pilot_mode: false,
  contact_email: null,
  signup_enabled: true,
  email_verification_required: false,
  privacy_policy_url: null,
  terms_url: null,
  terms_version: null,
};

const STATE: OnboardingState = {
  completed: false,
  completed_at: null,
  demo_seeded: false,
  demo_seeded_at: null,
  survey_answer: null,
  survey_answered_at: null,
};

function stubFetch(state: OnboardingState = STATE): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const body = String(url).includes('/onboarding/state') ? state : {};
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => body,
      } as unknown as Response;
    }),
  );
}

function renderWizard(config: DeploymentConfig): void {
  deployment.current = config;
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/app/onboarding']}>
        <Routes>
          <Route path="/app/onboarding" element={<OnboardingWizard />} />
          <Route path="/app/inbox" element={<p>Inbox module</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const stepper = (): HTMLElement => screen.getByRole('list', { name: /progress/i });

beforeEach(() => {
  useAuth.setState({
    status: 'signed-in',
    accessToken: 'test-token',
    agent: {
      account_id: 'a-1',
      email: 'robin@example.test',
      name: 'Robin Owner',
      role: 'owner',
      organization_id: 'org-1',
      license_id: '1000001',
      scopes: [],
      routing_status: 'accepting_chats',
      onboarding_completed: false,
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('OnboardingWizard in the public pilot (tm 257.3)', () => {
  it('has four steps, starting at "Step 1 of 4", with no Channels in the stepper', () => {
    stubFetch();
    renderWizard(PILOT);

    expect(screen.getByText('Step 1 of 4')).toBeInTheDocument();
    const labels = within(stepper())
      .getAllByRole('listitem')
      .map((li) => li.textContent);
    expect(labels).toEqual(['Welcome', 'Website', 'Company', 'Team']);
  });

  it('drops the Welcome bullet about other ways customers can reach you, and keeps the rest', () => {
    stubFetch();
    renderWizard(PILOT);

    expect(
      screen.queryByText(/See the other ways customers can reach you/),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/Connect your first website/)).toBeInTheDocument();
  });

  it('goes from the website step straight to the company step', async () => {
    stubFetch();
    renderWizard(PILOT);

    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByText('Step 2 of 4')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByText('Step 3 of 4')).toBeInTheDocument();
    // The channel preview would have been here; the company step is.
    expect(screen.queryByText(/WhatsApp/)).not.toBeInTheDocument();
  });

  it('resumes on the last step, "Step 4 of 4", when the demo was laid down earlier', async () => {
    stubFetch({ ...STATE, demo_seeded: true, demo_seeded_at: 'now' });
    renderWizard(PILOT);

    expect(await screen.findByRole('heading', { name: 'Invite your team' })).toBeInTheDocument();
    expect(screen.getByText('Step 4 of 4')).toBeInTheDocument();
  });

  it('is the five-step wizard on an ordinary deployment', () => {
    stubFetch();
    renderWizard(ORDINARY);

    expect(screen.getByText('Step 1 of 5')).toBeInTheDocument();
    expect(within(stepper()).getByText('Channels')).toBeInTheDocument();
    expect(screen.getByText(/See the other ways customers can reach you/)).toBeInTheDocument();
  });
});
