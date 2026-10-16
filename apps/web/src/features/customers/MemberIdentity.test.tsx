/**
 * Member recognition on the customer's profile (ID-03 · K4 · tm 287.4): the
 * unverified possible matches, the records an agent linked as the same person
 * (with their conversations — the merged history view), and forgetting this
 * person's browsers.
 *
 * What the API already proves (who may link, tenant isolation, the audit
 * trail) is `customer-identity-links.test.ts`; what only this screen can get
 * wrong is saying "unverified", asking before linking or unlinking, offering
 * the buttons only to those the route accepts, and sending the right request.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithLocale, resetLocale } from '../../test/i18n.js';
import {
  ForgetBrowsers,
  LinkedRecordsCard,
  PossibleMatchesCard,
  type CustomerIdentityLink,
  type PossibleMatchList,
} from './MemberIdentity.js';
import type { CustomerDetail } from './types.js';

const { api } = vi.hoisted(() => ({
  api: { get: vi.fn(), post: vi.fn(), delete: vi.fn() },
}));

vi.mock('../../lib/auth-store.js', () => ({
  useApiClient: () => api,
}));

const PHONE = {
  id: 'cust-phone',
  name: 'Phone Mira',
  username: 'mirah_92',
  email: null,
  last_activity_at: '2026-10-15T09:00:00.000Z',
};
const LAPTOP = {
  id: 'cust-laptop',
  name: null,
  username: null,
  email: 'mira@example.test',
  last_activity_at: '2026-10-14T09:00:00.000Z',
};

function matchList(over: Partial<PossibleMatchList> = {}): PossibleMatchList {
  return {
    enabled: true,
    items: [
      { customer: PHONE, matched_on: ['username'], linked: false },
      { customer: LAPTOP, matched_on: ['email'], linked: true },
    ],
    ...over,
  };
}

function detail(id: string, chats: CustomerDetail['chats']): Partial<CustomerDetail> {
  return { id, chats };
}

/** `api.get` by path; anything unrouted is a test bug, so it rejects loudly. */
function routeGets(routes: Record<string, unknown>): void {
  api.get.mockImplementation((path: string) =>
    path in routes
      ? Promise.resolve(routes[path])
      : Promise.reject(new Error(`unrouted GET ${path}`)),
  );
}

function renderUi(ui: ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  api.get.mockReset();
  api.post.mockReset();
  api.delete.mockReset();
});

