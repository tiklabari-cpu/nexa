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
import { expect, openWidget, test, visitorSends, widgetFrame } from './fixtures.js';

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

/**
 * Both conversation numbers, on screen and on the clipboard (ID-05 · tm 329).
 *
 * "Look at C2" only works if the number is readable off the screen and goes onto
 * the clipboard exactly as it is. The unit suites pin the button against a fake
 * clipboard; this one asks the real browser's: the copied value is the 10
 * characters that are drawn, and the number the player reads in the widget
 * ("Your support number") is the very Chat ID the agent sees beside the
 * conversation — the one an operator's complaint will quote.
 */
test('the day and the connection copy as exactly the ten characters drawn, and the player quotes the same Chat ID (ID-05)', async ({
  agentPage,
  browser,
  organizationId,
}) => {
  const visitorContext = await browser.newContext();
  await visitorContext.grantPermissions(['clipboard-read', 'clipboard-write']);
  const visitor = await visitorContext.newPage();

  try {
    const question = `Number me — ${Date.now().toString().slice(-6)}`;
    await openWidget(visitor, organizationId);
    await visitorSends(visitor, question);

    const list = agentPage.getByRole('region', { name: 'Conversations' });
    await expect(list).toContainText(question, { timeout: 20_000 });
    await list.getByRole('button').filter({ hasText: question }).click();
    await expect(agentPage.locator('main')).toContainText(question);
    await agentPage.context().grantPermissions(['clipboard-read', 'clipboard-write']);

    const NUMBER = /^[0-9A-Z]{10}$/;
    const main = agentPage.locator('main');
    // The header draws the numbers when it has the room and folds them into a
    // menu when it has not; either way they are one click from the name.
    const menu = main.getByRole('button', { name: 'Conversation numbers' });
    if (await menu.isVisible()) await menu.click();

    // --- The day ("Thread ID") --------------------------------------------
    const copyDay = main.getByRole('button', { name: 'Copy Thread ID' });
    await copyDay.click();
    const day = await agentPage.evaluate(() => navigator.clipboard.readText());
    expect(day).toMatch(NUMBER);
    // What was copied is what is drawn beside the button that copied it.
    await expect(copyDay.locator('xpath=..')).toContainText(day);
    await expect(main.getByRole('status').filter({ hasText: 'Copied' })).toBeVisible();
    // 1.5 s later the confirmation is gone again.
    await expect(main.getByRole('status').filter({ hasText: 'Copied' })).toBeHidden({
      timeout: 5_000,
    });

    // --- The connection ("Chat ID") ---------------------------------------
    const copyConnection = main.getByRole('button', { name: 'Copy Chat ID' });
    await copyConnection.click();
    const connection = await agentPage.evaluate(() => navigator.clipboard.readText());
    expect(connection).toMatch(NUMBER);
    expect(connection).not.toBe(day);
    await expect(copyConnection.locator('xpath=..')).toContainText(connection);

    // --- The player's side: the same Chat ID, from the widget's menu --------
    const frame = widgetFrame(visitor);
    await frame.getByRole('button', { name: 'More options' }).click();
    await expect(frame.getByText('Your support number')).toBeVisible();
    await expect(frame.locator('.nx-menu-support-id')).toHaveText(connection);
    await frame.getByRole('menuitem', { name: 'Copy support number' }).click();
    await expect(frame.getByRole('menuitem', { name: 'Copied' })).toBeVisible();
    expect(await visitor.evaluate(() => navigator.clipboard.readText())).toBe(connection);
  } finally {
    await visitorContext.close();
  }
});
