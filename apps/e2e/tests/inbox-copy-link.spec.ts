/**
 * Copying a conversation's permanent link (FR-MOD-02.6).
 *
 * The web suite pins what the button writes to the clipboard against a
 * mocked client. What it cannot prove is the actual claim — that the copied
 * string is a *permanent* link: paste it somewhere new and the same
 * conversation opens. A second, fresh page in the same browser context is the
 * honest way to check that, since the access token lives in memory
 * (`auth-store.ts`) and only the refresh token persists in `localStorage`; a
 * page that has never signed in has to restore the session from that alone
 * before the deep link can even be consumed.
 */
import type { Page } from '@playwright/test';
import { expect, openWidget, test, visitorSends } from './fixtures.js';

test('the copied chat link opens the same conversation in a fresh page (FR-MOD-02.6)', async ({
  agentPage,
  browser,
  organizationId,
}) => {
  const visitorContext = await browser.newContext();
  const visitor = await visitorContext.newPage();
  let secondPage: Page | undefined;

  try {
    const question = `Copy this one — ${Date.now().toString().slice(-6)}`;
    await openWidget(visitor, organizationId);
    await visitorSends(visitor, question);

    const list = agentPage.getByRole('region', { name: 'Conversations' });
    await expect(list).toContainText(question, { timeout: 20_000 });
    await list.getByRole('button').filter({ hasText: question }).click();
    await expect(agentPage.locator('main')).toContainText(question);

    await agentPage.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await agentPage.getByRole('button', { name: 'Copy link' }).click();
    await expect(agentPage.getByRole('button', { name: 'Copied' })).toBeVisible();

    const link = await agentPage.evaluate(() => navigator.clipboard.readText());
    const url = new URL(link);
    // The route the deep-link effect consumes, plus the id of the chat that
    // was actually open — not a relative path, not some other conversation's.
    expect(url.pathname).toBe('/app/inbox');
    expect(url.searchParams.get('chat')).toBeTruthy();

    // A page that has never signed in, but in the *same* browser context —
    // same `localStorage`, so the same refresh token, and no in-memory
    // session to fall back on. If the link were anything short of a real
    // permanent pointer this is where it would fail to resolve.
    secondPage = await agentPage.context().newPage();
    await secondPage.goto(link);

    await expect(secondPage.getByRole('log', { name: 'Conversation transcript' })).toContainText(
      question,
      { timeout: 20_000 },
    );
  } finally {
    await visitorContext.close();
    if (secondPage) await secondPage.close();
  }
});
