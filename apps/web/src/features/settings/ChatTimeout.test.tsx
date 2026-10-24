/**
 * Chat timeout settings (FR-MOD-08.7.3, M-UI-GAP tm 136.1): the server's saved
 * window lands in the form, a valid change saves through PUT as whole
 * seconds derived from the amount+unit picker, an out-of-range or non-integer
 * amount is rejected before it ever reaches the network, and a read-only
 * agent cannot touch it at all.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatTimeout } from './ChatTimeout.js';
import { useAuth } from '../../lib/auth-store.js';
import { renderWithLocale, resetLocale } from '../../test/i18n.js';

const DEFAULTS = {
  chat_timeout_seconds: null as number | null,
  day_boundary_timezone: 'Europe/Istanbul',
  day_boundary_hour: 0,
  updated_at: null as string | null,
};

function okJson(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => body,
  } as unknown as Response;
}

function errorJson(status: number, message: string, details?: Record<string, unknown>): Response {
  return {
    ok: false,
    status,
    headers: { get: () => null },
    json: async () => ({
      error: {
        type: 'validation',
        message,
        request_id: 'req_test',
        ...(details ? { details } : {}),
      },
    }),
  } as unknown as Response;
}

let putBodies: Array<Record<string, unknown>>;
let nextPutFails: boolean;
/** The `details` a failing PUT carries — the server names an out-of-order pair here. */
let nextPutDetails: Record<string, unknown> | undefined;

function stubFetch(current: typeof DEFAULTS & Record<string, unknown>): void {
  putBodies = [];
  nextPutFails = false;
  nextPutDetails = undefined;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      if (String(url).endsWith('/settings/chat-timeout')) {
        if (method === 'PUT') {
          if (nextPutFails) {
            return errorJson(400, 'Could not save that configuration.', nextPutDetails);
          }
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
    stubFetch({ ...DEFAULTS, chat_timeout_seconds: 7200, updated_at: '2026-08-01T00:00:00.000Z' });
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
    stubFetch({ ...DEFAULTS, chat_timeout_seconds: 3600, updated_at: '2026-08-01T00:00:00.000Z' });
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
    expect(screen.getByLabelText('Time zone')).toBeDisabled();
    expect(screen.getByLabelText('Day starts at')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
    expect(putBodies).toHaveLength(0);
  });
});

