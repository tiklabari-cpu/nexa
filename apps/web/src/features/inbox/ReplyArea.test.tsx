/**
 * The reply area when the conversation is not the caller's (tm 475.4 · owner
 * decision 2026-11-06): only the agent the open connection is assigned to
 * answers the customer, so for anyone else Reply does not send — the words stay
 * in the box — while an internal note still does, and the strip above the
 * composer says why and offers "Take chat" (`POST /claim`) or "Take over".
 *
 * Driven through the real chain `InboxPage` wires: the chat read (`useChat`)
 * feeds `ReplyArea`, the real `ApiClient` sits on one fetch stub, and the
 * server's two refusals — a Take someone else won, a reply the connection's
 * new assignee owns (`reply_requires_assignment`) — are genuine responses.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuth } from '../../lib/auth-store.js';
import { renderWithLocale, resetLocale } from '../../test/i18n.js';
import { ReplyArea } from './ReplyArea.js';
import { Transcript } from './Transcript.js';
import { useFailedSendStore, useFailedSends } from './failedSends.js';
import { useRetiredDraftStore } from './composerDrafts.js';
import { useTypingStore } from './typing.js';
import { applyPush, useChat } from './useInbox.js';
import type { ChatDetail } from './types.js';

const CHAT = 'CHAT1';
const ME = 'agent-me';
const SAM = 'agent-sam';

type Thread = NonNullable<ChatDetail['thread']>;

/** What the server holds — the chat read answers from it, the writes move it. */
let server: Thread;
/** How the next `POST /claim` answers: it takes the chat, or a colleague won. */
let claimWins: boolean;
let posts: Array<{ path: string; body: Record<string, unknown> }>;
/** The chat's teams (`access.group_ids`); I am a member of team 7 only. */
let chatTeams: number[];
let queryClient: QueryClient;

function chatRead(): ChatDetail {
  return {
    id: CHAT,
    license_id: 'L1',
    customer_id: 'cust-1',
    active: true,
    created_at: '2026-11-07T10:00:00Z',
    access: { group_ids: chatTeams },
    users: [],
    thread: { ...server },
  };
}

function json(status: number, body: unknown) {
  return {
    ok: status < 400,
    status,
    headers: { get: () => null },
    json: async () => body,
  };
}

function refusal(status: number, type: string, details?: Record<string, unknown>) {
  return json(status, {
    error: { type, message: 'The server wrote this for a log line.', request_id: 'r', details },
  });
}

function stubFetch(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const path = new URL(String(url), 'http://localhost').pathname.replace(/^\/api\/v1/, '');
      const method = init?.method ?? 'GET';
      if (method === 'POST') {
        const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
        posts.push({ path, body });
        if (path.endsWith(`/chats/${CHAT}/claim`)) {
          if (!claimWins) {
            server = { ...server, assignee_id: SAM, ai_mode: 'human' };
            return refusal(409, 'chat_claim_refused', { reason: 'claimed' });
          }
          server = { ...server, assignee_id: ME, ai_mode: 'human', queue_position: null };
          return json(200, chatRead());
        }
        if (path.endsWith(`/chats/${CHAT}/events`)) {
          if (body['recipients'] === 'all' && server.assignee_id !== ME) {
            return refusal(409, 'reply_requires_assignment', {
              reason: server.assignee_id ? 'assigned_to_other' : 'unassigned',
            });
          }
          return json(201, { id: `EV${posts.length}`, thread_id: server.id });
        }
      }
      if (path.endsWith(`/chats/${CHAT}`)) return json(200, chatRead());
      if (path.endsWith('/groups')) {
        return json(200, {
          items: [{ id: 7, name: 'Support', assignment_mode: 'auto', agents: [{ agent_id: ME }] }],
        });
      }
      if (path.endsWith('/agents')) {
        return json(200, {
          items: [{ id: SAM, name: 'Sam Rivera', routing_status: 'accepting_chats' }],
        });
      }
      return json(200, { items: [] });
    }),
  );
}

function signIn(takeover: 'none' | 'all' = 'none'): void {
  useAuth.setState({
    status: 'signed-in',
    accessToken: 'test-token',
    agent: {
      account_id: ME,
      email: 'priya@acme.localhost',
      name: 'Priya',
      role: 'agent',
      organization_id: 'o-1',
      license_id: 'L1',
      scopes: [],
      routing_status: 'accepting_chats',
      capabilities: { 'chats.takeover': takeover },
    },
  } as never);
}

