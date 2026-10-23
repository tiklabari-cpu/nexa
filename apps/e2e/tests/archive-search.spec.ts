/**
 * Message text search in the Archive (ID-07 · tm 333.4).
 *
 * The web unit suite pins the bar, the marks, the refusals and the palette mode
 * against a stubbed API. What only a real browser over the real search proves:
 * that the words reach `GET /chats?query=` and come back as the conversation
 * that holds them with the matched words marked, that "Go to this message"
 * reads a 250-message conversation back to a message that is not on its first
 * page and brings it into view highlighted, that ⌘K's "Search the archive"
 * lands on the same message — and that what was searched for is never in the
 * address bar.
 *
 * Against the paging workspace: its long conversation (`Paging Visitor 01`)
 * carries a marker per message, `paging-msg-001 — line 1 of the long
 * conversation` first, which no other seeded text contains.
 */
import { request as newApiContext, type APIRequestContext } from '@playwright/test';

import { expect, PAGING_OWNER, signInAs, test } from './fixtures.js';

const WORDS = 'paging-msg-001';

let apiCtx: APIRequestContext;

test.beforeAll(async () => {
  apiCtx = await newApiContext.newContext();
});

test.afterAll(async () => {
  await apiCtx?.dispose();
});

test.describe('archive message search', () => {
  test('finds the message by its words, opens it in place, and keeps the words out of the address', async ({
    page,
  }) => {
    await signInAs(page, PAGING_OWNER.email, PAGING_OWNER.password);
    await page.goto('/app/inbox');
    await expect(page.getByRole('region', { name: 'Conversations' })).toBeVisible();

    // The bar is on the Archive, where the conversations worth searching end up.
    await page
      .getByRole('navigation', { name: 'Inbox views' })
      .getByRole('button', { name: /Archive/ })
      .click();
    const search = page.getByRole('search', { name: 'Search archived messages' });
    await expect(search).toBeVisible();

    // A query the search would refuse says why and asks nothing.
    await search.getByRole('searchbox', { name: 'Search message text' }).fill('ab');
    await search.getByRole('button', { name: 'Search' }).click();
    await expect(search.getByRole('alert')).toHaveText('Type at least 3 characters.');

    const asked = page.waitForResponse(
      (response) =>
        response.url().includes('/chats?') &&
        response.url().includes('query=') &&
        response.request().method() === 'GET',
    );
    await search.getByRole('searchbox', { name: 'Search message text' }).fill(WORDS);
    await search.getByRole('button', { name: 'Search' }).click();
    expect((await asked).status()).toBe(200);

    const results = page.getByRole('region', { name: 'Conversations' });
    const row = results.getByRole('button', { name: /Paging Visitor 01/ });
    await expect(row).toBeVisible();
    await expect(row.locator('mark')).toHaveText(WORDS);
    await expect(results.getByRole('status')).toHaveText('1 conversation');

    await page.screenshot({ path: 'kanit/ID-07-archive-search.png', fullPage: true });

    // The message is the first of 250: read back past the first page to it.
    await results.getByRole('button', { name: 'Go to this message' }).click();
    const target = page.locator('[data-event-id][data-highlighted="true"]');
    await expect(target).toContainText(`${WORDS} `, { timeout: 15_000 });
    await expect(target).toBeInViewport();

    // GV-05: neither the words nor the search's parameters are in the address.
    expect(page.url()).not.toContain(WORDS);
    expect(page.url()).not.toContain('query');
    // The search is still there to pick the next hit from.
    await expect(row).toHaveAttribute('aria-current', 'true');
  });

  test('is reached from ⌘K as "Search the archive" and lands on the same message', async ({
    page,
  }) => {
    await signInAs(page, PAGING_OWNER.email, PAGING_OWNER.password);
    await page.goto('/app/inbox');
    await expect(page.getByRole('region', { name: 'Conversations' })).toBeVisible();

    await page.keyboard.press('ControlOrMeta+k');
    const palette = page.getByRole('dialog', { name: 'Command palette' });
    const input = palette.getByRole('combobox', { name: 'Search or jump to' });
    await input.fill('archive');
    await palette.getByRole('option', { name: /Search the archive/ }).click();

    await expect(input).toHaveAttribute('placeholder', 'Search message text in the archive…');
    await input.fill(WORDS);
    const hit = palette.getByRole('option', { name: /Paging Visitor 01/ });
    await expect(hit).toBeVisible();
    await expect(hit.locator('mark')).toHaveText(WORDS);
    await page.screenshot({ path: 'kanit/ID-07-palette-archive-mode.png', fullPage: true });

    await input.press('Enter');
    await expect(palette).toBeHidden();
    const target = page.locator('[data-event-id][data-highlighted="true"]');
    await expect(target).toContainText(`${WORDS} `, { timeout: 15_000 });
    await expect(target).toBeInViewport();
    expect(page.url()).not.toContain(WORDS);
    expect(page.url()).not.toContain('query');
  });
});
