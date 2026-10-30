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
import { API_BASE, WIDGET_ORIGIN, expect, ownerAccessToken, test } from './fixtures.js';

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
      // Taken: the queue is empty again, and a second Take is refused.
      await expect(take).toHaveCount(0);
      const again = await request.post(`${API_BASE}/chats/${chatId}/claim`, { headers: auth });
      expect(again.status()).toBe(409);
    } finally {
      if (chatId) {
        await request.post(`${API_BASE}/chats/${chatId}/deactivate`, { headers: auth });
      }
      await request.delete(`${API_BASE}/groups/${teamId}`, { headers: auth });
    }
  });
});
