/**
 * The customer directory in a browser.
 *
 * The integration suite already proves the API's isolation, scopes and paging.
 * What only a browser can show is whether an agent can actually find someone,
 * read their history and act on it — and whether the page a visitor wrote from
 * survives all the way from the widget to the panel an agent reads.
 */
import {
  expect,
  test,
  introduceVisitor,
  openWidget,
  PRECHAT_VISITOR,
  visitorSends,
  widgetFrame,
} from './fixtures.js';

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
    await expect(agentPage.getByLabel('Name', { exact: true })).toHaveValue('Robin Fields');
  });

  test('bans and unbans, keeping the history', async ({ agentPage }) => {
    await agentPage.goto('/app/customers');
    // Searched for, not expected on the first page: the list opens newest activity first, and
    // every spec before this one in the shard adds visitors to the shared workspace, so the
    // seeded Mira can sit past the first fifty rows (red in tm 336.2 and 339.2). The search
    // survives the segment tabs below, so it holds her on screen for the whole journey.
    await agentPage.getByRole('searchbox', { name: 'Search customers' }).fill('mira');
    await agentPage.getByRole('button', { name: /Mira Haddad/ }).click();

    // Banning asks first (tm 259.8): Cancel leaves her unbanned, the confirmed
    // click bans. Lifting the ban, further down, asks nothing.
    await agentPage.getByRole('button', { name: 'Ban customer' }).click();
    const dialog = agentPage.getByRole('dialog', { name: 'Ban Mira Haddad?' });
    await expect(dialog).toContainText('will not be able to start new conversations');
    await agentPage.screenshot({ path: 'kanit/259.8-ban-confirm.png', fullPage: true });
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
    await expect(agentPage.getByRole('button', { name: 'Lift ban' })).toHaveCount(0);

    await agentPage.getByRole('button', { name: 'Ban customer' }).click();
    await dialog.getByRole('button', { name: 'Ban', exact: true }).click();
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
      await visitorSends(visitor, `Where is my order? ${Date.now().toString().slice(-6)}`);

      await agentPage.goto('/app/customers');
      // The widget visitor is the one who just introduced themselves through
      // the pre-chat form, the newest contact at the top of the list.
      await agentPage
        .getByRole('button', { name: new RegExp(PRECHAT_VISITOR.name) })
        .first()
        .click();

      await expect(agentPage.getByText('Visited pages')).toBeVisible();
      await expect(agentPage.getByText(/demo\.html/)).toBeVisible();
    } finally {
      await visitorContext.close();
    }
  });

  test('shows a visitor who typed a known username as a possible match, links and unlinks them (ID-03)', async ({
    browser,
    agentPage,
    organizationId,
  }) => {
    // The same member on two devices: nothing recognises the second as the
    // first (K4), and the username they typed again only surfaces the earlier
    // record to the agent, unverified, until an admin links the two.
    const stamp = Date.now().toString().slice(-6);
    const username = `mira_${stamp}`;
    const laptopName = `Mira Laptop ${stamp}`;
    const phoneName = `Mira Phone ${stamp}`;
    const contexts = [await browser.newContext(), await browser.newContext()];

    try {
      for (const [index, name] of [laptopName, phoneName].entries()) {
        const visitor = await contexts[index]!.newPage();
        await openWidget(visitor, organizationId);
        const recorded = visitor.waitForResponse(
          (response) =>
            response.url().includes('/customer/chat/events') &&
            response.request().method() === 'POST' &&
            response.ok(),
        );
        await introduceVisitor(widgetFrame(visitor), `Hello, this is ${name}`, {
          name,
          // Typed differently each time — the match folds case and spaces.
          username: index === 0 ? username : ` ${username.toUpperCase()} `,
          email: `${username}-${index}@example.test`,
        });
        await recorded;
      }

      await agentPage.goto('/app/customers');
      await agentPage.getByRole('searchbox', { name: 'Search customers' }).fill(phoneName);
      await agentPage.getByRole('button', { name: new RegExp(phoneName) }).click();

      await expect(agentPage.getByRole('heading', { name: /Possible matches/ })).toContainText(
        'unverified',
      );
      await expect(agentPage.getByText('Same username', { exact: true })).toBeVisible();

      await agentPage.getByRole('button', { name: 'Link as same person' }).click();
      const linkDialog = agentPage.getByRole('dialog', {
        name: `Link ${laptopName} to ${phoneName} as the same person?`,
      });
      await linkDialog.getByRole('button', { name: 'Link records' }).click();
      await expect(linkDialog).toBeHidden();

      // The merged history: the laptop's conversation now shows on the phone's
      // profile, under the linked record.
      await expect(agentPage.getByRole('heading', { name: /Same person/ })).toBeVisible();
      // The match is marked linked, so it offers no second link.
      await expect(agentPage.getByRole('button', { name: 'Link as same person' })).toHaveCount(0);
      await expect(agentPage.getByRole('link', { name: /Conversation of/ })).toHaveCount(2);

      // Undone, the histories show apart again and the match can be linked anew.
      await agentPage.getByRole('button', { name: 'Unlink' }).click();
      const unlinkDialog = agentPage.getByRole('dialog', { name: `Unlink ${laptopName}?` });
      await unlinkDialog.getByRole('button', { name: 'Unlink' }).click();
      await expect(agentPage.getByRole('heading', { name: /Same person/ })).toHaveCount(0);
      await expect(agentPage.getByRole('button', { name: 'Link as same person' })).toBeVisible();

      // The agent talking to the phone sees the match in the inbox too, and
      // can go from there to the earlier record.
      await agentPage.getByRole('link', { name: /Conversation of/ }).click();
      // The inbox reads `?chat=` and drops it from the address, so the open
      // conversation is the proof, not the URL.
      await expect(agentPage.getByRole('heading', { name: phoneName, level: 2 })).toBeVisible();
      await expect(agentPage.getByText('Possible matches (unverified)')).toBeVisible();
      await agentPage.getByRole('link', { name: laptopName }).click();
      await expect(agentPage.getByRole('heading', { name: laptopName, level: 2 })).toBeVisible();
    } finally {
      for (const context of contexts) await context.close();
    }
  });
});
