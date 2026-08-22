/**
 * Chat timeout settings (FR-MOD-08.7.3, M-UI-GAP tm 136.1): the server's saved
 * window lands in the form, a valid change saves through PUT as whole
 * seconds derived from the amount+unit picker, an out-of-range or non-integer
 * amount is rejected before it ever reaches the network, and a read-only
 * agent cannot touch it at all.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatTimeout } from './ChatTimeout.js';
import { useAuth } from '../../lib/auth-store.js';
import { renderWithLocale, resetLocale } from '../../test/i18n.js';

const DEFAULTS = { chat_timeout_seconds: null as number | null, updated_at: null as string | null };

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
      if (String(url).endsWith('/settings/chat-timeout')) {
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

function renderChatTimeout(canEdit = true) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ChatTimeout canEdit={canEdit} />
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

describe('ChatTimeout', () => {
  it('reads a never-configured workspace as off, with a sane default duration', async () => {
    renderChatTimeout();

    expect(
      await screen.findByRole('checkbox', { name: /Automatically close idle chats/ }),
    ).not.toBeChecked();
    expect(screen.getByLabelText('Idle for')).toHaveValue(30);
    expect(screen.getByLabelText('Unit')).toHaveValue('minutes');
  });

  it('loads a saved window into the form, converted to whole hours', async () => {
    stubFetch({ chat_timeout_seconds: 7200, updated_at: '2026-08-01T00:00:00.000Z' });
    renderChatTimeout();

    expect(
      await screen.findByRole('checkbox', { name: /Automatically close idle chats/ }),
    ).toBeChecked();
    expect(screen.getByLabelText('Idle for')).toHaveValue(2);
    expect(screen.getByLabelText('Unit')).toHaveValue('hours');
  });

  it('keeps Save disabled until something is changed', async () => {
    renderChatTimeout();
    const save = await screen.findByRole('button', { name: 'Save' });
    expect(save).toBeDisabled();
  });

  it('turns the timeout on and saves the amount+unit as whole seconds through PUT', async () => {
    renderChatTimeout();
    const toggle = await screen.findByRole('checkbox', { name: /Automatically close idle chats/ });
    await userEvent.click(toggle);

    const amount = screen.getByLabelText('Idle for');
    await userEvent.clear(amount);
    await userEvent.type(amount, '45');

    const save = screen.getByRole('button', { name: 'Save' });
    expect(save).toBeEnabled();
    await userEvent.click(save);

    await waitFor(() => expect(putBodies).toHaveLength(1));
    expect(putBodies[0]).toEqual({ chat_timeout_seconds: 45 * 60 });
  });

  it('saves null when turned off, regardless of the (disabled) amount field', async () => {
    stubFetch({ chat_timeout_seconds: 3600, updated_at: '2026-08-01T00:00:00.000Z' });
    renderChatTimeout();

    const toggle = await screen.findByRole('checkbox', { name: /Automatically close idle chats/ });
    await userEvent.click(toggle);

    const save = screen.getByRole('button', { name: 'Save' });
    expect(save).toBeEnabled();
    await userEvent.click(save);

    await waitFor(() => expect(putBodies).toHaveLength(1));
    expect(putBodies[0]).toEqual({ chat_timeout_seconds: null });
  });

  it('rejects a zero duration with a field-under error and blocks saving', async () => {
    renderChatTimeout();
    const toggle = await screen.findByRole('checkbox', { name: /Automatically close idle chats/ });
    await userEvent.click(toggle);

    const amount = screen.getByLabelText('Idle for');
    await userEvent.clear(amount);
    await userEvent.type(amount, '0');
    await userEvent.tab();

    expect(screen.getByRole('alert')).toHaveTextContent(/whole number greater than 0/);
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(putBodies).toHaveLength(0);
  });

  it('rejects an amount whose unit pushes it past the 30-day ceiling', async () => {
    renderChatTimeout();
    const toggle = await screen.findByRole('checkbox', { name: /Automatically close idle chats/ });
    await userEvent.click(toggle);

    await userEvent.selectOptions(screen.getByLabelText('Unit'), 'hours');
    const amount = screen.getByLabelText('Idle for');
    await userEvent.clear(amount);
    await userEvent.type(amount, '800'); // 800h > 30 days (720h)
    await userEvent.tab();

    expect(screen.getByRole('alert')).toHaveTextContent(/whole number greater than 0/);
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(putBodies).toHaveLength(0);
  });

  it('shows the PUT error and keeps the entered values', async () => {
    renderChatTimeout();
    const toggle = await screen.findByRole('checkbox', { name: /Automatically close idle chats/ });
    await userEvent.click(toggle);

    nextPutFails = true;
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Check the highlighted fields and try again.',
    );
    expect(screen.getByLabelText('Idle for')).toHaveValue(30);
  });

  it('is read-only when canEdit is false: inputs disabled, no Save button, PUT never called', async () => {
    renderChatTimeout(false);

    expect(
      await screen.findByRole('checkbox', { name: /Automatically close idle chats/ }),
    ).toBeDisabled();
    expect(screen.getByLabelText('Idle for')).toBeDisabled();
    expect(screen.getByLabelText('Unit')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
    expect(putBodies).toHaveLength(0);
  });
});

/** One sentinel for this file's DoD claim of being translated (I18N-j precedent, tm 133.10). */
describe('ChatTimeout localisation (NFR-I18N2)', () => {
  afterEach(() => {
    resetLocale();
  });

  it('paints Chat timeout in Turkish when that is the active locale', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderWithLocale(
      <QueryClientProvider client={queryClient}>
        <ChatTimeout canEdit />
      </QueryClientProvider>,
      'tr',
    );

    expect(await screen.findByRole('region', { name: 'Sohbet zaman aşımı' })).toBeInTheDocument();
  });
});
