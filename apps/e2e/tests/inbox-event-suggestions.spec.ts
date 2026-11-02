/**
 * Event-bound suggested replies (IN-07 · tm 364).
 *
 * The unit suites pin the detection and the row against mocks. What only the
 * real stack proves together: a saved reply bound to "chat transferred" in the
 * library comes back through the API, the chat handed to the signed-in agent
 * shows its chip above the empty reply box, a click fills the box without
 * sending anything to the player, and the agent's own "close for me" switch
 * (kept on the server) takes the chip away.
 */
import { randomBytes } from 'node:crypto';
import { API_BASE, WIDGET_ORIGIN, expect, ownerAccessToken, test } from './fixtures.js';

test.describe('event-bound suggested replies (IN-07)', () => {
  test('a chat handed to the agent shows the bound chip; a click fills the box and sends nothing; the switch hides it (FR-MOD-02.3.2)', async ({
    agentPage: page,
    organizationId,
    request,
  }) => {
    const auth = { authorization: `Bearer ${await ownerAccessToken(request)}` };
    const me = (await (await request.get(`${API_BASE}/auth/me`, { headers: auth })).json()) as {
      account_id: string;
    };
    const stamp = randomBytes(3).toString('hex');
    const chipText = `Sohbeti devraldım ${stamp}, buradayım.`;
    let replyId: string | null = null;
    let chatId: string | null = null;

    try {
      const saved = await request.post(`${API_BASE}/settings/canned-responses`, {
        headers: auth,
        data: {
          shortcut: `devir${stamp}`,
          text: chipText,
          suggest_on: ['chat_transferred'],
          suggest_order: 1,
        },
      });
      expect(saved.status(), await saved.text()).toBe(201);
      replyId = ((await saved.json()) as { id: string }).id;

      // A player writes in; the conversation is then handed to the signed-in agent.
      const minted = await request.post(`${API_BASE}/customer/token`, {
        data: { organization_id: organizationId, host_origin: WIDGET_ORIGIN },
        headers: { origin: WIDGET_ORIGIN },
      });
      expect(minted.ok(), await minted.text()).toBe(true);
      const visitor = {
        authorization: `Bearer ${((await minted.json()) as { token: string }).token}`,
      };
      const sent = await request.post(`${API_BASE}/customer/chat/events`, {
        data: { text: 'Merhaba' },
        headers: visitor,
      });
      expect(sent.status(), await sent.text()).toBe(201);
      chatId = ((await sent.json()) as { chat_id: string }).chat_id;

      await page.goto('/app/inbox');
      await page.getByLabel('Availability').selectOption('accepting_chats');
      const handed = await request.post(`${API_BASE}/chats/${chatId}/transfer`, {
        data: { agent_id: me.account_id },
        headers: auth,
      });
      expect(handed.ok(), await handed.text()).toBe(true);
      // The player writes again after the hand-over, so the row's preview (the
      // newest event) is a line of ours rather than "Chat transferred".
      const again = await request.post(`${API_BASE}/customer/chat/events`, {
        data: { text: `Bonusum yüklenmedi ${stamp}` },
        headers: visitor,
      });
      expect(again.status(), await again.text()).toBe(201);

      // The agent opens it: the chip is above the empty box.
      const list = page.getByRole('region', { name: 'Conversations' });
      await expect(list).toContainText(`Bonusum yüklenmedi ${stamp}`, { timeout: 20_000 });
      await list
        .getByRole('button')
        .filter({ hasText: `Bonusum yüklenmedi ${stamp}` })
        .click();
      const composer = page.getByPlaceholder('Type your reply');
      const row = page.getByTestId('event-suggestions');
      await expect(row.getByRole('button', { name: chipText })).toBeVisible({ timeout: 15_000 });
      await expect(composer).toHaveValue('');

      // A click puts the words in the box — editable, and not sent.
      await row.getByRole('button', { name: chipText }).click();
      await expect(composer).toHaveValue(chipText);
      await expect(row).toHaveCount(0);
      const events = (await (
        await request.get(`${API_BASE}/chats/${chatId}/events`, { headers: auth })
      ).json()) as { items: Array<{ type: string; text: string | null; author_type: string }> };
      expect(
        events.items.filter((e) => e.author_type === 'agent' && e.text === chipText),
      ).toHaveLength(0);

      // The agent's own switch, on the # picker's gear, is kept on the server.
      await composer.fill('');
      await composer.fill(`#devir${stamp}`);
      const toggle = page.getByTestId('event-suggestions-toggle');
      await expect(toggle).toHaveText(/Close event suggestions for me/);
      const saved2 = page.waitForResponse(
        (r) => r.url().includes('/agents/me/ui-preferences') && r.request().method() === 'PUT',
      );
      await toggle.dispatchEvent('mousedown');
      const prefs = (await (await saved2).json()) as { suggestions_event_enabled: boolean };
      expect(prefs.suggestions_event_enabled).toBe(false);
      await expect(toggle).toHaveText(/Turn event suggestions back on/);
    } finally {
      // Put the switch back on for every other spec, then clean up.
      await request.put(`${API_BASE}/agents/me/ui-preferences`, {
        data: { suggestions_event_enabled: true },
        headers: auth,
      });
      if (chatId) await request.post(`${API_BASE}/chats/${chatId}/deactivate`, { headers: auth });
      if (replyId) {
        await request.delete(`${API_BASE}/settings/canned-responses/${replyId}`, {
          headers: auth,
        });
      }
    }
  });
});
