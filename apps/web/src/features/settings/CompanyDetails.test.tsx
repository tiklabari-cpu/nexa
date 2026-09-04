/**
 * Settings → Company details (FR-MOD-08.3 · M-CO-b): the server's saved values
 * land in the form, only the fields that actually changed are sent (the audit
 * entry records field names, so sending all four would misreport a postcode
 * fix), an empty optional clears to `null` rather than `''`, the sector picker
 * offers the closed list and nothing else, and someone without
 * `organization--my:rw` — or below `admin` — is not shown a section that only
 * leads to a 403.
 *
 * The timezone half of this task is tested where the decision actually lives,
 * against a real database: `apps/api/test/integration/work-schedule.test.ts`,
 * "the default week takes its zone from the company". What is checked here is
 * the consequence a person can see — that saving a zone says what it did and
 * did not do to the schedules already saved.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { COMPANY_SECTORS, type CompanyDetails as CompanyDetailsValue } from '@nexa/types';
import { CompanyDetails } from './CompanyDetails.js';
import { useAuth } from '../../lib/auth-store.js';
import { renderWithLocale, resetLocale } from '../../test/i18n.js';

const SAVED: CompanyDetailsValue = {
  name: 'Acme Support',
  sector: 'ecommerce_retail',
  address: '1 Market Street, Istanbul',
  timezone: 'Europe/Istanbul',
};

function okJson(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => body,
  } as unknown as Response;
}

let patchBodies: Array<Record<string, unknown>>;

function stubFetch(current: CompanyDetailsValue): void {
  patchBodies = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      if (String(url).endsWith('/settings/company') && method === 'PATCH') {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        patchBodies.push(body);
        return okJson({ ...current, ...body });
      }
      return okJson(current);
    }),
  );
}

function signedInAs(role: string): void {
  useAuth.setState({
    status: 'signed-in',
    accessToken: 'test-token',
    agent: {
      account_id: 'a-1',
      email: 'dana@acme.localhost',
      name: 'Dana Okonkwo',
      role,
      organization_id: 'o-1',
      license_id: '1000003',
      scopes: ['organization--my:rw'],
      routing_status: 'accepting_chats',
    },
  });
}

function tree(canManage: boolean): ReactElement {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <CompanyDetails canManage={canManage} />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

function renderCompany(): ReturnType<typeof render> {
  return render(tree(true));
}

beforeEach(() => {
  signedInAs('admin');
  stubFetch(SAVED);
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetLocale();
});

describe('CompanyDetails', () => {
  it("loads the server's saved values into the form", async () => {
    renderCompany();

    expect(await screen.findByLabelText('Company name')).toHaveValue('Acme Support');
    expect(screen.getByLabelText('Sector')).toHaveValue('ecommerce_retail');
    expect(screen.getByLabelText('Address')).toHaveValue('1 Market Street, Istanbul');
    expect(screen.getByLabelText('Time zone')).toHaveValue('Europe/Istanbul');
  });

  it('keeps Save disabled until something changes', async () => {
    renderCompany();
    expect(await screen.findByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('patches only the field that changed', async () => {
    renderCompany();

    const name = await screen.findByLabelText('Company name');
    await userEvent.clear(name);
    await userEvent.type(name, 'Acme Global');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(patchBodies).toHaveLength(1));
    // Not `{name, sector, address, timezone}` — the endpoint's audit entry
    // records which fields were written.
    expect(patchBodies[0]).toEqual({ name: 'Acme Global' });
  });

  it('clears an emptied address to null rather than an empty string', async () => {
    renderCompany();

    await userEvent.clear(await screen.findByLabelText('Address'));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(patchBodies).toHaveLength(1));
    expect(patchBodies[0]).toEqual({ address: null });
  });

  it('clears the sector to null through the "Not set" option', async () => {
    renderCompany();

    await userEvent.selectOptions(await screen.findByLabelText('Sector'), '');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(patchBodies).toHaveLength(1));
    expect(patchBodies[0]).toEqual({ sector: null });
  });

  it('offers the closed sector list and nothing else', async () => {
    renderCompany();

    const select = await screen.findByLabelText('Sector');
    const values = within(select)
      .getAllByRole('option')
      .map((option) => (option as HTMLOptionElement).value);
    // The 14 the database CHECK holds, plus the blank that means "not set".
    expect(values).toEqual(['', ...COMPANY_SECTORS]);
  });

  it('refuses a blank company name before it reaches the network', async () => {
    renderCompany();

    await userEvent.clear(await screen.findByLabelText('Company name'));
    // The error surfaces once the person has left the field — `useForm` shows
    // nothing under an untouched input.
    await userEvent.tab();

    expect(await screen.findByText('Enter the company name.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(patchBodies).toHaveLength(0);
  });

  it('says what saving a new zone did not do to the schedules already saved', async () => {
    renderCompany();

    await userEvent.selectOptions(await screen.findByLabelText('Time zone'), 'Asia/Tokyo');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(patchBodies).toHaveLength(1));
    expect(patchBodies[0]).toEqual({ timezone: 'Asia/Tokyo' });
    expect(await screen.findByText(/keep the zone they were saved with/)).toBeInTheDocument();
  });

  it('shows no such note when the save did not touch the zone', async () => {
    renderCompany();

    const name = await screen.findByLabelText('Company name');
    await userEvent.clear(name);
    await userEvent.type(name, 'Acme Global');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(patchBodies).toHaveLength(1));
    expect(screen.queryByText(/keep the zone they were saved with/)).not.toBeInTheDocument();
  });

  it('hides the section from a caller without the scope', () => {
    const { container } = render(tree(false));
    expect(container).toBeEmptyDOMElement();
  });

  it('hides the section from an agent, mirroring the routes’ admin gate', () => {
    signedInAs('agent');
    const { container } = render(tree(true));
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the section in Turkish too', async () => {
    renderWithLocale(tree(true), 'tr');

    expect(await screen.findByLabelText('Şirket adı')).toHaveValue('Acme Support');
    expect(screen.getByLabelText('Saat dilimi')).toHaveValue('Europe/Istanbul');
  });
});
