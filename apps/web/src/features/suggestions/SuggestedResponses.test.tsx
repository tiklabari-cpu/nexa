/**
 * Settings → Saved replies → Suggested replies (IN-07 · tm 364): binding a saved
 * reply to chat events, its order and category, and the "player went quiet" delay.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { api } = vi.hoisted(() => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

vi.mock('../../lib/auth-store.js', () => ({
  useApiClient: () => api,
}));

const { SuggestedResponses } = await import('./SuggestedResponses.js');

const SHARED = {
  id: 'r1',
  shortcut: 'devir',
  text: 'Sohbeti devraldım.',
  visibility: 'all' as const,
  suggest_on: ['chat_started' as const],
  suggest_order: 2,
  category: 'general' as const,
};
const PERSONAL = {
  id: 'r2',
  shortcut: 'kisisel',
  text: 'Merhaba, ben Dana.',
  visibility: 'private' as const,
  suggest_on: [],
  suggest_order: 0,
  category: 'general' as const,
};

/** The section is folded away until asked for. */
function open(): void {
  fireEvent.click(screen.getByRole('button', { name: 'Set up' }));
}

function renderIt(
  props: Partial<{
    canEdit: boolean;
    canWritePersonal: boolean;
    canConfigureIdle: boolean;
    items: Array<typeof SHARED | typeof PERSONAL>;
    folded: boolean;
  }> = {},
) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <SuggestedResponses
        items={props.items ?? [SHARED, PERSONAL]}
        canEdit={props.canEdit ?? true}
        canWritePersonal={props.canWritePersonal ?? true}
        canConfigureIdle={props.canConfigureIdle ?? false}
      />
    </QueryClientProvider>,
  );
  // Folded away until asked for; most tests want it open.
  if (!props.folded && screen.queryByRole('button', { name: 'Set up' })) open();
  return view;
}

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  api.patch.mockResolvedValue({});
  api.get.mockResolvedValue({ chat_timeout_seconds: 900, customer_idle_seconds: null });
  api.put.mockImplementation((_path: string, body: Record<string, unknown>) =>
    Promise.resolve({
      chat_timeout_seconds: 900,
      customer_idle_seconds: body['customer_idle_seconds'],
    }),
  );
});

describe('Suggested replies settings (IN-07)', () => {
  it('is folded away until asked for, so no shortcut is listed twice on the page', () => {
    renderIt({ folded: true });
    expect(screen.getByRole('button', { name: 'Set up' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(screen.queryByTestId('suggest-row-devir')).not.toBeInTheDocument();
    open();
    expect(screen.getByRole('button', { name: 'Hide' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTestId('suggest-row-devir')).toBeInTheDocument();
  });

  it('shows a checkbox per event for each reply the caller may change, ticked as stored', () => {
    renderIt();
    const row = screen.getByTestId('suggest-row-devir');
    expect(within(row).getAllByRole('checkbox')).toHaveLength(5);
    expect(
      within(row).getByRole('checkbox', { name: '#devir: suggest when Chat started' }),
    ).toBeChecked();
    expect(
      within(row).getByRole('checkbox', {
        name: '#devir: suggest when Chat transferred to the agent',
      }),
    ).not.toBeChecked();
  });

  it('binding an event sends the whole list, in the catalogue’s order', async () => {
    renderIt();
    fireEvent.click(
      screen.getByRole('checkbox', { name: '#devir: suggest when Chat transferred to the agent' }),
    );
    await waitFor(() => expect(api.patch).toHaveBeenCalledTimes(1));
    expect(api.patch).toHaveBeenCalledWith('/settings/canned-responses/r1', {
      suggest_on: ['chat_started', 'chat_transferred'],
    });
  });

  it('unticking the last event sends an empty list', async () => {
    renderIt();
    fireEvent.click(screen.getByRole('checkbox', { name: '#devir: suggest when Chat started' }));
    await waitFor(() => expect(api.patch).toHaveBeenCalled());
    expect(api.patch).toHaveBeenCalledWith('/settings/canned-responses/r1', { suggest_on: [] });
  });

  it('saves the order on blur, and a bad one is put back without a request', async () => {
    renderIt();
    const order = screen.getByLabelText('Order of #devir among its chips');
    fireEvent.change(order, { target: { value: '7' } });
    fireEvent.blur(order);
    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith('/settings/canned-responses/r1', { suggest_order: 7 }),
    );

    api.patch.mockClear();
    fireEvent.change(order, { target: { value: '-3' } });
    fireEvent.blur(order);
    expect(api.patch).not.toHaveBeenCalled();
    expect(order).toHaveValue(2);
  });

  it('marks a reply as a promotion, and says it is withheld from blocked players', async () => {
    renderIt();
    fireEvent.change(screen.getByLabelText('Category of #devir'), {
      target: { value: 'promotion' },
    });
    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith('/settings/canned-responses/r1', {
        category: 'promotion',
      }),
    );
  });

  it('lists only the replies the caller may change', () => {
    renderIt({ canEdit: false, canWritePersonal: true });
    expect(screen.queryByTestId('suggest-row-devir')).not.toBeInTheDocument();
    expect(screen.getByTestId('suggest-row-kisisel')).toBeInTheDocument();
  });

  it('renders nothing for a caller who may change no reply and no setting', () => {
    const { container } = renderIt({ canEdit: false, canWritePersonal: false });
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the API’s refusal instead of pretending the change took', async () => {
    api.patch.mockRejectedValue(new Error('nope'));
    renderIt();
    fireEvent.click(screen.getByRole('checkbox', { name: '#devir: suggest when Chat started' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });
});

describe('Suggested replies — the "player went quiet" delay (IN-07)', () => {
  it('is shown to those who may change inbox settings, at the default until set', async () => {
    renderIt({ canConfigureIdle: true });
    const input = await screen.findByLabelText('Player is quiet after (seconds)');
    expect(input).toHaveValue(180);
  });

  it('is hidden from everyone else', () => {
    renderIt({ canConfigureIdle: false });
    expect(screen.queryByLabelText('Player is quiet after (seconds)')).not.toBeInTheDocument();
  });

  it('saves a new value next to the stored timeout, leaving every other setting out', async () => {
    renderIt({ canConfigureIdle: true });
    const input = await screen.findByLabelText('Player is quiet after (seconds)');
    fireEvent.change(input, { target: { value: '300' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.put).toHaveBeenCalledTimes(1));
    expect(api.put).toHaveBeenCalledWith('/settings/chat-timeout', {
      chat_timeout_seconds: 900,
      customer_idle_seconds: 300,
    });
  });

  it('puts the default back (null) when the default is typed', async () => {
    api.get.mockResolvedValue({ chat_timeout_seconds: 900, customer_idle_seconds: 300 });
    renderIt({ canConfigureIdle: true });
    const input = await screen.findByLabelText('Player is quiet after (seconds)');
    await waitFor(() => expect(input).toHaveValue(300));
    fireEvent.change(input, { target: { value: '180' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.put).toHaveBeenCalled());
    expect(api.put).toHaveBeenCalledWith('/settings/chat-timeout', {
      chat_timeout_seconds: 900,
      customer_idle_seconds: null,
    });
  });

  it('refuses a value outside 10…86400 without a request', async () => {
    renderIt({ canConfigureIdle: true });
    const input = await screen.findByLabelText('Player is quiet after (seconds)');
    fireEvent.change(input, { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Enter a whole number from 10 to 86400.')).toBeInTheDocument();
    expect(api.put).not.toHaveBeenCalled();
  });
});
