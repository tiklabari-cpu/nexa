/**
 * The Details panel: the visitor context (FR-MOD-02.4) and the supervisor
 * takeover action (FR-MOD-08.6.3).
 *
 * The two visitor sections it adds — Visited pages and Visit info — must
 * render the visit when there is one and an explicit empty state when there
 * is not: a blank rectangle reads as a loading bug, not as "this visitor is
 * anonymous". `api.get` is stubbed to `{ items: [] }` by default so the tag
 * library and connected-apps queries stay quiet; it is another test's
 * concern.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { vi } from 'vitest';
import { ApiClientError } from '../../lib/api-client.js';
import { DetailsPanel } from './DetailsPanel.js';
import type { ChatDetail, ChatVisitor } from './types.js';

const { api, authState } = vi.hoisted(() => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
  authState: { agent: null as { role: string } | null },
}));

vi.mock('../../lib/auth-store.js', () => ({
  useApiClient: () => api,
  useAuth: (selector: (state: typeof authState) => unknown) => selector(authState),
}));

type ThreadOverrides = Partial<NonNullable<ChatDetail['thread']>>;

function baseChat(overrides?: ThreadOverrides): ChatDetail {
  return {
    id: 'TJ1H8CFKRV',
    license_id: '1000003',
    customer_id: 'cust-1',
    active: true,
    created_at: '2026-07-20T10:00:00.000Z',
    access: { group_ids: [] },
    users: [],
    thread: {
      id: 'TH1',
      chat_id: 'TJ1H8CFKRV',
      active: true,
      assignee_id: null,
      queue_position: null,
      summary: null,
      created_at: '2026-07-20T10:00:00.000Z',
      closed_at: null,
      tags: [],
      ...overrides,
    },
  };
}

function chatWithVisitor(visitor?: ChatVisitor | null): ChatDetail {
  return { ...baseChat(), ...(visitor !== undefined ? { visitor } : {}) };
}

function renderPanel(chat: ChatDetail) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <DetailsPanel chat={chat} chatId={chat.id} />
    </QueryClientProvider>,
  );
}

/** Locate a "label / value" row inside the panel by its label text. */
function rowValue(label: string): HTMLElement {
  const row = screen.getByText(label).closest('div');
  if (!row) throw new Error(`no row for ${label}`);
  return row as HTMLElement;
}

beforeEach(() => {
  api.get.mockReset();
  api.post.mockReset();
  api.put.mockReset();
  api.delete.mockReset();
  api.get.mockResolvedValue({ items: [] });
  authState.agent = null;
});

describe('DetailsPanel visitor context', () => {
  it('lists the visited pages and the visit summary', () => {
    renderPanel(
      chatWithVisitor({
        visited_pages: [
          { url: 'https://shop.example/bikes', at: '2026-07-20T10:00:00.000Z' },
          { url: 'https://shop.example/bikes/brakes' },
        ],
        visit_info: {
          device: 'Chrome on macOS',
          referrer: 'https://google.com/search',
          duration_seconds: 200,
          ip: '203.0.113.7',
        },
      }),
    );

    // Both pages appear, shown as their path and linking to the full URL.
    const brakes = screen.getByRole('link', { name: '/bikes/brakes' });
    expect(brakes).toHaveAttribute('href', 'https://shop.example/bikes/brakes');
    expect(screen.getByRole('link', { name: '/bikes' })).toBeInTheDocument();

    // The summary rows carry the derived values.
    expect(within(rowValue('Device')).getByText('Chrome on macOS')).toBeInTheDocument();
    expect(within(rowValue('IP')).getByText('203.0.113.7')).toBeInTheDocument();
    // 200s renders as minutes and seconds, not a raw count.
    expect(within(rowValue('Duration')).getByText('3m 20s')).toBeInTheDocument();
  });

  it('shows an empty state for a visitor with no recorded visit', () => {
    renderPanel(chatWithVisitor(null));

    expect(screen.getByText('No pages recorded for this visitor.')).toBeInTheDocument();
    expect(screen.getByText('No visit information yet.')).toBeInTheDocument();
    // The section headings are still present — the panel does not hide them.
    expect(screen.getByText('Visited pages')).toBeInTheDocument();
    expect(screen.getByText('Visit info')).toBeInTheDocument();
  });

  it('falls back to "Direct" and a dash when fields are missing', () => {
    renderPanel(
      chatWithVisitor({
        visited_pages: [],
        visit_info: { device: null, referrer: null, duration_seconds: null, ip: null },
      }),
    );

    // A visit exists, so the info rows render — with sensible placeholders.
    expect(within(rowValue('Referring')).getByText('Direct')).toBeInTheDocument();
    expect(within(rowValue('Duration')).getByText('—')).toBeInTheDocument();
    // …but with no pages, the pages section still shows its empty state.
    expect(screen.getByText('No pages recorded for this visitor.')).toBeInTheDocument();
  });
});

