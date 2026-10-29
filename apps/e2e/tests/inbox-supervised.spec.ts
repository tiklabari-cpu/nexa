/**
 * The inbox's Supervised bucket (FR-MOD-02.1.1).
 *
 * The integration suite proves the server keys the view by the watcher and
 * hides the other tenant's rows; the web suite proves the rail item exists and
 * narrows the list through the server. Neither of them crosses the seam this
 * item is really about: `Supervise chat` is a Traffic board action, and the
 * conversation it registers has to turn up in a completely different module's
 * list. That hand-off — one table, two surfaces — only a browser can walk.
 *
 * Waiting on the POST rather than on a redraw is deliberate: the board fires
 * the registration and navigates away in the same click (`TrafficPage.tsx`, so
 * that opening the transcript is not held up by it), which makes "the row is in
 * my Supervised list" a claim about a request that may still be in flight.
 *
 * The second half (tm 213) walks the release surface `DELETE
 * /chats/{chatId}/supervise` — until this task the endpoint existed on the
 * contract and in the API but no client ever called it, so the only way to
 * stop watching a chat was for it to close. `Stop supervising` occupies the
 * same board row slot `Supervise chat` did (`rowActions.ts`), so the same
 * `waitForResponse` pattern applies to the DELETE.
 *
 * The third (tm 326 · RL-03) is the Team Lead's side of the same table: the
 * lead's "My team" view lists a conversation routed to the team they lead,
 * Watch registers the watch from the row, and Take over seizes it from the
 * Team Member who held it. Another team's conversation answers the lead 404;
 * a Team Member is refused 403.
 */
import {
  ACME_TEAM_LEAD,
  API_BASE,
  DEMO,
  allChats,
  expect,
  openWidget,
  ownerAccessToken,
  ownerAccessTokenFor,
  PRECHAT_VISITOR,
  signInAs,
  test,
  visitorSends,
  type ChatSummary,
} from './fixtures.js';

/** Priya Nair — the seeded Acme teammate with the plain agent role, on Support. */
const MEMBER = { email: 'agent2@acme.localhost', password: DEMO.password, orgPrefix: 'Acme' };

