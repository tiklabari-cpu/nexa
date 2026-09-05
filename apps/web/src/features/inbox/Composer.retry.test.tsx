/**
 * A refused send is recoverable (FR-MOD-02.3.3 · FR-MOD-02.3.6, "hata retry").
 *
 * What used to happen on a 500: the composer had already cleared the text,
 * `optimisticCacheUpdate.onError` rolled the transcript back to before the
 * bubble, and the message the agent typed existed nowhere. Nothing was red,
 * nothing was pressable, and the only evidence was the customer never
 * answering.
 *
 * These tests drive the whole chain the fix is made of — composer → send
 * mutation → `failedSends` store → transcript row → Retry → the same request
 * again — because each half is worthless alone: a store that records a failure
 * nobody renders, or a Retry button wired to a fresh idempotency key, would both
 * pass a narrower test and lose (or duplicate) the message in the product.
 *
 * The harness below mirrors what `InboxPage.tsx` wires; the browser proof that
 * the real screen wires it the same way is `apps/e2e/tests/inbox-retry.spec.ts`.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, type RenderResult } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { Composer } from './Composer.js';
import { Transcript } from './Transcript.js';
import { useFailedSendStore } from './failedSends.js';
import { useSendMessage } from './useInbox.js';
import { useFailedSends } from './failedSends.js';
import type { ReactElement } from 'react';

const CHAT = 'CHAT1';

interface SendAttempt {
  text?: string;
  recipients?: string;
  idempotency_key?: string;
  attachment_url?: string;
}

/** How the next `POST /chats/:id/events` should answer. */
type Reply = { ok: true } | { ok: false; status: number; type: string };

const OK: Reply = { ok: true };
const TRANSIENT: Reply = { ok: false, status: 500, type: 'internal' };
const PERMANENT: Reply = { ok: false, status: 403, type: 'authorization' };

let attempts: SendAttempt[];
let reply: Reply;

/**
 * One fetch stub for the whole component tree: the canned-reply library the
 * composer loads on mount, and the send itself. It is deliberately the *real*
 * `ApiClient` on top of it, so the failure the store classifies is a genuine
 * `ApiClientError` built from a genuine response rather than a hand-made one.
 */
function stubFetch(): Mock {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST' && String(url).includes(`/chats/${CHAT}/events`)) {
      attempts.push(JSON.parse(String(init.body)) as SendAttempt);
      const answer = reply;
      if (answer.ok) {
        return {
          ok: true,
          status: 201,
          headers: { get: () => null },
          json: async () => ({ id: 'EV1' }),
        };
      }
      return {
        ok: false,
        status: answer.status,
        headers: { get: () => null },
        json: async () => ({
          error: {
            type: answer.type,
            message: 'The server wrote this sentence for a log line.',
            request_id: 'req-1',
          },
        }),
      };
    }
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({ items: [] }),
    };
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock as unknown as Mock;
}

/** The composer and the transcript over one chat, wired as `InboxPage` wires them. */
function Harness(): ReactElement {
  const failedSends = useFailedSends(CHAT);
  const retry = useSendMessage(CHAT);
  return (
    <>
      <Transcript
        chatId={CHAT}
        events={[]}
        loading={false}
        currentAgentId={null}
        failedSends={failedSends}
        onRetry={(entry) => retry.mutate(entry.input)}
      />
      <Composer chatId={CHAT} disabled={false} />
    </>
  );
}

function setup(): RenderResult {
  stubFetch();
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <Harness />
    </QueryClientProvider>,
  );
}

/** Type a reply and send it, then wait for the attempt to have been made. */
async function send(text: string): Promise<void> {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('Reply to the customer'), text);
  await user.click(screen.getByRole('button', { name: 'Send' }));
}

