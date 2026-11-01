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
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
      id: 'rule-4',
      name: 'Turkish deposit',
      kind: 'chat',
      conditions: {
        url_equals: ['https://site.com/tr/para-yatir'],
        country_codes: ['TR', 'AZ'],
        expertise_ids: [1],
      },
      target_group_id: 10,
      target_group_name: 'Billing team',
      priority: 4,
      is_fallback: false,
      enabled: true,
    },
    {
      id: 'rule-5',
      name: 'Two pages',
      kind: 'chat',
      conditions: { url_contains: ['/pricing', '/plans'] },
      target_group_id: 11,
      target_group_name: 'Sales',
      priority: 5,
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
  api.patch.mockReset();
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

  it('reads several values of one kind as alternatives and several kinds as all-of (AU-02)', async () => {
    renderComponent(<RoutingRules canEdit={false} />);
    expect(await screen.findByText('url contains /pricing or /plans → Sales')).toBeInTheDocument();
    expect(
      screen.getByText(
        'url is exactly https://site.com/tr/para-yatir and country TR or AZ and skill Billing → Billing team',
      ),
    ).toBeInTheDocument();
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

  it('sends several URL fragments, an exact URL and several countries (AU-02)', async () => {
    renderComponent(<RoutingRules canEdit />);
    await screen.findByText('Checkout page');
    api.post.mockResolvedValue({});

    fireEvent.change(screen.getByLabelText('Rule name'), { target: { value: 'TR deposit' } });
    const contains = screen.getByLabelText('When the page URL contains');
    fireEvent.change(contains, { target: { value: '/tr/' } });
    fireEvent.keyDown(contains, { key: 'Enter' });
    // Text still in the box when the form is sent counts as the last value.
    fireEvent.change(contains, { target: { value: '/deposit' } });
    fireEvent.change(screen.getByLabelText('When the page URL is exactly'), {
      target: { value: 'https://site.com/tr/para-yatir?utm_source=x' },
    });
    const country = screen.getByLabelText("When the visitor's country is");
    fireEvent.change(country, { target: { value: 'TR' } });
    fireEvent.change(country, { target: { value: 'AZ' } });
    fireEvent.change(screen.getByLabelText('Send to team'), { target: { value: '11' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add rule' }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/settings/routing-rules', {
        name: 'TR deposit',
        conditions: {
          url_contains: ['/tr/', '/deposit'],
          // The server normalises it (query dropped); the form sends what was typed.
          url_equals: ['https://site.com/tr/para-yatir?utm_source=x'],
          country_codes: ['TR', 'AZ'],
        },
        target_group_id: 11,
        priority: 0,
        is_fallback: false,
      }),
    );
  });

  it('lets a country alone be the whole condition, and lets a chip be removed', async () => {
    renderComponent(<RoutingRules canEdit />);
    await screen.findByText('Checkout page');
    api.post.mockResolvedValue({});

    fireEvent.change(screen.getByLabelText('Rule name'), { target: { value: 'Turkey' } });
    fireEvent.change(screen.getByLabelText('Send to team'), { target: { value: '10' } });
    expect(screen.getByRole('button', { name: 'Add rule' })).toBeDisabled();

    const country = screen.getByLabelText("When the visitor's country is");
    fireEvent.change(country, { target: { value: 'DE' } });
    fireEvent.change(country, { target: { value: 'TR' } });
    expect(screen.getByRole('button', { name: 'Add rule' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: /^Remove .*\(DE\)$/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Add rule' }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/settings/routing-rules', {
        name: 'Turkey',
        conditions: { country_codes: ['TR'] },
        target_group_id: 10,
        priority: 0,
        is_fallback: false,
      }),
    );
  });

  it('states the semantics and the unknown-country note beside the form', async () => {
    renderComponent(<RoutingRules canEdit />);
    expect(
      await screen.findByText(
        /Every kind of condition must hold; any one value of a kind is enough\./,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Visitors whose country is unknown fall through to the next rule\./),
    ).toBeInTheDocument();
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

describe('RoutingRules — editing a rule (AU-02)', () => {
  it('opens a rule written with one bare URL unchanged and saves it with the same URL', async () => {
    renderComponent(<RoutingRules canEdit />);
    await screen.findByText('Checkout page');
    api.patch.mockResolvedValue({});

    fireEvent.click(screen.getByRole('button', { name: 'Edit rule Checkout page' }));
    expect(screen.getByLabelText('Rule name')).toHaveValue('Checkout page');
    expect(screen.getByLabelText('Send to team')).toHaveValue('11');
    expect(screen.getByRole('button', { name: 'Remove /checkout' })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Priority'), { target: { value: '7' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save rule' }));

    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith('/settings/routing-rules/rule-2', {
        conditions: { url_contains: ['/checkout'] },
        target_group_id: 11,
        priority: 7,
      }),
    );
  });

  it('keeps the skills a rule requires when only its countries change', async () => {
    renderComponent(<RoutingRules canEdit />);
    await screen.findByText('Checkout page');
    api.patch.mockResolvedValue({});

    fireEvent.click(screen.getByRole('button', { name: 'Edit rule Turkish deposit' }));
    fireEvent.click(screen.getByRole('button', { name: /^Remove .*\(AZ\)$/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Save rule' }));

    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith('/settings/routing-rules/rule-4', {
        conditions: {
          url_equals: ['https://site.com/tr/para-yatir'],
          country_codes: ['TR'],
          expertise_ids: [1],
        },
        target_group_id: 10,
        priority: 4,
      }),
    );
  });

  it('refuses to save a conditional rule with every condition removed', async () => {
    renderComponent(<RoutingRules canEdit />);
    await screen.findByText('Checkout page');

    fireEvent.click(screen.getByRole('button', { name: 'Edit rule Checkout page' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove /checkout' }));
    expect(screen.getByRole('button', { name: 'Save rule' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('button', { name: 'Add rule' })).toBeInTheDocument();
    expect(api.patch).not.toHaveBeenCalled();
  });

  it('edits the fallback without sending conditions', async () => {
    renderComponent(<RoutingRules canEdit />);
    await screen.findByText('Checkout page');
    api.patch.mockResolvedValue({});

    fireEvent.click(screen.getByRole('button', { name: 'Edit rule Everything else' }));
    fireEvent.change(screen.getByLabelText('Send to team'), { target: { value: '10' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save rule' }));

    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith('/settings/routing-rules/rule-3', {
        target_group_id: 10,
        priority: 3,
      }),
    );
  });
});

describe('RoutingRules — deleting a rule', () => {
  it('deletes the rule the button names', async () => {
    renderComponent(<RoutingRules canEdit />);
    await screen.findByText('Checkout page');
    api.delete.mockResolvedValue(undefined);

    fireEvent.click(screen.getByRole('button', { name: 'Delete rule Checkout page' }));
    // Nothing is sent until the dialog is confirmed (tm 259.7).
    expect(api.delete).not.toHaveBeenCalled();
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }));

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
