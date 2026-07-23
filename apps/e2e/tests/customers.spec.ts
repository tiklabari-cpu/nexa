/**
 * The customer directory in a browser.
 *
 * The integration suite already proves the API's isolation, scopes and paging.
 * What only a browser can show is whether an agent can actually find someone,
 * read their history and act on it — and whether the page a visitor wrote from
 * survives all the way from the widget to the panel an agent reads.
 */
import { expect, test, openWidget, visitorSends } from './fixtures.js';

test.describe('customers', () => {
  test('lists people with conversation counts the stored column would get wrong', async ({
    agentPage,
  }) => {
    await agentPage.getByRole('link', { name: 'Customers' }).click();
    await expect(agentPage.getByRole('heading', { name: 'Customers', level: 1 })).toBeVisible();

    const table = agentPage.getByRole('table', { name: 'Customers' });
    await expect(table).toBeVisible();
    // The seed gives Alex a conversation. `customers.chats_count` is never
    // written by anything, so a screen reading it would show 0 here.
    const alex = table.getByRole('row').filter({ hasText: 'Alex Moreau' });
    await expect(alex).toContainText('1');
  });

  test('searches by name and by email', async ({ agentPage }) => {
    await agentPage.goto('/app/customers');
    const search = agentPage.getByRole('searchbox', { name: 'Search customers' });
    const table = agentPage.getByRole('table', { name: 'Customers' });

    await search.fill('mira');
    await expect(table.getByRole('row').filter({ hasText: 'Mira Haddad' })).toBeVisible();
    await expect(table.getByRole('row').filter({ hasText: 'Alex Moreau' })).toHaveCount(0);

    await search.fill('alex@acme-customer');
    await expect(table.getByRole('row').filter({ hasText: 'Alex Moreau' })).toBeVisible();

    await search.fill('nobody-by-this-name');
    await expect(agentPage.getByText('Nobody matches that search')).toBeVisible();
  });

  test('filters to leads', async ({ agentPage }) => {
    await agentPage.goto('/app/customers');
    await agentPage.getByRole('tab', { name: 'Leads' }).click();

    const table = agentPage.getByRole('table', { name: 'Customers' });
    await expect(table.getByRole('row').filter({ hasText: 'Alex Moreau' })).toBeVisible();
    await expect(table.getByRole('row').filter({ hasText: 'Mira Haddad' })).toHaveCount(0);
  });

  test('edits a customer without touching the fields left alone', async ({ agentPage }) => {
    await agentPage.goto('/app/customers');
    await agentPage.getByRole('button', { name: /Robin Fields/ }).click();

    const phone = agentPage.getByLabel('Phone');
    await expect(phone).toBeVisible();
    const newPhone = `+4477${Date.now().toString().slice(-6)}`;
    await phone.fill(newPhone);
    await agentPage.getByRole('button', { name: 'Save changes' }).click();

    await agentPage.reload();
    await agentPage.getByRole('button', { name: /Robin Fields/ }).click();
    await expect(agentPage.getByLabel('Phone')).toHaveValue(newPhone);
    // The name was never sent, so it must be untouched.
    await expect(agentPage.getByLabel('Name')).toHaveValue('Robin Fields');
  });

  test('bans and unbans, keeping the history', async ({ agentPage }) => {
    await agentPage.goto('/app/customers');
    await agentPage.getByRole('button', { name: /Mira Haddad/ }).click();

    await agentPage.getByRole('button', { name: 'Ban customer' }).click();
    await expect(agentPage.getByRole('button', { name: 'Lift ban' })).toBeVisible();

    const table = agentPage.getByRole('table', { name: 'Customers' });
    await agentPage.getByRole('tab', { name: 'Banned' }).click();
    await expect(table.getByRole('row').filter({ hasText: 'Mira Haddad' })).toBeVisible();

    await agentPage.getByRole('button', { name: /Mira Haddad/ }).click();
    await agentPage.getByRole('button', { name: 'Lift ban' }).click();

    // She leaves the Banned segment, and the panel clears with her rather than
    // showing a record that no longer belongs to the list on screen.
    await expect(table.getByRole('row').filter({ hasText: 'Mira Haddad' })).toHaveCount(0);
    await expect(agentPage.getByText('Select someone to see their history.')).toBeVisible();

    // And she is back under All, unbanned.
    await agentPage.getByRole('tab', { name: 'All' }).click();
    await agentPage.getByRole('button', { name: /Mira Haddad/ }).click();
    await expect(agentPage.getByRole('button', { name: 'Ban customer' })).toBeVisible();
  });

  test('shows the page a visitor wrote from', async ({ browser, agentPage, organizationId }) => {
    // Visits were never recorded before — the table existed and stayed empty,
    // so this panel had nothing to show for anyone.
    const visitorContext = await browser.newContext();
    const visitor = await visitorContext.newPage();

    try {
      await openWidget(visitor, organizationId);
      await visitorSends(visitor, `Where is my order? ${Date.now()}`);

      await agentPage.goto('/app/customers');
      // The widget visitor is anonymous, which is exactly who this has to work
      // for: they have no name to search by.
      await agentPage
        .getByRole('button', { name: /Unnamed visitor/ })
        .first()
        .click();

      await expect(agentPage.getByText('Visited pages')).toBeVisible();
      await expect(agentPage.getByText(/demo\.html/)).toBeVisible();
    } finally {
      await visitorContext.close();
    }
  });
});
