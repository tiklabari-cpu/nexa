/**
 * The Details panel's assignment control (FR-MOD-02.4.1–.6).
 *
 * The PRD's acceptance criterion says the assignee row "saves instantly". Until
 * this control the row showed the word "Assigned" and nothing else: no name, no
 * way to change it, so the one line of the criterion that names a person could
 * not be met from the console at all.
 *
 * The panel is rendered through a harness that reads `['chat', chatId]` out of
 * the query cache, exactly as `InboxPage` does. That matters: the optimistic
 * update writes to the cache, so a test handing `DetailsPanel` a frozen object
 * would show a green "it saved instantly" while the screen never moved.
 */
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { ReactElement } from 'react';
import { ApiClientError } from '../../lib/api-client.js';
import { DetailsPanel } from './DetailsPanel.js';
import type { ChatDetail } from './types.js';

const { api, authState } = vi.hoisted(() => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
  authState: { agent: null as { role: string; scopes: string[] } | null },
}));

vi.mock('../../lib/auth-store.js', () => ({
  useApiClient: () => api,
  useAuth: (selector: (state: typeof authState) => unknown) => selector(authState),
}));

const CHAT_ID = 'TJ1H8CFKRV';

const ROSTER = [
  { id: 'agent-9', name: 'Priya', routing_status: 'accepting_chats' },
  { id: 'agent-4', name: 'Marek', routing_status: 'offline' },
];

function chatWith(assigneeId: string | null, active = true): ChatDetail {
  return {
    id: CHAT_ID,
    license_id: '1000003',
    customer_id: 'cust-1',
    active,
    created_at: '2026-07-20T10:00:00.000Z',
    access: { group_ids: [] },
    users: [],
    thread: {
      id: 'TH1',
      chat_id: CHAT_ID,
      active,
      assignee_id: assigneeId,
      queue_position: null,
      summary: null,
      created_at: '2026-07-20T10:00:00.000Z',
      closed_at: null,
      tags: [],
    },
  };
}

/** What `GET /chats/{id}` currently answers — moved by a successful transfer. */
let served: ChatDetail = chatWith(null);

/**
 * `InboxPage`'s wiring in miniature: the panel reads the chat out of the cache,
 * so an optimistic write shows up here the way it does on screen.
 */
function Harness(): ReactElement | null {
  const chat = useQuery({
    queryKey: ['chat', CHAT_ID],
    queryFn: (): Promise<ChatDetail> => api.get(`/chats/${CHAT_ID}`),
  });
  if (!chat.data) return null;
  return <DetailsPanel chat={chat.data} chatId={CHAT_ID} />;
}

function renderPanel() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <Harness />
    </QueryClientProvider>,
  );
}

/** The menu trigger, which shows the current holder's name. */
function assigneeTrigger(): HTMLElement {
  return screen.getByRole('button', { name: 'Change assignee' });
}

async function openMenu(): Promise<void> {
  fireEvent.click(assigneeTrigger());
  await screen.findByRole('button', { name: /Priya/ });
}

beforeEach(() => {
  for (const fn of Object.values(api)) (fn as Mock).mockReset();
  served = chatWith(null);
  api.get.mockImplementation((path: string) => {
    if (path === '/agents') return Promise.resolve({ items: ROSTER });
    if (path.startsWith('/chats/')) return Promise.resolve(served);
    return Promise.resolve({ items: [] });
  });
  authState.agent = { role: 'agent', scopes: ['chats--access:rw', 'agents--my:rw'] };
});

