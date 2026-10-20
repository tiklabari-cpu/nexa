/**
 * Handing a conversation to a team from the Details panel (IN-04 · tm 306).
 *
 * The server could always take a team (`group_id`), but the assignee menu
 * only ever sent a person. What is tested: the menu's two sections and the
 * "Finance · 2 online" line; the dialog the Team section opens (the note,
 * required for Responsible Gambling and Complaints); the notice for "someone
 * has it" and "it waits in the queue"; that a hand-off out of the caller's
 * sight is never followed by a read of the chat (it would be a 404); and the
 * refusals, each in its own sentence.
 */
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { ReactElement } from 'react';
import { ApiClientError } from '../../lib/api-client.js';
import { resetLocale, setLocale } from '../../test/i18n.js';
import { DetailsPanel } from './DetailsPanel.js';
import type { TransferNotice } from './transfer.js';
import type { ChatDetail, ChatTransferResult } from './types.js';

const { api, authState } = vi.hoisted(() => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
  authState: { agent: null as { role: string; scopes: string[] } | null },
}));

vi.mock('../../lib/auth-store.js', () => ({
  useApiClient: () => api,
  useAuth: (selector: (state: typeof authState) => unknown) => selector(authState),
}));

const CHAT_ID = 'TJ1H8CFKRV';

const ROSTER = [{ id: 'agent-9', name: 'Priya', routing_status: 'accepting_chats' }];

const TEAMS = [
  {
    id: 7,
    name: 'Finans',
    topic_role: 'finance',
    accepting_count: 2,
    agents: [{ agent_id: 'a1' }, { agent_id: 'a2' }, { agent_id: 'a3' }],
  },
  {
    id: 8,
    name: 'Sorumlu Oyun',
    topic_role: 'responsible_gambling',
    accepting_count: 0,
    agents: [{ agent_id: 'a4' }],
  },
  { id: 9, name: 'Boş Ekip', topic_role: null, accepting_count: 0, agents: [] },
];

function chatWith(assigneeId: string | null): ChatDetail {
  return {
    id: CHAT_ID,
    license_id: '1000003',
    customer_id: 'cust-1',
    active: true,
    created_at: '2026-07-20T10:00:00.000Z',
    access: { group_ids: [] },
    users: [],
    thread: {
      id: 'TH1',
      chat_id: CHAT_ID,
      active: true,
      assignee_id: assigneeId,
      queue_position: null,
      summary: null,
      created_at: '2026-07-20T10:00:00.000Z',
      closed_at: null,
      tags: [],
    },
  };
}

function answer(outcome: ChatTransferResult['outcome'], visible = true): ChatTransferResult {
  return { ...chatWith(outcome === 'assigned' ? 'a1' : null), outcome, visible_to_caller: visible };
}

const onTransferred = vi.fn<(outcome: { notice: TransferNotice; left: boolean }) => void>();

function Harness(): ReactElement | null {
  const chat = useQuery({
    queryKey: ['chat', CHAT_ID],
    queryFn: (): Promise<ChatDetail> => api.get(`/chats/${CHAT_ID}`),
  });
  if (!chat.data) return null;
  return <DetailsPanel chat={chat.data} chatId={CHAT_ID} onTransferred={onTransferred} />;
}

function renderPanel() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <Harness />
    </QueryClientProvider>,
  );
}

const chatReads = () =>
  (api.get as Mock).mock.calls.filter(([path]) => path === `/chats/${CHAT_ID}`).length;

/** Open the assignee menu and wait for its team section. */
async function openMenu(trigger = 'Change assignee', team = /Finans/): Promise<void> {
  fireEvent.click(await screen.findByRole('button', { name: trigger }));
  await screen.findByRole('button', { name: team });
}

/** Pick a team in the menu: the dialog opens with it chosen. */
async function pickTeam(name: RegExp): Promise<HTMLElement> {
  await openMenu();
  fireEvent.click(screen.getByRole('button', { name }));
  return screen.findByRole('dialog');
}

beforeEach(() => {
  for (const fn of Object.values(api)) (fn as Mock).mockReset();
  onTransferred.mockReset();
  api.get.mockImplementation((path: string) => {
    if (path === '/agents') return Promise.resolve({ items: ROSTER });
    if (path === '/groups') return Promise.resolve({ items: TEAMS });
    if (path.startsWith('/chats/')) return Promise.resolve(chatWith('agent-me'));
    return Promise.resolve({ items: [] });
  });
  authState.agent = { role: 'agent', scopes: ['chats--access:rw', 'agents--my:rw'] };
});