describe('PossibleMatchesCard', () => {
  it('lists the matches as unverified, with what each shares', async () => {
    routeGets({ '/customers/cust-1/possible-matches': matchList() });
    renderUi(
      <PossibleMatchesCard customerId="cust-1" customerName="Mira" canLink onOpen={() => {}} />,
    );

    const heading = await screen.findByRole('heading', { name: /Possible matches/ });
    expect(heading).toHaveTextContent('(unverified)');
    const rows = screen.getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(within(rows[0]!).getByText('Phone Mira')).toBeInTheDocument();
    expect(within(rows[0]!).getByText('Same username')).toBeInTheDocument();
    expect(within(rows[1]!).getByText('Unnamed visitor')).toBeInTheDocument();
    expect(within(rows[1]!).getByText('Same email')).toBeInTheDocument();
    // Already linked: says so, offers no second link.
    expect(within(rows[1]!).getByText('Linked')).toBeInTheDocument();
    expect(
      within(rows[1]!).queryByRole('button', { name: 'Link as same person' }),
    ).not.toBeInTheDocument();
  });

  it('asks before linking, then links the record it was asked about', async () => {
    const user = userEvent.setup();
    routeGets({ '/customers/cust-1/possible-matches': matchList() });
    api.post.mockResolvedValue({});
    renderUi(
      <PossibleMatchesCard customerId="cust-1" customerName="Mira" canLink onOpen={() => {}} />,
    );

    await user.click(await screen.findByRole('button', { name: 'Link as same person' }));
    const dialog = screen.getByRole('dialog', {
      name: 'Link Phone Mira to Mira as the same person?',
    });
    expect(dialog).toHaveTextContent('The AI keeps answering each record');
    expect(api.post).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole('button', { name: 'Link records' }));
    expect(api.post).toHaveBeenCalledWith('/customers/cust-1/links', { customer_id: 'cust-phone' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('offers no link to someone the route would refuse', async () => {
    routeGets({ '/customers/cust-1/possible-matches': matchList() });
    renderUi(
      <PossibleMatchesCard
        customerId="cust-1"
        customerName="Mira"
        canLink={false}
        onOpen={() => {}}
      />,
    );

    expect(await screen.findByText('Phone Mira')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Link as same person' })).not.toBeInTheDocument();
  });

  it('opens a match on request', async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    routeGets({ '/customers/cust-1/possible-matches': matchList() });
    renderUi(
      <PossibleMatchesCard
        customerId="cust-1"
        customerName="Mira"
        canLink={false}
        onOpen={onOpen}
      />,
    );

    await user.click(await screen.findByRole('button', { name: 'Open record: Phone Mira' }));
    expect(onOpen).toHaveBeenCalledWith('cust-phone');
  });

  it.each([
    ['there are none', matchList({ items: [] })],
    ['the workspace turned them off', matchList({ items: [], enabled: false })],
  ])('renders nothing when %s', async (_case, list) => {
    routeGets({ '/customers/cust-1/possible-matches': list });
    const { container } = renderUi(
      <PossibleMatchesCard customerId="cust-1" customerName="Mira" canLink onOpen={() => {}} />,
    );

    await waitFor(() => expect(api.get).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });
});

describe('LinkedRecordsCard', () => {
  const link: CustomerIdentityLink = {
    customer_id: 'cust-1',
    linked_customer: PHONE,
    linked_at: '2026-10-16T08:00:00.000Z',
    linked_by: 'acct-1',
  };

  it('shows each linked record with its own conversations — the merged history', async () => {
    routeGets({
      '/customers/cust-1/links': { items: [link] },
      '/customers/cust-phone': detail('cust-phone', [
        {
          id: 'TPHONE0001',
          active: false,
          created_at: '2026-10-15T09:00:00.000Z',
          last_event_at: null,
        },
      ]),
    });
    renderUi(<LinkedRecordsCard customerId="cust-1" canLink={false} onOpen={() => {}} />);

    expect(await screen.findByRole('heading', { name: /Same person/ })).toBeInTheDocument();
    expect(screen.getByText('Phone Mira')).toBeInTheDocument();
    const conversation = await screen.findByRole('link', { name: /Conversation of/ });
    expect(conversation).toHaveAttribute('href', '/app/inbox?chat=TPHONE0001');
    // An agent reads the link; only the admin rank may undo it.
    expect(screen.queryByRole('button', { name: 'Unlink' })).not.toBeInTheDocument();
  });

  it('asks before unlinking, then undoes that link', async () => {
    const user = userEvent.setup();
    routeGets({
      '/customers/cust-1/links': { items: [link] },
      '/customers/cust-phone': detail('cust-phone', []),
    });
    api.delete.mockResolvedValue(undefined);
    renderUi(<LinkedRecordsCard customerId="cust-1" canLink onOpen={() => {}} />);

    expect(await screen.findByText('No conversations on this record.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Unlink' }));
    const dialog = screen.getByRole('dialog', { name: 'Unlink Phone Mira?' });
    await user.click(within(dialog).getByRole('button', { name: 'Unlink' }));

    expect(api.delete).toHaveBeenCalledWith('/customers/cust-1/links/cust-phone');
  });

  it('renders nothing when no record is linked', async () => {
    routeGets({ '/customers/cust-1/links': { items: [] } });
    const { container } = renderUi(
      <LinkedRecordsCard customerId="cust-1" canLink onOpen={() => {}} />,
    );

    await waitFor(() => expect(api.get).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });
});

describe('ForgetBrowsers', () => {
  afterEach(() => resetLocale());

  it("asks first, then forgets this person's browsers and says when", async () => {
    const user = userEvent.setup();
    api.post.mockResolvedValue({ customer_id: 'cust-1', revoked_at: '2026-10-16T08:30:00.000Z' });
    renderUi(<ForgetBrowsers customerId="cust-1" customerName="Mira" />);

    await user.click(screen.getByRole('button', { name: 'Forget this person’s browsers' }));
    const dialog = screen.getByRole('dialog', { name: 'Forget the browsers of Mira?' });
    expect(dialog).toHaveTextContent('Nothing is deleted and nobody is banned.');
    await user.click(within(dialog).getByRole('button', { name: 'Forget browsers' }));

    expect(api.post).toHaveBeenCalledWith('/customers/cust-1/revoke-member-tokens');
    expect(await screen.findByRole('status')).toHaveTextContent('Browsers forgotten');
  });

  it('speaks Turkish', () => {
    renderWithLocale(
      <MemoryRouter>
        <QueryClientProvider client={new QueryClient()}>
          <ForgetBrowsers customerId="cust-1" customerName="Mira" />
        </QueryClientProvider>
      </MemoryRouter>,
      'tr',
    );

    expect(
      screen.getByRole('button', { name: 'Bu kişinin tarayıcılarını unut' }),
    ).toBeInTheDocument();
  });
});
