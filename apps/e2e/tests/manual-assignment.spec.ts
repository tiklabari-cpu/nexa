/**
 * Manual assignment mode in the console (WG-07 · tm 346).
 *
 * The path the unit and integration suites cannot walk together: an admin
 * switches a team to manual in its editor; a visitor's conversation handed to
 * that team goes to nobody and waits in its queue; a member sees it in the
 * Inbox's Queued view with a Take button, takes it, and it opens as theirs.
 *
 * A team of its own (unique name) in the seeded workspace, with the signed-in
 * owner its only member, deleted at the end — no other spec routes to it.
 */
import { randomBytes } from 'node:crypto';
import {
  API_BASE,
  DEMO,
  WIDGET_ORIGIN,
  expect,
  freeARoutingSlot,
  openWidget,
  ownerAccessToken,
  test,
  visitorSends,
  widgetFrame,
} from './fixtures.js';

test.describe('manual assignment (WG-07)', () => {
  test('a manual team’s chat waits for a member to take it, and Take makes it theirs (FR-MOD-08.6.1)', async ({
    agentPage: page,
    organizationId,
    request,
  }) => {
    const auth = { authorization: `Bearer ${await ownerAccessToken(request)}` };
    const me = (await (await request.get(`${API_BASE}/auth/me`, { headers: auth })).json()) as {
      account_id: string;
    };
    // The specs before this one in a shard leave the owner at their chat limit,
    // and "Take" is refused there — so the room is made, not assumed.
    const roster = (
      (await (await request.get(`${API_BASE}/agents`, { headers: auth })).json()) as {
        items: Array<{ id: string; email: string; concurrent_chats_limit: number }>;
      }
    ).items;
    const owner = roster.find((agent) => agent.email === DEMO.email);
    expect(owner, 'the seeded owner is not on the roster').toBeTruthy();
    await freeARoutingSlot(request, auth, owner!.id, owner!.concurrent_chats_limit);
    const name = `Bonus desk ${randomBytes(3).toString('hex')}`;

    const created = await request.post(`${API_BASE}/groups`, { data: { name }, headers: auth });
    expect(created.status(), await created.text()).toBe(201);
    const teamId = ((await created.json()) as { id: number }).id;
    let chatId: string | null = null;
    try {
      const joined = await request.put(`${API_BASE}/groups/${teamId}/agents/${me.account_id}`, {
        data: { priority: 'normal' },
        headers: auth,
      });
      expect(joined.ok(), await joined.text()).toBe(true);

      // The admin's switch, in the team editor.
      await page.goto('/app/team/teams');
      await page.getByRole('button', { name: `Edit team — ${name}` }).click();
      const editor = page.getByRole('dialog', { name: `Edit team — ${name}` });
      await expect(editor.getByLabel('Assignment')).toHaveValue('auto');
      await editor.getByLabel('Assignment').selectOption('manual');
      await editor.getByRole('button', { name: 'Save changes' }).click();
      await expect(editor).toBeHidden();
      const teams = (await (await request.get(`${API_BASE}/groups`, { headers: auth })).json()) as {
        items: Array<{ id: number; assignment_mode: string }>;
      };
      expect(teams.items.find((t) => t.id === teamId)?.assignment_mode).toBe('manual');

      // A visitor writes in; the conversation is handed to the manual team.
      const minted = await request.post(`${API_BASE}/customer/token`, {
        data: { organization_id: organizationId, host_origin: WIDGET_ORIGIN },
        headers: { origin: WIDGET_ORIGIN },
      });
      expect(minted.ok(), await minted.text()).toBe(true);
      const visitor = {
        authorization: `Bearer ${((await minted.json()) as { token: string }).token}`,
      };
      const sent = await request.post(`${API_BASE}/customer/chat/events`, {
        data: { text: 'Bonusum hesabıma yüklenmedi' },
        headers: visitor,
      });
      expect(sent.status(), await sent.text()).toBe(201);
      chatId = ((await sent.json()) as { chat_id: string }).chat_id;
      const handed = await request.post(`${API_BASE}/chats/${chatId}/transfer`, {
        data: { group_id: teamId },
        headers: auth,
      });
      expect(handed.ok(), await handed.text()).toBe(true);
      const waiting = (await (
        await request.get(`${API_BASE}/chats?view=queued&queue_group_id=${teamId}`, {
          headers: auth,
        })
      ).json()) as {
        items: Array<{ id: string; assignee_id: string | null; customer_name: string | null }>;
      };
      expect(waiting.items.map((chat) => [chat.id, chat.assignee_id])).toEqual([[chatId, null]]);

      // The member takes it from the Queued view.
      await page.goto('/app/inbox');
      await page
        .getByRole('navigation', { name: 'Inbox views' })
        .getByRole('button', { name: /^Queued/ })
        .click();
      await page
        .getByRole('tablist', { name: 'Team queues' })
        .getByRole('tab', { name: new RegExp(`^${name}`) })
        .click();
      // The row's own control, named after the row (the page has "Take tour" too).
      const rowName = waiting.items[0]?.customer_name ?? 'Visitor';
      const take = page.getByRole('button', { name: `Take ${rowName}`, exact: true });
      await expect(take).toHaveCount(1);
      await page.screenshot({ path: 'kanit/wg-07-take.png', fullPage: true });
      await take.click();
      await expect
        .poll(async () => {
          const chat = (await (
            await request.get(`${API_BASE}/chats/${chatId}`, { headers: auth })
          ).json()) as { thread: { assignee_id: string | null } | null };
          return chat.thread?.assignee_id ?? null;
        })
        .toBe(me.account_id);
      // Taken: the queue is empty again, and a second Take by the same person
      // is not a conflict — the chat is already theirs (tm 402), so it answers
      // with the chat. A different teammate's would be the 409 (see the
      // manual-assignment integration test).
      await expect(take).toHaveCount(0);
      const again = await request.post(`${API_BASE}/chats/${chatId}/claim`, { headers: auth });
      expect(again.status()).toBe(200);
    } finally {
      if (chatId) {
        await request.post(`${API_BASE}/chats/${chatId}/deactivate`, { headers: auth });
      }
      await request.delete(`${API_BASE}/groups/${teamId}`, { headers: auth });
    }
  });

  /**
   * tm 411: a member answers a visitor who waits in the team's queue without
   * pressing Take. Writing is not taking — the chat stays queued and nobody's
   * (the routing record the Queued view shows) — but the visitor is no longer
   * told "you are number 1 in the queue": a person is talking to them. Before
   * the change the widget dropped the line on the reply's push (tm 399) and
   * the next poll wrote it back, because the server still counted them.
   */
  test('a queued visitor a member answers is no longer told their place in the queue (tm 411)', async ({
    page,
    organizationId,
    request,
  }) => {
    const auth = { authorization: `Bearer ${await ownerAccessToken(request)}` };
    const me = (await (await request.get(`${API_BASE}/auth/me`, { headers: auth })).json()) as {
      account_id: string;
    };
    const stamp = Date.now().toString().slice(-6);
    const created = await request.post(`${API_BASE}/groups`, {
      data: { name: `Queue reply desk ${stamp}`, assignment_mode: 'manual' },
      headers: auth,
    });
    expect(created.status(), await created.text()).toBe(201);
    const teamId = ((await created.json()) as { id: number }).id;
    let chatId: string | undefined;
    try {
      const joined = await request.put(`${API_BASE}/groups/${teamId}/agents/${me.account_id}`, {
        data: { priority: 'normal' },
        headers: auth,
      });
      expect(joined.ok(), await joined.text()).toBe(true);

      const question = `Para çekimim beklemede ${stamp}`;
      await openWidget(page, organizationId);
      await visitorSends(page, question);
      await expect
        .poll(
          async () => {
            const chats = await request.get(`${API_BASE}/chats?view=all&limit=50`, {
              headers: auth,
            });
            if (!chats.ok()) return undefined;
            const { items } = (await chats.json()) as {
              items: Array<{ id: string; last_event?: { text?: string | null } | null }>;
            };
            chatId = items.find((c) => c.last_event?.text?.includes(stamp))?.id;
            return chatId;
          },
          { timeout: 20_000, message: `no chat carrying "${stamp}"` },
        )
        .toBeTruthy();
      const handed = await request.post(`${API_BASE}/chats/${chatId!}/transfer`, {
        data: { group_id: teamId },
        headers: auth,
      });
      expect(handed.ok(), await handed.text()).toBe(true);

      const frame = widgetFrame(page);
      const transcript = frame.getByRole('log', { name: 'Conversation' });
      const status = frame.locator('.nx-status');
      /** A fresh document: the first poll is the server's word alone. */
      async function reopen(): Promise<void> {
        await page.reload();
        const launcher = frame.getByRole('button', { name: 'Open chat' });
        await expect(launcher.or(transcript)).toBeVisible();
        if (await launcher.isVisible()) await launcher.click();
        await expect(transcript).toContainText(question);
      }

      await reopen();
      await expect(status).toContainText('in the queue');

      const answer = `Kontrol ediyorum, bir dakika ${stamp}`;
      const sent = await request.post(`${API_BASE}/chats/${chatId!}/events`, {
        headers: auth,
        data: { type: 'message', text: answer },
      });
      expect(sent.ok(), `agent reply failed: ${sent.status()} ${await sent.text()}`).toBe(true);
      await expect(transcript).toContainText(answer);
      await expect(status).not.toContainText('in the queue');
      // Past the refresh the reply sets off and the open panel's next poll.
      await page.waitForTimeout(5_000);
      await expect(status).not.toContainText('in the queue');
      await page.screenshot({ path: 'kanit/tm411-queue-notice-after-reply.png', fullPage: true });

      await reopen();
      await expect(transcript).toContainText(answer);
      await expect(status).not.toContainText('in the queue');

      // Replying did not take it: still the team's, still waiting.
      const chat = (await (
        await request.get(`${API_BASE}/chats/${chatId!}`, { headers: auth })
      ).json()) as { thread: { assignee_id: string | null; queue_position: number | null } };
      expect(chat.thread.assignee_id).toBeNull();
      expect(chat.thread.queue_position).not.toBeNull();
    } finally {
      if (chatId) {
        await request.post(`${API_BASE}/chats/${chatId}/deactivate`, { headers: auth });
      }
      await request.delete(`${API_BASE}/groups/${teamId}`, { headers: auth });
    }
  });
});
