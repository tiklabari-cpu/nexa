/**
 * Assigning a conversation from the Details panel (FR-MOD-02.4.1–.6).
 *
 * The web suite pins the menu, the optimistic name and the refusal wording
 * against a mocked client; the integration suite pins what `POST /chats/{id}/
 * transfer` does to the thread. Neither crosses the seam the PRD's criterion is
 * actually about: the hand-off has to arrive on the *other* person's screen. One
 * agent picks a name in their panel and a second, independent session finds the
 * conversation in "My chats" — two sessions, two browsers' worth of state, and
 * the routing decision in between. Only a browser walks that.
 *
 * The receiving agent's availability is set by that agent, twice. Not accepting
 * while the visitor writes: the router hands a new chat to the least loaded
 * agent, and how loaded each one is depends on the specs that ran before this
 * one — a receiver holding the fewest chats is handed this one directly, and
 * then there is nothing left to hand over (seen in a sharded run, and on main
 * with the same spec order). Accepting before the hand-off: the route refuses a
 * hand-off to somebody who is offline (`group_unavailable`), and the seeded
 * roster's availability is writable by any spec that signs in as them.
 * Asserting on a fresh conversation for the same reason `inbox-panel.spec.ts`
 * does — the seeded "All" view's first row may already be archived.
 */
import type { APIRequestContext, Page, WebSocketRoute } from '@playwright/test';
import {
  API_BASE,
  DEMO,
  expect,
  openWidget,
  ownerAccessToken,
  test,
  visitorSends,
} from './fixtures.js';

const RECEIVER = { email: 'agent2@acme.localhost', name: 'Priya Nair' } as const;

test.describe('assigning a conversation', () => {
  test('a chat handed to a teammate turns up in that teammate’s My chats', async ({
    agentPage,
    browser,
    organizationId,
  }) => {
    const question = `Who owns this one? ${Date.now().toString().slice(-6)}`;

    const visitorContext = await browser.newContext();
    const receiverContext = await browser.newContext();
    const visitor = await visitorContext.newPage();
    const receiver = await receiverContext.newPage();
    let outOfRouting = false;

    try {
      // The teammate signs in and steps out of routing, so the router gives the
      // visitor's chat to somebody else.
      await receiver.goto('/');
      await receiver.getByLabel('Email').fill(RECEIVER.email);
      await receiver.getByLabel('Password').fill(DEMO.password);
      await receiver.getByRole('button', { name: 'Sign in' }).click();
      await expect(receiver.getByRole('link', { name: 'Inbox' })).toBeVisible();
      await receiver.goto('/app/inbox');
      const availability = receiver.getByLabel('Availability');
      outOfRouting = true;
      await availability.selectOption('not_accepting_chats');
      await expect(availability).toHaveValue('not_accepting_chats');

      const receiverList = receiver.getByRole('region', { name: 'Conversations' });
      const receiverRail = receiver.getByRole('navigation', { name: 'Inbox views' });
      const myChats = receiverRail.getByRole('button', { name: /^My chats/ });

      // A live conversation to hand over.
      await openWidget(visitor, organizationId);
      await visitorSends(visitor, question);

      // The owner opens it — this conversation, not whichever row the list
      // re-sorted under the click — and somebody other than the teammate holds it.
      await agentPage.goto('/app/inbox');
      const list = agentPage.getByRole('region', { name: 'Conversations' });
      await expect(list).toContainText(question, { timeout: 20_000 });
      await list.getByRole('button').filter({ hasText: question }).click();
      await expect(agentPage.getByRole('log', { name: 'Conversation transcript' })).toContainText(
        question,
      );

      const details = agentPage.getByRole('complementary', { name: 'Conversation details' });
      const assignee = details.getByRole('button', { name: 'Change assignee' });
      await expect(assignee).toBeVisible();
      await expect(assignee).not.toHaveText(new RegExp(`${RECEIVER.name}|Unassigned`));

      // The teammate declares themselves available, so the hand-off below is
      // refused for a product reason or not at all.
      await availability.selectOption('accepting_chats');
      await expect(availability).toHaveValue('accepting_chats');
      outOfRouting = false;

      // Before: however many conversations this teammate already holds. A count
      // rather than "this row is absent", because the row is identified by its
      // last message and the hand-off itself writes the last message
      // ("Chat transferred") — so the text this conversation is known by on the
      // *sender's* screen is gone by the time it reaches the receiver's list.
      await myChats.click();
      await expect(receiver.getByRole('heading', { level: 2, name: 'My chats' })).toBeVisible();
      const before = await receiverList.getByRole('listitem').count();

      // The owner hands it over from the Details panel.
      const transferred = agentPage.waitForResponse(
        (response) =>
          /\/chats\/[^/]+\/transfer$/.test(response.url()) &&
          response.request().method() === 'POST',
      );
      await assignee.click();
      await details.getByRole('button', { name: new RegExp(RECEIVER.name) }).click();
      expect((await transferred).status()).toBe(200);

      // The panel names the new holder — the row "saves instantly" asks for.
      await expect(assignee).toHaveText(new RegExp(RECEIVER.name));
      await agentPage.screenshot({ path: 'kanit/02.4-details-assignee.png', fullPage: true });

      // After: the teammate holds one more conversation, and it is this one —
      // the transfer is the newest activity on it, so it sorts to the top, and
      // its transcript still carries the visitor's question. Reloaded rather
      // than waited on: the receiving session learns about a transfer over RTM,
      // and a reload is the honest way to read what the server holds.
      await receiver.goto('/app/inbox');
      await myChats.click();
      await expect(receiverList.getByRole('listitem')).toHaveCount(before + 1);
      await receiverList.getByRole('button').first().click();
      await expect(receiver.getByRole('log', { name: 'Conversation transcript' })).toContainText(
        question,
      );
    } finally {
      // A failure while the teammate was out of routing must not leave them
      // there: `zz-suite-state.spec.ts` would report it as a second red.
      if (outOfRouting) {
        await receiver
          .goto('/app/inbox')
          .then(() =>
            receiver.getByLabel('Availability').selectOption('accepting_chats', { timeout: 5_000 }),
          )
          .catch(() => undefined);
      }
      await visitorContext.close();
      await receiverContext.close();
    }
  });
});