afterEach(() => resetLocale());

describe('DetailsPanel — hand-off to a team (FR-MOD-02.4.1–.6)', () => {
  it('lists teammates and teams in two sections, each team with who is online', async () => {
    renderPanel();
    await openMenu();

    expect(screen.getByText('Teammate')).toBeInTheDocument();
    expect(screen.getByText('Team')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Finans\s*2 online/ })).toBeEnabled();
    // A team nobody belongs to would hold the chat for nobody.
    expect(screen.getByRole('button', { name: /Boş Ekip\s*No members/ })).toBeDisabled();
  });

  it('hands the chat to the picked team, and says someone has it', async () => {
    api.post.mockResolvedValue(answer('assigned'));
    renderPanel();
    const dialog = await pickTeam(/Finans/);

    expect(within(dialog).getByRole('radio', { name: /Finans/ })).toBeChecked();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Transfer' }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(`/chats/${CHAT_ID}/transfer`, { group_id: 7 }),
    );
    await waitFor(() =>
      expect(onTransferred).toHaveBeenCalledWith({
        notice: { key: 'inbox.transfer.notice.team', params: { team: 'Finans' }, tone: 'success' },
        left: false,
      }),
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('says the chat waits in the team’s queue when nobody there was free', async () => {
    api.post.mockResolvedValue(answer('queued'));
    renderPanel();
    const dialog = await pickTeam(/Finans/);
    fireEvent.change(within(dialog).getByLabelText('Note (optional)'), {
      target: { value: '  IBAN doğrulandı  ' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Transfer' }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(`/chats/${CHAT_ID}/transfer`, {
        group_id: 7,
        note: 'IBAN doğrulandı',
      }),
    );
    await waitFor(() =>
      expect(onTransferred).toHaveBeenCalledWith({
        notice: {
          key: 'inbox.transfer.notice.queued',
          params: { team: 'Finans' },
          tone: 'warning',
        },
        left: false,
      }),
    );
  });

  it('asks for a note before a hand-off to Responsible Gambling, and warns nobody is online', async () => {
    api.post.mockResolvedValue(answer('queued'));
    renderPanel();
    const dialog = await pickTeam(/Sorumlu Oyun/);

    expect(
      within(dialog).getByText(/Nobody in Sorumlu Oyun is online right now/),
    ).toBeInTheDocument();
    const submit = within(dialog).getByRole('button', { name: 'Transfer' });
    expect(submit).toBeDisabled();

    const note = within(dialog).getByLabelText('Note (required)');
    fireEvent.change(note, { target: { value: '   ' } });
    expect(submit).toBeDisabled();
    fireEvent.change(note, { target: { value: 'Kendini sınırlamak istiyor.' } });
    expect(submit).toBeEnabled();
    fireEvent.click(submit);

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(`/chats/${CHAT_ID}/transfer`, {
        group_id: 8,
        note: 'Kendini sınırlamak istiyor.',
      }),
    );
  });

  it('does not read the chat again once the hand-off took it out of the caller’s sight', async () => {
    api.post.mockResolvedValue(answer('assigned', false));
    renderPanel();
    const dialog = await pickTeam(/Finans/);
    const before = chatReads();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Transfer' }));

    await waitFor(() =>
      expect(onTransferred).toHaveBeenCalledWith(expect.objectContaining({ left: true })),
    );
    // A read now would be refused (404) — the panel would show an error.
    expect(chatReads()).toBe(before);
  });

  it.each([
    ['group_not_found', 404, 'That team no longer exists.'],
    ['chat_inactive', 409, 'The chat has closed; it can no longer be transferred.'],
    ['group_unavailable', 409, 'That team has no members.'],
    ['validation', 400, 'Write a note to hand the chat to this team.'],
  ] as const)('words the refusal %s in its own sentence', async (type, status, sentence) => {
    api.post.mockRejectedValue(
      new ApiClientError({ type, status, message: 'refused', requestId: 'req-1' }),
    );
    renderPanel();
    const dialog = await pickTeam(/Finans/);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Transfer' }));

    expect(await within(dialog).findByText(sentence)).toBeInTheDocument();
    expect(onTransferred).not.toHaveBeenCalled();
  });

  it('speaks Turkish in a Turkish console', async () => {
    setLocale('tr');
    renderPanel();
    await openMenu('Atananı değiştir');

    expect(screen.getByText('Ekip arkadaşı')).toBeInTheDocument();
    expect(screen.getByText('Ekip')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Finans\s*2 çevrimiçi/ })).toBeInTheDocument();
  });
});
