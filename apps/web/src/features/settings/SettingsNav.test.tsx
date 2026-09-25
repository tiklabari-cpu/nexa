/**
 * The Settings shell (tm 255.10): grouped side navigation, one address per
 * section, scope-based visibility and a pin that the server keeps.
 *
 * What is proved here:
 *   - Every section file under `features/settings/` is reachable from the
 *     navigation and sits in a group — a file added without an entry, or an
 *     entry that renders nothing, is red.
 *   - A caller without a section's read scope is shown neither the section's
 *     link nor, when a whole group empties, the group's heading.
 *   - `/app/settings` and the old single-page anchors land on a section, and a
 *     hidden section's address does not render it.
 *   - The pin flips only once the server has answered.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import { ADMIN_SCOPES, DEFAULT_AGENT_SCOPES } from '@nexa/types';
import type * as AuthStore from '../../lib/auth-store.js';
import { settings as EN_SETTINGS } from '../../locales/en/settings.js';
import {
  SETTINGS_GROUPS,
  SETTINGS_SECTIONS,
  defaultSectionSlug,
  searchSections,
  visibleGroups,
  type SettingsSectionEntry,
} from './settings-sections.js';

/** `searchSections` takes a label resolver; the real one is `t()`, this is English. */
const englishLabel = (section: SettingsSectionEntry): string =>
  EN_SETTINGS[section.labelKey] ?? section.labelKey;

let currentScopes: string[] = [];

