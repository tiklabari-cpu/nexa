/**
 * Real-time traffic — the live-visitor board (FR-MOD-03.1.3 · FR-MOD-13.2).
 *
 * The integration suite proves the API resolves who each visitor is chatting
 * with and isolates tenants. What only a browser shows is that a visitor who
 * writes in actually surfaces on the board, reachable through the Customers
 * sub-nav, with the row actions an agent acts on.
 *
 * The second test is 13.2-k's end-to-end gate over the whole v2 slice: the
 * status tabs (13.2-g), the "Match all filters" panel (13.2-f/h), the
 * supervised state (13.2-d/e) and the 360° panel (13.2-i/j) were each proven in
 * isolation, and nothing until now proved they compose on one real visitor.
 */
import {
  expect,
  test,
  API_BASE,
  openWidget,
  ownerAccessToken,
  visitorSends,
} from './fixtures.js';

/** NFR-P2: reads are budgeted at p99 < 150 ms. */
const READ_BUDGET_MS = 150;

test.describe('real-time traffic', () => {
  test('surfaces a live visitor with row actions, reached via the Real-time tab', async ({
    browser,
    agentPage,
    organizationId,
  }) => {
    const visitorContext = await browser.newContext();
    const visitor = await visitorContext.newPage();

    try {
      // A visitor writes in — now they are on the site, mid-conversation.
      await openWidget(visitor, organizationId);
      await visitorSends(visitor, `Live traffic ${Date.now().toString().slice(-6)}`);

      // Reach the board through the Customers sub-nav, not a bookmarked URL.
      await agentPage.goto('/app/customers');
      await agentPage.getByRole('link', { name: 'Real-time' }).click();
      await expect(agentPage).toHaveURL(/\/app\/customers\/real-time$/);

      const table = agentPage.getByRole('table', { name: 'Live visitors' });
      await expect(table).toBeVisible();
      await expect(table.getByRole('columnheader', { name: 'Chatting with' })).toBeVisible();

      // The anonymous visitor who just wrote in is on the board with the
      // conversation actions available on their row.
      const row = table.getByRole('row').filter({ hasText: 'Unnamed visitor' }).first();
      await expect(row).toBeVisible();
      await expect(row.getByRole('button', { name: 'Supervise chat' })).toBeVisible();
      await expect(row.getByRole('button', { name: 'Assign chat to me' })).toBeVisible();

      await agentPage.screenshot({ path: 'kanit/03-traffic-board.png', fullPage: true });
    } finally {
      await visitorContext.close();
    }
  });

  test('tabs, filters, supervision and the 360° panel, on one visitor (13.2-k)', async ({
    browser,
    request,
    agentPage,
    organizationId,
  }, testInfo) => {
    // Five surfaces on one live visitor, with two round trips through the
    // inbox — well past the 45s a single-surface test is budgeted for.
    test.setTimeout(150_000);

    const stamp = Date.now().toString().slice(-6);
    const visitorName = `E2E Traffic ${stamp}`;
    const auth = { authorization: `Bearer ${await ownerAccessToken(request)}` };

    const visitorContext = await browser.newContext();
    const visitor = await visitorContext.newPage();

    try {
      // --- 1. A real visitor, from the widget on the customer's own site ----
      await openWidget(visitor, organizationId);
      await visitorSends(visitor, `Traffic sweep ${stamp}`);

      // The widget mints an anonymous contact with `last_activity_at` set, and
      // `GET /customers` orders by exactly that — so the visitor who just
      // arrived is the newest row. Asserted rather than assumed: picking up a
      // seeded contact by accident would make every assertion below vacuous.
      const newest = await request.get(`${API_BASE}/customers?segment=all&limit=1`, {
        headers: auth,
      });
      expect(newest.ok(), `customers read failed: ${newest.status()}`).toBe(true);
      const arrival = ((await newest.json()) as { items: Array<{ id: string; name: string | null }> })
        .items[0];
      expect(arrival?.name, 'newest contact is not the anonymous visitor just created').toBeNull();
      const customerId = arrival!.id;

      // Name them. The board is a shared, seeded workspace where every other
      // widget visitor also reads "Unnamed visitor"; a name is what lets the
      // steps below address this one row instead of whichever came first.
      const named = await request.patch(`${API_BASE}/customers/${customerId}`, {
        headers: auth,
        data: { name: visitorName },
      });
      expect(named.ok(), `naming failed: ${named.status()} ${await named.text()}`).toBe(true);

      // --- 2. Put them in the `browsing` bucket -----------------------------
      // Browsing means a live visit and no open conversation, and the widget
      // can only produce the first half: sending is what records the page. So
      // the conversation is closed from the agent side — the same thing an
      // agent does when a chat is finished and the visitor stays on the site.
      const detail = await request.get(`${API_BASE}/customers/${customerId}`, { headers: auth });
      expect(detail.ok()).toBe(true);
      const openChat = ((await detail.json()) as { chats: Array<{ id: string; active: boolean }> })
        .chats.find((chat) => chat.active);
      expect(openChat, 'the widget message did not open a conversation').toBeDefined();
      const closed = await request.post(`${API_BASE}/chats/${openChat!.id}/deactivate`, {
        headers: auth,
      });
      expect(closed.ok(), `deactivate failed: ${closed.status()}`).toBe(true);

      // --- 3. All seven tabs, and the visitor under Browsing ----------------
      await agentPage.goto('/app/customers/real-time');
      const tablist = agentPage.getByRole('tablist', { name: 'Traffic status' });
      await expect(tablist).toBeVisible();
      await expect(tablist.getByRole('tab')).toHaveCount(7);
      for (const label of ['All', 'Chatting', 'Supervised', 'Queued', 'Waiting for reply', 'Invited', 'Browsing']) {
        await expect(tablist.getByRole('tab', { name: new RegExp(label) })).toBeVisible();
      }

      // --- 4. The strip is usable from the keyboard (NFR-A11Y4/A11Y5) -------
      const allTab = tablist.getByRole('tab', { name: /^All/ });
      const chattingTab = tablist.getByRole('tab', { name: /Chatting/ });
      const browsingTab = tablist.getByRole('tab', { name: /Browsing/ });

      await allTab.focus();
      await expect(allTab).toHaveAttribute('aria-selected', 'true');
      await agentPage.keyboard.press('ArrowRight');
      await expect(chattingTab).toBeFocused();
      await expect(chattingTab).toHaveAttribute('aria-selected', 'true');
      await expect(allTab).toHaveAttribute('aria-selected', 'false');
      await agentPage.keyboard.press('End');
      await expect(browsingTab).toBeFocused();
      await expect(browsingTab).toHaveAttribute('aria-selected', 'true');
      // Exactly one selected tab at a time — the strip must not claim two.
      expect(await tablist.locator('[role="tab"][aria-selected="true"]').count()).toBe(1);
      await expect(agentPage).toHaveURL(/tab=browsing/);

      const table = agentPage.getByRole('table', { name: 'Live visitors' });
      const row = table.getByRole('row').filter({ hasText: visitorName });
      await expect(row).toBeVisible();
      await expect(row).toContainText('Browsing');

      // --- 5. "Add filter": a page-URL condition narrows, removing restores --
      const unfilteredRows = await table.getByRole('row').count();

      await agentPage.getByRole('button', { name: 'Add filter' }).click();
      await agentPage.getByRole('button', { name: 'Page URL contains' }).click();
      // By role, not `getByLabel`: the row's own "Remove … filter" button also
      // carries the field's name in its accessible name.
      const pageUrl = agentPage.getByRole('textbox', { name: 'Page URL contains' });

      // Matching first: proves the condition really reaches the server and
      // keeps whoever satisfies it, rather than emptying the board wholesale.
      await pageUrl.fill('demo.html');
      await expect(agentPage).toHaveURL(/page_url_contains=demo\.html/);
      await expect(row).toBeVisible();

      // Then a page nobody is on: the visitor drops off and the board shrinks.
      await pageUrl.fill(`/no-such-page-${stamp}`);
      await expect(row).toHaveCount(0);
      expect(await table.getByRole('row').count()).toBeLessThan(unfilteredRows);
      await expect(agentPage.getByText('No one is just browsing')).toBeVisible();

      await agentPage.screenshot({ path: 'kanit/13.2-k-traffic-filter.png', fullPage: true });

      // Removing the condition brings the same visitor back.
      await agentPage.getByRole('button', { name: 'Remove Page URL contains filter' }).click();
      await expect(row).toBeVisible();
      expect(await table.getByRole('row').count()).toBe(unfilteredRows);

      // --- 6. Start a chat, then supervise it -------------------------------
      // A browsing visitor has nothing to watch yet, so the proactive action is
      // what creates one — assigned to me, which is what keeps the state below
      // deterministic: an unassigned chat would sit in the queue, and `queued`
      // outranks `supervised` on the board.
      await allTab.click();
      await expect(row).toBeVisible();
      await row.getByRole('button', { name: 'Start chat' }).click();
      // `?chat=` only lives long enough for the inbox to consume it — it strips
      // the parameter once the conversation is selected, so the landing URL is
      // the bare inbox.
      await expect(agentPage).toHaveURL(/\/app\/inbox/);

      await agentPage.goto('/app/customers/real-time');
      await expect(row).toContainText('Chatting');

      await row.getByRole('button', { name: 'Supervise chat' }).click();
      await expect(agentPage).toHaveURL(/\/app\/inbox/);

      // Back on the board the row now reports it is being watched — the whole
      // of 13.2-d (register) and 13.2-e (funnel) in one visible fact.
      await agentPage.goto('/app/customers/real-time');
      await expect(row).toContainText('Supervised', { timeout: 20_000 });
      await agentPage.screenshot({ path: 'kanit/13.2-k-traffic-supervised.png', fullPage: true });

      // --- 7. "Edit contact" deep-links into the 360° panel -----------------
      await row.getByRole('button', { name: 'Edit contact' }).click();
      await expect(agentPage).toHaveURL(/\/app\/customers/);

      await expect(agentPage.getByRole('heading', { name: visitorName, level: 2 })).toBeVisible();
      // The visit summary (13.2-i/j): a true count, independent of the capped
      // `visits[]` list rendered under it.
      await expect(agentPage.locator('dt:text-is("Visits") + dd')).toHaveText(/[1-9]/);
      await expect(agentPage.getByText('Visited pages')).toBeVisible();
      await expect(agentPage.getByText(/demo\.html/)).toBeVisible();
      // Groups (13.2-j): both of this visitor's conversations were routed, so
      // the card names a team rather than showing its empty state.
      await expect(agentPage.getByRole('heading', { name: 'Groups', level: 3 })).toBeVisible();
      await expect(agentPage.getByText('Not routed to a team yet.')).toHaveCount(0);
      //
      // NOT asserted here, deliberately: the panel's "Came from <referrer>"
      // line. `visits.came_from` is written by `CustomerService.recordPageView`,
      // and the only caller (`POST /customer/chat`) never passes a referrer —
      // the widget does not send one and the contract has no field for it. So
      // the column is null for every visitor the product can actually create,
      // and an e2e assertion on that text could only pass against a row this
      // test inserted itself. The render path is covered by
      // `CustomerDetailPanel.test.tsx` and the `came_from_contains` filter by
      // `traffic.test.ts`; what is missing is the write, recorded as a gap.

      await agentPage.screenshot({ path: 'kanit/13.2-k-visitor-360.png', fullPage: true });

      // --- 8. NFR-P2: what a filtered board costs ---------------------------
      // Measured against the endpoint the panel above drives, with every
      // condition the "Match all filters" panel can set that this visitor
      // satisfies — the expensive shape, since the visit JSONB is only read
      // when a page/referrer condition is in play.
      const filtered = `${API_BASE}/traffic?limit=100&activity=chatting&activity=supervised&page_url_contains=demo.html`;
      await request.get(filtered, { headers: auth }); // warm-up: not measured
      const samples: number[] = [];
      for (let i = 0; i < 20; i += 1) {
        const started = Date.now();
        const measured = await request.get(filtered, { headers: auth });
        samples.push(Date.now() - started);
        expect(measured.ok()).toBe(true);
      }
      const sorted = [...samples].sort((a, b) => a - b);
      const at = (q: number): number => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;
      const median = at(0.5);
      // The median is what is asserted, and the tail is recorded beside it
      // rather than gated on: this runs against a dev server (`tsx watch`, no
      // build, verbose logging) on a shared machine, so its tail says more about
      // the harness than about the query. NFR-P2's p99 is a production claim
      // this measurement supports but cannot by itself establish.
      const budget = `NFR-P2 filtered GET /traffic — median ${median} ms · p95 ${at(0.95)} ms · max ${sorted.at(-1)} ms over ${samples.length} samples, dev server (budget ${READ_BUDGET_MS} ms)`;
      console.log(budget);
      await testInfo.attach('nfr-p2-traffic-budget', { body: budget, contentType: 'text/plain' });
      expect(median).toBeLessThan(READ_BUDGET_MS);
    } finally {
      await visitorContext.close();
    }
  });
});
