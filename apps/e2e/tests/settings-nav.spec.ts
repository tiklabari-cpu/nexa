/**
 * The Settings shell (tm 255.10): each section at its own address behind a
 * grouped side navigation, and an "Unpin side navigation" choice that follows
 * the user.
 *
 * The pin is account-scoped state in the shared seeded database, and tm 250
 * measured what an optimistic preference does to an e2e run: the navigation
 * outruns the write and the next test inherits the leftover. So every write
 * here is awaited on its response before anything navigates, and the pin is put
 * back through the API in `finally`, whatever the test did.
 */
import { expect, test, API_BASE, continuePastNarrowNotice, ownerAccessToken } from './fixtures.js';

const PREFS = `${API_BASE}/agents/me/ui-preferences`;

test.describe('Settings navigation (FR-MOD-08.1)', () => {
  test('a section opens at its own address, and the rest stay one click away', async ({
    agentPage,
  }) => {
    await agentPage.goto('/app/settings/trusted-domains');
    const nav = agentPage.getByRole('navigation', { name: 'Settings navigation' });
    await expect(
      agentPage.getByRole('region', { name: 'Trusted domains' }).getByText('acme-bikes.localhost'),
    ).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Trusted domains' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    // One section per address: a neighbour from the same group is not here.
    await expect(agentPage.getByRole('region', { name: 'IP allowlist' })).toHaveCount(0);

    // Every PRD group an owner can use is on the navigation.
    for (const group of ['General', 'Channels', 'Routing', 'Inbox', 'Integrations', 'Security']) {
      await expect(nav.getByText(group, { exact: true })).toBeVisible();
    }
    await agentPage.screenshot({ path: 'kanit/08.1-settings-nav.png', fullPage: true });

    // The navigation moves between sections without a reload.
    await nav.getByRole('link', { name: 'Chat routing' }).click();
    await expect(agentPage).toHaveURL(/\/app\/settings\/routing-rules$/);
    await expect(agentPage.getByRole('heading', { name: 'Routing', level: 2 })).toBeVisible();

    // Billing is a group whose one entry is the existing page.
    await expect(nav.getByRole('link', { name: 'Subscription and invoices' })).toHaveAttribute(
      'href',
      '/app/billing',
    );
  });

  test('the audit log keeps its address, and old single-page anchors still land', async ({
    agentPage,
  }) => {
    // Regression: `/app/settings/audit-log` predates the split and keeps working.
    await agentPage.goto('/app/settings/audit-log');
    await expect(agentPage.getByRole('heading', { name: 'Audit log', level: 1 })).toBeVisible();
    await expect(agentPage.getByRole('table', { name: 'Audit log' })).toBeVisible();
    const nav = agentPage.getByRole('navigation', { name: 'Settings navigation' });
    await expect(nav.getByRole('link', { name: 'Audit log' })).toHaveAttribute(
      'aria-current',
      'page',
    );

    // `/app/settings` itself lands on a section rather than an empty shell.
    await agentPage.goto('/app/settings');
    await expect(agentPage).toHaveURL(/\/app\/settings\/notifications$/);
    await expect(agentPage.getByRole('region', { name: 'Notifications' })).toBeVisible();

    // A bookmark from the single page still finds its section.
    await agentPage.goto('/app/settings#section-channels');
    await expect(agentPage).toHaveURL(/\/app\/settings\/channels$/);
    await expect(agentPage.getByRole('region', { name: 'Channels' })).toBeVisible();

    // An address that names no section goes back to the landing one.
    await agentPage.goto('/app/settings/no-such-section');
    await expect(agentPage).toHaveURL(/\/app\/settings\/notifications$/);
  });

  test('unpinning the navigation survives a reload', async ({ agentPage, request }) => {
    const token = await ownerAccessToken(request);
    const auth = { authorization: `Bearer ${token}` };
    // Start from the default whatever an earlier run left behind.
    expect(
      (await request.put(PREFS, { headers: auth, data: { settings_nav_pinned: true } })).ok(),
    ).toBe(true);

    try {
      await agentPage.goto('/app/settings/tags');
      const nav = agentPage.getByTestId('settings-nav');
      await expect(nav).toHaveAttribute('data-pinned', 'true');

      // The write is awaited before anything else happens — the tm 250 trap.
      const saved = agentPage.waitForResponse(
        (r) => r.url().endsWith('/agents/me/ui-preferences') && r.request().method() === 'PUT',
      );
      await agentPage.getByRole('button', { name: 'Unpin side navigation' }).click();
      const response = await saved;
      expect(response.status()).toBe(200);
      expect(await response.json()).toEqual({ settings_nav_pinned: false });
      await expect(nav).toHaveAttribute('data-pinned', 'false');

      // The server holds it, so a reload — a fresh read — keeps it.
      await agentPage.reload();
      await expect(agentPage.getByRole('region', { name: 'Tags' })).toBeVisible();
      await expect(agentPage.getByTestId('settings-nav')).toHaveAttribute('data-pinned', 'false');
      const stored = await request.get(PREFS, { headers: auth });
      expect(await stored.json()).toEqual({ settings_nav_pinned: false });
      await agentPage.screenshot({ path: 'kanit/08.1-settings-nav-unpinned.png', fullPage: true });

      // Folded away, the sections are still reachable from the strip.
      await agentPage.getByRole('button', { name: 'Pin side navigation' }).focus();
      await agentPage
        .getByRole('navigation', { name: 'Settings navigation' })
        .getByRole('link', { name: 'Saved replies' })
        .click();
      await expect(agentPage).toHaveURL(/\/app\/settings\/canned-responses$/);

      // And pinning it back is the same awaited write.
      const repinned = agentPage.waitForResponse(
        (r) => r.url().endsWith('/agents/me/ui-preferences') && r.request().method() === 'PUT',
      );
      await agentPage.getByRole('button', { name: 'Pin side navigation' }).click();
      expect((await repinned).status()).toBe(200);
      await expect(agentPage.getByTestId('settings-nav')).toHaveAttribute('data-pinned', 'true');
    } finally {
      await request.put(PREFS, { headers: auth, data: { settings_nav_pinned: true } });
    }
  });
});