const { api } = vi.hoisted(() => ({
  api: { get: vi.fn(), put: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

vi.mock('../../lib/auth-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof AuthStore>();
  return {
    ...actual,
    useApiClient: () => api,
    useAuth: (selector: (state: { agent: { scopes: string[] } }) => unknown) =>
      selector({ agent: { scopes: currentScopes } }),
  };
});

const { SettingsNav } = await import('./SettingsNav.js');
const { SECTION_ELEMENTS, SettingsIndex, SettingsLayout, SettingsPage } =
  await import('./SettingsPage.js');

const ADMIN = [...DEFAULT_AGENT_SCOPES, ...ADMIN_SCOPES];
const AGENT = [...DEFAULT_AGENT_SCOPES];

/** Section component files: every `.tsx` here but the tests and the shell itself. */
const SECTION_FILES = Object.keys(import.meta.glob('./*.tsx'))
  .map((path) => path.replace(/^\.\//, '').replace(/\.tsx$/, ''))
  .filter((name) => !name.endsWith('.test') && !['SettingsPage', 'SettingsNav'].includes(name))
  .sort();

function Where(): ReactElement {
  const location = useLocation();
  return <p data-testid="where">{location.pathname}</p>;
}

function renderAt(path: string): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route
            path="/app/settings"
            element={
              <SettingsLayout>
                <SettingsIndex />
              </SettingsLayout>
            }
          />
          <Route
            path="/app/settings/:section"
            element={
              <SettingsLayout>
                <SettingsPage />
              </SettingsLayout>
            }
          />
          <Route path="*" element={null} />
        </Routes>
        <Where />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  api.get.mockReset();
  api.put.mockReset();
  // Every section's list reads come back empty; the pin reads pinned.
  api.get.mockImplementation((path: string) =>
    Promise.resolve(
      path === '/agents/me/ui-preferences' ? { settings_nav_pinned: true } : { items: [] },
    ),
  );
});

describe('Settings navigation catalogue (FR-MOD-08.1)', () => {
  it('maps every section file to exactly one navigation entry in a known group', () => {
    const mapped = SETTINGS_SECTIONS.flatMap((s) => (s.file ? [s.file] : [])).sort();
    // A section file with no entry is a section nobody can reach; an entry
    // naming a file that is gone is a dead link. Either is red here.
    expect(mapped).toEqual(SECTION_FILES);
    expect(new Set(mapped).size).toBe(mapped.length);
    // Measured 2026-09-23: 32 sections rendered on the single page; the audit
    // log's door is now the navigation's own link, so 31 section files.
    expect(SECTION_FILES).toHaveLength(31);

    const groups = new Set(SETTINGS_GROUPS.map((g) => g.key));
    for (const s of SETTINGS_SECTIONS) expect(groups.has(s.group), s.slug).toBe(true);
    // Every group the PRD names that has a screen carries at least one entry.
    for (const g of SETTINGS_GROUPS) {
      expect(
        SETTINGS_SECTIONS.some((s) => s.group === g.key),
        g.key,
      ).toBe(true);
    }
  });

  it('has an element for every in-settings address and an address for every element', () => {
    const addressed = SETTINGS_SECTIONS.filter((s) => !s.to)
      .map((s) => s.slug)
      .sort();
    expect(Object.keys(SECTION_ELEMENTS).sort()).toEqual(addressed);
    expect(new Set(SETTINGS_SECTIONS.map((s) => s.slug)).size).toBe(SETTINGS_SECTIONS.length);
  });

  it('shows an owner every group and every section', () => {
    const groups = visibleGroups(ADMIN);
    expect(groups.map((g) => g.key)).toEqual(SETTINGS_GROUPS.map((g) => g.key));
    expect(groups.flatMap((g) => g.sections)).toHaveLength(SETTINGS_SECTIONS.length);
  });
});

describe('searchSections (FR-MOD-08.1 · tm 255.11)', () => {
  it('returns nothing for an empty query', () => {
    expect(searchSections(ADMIN, '', englishLabel)).toEqual([]);
    expect(searchSections(ADMIN, '   ', englishLabel)).toEqual([]);
  });

  it('matches a section by a case-insensitive substring of its own label', () => {
    expect(searchSections(ADMIN, 'trusted', englishLabel).map((s) => s.slug)).toEqual([
      'trusted-domains',
    ]);
    expect(searchSections(ADMIN, 'TRUSTED DOMAINS', englishLabel).map((s) => s.slug)).toEqual([
      'trusted-domains',
    ]);
  });

  it('matches a section by a partial synonym in its keywords, not only its label', () => {
    // Nothing in "Two-factor authentication" or "SLA" spells these out.
    expect(searchSections(ADMIN, 'mfa', englishLabel).map((s) => s.slug)).toContain('two-factor');
    expect(searchSections(ADMIN, 'response time', englishLabel).map((s) => s.slug)).toContain(
      'sla',
    );
  });

  it('reports no matches for a query that names nothing', () => {
    expect(searchSections(ADMIN, 'xyzzy-not-a-setting', englishLabel)).toEqual([]);
  });

  it('never returns a section the caller has no scope to see', () => {
    // An agent cannot read Billing; the word from its own label finds nothing.
    expect(searchSections(AGENT, 'invoice', englishLabel)).toEqual([]);
    expect(searchSections(AGENT, 'subscription', englishLabel)).toEqual([]);
    // The same query for an owner finds it.
    expect(searchSections(ADMIN, 'invoice', englishLabel).map((s) => s.slug)).toContain('billing');
  });
});

describe('Settings navigation visibility (FR-MOD-08.1)', () => {
  function renderNav(): void {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <SettingsNav />
        </MemoryRouter>
      </QueryClientProvider>,
    );
  }

  it('renders an owner every group heading and every section link', () => {
    currentScopes = ADMIN;
    renderNav();
    const nav = screen.getByRole('navigation', { name: 'Settings navigation' });
    for (const heading of [
      'General',
      'Channels',
      'Routing',
      'Inbox',
      'Integrations',
      'Security',
      'Billing',
    ]) {
      expect(within(nav).getByText(heading)).toBeInTheDocument();
    }
    expect(within(nav).getAllByRole('link')).toHaveLength(SETTINGS_SECTIONS.length);
    expect(within(nav).getByRole('link', { name: 'Trusted domains' })).toHaveAttribute(
      'href',
      '/app/settings/trusted-domains',
    );
    expect(within(nav).getByRole('link', { name: 'Audit log' })).toHaveAttribute(
      'href',
      '/app/settings/audit-log',
    );
    expect(within(nav).getByRole('link', { name: 'Subscription and invoices' })).toHaveAttribute(
      'href',
      '/app/billing',
    );
  });

  it('does not render a section link, or an emptied group heading, to an agent without the scope', () => {
    currentScopes = AGENT;
    renderNav();
    const nav = screen.getByRole('navigation', { name: 'Settings navigation' });

    // Channels (channels--all:ro / access_rules), Routing (access_rules /
    // tickets--all), and Billing (billing scopes) hold nothing an agent reads.
    for (const heading of ['Channels', 'Routing', 'Billing']) {
      expect(within(nav).queryByText(heading)).not.toBeInTheDocument();
    }
    for (const link of [
      'Trusted domains',
      'All channels',
      'Chat routing',
      'Company details',
      'Audit log',
      'Scheduled exports',
      'Subscription and invoices',
    ]) {
      expect(within(nav).queryByRole('link', { name: link })).not.toBeInTheDocument();
    }

    // What an agent does read stays: their own notifications and second
    // factor, the saved replies and tags the composer offers, their tokens.
    for (const link of [
      'Notifications',
      'Two-factor authentication',
      'Saved replies',
      'Tags',
      'Personal access tokens',
    ]) {
      expect(within(nav).getByRole('link', { name: link })).toBeInTheDocument();
    }
    // Security keeps its heading because Two-factor authentication is in it.
    expect(within(nav).getByText('Security')).toBeInTheDocument();
  });

  it('drops a group heading the moment its last visible section goes', () => {
    // An owner minus the one scope that opens every Channels section but one…
    currentScopes = ['channels--all:rw'];
    expect(visibleGroups(currentScopes).map((g) => g.key)).toContain('channels');
    // …and with no scope at all, only the sections that read nothing remain.
    expect(visibleGroups([]).map((g) => g.key)).toEqual(['general', 'integrations', 'security']);
    expect(
      visibleGroups([])
        .flatMap((g) => g.sections)
        .map((s) => s.slug),
    ).toEqual(['notifications', 'integrations', 'mcp', 'two-factor']);
  });
});

describe('Settings navigation search (FR-MOD-08.1 · tm 255.11)', () => {
  function renderSearchableNav(): void {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <SettingsNav />
          <Where />
        </MemoryRouter>
      </QueryClientProvider>,
    );
  }

  it('finds a section by its own label', async () => {
    currentScopes = ADMIN;
    renderSearchableNav();
    const search = await screen.findByRole('combobox', { name: 'Search settings' });
    await userEvent.type(search, 'trusted');
    const results = screen.getByRole('listbox', { name: 'Search results' });
    expect(within(results).getAllByRole('option')).toHaveLength(1);
    expect(within(results).getByRole('option', { name: 'Trusted domains' })).toBeInTheDocument();
  });

  it('finds a section by a partial, case-insensitive keyword match, not just its label', async () => {
    currentScopes = ADMIN;
    renderSearchableNav();
    const search = screen.getByRole('combobox', { name: 'Search settings' });
    // "mfa" names nothing in the label "Two-factor authentication" — only the
    // section's keywords carry the synonym, and only part of one at that.
    await userEvent.type(search, 'MFA');
    expect(
      within(screen.getByRole('listbox', { name: 'Search results' })).getByRole('option', {
        name: 'Two-factor authentication',
      }),
    ).toBeInTheDocument();
  });

  it('reports no matches rather than an empty, unexplained list', async () => {
    currentScopes = ADMIN;
    renderSearchableNav();
    const search = screen.getByRole('combobox', { name: 'Search settings' });
    await userEvent.type(search, 'nonexistent-section-xyz');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(
      screen.getByText('No sections found for “nonexistent-section-xyz”.'),
    ).toBeInTheDocument();
  });

  it('never surfaces a section the caller has no scope to see, even under a matching query', async () => {
    // An agent cannot read Billing; searching the very word on its label must
    // not leak it into the results — the same courtesy hide as the grouped
    // navigation, not a second gate that could fall out of sync with it.
    currentScopes = AGENT;
    renderSearchableNav();
    const search = screen.getByRole('combobox', { name: 'Search settings' });
    await userEvent.type(search, 'invoice');
    expect(screen.getByText('No sections found for “invoice”.')).toBeInTheDocument();
    expect(
      screen.queryByRole('option', { name: 'Subscription and invoices' }),
    ).not.toBeInTheDocument();

    // What the agent *can* reach stays findable.
    await userEvent.clear(search);
    await userEvent.type(search, 'notif');
    expect(
      within(screen.getByRole('listbox', { name: 'Search results' })).getByRole('option', {
        name: 'Notifications',
      }),
    ).toBeInTheDocument();
  });

  it('walks results with the arrow keys, wrapping past either end', async () => {
    currentScopes = ADMIN;
    renderSearchableNav();
    const search = screen.getByRole('combobox', { name: 'Search settings' });
    // A single common letter matches enough labels to give the arrow keys
    // somewhere to walk.
    await userEvent.type(search, 'a');
    const options = within(screen.getByRole('listbox', { name: 'Search results' })).getAllByRole(
      'option',
    );
    expect(options.length).toBeGreaterThan(1);
    expect(options[0]).toHaveAttribute('aria-selected', 'true');

    await userEvent.keyboard('{ArrowUp}');
    expect(options[options.length - 1]).toHaveAttribute('aria-selected', 'true');

    await userEvent.keyboard('{ArrowDown}');
    expect(options[0]).toHaveAttribute('aria-selected', 'true');
  });

  it('opens the highlighted result on Enter and clears the search', async () => {
    currentScopes = ADMIN;
    renderSearchableNav();
    const search = screen.getByRole('combobox', { name: 'Search settings' });
    await userEvent.type(search, 'trusted domains');
    await userEvent.keyboard('{Enter}');
    expect(await screen.findByTestId('where')).toHaveTextContent('/app/settings/trusted-domains');
    expect(search).toHaveValue('');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('closes the search on Escape without touching the navigation underneath', async () => {
    currentScopes = ADMIN;
    renderSearchableNav();
    const search = screen.getByRole('combobox', { name: 'Search settings' });
    await userEvent.type(search, 'trusted');
    expect(screen.getByRole('listbox', { name: 'Search results' })).toBeInTheDocument();

    await userEvent.keyboard('{Escape}');
    expect(search).toHaveValue('');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    // The grouped list is back, not a blank pane.
    expect(screen.getByRole('link', { name: 'Trusted domains' })).toBeInTheDocument();
  });
});

describe('Settings addresses (FR-MOD-08.1)', () => {
  it('opens a section directly at its own address', async () => {
    currentScopes = ADMIN;
    renderAt('/app/settings/trusted-domains');
    expect(await screen.findByRole('heading', { name: 'Trusted domains' })).toBeInTheDocument();
    // One section per address — the neighbours are not on the page.
    expect(screen.queryByRole('heading', { name: 'IP allowlist' })).not.toBeInTheDocument();
    expect(screen.getByTestId('where')).toHaveTextContent('/app/settings/trusted-domains');
  });

  it('lands /app/settings on the first section the caller may open', async () => {
    currentScopes = AGENT;
    renderAt('/app/settings');
    await waitFor(() =>
      expect(screen.getByTestId('where')).toHaveTextContent('/app/settings/notifications'),
    );
  });

  it('sends an old single-page anchor to its section', () => {
    expect(defaultSectionSlug(ADMIN, '#section-channels')).toBe('channels');
    expect(defaultSectionSlug(ADMIN, '#section-sales-tracker')).toBe('sales-tracker');
    expect(defaultSectionSlug(ADMIN, '#widget-customization')).toBe('widget');
    expect(defaultSectionSlug(ADMIN, '#section-widget')).toBe('widget');
    // An anchor the caller may not open falls back rather than leaking it.
    expect(defaultSectionSlug(AGENT, '#section-channels')).toBe('notifications');
  });

  it('does not render a hidden section at its address — it goes back to the index', async () => {
    currentScopes = AGENT;
    renderAt('/app/settings/trusted-domains');
    await waitFor(() =>
      expect(screen.getByTestId('where')).toHaveTextContent('/app/settings/notifications'),
    );
    expect(screen.queryByRole('heading', { name: 'Trusted domains' })).not.toBeInTheDocument();
  });

  it('sends an unknown section back to the index', async () => {
    currentScopes = ADMIN;
    renderAt('/app/settings/no-such-section');
    await waitFor(() =>
      expect(screen.getByTestId('where')).toHaveTextContent('/app/settings/notifications'),
    );
  });
});

describe('Settings navigation pin (FR-MOD-08.1)', () => {
  it('unpins only once the server has kept the choice', async () => {
    currentScopes = AGENT;
    let answer: (value: unknown) => void = () => undefined;
    api.put.mockImplementation(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    );
    renderAt('/app/settings/notifications');

    const nav = await screen.findByTestId('settings-nav');
    expect(nav).toHaveAttribute('data-pinned', 'true');

    await userEvent.click(screen.getByRole('button', { name: 'Unpin side navigation' }));
    expect(api.put).toHaveBeenCalledWith('/agents/me/ui-preferences', {
      settings_nav_pinned: false,
    });
    // Still pinned while the write is in flight — no optimistic flip.
    expect(screen.getByTestId('settings-nav')).toHaveAttribute('data-pinned', 'true');

    answer({ settings_nav_pinned: false });
    await waitFor(() =>
      expect(screen.getByTestId('settings-nav')).toHaveAttribute('data-pinned', 'false'),
    );
    // Folded away, the links are still there to open on hover or focus.
    expect(
      within(screen.getByTestId('settings-nav')).getByRole('link', { name: 'Notifications' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pin side navigation' })).toBeInTheDocument();
  });

  it('starts folded away when the server says so', async () => {
    currentScopes = AGENT;
    api.get.mockImplementation((path: string) =>
      Promise.resolve(
        path === '/agents/me/ui-preferences' ? { settings_nav_pinned: false } : { items: [] },
      ),
    );
    renderAt('/app/settings/notifications');
    await waitFor(() =>
      expect(screen.getByTestId('settings-nav')).toHaveAttribute('data-pinned', 'false'),
    );
  });

  it('offers no pin to a caller who cannot write their own preferences', () => {
    currentScopes = ['tags--groups:ro'];
    renderAt('/app/settings/tags');
    expect(screen.queryByRole('button', { name: /side navigation/ })).not.toBeInTheDocument();
  });
});
