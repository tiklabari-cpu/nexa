/**
 * "Take tour" banner (FR-MOD-01.4, 02.2.3).
 *
 * `fetch` is stubbed rather than the query cache seeded, so the segment is
 * proven from the real response shape `GET /onboarding/state` sends back — the
 * same query key `OnboardingWizard.tsx` reads, deliberately reused rather than
 * a second endpoint just for this banner.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TakeTourBanner } from './TakeTourBanner.js';
import { useAuth } from '../../lib/auth-store.js';
import { useLocaleStore } from '../../lib/i18n.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const TAKE_TOUR_TEXT = 'New here? Take a quick tour of the inbox.';

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => body,
  } as unknown as Response;
}

/** Every request answers with this onboarding state. */
function stubOnboardingState(completedAt: string | null) {
  const fetchMock = vi.fn(async () =>
    jsonResponse({
      completed: completedAt !== null,
      completed_at: completedAt,
      demo_seeded: false,
      demo_seeded_at: null,
    }),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderBanner(client = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  const view = render(
    <QueryClientProvider client={client}>
      <TakeTourBanner />
    </QueryClientProvider>,
  );
  return { ...view, client };
}

beforeEach(() => {
  useAuth.setState({
    status: 'signed-in',
    accessToken: 'test-token',
    agent: {
      account_id: 'a-1',
      email: 'dana@acme.localhost',
      name: 'Dana Okonkwo',
      role: 'owner',
      organization_id: 'o-1',
      license_id: '1000003',
      scopes: [],
      routing_status: 'accepting_chats',
    },
  });
  useLocaleStore.setState({ locale: 'en' });
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('TakeTourBanner', () => {
  it('offers the tour within 7 days of onboarding completion', async () => {
    stubOnboardingState(new Date(Date.now() - DAY_MS).toISOString());
    renderBanner();

    expect(await screen.findByText(TAKE_TOUR_TEXT)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Take tour' })).toBeInTheDocument();
  });

  it('stays quiet once the 7-day window has passed', async () => {
    const fetchMock = stubOnboardingState(new Date(Date.now() - 8 * DAY_MS).toISOString());
    const { container } = renderBanner();

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('stays quiet for a workspace that has never completed onboarding', async () => {
    const fetchMock = stubOnboardingState(null);
    const { container } = renderBanner();

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('opening the tour hides the banner and starts the walkthrough', async () => {
    stubOnboardingState(new Date(Date.now() - DAY_MS).toISOString());
    const user = userEvent.setup();
    renderBanner();

    await user.click(await screen.findByRole('button', { name: 'Take tour' }));
    expect(screen.queryByText(TAKE_TOUR_TEXT)).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Your queues' })).toBeInTheDocument();
  });

  it('taking the tour marks the offer used up even if it is skipped early, and a reload keeps it hidden', async () => {
    stubOnboardingState(new Date(Date.now() - DAY_MS).toISOString());
    const user = userEvent.setup();
    const view = renderBanner();

    await user.click(await screen.findByRole('button', { name: 'Take tour' }));
    await user.click(screen.getByRole('button', { name: 'Skip' }));
    expect(screen.queryByText(TAKE_TOUR_TEXT)).toBeNull();

    // A fresh mount — as a reload would be — stays quiet rather than offering
    // the tour a second time.
    view.unmount();
    renderBanner(view.client);
    expect(screen.queryByText(TAKE_TOUR_TEXT)).toBeNull();
  });

  it('the banner’s own manual dismiss also persists across a remount', async () => {
    stubOnboardingState(new Date(Date.now() - DAY_MS).toISOString());
    const user = userEvent.setup();
    const view = renderBanner();

    await screen.findByRole('button', { name: 'Take tour' });
    await user.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText(TAKE_TOUR_TEXT)).toBeNull();

    view.unmount();
    renderBanner(view.client);
    expect(screen.queryByText(TAKE_TOUR_TEXT)).toBeNull();
  });
});
