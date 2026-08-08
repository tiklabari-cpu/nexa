/**
 * The Copilot assist panel (FR-MOD-12.1 / 12.3).
 *
 * The panel opens per conversation and offers three assists. These pin the
 * behaviour that matters: the summary and draft actions call the right endpoint,
 * a drafted reply is handed to the composer through the shared store rather than
 * sent, and an archived conversation disables the lot with a reason.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CopilotPanel } from './CopilotPanel.js';
import { useCopilotDraftStore } from './copilotDraft.js';

function okJson(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => body,
  } as unknown as Response;
}

interface Call {
  method: string;
  path: string;
  body: Record<string, unknown> | undefined;
}

function stubFetch(responses: Record<string, unknown>): { calls: Call[] } {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const path = String(url).replace('/api/v1', '');
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined;
      calls.push({ method, path, body });
      const key = Object.keys(responses).find((suffix) => path.endsWith(suffix));
      return okJson(key ? responses[key] : {});
    }),
  );
  return { calls };
}

function renderPanel(active = true) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onShowDetails = vi.fn();
  render(
    <QueryClientProvider client={queryClient}>
      <CopilotPanel
        chatId="CHAT123"
        chatActive={active}
        onShowDetails={onShowDetails}
        onCollapse={vi.fn()}
      />
    </QueryClientProvider>,
  );
  return { onShowDetails };
}

beforeEach(() => {
  useCopilotDraftStore.setState({ byChat: {} });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('CopilotPanel', () => {
  it('opens with the three assists on offer (12.1)', () => {
    stubFetch({});
    renderPanel();
    expect(screen.getByRole('heading', { name: /copilot/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Summarise conversation' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Draft a reply' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Rephrase' })).toBeTruthy();
  });

  it('summarises into an internal note (12.3 / 02.5)', async () => {
    const { calls } = stubFetch({
      '/summary': { summary: 'Customer asked about a late order.', note_event_id: 'e1' },
    });
    renderPanel();

    await userEvent.click(screen.getByRole('button', { name: 'Summarise conversation' }));

    await waitFor(() => expect(screen.getByText(/late order/)).toBeTruthy());
    expect(screen.getByText('Added as an internal note.')).toBeTruthy();
    const summaryCall = calls.find((c) => c.path === '/copilot/chats/CHAT123/summary');
    expect(summaryCall?.method).toBe('POST');
  });

  it('drafts a reply and hands it to the composer rather than sending it (12.3)', async () => {
    stubFetch({
      '/reply': { draft: 'Refunds over 500 go to finance.', sources: [{ name: 'Refund policy', score: 0.8 }] },
    });
    renderPanel();

    await userEvent.click(screen.getByRole('button', { name: 'Draft a reply' }));
    await waitFor(() => expect(screen.getByText('Refunds over 500 go to finance.')).toBeTruthy());
    expect(screen.getByText(/From: Refund policy/)).toBeTruthy();

    // Insert hands the draft to the composer through the shared store — it does
    // not send.
    await userEvent.click(screen.getByRole('button', { name: 'Insert into reply' }));
    expect(useCopilotDraftStore.getState().byChat['CHAT123']).toBe('Refunds over 500 go to finance.');
  });

  it('says so when the knowledge base has no suggestion', async () => {
    stubFetch({ '/reply': { draft: '', sources: [] } });
    renderPanel();
    await userEvent.click(screen.getByRole('button', { name: 'Draft a reply' }));
    await waitFor(() =>
      expect(screen.getByText(/No suggestion found in the copilot knowledge base/)).toBeTruthy(),
    );
  });

  it('rewrites a draft in the chosen register (12.3)', async () => {
    const { calls } = stubFetch({ '/enhance': { text: 'Hello, we cannot do that.', mode: 'formal' } });
    renderPanel();

    await userEvent.type(screen.getByLabelText('Draft to improve'), "we can't do that");
    await userEvent.click(screen.getByRole('button', { name: 'More formal' }));

    await waitFor(() => expect(screen.getByText('Hello, we cannot do that.')).toBeTruthy());
    const call = calls.find((c) => c.path === '/copilot/chats/CHAT123/enhance');
    expect(call?.body).toEqual({ text: "we can't do that", mode: 'formal' });
  });

  it('switches back to Details from its header', async () => {
    stubFetch({});
    const { onShowDetails } = renderPanel();
    await userEvent.click(screen.getByRole('button', { name: 'Details' }));
    expect(onShowDetails).toHaveBeenCalled();
  });

  it('disables the assists on an archived conversation, with a reason', () => {
    stubFetch({});
    renderPanel(false);
    expect(screen.getByText('Reopen the conversation to use Copilot.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Summarise conversation' })).toHaveProperty(
      'disabled',
      true,
    );
  });

  describe('BI command — asking about reports (12.4-bi-d)', () => {
    const QUESTION = 'How many chats closed this week?';

    it('sends the question to POST /copilot/bi', async () => {
      const { calls } = stubFetch({
        '/copilot/bi': {
          answer: 'Your team closed 12 chats this week.',
          kind: 'metric',
          metric: 'totals.closed',
          value: 12,
          range: { from: '2026-08-03T00:00:00.000Z', to: '2026-08-08T23:59:59.999Z' },
        },
      });
      renderPanel();

      await userEvent.type(screen.getByLabelText('Ask about your reports'), QUESTION);
      await userEvent.click(screen.getByRole('button', { name: 'Ask' }));

      await waitFor(() => expect(screen.getByText('Your team closed 12 chats this week.')).toBeTruthy());
      const call = calls.find((c) => c.path === '/copilot/bi');
      expect(call?.method).toBe('POST');
      expect(call?.body).toEqual({ question: QUESTION });
    });

    it('renders the value, the metric label and the window with its source (12.4)', async () => {
      stubFetch({
        '/copilot/bi': {
          answer: 'Your team closed 12 chats this week.',
          kind: 'metric',
          metric: 'totals.closed',
          value: 12,
          range: { from: '2026-08-03T00:00:00.000Z', to: '2026-08-08T23:59:59.999Z' },
        },
      });
      renderPanel();

      await userEvent.type(screen.getByLabelText('Ask about your reports'), QUESTION);
      await userEvent.click(screen.getByRole('button', { name: 'Ask' }));

      await waitFor(() => expect(screen.getByText('12')).toBeTruthy());
      expect(screen.getByText('totals.closed')).toBeTruthy();
      expect(screen.getByText('Source: Reports → Overview')).toBeTruthy();
    });

    it('shows a loading skeleton while the answer is in flight', async () => {
      let resolveResponse!: (value: Response) => void;
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string) => {
          if (String(url).endsWith('/copilot/bi')) {
            return new Promise<Response>((resolve) => {
              resolveResponse = resolve;
            });
          }
          return okJson({});
        }),
      );
      renderPanel();

      await userEvent.type(screen.getByLabelText('Ask about your reports'), QUESTION);
      const askButton = screen.getByRole('button', { name: 'Ask' });
      await userEvent.click(askButton);

      // The skeleton is a visual courtesy, not content — it stays out of the
      // accessibility tree while the request is in flight.
      expect(screen.getByRole('button', { name: 'Asking…' })).toBeTruthy();
      expect(screen.queryByText('Source: Reports → Overview')).toBeNull();

      resolveResponse(
        okJson({
          answer: 'Your team closed 12 chats this week.',
          kind: 'metric',
          metric: 'totals.closed',
          value: 12,
          range: { from: '2026-08-03T00:00:00.000Z', to: '2026-08-08T23:59:59.999Z' },
        }),
      );
      expect(
        await screen.findByText('Your team closed 12 chats this week.'),
      ).toBeTruthy();
    });

    it('shows an error rather than swallowing a failed request', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string) => {
          if (String(url).endsWith('/copilot/bi')) {
            return {
              ok: false,
              status: 500,
              headers: { get: () => null },
              json: async () => ({ error: { type: 'internal', message: 'boom', request_id: 'r1' } }),
            } as unknown as Response;
          }
          return okJson({});
        }),
      );
      renderPanel();

      await userEvent.type(screen.getByLabelText('Ask about your reports'), QUESTION);
      await userEvent.click(screen.getByRole('button', { name: 'Ask' }));

      expect(await screen.findByRole('alert')).toHaveProperty(
        'textContent',
        'Could not get an answer — try again.',
      );
    });
  });
});
