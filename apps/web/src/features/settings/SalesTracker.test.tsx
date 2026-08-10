/**
 * Sales tracker settings (FR-MOD-13.5, KK "İzleme yapılandırması"): the server's
 * values land in the form, a valid change saves through PUT, an out-of-range
 * attribution window is rejected before it ever reaches the network, and a
 * read-only agent cannot touch it at all.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SalesTracker } from './SalesTracker.js';
import { useAuth } from '../../lib/auth-store.js';

const DEFAULTS = {
  enabled: false,
  currency: 'USD',
  attribution_window_days: 7,
  updated_at: null,
};

function okJson(body: unknown): Response {
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
      error: { type: 'validation', message, request_id: 'req_test' },
    }),
  } as unknown as Response;
}

let putBodies: Array<Record<string, unknown>>;
let nextPutFails: boolean;

function stubFetch(current: typeof DEFAULTS): void {
  putBodies = [];
  nextPutFails = false;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      if (String(url).endsWith('/settings/sales-tracker')) {
        if (method === 'PUT') {
          if (nextPutFails) return errorJson(400, 'Could not save that configuration.');
          const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
          putBodies.push(body);
          return okJson({ ...current, ...body, updated_at: new Date().toISOString() });
        }
        return okJson(current);
      }
      return okJson(current);
    }),
  );
}

function renderTracker(canEdit = true) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <SalesTracker canEdit={canEdit} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  useAuth.setState({ status: 'signed-in', accessToken: 'test-token', agent: null });
  stubFetch(DEFAULTS);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('SalesTracker', () => {
  it("loads the server's configuration into the form", async () => {
    stubFetch({ ...DEFAULTS, enabled: true, currency: 'EUR', attribution_window_days: 14 });
    renderTracker();

    expect(await screen.findByRole('checkbox', { name: /Track sales/ })).toBeChecked();
    expect(screen.getByLabelText('Currency')).toHaveValue('EUR');
    expect(screen.getByLabelText('Attribution window (days)')).toHaveValue(14);
  });

  it('keeps Save disabled until something is changed', async () => {
    renderTracker();
    const save = await screen.findByRole('button', { name: 'Save' });
    expect(save).toBeDisabled();
  });

  it('saves a valid change through PUT /settings/sales-tracker with the whole configuration', async () => {
    renderTracker();
    const toggle = await screen.findByRole('checkbox', { name: /Track sales/ });
    await userEvent.click(toggle);

    const currency = screen.getByLabelText('Currency');
    await userEvent.selectOptions(currency, 'GBP');

    const windowInput = screen.getByLabelText('Attribution window (days)');
    await userEvent.clear(windowInput);
    await userEvent.type(windowInput, '30');

    const save = screen.getByRole('button', { name: 'Save' });
    expect(save).toBeEnabled();
    await userEvent.click(save);

    await waitFor(() => expect(putBodies).toHaveLength(1));
    expect(putBodies[0]).toEqual({
      enabled: true,
      currency: 'GBP',
      attribution_window_days: 30,
    });
    expect(await screen.findByText(/Reports → Reviews → Ecommerce/)).toBeInTheDocument();
  });

  it('rejects a zero attribution window with a field-under error and blocks saving', async () => {
    renderTracker();
    const windowInput = await screen.findByLabelText('Attribution window (days)');
    await userEvent.clear(windowInput);
    await userEvent.type(windowInput, '0');
    await userEvent.tab();

    expect(screen.getByRole('alert')).toHaveTextContent(/whole number of days/);
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(putBodies).toHaveLength(0);
  });

  it('shows the PUT error and keeps the entered values', async () => {
    renderTracker();
    const windowInput = await screen.findByLabelText('Attribution window (days)');
    await userEvent.clear(windowInput);
    await userEvent.type(windowInput, '21');

    nextPutFails = true;
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not save that configuration.');
    expect(screen.getByLabelText('Attribution window (days)')).toHaveValue(21);
  });

  it('is read-only when canEdit is false: inputs disabled, no Save button, PUT never called', async () => {
    renderTracker(false);

    expect(await screen.findByRole('checkbox', { name: /Track sales/ })).toBeDisabled();
    expect(screen.getByLabelText('Currency')).toBeDisabled();
    expect(screen.getByLabelText('Attribution window (days)')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
    expect(putBodies).toHaveLength(0);
  });
});