/**
 * When the system changes availability (WG-03 · tm 340.3).
 *
 * Two server parts change routing without anybody touching a switch: the
 * unanswered-chat sweep (`chat_inactivity`, API) and the gateway's
 * disconnect-offline (`apps/rtm/src/presence.ts`). Neither runs on this stack —
 * the scheduler is off and `RTM_DISCONNECT_OFFLINE_MS` is 0, because both would
 * rewrite the shared seeded roster under every other spec — and both are proven
 * against real servers where their clocks can be shortened
 * (`chat-inactivity-sweep.test.ts`, `presence.test.ts`). What only a browser
 * proves is the console's half: the push arrives on the real socket, in the
 * real frame shape, and the agent sees what changed and why. So the gateway's
 * own frames pass through untouched and the sweep's are added to them
 * (`routeWebSocket`), the way the sweep would send them.
 */
test.describe('when the system changes availability', () => {
  /** Route the panel's socket through the test, so a push can be added to the gateway's own. */
  async function interceptRealtime(page: Page): Promise<() => WebSocketRoute> {
    let socket: WebSocketRoute | undefined;
    await page.routeWebSocket(/:4001\//, (ws) => {
      ws.connectToServer();
      socket = ws;
    });
    await page.reload();
    await expect(
      page.getByRole('navigation', { name: 'Inbox views' }).getByText('Live'),
    ).toBeVisible({ timeout: 15_000 });
    return () => {
      if (!socket) throw new Error('the panel never opened its socket');
      return socket;
    };
  }

  function push(socket: WebSocketRoute, action: string, payload: Record<string, unknown>): void {
    socket.send(JSON.stringify({ action, type: 'push', payload }));
  }

  async function accountIdOf(request: APIRequestContext, email: string): Promise<string> {
    const token = await ownerAccessToken(request);
    const res = await request.get(`${API_BASE}/agents`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.ok()).toBe(true);
    const { items } = (await res.json()) as { items: Array<{ id: string; email: string }> };
    const found = items.find((agent) => agent.email === email);
    if (!found) throw new Error(`no agent ${email}`);
    return found.id;
  }

  /** The conversation whose last message is `text`, from the owner's view of the list. */
  async function chatCarrying(
    request: APIRequestContext,
    text: string,
  ): Promise<{ chatId: string; threadId: string }> {
    const token = await ownerAccessToken(request);
    let found: { id: string; thread_id: string | null } | undefined;
    await expect
      .poll(
        async () => {
          const res = await request.get(`${API_BASE}/chats?view=all&limit=50`, {
            headers: { authorization: `Bearer ${token}` },
          });
          if (!res.ok()) return undefined;
          const { items } = (await res.json()) as {
            items: Array<{
              id: string;
              thread_id: string | null;
              last_event?: { text?: string } | null;
            }>;
          };
          found = items.find((chat) => chat.last_event?.text?.includes(text));
          return found?.thread_id ?? undefined;
        },
        { timeout: 20_000, message: `no chat carrying "${text}"` },
      )
      .toBeTruthy();
    return { chatId: found!.id, threadId: found!.thread_id! };
  }

  test('says why the sweep paused this agent, moves the switch, and takes them back', async ({
    agentPage,
    request,
  }) => {
    const socket = await interceptRealtime(agentPage);
    const me = await accountIdOf(request, DEMO.email);
    const availability = agentPage.getByLabel('Availability');
    await expect(availability).toHaveValue('accepting_chats');

    push(socket(), 'routing_status_set', {
      agent_id: me,
      status: 'not_accepting_chats',
      reason: 'agent_unresponsive',
      after_seconds: 180,
    });

    const notice = agentPage.getByRole('status').filter({ hasText: 'Your availability changed' });
    await expect(notice).toContainText(
      'A chat assigned to you went without a reply for 3 minutes, so it was passed to a teammate and you were set to Not accepting chats.',
    );
    await expect(availability).toHaveValue('not_accepting_chats');
    await agentPage.screenshot({ path: 'kanit/340.3-yanitsiz-durum-bildirimi.png' });

    const restored = agentPage.waitForResponse(
      (response) =>
        response.url().endsWith('/agents/me/routing-status') &&
        response.request().method() === 'PUT',
    );
    await notice.getByRole('button', { name: 'Accept chats again' }).click();
    expect((await restored).status()).toBe(200);
    await expect(notice).toHaveCount(0);
    await expect(availability).toHaveValue('accepting_chats');
  });

  test('tells a lead which chat waits at the front of the queue, and opens it', async ({
    agentPage,
    browser,
    organizationId,
    request,
  }) => {
    const stamp = Date.now().toString().slice(-6);
    const question = `Is my withdrawal stuck? ${stamp}`;
    const visitorContext = await browser.newContext();
    try {
      const visitor = await visitorContext.newPage();
      await openWidget(visitor, organizationId);
      await visitorSends(visitor, question);
      const { chatId } = await chatCarrying(request, question);

      const socket = await interceptRealtime(agentPage);
      const silent = await accountIdOf(request, RECEIVER.email);
      push(socket(), 'chat_unanswered_alert', {
        chat_id: chatId,
        thread_id: `thread-of-${stamp}`,
        group_id: 1,
        agent_id: silent,
        reason: 'no_agent',
        transfers: 1,
        queue_position: 1,
      });

      const alert = agentPage
        .getByRole('status')
        .filter({ hasText: 'A chat is waiting unanswered' });
      await expect(alert).toContainText(
        `${RECEIVER.name} did not reply to a new chat in time and nobody else in the team was free.`,
      );
      await alert.getByRole('link', { name: 'Open chat' }).click();
      await expect(agentPage).toHaveURL(new RegExp(`chat=${chatId}`));
      await expect(agentPage.getByRole('log', { name: 'Conversation transcript' })).toContainText(
        question,
      );
      await expect(alert).toHaveCount(0);
    } finally {
      await visitorContext.close();
    }
  });

  test('dims a quiet conversation in the list until the player writes again', async ({
    agentPage,
    browser,
    organizationId,
    request,
  }) => {
    const stamp = Date.now().toString().slice(-6);
    const first = `Hello, anyone? ${stamp}`;
    const second = `Still waiting ${stamp}`;
    const visitorContext = await browser.newContext();
    try {
      const visitor = await visitorContext.newPage();
      await openWidget(visitor, organizationId);
      await visitorSends(visitor, first);
      const { chatId, threadId } = await chatCarrying(request, first);

      const socket = await interceptRealtime(agentPage);
      const list = agentPage.getByRole('region', { name: 'Conversations' });
      const row = list.getByRole('button').filter({ hasText: first });
      await expect(row).toBeVisible({ timeout: 20_000 });
      await expect(row).not.toContainText('Inactive');

      push(socket(), 'chat_inactivity_changed', {
        chat_id: chatId,
        thread_id: threadId,
        inactive: true,
      });
      await expect(row).toContainText('Inactive');
      await agentPage.screenshot({ path: 'kanit/340.3-pasif-sohbet.png' });

      // The gateway's own push this time: a message ends the quiet spell.
      await visitorSends(visitor, second);
      const woken = list.getByRole('button').filter({ hasText: second });
      await expect(woken).toBeVisible({ timeout: 20_000 });
      await expect(woken).not.toContainText('Inactive');
    } finally {
      await visitorContext.close();
    }
  });
});
