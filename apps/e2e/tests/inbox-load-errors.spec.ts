/**
 * A failed inbox load says so, and can be retried (tm 259.5 · UX audit Y2).
 *
 * The web suite pins each branch against a mocked client. What it cannot prove
 * is that a real 500 from the real network layer reaches the screen as an
 * alert, that the alert replaces the empty state in the browser an agent would
 * be looking at, and that "Try again" puts the real list back. `page.route`
 * makes the server fail on demand without touching the shared dev database.
 */
import type { Page } from '@playwright/test';
import { expect, openWidget, test, visitorSends } from './fixtures.js';

const INTERNAL_ERROR = {
  error: { type: 'internal', message: 'boom', request_id: 'e2e-259-5' },
};

async function failWith500(page: Page, glob: string): Promise<void> {
  await page.route(glob, (route) =>
    route.fulfill({ status: 500, contentType: 'application/json', json: INTERNAL_ERROR }),
  );
}

test('a 500 on the conversation list shows an alert, not "nothing here yet", and Try again recovers (tm 259.5)', async ({
  agentPage,
}) => {
  await failWith500(agentPage, '**/api/v1/chats?*');
  await agentPage.goto('/app/inbox');

  const list = agentPage.getByRole('region', { name: 'Conversations' });
  const alert = list.getByRole('alert');
  await expect(alert).toContainText("Conversations couldn't be loaded", { timeout: 20_000 });

  // The lie this task removes, and the stale counters that went with it.
  await expect(list.getByText('Nothing here yet')).toHaveCount(0);
  await expect(list.getByText('New conversations land here as they arrive.')).toHaveCount(0);
  await expect(agentPage.getByRole('navigation', { name: 'Inbox views' })).toContainText('—');

  await agentPage.screenshot({ path: 'kanit/259.5-inbox-load-error.png', fullPage: true });

  await agentPage.unroute('**/api/v1/chats?*');
  await alert.getByRole('button', { name: 'Try again' }).click();
  await expect(list.getByRole('alert')).toHaveCount(0, { timeout: 20_000 });
  // The tabs' own counters are back to numbers: the read really happened.
  await expect(list.getByRole('tab', { name: /^All/ })).not.toContainText('—');
});

test('a 500 on the open transcript says so and holds the composer until it loads (tm 259.5)', async ({
  agentPage,
  browser,
  organizationId,
}) => {
  const visitorContext = await browser.newContext();
  try {
    const visitor = await visitorContext.newPage();
    const question = `Transcript error — ${Date.now().toString().slice(-6)}`;
    await openWidget(visitor, organizationId);
    await visitorSends(visitor, question);

    const list = agentPage.getByRole('region', { name: 'Conversations' });
    await expect(list).toContainText(question, { timeout: 20_000 });

    // Fail only the opened conversation's events, then open it.
    await failWith500(agentPage, '**/api/v1/chats/*/events*');
    await list.getByRole('button').filter({ hasText: question }).click();

    const pane = agentPage.locator('main');
    const alert = pane.getByRole('alert');
    await expect(alert).toContainText("Messages couldn't be loaded", { timeout: 20_000 });
    await expect(pane.getByLabel('Reply to the customer')).toHaveCount(0);

    await agentPage.unroute('**/api/v1/chats/*/events*');
    await alert.getByRole('button', { name: 'Try again' }).click();
    await expect(pane.getByRole('alert')).toHaveCount(0, { timeout: 20_000 });
    await expect(pane.getByLabel('Reply to the customer')).toBeVisible();
    await expect(pane).toContainText(question);
  } finally {
    await visitorContext.close();
  }
});
