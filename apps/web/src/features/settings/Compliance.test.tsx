/**
 * Settings → Security: data region + HIPAA/BAA status (C4-f).
 *
 * Everything this screen appears to enforce — the region being fixed, who
 * may accept the BAA, whether one is even available — is the server's
 * (`GET|POST /settings/compliance*`, C4-d); these tests pin the screen: it
 * shows the region read-only, hides entirely for a role below `admin`
 * (mirroring the endpoint's `minimumRole: 'admin'`), shows the accept button
 * only to an `owner` (mirroring `exactRole: 'owner'`) and never in `eu`, and
 * shows the signed date once accepted.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import type * as AuthStore from '../../lib/auth-store.js';
import { ApiClientError } from '../../lib/api-client.js';
import { renderWithLocale, resetLocale } from '../../test/i18n.js';

const { api } = vi.hoisted(() => ({
  api: { get: vi.fn(), post: vi.fn() },
}));

let currentRole = 'owner';

vi.mock('../../lib/auth-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof AuthStore>();
  return {
    ...actual,
    useApiClient: () => api,
    useAuth: (selector: (state: { agent: { role: string } }) => unknown) =>
      selector({ agent: { role: currentRole } }),
  };
});

const { Compliance } = await import('./Compliance.js');

const EU_UNSIGNED = { region: 'eu', baa_available: false, hipaa_baa_signed_at: null };
const US_UNSIGNED = { region: 'us', baa_available: true, hipaa_baa_signed_at: null };
const US_SIGNED = {
  region: 'us',
  baa_available: true,
  hipaa_baa_signed_at: '2026-08-15T12:00:00.000Z',
};

function renderComponent(ui: ReactElement): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  currentRole = 'owner';
  api.get.mockReset();
  api.post.mockReset();
});

describe('Compliance', () => {
  it('shows the region read-only, with a note that it cannot change', async () => {
    api.get.mockResolvedValue(EU_UNSIGNED);
    renderComponent(<Compliance canEdit />);

    expect(await screen.findByText('European Union')).toBeInTheDocument();
    expect(screen.getByText(/can never be changed/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Accept the BAA' })).not.toBeInTheDocument();
  });

  it('shows no BAA button at all in eu, even for the owner', async () => {
    api.get.mockResolvedValue(EU_UNSIGNED);
    renderComponent(<Compliance canEdit />);

    await screen.findByText('European Union');
    expect(
      screen.getByText('HIPAA cover is only available to workspaces hosted in the United States.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Accept the BAA' })).not.toBeInTheDocument();
  });

  it('lets the owner accept the BAA in us, and shows the accepted date on success', async () => {
    api.get.mockResolvedValue(US_UNSIGNED);
    api.post.mockResolvedValue(US_SIGNED);
    renderComponent(<Compliance canEdit />);

    await screen.findByText('United States');
    const accept = screen.getByRole('button', { name: 'Accept the BAA' });
    await userEvent.click(accept);

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/settings/compliance/baa', { accepted: true }),
    );
    expect(await screen.findByText(/Accepted/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Accept the BAA' })).not.toBeInTheDocument();
  });

  it('shows a restricted note instead of the button for an admin in us', async () => {
    currentRole = 'admin';
    api.get.mockResolvedValue(US_UNSIGNED);
    renderComponent(<Compliance canEdit />);

    await screen.findByText('United States');
    expect(screen.getByText('Only the workspace owner can accept the BAA.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Accept the BAA' })).not.toBeInTheDocument();
  });

  it('renders nothing for a plain agent, who cannot read this either', () => {
    currentRole = 'agent';
    renderComponent(<Compliance canEdit={false} />);

    expect(screen.queryByText('Data region and compliance')).not.toBeInTheDocument();
    expect(api.get).not.toHaveBeenCalled();
  });

  it('shows the signed date already accepted, with no button', async () => {
    api.get.mockResolvedValue(US_SIGNED);
    renderComponent(<Compliance canEdit />);

    expect(await screen.findByText(/Accepted/)).toBeInTheDocument();
    expect(screen.getByText('Signed')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Accept the BAA' })).not.toBeInTheDocument();
  });

  it('answers a refusal through the ADR-06 catalogue, not the server’s own wording', async () => {
    currentRole = 'owner';
    api.get.mockResolvedValue(US_UNSIGNED);
    api.post.mockRejectedValue(
      new ApiClientError({ type: 'not_allowed', status: 403, message: 'Nope.', requestId: '-' }),
    );
    renderComponent(<Compliance canEdit />);

    await screen.findByText('United States');
    await userEvent.click(screen.getByRole('button', { name: 'Accept the BAA' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('That is not allowed here.');
  });

  it('shows the Enterprise upsell message on a 403 naming the hipaa entitlement', async () => {
    currentRole = 'owner';
    api.get.mockResolvedValue(US_UNSIGNED);
    api.post.mockRejectedValue(
      new ApiClientError({
        type: 'not_allowed',
        status: 403,
        message: 'HIPAA cover is not included in the growth plan.',
        requestId: '-',
        details: { entitlement: 'hipaa', plan: 'growth' },
      }),
    );
    renderComponent(<Compliance canEdit />);

    await screen.findByText('United States');
    await userEvent.click(screen.getByRole('button', { name: 'Accept the BAA' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/Enterprise feature/);
  });
});

/** One sentinel for this file's DoD claim of being translated (I18N-j, tm 133.10). */
describe('Compliance localisation (NFR-I18N2)', () => {
  afterEach(() => {
    resetLocale();
  });

  it('paints Compliance in Turkish when that is the active locale', async () => {
    currentRole = 'owner';
    api.get.mockResolvedValue(US_UNSIGNED);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderWithLocale(
      <QueryClientProvider client={queryClient}>
        <Compliance canEdit />
      </QueryClientProvider>,
      'tr',
    );

    expect(
      await screen.findByRole('region', { name: 'Veri bölgesi ve uyumluluk' }),
    ).toBeInTheDocument();
  });
});
