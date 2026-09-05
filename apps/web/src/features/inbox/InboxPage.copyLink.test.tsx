/**
 * Copying a conversation's permanent link (FR-MOD-02.6).
 *
 * The header's "Copy link" control existed with no test pinning what it
 * writes to the clipboard — the audit's finding was exactly that gap: not
 * that *something* gets copied, but that it is the app's own `?chat=` deep
 * link (the parameter `InboxPage` already consumes on load, see the effect
 * around `searchParams.get('chat')`) for the conversation actually open,
 * made absolute so it survives a paste into another tab or a ticket.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as AuthStore from '../../lib/auth-store.js';

const { api } = vi.hoisted(() => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn(), put: vi.fn() },
}));

vi.mock('../../lib/auth-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof AuthStore>();
  return {
    ...actual,
    useApiClient: () => api,
    useAuth: (selector: (state: Record<string, unknown>) => unknown) =>
      selector({
        agent: { scopes: ['chats--access:rw'], account_id: 'me', routing_status: 'offline' },
        setRoutingStatus: vi.fn(),
      }),
  };
});

const { InboxPage } = await import('./InboxPage.js');

const CHAT_ID = 'CHAT-COPY-1';

function viewOf(url: string): string {
  return new URLSearchParams(url.slice(url.indexOf('?'))).get('view') ?? 'all';
}

/** One open conversation under "All"; every other view empty. */
function serveOneChat(): void {
  api.get.mockImplementation((url: string) => {
    if (url.startsWith('/chats?')) {
      const items =
        viewOf(url) === 'all'
          ? [
              {
                id: CHAT_ID,
                customer_id: 'cust-1',
                customer_name: 'Ada Visitor',
                active: true,
                created_at: '2026-09-05T10:00:00.000Z',
                thread_id: 'T1',
                assignee_id: null,
                queue_position: null,
                unread_count: 0,
                last_event: null,
                tags: [],
              },
            ]
          : [];
      return Promise.resolve({ items, total: items.length });
    }
    if (url === `/chats/${CHAT_ID}`) {
      return Promise.resolve({
        id: CHAT_ID,
        license_id: '1',
        customer_id: 'cust-1',
        active: true,
        created_at: '2026-09-05T10:00:00.000Z',
        access: { group_ids: [] },
        users: [],
        thread: {
          id: 'T1',
          chat_id: CHAT_ID,
          active: true,
          assignee_id: null,
          queue_position: null,
          summary: null,
          created_at: '2026-09-05T10:00:00.000Z',
          closed_at: null,
          tags: [],
        },
      });
    }
    return Promise.resolve({ items: [], total: 0 });
  });
}

function renderInbox(): ReturnType<typeof render> {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter initialEntries={['/app/inbox']}>
      <QueryClientProvider client={queryClient}>
        <InboxPage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  api.get.mockReset();
  api.post.mockReset();
  serveOneChat();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('copying the chat link (FR-MOD-02.6)', () => {
  it("writes the conversation's permanent deep link to the clipboard", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });

    renderInbox();

    const copy = await screen.findByRole('button', { name: 'Copy link' });
    await user.click(copy);

    // The route plus the open chat's id — a pasted link a colleague can open
    // cold, not a relative path that only means something inside this tab.
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/app/inbox?chat=${CHAT_ID}`);
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument();
  });
});
