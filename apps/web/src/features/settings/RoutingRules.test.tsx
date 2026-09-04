/**
 * Settings → Routing rules: the list's condition summary, and the create/delete
 * half of FR-MOD-08.6.1 the screen was missing.
 *
 * Skill-based routing (FR-MOD-08.6.3) adds `conditions.expertise_ids` to a
 * rule; this resolves those ids to skill names via the Skills catalogue rather
 * than showing raw numbers, while a rule's existing condition kinds (e.g.
 * `url_contains`) still read exactly as before it existed.
 *
 * The rest pins what the console sends and what it refuses to offer: a
 * conditional rule carries its URL condition, the fallback carries none (that
 * is what makes it the fallback), the option to create a fallback is not
 * offered while one already exists, and the fallback's own delete button is
 * dead — deleting it would be the way around the refusal to disable it.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import type * as AuthStore from '../../lib/auth-store.js';
import { renderWithLocale, resetLocale } from '../../test/i18n.js';

const { api } = vi.hoisted(() => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

vi.mock('../../lib/auth-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof AuthStore>();
  return { ...actual, useApiClient: () => api };
});

// Imported after the mock so the component picks up the stubbed client.
const { RoutingRules } = await import('./SettingsPage.js');

const SKILLS = {
  items: [
    { id: 1, name: 'Billing', slug: 'billing' },
    { id: 2, name: 'Technical support', slug: 'technical-support' },
  ],
};

const RULES = {
  items: [
    {
      id: 'rule-1',
      name: 'Billing questions',
      kind: 'chat',
      conditions: { expertise_ids: [1, 2] },
      target_group_id: 10,
      target_group_name: 'Billing team',
      priority: 1,
      is_fallback: false,
      enabled: true,
    },
    {
      id: 'rule-2',
      name: 'Checkout page',
      kind: 'chat',
      conditions: { url_contains: '/checkout' },
      target_group_id: 11,
      target_group_name: 'Sales',
      priority: 2,
      is_fallback: false,
      enabled: true,
    },
    {
      id: 'rule-3',
      name: null,
      kind: 'chat',
      conditions: {},
      target_group_id: 12,
      target_group_name: 'General',
      priority: 3,
      is_fallback: true,
      enabled: true,
    },
  ],
};

const TEAMS = {
  items: [
    { id: 10, name: 'Billing team' },
    { id: 11, name: 'Sales' },
  ],
};

/** The same rules with the fallback removed — a workspace that still needs one. */
const RULES_WITHOUT_FALLBACK = { items: RULES.items.filter((rule) => !rule.is_fallback) };

function renderComponent(ui: ReactElement): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

function mockGets(rules: unknown = RULES, teams: unknown = TEAMS): void {
  api.get.mockImplementation((path: string) => {
    if (path === '/settings/routing-rules') return Promise.resolve(rules);
    if (path === '/settings/expertise') return Promise.resolve(SKILLS);
    if (path === '/groups') return Promise.resolve(teams);
    return Promise.reject(new Error(`unexpected ${path}`));
  });
}

beforeEach(() => {
  api.get.mockReset();
  api.post.mockReset();
  api.delete.mockReset();
  mockGets();
});

describe('RoutingRules condition summary', () => {
  it("shows a rule's required skills by name rather than raw expertise ids", async () => {
    renderComponent(<RoutingRules canEdit={false} />);
    expect(
      await screen.findByText('skill Billing, Technical support → Billing team'),
    ).toBeInTheDocument();
  });

  it('still describes a non-skill condition as before (regression)', async () => {
    renderComponent(<RoutingRules canEdit={false} />);
    expect(await screen.findByText('url contains /checkout → Sales')).toBeInTheDocument();
  });

  it('describes the fallback rule with no conditions as "Anything"', async () => {
    renderComponent(<RoutingRules canEdit={false} />);
    expect(await screen.findByText('Anything → General')).toBeInTheDocument();
  });
});

