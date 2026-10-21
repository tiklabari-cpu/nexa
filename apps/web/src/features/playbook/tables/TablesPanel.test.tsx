/**
 * The "Tablolar" view (tm 310.5 · AI-13, K13): four tabs with their review
 * badges, the row form with the server's problems beside the fields, "reviewed"
 * and delete, and the access information card with its tenant note.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as AuthStore from '../../../lib/auth-store.js';
import { ApiClientError } from '../../../lib/api-client.js';
import type { TableRow } from './table-form.js';

const { api } = vi.hoisted(() => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    getFile: vi.fn(),
  },
}));

vi.mock('../../../lib/auth-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof AuthStore>();
  return { ...actual, useApiClient: () => api };
});

const { TablesPanel } = await import('./TablesPanel.js');
const { useAuth } = await import('../../../lib/auth-store.js');

function row(id: string, over: Record<string, unknown> = {}): TableRow {
  return {
    id,
    brand_ids: [],
    owner_id: null,
    reviewed_at: '2026-10-10T00:00:00.000Z',
    review_interval_days: 14,
    review_due_at: '2026-10-24T00:00:00.000Z',
    stale: false,
    source: 'manual',
    created_by: null,
    updated_by: null,
    created_at: '2026-10-10T00:00:00.000Z',
    updated_at: '2026-10-10T00:00:00.000Z',
    ...over,
  } as TableRow;
}

const PAPARA = row('pm-1', {
  name: 'Papara',
  direction: 'deposit',
  currency: 'TRY',
  min_amount: 100,
  max_amount: 50000,
  expected_minutes: 30,
  active: true,
  stale: true,
  reviewed_at: '2026-09-01T00:00:00.000Z',
  review_due_at: '2026-09-15T00:00:00.000Z',
});
const HAVALE = row('pm-2', {
  name: 'Havale',
  direction: 'withdrawal',
  currency: 'TRY',
  min_amount: null,
  max_amount: null,
  expected_minutes: null,
  active: true,
});
const WELCOME = row('b-1', {
  name: 'Hoş geldin',
  type: 'welcome',
  min_deposit: 200,
  wagering_multiplier: 10,
  active_to: null,
});

const SETTING = {
  id: 'ai-1',
  brand_id: null,
  source_type: 'dynamic_url',
  kb_source_id: null,
  url: 'https://adres.ornek.com/guncel',
  cache_seconds: 300,
  fixed_text: null,
  last_value: 'https://giris7.ornek.com',
  last_fetched_at: '2026-10-21T08:00:00.000Z',
  created_by: null,
  updated_by: null,
  created_at: '2026-10-20T00:00:00.000Z',
  updated_at: '2026-10-21T08:00:00.000Z',
};

let lists: Record<string, TableRow[]>;
let settings: unknown[];

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  lists = {
    'payment-methods': [PAPARA, HAVALE],
    bonuses: [WELCOME],
    'kyc-documents': [],
    rules: [],
  };
  settings = [SETTING];
  api.get.mockImplementation((path: string) => {
    if (path.startsWith('/knowledge-tables/')) {
      return Promise.resolve({ items: lists[path.split('/')[2]!] ?? [] });
    }
    if (path === '/ai-access-info') return Promise.resolve({ items: settings });
    if (path === '/brands')
      return Promise.resolve({ items: [{ id: 'brand-a', name: 'Acme Casino' }] });
    if (path === '/agents') return Promise.resolve({ items: [{ id: 'acct-1', name: 'Dana' }] });
    if (path.startsWith('/knowledge-sources')) {
      return Promise.resolve({ items: [{ id: 'src-1', name: 'Adres satırı' }] });
    }
    return Promise.reject(new Error(`unexpected GET ${path}`));
  });
  api.post.mockResolvedValue(PAPARA);
  api.patch.mockResolvedValue(PAPARA);
  api.delete.mockResolvedValue(undefined);
  api.put.mockResolvedValue(SETTING);
  useAuth.setState({
    status: 'signed-in',
    accessToken: 'test-token',
    agent: {
      account_id: 'a-1',
      email: 'dana@acme.localhost',
      name: 'Dana Okonkwo',
      role: 'owner',
      organization_id: 'o-1',
      license_id: '1000003',
      scopes: ['agents-bot--all:rw'],
      routing_status: 'accepting_chats',
    },
  });
});

function renderPanel(): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <TablesPanel />
    </QueryClientProvider>,
  );
}

function refusal(problems: Array<{ field: string; code: string }>): ApiClientError {
  return new ApiClientError({
    type: 'validation',
    status: 400,
    message: 'raw english from the server',
    requestId: 'r-1',
    details: { reason: 'knowledge_table_row_invalid', problems },
  });
}

describe('the four tabs (AI-13)', () => {
  it('names each table with its row count and how many are due for review', async () => {
    renderPanel();

    const payments = await screen.findByRole('tab', { name: /Payment methods/ });
    await waitFor(() => expect(payments).toHaveTextContent('2'));
    expect(payments).toHaveTextContent('1 due');
    expect(screen.getByRole('tab', { name: /Bonuses/ })).toHaveTextContent('1');
    expect(screen.getByRole('tab', { name: /Bonuses/ })).not.toHaveTextContent('due');
    expect(screen.getByRole('tab', { name: /KYC documents/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Limits and rules/ })).toBeInTheDocument();
  });

  it('flags the stale row with the date it fell due, and not the fresh one', async () => {
    renderPanel();

    const papara = (await screen.findByText('Papara')).closest('tr')!;
    expect(papara).toHaveTextContent('Due for review since');
    const havale = screen.getByText('Havale').closest('tr')!;
    expect(havale).not.toHaveTextContent('Due for review');
    expect(havale).toHaveTextContent('Reviewed');
  });

  it('narrows to the rows due for review', async () => {
    const user = userEvent.setup();
    renderPanel();

    await screen.findByText('Havale');
    await user.click(screen.getByRole('checkbox', { name: /Only rows due for review \(1\)/ }));

    expect(screen.getByText('Papara')).toBeInTheDocument();
    expect(screen.queryByText('Havale')).toBeNull();
  });

  it('moves between tables and shows each one’s own empty state', async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(await screen.findByRole('tab', { name: /KYC documents/ }));

    expect(await screen.findByText('No KYC documents yet')).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith('/knowledge-tables/kyc-documents');
  });

  it('tells a reader without write access nothing to click: no add, import, edit or delete', async () => {
    useAuth.setState((state) => ({
      agent: state.agent ? { ...state.agent, scopes: ['agents-bot--all:ro'] } : state.agent,
    }));
    renderPanel();

    await screen.findByText('Papara');
    expect(screen.queryByRole('button', { name: 'Add a row' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Import CSV' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Edit / })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Delete / })).toBeNull();
    expect(screen.getByRole('button', { name: 'Export CSV' })).toBeInTheDocument();
  });
});

describe('reviewing and deleting a row', () => {
  it('marks a row reviewed without asking and without editing it', async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(await screen.findByRole('button', { name: 'Mark Papara as reviewed' }));

    expect(api.post).toHaveBeenCalledWith('/knowledge-tables/payment-methods/pm-1/review', {});
    expect(api.patch).not.toHaveBeenCalled();
  });

  it('asks before deleting, and cancel deletes nothing', async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(await screen.findByRole('button', { name: 'Delete Havale' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Delete “Havale”?');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(api.delete).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Delete Havale' }));
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete' }),
    );
    await waitFor(() =>
      expect(api.delete).toHaveBeenCalledWith('/knowledge-tables/payment-methods/pm-2'),
    );
  });

  it('does not offer to edit a row an integration wrote', async () => {
    lists['payment-methods'] = [
      row('pm-9', { name: 'Entegre', direction: 'deposit', source: 'integration' }),
    ];
    renderPanel();

    expect(await screen.findByText('From an integration')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit Entegre' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Mark Entegre as reviewed' })).toBeInTheDocument();
  });
});

describe('adding and editing a row', () => {
  it('posts the typed row and closes the form', async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(await screen.findByRole('button', { name: 'Add a row' }));
    const form = screen.getByRole('form', { name: 'Add a row' });
    await user.type(within(form).getByLabelText(/^Name/), 'Papara Kart');
    await user.type(within(form).getByLabelText('Minimum amount'), '100');
    await user.type(within(form).getByLabelText('Expected minutes'), '30');
    await user.click(within(form).getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(api.post).toHaveBeenCalled());
    expect(api.post.mock.calls[0]![0]).toBe('/knowledge-tables/payment-methods');
    expect(api.post.mock.calls[0]![1]).toMatchObject({
      name: 'Papara Kart',
      direction: 'deposit',
      min_amount: 100,
      expected_minutes: 30,
      review_interval_days: 14,
      brand_ids: [],
    });
    await waitFor(() => expect(screen.queryByRole('form', { name: 'Add a row' })).toBeNull());
  });

  it('puts every problem the server names beside its field and keeps the form open', async () => {
    const user = userEvent.setup();
    api.post.mockRejectedValue(
      refusal([
        { field: 'min_amount', code: 'min_above_max' },
        { field: 'name', code: 'taken' },
      ]),
    );
    renderPanel();

    await user.click(await screen.findByRole('button', { name: 'Add a row' }));
    const form = screen.getByRole('form', { name: 'Add a row' });
    await user.type(within(form).getByLabelText(/^Name/), 'Papara');
    await user.click(within(form).getByRole('button', { name: 'Save' }));

    expect(await within(form).findByText('The minimum is above the maximum.')).toBeInTheDocument();
    expect(
      within(form).getByText('Another row for the same brands already uses this name.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('form', { name: 'Add a row' })).toBeInTheDocument();
  });

  it('does not send JSON that does not parse', async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(await screen.findByRole('button', { name: 'Add a row' }));
    const form = screen.getByRole('form', { name: 'Add a row' });
    await user.type(within(form).getByLabelText(/^Name/), 'Papara');
    await user.type(within(form).getByLabelText('Working hours'), 'not json');
    await user.click(within(form).getByRole('button', { name: 'Save' }));

    expect(await within(form).findByText('This value is not valid.')).toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();
  });

  it('edits with a PATCH of the whole merged row', async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(await screen.findByRole('button', { name: 'Edit Papara' }));
    const form = screen.getByRole('form', { name: 'Edit this row' });
    expect(within(form).getByLabelText(/^Name/)).toHaveValue('Papara');
    const expected = within(form).getByLabelText('Expected minutes');
    await user.clear(expected);
    await user.type(expected, '45');
    await user.click(within(form).getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(api.patch).toHaveBeenCalled());
    expect(api.patch.mock.calls[0]![0]).toBe('/knowledge-tables/payment-methods/pm-1');
    expect(api.patch.mock.calls[0]![1]).toMatchObject({
      name: 'Papara',
      expected_minutes: 45,
      min_amount: 100,
      max_amount: 50000,
    });
  });
});

describe('the access information card (K13)', () => {
  it('says the information is entered by the workspace, and shows the last fetched value', async () => {
    renderPanel();

    const card = (await screen.findByRole('heading', { name: 'Access information' })).closest(
      'section',
    )!;
    expect(card).toHaveTextContent('This information is entered by your workspace');
    expect(
      await within(card).findByText(/Last value: https:\/\/giris7\.ornek\.com/),
    ).toBeInTheDocument();
    expect(within(card).getByLabelText('Address to fetch (https)')).toHaveValue(
      'https://adres.ornek.com/guncel',
    );
  });

  it('says nothing is set when the scope has no setting, and saves a fixed link for every brand', async () => {
    settings = [];
    const user = userEvent.setup();
    renderPanel();

    const card = (await screen.findByRole('heading', { name: 'Access information' })).closest(
      'section',
    )!;
    expect(await within(card).findByText('Nothing is set for this scope yet.')).toBeInTheDocument();

    await user.click(within(card).getByRole('radio', { name: 'A fixed link' }));
    await user.type(within(card).getByLabelText('Link'), 'https://giris7.ornek.com');
    await user.type(
      within(card).getByLabelText('Sentence that goes with the link'),
      'Güncel adres:',
    );
    await user.click(within(card).getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(api.put).toHaveBeenCalled());
    expect(api.put).toHaveBeenCalledWith('/ai-access-info', {
      brand_id: null,
      source_type: 'fixed_link',
      kb_source_id: null,
      url: 'https://giris7.ornek.com',
      cache_seconds: 300,
      fixed_text: 'Güncel adres:',
    });
    expect(await within(card).findByText('Saved.')).toBeInTheDocument();
  });

  it('puts the server’s refusal of an internal address beside the field', async () => {
    api.put.mockRejectedValue(refusal([{ field: 'url', code: 'invalid' }]));
    const user = userEvent.setup();
    renderPanel();

    const card = (await screen.findByRole('heading', { name: 'Access information' })).closest(
      'section',
    )!;
    const address = await within(card).findByLabelText('Address to fetch (https)');
    await user.clear(address);
    await user.type(address, 'https://10.0.0.5/x');
    await user.click(within(card).getByRole('button', { name: 'Save' }));

    expect(await within(card).findByText('This value is not valid.')).toBeInTheDocument();
  });

  it('offers a brand’s own setting separately from the every-brand one', async () => {
    const user = userEvent.setup();
    renderPanel();

    const card = (await screen.findByRole('heading', { name: 'Access information' })).closest(
      'section',
    )!;
    await user.selectOptions(await within(card).findByLabelText('Applies to'), 'brand-a');

    expect(await within(card).findByText('Nothing is set for this scope yet.')).toBeInTheDocument();
    await user.click(within(card).getByRole('radio', { name: 'A fixed link' }));
    await user.type(within(card).getByLabelText('Link'), 'https://marka.ornek.com');
    await user.click(within(card).getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(api.put).toHaveBeenCalled());
    expect(api.put.mock.calls[0]![1]).toMatchObject({
      brand_id: 'brand-a',
      source_type: 'fixed_link',
    });
  });
});