describe('DetailsPanel — supervisor takeover', () => {
  it('renders no Take over control for an agent-role caller', () => {
    authState.agent = { role: 'agent' };
    renderPanel(baseChat());

    expect(screen.queryByRole('button', { name: 'Take over' })).not.toBeInTheDocument();
  });

  it.each(['admin', 'viceowner', 'owner'])('renders the control for a %s caller', (role) => {
    authState.agent = { role };
    renderPanel(baseChat());

    expect(screen.getByRole('button', { name: 'Take over' })).toBeInTheDocument();
  });

  it('opens a confirmation naming the current assignee, then calls the takeover endpoint', async () => {
    authState.agent = { role: 'admin' };
    api.get.mockImplementation((path: string) =>
      path === '/agents'
        ? Promise.resolve({ items: [{ id: 'agent-9', name: 'Priya' }] })
        : Promise.resolve({ items: [] }),
    );
    api.post.mockResolvedValue({
      ...baseChat(),
      thread: { ...baseChat().thread, assignee_id: 'agent-1' },
    });

    renderPanel(baseChat({ assignee_id: 'agent-9' }));
    fireEvent.click(screen.getByRole('button', { name: 'Take over' }));

    const dialog = await screen.findByRole('dialog', { name: 'Take over this chat?' });
    expect(await within(dialog).findByText(/taking it from Priya/)).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Take over' }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/chats/TJ1H8CFKRV/takeover', undefined),
    );
    // Success closes the dialog.
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('offers a plain confirmation for an unassigned chat', async () => {
    authState.agent = { role: 'admin' };
    renderPanel(baseChat({ assignee_id: null }));

    fireEvent.click(screen.getByRole('button', { name: 'Take over' }));

    const dialog = await screen.findByRole('dialog', { name: 'Take over this chat?' });
    expect(within(dialog).getByText(/unassigned/)).toBeInTheDocument();
    // No agent roster lookup needed for an unassigned chat.
    expect(api.get).not.toHaveBeenCalledWith('/agents');
  });

  it('shows the role-authorization message on a 403', async () => {
    authState.agent = { role: 'admin' };
    api.post.mockRejectedValue(
      new ApiClientError({
        type: 'authorization',
        status: 403,
        message: 'Only an admin or owner can take over a chat.',
        requestId: 'req-1',
      }),
    );

    renderPanel(baseChat());
    fireEvent.click(screen.getByRole('button', { name: 'Take over' }));
    const dialog = await screen.findByRole('dialog', { name: 'Take over this chat?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Take over' }));

    expect(
      await within(dialog).findByText('Only an admin or owner can take over a chat.'),
    ).toBeInTheDocument();
    // The dialog stays open — the caller may not retry a 403, but should see why it failed.
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('shows a distinct race-lost message on a 409, not the 403 wording', async () => {
    authState.agent = { role: 'admin' };
    api.post.mockRejectedValue(
      new ApiClientError({
        type: 'takeover_conflict',
        status: 409,
        message: 'Another supervisor took this chat over first.',
        requestId: 'req-2',
      }),
    );

    renderPanel(baseChat());
    fireEvent.click(screen.getByRole('button', { name: 'Take over' }));
    const dialog = await screen.findByRole('dialog', { name: 'Take over this chat?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Take over' }));

    expect(
      await within(dialog).findByText('Another supervisor took this chat over first.'),
    ).toBeInTheDocument();
    expect(
      screen.queryByText('Only an admin or owner can take over a chat.'),
    ).not.toBeInTheDocument();
  });

  it('hides the control on an archived chat, even for an owner', () => {
    authState.agent = { role: 'owner' };
    renderPanel({ ...baseChat(), active: false });

    expect(screen.queryByRole('button', { name: 'Take over' })).not.toBeInTheDocument();
  });
});
