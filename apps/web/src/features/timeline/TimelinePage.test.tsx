/**
 * The conversation timeline screen (ID-09 · tm 334.2).
 *
 * What is pinned: every loaded row stays in the page (no virtualisation) and
 * "Load more" appends the next 200; the filter box narrows the rows loaded so
 * far and says so while more remain; the AI's decisions show procedure, sources
 * and hand-over reason; the day view marks where each connection starts and a
 * connection view does not; the audit-retention note and the missing audit
 * permission; a conversation the caller cannot see is "not found"; and the
 * export dialog — masked by default, unmasked only for who may, the file asked
 * for with the choices made.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TimelineItem } from '@siyahtus/types';
import { ApiClientError } from '../../lib/api-client.js';
import type * as AuthStore from '../../lib/auth-store.js';

const { api, auth } = vi.hoisted(() => ({
  api: { get: vi.fn(), post: vi.fn(), postFile: vi.fn() },
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

const { TimelinePage } = await import('./TimelinePage.js');

const DAY = 'DAYAAAAAAA';
const ONE = 'CONNONE111';
const TWO = 'CONNTWO222';

function row(id: string, at: string, extra: Partial<TimelineItem> = {}): TimelineItem {
  return {
    id,
    at,
    kind: 'message',
    actor: { type: 'customer', id: 'cust-1', name: 'Mira Kaya' },
    chat_id: DAY,
    thread_id: ONE,
    text: `words of ${id}`,
    details: {},
    ...extra,
  };
}

const FIRST_PAGE: TimelineItem[] = [
  row('m1', '2026-10-29T08:00:01.250Z', { text: 'Where is my withdrawal?' }),
  row('d1', '2026-10-29T08:00:02.000Z', {
    kind: 'ai_decision',
    actor: { type: 'ai', id: null, name: null },
    text: 'handoff · procedure: Refund request',
    details: {
      source: 'ai_decision_log',
      decision: 'handoff',
      procedure_name: 'Refund request',
      step: 'collect_order',
      knowledge_source_ids: ['s1', 's2'],
      handoff_reason: 'low_confidence',
    },
  }),
  row('n1', '2026-10-29T08:01:00.000Z', {
    kind: 'note',
    actor: { type: 'agent', id: 'a1', name: 'Agent Ada' },
    text: 'Checked the ledger by hand',
  }),
  row('m2', '2026-10-29T09:10:00.000Z', {
    thread_id: TWO,
    text: 'I am back with a second question',
  }),
];

interface Page {
  items: TimelineItem[];
  next_page_id?: string;
  audit?: 'included' | 'not_permitted';
  audit_expired?: boolean;
}

function serve(pages: Record<string, Page>): void {
  api.get.mockImplementation((url: string) => {
    const cursor = new URL(url, 'http://x').searchParams.get('page_id') ?? 'first';
    const page = pages[cursor];
    if (!page) return Promise.reject(new Error(`no page ${cursor}`));
    return Promise.resolve({
      chat_id: DAY,
      thread_id: null,
      audit: 'included',
      audit_retained_since: '2025-10-29T00:00:00.000Z',
      audit_expired: false,
      ...page,
    });
  });
}

function Where(): null {
  const location = useLocation();
  (globalThis as { __where?: string }).__where = `${location.pathname}${location.search}`;
  return null;
}

function renderAt(address: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[address]}>
        <TimelinePage />
        <Where />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  api.get.mockReset();
  api.postFile.mockReset();
  auth.capabilities = {};
});
afterEach(() => vi.restoreAllMocks());

describe('TimelinePage', () => {
  it('lists every row in order with its kind, actor and the AI decision in full', async () => {
    serve({ first: { items: FIRST_PAGE } });
    renderAt(`/app/inbox/timeline?chat=${DAY}`);

    const list = await screen.findByRole('list', { name: 'Timeline rows' });
    const rows = within(list)
      .getAllByRole('listitem')
      .filter((li) => li.dataset['kind']);
    expect(rows.map((li) => li.dataset['kind'])).toEqual([
      'message',
      'ai_decision',
      'note',
      'message',
    ]);

    const decision = rows[1]!;
    expect(within(decision).getByText('Procedure: Refund request')).toBeInTheDocument();
    expect(within(decision).getByText('Step: collect_order')).toBeInTheDocument();
    expect(within(decision).getByText('2 knowledge sources read')).toBeInTheDocument();
    expect(within(decision).getByText('Handoff reason: low_confidence')).toBeInTheDocument();
    expect(within(rows[2]!).getByText('Checked the ledger by hand')).toBeInTheDocument();
    expect(screen.getByText('4 rows loaded')).toBeInTheDocument();
  });

  it('gives each time in the workspace clock with the UTC moment on hover', async () => {
    serve({ first: { items: FIRST_PAGE } });
    renderAt(`/app/inbox/timeline?chat=${DAY}`);
    await screen.findByRole('list', { name: 'Timeline rows' });
    const times = document.querySelectorAll('time');
    expect(times[0]).toHaveAttribute('title', 'UTC 2026-10-29 08:00:01.250');
    expect(times[0]).toHaveAttribute('datetime', '2026-10-29T08:00:01.250Z');
  });

  it('marks where each connection starts on the day view, and not inside one connection', async () => {
    serve({ first: { items: FIRST_PAGE } });
    const { unmount } = renderAt(`/app/inbox/timeline?chat=${DAY}`);
    await screen.findByRole('list', { name: 'Timeline rows' });
    expect(screen.getAllByText('Connection starts')).toHaveLength(2);
    expect(screen.getByText(ONE)).toBeInTheDocument();
    expect(screen.getByText(TWO)).toBeInTheDocument();
    unmount();

    serve({ first: { items: FIRST_PAGE.slice(0, 3) } });
    renderAt(`/app/inbox/timeline?chat=${DAY}&thread=${ONE}`);
    await screen.findByRole('list', { name: 'Timeline rows' });
    expect(screen.queryByText('Connection starts')).toBeNull();
    expect(api.get).toHaveBeenLastCalledWith(expect.stringContaining(`thread_id=${ONE}`));
    expect(screen.getByRole('link', { name: 'Show the whole day' })).toBeInTheDocument();
  });

  it('appends the next page on "Load more" and keeps the rows already loaded', async () => {
    serve({
      first: { items: FIRST_PAGE.slice(0, 2), next_page_id: 'p2' },
      p2: { items: FIRST_PAGE.slice(2) },
    });
    renderAt(`/app/inbox/timeline?chat=${DAY}`);
    await screen.findByText('Where is my withdrawal?');
    expect(screen.queryByText('Checked the ledger by hand')).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'Load more' }));
    expect(await screen.findByText('Checked the ledger by hand')).toBeInTheDocument();
    // Still in the page: this list is not virtualised.
    expect(screen.getByText('Where is my withdrawal?')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
    expect(screen.getByText('That is everything.')).toBeInTheDocument();
  });

  it('narrows the loaded rows with the filter box and says it covers only those', async () => {
    serve({ first: { items: FIRST_PAGE, next_page_id: 'p2' } });
    renderAt(`/app/inbox/timeline?chat=${DAY}`);
    await screen.findByText('Where is my withdrawal?');

    const box = screen.getByRole('searchbox', { name: 'Filter the loaded rows' });
    await userEvent.type(box, 'low_confidence');
    expect(screen.queryByText('Where is my withdrawal?')).toBeNull();
    expect(screen.getByText('Handoff reason: low_confidence')).toBeInTheDocument();
    expect(screen.getByText('Showing 1 of 4 loaded rows')).toBeInTheDocument();
    expect(screen.getByText(/covers the rows loaded so far/)).toBeInTheDocument();

    await userEvent.clear(box);
    await userEvent.type(box, 'nothing matches this');
    expect(screen.getByText('No loaded row matches')).toBeInTheDocument();
  });

  it('asks the server for the kinds ticked, in the address', async () => {
    serve({ first: { items: FIRST_PAGE } });
    renderAt(`/app/inbox/timeline?chat=${DAY}`);
    await screen.findByText('Where is my withdrawal?');

    await userEvent.click(screen.getByRole('checkbox', { name: 'Message' }));
    await waitFor(() => expect((globalThis as { __where?: string }).__where).toContain('kinds='));
    const asked = api.get.mock.calls.at(-1)?.[0] as string;
    expect(asked).toContain('kinds=');
    expect(asked).not.toMatch(/kinds=[^&]*\bmessage\b/);
    expect(asked).toMatch(/kinds=[^&]*ai_decision/);
  });

  it('says the audit records have passed retention, with no error', async () => {
    serve({ first: { items: FIRST_PAGE, audit_expired: true } });
    renderAt(`/app/inbox/timeline?chat=${DAY}`);
    expect(await screen.findByText(/Record retention has expired/)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('leaves the audit kind out for someone who cannot read the audit log', async () => {
    serve({ first: { items: FIRST_PAGE, audit: 'not_permitted' } });
    renderAt(`/app/inbox/timeline?chat=${DAY}`);
    await screen.findByText('Where is my withdrawal?');
    expect(screen.queryByRole('checkbox', { name: 'Audit' })).toBeNull();
    expect(screen.getByText(/Audit entries are not listed/)).toBeInTheDocument();
  });

  it('says "not found" for a conversation the caller cannot see', async () => {
    api.get.mockRejectedValue(
      new ApiClientError({ type: 'not_found', status: 404, message: 'x', requestId: 'r' }),
    );
    renderAt(`/app/inbox/timeline?chat=${DAY}`);
    expect(await screen.findByText('Conversation not found')).toBeInTheDocument();
  });

  it('asks to open it from a conversation when the address names none', () => {
    renderAt('/app/inbox/timeline');
    expect(screen.getByText('No conversation chosen')).toBeInTheDocument();
    expect(api.get).not.toHaveBeenCalled();
  });

  it('shows the export button only to who holds timeline.export', async () => {
    serve({ first: { items: FIRST_PAGE } });
    const { unmount } = renderAt(`/app/inbox/timeline?chat=${DAY}`);
    await screen.findByText('Where is my withdrawal?');
    expect(screen.queryByRole('button', { name: 'Export' })).toBeNull();
    unmount();

    auth.capabilities = { 'timeline.export': 'on' };
    renderAt(`/app/inbox/timeline?chat=${DAY}`);
    expect(await screen.findByRole('button', { name: 'Export' })).toBeInTheDocument();
  });
});

describe('the export dialog', () => {
  beforeEach(() => {
    URL.createObjectURL = vi.fn(() => 'blob:timeline');
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
  });

  it('downloads the whole connection masked by default, under the name the server gave', async () => {
    auth.capabilities = { 'timeline.export': 'on' };
    serve({ first: { items: FIRST_PAGE } });
    api.postFile.mockResolvedValue({ blob: new Blob(['x']), filename: 'siyahtus-timeline.csv' });
    renderAt(`/app/inbox/timeline?chat=${DAY}&thread=${ONE}`);

    await userEvent.click(await screen.findByRole('button', { name: 'Export' }));
    const dialog = await screen.findByRole('dialog');
    const mask = within(dialog).getByRole('checkbox', { name: 'Mask email and username' });
    expect(mask).toBeChecked();
    // Not the Founder: the box cannot be unticked.
    expect(mask).toBeDisabled();
    expect(
      within(dialog).getByText('Only the Founder can download without masking.'),
    ).toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole('radio', { name: /NDJSON/ }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Download' }));

    await waitFor(() => expect(api.postFile).toHaveBeenCalledTimes(1));
    expect(api.postFile).toHaveBeenCalledWith(`/chats/${DAY}/timeline/export`, {
      format: 'ndjson',
      thread_id: ONE,
      mask_pii: true,
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('lets the Founder download without masking', async () => {
    auth.capabilities = { 'timeline.export': 'on', 'timeline.export_unmasked': 'on' };
    serve({ first: { items: FIRST_PAGE } });
    api.postFile.mockResolvedValue({ blob: new Blob(['x']), filename: null });
    renderAt(`/app/inbox/timeline?chat=${DAY}`);

    await userEvent.click(await screen.findByRole('button', { name: 'Export' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(
      within(dialog).getByRole('checkbox', { name: 'Mask email and username' }),
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Download' }));

    await waitFor(() => expect(api.postFile).toHaveBeenCalledTimes(1));
    // The whole day: no connection in the request.
    expect(api.postFile).toHaveBeenCalledWith(`/chats/${DAY}/timeline/export`, {
      format: 'csv',
      mask_pii: false,
    });
  });

  it('keeps the dialog open and says why when the server refuses', async () => {
    auth.capabilities = { 'timeline.export': 'on' };
    serve({ first: { items: FIRST_PAGE } });
    api.postFile.mockRejectedValue(
      new ApiClientError({ type: 'authorization', status: 403, message: 'x', requestId: 'r' }),
    );
    renderAt(`/app/inbox/timeline?chat=${DAY}`);

    await userEvent.click(await screen.findByRole('button', { name: 'Export' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Download' }));
    expect(await within(dialog).findByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
