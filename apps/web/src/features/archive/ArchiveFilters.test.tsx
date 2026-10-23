/**
 * The Archive's filter bar (AR-02 · tm 336.2), driven through the screen.
 *
 * What is pinned: a filtered address asks the server for exactly those filters and
 * a changed filter writes ids only to the address (FR-MOD-02.8); the date presets
 * and ‹ › count in the workspace's own day and stop at today; filters that
 * clash are named while the list is still asked for as written; a Team Member's
 * agent filter is "me"; no more than 20 tags can be chosen; and saved filters are
 * the person's own.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as AuthStore from '../../lib/auth-store.js';

const ME = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ADA = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const SPAM = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const BONUS = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

const { api, auth } = vi.hoisted(() => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), del: vi.fn() },
  auth: { scopes: ['chats--access:rw'] as string[], role: 'agent' },
}));

vi.mock('../../lib/auth-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof AuthStore>();
  return {
    ...actual,
    useApiClient: () => api,
    useAuth: (selector: (state: Record<string, unknown>) => unknown) =>
      selector({
        agent: {
          scopes: auth.scopes,
          account_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          role: auth.role,
          routing_status: 'offline',
        },
      }),
  };
});

const { ArchivePage } = await import('./ArchivePage.js');

const ROW = {
  thread_id: 'THREADONE1',
  chat_id: 'CHATDAYAAA',
  customer: { id: 'cust-1', name: 'Mira Kaya', username: 'mira' },
  started_at: '2026-10-20T09:00:00.000Z',
  ended_at: '2026-10-20T09:30:00.000Z',
  assignee: null,
  group_ids: [],
  tags: [],
  rating: null,
  handled_by: null,
  risk_flags: [],
  first_customer_message: 'first words',
  message_count: 4,
};

let listItems: unknown[] = [ROW];
let tagLibrary: Array<{ id: string; name: string }> = [];
let chatTimeout: Record<string, unknown> = {};

function serve(): void {
  api.get.mockImplementation((url: string) => {
    if (url.startsWith('/archive/conversations?')) {
      return Promise.resolve({ items: listItems, total: listItems.length, total_capped: false });
    }
    if (/^\/archive\/conversations\/[^/?]+$/.test(url)) {
      return Promise.resolve({ ...ROW, summary: null });
    }
    if (url === '/settings/tags') return Promise.resolve({ items: tagLibrary });
    if (url === '/settings/chat-timeout') return Promise.resolve(chatTimeout);
    if (url === '/groups') {
      return Promise.resolve({
        items: [
          { id: 3, name: 'Finance' },
          { id: 4, name: 'Support' },
        ],
      });
    }
    if (url === '/agents') {
      return Promise.resolve({
        items: [
          { id: ME, name: 'Me Myself', routing_status: 'offline' },
          { id: ADA, name: 'Agent Ada', routing_status: 'offline' },
        ],
      });
    }
    return Promise.resolve({ items: [], total: 0 });
  });
}

let location = { pathname: '', search: '' };
function LocationProbe(): null {
  const current = useLocation();
  location = { pathname: current.pathname, search: current.search };
  return null;
}

function renderArchive(path = '/app/archive'): ReturnType<typeof render> {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter initialEntries={[path]}>
      <QueryClientProvider client={queryClient}>
        <ArchivePage />
        <LocationProbe />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

function listUrls(): string[] {
  return api.get.mock.calls
    .map(([url]) => url as string)
    .filter((url) => url.startsWith('/archive/conversations?'));
}

function lastList(): URLSearchParams {
  const urls = listUrls();
  return new URLSearchParams(urls[urls.length - 1]!.split('?')[1]);
}

beforeEach(() => {
  api.get.mockReset();
  auth.scopes = ['chats--access:rw'];
  auth.role = 'agent';
  listItems = [ROW];
  tagLibrary = [];
  chatTimeout = {};
  location = { pathname: '', search: '' };
  localStorage.clear();
  serve();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('The address and the request', () => {
  it('asks the server for exactly the filters an address holds, and shows them as chips — FR-MOD-02.8', async () => {
    tagLibrary = [{ id: SPAM, name: 'spam' }];
    renderArchive(
      `/app/archive?rating=bad&group_id=3&tag=${SPAM}&tag_mode=exclude&handled_by=ai&channel=whatsapp`,
    );
    await screen.findByRole('list', { name: 'Conversations' });

    const asked = lastList();
    expect(asked.get('rating')).toBe('bad');
    expect(asked.getAll('group_id')).toEqual(['3']);
    expect(asked.getAll('tag')).toEqual([SPAM]);
    expect(asked.get('tag_mode')).toBe('exclude');
    expect(asked.getAll('handled_by')).toEqual(['ai']);
    expect(asked.get('channel')).toBe('whatsapp');
    expect(asked.get('status')).toBe('closed');

    expect(screen.getByRole('button', { name: 'Rating: Bad' })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Team: Finance' })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Tags: Not spam' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Handled by: AI solved it' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Channel: WhatsApp' })).toBeInTheDocument();
  });

  it('puts only ids in the address when filters are picked, never a name — FR-MOD-02.8', async () => {
    const user = userEvent.setup();
    auth.role = 'team_lead';
    tagLibrary = [
      { id: SPAM, name: 'spam' },
      { id: BONUS, name: 'bonus' },
    ];
    renderArchive();
    await screen.findByRole('list', { name: 'Conversations' });

    await user.click(within(screen.getByRole('group', { name: 'Rating' })).getByLabelText('Bad'));
    await user.click(await screen.findByLabelText('Agent Ada'));
    await user.click(within(screen.getByRole('group', { name: 'Team' })).getByLabelText('Finance'));
    await user.click(
      await within(screen.getByRole('group', { name: 'Tags' })).findByLabelText('spam'),
    );

    const address = new URLSearchParams(location.search);
    expect(address.get('rating')).toBe('bad');
    expect(address.getAll('agent_id')).toEqual([ADA]);
    expect(address.getAll('group_id')).toEqual(['3']);
    expect(address.getAll('tag')).toEqual([SPAM]);
    expect(location.search).not.toMatch(/Ada|Finance|spam|@/);

    // The list is asked for again with the same words the address uses.
    await waitFor(() => expect(lastList().getAll('agent_id')).toEqual([ADA]));
    expect(lastList().get('rating')).toBe('bad');
  });

  it('ignores what an address says that is not an id, instead of sending it', async () => {
    renderArchive('/app/archive?agent_id=ada@example.com&tag=spam&group_id=abc&rating=great');
    await screen.findByRole('list', { name: 'Conversations' });
    const asked = lastList();
    expect(asked.has('agent_id')).toBe(false);
    expect(asked.has('tag')).toBe(false);
    expect(asked.has('group_id')).toBe(false);
    expect(asked.has('rating')).toBe(false);
  });

  it('keeps the filters when a conversation is opened, and the open conversation when they change', async () => {
    const user = userEvent.setup();
    renderArchive('/app/archive?rating=bad');
    const list = await screen.findByRole('list', { name: 'Conversations' });
    await user.click(within(list).getAllByRole('button')[0]!);
    expect(new URLSearchParams(location.search).get('c')).toBe('THREADONE1');
    expect(new URLSearchParams(location.search).get('rating')).toBe('bad');

    await user.click(within(screen.getByRole('group', { name: 'Rating' })).getByLabelText('Good'));
    expect(new URLSearchParams(location.search).get('c')).toBe('THREADONE1');
    expect(new URLSearchParams(location.search).get('rating')).toBe('good');
  });

  it('clears one filter from its chip and all of them together', async () => {
    const user = userEvent.setup();
    renderArchive(`/app/archive?rating=bad&group_id=3&c=THREADONE1&status=all`);
    await screen.findByRole('list', { name: 'Conversations' });

    await user.click(screen.getByRole('button', { name: 'Clear Rating filter' }));
    expect(new URLSearchParams(location.search).has('rating')).toBe(false);
    expect(new URLSearchParams(location.search).getAll('group_id')).toEqual(['3']);

    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(new URLSearchParams(location.search).toString()).toBe('c=THREADONE1&status=all');
    expect(screen.queryByRole('button', { name: 'Clear filters' })).toBeNull();
  });

  it('says nothing matches, and offers to clear, when a filtered list is empty', async () => {
    const user = userEvent.setup();
    listItems = [];
    renderArchive('/app/archive?rating=bad');
    expect(await screen.findByText('No conversations match these filters')).toBeInTheDocument();
    expect(screen.queryByText('No archive yet')).toBeNull();

    const clear = screen
      .getAllByRole('button', { name: 'Clear filters' })
      .find((button) => button.closest('[role="group"]') === null)!;
    await user.click(clear);
    expect(await screen.findByText('No archive yet')).toBeInTheDocument();
  });
});

describe('Dates in the workspace’s own day', () => {
  it('files 00:30 in Istanbul under the new day: "Today" is the 23rd while UTC is still the 22nd — FR-MOD-02.8', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-22T21:30:00Z'));
    const user = userEvent.setup();
    renderArchive();
    await screen.findByRole('list', { name: 'Conversations' });

    await user.click(screen.getByRole('button', { name: 'Today' }));
    expect(location.search).toBe('?date_from=2026-10-23&date_to=2026-10-23');
    await waitFor(() => expect(lastList().get('date_from')).toBe('2026-10-23'));
    expect(lastList().get('date_to')).toBe('2026-10-23');
    expect(screen.getByRole('button', { name: 'Date: Today' })).toBeInTheDocument();
  });

  it('counts the day in the zone and hour the workspace set, when the caller may read them', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    // 22:00 on the 22nd in New York, while UTC is already the 23rd.
    vi.setSystemTime(new Date('2026-10-23T02:00:00Z'));
    auth.scopes = ['chats--access:rw', 'access_rules:ro'];
    chatTimeout = { day_boundary_timezone: 'America/New_York', day_boundary_hour: 0 };
    const user = userEvent.setup();
    renderArchive();
    await screen.findByRole('list', { name: 'Conversations' });
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/settings/chat-timeout'));

    await user.click(screen.getByRole('button', { name: 'Yesterday' }));
    await waitFor(() => expect(location.search).toBe('?date_from=2026-10-21&date_to=2026-10-21'));
  });

  it('does not read the day boundary for a caller who may not', async () => {
    renderArchive();
    await screen.findByRole('list', { name: 'Conversations' });
    expect(api.get).not.toHaveBeenCalledWith('/settings/chat-timeout');
  });

  it('steps ‹ › by the range’s length and stops at today', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-23T10:00:00Z'));
    const user = userEvent.setup();
    renderArchive('/app/archive?date_from=2026-10-22&date_to=2026-10-22');
    await screen.findByRole('list', { name: 'Conversations' });

    expect(screen.getByRole('button', { name: 'Date: Yesterday' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Earlier' }));
    expect(location.search).toBe('?date_from=2026-10-21&date_to=2026-10-21');
    await user.click(screen.getByRole('button', { name: 'Later' }));
    await user.click(screen.getByRole('button', { name: 'Later' }));
    expect(location.search).toBe('?date_from=2026-10-23&date_to=2026-10-23');
    // On today there is no later.
    expect(screen.getByRole('button', { name: 'Later' })).toBeDisabled();

    // The calendar inputs do not offer a day past today either.
    expect(screen.getByLabelText('To')).toHaveAttribute('max', '2026-10-23');
  });

  it('shows no steps while no date is chosen', async () => {
    renderArchive();
    await screen.findByRole('list', { name: 'Conversations' });
    expect(screen.queryByRole('button', { name: 'Earlier' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Later' })).toBeNull();
  });
});

describe('Filters that clash', () => {
  it('names "untagged" with tags, and still asks for the list as written — FR-MOD-02.8', async () => {
    tagLibrary = [{ id: SPAM, name: 'spam' }];
    renderArchive(`/app/archive?untagged=true&tag=${SPAM}`);
    await screen.findByRole('list', { name: 'Conversations' });

    const warning = screen.getByText('These filters cannot all be true').closest('[role]')!;
    expect(
      within(warning as HTMLElement).getByText(/Only conversations with no tag/),
    ).toBeInTheDocument();
    expect(lastList().get('untagged')).toBe('true');
    expect(lastList().getAll('tag')).toEqual([SPAM]);
    // Nothing was silently dropped from the address.
    expect(location.search).toContain('untagged=true');
    expect(location.search).toContain(`tag=${SPAM}`);
  });

  it('names an agent together with "AI solved"', async () => {
    auth.role = 'team_lead';
    renderArchive(`/app/archive?agent_id=${ADA}&handled_by=ai`);
    await screen.findByRole('list', { name: 'Conversations' });
    expect(screen.getByText(/has no agent in it/)).toBeInTheDocument();
    expect(lastList().getAll('agent_id')).toEqual([ADA]);
    expect(lastList().getAll('handled_by')).toEqual(['ai']);
  });

  it('says why, and does not ask, when the dates run backwards', async () => {
    renderArchive('/app/archive?date_from=2026-10-20&date_to=2026-10-10');
    expect(await screen.findByText('Fix the dates to see the list')).toBeInTheDocument();
    expect(screen.getByText(/The first day is after the last day. Change/)).toBeInTheDocument();
    expect(listUrls()).toEqual([]);
    expect(location.search).toContain('date_from=2026-10-20');
  });

  it('warns about nothing when the filters agree', async () => {
    renderArchive(`/app/archive?untagged=true&handled_by=ai`);
    await screen.findByRole('list', { name: 'Conversations' });
    expect(screen.queryByText('These filters cannot all be true')).toBeNull();
  });
});

describe('Who can pick which agent', () => {
  it('offers a Team Member only "me", and never reads the roster', async () => {
    const user = userEvent.setup();
    auth.role = 'agent';
    renderArchive();
    await screen.findByRole('list', { name: 'Conversations' });

    const group = screen.getByRole('group', { name: 'Agent' });
    expect(within(group).getAllByRole('checkbox')).toHaveLength(1);
    await user.click(within(group).getByLabelText('Me'));
    expect(new URLSearchParams(location.search).getAll('agent_id')).toEqual([ME]);
    expect(screen.getByRole('button', { name: 'Agent: Me' })).toBeInTheDocument();
    expect(api.get).not.toHaveBeenCalledWith('/agents');
  });

  it('offers a Team Lead everyone', async () => {
    auth.role = 'team_lead';
    renderArchive();
    await screen.findByRole('list', { name: 'Conversations' });
    const group = screen.getByRole('group', { name: 'Agent' });
    expect(await within(group).findByLabelText('Agent Ada')).toBeInTheDocument();
    expect(within(group).getAllByRole('checkbox')).toHaveLength(2);
  });
});

describe('Tags', () => {
  const MANY = Array.from({ length: 22 }, (_, i) => ({
    id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    name: `tag-${String(i).padStart(2, '0')}`,
  }));

  it('lets no more than 20 be chosen — FR-MOD-02.8', async () => {
    const user = userEvent.setup();
    tagLibrary = MANY;
    renderArchive();
    await screen.findByRole('list', { name: 'Conversations' });
    const group = screen.getByRole('group', { name: 'Tags' });

    for (const tag of MANY.slice(0, 20)) {
      await user.click(await within(group).findByLabelText(tag.name));
    }
    expect(new URLSearchParams(location.search).getAll('tag')).toHaveLength(20);
    expect(within(group).getByLabelText('tag-20')).toBeDisabled();
    expect(within(group).getByLabelText('tag-21')).toBeDisabled();
    expect(within(group).getByText('You can choose at most 20 tags.')).toBeInTheDocument();
    // A chosen one can still be taken off, which frees a place.
    await user.click(within(group).getByLabelText('tag-00'));
    expect(within(group).getByLabelText('tag-20')).toBeEnabled();
  });

  it('writes the match mode and "untagged" to the address', async () => {
    const user = userEvent.setup();
    tagLibrary = [{ id: SPAM, name: 'spam' }];
    renderArchive();
    await screen.findByRole('list', { name: 'Conversations' });

    await user.click(screen.getByLabelText('None of them (exclude)'));
    expect(location.search).toBe('?tag_mode=exclude');
    await user.click(screen.getByLabelText('Only conversations with no tag'));
    expect(new URLSearchParams(location.search).get('untagged')).toBe('true');
    expect(screen.getByRole('button', { name: 'Tags: Untagged' })).toBeInTheDocument();
  });
});

describe('Saved filters', () => {
  it('are the person’s own, kept without dates and without names, and applied over the dates on screen', async () => {
    const user = userEvent.setup();
    renderArchive('/app/archive?rating=bad&group_id=3&date_from=2026-10-01&date_to=2026-10-02');
    await screen.findByRole('list', { name: 'Conversations' });

    await user.type(screen.getByLabelText('Name for the current filters'), 'Bad, Finance');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    const stored = localStorage.getItem(`siyahtus.archive.saved-filters.${ME}`)!;
    expect(JSON.parse(stored)).toEqual([
      expect.objectContaining({ name: 'Bad, Finance', query: 'group_id=3&rating=bad' }),
    ]);
    expect(stored).not.toContain('date_');

    await user.click(screen.getByRole('button', { name: 'Clear Rating filter' }));
    await user.click(screen.getByRole('button', { name: 'Bad, Finance' }));
    const address = new URLSearchParams(location.search);
    expect(address.get('rating')).toBe('bad');
    expect(address.getAll('group_id')).toEqual(['3']);
    // The dates on screen stay.
    expect(address.get('date_from')).toBe('2026-10-01');
    expect(address.get('date_to')).toBe('2026-10-02');
  });

  it('are not shared with another account in the same browser, and can be deleted', async () => {
    const user = userEvent.setup();
    localStorage.setItem(
      'siyahtus.archive.saved-filters.someone-else',
      JSON.stringify([{ id: 'x', name: 'Not mine', query: 'rating=bad' }]),
    );
    localStorage.setItem(
      `siyahtus.archive.saved-filters.${ME}`,
      JSON.stringify([{ id: 'y', name: 'Mine', query: 'rating=good' }]),
    );
    renderArchive();
    await screen.findByRole('list', { name: 'Conversations' });

    expect(screen.queryByText('Not mine')).toBeNull();
    expect(screen.getByRole('button', { name: 'Mine' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Delete saved filter Mine' }));
    expect(screen.queryByRole('button', { name: 'Mine' })).toBeNull();
    expect(JSON.parse(localStorage.getItem(`siyahtus.archive.saved-filters.${ME}`)!)).toEqual([]);
  });

  it('cannot be saved without a filter, or twice under one name', async () => {
    const user = userEvent.setup();
    renderArchive('/app/archive?rating=bad');
    await screen.findByRole('list', { name: 'Conversations' });
    const name = screen.getByLabelText('Name for the current filters');
    const save = screen.getByRole('button', { name: 'Save' });

    expect(save).toBeDisabled();
    await user.type(name, 'Once');
    expect(save).toBeEnabled();
    await user.click(save);
    await user.type(name, 'once');
    expect(save).toBeDisabled();
    expect(screen.getByText('A saved filter already has this name.')).toBeInTheDocument();
  });
});
