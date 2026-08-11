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
import { OnboardingWizard } from './OnboardingWizard.js';
import { useAuth } from '../../lib/auth-store.js';

function okJson(body: unknown) {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => body,
  } as unknown as Response;
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
    vi.stubGlobal('fetch', vi.fn());
    renderWizard();
    expect(screen.getByRole('heading', { name: /Welcome, Robin/ })).toBeInTheDocument();
  });

  it('skipping finishes setup and flips the local gate', async () => {
    const fetchMock = vi.fn(async () =>
      okJson({ completed: true, completed_at: 'now', demo_seeded: false, demo_seeded_at: null }),
    );
    vi.stubGlobal('fetch', fetchMock);

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
    vi.stubGlobal('fetch', vi.fn());
    renderWizard();
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByRole('heading', { name: 'Connect your first website' })).toBeInTheDocument();
  });
});