describe('RoutingRules — adding a rule', () => {
  it('sends the URL condition, the team and the priority, then clears the form', async () => {
    renderComponent(<RoutingRules canEdit />);
    await screen.findByText('Checkout page');
    api.post.mockResolvedValue({});

    fireEvent.change(screen.getByLabelText('Rule name'), { target: { value: 'Pricing page' } });
    fireEvent.change(screen.getByLabelText('When the page URL contains'), {
      target: { value: '/pricing' },
    });
    fireEvent.change(screen.getByLabelText('Send to team'), { target: { value: '11' } });
    fireEvent.change(screen.getByLabelText('Priority'), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add rule' }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/settings/routing-rules', {
        name: 'Pricing page',
        conditions: { url_contains: ['/pricing'] },
        target_group_id: 11,
        priority: 5,
        is_fallback: false,
      }),
    );
    await waitFor(() => expect(screen.getByLabelText('Rule name')).toHaveValue(''));
  });

  it('sends no conditions at all when the rule is the fallback', async () => {
    // A fallback carrying conditions is not a fallback: it would stop catching
    // what nothing else matched, while the list would still call it one.
    mockGets(RULES_WITHOUT_FALLBACK);
    renderComponent(<RoutingRules canEdit />);
    await screen.findByText('Checkout page');
    api.post.mockResolvedValue({});

    fireEvent.change(screen.getByLabelText('Rule name'), { target: { value: 'Everything else' } });
    fireEvent.change(screen.getByLabelText('Send to team'), { target: { value: '10' } });
    fireEvent.click(
      screen.getByLabelText('Make this the fallback — it takes everything no other rule matched'),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Add rule' }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/settings/routing-rules', {
        name: 'Everything else',
        target_group_id: 10,
        priority: 0,
        is_fallback: true,
      }),
    );
  });

  it('does not offer the fallback option once the workspace has one', async () => {
    renderComponent(<RoutingRules canEdit />);
    await screen.findByText('Checkout page');

    expect(
      screen.queryByLabelText('Make this the fallback — it takes everything no other rule matched'),
    ).not.toBeInTheDocument();
  });

  it('keeps Submit closed until the conditional rule has a URL and a team', async () => {
    renderComponent(<RoutingRules canEdit />);
    await screen.findByText('Checkout page');

    expect(screen.getByRole('button', { name: 'Add rule' })).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Rule name'), { target: { value: 'Pricing page' } });
    fireEvent.change(screen.getByLabelText('When the page URL contains'), {
      target: { value: '/pricing' },
    });
    expect(screen.getByRole('button', { name: 'Add rule' })).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Send to team'), { target: { value: '11' } });
    expect(screen.getByRole('button', { name: 'Add rule' })).toBeEnabled();
  });

  it('offers no form at all when there is no team to route to', async () => {
    mockGets(RULES, { items: [] });
    renderComponent(<RoutingRules canEdit />);

    expect(
      await screen.findByText('Create a team first — a rule has to send conversations somewhere.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add rule' })).not.toBeInTheDocument();
  });
});

describe('RoutingRules — deleting a rule', () => {
  it('deletes the rule the button names', async () => {
    renderComponent(<RoutingRules canEdit />);
    await screen.findByText('Checkout page');
    api.delete.mockResolvedValue(undefined);

    fireEvent.click(screen.getByRole('button', { name: 'Delete rule Checkout page' }));

    await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/settings/routing-rules/rule-2'));
  });

  it('leaves the fallback undeletable, and says why', async () => {
    renderComponent(<RoutingRules canEdit />);
    await screen.findByText('Checkout page');

    const button = screen.getByRole('button', { name: 'Delete rule Everything else' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute(
      'title',
      'The fallback rule cannot be deleted — point it at another team instead',
    );
  });

  it('shows a read-only viewer no write control at all', async () => {
    renderComponent(<RoutingRules canEdit={false} />);
    await screen.findByText('Checkout page');

    expect(screen.queryByRole('button', { name: 'Add rule' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Delete rule/ })).not.toBeInTheDocument();
  });
});

/** One sentinel for this file's DoD claim of being translated (I18N-j, tm 133.10). */
describe('RoutingRules localisation (NFR-I18N2)', () => {
  afterEach(() => {
    resetLocale();
  });

  it('paints Routing in Turkish when that is the active locale', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderWithLocale(
      <QueryClientProvider client={queryClient}>
        <RoutingRules canEdit={false} />
      </QueryClientProvider>,
      'tr',
    );

    expect(await screen.findByRole('region', { name: 'Yönlendirme' })).toBeInTheDocument();
  });
});
