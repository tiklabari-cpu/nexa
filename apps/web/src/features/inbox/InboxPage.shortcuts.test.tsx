/**
 * Keyboard shortcuts in the inbox (IN-08): Alt+↓ / Alt+↑ walk the list on
 * screen and leave the cursor in the opened chat's composer, stop at either
 * end, stay silent behind a dialog and while AltGr is down, and the composer's
 * own shortcuts (Copilot, attach) work from the reply field.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as AuthStore from '../../lib/auth-store.js';

const { api } = vi.hoisted(() => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), del: vi.fn() },
}));

vi.mock('../../lib/auth-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof AuthStore>();
  return {
    ...actual,
    useApiClient: () => api,
    useAuth: (selector: (state: Record<string, unknown>) => unknown) =>
      selector({
        agent: { scopes: ['chats--all:rw'], account_id: 'me', routing_status: 'accepting_chats' },
        setRoutingStatus: vi.fn(),
      }),
  };
});

const { InboxPage } = await import('./InboxPage.js');
const { ShortcutsHost } = await import('../../components/ShortcutsModal.js');

function row(id: string, name: string) {
  return {
    id,
    customer_id: `c-${id}`,
    customer_name: name,
    active: true,
    created_at: '2026-10-24T10:00:00.000Z',
    thread_id: `t-${id}`,
    assignee_id: 'me',
    queue_position: null,
    waiting_since: null,
    queued_at: null,
    unread_count: 0,
    last_event: null,
    tags: [],
  };
}

beforeEach(() => {
  api.get.mockReset();
  localStorage.clear();
  api.get.mockImplementation((url: string) => {
    if (url.startsWith('/chats?')) {
      return Promise.resolve({
        items: [
          row('one', 'First player'),
          row('two', 'Second player'),
          row('three', 'Third player'),
        ],
        total: 3,
      });
    }
    const opened = /^\/chats\/([^/?]+)$/.exec(url);
    if (opened) {
      return Promise.resolve({
        id: opened[1],
        license_id: '1',
        customer_id: 'c',
        active: true,
        created_at: '2026-10-24T10:00:00.000Z',
        access: { group_ids: [] },
        users: [],
        thread: null,
        local_day: null,
        connections: [],
      });
    }
    return Promise.resolve({ items: [], total: 0 });
  });
});

function renderInbox() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <MemoryRouter initialEntries={['/app/inbox']}>
      <QueryClientProvider client={queryClient}>
        <ShortcutsHost />
        <InboxPage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
  return screen.getByRole('region', { name: 'Conversations' });
}

const rowOf = async (list: HTMLElement, name: string) =>
  (await within(list).findByText(name)).closest('button')!;

const composer = () => document.querySelector<HTMLTextAreaElement>('textarea[data-composer-input]');

describe('chat-to-chat keys in the inbox (IN-08)', () => {
  it('Alt+↓ opens the next chat and leaves the cursor in its composer, Alt+↑ goes back', async () => {
    const user = userEvent.setup();
    const list = renderInbox();
    const first = await rowOf(list, 'First player');
    await waitFor(() => expect(first).toHaveAttribute('aria-current', 'true'));

    await user.keyboard('{Alt>}{ArrowDown}{/Alt}');
    const second = await rowOf(list, 'Second player');
    await waitFor(() => expect(second).toHaveAttribute('aria-current', 'true'));
    await waitFor(() => expect(composer()?.dataset['chatId']).toBe('two'));
    await waitFor(() => expect(document.activeElement).toBe(composer()));

    // The keys work from inside the reply field too — that is where focus is now.
    await user.keyboard('{Alt>}{ArrowDown}{/Alt}');
    await waitFor(async () =>
      expect(await rowOf(list, 'Third player')).toHaveAttribute('aria-current', 'true'),
    );
    await waitFor(() => expect(composer()?.dataset['chatId']).toBe('three'));
    await waitFor(() => expect(document.activeElement).toBe(composer()));

    await user.keyboard('{Alt>}{ArrowUp}{/Alt}');
    await waitFor(async () =>
      expect(await rowOf(list, 'Second player')).toHaveAttribute('aria-current', 'true'),
    );
  });

  it('stops at the last chat and keeps the cursor in its composer', async () => {
    const user = userEvent.setup();
    const list = renderInbox();
    await user.click(await rowOf(list, 'Third player'));
    await waitFor(() => expect(composer()?.dataset['chatId']).toBe('three'));

    await user.keyboard('{Alt>}{ArrowDown}{/Alt}');
    expect(await rowOf(list, 'Third player')).toHaveAttribute('aria-current', 'true');
    await waitFor(() => expect(document.activeElement).toBe(composer()));
  });

  it('does nothing while a dialog is open (IN-08)', async () => {
    const user = userEvent.setup();
    const list = renderInbox();
    const first = await rowOf(list, 'First player');
    await waitFor(() => expect(first).toHaveAttribute('aria-current', 'true'));

    await user.keyboard('?');
    await screen.findByRole('dialog', { name: 'Keyboard shortcuts' });
    await user.keyboard('{Alt>}{ArrowDown}{/Alt}');

    expect(first).toHaveAttribute('aria-current', 'true');
    expect(await rowOf(list, 'Second player')).not.toHaveAttribute('aria-current');
  });

  it('ignores a chord made with AltGr (IN-08)', async () => {
    const list = renderInbox();
    const first = await rowOf(list, 'First player');
    await waitFor(() => expect(first).toHaveAttribute('aria-current', 'true'));

    const altGr = new KeyboardEvent('keydown', {
      key: 'ArrowDown',
      code: 'ArrowDown',
      ctrlKey: true,
      altKey: true,
      bubbles: true,
      cancelable: true,
    });
    altGr.getModifierState = (name: string) => name === 'AltGraph';
    document.body.dispatchEvent(altGr);

    expect(altGr.defaultPrevented).toBe(false);
    expect(first).toHaveAttribute('aria-current', 'true');
  });

  it('typing "@" with AltGr+Q in the reply field writes it and runs nothing (IN-08)', async () => {
    const user = userEvent.setup();
    renderInbox();
    await waitFor(() => expect(composer()).not.toBeNull());
    const field = composer()!;
    await user.click(field);

    const altGr = new KeyboardEvent('keydown', {
      key: '@',
      code: 'KeyQ',
      ctrlKey: true,
      altKey: true,
      bubbles: true,
      cancelable: true,
    });
    altGr.getModifierState = (name: string) => name === 'AltGraph';
    field.dispatchEvent(altGr);
    expect(altGr.defaultPrevented).toBe(false);

    await user.type(field, '@');
    expect(field).toHaveValue('@');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('Alt+Shift+C shows Copilot from the reply field and a second press hides it', async () => {
    const user = userEvent.setup();
    renderInbox();
    await waitFor(() => expect(composer()).not.toBeNull());
    await user.click(composer()!);

    expect(localStorage.getItem('siyahtus.inbox.right-panel-tab')).toBeNull();
    fireEvent.keyDown(composer()!, { key: 'C', code: 'KeyC', altKey: true, shiftKey: true });
    await waitFor(() =>
      expect(localStorage.getItem('siyahtus.inbox.right-panel-tab')).toBe('copilot'),
    );
    fireEvent.keyDown(composer()!, { key: 'C', code: 'KeyC', altKey: true, shiftKey: true });
    await waitFor(() =>
      expect(localStorage.getItem('siyahtus.inbox.right-panel-tab')).toBe('details'),
    );
  });

  it('Alt+Shift+U opens the file picker from the reply field', async () => {
    const user = userEvent.setup();
    renderInbox();
    await waitFor(() => expect(composer()).not.toBeNull());
    await user.click(composer()!);
    const picker = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    const click = vi.spyOn(picker, 'click');

    fireEvent.keyDown(composer()!, { key: 'U', code: 'KeyU', altKey: true, shiftKey: true });
    expect(click).toHaveBeenCalledTimes(1);
  });

  it('Alt+Shift+T opens the tag menu from the reply field', async () => {
    const user = userEvent.setup();
    renderInbox();
    await waitFor(() => expect(composer()).not.toBeNull());
    await user.click(composer()!);

    fireEvent.keyDown(composer()!, { key: 'T', code: 'KeyT', altKey: true, shiftKey: true });
    const menu = screen.getByLabelText('Chat tags').closest('details');
    expect(menu).not.toBeNull();
    expect(menu).toHaveAttribute('open');
  });
});
