/**
 * Onboarding wizard — the two things unit coverage can pin without a browser:
 * "Skip setup" finishes and leaves the wizard, and it flips the local gate so
 * the shell takes over. The full click-through and the redirect target live in
 * the E2E suite, which has a real router and a real server.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { OnboardingState } from '@nexa/types';
import { OnboardingWizard } from './OnboardingWizard.js';
import { useAuth } from '../../lib/auth-store.js';
import { renderWithLocale, resetLocale } from '../../test/i18n.js';

function okJson(body: unknown) {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => body,
  } as unknown as Response;
}

const NOT_SET_UP_STATE: OnboardingState = {
  completed: false,
  completed_at: null,
  demo_seeded: false,
  demo_seeded_at: null,
  survey_answer: null,
  survey_answered_at: null,
};

/**
 * Every render now fires `GET /onboarding/state` on mount, so a mock that
 * ignores the URL and answers every call the same way (as a bare `vi.fn()`
 * would for a test that only cares about a later mutation) races the wizard's
 * own redirect/resume effects against the test's assertions. This dispatches
 * on the endpoint instead, the way `WebsiteWidgets.test.tsx` does for its
 * brand-aware fetch.
 */
function stubOnboardingFetch(state: OnboardingState = NOT_SET_UP_STATE): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async (url: string) => {
    const u = String(url);
    if (u.includes('/onboarding/complete')) {
      return okJson({ ...state, completed: true, completed_at: 'now' });
    }
    if (u.includes('/onboarding/state')) return okJson(state);
    return okJson({});
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderWizard() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
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

describe('OnboardingWizard', () => {
  it('greets the owner by first name on the welcome step', () => {
    stubOnboardingFetch();
    renderWizard();
    expect(screen.getByRole('heading', { name: /Welcome, Robin/ })).toBeInTheDocument();
  });

  it('skipping finishes setup and flips the local gate', async () => {
    const fetchMock = stubOnboardingFetch();

    renderWizard();
    await userEvent.click(screen.getByRole('button', { name: 'Skip setup' }));

    // The server was told setup is done…
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/onboarding/complete'),
        expect.objectContaining({ method: 'POST' }),
      );
    });
    // …the local gate flipped so the shell stops redirecting here…
    await waitFor(() => {
      expect(useAuth.getState().agent?.onboarding_completed).toBe(true);
    });
    // …and the wizard handed off to the inbox.
    expect(await screen.findByText('Inbox module')).toBeInTheDocument();
  });

  it('advances from welcome to the website step', async () => {
    stubOnboardingFetch();
    renderWizard();
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByRole('heading', { name: 'Connect your first website' })).toBeInTheDocument();
  });

  it('reads GET /onboarding/state on mount and stays on welcome when nothing is set up yet', async () => {
    const fetchMock = stubOnboardingFetch();
    renderWizard();

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/onboarding/state'),
        expect.objectContaining({ method: 'GET' }),
      );
    });
    expect(screen.getByRole('heading', { name: /Welcome, Robin/ })).toBeInTheDocument();
  });

  it('redirects straight to the inbox when the server already reports setup complete', async () => {
    stubOnboardingFetch({
      completed: true,
      completed_at: 'now',
      demo_seeded: true,
      demo_seeded_at: 'now',
      survey_answer: null,
      survey_answered_at: null,
    });

    renderWizard();

    expect(await screen.findByText('Inbox module')).toBeInTheDocument();
    expect(useAuth.getState().agent?.onboarding_completed).toBe(true);
  });

  it('resumes on the sample step, already marked seeded, when the demo was laid down earlier', async () => {
    stubOnboardingFetch({
      completed: false,
      completed_at: null,
      demo_seeded: true,
      demo_seeded_at: 'now',
      survey_answer: null,
      survey_answered_at: null,
    });

    renderWizard();

    expect(await screen.findByRole('heading', { name: 'Add sample data' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sample data added' })).toBeDisabled();
    expect(screen.getByText('Sample data is already in your workspace.')).toBeInTheDocument();
  });
});

describe('OnboardingWizard localisation (NFR-I18N2)', () => {
  afterEach(() => resetLocale());

  it('paints the wizard in Turkish when that is the active locale', () => {
    stubOnboardingFetch();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderWithLocale(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/app/onboarding']}>
          <Routes>
            <Route path="/app/onboarding" element={<OnboardingWizard />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
      'tr',
    );

    expect(
      screen.getByRole('heading', { name: 'Çalışma alanınızı ayarlayın' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Kurulumu atla' })).toBeInTheDocument();
  });
});