function Harness(): ReactElement | null {
  const chat = useChat(CHAT);
  const failedSends = useFailedSends(CHAT);
  if (!chat.data) return null;
  return (
    <>
      <Transcript
        chatId={CHAT}
        events={[]}
        loading={false}
        currentAgentId={ME}
        failedSends={failedSends}
      />
      <ReplyArea chatId={CHAT} chat={chat.data} transcriptFailed={false} />
    </>
  );
}

async function setup(thread: Partial<Thread>, locale: 'en' | 'tr' = 'en'): Promise<void> {
  server = {
    id: 'T1',
    chat_id: CHAT,
    active: true,
    assignee_id: null,
    queue_position: null,
    summary: null,
    created_at: '2026-11-07T10:00:00Z',
    closed_at: null,
    ai_mode: null,
    tags: [],
    ...thread,
  };
  stubFetch();
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  renderWithLocale(
    <QueryClientProvider client={queryClient}>
      <Harness />
    </QueryClientProvider>,
    locale,
  );
  await waitFor(() => expect(document.querySelector('#composer-input')).not.toBeNull());
}

const sendButton = () => screen.getByRole('button', { name: 'Send' });
const replyBox = () => document.querySelector<HTMLTextAreaElement>('#composer-input')!;

beforeEach(() => {
  posts = [];
  claimWins = true;
  chatTeams = [7];
  localStorage.clear();
  useFailedSendStore.setState({ byChat: {} });
  useRetiredDraftStore.setState({ byChat: {} });
  signIn();
});

afterEach(() => {
  vi.unstubAllGlobals();
  useTypingStore.getState().setEmitter(() => {});
  resetLocale();
});

