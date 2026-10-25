/**
 * A ticket's conversation in the pane (tm 356.4 · HD-01): the thread draws a
 * reply and an internal note differently, the composer sends the right request
 * for each mode, and a failed e-mail offers "try again".
 *
 * The stub keeps the thread as state, the way the server does, so a send is
 * followed by a re-read that shows it.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TicketDetailPane } from './TicketPane.js';
import type { TicketDetail, TicketMessage } from './types.js';
import { useAuth } from '../../lib/auth-store.js';

function makeDetail(overrides: Partial<TicketDetail> = {}): TicketDetail {
  return {
    id: 'TCK1',
    subject: 'Withdrawal question',
    status: 'open',
    priority: 0,
    assignee_id: null,
    assignee_name: null,
    group_id: null,
    customer_id: 'cust-1',
    customer_name: 'Mira Haddad',
    customer_email: 'mira@example.test',
    source_chat_id: null,
    source_thread_id: null,
    merged_into_id: null,
    last_message_at: null,
    created_at: '2026-10-25T08:00:00.000Z',
    source_chat: null,
    followers: [],
    merged_ticket_ids: [],
    custom_fields: [],
    ...overrides,
  };
}

function makeMessage(overrides: Partial<TicketMessage> = {}): TicketMessage {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    ticket_id: 'TCK1',
    kind: 'customer_message',
    author_type: 'customer',
    author_id: 'cust-1',
    author_name: 'Mira Haddad',
    body_text: 'Where is my withdrawal?',
    body_text_full: null,
    attachments: [],
    delivery_status: null,
    created_at: '2026-10-25T09:00:00.000Z',
    ...overrides,
  };
}

function okJson(body: unknown, status = 200): Response {
  return {
    ok: status < 400,
    status,
    headers: { get: () => null },
    json: async () => body,
  } as unknown as Response;
}

interface Call {
  method: string;
  path: string;
  body: Record<string, unknown> | undefined;
}

interface Stub {
  calls: Call[];
  posts: () => Call[];
  messages: TicketMessage[];
  /** What the next `POST …/messages` answers with, before it falls back to storing. */
  failNextSend: () => void;
}

function render_(
  detail: TicketDetail,
  messages: TicketMessage[],
  canned: { id: string; shortcut: string; text: string }[] = [],
): Stub {
  const calls: Call[] = [];
  const stub: Stub = {
    calls,
    posts: () => calls.filter((c) => c.method === 'POST' && c.path.endsWith('/messages')),
    messages: [...messages],
    failNextSend: () => {
      failing = true;
    },
  };
  let failing = false;
  let counter = 100;

  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const path = String(url).replace('/api/v1', '');
      const body = init?.body
        ? (JSON.parse(String(init.body)) as Record<string, unknown>)
        : undefined;
      calls.push({ method, path, body });

      if (path === '/agents') return okJson({ items: [] });
      if (path.includes('/attachments/')) {
        return {
          ok: true,
          status: 200,
          headers: { get: () => null },
          blob: async () => new Blob(['bytes']),
        } as unknown as Response;
      }
      if (path.startsWith('/settings/canned-responses')) return okJson({ items: canned });
      if (method === 'GET' && /\/messages(\?|$)/.test(path)) {
        return okJson({ items: stub.messages.map((m) => ({ ...m })) });
      }
      if (method === 'POST' && /\/messages$/.test(path)) {
        if (failing) {
          failing = false;
          return okJson({ type: 'internal', message: 'boom', request_id: 'r' }, 500);
        }
        const stored = makeMessage({
          id: `00000000-0000-4000-8000-${String(counter++).padStart(12, '0')}`,
          kind: body?.['kind'] === 'note' ? 'internal_note' : 'agent_reply',
          author_type: 'agent',
          author_name: 'Ada Agent',
          body_text: String(body?.['text']),
          delivery_status: body?.['kind'] === 'note' ? null : 'queued',
        });
        stub.messages.push(stored);
        return okJson(stored, 201);
      }
      if (method === 'POST' && /\/resend$/.test(path)) {
        const id = path.split('/').slice(-2)[0];
        const found = stub.messages.find((m) => m.id === id)!;
        found.delivery_status = 'queued';
        return okJson(found);
      }
      return okJson(detail);
    }),
  );

  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <TicketDetailPane ticketId={detail.id} candidates={[]} />
    </QueryClientProvider>,
  );
  return stub;
}

