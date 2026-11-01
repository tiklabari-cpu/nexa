/**
 * The webhook delivery log (KN-03 · tm 375): the screen is a consumer of the
 * server's delivery list — it shows the HTTP code and the (already cleaned)
 * error of a failed attempt, offers "Send again" only where the server says
 * `can_redeliver`, puts the new attempt at the top after a resend, sends a test
 * event, and never offers a write to someone who may only read.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as AuthStore from '../../lib/auth-store.js';
import { ApiClientError } from '../../lib/api-client.js';
import { renderWithLocale, resetLocale } from '../../test/i18n.js';
import type { WebhookDelivery } from './WebhookDeliveryLog.js';

const { api } = vi.hoisted(() => ({
  api: { get: vi.fn(), post: vi.fn() },
}));

vi.mock('../../lib/auth-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof AuthStore>();
  return { ...actual, useApiClient: () => api };
});

const { WebhookDeliveryLog } = await import('./WebhookDeliveryLog.js');

const HOOK = {
  id: '11111111-1111-4111-8111-111111111111',
  url: 'https://hooks.example.com/receiver',
  action: 'chat_started',
  enabled: true,
};

function delivery(overrides: Partial<WebhookDelivery> = {}): WebhookDelivery {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    event_id: '33333333-3333-4333-8333-333333333333',
    action: 'chat_started',
    attempt: 8,
    state: 'exhausted',
    ok: false,
    status_code: 503,
    error: 'http_503',
    test: false,
    created_at: '2026-10-01T10:00:00.000Z',
    next_attempt_at: null,
    can_redeliver: true,
    ...overrides,
  };
}

function renderLog(canEdit = true): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  renderWithLocale(
    <QueryClientProvider client={queryClient}>
      <WebhookDeliveryLog
        webhook={HOOK}
        canEdit={canEdit}
        eventLabel={(action) => (action === 'chat_started' ? 'Chat started' : action)}
        onClose={() => {}}
      />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  api.get.mockReset();
  api.post.mockReset();
});
afterEach(() => resetLocale());

describe('WebhookDeliveryLog (KN-03)', () => {
  it('shows a failed delivery with its HTTP code and error summary', async () => {
    api.get.mockResolvedValue({ items: [delivery()], next_cursor: null });
    renderLog();

    const row = await screen.findByTestId('delivery-22222222-2222-4222-8222-222222222222');
    expect(within(row).getByText('503')).toBeInTheDocument();
    expect(within(row).getByText('http_503')).toBeInTheDocument();
    expect(within(row).getByText('Gave up')).toBeInTheDocument();
    expect(within(row).getByText('Chat started')).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith(`/webhooks/${HOOK.id}/deliveries?limit=25`);
  });

  it('filters by state and asks the server for that state', async () => {
    api.get.mockResolvedValue({ items: [], next_cursor: null });
    renderLog();
    await screen.findByText('No deliveries yet');

    await userEvent.selectOptions(screen.getByLabelText('Status'), 'exhausted');
    await waitFor(() =>
      expect(api.get).toHaveBeenCalledWith(
        `/webhooks/${HOOK.id}/deliveries?limit=25&state=exhausted`,
      ),
    );
  });

  it('pages with the server cursor on "Load more"', async () => {
    api.get
      .mockResolvedValueOnce({ items: [delivery()], next_cursor: 'abc' })
      .mockResolvedValueOnce({
        items: [delivery({ id: '44444444-4444-4444-8444-444444444444', attempt: 7 })],
        next_cursor: null,
      });
    renderLog();

    await userEvent.click(await screen.findByRole('button', { name: 'Load more' }));
    await screen.findByTestId('delivery-44444444-4444-4444-8444-444444444444');
    expect(api.get).toHaveBeenLastCalledWith(`/webhooks/${HOOK.id}/deliveries?limit=25&cursor=abc`);
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
  });

  it('"Send again" posts the redeliver, then shows the outcome and refreshes the table', async () => {
    const old = delivery();
    const fresh = delivery({
      id: '55555555-5555-4555-8555-555555555555',
      attempt: 9,
      state: 'delivered',
      ok: true,
      status_code: 200,
      error: null,
      can_redeliver: false,
    });
    api.get.mockResolvedValueOnce({ items: [old], next_cursor: null });
    api.post.mockResolvedValue(fresh);
    renderLog();

    api.get.mockResolvedValue({
      items: [fresh, { ...old, state: 'failed', can_redeliver: false }],
      next_cursor: null,
    });
    await userEvent.click(await screen.findByRole('button', { name: /Send the delivery from/ }));

    expect(api.post).toHaveBeenCalledWith(`/webhooks/${HOOK.id}/deliveries/${old.id}/redeliver`);
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Sent again and delivered (HTTP 200)',
    );
    await screen.findByTestId(`delivery-${fresh.id}`);
    // The superseded row is no longer offered.
    expect(
      screen.queryByRole('button', { name: /Send the delivery from/ }),
    ).not.toBeInTheDocument();
  });

  it('words a refused resend from the server reason, not its English message', async () => {
    api.get.mockResolvedValue({ items: [delivery()], next_cursor: null });
    api.post.mockRejectedValue(
      new ApiClientError({
        type: 'validation',
        status: 400,
        message: 'This delivery can no longer be sent again.',
        requestId: 'r',
        details: { reason: 'not_redeliverable' },
      }),
    );
    renderLog();

    await userEvent.click(await screen.findByRole('button', { name: /Send the delivery from/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This delivery can no longer be sent again. Refresh the log.',
    );
  });

  it('"Send test event" posts the ping and reports a failure the receiver returned', async () => {
    api.get.mockResolvedValue({ items: [], next_cursor: null });
    api.post.mockResolvedValue(
      delivery({ test: true, state: 'failed', attempt: 1, status_code: 410, error: 'http_410' }),
    );
    renderLog();

    await userEvent.click(await screen.findByRole('button', { name: 'Send test event' }));
    expect(api.post).toHaveBeenCalledWith(`/webhooks/${HOOK.id}/test`);
    expect(await screen.findByRole('alert')).toHaveTextContent('Test event failed: HTTP 410.');
  });

  it('offers no write to someone who may only read, and no resend on a row the server refuses', async () => {
    api.get.mockResolvedValue({
      items: [
        delivery(),
        delivery({ id: '66666666-6666-4666-8666-666666666666', can_redeliver: false }),
      ],
      next_cursor: null,
    });
    renderLog(false);

    await screen.findByTestId('delivery-22222222-2222-4222-8222-222222222222');
    expect(screen.queryByRole('button', { name: 'Send test event' })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Send the delivery from/ }),
    ).not.toBeInTheDocument();
  });

  it('marks a test row and a queued retry in the table', async () => {
    api.get.mockResolvedValue({
      items: [
        delivery({
          id: '77777777-7777-4777-8777-777777777777',
          test: true,
          state: 'delivered',
          ok: true,
          status_code: 200,
          error: null,
          can_redeliver: false,
        }),
        delivery({
          id: '88888888-8888-4888-8888-888888888888',
          state: 'pending',
          attempt: 3,
          next_attempt_at: '2026-10-01T10:30:00.000Z',
        }),
      ],
      next_cursor: null,
    });
    renderLog();

    const testRow = await screen.findByTestId('delivery-77777777-7777-4777-8777-777777777777');
    expect(within(testRow).getByText('Test event')).toBeInTheDocument();
    const queued = screen.getByTestId('delivery-88888888-8888-4888-8888-888888888888');
    expect(within(queued).getByText('Retry queued')).toBeInTheDocument();
    expect(within(queued).getByText(/Next try/)).toBeInTheDocument();
  });

  it('shows a read failure as an error with retry, not as an empty log', async () => {
    api.get.mockRejectedValue(new Error('offline'));
    renderLog();
    expect(await screen.findByText('Could not load the delivery log.')).toBeInTheDocument();
    expect(screen.queryByText('No deliveries yet')).not.toBeInTheDocument();
  });
});
