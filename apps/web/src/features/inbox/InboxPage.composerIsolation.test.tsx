/**
 * The composer belongs to one conversation (tm 277.1, IN-01).
 *
 * `InboxPage` renders a single `Composer` for whichever chat is open, and that
 * component keeps the text, the attachment and the reply/note mode in its own
 * state. Without a `key` tied to the open chat, moving to a conversation whose
 * detail is already cached reused the same instance: what the agent wrote to A
 * was waiting in B's box, one Enter away from B. A first visit to a chat hid
 * it — the detail query has no placeholder, so the composer unmounted while
 * it loaded — which is why both tests here open B once before writing to A.
 *
 * `apps/e2e/tests/inbox-draft.spec.ts` walks the same path in a browser.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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

// The upload's own request/PUT pair is `uploadAttachment.test.ts`'s subject;
// here only the attachment landing in the composer matters.
vi.mock('./uploadAttachment.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  uploadAttachment: (_api: unknown, file: File) =>
    Promise.resolve({ fileUrl: `/files/${file.name}`, contentType: file.type, name: file.name }),
}));

const { InboxPage } = await import('./InboxPage.js');

const CHATS = [
  { id: 'CHAT-A', customer: 'Ada Player' },
  { id: 'CHAT-B', customer: 'Bo Player' },
] as const;

function viewOf(url: string): string {
  return new URLSearchParams(url.slice(url.indexOf('?'))).get('view') ?? 'all';
}

function detailOf(id: string): Record<string, unknown> {
  return {
    id,
    license_id: '1',
    customer_id: `cust-${id}`,
    active: true,
    created_at: '2026-10-14T10:00:00.000Z',
    access: { group_ids: [] },
    users: [],
    thread: {
      id: `T-${id}`,
      chat_id: id,
      active: true,
      assignee_id: 'me',
      queue_position: null,
      summary: null,
      created_at: '2026-10-14T10:00:00.000Z',
      closed_at: null,
      tags: [],
    },
  };
}

/** Two open conversations under "All"; every other view empty. */
function serveTwoChats(): void {
  api.get.mockImplementation((url: string) => {
    if (url.startsWith('/chats?')) {
      const items =
        viewOf(url) === 'all'
          ? CHATS.map(({ id, customer }) => ({
              id,
              customer_id: `cust-${id}`,
              customer_name: customer,
              active: true,
              created_at: '2026-10-14T10:00:00.000Z',
              thread_id: `T-${id}`,
              assignee_id: 'me',
              queue_position: null,
              unread_count: 0,
              last_event: null,
              tags: [],
            }))
          : [];
      return Promise.resolve({ items, total: items.length });
    }
    const chat = CHATS.find(({ id }) => url === `/chats/${id}`);
    if (chat) return Promise.resolve(detailOf(chat.id));
    if (url === '/uploads-policy') return Promise.resolve({ file_sharing_enabled: true });
    return Promise.resolve({ items: [], total: 0 });
  });
}

function renderInbox(): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <MemoryRouter initialEntries={['/app/inbox']}>
      <QueryClientProvider client={queryClient}>
        <InboxPage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

/** Open a conversation from the list and wait for its composer to be live. */
async function open(user: ReturnType<typeof userEvent.setup>, customer: string): Promise<void> {
  const row = await screen.findByRole('button', { name: new RegExp(customer) });
  await user.click(row);
  expect(row).toHaveAttribute('aria-current', 'true');
  await screen.findByRole('radio', { name: 'Reply' });
}

function eventPostsTo(chatId: string): unknown[][] {
  return api.post.mock.calls.filter(([url]) => url === `/chats/${chatId}/events`);
}

beforeEach(() => {
  api.get.mockReset();
  api.post.mockReset();
  api.post.mockResolvedValue({});
  serveTwoChats();
});

describe('the composer across conversations (tm 277.1)', () => {
  it("leaves A's text, attachment and note mode behind when the agent moves to B", async () => {
    const user = userEvent.setup();
    renderInbox();

    await open(user, 'Bo Player');
    await open(user, 'Ada Player');
    await user.click(screen.getByRole('radio', { name: 'Internal note' }));
    await user.type(screen.getByRole('textbox', { name: 'Internal note' }), 'Only for Ada');
    await user.upload(
      document.querySelector<HTMLInputElement>('input[type="file"]')!,
      new File(['%PDF'], 'receipt.pdf', { type: 'application/pdf' }),
    );
    expect(await screen.findByTestId('composer-attachment')).toHaveTextContent('receipt.pdf');

    await open(user, 'Bo Player');

    expect(screen.getByRole('textbox', { name: 'Reply to the customer' })).toHaveValue('');
    expect(screen.getByRole('radio', { name: 'Reply' })).toBeChecked();
    expect(screen.queryByTestId('composer-attachment')).not.toBeInTheDocument();
  });

  it('sends nothing to B when the agent presses Enter in the box they just left A in', async () => {
    const user = userEvent.setup();
    renderInbox();

    await open(user, 'Bo Player');
    await open(user, 'Ada Player');
    await user.type(
      screen.getByRole('textbox', { name: 'Reply to the customer' }),
      'Your withdrawal is on hold',
    );

    await open(user, 'Bo Player');
    await user.type(screen.getByRole('textbox', { name: 'Reply to the customer' }), '{Enter}');

    expect(eventPostsTo('CHAT-B')).toEqual([]);
    expect(eventPostsTo('CHAT-A')).toEqual([]);

    // The probe can see a send: B's own words do go to B, and only them.
    await user.type(screen.getByRole('textbox', { name: 'Reply to the customer' }), 'Hi Bo{Enter}');
    expect(eventPostsTo('CHAT-B')).toHaveLength(1);
    expect(JSON.stringify(eventPostsTo('CHAT-B')[0])).toContain('Hi Bo');
    expect(JSON.stringify(eventPostsTo('CHAT-B')[0])).not.toContain('withdrawal');
  });
});