describe('DetailsPanel — assignment (FR-MOD-02.4.1–.6)', () => {
  it('names the agent holding the conversation, not just "Assigned"', async () => {
    served = chatWith('agent-9');

    renderPanel();

    await waitFor(() => expect(assigneeTrigger()).toHaveTextContent('Priya'));
    // The word that stood here before names nobody; it must be gone, not beside it.
    expect(screen.queryByText('Assigned')).not.toBeInTheDocument();
  });

  it('hands the chat over on selection and shows the new name', async () => {
    api.post.mockImplementation((path: string, body: { agent_id: string }) => {
      served = chatWith(body.agent_id);
      return Promise.resolve(served);
    });

    renderPanel();
    await waitFor(() => expect(assigneeTrigger()).toHaveTextContent('Unassigned'));
    await openMenu();

    fireEvent.click(screen.getByRole('button', { name: /Priya/ }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(`/chats/${CHAT_ID}/transfer`, { agent_id: 'agent-9' }),
    );
    await waitFor(() => expect(assigneeTrigger()).toHaveTextContent('Priya'));
  });

  it('offers no way to pick the teammate who already holds it', async () => {
    served = chatWith('agent-9');

    renderPanel();
    await waitFor(() => expect(assigneeTrigger()).toHaveTextContent('Priya'));
    await openMenu();

    expect(screen.getByRole('button', { name: /Priya/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Marek/ })).toBeEnabled();
  });

  it('shows the name but no control to a caller who may not write to the chat', async () => {
    served = chatWith('agent-9');
    authState.agent = { role: 'agent', scopes: ['chats--access:ro', 'agents--my:ro'] };

    renderPanel();

    expect(await screen.findByText('Priya')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Change assignee' })).not.toBeInTheDocument();
  });

  it('leaves the control off an archived chat but keeps the name', async () => {
    served = chatWith('agent-9', false);

    renderPanel();

    expect(await screen.findByText('Priya')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Change assignee' })).not.toBeInTheDocument();
  });

  it('rolls the name back and states the conflict when the server refuses (409)', async () => {
    served = chatWith('agent-9');
    api.post.mockRejectedValue(
      new ApiClientError({
        type: 'chat_inactive',
        status: 409,
        message: 'Cannot transfer a closed chat.',
        requestId: 'req-1',
      }),
    );

    renderPanel();
    await waitFor(() => expect(assigneeTrigger()).toHaveTextContent('Priya'));
    await openMenu();
    fireEvent.click(screen.getByRole('button', { name: /Marek/ }));

    // The server's verdict, resolved through the ADR-06 catalogue…
    expect(await screen.findByText('This conversation is no longer active.')).toBeInTheDocument();
    // …and the row is back on whoever the server still says holds it.
    await waitFor(() => expect(assigneeTrigger()).toHaveTextContent('Priya'));
  });

  it('words an offline teammate as a teammate, not as a team', async () => {
    api.post.mockRejectedValue(
      new ApiClientError({
        type: 'group_unavailable',
        status: 409,
        message: 'That agent is offline.',
        requestId: 'req-2',
      }),
    );

    renderPanel();
    await waitFor(() => expect(assigneeTrigger()).toHaveTextContent('Unassigned'));
    await openMenu();
    fireEvent.click(screen.getByRole('button', { name: /Marek/ }));

    expect(await screen.findByText('That teammate is offline.')).toBeInTheDocument();
    expect(
      screen.queryByText('That team cannot take this conversation right now.'),
    ).not.toBeInTheDocument();
  });

  it('says so when the roster cannot be read, rather than offering an empty menu', async () => {
    api.get.mockImplementation((path: string) => {
      if (path === '/agents') {
        return Promise.reject(
          new ApiClientError({
            type: 'authorization',
            status: 403,
            message: 'nope',
            requestId: 'req-3',
          }),
        );
      }
      if (path.startsWith('/chats/')) return Promise.resolve(served);
      return Promise.resolve({ items: [] });
    });

    renderPanel();
    await waitFor(() => expect(assigneeTrigger()).toBeInTheDocument());
    fireEvent.click(assigneeTrigger());

    expect(await screen.findByText('Teammate list unavailable.')).toBeInTheDocument();
  });
});

describe('DetailsPanel — the live visit duration (FR-MOD-02.4.1–.6)', () => {
  it('counts an open visit up from the figure the server sent', async () => {
    vi.useFakeTimers();
    try {
      served = {
        ...chatWith('agent-9'),
        visitor: {
          visited_pages: [],
          visit_info: {
            device: 'Chrome on macOS',
            referrer: null,
            duration_seconds: 200,
            ip: null,
            ongoing: true,
          },
        },
      };

      renderPanel();
      await act(async () => void (await vi.advanceTimersByTimeAsync(0)));
      const duration = (): HTMLElement => {
        const row = screen.getByText('Duration').closest('div');
        if (!row) throw new Error('no duration row');
        return row as HTMLElement;
      };
      expect(within(duration()).getByText('3m 20s')).toBeInTheDocument();

      await act(async () => void (await vi.advanceTimersByTimeAsync(5_000)));
      expect(within(duration()).getByText('3m 25s')).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});
