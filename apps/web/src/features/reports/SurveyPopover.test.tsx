/**
 * "What are you tracking?" survey popover (FR-MOD-07.2).
 *
 * `fetch` is stubbed rather than the query cache seeded, so the segment is
 * proven from the real response shape `GET /onboarding/state` sends back — the
 * same query key `TakeTourBanner.tsx`/`OnboardingWizard.tsx` already read.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OnboardingState } from '@nexa/types';
import { SurveyPopover } from './SurveyPopover.js';
import { useAuth } from '../../lib/auth-store.js';
import { useLocaleStore } from '../../lib/i18n.js';

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => body,
  } as unknown as Response;
}

function errorJson(status: number, message: string): Response {
  return {
    ok: false,
    status,
    headers: { get: () => null },
    json: async () => ({
      error: { type: 'internal', message, request_id: 'req_test' },
    }),
  } as unknown as Response;
}

const NOT_ANSWERED: OnboardingState = {
  completed: true,
  completed_at: 'now',
  demo_seeded: true,
  demo_seeded_at: 'now',
  survey_answer: null,
  survey_answered_at: null,
};

/**
 * Dispatches on the endpoint: `GET /onboarding/state` answers with `state`,
 * `POST /onboarding/survey` records the request body and, unless
 * `surveyFails`, answers with the state already flipped to answered — the way
 * the real endpoint's own response would read after a successful call.
 */
function stubFetch(
  state: OnboardingState = NOT_ANSWERED,
  opts: { surveyFails?: boolean } = {},
): { fetchMock: ReturnType<typeof vi.fn>; surveyBodies: Array<Record<string, unknown>> } {
  const surveyBodies: Array<Record<string, unknown>> = [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    if (u.includes('/onboarding/survey')) {
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      surveyBodies.push(body);
      if (opts.surveyFails) return errorJson(500, 'Something went wrong.');
      return jsonResponse({ ...state, survey_answer: body.answer, survey_answered_at: 'now' });
    }
    if (u.includes('/onboarding/state')) return jsonResponse(state);
    return jsonResponse({});
  });
  vi.stubGlobal('fetch', fetchMock);
  return { fetchMock, surveyBodies };
}

function renderPopover(
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } }),
) {
  const view = render(
    <QueryClientProvider client={client}>
      <SurveyPopover />
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
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('SurveyPopover', () => {
  it('shows all five options and Skip on first visit', async () => {
    stubFetch();
    renderPopover();

    expect(
      await screen.findByRole('dialog', { name: 'What are you tracking?' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tracking agent performance' })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Sharing results with my team or manager' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Spotting problems' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Measuring revenue impact' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Other' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Skip' })).toBeInTheDocument();
  });

  it('stays quiet once the survey has already been answered', async () => {
    const { fetchMock } = stubFetch({
      ...NOT_ANSWERED,
      survey_answered_at: '2026-01-01T00:00:00Z',
    });
    const { container } = renderPopover();

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('picking an option submits it and hides the popover', async () => {
    const { surveyBodies } = stubFetch();
    const user = userEvent.setup();
    renderPopover();

    await user.click(await screen.findByRole('button', { name: 'Spotting problems' }));

    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'What are you tracking?' })).toBeNull(),
    );
    expect(surveyBodies).toEqual([{ answer: 'spotting_problems' }]);
  });

  it('Skip submits a null answer and hides the popover', async () => {
    const { surveyBodies } = stubFetch();
    const user = userEvent.setup();
    renderPopover();

    await user.click(await screen.findByRole('button', { name: 'Skip' }));

    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'What are you tracking?' })).toBeNull(),
    );
    expect(surveyBodies).toEqual([{ answer: null }]);
  });

  it('Escape is the same exit as Skip — a null answer, not a silent close', async () => {
    const { surveyBodies } = stubFetch();
    const user = userEvent.setup();
    renderPopover();

    await screen.findByRole('dialog', { name: 'What are you tracking?' });
    await user.keyboard('{Escape}');

    await waitFor(() => expect(surveyBodies).toEqual([{ answer: null }]));
  });

  it('a reload after answering stays quiet — the offer is not shown twice', async () => {
    const { surveyBodies } = stubFetch();
    const user = userEvent.setup();
    const view = renderPopover();

    await user.click(await screen.findByRole('button', { name: 'Other' }));
    await waitFor(() => expect(surveyBodies).toEqual([{ answer: 'other' }]));

    // A fresh mount, now against the already-answered state a real reload
    // would fetch.
    stubFetch({ ...NOT_ANSWERED, survey_answer: 'other', survey_answered_at: 'now' });
    view.unmount();
    const { container } = renderPopover(view.client);
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it('a failed submission keeps the popover open and shows an inline error', async () => {
    stubFetch(NOT_ANSWERED, { surveyFails: true });
    const user = userEvent.setup();
    renderPopover();

    await user.click(await screen.findByRole('button', { name: 'Skip' }));

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'What are you tracking?' })).toBeInTheDocument();
  });

  it('renders in Turkish', async () => {
    useLocaleStore.setState({ locale: 'tr' });
    stubFetch();
    renderPopover();

    expect(
      await screen.findByRole('dialog', { name: 'Neyi takip ediyorsunuz?' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sorunları tespit etmek' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Atla' })).toBeInTheDocument();
  });
});
