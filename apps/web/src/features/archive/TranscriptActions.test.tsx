/**
 * The archive's transcript actions (AR-04 · tm 338).
 *
 * What is pinned: who sees which action (the matrix's `transcripts.export`, and
 * the member who had the connection below it); the download asks for the copy
 * chosen; the print view is the shell-less address; the email sends nothing
 * but the copy for the player's registered address, the typed address
 * otherwise, and shows the server's refusal in words.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ArchiveConversationDetail } from '@siyahtus/types';
import { ApiClientError } from '../../lib/api-client.js';
import type * as AuthStore from '../../lib/auth-store.js';

const { api, auth } = vi.hoisted(() => ({
  api: { post: vi.fn(), getFile: vi.fn() },
  auth: { capabilities: {} as Record<string, string> },
}));

vi.mock('../../lib/auth-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof AuthStore>();
  return {
    ...actual,
    useApiClient: () => api,
    useAuth: (selector: (state: Record<string, unknown>) => unknown) =>
      selector({ agent: { scopes: [], capabilities: auth.capabilities, account_id: 'me' } }),
  };
});

const { TranscriptActions } = await import('./TranscriptActions.js');

const DAY = 'DAYAAAAAAA';
const CONNECTION = 'CONNONE111';

function detail(assignee: string | null): ArchiveConversationDetail {
  return {
    thread_id: CONNECTION,
    chat_id: DAY,
    customer: { id: 'c1', name: 'Mira Kaya', username: null },
    started_at: '2026-10-29T08:00:00.000Z',
    ended_at: '2026-10-29T08:30:00.000Z',
    assignee: assignee === null ? null : { id: assignee, name: 'Ada' },
    group_ids: [],
    tags: [],
    rating: null,
    handled_by: null,
    risk_flags: [],
    first_customer_message: 'Hello',
    message_count: 3,
    summary: null,
  } as ArchiveConversationDetail;
}

function Where(): JSX.Element {
  const location = useLocation();
  return <output data-testid="where">{`${location.pathname}${location.search}`}</output>;
}

function show(row: ArchiveConversationDetail): void {
  render(
    <MemoryRouter initialEntries={['/app/archive']}>
      <TranscriptActions detail={row} />
      <Where />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  api.post.mockResolvedValue({ accepted: true });
  api.getFile.mockResolvedValue({ blob: new Blob(['x']), filename: 'file.txt' });
  URL.createObjectURL = vi.fn(() => 'blob:x');
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  vi.clearAllMocks();
  auth.capabilities = {};
});

describe('TranscriptActions', () => {
  it('offers an Ekip Üyesi only the player email, and only on their own connection (AR-04-S1)', () => {
    auth.capabilities = { 'transcripts.export': 'none' };
    const { unmount } = render(
      <MemoryRouter>
        <TranscriptActions detail={detail('someone-else')} />
      </MemoryRouter>,
    );
    expect(screen.queryByRole('button', { name: /email/i })).toBeNull();
    unmount();

    show(detail('me'));
    expect(screen.getByRole('button', { name: 'Email transcript' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Download (TXT)' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Print / PDF' })).toBeNull();
  });

  it('downloads the copy chosen, and opens the print view at the shell-less address', async () => {
    auth.capabilities = { 'transcripts.export': 'all' };
    show(detail(null));

    await userEvent.click(screen.getByRole('button', { name: 'Download (TXT)' }));
    await userEvent.click(screen.getByRole('radio', { name: /Internal copy/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Download' }));
    await waitFor(() =>
      expect(api.getFile).toHaveBeenCalledWith(
        `/chats/${DAY}/threads/${CONNECTION}/transcript?format=txt&audience=internal`,
      ),
    );

    await userEvent.click(screen.getByRole('button', { name: 'Print / PDF' }));
    await userEvent.click(screen.getByRole('button', { name: 'Open print view' }));
    expect(screen.getByTestId('where')).toHaveTextContent(
      `/app/archive/${DAY}/print?thread=${CONNECTION}&copy=customer`,
    );
  });

  it("emails the player's registered address with no address in the body, or the one typed", async () => {
    auth.capabilities = { 'transcripts.export': 'all' };
    show(detail(null));
    const path = `/chats/${DAY}/threads/${CONNECTION}/transcript/email`;

    await userEvent.click(screen.getByRole('button', { name: 'Email transcript' }));
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith(path, {}));
    expect(await screen.findByText('The transcript is on its way.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));

    await userEvent.click(screen.getByRole('button', { name: 'Email transcript' }));
    await userEvent.click(screen.getByRole('radio', { name: 'Another address' }));
    await userEvent.type(screen.getByLabelText('Email address'), 'finance@sirket.com');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() =>
      expect(api.post).toHaveBeenLastCalledWith(path, {
        to: 'finance@sirket.com',
        audience: 'customer',
      }),
    );
  });

  it('says why an address was refused, and never offers another address below the row', async () => {
    auth.capabilities = { 'transcripts.export': 'all' };
    api.post.mockRejectedValueOnce(
      new ApiClientError({
        type: 'recipient_not_allowed',
        status: 403,
        message: 'x',
        requestId: 'r',
      }),
    );
    show(detail(null));
    await userEvent.click(screen.getByRole('button', { name: 'Email transcript' }));
    await userEvent.click(screen.getByRole('radio', { name: 'Another address' }));
    await userEvent.type(screen.getByLabelText('Email address'), 'x@elsewhere.test');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/allowed domains/);
  });

  it('keeps a member to the player address in the dialog', async () => {
    auth.capabilities = { 'transcripts.export': 'none' };
    show(detail('me'));
    await userEvent.click(screen.getByRole('button', { name: 'Email transcript' }));
    expect(screen.queryByRole('radio', { name: 'Another address' })).toBeNull();
    expect(
      screen.getByText("Your role can email a transcript only to the player's own address."),
    ).toBeInTheDocument();
  });
});
