/**
 * Data retention, in a browser (NFR-C8).
 *
 * The integration suites already prove the mechanics: `retention-settings.test.ts`
 * runs two workspaces under two windows through one sweep, and
 * `customer-erasure.test.ts` attacks the erasure endpoint from every angle an
 * HTTP client can. What only a browser can show is that the PRD's two nouns —
 * a *configurable* window and a *right to erasure* — are reachable by the
 * person who would have to answer for them, without an API client.
 *
 * Two walks:
 *
 *   1. **The window is a choice.** An admin picks 30 days in Settings, the page
 *      says what will actually happen, and the value survives a reload — read
 *      back from the server rather than from the form that just set it.
 *   2. **Erasure, including the refusal.** A real visitor arrives through the
 *      cross-origin widget and sends a message, which is what creates the
 *      contact. The admin's first attempt is refused *because the conversation
 *      is live* — the invariant the sweep holds too — and the second, after
 *      archiving it, removes the person from the directory.
 *
 * Self-cleaning by construction, which this suite's shared seeded database
 * requires: walk 1 restores the window it changed, and walk 2 erases only the
 * visitor it created itself. No seeded contact is touched — erasing one would
 * take conversations out from under half the other specs.
 *
 * The contact is located through the API rather than by reading the screen, and
 * that is deliberate rather than a shortcut: an anonymous widget visitor has no
 * name and no e-mail, so there is nothing to search the directory for, and
 * picking "the newest row" would make this spec depend on an ordering no part
 * of the requirement is about.
 */
import { expect, test, openWidget, visitorSends, widgetFrame } from './fixtures.js';
import { allChats, API_BASE, ownerAccessToken } from './fixtures.js';

const RETENTION_SECTION = '#section-data-retention';

test.describe('data retention (NFR-C8)', () => {
  test('an admin chooses how long this workspace keeps its conversations', async ({
    agentPage,
  }) => {
    await agentPage.goto('/app/settings');

    const section = agentPage.locator(RETENTION_SECTION);
    const conversations = agentPage.getByLabel('Closed conversations');
    await expect(conversations).toBeVisible();
    // The workspace has chosen nothing yet, so the screen names the default it
    // is inheriting rather than showing an empty box.
    await expect(conversations).toHaveValue('');
    // Asked of the select, not of the option: an `<option>` is never "visible"
    // to Playwright, so `toBeVisible` on one is a guaranteed red.
    await expect(conversations).toContainText('Use the default (365 days)');
    await expect(section.getByText('Deleted after 365 days.')).toBeVisible();

    try {
      const saved = agentPage.waitForResponse(
        (response) =>
          response.url().endsWith('/settings/retention') && response.request().method() === 'PATCH',
      );
      await conversations.selectOption('30d');
      await section.getByRole('button', { name: 'Save' }).click();
      expect((await saved).status()).toBe(200);

      // The consequence, in the server's words — not a restatement of the
      // option that was just picked.
      await expect(section.getByText('Deleted after 30 days.')).toBeVisible();

      // Read back from the server: a reload re-fetches, so a value that only
      // ever lived in the form would come back empty here.
      await agentPage.reload();
      await expect(agentPage.getByLabel('Closed conversations')).toHaveValue('30d');

      await agentPage.screenshot({ path: 'kanit/C8-data-retention.png', fullPage: true });
    } finally {
      // Shared seeded database: leave the workspace as it was found, or every
      // later spec's conversations start ageing out on a window this test chose.
      const restored = agentPage.waitForResponse(
        (response) =>
          response.url().endsWith('/settings/retention') && response.request().method() === 'PATCH',
      );
      await agentPage.getByLabel('Closed conversations').selectOption('');
      await agentPage.locator(RETENTION_SECTION).getByRole('button', { name: 'Save' }).click();
      expect((await restored).status()).toBe(200);
    }
  });

  test('erasing a person is refused while their conversation is live, and works once it is closed', async ({
    agentPage,
    browser,
    organizationId,
    request,
  }) => {
    const visitorContext = await browser.newContext();
    const visitor = await visitorContext.newPage();

    try {
      // A contact of this test's own. The widget is the only thing that creates
      // one, and it is also what makes the refusal real: the visitor is holding
      // the conversation open on a second origin while the admin tries to erase.
      const message = `Erase me please — ${Date.now().toString().slice(-6)}`;
      await openWidget(visitor, organizationId);
      await visitorSends(visitor, message);

      const list = agentPage.getByRole('region', { name: 'Conversations' });
      await expect(list).toContainText(message, { timeout: 20_000 });

      const auth = { authorization: `Bearer ${await ownerAccessToken(request)}` };
      const chat = (await allChats(request, auth)).find(
        (row) => (row as { last_event?: { text?: string } }).last_event?.text === message,
      ) as { id: string; customer_id: string } | undefined;
      expect(chat, 'the visitor’s conversation should be listed').toBeTruthy();
      const customerUrl = `/app/customers?customer=${chat!.customer_id}`;

      // Attempt one: refused, and the reason is an instruction the admin can
      // act on rather than a permissions verdict that sends them to somebody
      // who cannot help.
      await agentPage.goto(customerUrl);
      await agentPage.getByRole('button', { name: 'Erase this person' }).click();
      await agentPage.getByRole('button', { name: 'Erase permanently' }).click();
      await expect(
        agentPage.getByText('They are in a live conversation. Close it first, then erase.'),
      ).toBeVisible();
      await agentPage.getByRole('button', { name: 'Cancel' }).click();

      // Close the conversation the way an agent would.
      await agentPage.goto('/app/inbox');
      await list.getByRole('button').filter({ hasText: message }).click();
      const details = agentPage.getByRole('complementary', { name: 'Conversation details' });
      const archived = agentPage.waitForResponse(
        (response) =>
          /\/chats\/[^/]+\/deactivate$/.test(response.url()) &&
          response.request().method() === 'POST',
      );
      await details.getByRole('button', { name: 'Archive conversation' }).click();
      expect((await archived).status()).toBe(200);

      // Attempt two: it goes.
      await agentPage.goto(customerUrl);
      const erased = agentPage.waitForResponse(
        (response) =>
          /\/customers\/[^/]+\/erase$/.test(response.url()) &&
          response.request().method() === 'POST',
      );
      await agentPage.getByRole('button', { name: 'Erase this person' }).click();
      await agentPage.getByRole('button', { name: 'Erase permanently' }).click();
      expect((await erased).status()).toBe(200);

      // The panel lets go of a record that no longer exists, rather than
      // showing a load error for the person it just deleted.
      await expect(agentPage.getByText('Select someone to see their history.')).toBeVisible();

      await agentPage.screenshot({ path: 'kanit/C8-right-to-erasure.png', fullPage: true });

      // The claim the screenshot cannot make: the conversation is gone from the
      // server, not merely from a list that has not refreshed.
      const gone = await request.get(`${API_BASE}/chats/${chat!.id}`, { headers: auth });
      expect(gone.status()).toBe(404);
      // And the widget the visitor left open is still a page rather than a
      // crash — this requirement says nothing about what a live socket shows
      // afterwards, so nothing more than that is asserted.
      await expect(widgetFrame(visitor).getByRole('log', { name: 'Conversation' })).toBeVisible();
    } finally {
      await visitorContext.close();
    }
  });
});