test.describe('Settings navigation search (FR-MOD-08.1 · tm 255.11)', () => {
  test('finds a section by keyboard alone and opens it', async ({ agentPage }) => {
    await agentPage.goto('/app/settings/notifications');
    const search = agentPage.getByRole('combobox', { name: 'Search settings' });
    // A keyword, not the section's own label — proves the catalogue's
    // `keywords` list is actually reached, not just the visible name.
    await search.fill('mfa');
    const results = agentPage.getByRole('listbox', { name: 'Search results' });
    await expect(results.getByRole('option', { name: 'Two-factor authentication' })).toBeVisible();

    await search.press('Enter');
    await expect(agentPage).toHaveURL(/\/app\/settings\/two-factor$/);
    await expect(
      agentPage.getByRole('region', { name: 'Two-factor authentication' }),
    ).toBeVisible();
    // Enter both opened the result and cleared the search back to the groups.
    await expect(search).toHaveValue('');
    await expect(agentPage.getByRole('navigation', { name: 'Settings navigation' })).toBeVisible();
  });

  test('reports no matches, and Escape returns to the grouped list without navigating', async ({
    agentPage,
  }) => {
    await agentPage.goto('/app/settings/notifications');
    const search = agentPage.getByRole('combobox', { name: 'Search settings' });
    await search.fill('nonexistent-section-xyz');
    await expect(
      agentPage.getByText('No sections found for “nonexistent-section-xyz”.'),
    ).toBeVisible();

    await search.press('Escape');
    await expect(search).toHaveValue('');
    await expect(agentPage.getByRole('link', { name: 'Trusted domains' })).toBeVisible();
    // Still on the section the search was opened over — Escape did not navigate.
    await expect(agentPage).toHaveURL(/\/app\/settings\/notifications$/);
  });

  test('stays usable at a phone width', async ({ agentPage }) => {
    await agentPage.setViewportSize({ width: 390, height: 844 });
    await agentPage.goto('/app/settings/notifications');
    await continuePastNarrowNotice(agentPage);
    const search = agentPage.getByRole('combobox', { name: 'Search settings' });
    await expect(search).toBeVisible();
    await search.fill('trusted');
    await agentPage
      .getByRole('listbox', { name: 'Search results' })
      .getByRole('option', { name: 'Trusted domains' })
      .click();
    await expect(agentPage).toHaveURL(/\/app\/settings\/trusted-domains$/);
    await expect(agentPage.getByRole('region', { name: 'Trusted domains' })).toBeVisible();
    await agentPage.screenshot({ path: 'kanit/08.1-settings-search-mobile.png', fullPage: true });
  });
});