beforeEach(() => {
  useAuth.setState({ status: 'signed-in', accessToken: 'test-token', agent: null });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('TicketThread', () => {
  it('draws a note apart from a reply, and gives only the reply a delivery state (HD-01)', async () => {
    render_(makeDetail(), [
      makeMessage(),
      makeMessage({
        id: '00000000-0000-4000-8000-000000000002',
        kind: 'agent_reply',
        author_type: 'agent',
        author_name: 'Ada Agent',
        body_text: 'It is on its way.',
        delivery_status: 'sent',
      }),
      makeMessage({
        id: '00000000-0000-4000-8000-000000000003',
        kind: 'internal_note',
        author_type: 'agent',
        author_name: 'Bo Agent',
        body_text: 'Checked with payments.',
      }),
    ]);

    const thread = await screen.findByRole('region', { name: 'Conversation' });
    await within(thread).findByText('It is on its way.');
    const items = within(thread).getAllByRole('listitem');
    const note = items.find((li) => li.getAttribute('data-kind') === 'internal_note')!;
    const reply = items.find((li) => li.getAttribute('data-kind') === 'agent_reply')!;

    expect(within(note).getByText('Internal note · only your team sees this')).toBeTruthy();
    expect(within(note).queryByText('Sent')).toBeNull();
    expect(within(note).queryByText('Could not send')).toBeNull();
    expect(within(reply).getByText('Sent')).toBeTruthy();
    expect(within(reply).queryByText(/Internal note/)).toBeNull();
  });

  it('says a reply was saved but not sent when the deployment keeps ticket e-mail off (K23)', async () => {
    render_(makeDetail(), [
      makeMessage({
        kind: 'agent_reply',
        author_type: 'agent',
        author_name: 'Ada Agent',
        body_text: 'Kept, not mailed.',
        delivery_status: 'suppressed',
      }),
    ]);

    expect(await screen.findByText('Not sent (pilot)')).toBeTruthy();
    expect(screen.getByText(/E-mail to players is switched off on this deployment/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });

  it('offers "try again" on a failed reply and sends it again without writing it twice (HD-01)', async () => {
    const stub = render_(makeDetail(), [
      makeMessage({
        id: '00000000-0000-4000-8000-000000000009',
        kind: 'agent_reply',
        author_type: 'agent',
        author_name: 'Ada Agent',
        body_text: 'Please check your inbox.',
        delivery_status: 'failed',
      }),
    ]);

    expect(await screen.findByText('Could not send')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));

    await waitFor(() => expect(screen.getByText('Sending…')).toBeTruthy());
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    expect(stub.calls.filter((c) => c.method === 'POST').map((c) => c.path)).toEqual([
      '/tickets/TCK1/messages/00000000-0000-4000-8000-000000000009/resend',
    ]);
  });

  it('labels a line from a merged ticket with the ticket it was written on', async () => {
    render_(makeDetail(), [makeMessage({ ticket_id: 'TCK9', body_text: 'Written on the child.' })]);
    expect(await screen.findByText('from merged ticket TCK9')).toBeTruthy();
  });

  it("warns on a player's e-mail sent from another address than the ticket's player (HD-03)", async () => {
    render_(makeDetail(), [
      makeMessage({ body_text: 'From the player.' }),
      makeMessage({
        id: '00000000-0000-4000-8000-000000000002',
        body_text: 'I am their brother.',
        author_name: 'Kardeşi',
        sender_mismatch: true,
      }),
    ]);
    const warning = await screen.findByTestId('sender-mismatch');
    expect(warning.textContent).toBe(
      "Sent from another address than this ticket's player — check who is writing before you act on it.",
    );
    // Only on the message that came from elsewhere.
    expect(screen.getAllByTestId('sender-mismatch')).toHaveLength(1);
    expect(warning.closest('li')?.textContent).toContain('I am their brother.');
  });

  it('shows what the player wrote, with the whole e-mail and its formatting one click away each (HD-02)', async () => {
    const user = userEvent.setup();
    render_(makeDetail(), [
      makeMessage({
        body_text: 'Deposit failed, 2,500 TL at 14:42.',
        body_text_full:
          'Deposit failed, 2,500 TL at 14:42.\n\nOn Mon, 20 Oct 2026 Support <s@example.test> wrote:\n> Send the receipt?',
        body_html: '<p>Deposit failed</p><script>alert(1)</script>',
      }),
    ]);

    const thread = await screen.findByRole('region', { name: 'Conversation' });
    await within(thread).findByText('Deposit failed, 2,500 TL at 14:42.');
    // The quote is not in the thread until asked for.
    expect(within(thread).queryByText(/Send the receipt\?/)).toBeNull();

    const showFull = within(thread).getByRole('button', { name: 'Show full message' });
    expect(showFull.getAttribute('aria-expanded')).toBe('false');
    await user.click(showFull);
    expect(within(thread).getByText(/Send the receipt\?/)).toBeTruthy();
    expect(
      within(thread)
        .getByRole('button', { name: 'Hide full message' })
        .getAttribute('aria-expanded'),
    ).toBe('true');

    await user.click(within(thread).getByRole('button', { name: 'Formatted view' }));
    const frame = within(thread).getByTitle(/as it was formatted/) as HTMLIFrameElement;
    // Every sandbox allowance off — no script runs in it, whatever it holds —
    // and the document's own policy loads nothing but inline images.
    expect(frame.getAttribute('sandbox')).toBe('');
    const doc = frame.getAttribute('srcdoc') ?? '';
    expect(doc).toContain(`content="default-src 'none'; img-src data:; style-src 'unsafe-inline'"`);
    expect(doc).toContain('<p>Deposit failed</p>');
  });

  it('opens a file through its ticket, keeps a sensitive one behind a click and a locked one shut (HD-02)', async () => {
    const user = userEvent.setup();
    // jsdom has neither; defined on `URL` itself rather than stubbing the
    // global, which is restored before the pane unmounts and revokes its URLs.
    Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:file'), revokeObjectURL: vi.fn() });
    const file = (name: string, extra: Record<string, unknown> = {}) => ({
      key: `7-m-00000000-0000-4000-8000-00000000000${name.length % 10}.${name.split('.').pop()}`,
      name,
      size: 2048,
      mime: name.endsWith('.pdf') ? 'application/pdf' : 'image/jpeg',
      scan_status: 'clean' as const,
      sensitive: false,
      ...extra,
    });
    const receipt = file('dekont.pdf');
    const idCard = file('kimlik_on.jpg', { sensitive: true });
    const passport = file('pasaport.jpg', { sensitive: true, locked: true });
    const old = file('ehliyet_eski.jpg', { sensitive: true, purged: true });
    const stub = render_(makeDetail(), [
      makeMessage({ attachments: [receipt, idCard, passport, old] }),
    ]);
    const fetched = () =>
      stub.calls.filter((c) => c.path.includes('/attachments/')).map((c) => c.path);
    const url = (key: string) =>
      `/tickets/TCK1/messages/00000000-0000-4000-8000-000000000001/attachments/${key}`;

    const thread = await screen.findByRole('region', { name: 'Conversation' });
    await within(thread).findByText(/dekont\.pdf/);
    await waitFor(() => expect(fetched()).toEqual([url(receipt.key)]));
    // Never `/uploads`: an e-mailed file is served only through its ticket.
    expect(stub.calls.some((c) => c.path.startsWith('/uploads/'))).toBe(false);

    expect(
      within(thread).getByText('pasaport.jpg · sensitive file — your role cannot open it.'),
    ).toBeTruthy();
    expect(
      within(thread).getByText('ehliyet_eski.jpg was deleted under the retention policy.'),
    ).toBeTruthy();
    expect(within(thread).getByText('Opening it is recorded in the audit log.')).toBeTruthy();

    await user.click(
      within(thread).getByRole('button', { name: 'Show sensitive file: kimlik_on.jpg' }),
    );
    await waitFor(() => expect(fetched()).toEqual([url(receipt.key), url(idCard.key)]));
    // The locked and the deleted file are never asked for.
    expect(fetched()).not.toContain(url(passport.key));
    expect(fetched()).not.toContain(url(old.key));
  });
});

describe('TicketComposer', () => {
  it('sends a reply with an idempotency key and no status change, then clears the box (HD-01)', async () => {
    const stub = render_(makeDetail(), []);

    const box = await screen.findByLabelText('Reply to the player');
    await userEvent.type(box, 'We are looking into it.');
    await userEvent.click(screen.getByRole('button', { name: 'Send reply' }));

    await waitFor(() => expect(stub.posts()).toHaveLength(1));
    const sent = stub.posts()[0]!;
    expect(sent.path).toBe('/tickets/TCK1/messages');
    expect(sent.body).toMatchObject({ kind: 'reply', text: 'We are looking into it.' });
    expect(sent.body).not.toHaveProperty('set_status');
    expect(typeof sent.body?.['idempotency_key']).toBe('string');

    await waitFor(() => expect((box as HTMLTextAreaElement).value).toBe(''));
    // The thread is re-read and now shows the reply, on its way.
    expect(await screen.findByText('We are looking into it.')).toBeTruthy();
    expect(screen.getByText('Sending…')).toBeTruthy();
  });

  it('"Send and mark solved" asks for the solved status in the same request', async () => {
    const stub = render_(makeDetail(), []);
    await userEvent.type(await screen.findByLabelText('Reply to the player'), 'All done.');
    await userEvent.click(screen.getByRole('button', { name: 'Send and mark solved' }));

    await waitFor(() => expect(stub.posts()).toHaveLength(1));
    expect(stub.posts()[0]?.body).toMatchObject({ kind: 'reply', set_status: 'solved' });
  });

  it('sends an internal note as a note, and says it is never e-mailed', async () => {
    const stub = render_(makeDetail(), []);
    await userEvent.click(await screen.findByRole('tab', { name: 'Internal note' }));

    expect(screen.getByText('Only your team sees this. It is never e-mailed.')).toBeTruthy();
    // A note has no "and solve": that is a statement to the player.
    expect(screen.queryByRole('button', { name: 'Send and mark solved' })).toBeNull();

    await userEvent.type(
      screen.getByLabelText('Internal note', { selector: 'textarea' }),
      'Called them.',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Add note' }));

    await waitFor(() => expect(stub.posts()).toHaveLength(1));
    expect(stub.posts()[0]?.body).toMatchObject({ kind: 'note', text: 'Called them.' });
    expect(stub.posts()[0]?.body).not.toHaveProperty('set_status');
  });

  it('keeps the idempotency key across a failed attempt, and mints a new one for edited text', async () => {
    const stub = render_(makeDetail(), []);
    const box = await screen.findByLabelText('Reply to the player');
    await userEvent.type(box, 'First try');

    stub.failNextSend();
    await userEvent.click(screen.getByRole('button', { name: 'Send reply' }));
    await waitFor(() => expect(stub.posts()).toHaveLength(1));
    // The box keeps the text when the send failed, and says so.
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect((box as HTMLTextAreaElement).value).toBe('First try');

    await userEvent.click(screen.getByRole('button', { name: 'Send reply' }));
    await waitFor(() => expect(stub.posts()).toHaveLength(2));
    expect(stub.posts()[1]?.body?.['idempotency_key']).toBe(
      stub.posts()[0]?.body?.['idempotency_key'],
    );

    await userEvent.type(box, ' again');
    await userEvent.click(screen.getByRole('button', { name: 'Send reply' }));
    await waitFor(() => expect(stub.posts()).toHaveLength(3));
    expect(stub.posts()[2]?.body?.['idempotency_key']).not.toBe(
      stub.posts()[1]?.body?.['idempotency_key'],
    );
  });

  it('closes the reply when the player left no e-mail address and leaves the note (HD-01)', async () => {
    render_(makeDetail({ customer_email: null, customer_has_email: false }), []);

    expect(
      await screen.findByText(/left no e-mail address, so there is no one to reply to/),
    ).toBeTruthy();
    expect((screen.getByRole('tab', { name: 'Reply' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole('button', { name: 'Send reply' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Add note' })).toBeTruthy();
  });

  it('still offers a reply when the address is only hidden from this role', async () => {
    render_(makeDetail({ customer_email: null, customer_has_email: true }), []);
    expect(await screen.findByRole('button', { name: 'Send reply' })).toBeTruthy();
  });

  it('writes nothing on a merged ticket and points at its primary (HD-01)', async () => {
    render_(makeDetail({ merged_into_id: 'TCK7' }), []);

    expect(await screen.findByText(/merged into TCK7\. Continue the conversation/)).toBeTruthy();
    expect(screen.queryByLabelText('Reply to the player')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Send reply' })).toBeNull();
  });

  it('fills a ticket saved reply from the # picker', async () => {
    const stub = render_(
      makeDetail(),
      [],
      [{ id: 'c1', shortcut: 'thanks', text: 'Thank you for contacting us.' }],
    );
    const box = await screen.findByLabelText('Reply to the player');
    await userEvent.type(box, '#th');
    await userEvent.click(await screen.findByRole('option', { name: /#thanks/ }));

    expect((box as HTMLTextAreaElement).value).toBe('Thank you for contacting us. ');
    expect(stub.calls.some((c) => c.path === '/settings/canned-responses?scope=ticket')).toBe(true);
  });
});
