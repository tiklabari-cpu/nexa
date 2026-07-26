/**
 * The HelpDesk surface on the ticket pane (FR-MOD-13.6). These pin the four
 * actions the backend layer exposes onto the UI: setting priority, following and
 * unfollowing, merging into another ticket, and unmerging — both from a folded
 * child and from the primary that holds it. Each asserts the exact request the
 * control fires, and that a merged ticket goes read-only the way the server
 * requires.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TicketDetailPane, TicketList } from './TicketPane.js';
import type { Ticket, TicketDetail } from './types.js';
import { useAuth } from '../../lib/auth-store.js';

function makeSummary(overrides: Partial<Ticket> = {}): Ticket {
  return {
    id: 'TCK1',
    subject: 'Broken checkout',
    status: 'open',
    priority: 0,
    assignee_id: null,
    assignee_name: null,
    group_id: null,
    customer_id: 'cust-1',
    customer_name: 'Mira Haddad',
    customer_email: null,
    source_chat_id: null,
    merged_into_id: null,
    last_message_at: null,
    created_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeDetail(overrides: Partial<TicketDetail> = {}): TicketDetail {
  return {
    ...makeSummary(),
    source_chat: null,
    followers: [],
    merged_ticket_ids: [],
    ...overrides,
  };
}

const AGENTS = [
  { id: 'agent-1', name: 'Ada Agent' },
  { id: 'agent-2', name: 'Bo Agent' },
];

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

function stubFetch(detail: TicketDetail): { calls: Call[] } {
  const calls: Call[] = [];
  let current = detail;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const path = String(url).replace('/api/v1', '');
      const body = init?.body
        ? (JSON.parse(String(init.body)) as Record<string, unknown>)
        : undefined;
      calls.push({ method, path, body });

      if (path === '/agents') return okJson({ items: AGENTS });
      if (method === 'PATCH' && /^\/tickets\/[^/]+$/.test(path)) {
        current = { ...current, ...body };
        return okJson(current);
      }
      if (method === 'POST' && /\/merge$/.test(path)) {
        current = { ...current, merged_into_id: (body?.['into'] as string) ?? null };
        return okJson(current);
      }
      if (method === 'DELETE' && /\/merge$/.test(path)) {
        current = { ...current, merged_into_id: null, merged_ticket_ids: [] };
        return okJson(current);
      }
      if (method === 'POST' && /\/followers$/.test(path)) {
        current = {
          ...current,
          followers: [...current.followers, { account_id: String(body?.['account_id']), name: null }],
        };
        return okJson(current);
      }
      if (method === 'DELETE' && /\/followers\/[^/]+$/.test(path)) {
        const id = path.split('/').pop();
        current = { ...current, followers: current.followers.filter((f) => f.account_id !== id) };
        return okJson(current);
      }
      return okJson(current); // GET /tickets/:id
    }),
  );
  return { calls };
}

function renderPane(detail: TicketDetail, candidates: Ticket[] = []) {
  const handles = stubFetch(detail);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <TicketDetailPane ticketId={detail.id} candidates={candidates} />
    </QueryClientProvider>,
  );
  return handles;
}

beforeEach(() => {
  useAuth.setState({ status: 'signed-in', accessToken: 'test-token', agent: null });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('TicketList priority', () => {
  it('flags a non-default priority and leaves a normal one unlabelled', () => {
    const client = new QueryClient();
    render(
      <QueryClientProvider client={client}>
        <TicketList
          tickets={[
            makeSummary({ id: 't1', subject: 'Urgent one', priority: 100 }),
            makeSummary({ id: 't2', subject: 'Plain one', priority: 0 }),
          ]}
          loading={false}
          selectedId={null}
          onSelect={() => {}}
        />
      </QueryClientProvider>,
    );
    expect(screen.getByText('Urgent')).toBeInTheDocument();
    expect(screen.queryByText('Normal')).toBeNull();
  });
});

describe('TicketDetailPane HelpDesk actions', () => {
  it('sets priority through a PATCH', async () => {
    const handles = renderPane(makeDetail());
    const select = await screen.findByLabelText('Priority');
    await userEvent.selectOptions(select, '100');

    await waitFor(() =>
      expect(
        handles.calls.some((c) => c.method === 'PATCH' && c.body?.['priority'] === 100),
      ).toBe(true),
    );
  });

  it('adds a follower from the agent picker', async () => {
    const handles = renderPane(makeDetail());
    // The picker is empty until the agent list loads, so wait for the option.
    await screen.findByRole('option', { name: 'Ada Agent' });
    const select = screen.getByLabelText('Add a follower');
    await userEvent.selectOptions(select, 'agent-1');
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));

    await waitFor(() =>
      expect(
        handles.calls.some(
          (c) =>
            c.method === 'POST' &&
            c.path === '/tickets/TCK1/followers' &&
            c.body?.['account_id'] === 'agent-1',
        ),
      ).toBe(true),
    );
  });

  it('removes an existing follower', async () => {
    const handles = renderPane(
      makeDetail({ followers: [{ account_id: 'agent-2', name: 'Bo Agent' }] }),
    );
    const remove = await screen.findByRole('button', { name: 'Remove Bo Agent' });
    await userEvent.click(remove);

    await waitFor(() =>
      expect(
        handles.calls.some(
          (c) => c.method === 'DELETE' && c.path === '/tickets/TCK1/followers/agent-2',
        ),
      ).toBe(true),
    );
  });

  it('merges into another ticket from the candidate list', async () => {
    const handles = renderPane(makeDetail(), [
      makeSummary({ id: 'TCK2', subject: 'Duplicate report' }),
    ]);
    const select = await screen.findByLabelText('Merge into another ticket');
    await userEvent.selectOptions(select, 'TCK2');
    await userEvent.click(screen.getByRole('button', { name: 'Merge' }));

    await waitFor(() =>
      expect(
        handles.calls.some(
          (c) =>
            c.method === 'POST' && c.path === '/tickets/TCK1/merge' && c.body?.['into'] === 'TCK2',
        ),
      ).toBe(true),
    );
  });

  it('shows a merged ticket read-only and unmerges it', async () => {
    const handles = renderPane(makeDetail({ merged_into_id: 'TCK9' }));
    await screen.findByText(/Merged into/);

    // Folded in: it manages nothing of its own, and edits are refused server-side.
    expect(screen.getByLabelText('Subject')).toBeDisabled();
    expect(screen.queryByText('Followers')).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'Unmerge' }));
    await waitFor(() =>
      expect(
        handles.calls.some((c) => c.method === 'DELETE' && c.path === '/tickets/TCK1/merge'),
      ).toBe(true),
    );
  });

  it('lists tickets folded into a primary and unmerges one', async () => {
    const handles = renderPane(makeDetail({ merged_ticket_ids: ['TCK7'] }));
    await screen.findByText(/folded into this one/);

    await userEvent.click(screen.getByRole('button', { name: 'Unmerge' }));
    await waitFor(() =>
      expect(
        handles.calls.some((c) => c.method === 'DELETE' && c.path === '/tickets/TCK7/merge'),
      ).toBe(true),
    );
  });
});