describe('ChatTimeout day boundary (ID-04)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    // 21:30 UTC on 14 October is 00:30 on the 15th in Istanbul.
    vi.setSystemTime(new Date('2026-10-14T21:30:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows the shipped default — Europe/Istanbul, 00:00 — for a workspace that never set it', async () => {
    renderChatTimeout();

    expect(await screen.findByLabelText('Time zone')).toHaveValue('Europe/Istanbul');
    expect(screen.getByLabelText('Day starts at')).toHaveValue('0');
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('reads a server that predates the setting as the default rather than blank', async () => {
    stubFetch({ chat_timeout_seconds: null, updated_at: null } as typeof DEFAULTS);
    renderChatTimeout();

    expect(await screen.findByLabelText('Time zone')).toHaveValue('Europe/Istanbul');
    expect(screen.getByLabelText('Day starts at')).toHaveValue('0');
  });

  it('shows a live example built from the chosen zone and hour', async () => {
    renderChatTimeout();
    const example = await screen.findByRole('note', { name: 'Day boundary example' });

    // 00:30 in Istanbul — already the 15th although it is still the 14th in UTC.
    expect(example).toHaveTextContent('Right now it is 00:30 in Europe/Istanbul');
    expect(example).toHaveTextContent('belongs to 2026-10-15');
    expect(example).toHaveTextContent('Each day runs from 00:00 to 23:59.');

    await userEvent.selectOptions(screen.getByLabelText('Day starts at'), '6');
    expect(example).toHaveTextContent('belongs to 2026-10-14');
    expect(example).toHaveTextContent('05:59 still belongs to the previous day');
    expect(example).toHaveTextContent('one at 06:00 to the new day');

    await userEvent.selectOptions(screen.getByLabelText('Time zone'), 'America/New_York');
    expect(example).toHaveTextContent('Right now it is 17:30 in America/New_York');
    expect(example).toHaveTextContent('belongs to 2026-10-14');
  });

  it('narrows the zone list as you type and keeps the selected zone listed', async () => {
    renderChatTimeout();
    await screen.findByLabelText('Time zone');

    await userEvent.type(screen.getByLabelText('Search time zones'), 'new york');
    const options = within(screen.getByLabelText('Time zone')).getAllByRole('option');
    const names = options.map((option) => option.getAttribute('value'));
    expect(names).toContain('America/New_York');
    expect(names).not.toContain('Asia/Tokyo');
    // The saved zone stays visible so the picker never shows an empty selection.
    expect(names).toContain('Europe/Istanbul');
    expect(screen.getByLabelText('Time zone')).toHaveValue('Europe/Istanbul');
  });

  it('says so when no zone matches the search', async () => {
    renderChatTimeout();
    await screen.findByLabelText('Time zone');

    const search = screen.getByLabelText('Search time zones');
    await userEvent.type(search, 'istanbul');
    expect(screen.queryByText('No time zone matches that search.')).not.toBeInTheDocument();

    await userEvent.clear(search);
    await userEvent.type(search, 'zzzz-not-a-zone');
    expect(screen.getByText('No time zone matches that search.')).toBeInTheDocument();
  });

  it('saves a changed zone and hour through PUT, next to the timeout', async () => {
    renderChatTimeout();
    await userEvent.selectOptions(await screen.findByLabelText('Time zone'), 'America/New_York');
    await userEvent.selectOptions(screen.getByLabelText('Day starts at'), '6');

    const save = screen.getByRole('button', { name: 'Save' });
    expect(save).toBeEnabled();
    await userEvent.click(save);

    await waitFor(() => expect(putBodies).toHaveLength(1));
    expect(putBodies[0]).toEqual({
      chat_timeout_seconds: null,
      day_boundary_timezone: 'America/New_York',
      day_boundary_hour: 6,
    });
  });

  it('sends only the boundary field that changed', async () => {
    renderChatTimeout();
    await userEvent.selectOptions(await screen.findByLabelText('Day starts at'), '23');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(putBodies).toHaveLength(1));
    expect(putBodies[0]).toEqual({ chat_timeout_seconds: null, day_boundary_hour: 23 });
  });

  it('typing in the search box alone does not make the form dirty', async () => {
    renderChatTimeout();
    await screen.findByLabelText('Time zone');
    await userEvent.type(screen.getByLabelText('Search time zones'), 'tokyo');
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });
});

/**
 * The two windows before the auto-close (WG-03 · tm 340.3): pass an unanswered
 * chat on, then mark a quiet one inactive. The order is the claim worth a test
 * of its own — refused here, before the network, with the same
 * `chatInactivityOrderProblem` the server runs, and the server's own refusal
 * read back as the same sentence.
 */
describe('ChatTimeout inactivity windows (WG-03)', () => {
  const WINDOWS = {
    ...DEFAULTS,
    chat_timeout_seconds: 900,
    unanswered_transfer_seconds: 180,
    inactive_after_seconds: 600,
    pause_unresponsive_agents: true,
  };

  it('shows the three windows in the order a chat goes quiet, read from the server (FR-MOD-08.7.3)', async () => {
    stubFetch(WINDOWS);
    renderChatTimeout();

    const transfer = await screen.findByRole('checkbox', {
      name: /Pass unanswered chats to another agent/,
    });
    const inactive = screen.getByRole('checkbox', { name: /Mark quiet chats as inactive/ });
    const close = screen.getByRole('checkbox', { name: /Automatically close idle chats/ });
    for (const box of [transfer, inactive, close]) expect(box).toBeChecked();
    // In document order: passed on, then inactive, then closed.
    expect(
      transfer.compareDocumentPosition(inactive) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(inactive.compareDocumentPosition(close) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    expect(screen.getByLabelText('Unanswered for')).toHaveValue(3);
    expect(screen.getByLabelText('Transfer unit')).toHaveValue('minutes');
    expect(screen.getByLabelText('Quiet for')).toHaveValue(10);
    expect(screen.getByLabelText('Inactivity unit')).toHaveValue('minutes');
    expect(screen.getByLabelText('Idle for')).toHaveValue(15);
    expect(
      screen.getByRole('checkbox', { name: /Also stop routing new chats to that agent/ }),
    ).toBeChecked();
  });

  it('offers 3 and 10 minutes for windows a workspace never set, and leaves them off', async () => {
    renderChatTimeout();
    expect(
      await screen.findByRole('checkbox', { name: /Pass unanswered chats to another agent/ }),
    ).not.toBeChecked();
    expect(screen.getByLabelText('Unanswered for')).toHaveValue(3);
    expect(screen.getByLabelText('Unanswered for')).toBeDisabled();
    expect(screen.getByLabelText('Quiet for')).toHaveValue(10);
    // Pausing is the column's default — on — and only means anything with a transfer.
    const pause = screen.getByRole('checkbox', { name: /Also stop routing new chats/ });
    expect(pause).toBeChecked();
    expect(pause).toBeDisabled();
  });

  it('saves the two windows as whole seconds, sending only what changed', async () => {
    renderChatTimeout();
    await userEvent.click(
      await screen.findByRole('checkbox', { name: /Pass unanswered chats to another agent/ }),
    );
    await userEvent.click(screen.getByRole('checkbox', { name: /Mark quiet chats as inactive/ }));
    const quiet = screen.getByLabelText('Quiet for');
    await userEvent.clear(quiet);
    await userEvent.type(quiet, '2');
    await userEvent.selectOptions(screen.getByLabelText('Inactivity unit'), 'hours');

    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(putBodies).toHaveLength(1));
    expect(putBodies[0]).toEqual({
      chat_timeout_seconds: null,
      unanswered_transfer_seconds: 180,
      inactive_after_seconds: 7200,
    });
  });

  it('turns pausing off on its own, and a window off as null', async () => {
    stubFetch(WINDOWS);
    renderChatTimeout();
    await userEvent.click(
      await screen.findByRole('checkbox', { name: /Also stop routing new chats to that agent/ }),
    );
    await userEvent.click(screen.getByRole('checkbox', { name: /Mark quiet chats as inactive/ }));

    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(putBodies).toHaveLength(1));
    expect(putBodies[0]).toEqual({
      chat_timeout_seconds: 900,
      inactive_after_seconds: null,
      pause_unresponsive_agents: false,
    });
  });

  it('refuses a transfer window that is not shorter than the inactive one, before the network (FR-MOD-08.7.3)', async () => {
    stubFetch(WINDOWS);
    renderChatTimeout();
    const unanswered = await screen.findByLabelText('Unanswered for');
    await userEvent.clear(unanswered);
    await userEvent.type(unanswered, '10');

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Pass unanswered chats on sooner than chats become inactive.',
    );
    const save = screen.getByRole('button', { name: 'Save' });
    expect(save).toBeDisabled();
    await userEvent.click(save);
    expect(putBodies).toHaveLength(0);

    // Back in order, the refusal goes and the save goes through.
    await userEvent.clear(unanswered);
    await userEvent.type(unanswered, '5');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(putBodies).toHaveLength(1));
    expect(putBodies[0]).toEqual({ chat_timeout_seconds: 900, unanswered_transfer_seconds: 300 });
  });

  it('refuses an inactive window as long as the auto-close, and ignores a pair with one side off', async () => {
    stubFetch(WINDOWS);
    renderChatTimeout();
    const quiet = await screen.findByLabelText('Quiet for');
    await userEvent.clear(quiet);
    await userEvent.type(quiet, '15');
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Mark chats inactive sooner than idle chats are closed.',
    );

    // With auto-close off there is no pair to be out of order.
    await userEvent.click(screen.getByRole('checkbox', { name: /Automatically close idle chats/ }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
  });

  it('reads the server’s refusal of an out-of-order save back as the same sentence', async () => {
    stubFetch(WINDOWS);
    renderChatTimeout();
    // A pair this form judges in order, refused because the stored row moved
    // under it — the server compares against what the save leaves behind.
    const unanswered = await screen.findByLabelText('Unanswered for');
    await userEvent.clear(unanswered);
    await userEvent.type(unanswered, '4');
    nextPutFails = true;
    nextPutDetails = { problem: 'transfer_not_before_timeout' };
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Pass unanswered chats on sooner than idle chats are closed.',
    );
  });
});

/** One sentinel for this file's DoD claim of being translated (I18N-j precedent, tm 133.10). */
describe('ChatTimeout localisation (NFR-I18N2)', () => {
  afterEach(() => {
    resetLocale();
  });

  it('paints the inactivity, chat timeout and day boundary card in Turkish when that is the active locale', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderWithLocale(
      <QueryClientProvider client={queryClient}>
        <ChatTimeout canEdit />
      </QueryClientProvider>,
      'tr',
    );

    expect(
      await screen.findByRole('region', { name: 'Hareketsizlik, sohbet süresi ve gün sınırı' }),
    ).toBeInTheDocument();
  });
});