test.describe('the inbox Supervised view', () => {
  test('a conversation watched from Traffic turns up in the Supervised list', async ({
    browser,
    agentPage,
    organizationId,
  }) => {
    const stamp = Date.now().toString().slice(-6);
    const message = `Supervised sweep ${stamp}`;

    const visitorContext = await browser.newContext();
    const visitor = await visitorContext.newPage();

    try {
      // A real visitor writes in, so there is a live conversation to watch —
      // and its text is what identifies the row further down, since an
      // anonymous visitor's rows all carry the same name.
      await openWidget(visitor, organizationId);
      await visitorSends(visitor, message);

      const rail = agentPage.getByRole('navigation', { name: 'Inbox views' });
      const supervisedView = rail.getByRole('button', { name: /^Supervised/ });
      const list = agentPage.getByRole('region', { name: 'Conversations' });
      const row = list.getByRole('button').filter({ hasText: message });

      // Before: the bucket exists in the rail and this conversation is not in
      // it. The seeded database is shared, so the assertion is about *this*
      // conversation rather than about the list being empty.
      await agentPage.goto('/app/inbox');
      await expect(supervisedView).toBeVisible();
      await supervisedView.click();
      await expect(agentPage.getByRole('heading', { level: 2, name: 'Supervised' })).toBeVisible();
      await expect(row).toHaveCount(0);

      // Watch it from the board.
      await agentPage.goto('/app/customers/real-time');
      const board = agentPage.getByRole('table', { name: 'Live visitors' });
      const visitorRow = board.getByRole('row').filter({ hasText: PRECHAT_VISITOR.name }).first();
      await expect(visitorRow).toBeVisible();

      const registered = agentPage.waitForResponse(
        (response) =>
          /\/chats\/[^/]+\/supervise$/.test(response.url()) &&
          response.request().method() === 'POST',
      );
      await visitorRow.getByRole('button', { name: 'Supervise chat' }).click();
      expect((await registered).status()).toBe(200);
      await expect(agentPage).toHaveURL(/\/app\/inbox/);

      // After: the same conversation is in the bucket. Reloaded rather than
      // asserted on the list the click landed on — the registration and the
      // navigation raced, and a reload is the honest way to read the state the
      // server now holds.
      await agentPage.goto('/app/inbox');
      await supervisedView.click();
      await expect(row).toHaveCount(1);
      await agentPage.screenshot({ path: 'kanit/02.1.1-inbox-supervised.png', fullPage: true });

      // Stop watching from the board — the row this task adds. Same
      // "in-flight request" caveat as the registration above applies.
      await agentPage.goto('/app/customers/real-time');
      const released = agentPage.waitForResponse(
        (response) =>
          /\/chats\/[^/]+\/supervise$/.test(response.url()) &&
          response.request().method() === 'DELETE',
      );
      await visitorRow.getByRole('button', { name: 'Stop supervising' }).click();
      expect((await released).status()).toBe(204);

      // The board's own row flips back to an offer to (re-)watch — the
      // caller's release does not need a reload to be reflected here, since
      // the click's own success invalidates the traffic query.
      await expect(visitorRow.getByRole('button', { name: 'Supervise chat' })).toBeVisible();

      // After: the conversation has left the Supervised bucket.
      await agentPage.goto('/app/inbox');
      await supervisedView.click();
      await expect(row).toHaveCount(0);
      await agentPage.screenshot({ path: 'kanit/02.1.1-inbox-unsupervised.png', fullPage: true });
    } finally {
      await visitorContext.close();
    }
  });

  test('a Team Lead watches and takes over their team’s conversation from My team (RL-03)', async ({
    browser,
    request,
    organizationId,
  }) => {
    const stamp = Date.now().toString().slice(-6);
    const ours = `Team lead sweep ${stamp}`;
    const theirs = `Other team sweep ${stamp}`;
    const owner = { authorization: `Bearer ${await ownerAccessToken(request)}` };
    const member = {
      authorization: `Bearer ${await ownerAccessTokenFor(request, MEMBER)}`,
    };
    const leadApi = {
      authorization: `Bearer ${await ownerAccessTokenFor(request, { ...ACME_TEAM_LEAD, orgPrefix: 'Acme' })}`,
    };

    const visitorContext = await browser.newContext();
    const otherContext = await browser.newContext();
    const leadContext = await browser.newContext();
    try {
      // Two visitors write in; both land in Support, where the widget routes.
      for (const [context, text] of [
        [visitorContext, ours],
        [otherContext, theirs],
      ] as const) {
        const page = await context.newPage();
        await openWidget(page, organizationId);
        await visitorSends(page, text);
      }
      const chatOf = async (text: string): Promise<ChatSummary> => {
        let found: ChatSummary | undefined;
        await expect
          .poll(async () => {
            found = (await allChats(request, owner)).find((c) => c.last_event?.text === text);
            return found?.id ?? null;
          })
          .not.toBeNull();
        return found!;
      };
      const ourChat = await chatOf(ours);
      const theirChat = await chatOf(theirs);

      const teams = (await (await request.get(`${API_BASE}/groups`, { headers: owner })).json())
        .items as Array<{ id: number; name: string }>;
      const sales = teams.find((team) => team.name === 'Sales')!;
      const agents = (await (await request.get(`${API_BASE}/agents`, { headers: owner })).json())
        .items as Array<{ id: string; name: string }>;
      const leadId = agents.find((a) => a.name === ACME_TEAM_LEAD.name)!.id;
      const memberId = agents.find((a) => a.name === 'Priya Nair')!.id;

      // The owner routes ours to Sales, which the lead leads, and hands it to
      // the Team Member — so there is a holder to take it from.
      const available = await request.put(`${API_BASE}/agents/me/routing-status`, {
        headers: member,
        data: { routing_status: 'accepting_chats' },
      });
      expect(available.ok(), await available.text()).toBe(true);
      for (const target of [{ group_id: sales.id }, { agent_id: memberId }]) {
        const moved = await request.post(`${API_BASE}/chats/${ourChat.id}/transfer`, {
          headers: owner,
          data: target,
        });
        expect(moved.ok(), await moved.text()).toBe(true);
      }
      // Each hand-off leaves a "Chat transferred" line as the row's last word,
      // and every widget visitor shares one name: a stamped line names the row.
      const marker = `Routed to Sales ${stamp}`;
      const said = await request.post(`${API_BASE}/chats/${ourChat.id}/events`, {
        headers: owner,
        data: { type: 'message', text: marker },
      });
      expect(said.ok(), await said.text()).toBe(true);

      const lead = await leadContext.newPage();
      await signInAs(lead, ACME_TEAM_LEAD.email, ACME_TEAM_LEAD.password);
      await lead.goto('/app/inbox');
      const rail = lead.getByRole('navigation', { name: 'Inbox views' });
      await rail.getByRole('button', { name: /^My team/ }).click();
      await expect(lead.getByRole('heading', { level: 2, name: 'My team' })).toBeVisible();
      const row = lead
        .getByRole('region', { name: 'Conversations' })
        .getByRole('listitem')
        .filter({ hasText: marker });
      await expect(row).toHaveCount(1);
      // Support's conversation is not the lead's team.
      await expect(
        lead.getByRole('region', { name: 'Conversations' }).getByText(theirs),
      ).toHaveCount(0);

      const watched = lead.waitForResponse(
        (response) =>
          /\/chats\/[^/]+\/supervise$/.test(response.url()) &&
          response.request().method() === 'POST',
      );
      await row.getByRole('button', { name: /^Watch / }).click();
      expect((await watched).status()).toBe(200);

      await row.getByRole('button', { name: /^Take over / }).click();
      const dialog = lead.getByRole('dialog', { name: 'Take over this chat?' });
      await expect(dialog).toContainText('Priya Nair');
      const taken = lead.waitForResponse(
        (response) =>
          response.url().endsWith(`/chats/${ourChat.id}/takeover`) &&
          response.request().method() === 'POST',
      );
      await dialog.getByRole('button', { name: 'Take over' }).click();
      expect((await taken).status()).toBe(200);
      await expect(dialog).toHaveCount(0);
      await lead.screenshot({ path: 'kanit/rl-03-team-lead-takeover.png', fullPage: true });

      const after = (await (
        await request.get(`${API_BASE}/chats/${ourChat.id}`, { headers: owner })
      ).json()) as { thread: { assignee_id: string | null } };
      expect(after.thread.assignee_id).toBe(leadId);

      // Another team's conversation: absent to the lead. A Team Member: refused.
      const elsewhere = await request.post(`${API_BASE}/chats/${theirChat.id}/takeover`, {
        headers: leadApi,
      });
      expect(elsewhere.status()).toBe(404);
      const refused = await request.post(`${API_BASE}/chats/${ourChat.id}/takeover`, {
        headers: member,
      });
      expect(refused.status()).toBe(403);
    } finally {
      await Promise.all([visitorContext.close(), otherContext.close(), leadContext.close()]);
    }
  });
});