describe('the reply area when the chat is not mine (tm 475.4)', () => {
  it('is the ordinary composer when the connection is assigned to me', async () => {
    await setup({ assignee_id: ME });
    expect(screen.queryByTestId('reply-claim-bar')).toBeNull();
    await userEvent.type(replyBox(), 'Hello there');
    expect(sendButton()).toBeEnabled();
  });

  it("offers Take on the AI's chat; Reply waits, a note sends, and Take opens Reply with the words kept", async () => {
    const typing = vi.fn();
    useTypingStore.getState().setEmitter(typing);
    await setup({ ai_mode: 'ai' });
    const bar = screen.getByTestId('reply-claim-bar');
    expect(bar).toHaveTextContent('Take this chat to reply to the customer.');
    expect(bar).toHaveTextContent('You can still write an internal note.');

    await userEvent.type(replyBox(), 'Let me check that for you');
    expect(sendButton()).toBeDisabled();
    // Still a composer at work: the gateway keeps it from the visitor but
    // counts it towards the assignee's conflict warning (08.6.3).
    expect(typing).toHaveBeenCalledWith(CHAT, true);
    await userEvent.keyboard('{Enter}');
    expect(posts.filter((p) => p.path.endsWith('/events'))).toHaveLength(0);
    expect(replyBox()).toHaveValue('Let me check that for you');

    // The same words as a note go — the rule does not cover what the customer never sees.
    await userEvent.click(screen.getByRole('radio', { name: 'Internal note' }));
    expect(sendButton()).toBeEnabled();
    await userEvent.click(screen.getByRole('radio', { name: 'Reply' }));
    expect(sendButton()).toBeDisabled();

    await userEvent.click(within(bar).getByRole('button', { name: 'Take chat' }));
    await waitFor(() => expect(screen.queryByTestId('reply-claim-bar')).toBeNull());
    expect(posts.map((p) => p.path)).toEqual([`/chats/${CHAT}/claim`]);
    expect(replyBox()).toHaveValue('Let me check that for you');
    expect(sendButton()).toBeEnabled();
    await userEvent.click(sendButton());
    await waitFor(() =>
      expect(posts.at(-1)).toMatchObject({
        path: `/chats/${CHAT}/events`,
        body: { recipients: 'all', text: 'Let me check that for you' },
      }),
    );
  });

  it("names a colleague's chat, offers no Take over without the right, and still sends a note", async () => {
    await setup({ assignee_id: SAM });
    const bar = screen.getByTestId('reply-claim-bar');
    await waitFor(() => expect(bar).toHaveTextContent('This chat is with Sam Rivera.'));
    expect(within(bar).queryByRole('button')).toBeNull();

    await userEvent.click(screen.getByRole('radio', { name: 'Internal note' }));
    await userEvent.type(replyBox(), 'Customer is VIP, be quick');
    await userEvent.click(sendButton());
    await waitFor(() =>
      expect(posts).toEqual([
        {
          path: `/chats/${CHAT}/events`,
          body: expect.objectContaining({
            recipients: 'agents',
            text: 'Customer is VIP, be quick',
          }),
        },
      ]),
    );
    expect(screen.queryByTestId('failed-send')).toBeNull();
  });

  it('offers Take over to whoever may take the chat over, behind its confirmation', async () => {
    signIn('all');
    await setup({ assignee_id: SAM });
    const bar = screen.getByTestId('reply-claim-bar');
    await userEvent.click(within(bar).getByRole('button', { name: 'Take over' }));
    const dialog = screen.getByRole('dialog', { name: 'Take over this chat?' });
    expect(dialog).toHaveTextContent('taking it from Sam Rivera');
  });

  it('offers Take on a queued chat of my team, an automatic one too', async () => {
    await setup({ queue_position: 1 });
    expect(
      await within(screen.getByTestId('reply-claim-bar')).findByRole('button', {
        name: 'Take chat',
      }),
    ).toBeInTheDocument();
  });

  it('says a queued chat of another team will be assigned for me, with nothing to press', async () => {
    chatTeams = [8];
    await setup({ queue_position: 1 });
    const bar = screen.getByTestId('reply-claim-bar');
    expect(bar).toHaveTextContent('It will be assigned automatically');
    expect(within(bar).queryByRole('button')).toBeNull();
  });

  it('draws the strip away when a push hands the chat to me', async () => {
    await setup({ assignee_id: SAM });
    await userEvent.type(replyBox(), 'Half a sentence');
    expect(screen.getByTestId('reply-claim-bar')).toBeInTheDocument();

    server = { ...server, assignee_id: ME };
    act(() => {
      applyPush(queryClient, 'chat_transferred', {
        chat_id: CHAT,
        transferred_to: { agent_ids: [ME], group_ids: [] },
      });
    });
    await waitFor(() => expect(screen.queryByTestId('reply-claim-bar')).toBeNull());
    expect(replyBox()).toHaveValue('Half a sentence');
    expect(sendButton()).toBeEnabled();
  });

  it('draws the strip when a push takes the chat over from me', async () => {
    await setup({ assignee_id: ME });
    server = { ...server, assignee_id: SAM };
    act(() => {
      applyPush(queryClient, 'chat_taken_over', {
        chat_id: CHAT,
        previous_assignee_id: ME,
        new_assignee_id: SAM,
      });
    });
    await waitFor(() =>
      expect(screen.getByTestId('reply-claim-bar')).toHaveTextContent(
        'This chat is with Sam Rivera.',
      ),
    );
  });

  it('keeps the words of a reply that lost the race, and re-reads who has the chat', async () => {
    await setup({ assignee_id: ME });
    // Taken over a moment ago; the push has not arrived.
    server = { ...server, assignee_id: SAM };
    await userEvent.type(replyBox(), 'Your refund is on its way');
    await userEvent.click(sendButton());

    const failed = await screen.findByTestId('failed-send');
    expect(failed).toHaveTextContent('Your refund is on its way');
    expect(
      screen.getByText(
        'Only the agent this conversation is assigned to can reply to the customer. Take it first — an internal note is always allowed.',
      ),
    ).toBeInTheDocument();
    // A refusal that no retry can turn around offers none.
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    await waitFor(() =>
      expect(screen.getByTestId('reply-claim-bar')).toHaveTextContent(
        'This chat is with Sam Rivera.',
      ),
    );
  });

  it('says why a Take lost, and shows who won it', async () => {
    claimWins = false;
    await setup({ ai_mode: 'ai' });
    await userEvent.type(replyBox(), 'On it');
    await userEvent.click(screen.getByRole('button', { name: 'Take chat' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Someone else took this chat first.',
    );
    await waitFor(() =>
      expect(screen.getByTestId('reply-claim-bar')).toHaveTextContent(
        'This chat is with Sam Rivera.',
      ),
    );
    expect(replyBox()).toHaveValue('On it');
    expect(sendButton()).toBeDisabled();
  });

  it('offers nothing to take on a chat nobody routed', async () => {
    await setup({});
    const bar = screen.getByTestId('reply-claim-bar');
    expect(bar).toHaveTextContent(
      'It will be assigned automatically, or by someone allowed to assign it.',
    );
    expect(within(bar).queryByRole('button')).toBeNull();
  });

  it('speaks Turkish', async () => {
    await setup({ ai_mode: 'paused' }, 'tr');
    const bar = screen.getByTestId('reply-claim-bar');
    expect(bar).toHaveTextContent('Müşteriye yanıt vermek için sohbeti üstüne alın.');
    expect(within(bar).getByRole('button', { name: 'Üstüne al' })).toBeInTheDocument();
  });
});
