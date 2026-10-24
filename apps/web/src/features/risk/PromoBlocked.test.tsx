/**
 * "Promotions blocked" (EN-01 · tm 350): the badge follows the server's
 * `promo_suppressed` — not the flags this panel happens to see — in the
 * inbox's Risk section and on the customer profile, and the profile's Risk
 * card clears a flag through the same reasoned dialog as the inbox.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flag } from '../../test/risk-flags.js';
import { renderWithLocale, resetLocale } from '../../test/i18n.js';
import { CustomerRiskCard } from './PromoBlocked.js';
import { RiskSection } from './RiskSection.js';
import type { CustomerRiskFlagPage } from './riskFlags.js';

const { api, authState } = vi.hoisted(() => ({
  api: { get: vi.fn(), post: vi.fn(), request: vi.fn() },
  authState: { agent: null as { account_id: string; role: string } | null },
}));

vi.mock('../../lib/auth-store.js', () => ({
  useApiClient: () => api,
  useAuth: Object.assign((selector: (state: typeof authState) => unknown) => selector(authState), {
    getState: () => authState,
  }),
}));

const CUSTOMER = 'cust-1';
let player: CustomerRiskFlagPage;

function mount(ui: ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  player = { items: [], promo_suppressed: false, promo_suppressed_reason: null };
  api.get.mockReset();
  api.request.mockReset();
  api.get.mockImplementation(async (path: string) => {
    if (path.startsWith('/customers/')) return player;
    return { items: [] };
  });
  api.request.mockResolvedValue(flag({ status: 'cleared' }));
  authState.agent = { account_id: 'agent-1', role: 'admin' };
});

afterEach(() => resetLocale());

describe('CustomerRiskCard — the profile (EN-01)', () => {
  it('shows the badge and the player’s active flags', async () => {
    player = {
      items: [flag({ id: 'f-1', type: 'self_exclusion_request', customer_id: CUSTOMER })],
      promo_suppressed: true,
      promo_suppressed_reason: 'self_exclusion_request',
    };
    mount(<CustomerRiskCard customerId={CUSTOMER} />);
    expect(await screen.findByTestId('promo-blocked')).toHaveTextContent('Promotions blocked');
    expect(screen.getByRole('heading', { name: 'Risk flags' })).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith(`/customers/${CUSTOMER}/risk-flags?status=active`);
  });

  it('trusts the server: blocked by a linked record’s flag it cannot list', async () => {
    player = { items: [], promo_suppressed: true, promo_suppressed_reason: 'rg_signal' };
    mount(<CustomerRiskCard customerId={CUSTOMER} />);
    expect(await screen.findByTestId('promo-blocked')).toBeInTheDocument();
  });

  it('draws nothing for a player with no flag and no block, or when the list cannot be read', async () => {
    const { container } = mount(<CustomerRiskCard customerId={CUSTOMER} />);
    await waitFor(() => expect(api.get).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();

    api.get.mockRejectedValue(new Error('403'));
    const second = mount(<CustomerRiskCard customerId="cust-2" />);
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2));
    expect(second.container).toBeEmptyDOMElement();
  });

  it('clears a flag with the reason the dialog requires', async () => {
    player = {
      items: [flag({ id: 'f-9', type: 'fraud_suspected', customer_id: CUSTOMER })],
      promo_suppressed: true,
      promo_suppressed_reason: 'fraud_suspected',
    };
    mount(<CustomerRiskCard customerId={CUSTOMER} />);
    fireEvent.click(await screen.findByRole('button', { name: /Clear.*Suspected fraud/ }));
    const dialog = await screen.findByRole('dialog');
    const confirm = within(dialog).getByRole('button', { name: /Clear/ });
    expect(confirm).toBeDisabled();
    fireEvent.change(within(dialog).getByRole('textbox'), {
      target: { value: 'Operatör doğruladı.' },
    });
    fireEvent.click(confirm);
    await waitFor(() =>
      expect(api.request).toHaveBeenCalledWith('DELETE', '/risk-flags/f-9', {
        reason: 'Operatör doğruladı.',
      }),
    );
  });

  it('says who may clear instead of a button below the clearer', async () => {
    authState.agent = { account_id: 'agent-1', role: 'agent' };
    player = {
      items: [flag({ id: 'f-2', type: 'rg_signal', customer_id: CUSTOMER })],
      promo_suppressed: true,
      promo_suppressed_reason: 'rg_signal',
    };
    mount(<CustomerRiskCard customerId={CUSTOMER} />);
    await screen.findByTestId('promo-blocked');
    expect(screen.queryByRole('button', { name: /Clear/ })).not.toBeInTheDocument();
  });

  it('is Turkish in a Turkish console', async () => {
    player = { items: [], promo_suppressed: true, promo_suppressed_reason: 'rg_signal' };
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderWithLocale(
      <QueryClientProvider client={queryClient}>
        <CustomerRiskCard customerId={CUSTOMER} />
      </QueryClientProvider>,
      'tr',
    );
    expect(await screen.findByTestId('promo-blocked')).toHaveTextContent('Promosyon engelli');
  });
});

describe('RiskSection — the inbox (EN-01)', () => {
  it('shows the badge while the player is kept from campaigns, and not otherwise', async () => {
    player = { items: [], promo_suppressed: true, promo_suppressed_reason: 'rg_signal' };
    const first = mount(<RiskSection chatId="CHAT1" customerId={CUSTOMER} canFlag={false} />);
    expect(await screen.findByTestId('promo-blocked')).toBeInTheDocument();
    first.unmount();

    player = { items: [], promo_suppressed: false, promo_suppressed_reason: null };
    mount(<RiskSection chatId="CHAT2" customerId="cust-3" canFlag={false} />);
    expect(await screen.findByText(/No active risk flags/)).toBeInTheDocument();
    expect(screen.queryByTestId('promo-blocked')).not.toBeInTheDocument();
  });
});
