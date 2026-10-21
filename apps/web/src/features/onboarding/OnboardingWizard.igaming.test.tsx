/**
 * The gaming/gambling "Önerilen kurulum" (tm 311.4 · AI-15): choosing that
 * sector on the company step offers the iGaming templates, and ticking the box
 * sends the owner to them once setup is done. The wizard gates every route, so
 * the offer is a destination after Finish, never a mid-wizard link.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import type { OnboardingState } from '@siyahtus/types';
import { OnboardingWizard } from './OnboardingWizard.js';
import { useAuth } from '../../lib/auth-store.js';
import { resetLocale } from '../../test/i18n.js';

function okJson(body: unknown) {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => body,
  } as unknown as Response;
}

const STATE: OnboardingState = {
  completed: false,
  completed_at: null,
  demo_seeded: false,
  demo_seeded_at: null,
  survey_answer: null,
  survey_answered_at: null,
};

function stubFetch(): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async (url: string) => {
    const u = String(url);
    if (u.includes('/onboarding/complete')) return okJson({ ...STATE, completed: true });
    if (u.includes('/onboarding/state')) return okJson(STATE);
    return okJson({});
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/** Shows where Finish landed, including the query string. */
function Landing(): ReactElement {
  const location = useLocation();
  return <p>{`landed ${location.pathname}${location.search}`}</p>;
}

function renderWizard() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/app/onboarding']}>
        <Routes>
          <Route path="/app/onboarding" element={<OnboardingWizard />} />
          <Route path="*" element={<Landing />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function toCompanyStep(): Promise<void> {
  // welcome → website → channels → company
  for (let i = 0; i < 3; i += 1) {
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
  }
}

beforeEach(() => {
  resetLocale();
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
  resetLocale();
});

describe('OnboardingWizard — recommended setup for gaming and gambling (AI-15)', () => {
  it('offers the iGaming templates only once that sector is chosen', async () => {
    stubFetch();
    renderWizard();
    await toCompanyStep();

    expect(screen.queryByRole('region', { name: 'Recommended setup' })).not.toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText('Sector (optional)'), 'ecommerce_retail');
    expect(screen.queryByRole('region', { name: 'Recommended setup' })).not.toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText('Sector (optional)'), 'gaming_gambling');
    expect(screen.getByRole('region', { name: 'Recommended setup' })).toBeInTheDocument();
  });

  it('sends the sector with the size, and only when one is chosen', async () => {
    const fetchMock = stubFetch();
    renderWizard();
    await toCompanyStep();

    await userEvent.selectOptions(screen.getByLabelText('Company size'), '11_50');
    await userEvent.selectOptions(screen.getByLabelText('Sector (optional)'), 'gaming_gambling');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/settings/company'),
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ company_size: '11_50', sector: 'gaming_gambling' }),
        }),
      );
    });
    expect(await screen.findByText('Saved.')).toBeInTheDocument();
  });

  it('lands on the iGaming templates after Finish when the box is ticked', async () => {
    stubFetch();
    renderWizard();
    await toCompanyStep();

    await userEvent.selectOptions(screen.getByLabelText('Sector (optional)'), 'gaming_gambling');
    await userEvent.click(
      screen.getByRole('checkbox', { name: 'Open the iGaming templates when setup is done' }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Continue' })); // company → team
    await userEvent.click(screen.getByRole('button', { name: 'Finish setup' }));

    expect(await screen.findByText('landed /app/playbook?gallery=igaming')).toBeInTheDocument();
  });

  it('lands on the inbox as before when the box is left alone', async () => {
    stubFetch();
    renderWizard();
    await toCompanyStep();

    await userEvent.selectOptions(screen.getByLabelText('Sector (optional)'), 'gaming_gambling');
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await userEvent.click(screen.getByRole('button', { name: 'Finish setup' }));

    expect(await screen.findByText('landed /app/inbox')).toBeInTheDocument();
  });
});