beforeEach(() => {
  attempts = [];
  reply = OK;
  useFailedSendStore.setState({ byChat: {} });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('a refused send stays in the transcript (FR-MOD-02.3.3 · FR-MOD-02.3.6)', () => {
  it('keeps the message with a Retry control instead of dropping it', async () => {
    setup();
    reply = TRANSIENT;
    await send('Bring it in tomorrow');

    // The message the server refused is on screen, in the transcript, labelled
    // as unsent — this is the assertion the old behaviour failed: the words
    // existed in neither the composer nor the transcript.
    const failed = await screen.findByTestId('failed-send');
    expect(failed).toHaveTextContent('Bring it in tomorrow');
    expect(screen.getByText('Not sent')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();

    // And the composer is empty, ready for the next message — the decision
    // recorded in `Composer.tsx`: one message, one place.
    expect(screen.getByLabelText('Reply to the customer')).toHaveValue('');
  });

  it('retries the same message rather than sending a second one', async () => {
    setup();
    reply = TRANSIENT;
    await send('Bring it in tomorrow');
    await screen.findByRole('button', { name: 'Retry' });

    reply = OK;
    await userEvent.setup().click(screen.getByRole('button', { name: 'Retry' }));

    await waitFor(() => expect(attempts).toHaveLength(2));
    // Two requests, one message: the retry replays the first attempt's key, so
    // the server answers it with the event it already created instead of
    // writing the reply into the conversation twice.
    expect(attempts[1]?.idempotency_key).toBe(attempts[0]?.idempotency_key);
    expect(attempts[1]?.text).toBe('Bring it in tomorrow');

    // It went through, so the row it was waiting in is gone.
    await waitFor(() => expect(screen.queryByTestId('failed-send')).not.toBeInTheDocument());
  });

  it('leaves one row, not two, when the retry fails again', async () => {
    setup();
    reply = TRANSIENT;
    await send('Bring it in tomorrow');
    await screen.findByRole('button', { name: 'Retry' });

    await userEvent.setup().click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(attempts).toHaveLength(2));
    await waitFor(() => expect(screen.getAllByTestId('failed-send')).toHaveLength(1));
  });

  it('offers no Retry on a refusal that cannot succeed, and names the reason', async () => {
    setup();
    reply = PERMANENT;
    await send('Bring it in tomorrow');

    await screen.findByTestId('failed-send');
    // A button whose outcome is a certain second 403 is a trap (tm 181.3): the
    // agent needs the reason, and the reason is the catalogue's sentence for the
    // ADR-06 type — never the English prose the API wrote for its own log.
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
    expect(screen.getByText('You do not have permission to do that.')).toBeInTheDocument();
    expect(
      screen.queryByText('The server wrote this sentence for a log line.'),
    ).not.toBeInTheDocument();
  });

  it('never overwrites what the agent has typed since the failure', async () => {
    setup();
    reply = TRANSIENT;
    await send('Bring it in tomorrow');
    await screen.findByTestId('failed-send');

    // The agent moved on while the failure sat there. Putting the refused text
    // back into the field would destroy this sentence — the loss the retry
    // design exists to prevent, arriving by a different door.
    const field = screen.getByLabelText('Reply to the customer');
    await userEvent.setup().type(field, 'Actually, we can courier it');
    expect(field).toHaveValue('Actually, we can courier it');
    expect(screen.getByTestId('failed-send')).toHaveTextContent('Bring it in tomorrow');
  });

  it('carries the attachment through the retry', async () => {
    setup();
    // Seeded directly: the upload half of the composer is `uploadAttachment`'s
    // own test, and what matters here is that the file rides along with the
    // second attempt rather than being lost with the first.
    useFailedSendStore.getState().record(
      CHAT,
      {
        text: 'Here is the invoice',
        recipients: 'all',
        attachmentUrl: '/api/v1/uploads/invoice.pdf',
        idempotencyKey: 'key-attach',
      },
      new TypeError('network down'),
    );

    // A thrown non-API value is not retryable, so re-record it as a 5xx would
    // arrive — the classification itself is `failedSends.test.ts`'s subject.
    useFailedSendStore.setState((state) => ({
      byChat: {
        ...state.byChat,
        [CHAT]: (state.byChat[CHAT] ?? []).map((entry) => ({ ...entry, retryable: true })),
      },
    }));

    reply = OK;
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Retry' }));

    await waitFor(() => expect(attempts).toHaveLength(1));
    expect(attempts[0]?.attachment_url).toBe('/api/v1/uploads/invoice.pdf');
    expect(attempts[0]?.idempotency_key).toBe('key-attach');
  });
});
