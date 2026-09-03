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
/**
 * All but one of them: the AI answered fifty-nine alone, and the long
 * agent-worked conversation is the sixtieth (`seedPagingWorkspace`). That is
 * ADR-09's AI-resolution set — the "Solved" view, and the number billing meters.
 */
const AI_SOLVED_CHATS = SEEDED_CHATS - 1;
/** `useTickets.ts` — the Tickets grid asks for this many rows per request. */
const TICKET_PAGE_SIZE = 50;
/** The paging workspace holds ten more than that too (`seedPagingWorkspace`). */
const SEEDED_TICKETS = 60;
/** `useInbox.ts` — events per transcript request. */
const TRANSCRIPT_PAGE_SIZE = 200;
/** The long conversation holds fifty more than that (`seedPagingWorkspace`). */
const LONG_CONVERSATION_EVENTS = 250;

/** The marker the seed writes into message `n` — unique across the fixture. */
function marker(n: number): string {
  return `paging-msg-${String(n).padStart(3, '0')}`;
}

/**
 * The subject of the `n`th ticket, counting from one. The seed numbers these
 * *against* their activity, so `Paging Ticket 01` is the least recently active
 * of the sixty — the last row of the list, not the first.
 */
function ticketSubject(n: number): string {
  return `Paging Ticket ${String(n).padStart(2, '0')}`;
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

  test('the sidebar counts the view, not the page it managed to load (FR-MOD-02.1.2)', async ({
    page,
  }) => {
    await openPagingInbox(page);

    const conversations = page.getByRole('region', { name: 'Conversations' });
    const rail = page.getByRole('navigation', { name: 'Inbox views' });

    // The setup, and the whole reason this needs a workspace larger than a
    // page: fifty rows have been fetched, and that is all that will be fetched
    // until somebody scrolls.
    await expect(conversations.getByRole('listitem')).toHaveCount(CHAT_PAGE_SIZE);

    // The counter beside "Solved" is the audited one (D3): it is the count of
    // AI resolutions, the same set ADR-09 bills for, and it used to be the
    // length of the loaded page — so it read 50, and would have read 50 at any
    // size above 50. The server sends the view's own total now.
    await expect(rail.getByRole('button', { name: `Solved ${AI_SOLVED_CHATS}` })).toBeVisible();
    await expect(rail.getByRole('button', { name: `Solved ${CHAT_PAGE_SIZE}` })).toHaveCount(0);

    // Three different right answers over one fixture, so no single wrong number
    // satisfies them: All and Archive hold all sixty, Solved holds the
    // fifty-nine with no human turn in them.
    await expect(rail.getByRole('button', { name: `All ${SEEDED_CHATS}` })).toBeVisible();
    await expect(rail.getByRole('button', { name: `Archive ${SEEDED_CHATS}` })).toBeVisible();

    await page.screenshot({ path: 'kanit/02.1.2-rail-counts-past-the-page.png', fullPage: true });

    // And it is a count of the view rather than of the cache: loading the
    // second page adds rows without moving the number, which is the other half
    // of "the counter and the list agree".
    await conversations.getByRole('button', { name: 'Load more' }).click();
    await expect(conversations.getByRole('listitem')).toHaveCount(SEEDED_CHATS);
    await expect(rail.getByRole('button', { name: `All ${SEEDED_CHATS}` })).toBeVisible();
  });

  test('the sort control asks the server for a different order, not a client-side reshuffle of the loaded page (FR-MOD-02.2.1)', async ({
    page,
  }) => {
    await openPagingInbox(page);

    const conversations = page.getByRole('region', { name: 'Conversations' });
    const rows = conversations.getByRole('listitem');

    // Newest first is the default — the row a client-side re-sort of only the
    // fifty already loaded could also have produced.
    await expect(rows.first()).toContainText('Paging Visitor 01');

    await page.getByLabel('Sort conversations').selectOption('oldest');

    // The oldest conversation across the whole 60-row fixture, not merely the
    // last of the fifty on screen a moment ago — reaching it without first
    // paging to a second page is only possible because the request itself
    // changed (`sort=oldest`), not the order of what was already fetched.
    await expect(rows.first()).toContainText('Paging Visitor 60');
    await expect(page).toHaveURL(/chat_sort=oldest/);

    await page.screenshot({ path: 'kanit/02.2.1-inbox-sorted-oldest.png', fullPage: true });
  });

  test('the tickets grid sorts on the server, reaching a ticket the loaded page never held (FR-MOD-02.7)', async ({
    page,
  }) => {
    await openPagingInbox(page);
    await page.getByRole('button', { name: 'All tickets' }).click();

    const grid = page.getByRole('table', { name: 'Tickets' });
    await expect(grid).toBeVisible();
    const firstRow = grid.getByRole('row').nth(1);

    // The header counts the view rather than the rows this browser has chained:
    // sixty, while fifty are loaded (D3 · FR-MOD-02.1.2, the same reading as the
    // rail counters above).
    const gridHeader = page
      .locator('header')
      .filter({ has: page.getByRole('heading', { name: 'All tickets' }) });
    await expect(gridHeader).toContainText(String(SEEDED_TICKETS));

    // Newest activity first is the default, and the seed numbers the tickets
    // against it — so the top row is the sixtieth and `Paging Ticket 01` is the
    // last of the sixty, ten rows past the only page anyone has asked for.
    await expect(firstRow).toContainText(ticketSubject(SEEDED_TICKETS));
    await expect(grid.getByText(ticketSubject(1), { exact: true })).toHaveCount(0);

    // A header click changes the *request*, and starts the page chain over: a
    // cursor is a position in one ordering, and `GET /tickets` refuses one
    // minted under another rather than replying with a page one dressed as a
    // page two.
    const sorted = page.waitForResponse(
      (response) => response.url().includes('/tickets?') && response.url().includes('sort=subject'),
    );
    await grid.getByRole('button', { name: 'Subject' }).click();
    const sortedUrl = new URL((await sorted).url());
    expect(sortedUrl.searchParams.get('order')).toBe('asc');
    expect(sortedUrl.searchParams.get('page_id')).toBeNull();
    // Fifty of sixty, which is what makes the row below unreachable any other
    // way: the request that answers a header click is still one page wide.
    expect(sortedUrl.searchParams.get('limit')).toBe(String(TICKET_PAGE_SIZE));

    // And the row that arrives at the top is the one a client-side reshuffle
    // could not have produced: a moment ago it was on the second page, which
    // this browser has still never fetched.
    await expect(firstRow).toContainText(ticketSubject(1));
    await expect(page).toHaveURL(/ticket_sort=subject/);
    // The count is the view's, so a new ordering does not move it.
    await expect(gridHeader).toContainText(String(SEEDED_TICKETS));

    await page.screenshot({ path: 'kanit/02.7-tickets-sorted-on-the-server.png', fullPage: true });
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
