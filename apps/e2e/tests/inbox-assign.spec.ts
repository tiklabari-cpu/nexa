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
 * The receiving agent's availability is set first, and by that agent: the route
 * refuses a hand-off to somebody who is offline (`group_unavailable`), and the
 * seeded roster's availability is writable by any spec that signs in as them.
 * Asserting on a fresh conversation for the same reason `inbox-panel.spec.ts`
 * does — the seeded "All" view's first row may already be archived.
 */
import { DEMO, expect, openWidget, test, visitorSends } from './fixtures.js';

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

    try {
      // The teammate signs in and declares themselves available, so the
      // hand-off below is refused for a product reason or not at all.
      await receiver.goto('/');
      await receiver.getByLabel('Email').fill(RECEIVER.email);
      await receiver.getByLabel('Password').fill(DEMO.password);
      await receiver.getByRole('button', { name: 'Sign in' }).click();
      await expect(receiver.getByRole('link', { name: 'Inbox' })).toBeVisible();
      await receiver.goto('/app/inbox');
      await receiver.getByLabel('Availability').selectOption('accepting_chats');

      const receiverList = receiver.getByRole('region', { name: 'Conversations' });
      const receiverRail = receiver.getByRole('navigation', { name: 'Inbox views' });
      const myChats = receiverRail.getByRole('button', { name: /^My chats/ });

      // A live conversation to hand over.
      await openWidget(visitor, organizationId);
      await visitorSends(visitor, question);

      // Before: however many conversations this teammate already holds. A count
      // rather than "this row is absent", because the row is identified by its
      // last message and the hand-off itself writes the last message
      // ("Chat transferred") — so the text this conversation is known by on the
      // *sender's* screen is gone by the time it reaches the receiver's list.
      await myChats.click();
      await expect(receiver.getByRole('heading', { level: 2, name: 'My chats' })).toBeVisible();
      const before = await receiverList.getByRole('listitem').count();

      // The owner opens it and hands it over from the Details panel.
      await agentPage.goto('/app/inbox');
      const list = agentPage.getByRole('region', { name: 'Conversations' });
      await expect(list).toContainText(question, { timeout: 20_000 });
      await list.getByRole('button').filter({ hasText: question }).click();

      const details = agentPage.getByRole('complementary', { name: 'Conversation details' });
      const assignee = details.getByRole('button', { name: 'Change assignee' });
      await expect(assignee).toBeVisible();

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
      await visitorContext.close();
      await receiverContext.close();
    }
  });
});
