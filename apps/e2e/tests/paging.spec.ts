/**
 * List paging, walked (NFR-P5 · P5-PAGE).
 *
 * The five console lists learned to chain pages one subtask at a time, and each
 * of those was proved where it was written — in the web unit suite, against a
 * stubbed API that returns whatever `next_page_id` the test hands it. That
 * proves the hook. It cannot prove the round trip: that the cursor the client
 * sends is the cursor the server issued, that the second page comes back with
 * the rows the first one did not have, and that they arrive on screen in the
 * order a person reading the list expects.
 *
 * Only a browser against the real API can, and only against a fixture larger
 * than one page — which is why `seedPagingWorkspace` exists and why these tests
 * sign in to it rather than to Acme. Two directions, because the console pages
 * in both: the inbox list forwards through `page_id`, the transcript *backwards*
 * through `before_event_id`.
 */
import type { Page } from '@playwright/test';
import { expect, PAGING_OWNER, signInAs, test } from './fixtures.js';

/** `useInbox.ts` — the console asks for this many conversations per request. */
const CHAT_PAGE_SIZE = 50;
/** The paging workspace holds ten more than that (`seedPagingWorkspace`). */
const SEEDED_CHATS = 60;
/** `useInbox.ts` — events per transcript request. */
const TRANSCRIPT_PAGE_SIZE = 200;
/** The long conversation holds fifty more than that (`seedPagingWorkspace`). */
const LONG_CONVERSATION_EVENTS = 250;

/** The marker the seed writes into message `n` — unique across the fixture. */
function marker(n: number): string {
  return `paging-msg-${String(n).padStart(3, '0')}`;
}

async function openPagingInbox(page: Page): Promise<void> {
  await signInAs(page, PAGING_OWNER.email, PAGING_OWNER.password);
  await page.goto('/app/inbox');
}

test.describe('list paging', () => {
  test('the inbox list reaches the sixtieth conversation, ten rows past the first page', async ({
    page,
  }) => {
    await openPagingInbox(page);

    const conversations = page.getByRole('region', { name: 'Conversations' });
    const rows = conversations.getByRole('listitem');

    // One page, and exactly one page: the first request is capped at the client's
    // own limit, so the sixtieth conversation is not merely below the fold — it
    // was never sent.
    await expect(rows).toHaveCount(CHAT_PAGE_SIZE);
    await expect(conversations.getByText('Paging Visitor 60', { exact: true })).toHaveCount(0);
    await expect(conversations.getByText('Paging Visitor 01', { exact: true })).toBeVisible();

    // Asking for the next page is the same request with the cursor the first
    // response carried. The rows that come back are the ten the first page did
    // not have — appended, not replacing it, so the count is the sum.
    await conversations.getByRole('button', { name: 'Load more' }).click();
    await expect(rows).toHaveCount(SEEDED_CHATS);
    await expect(conversations.getByText('Paging Visitor 60', { exact: true })).toBeVisible();

    // And the chain has ended: no cursor came back with the last page, so the
    // offer to load more is gone rather than looping on the same page forever.
    await expect(conversations.getByRole('button', { name: 'Load more' })).toHaveCount(0);

    await page.screenshot({ path: 'kanit/P5-PAGE-inbox-second-page.png', fullPage: true });
  });

  test('the transcript walks back to the first message of a 250-event conversation', async ({
    page,
  }) => {
    await openPagingInbox(page);

    const conversations = page.getByRole('region', { name: 'Conversations' });
    // The long conversation is the newest, so it is the first row — reaching it
    // needs no paging of its own, which keeps this test about the transcript.
    await conversations.getByText('Paging Visitor 01', { exact: true }).click();

    const transcript = page.getByRole('log', { name: 'Conversation transcript' });
    const oldestOnFirstPage = LONG_CONVERSATION_EVENTS - TRANSCRIPT_PAGE_SIZE + 1;

    // It opens at the *end* of the conversation. That is the half of the defect
    // that used to be invisible: a `limit=200` read with the default oldest-first
    // sort showed the first two hundred messages and never the last one.
    await expect(transcript.getByText(marker(LONG_CONVERSATION_EVENTS))).toBeVisible();
    await expect(transcript.getByText(marker(oldestOnFirstPage))).toBeVisible();

    // The fifty older than that page are not on screen because they were never
    // fetched — the seam a reader has to be able to cross.
    await expect(transcript.getByText(marker(oldestOnFirstPage - 1))).toHaveCount(0);
    await expect(transcript.getByText(marker(1))).toHaveCount(0);

    // Scrolling to the top is the whole gesture: it asks for the page before the
    // oldest event loaded, which arrives as a prepend.
    await transcript.evaluate((node) => {
      node.scrollTop = 0;
    });

    await expect(transcript.getByText(marker(1))).toBeVisible();
    // The conversation is now whole, both ends of it in one list.
    await expect(transcript.getByText(marker(LONG_CONVERSATION_EVENTS))).toBeVisible();

    await page.screenshot({ path: 'kanit/P5-PAGE-transcript-start.png', fullPage: true });
  });
});
