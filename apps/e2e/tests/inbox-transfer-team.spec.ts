/**
 * Handing a conversation to a team (tm 306 · IN-04, IN-04-S1).
 *
 * The web suite pins the menu and the dialog against a mocked client; the
 * integration suite pins what the hand-off does to the connection. Neither
 * walks the console end to end: the assignee menu's Team section with its
 * "· 1 online", the dialog's note landing in the transcript as an internal
 * note, the notice, and — through the header's "Transfer…" — a team with
 * nobody free taking the chat into its queue rather than refusing it.
 *
 * Two teams made for this run and removed after it, in the seeded tenant:
 * one whose only member is Priya (accepting — her free slot is made sure of
 * first, `freeARoutingSlot`), one whose only member is the owner doing the
 * hand-off — "someone else", so it can only wait in that team's queue. The
 * owner takes each conversation over first, so its holder is never Priya.
 */
import type { Browser, Page } from '@playwright/test';
import {
  API_BASE,
  DEMO,
  expect,
  freeARoutingSlot,
  openWidget,
  ownerAccessToken,
  test,
  visitorSends,
} from './fixtures.js';

const RECEIVER_EMAIL = 'agent2@acme.localhost';

interface RosterAgent {
  id: string;
  email: string;
  concurrent_chats_limit: number;
}

test.describe('handing a conversation to a team (IN-04)', () => {
  test('a team with someone free gets it with the note; a team with nobody free queues it (FR-MOD-02.4.1–.6 · FR-MOD-08.6.1)', async ({
    agentPage,
    browser,
    organizationId,
    request,
  }) => {
    const stamp = Date.now().toString().slice(-6);
    const auth = { authorization: `Bearer ${await ownerAccessToken(request)}` };
    const teamIds: number[] = [];
    const chatIds: string[] = [];
    const contexts: Awaited<ReturnType<Browser['newContext']>>[] = [];

    const roster = (
      (await (await request.get(`${API_BASE}/agents`, { headers: auth })).json()) as {
        items: RosterAgent[];
      }
    ).items;
    const receiver = roster.find((a) => a.email === RECEIVER_EMAIL)!;
    const ownerId = roster.find((a) => a.email === DEMO.email)!.id;
    expect(receiver, 'receiver not seeded').toBeTruthy();

    /** A team of this run, with one member. */
    async function team(name: string, memberId: string): Promise<string> {
      const created = await request.post(`${API_BASE}/groups`, { headers: auth, data: { name } });
      expect(created.status()).toBe(201);
      const id = ((await created.json()) as { id: number }).id;
      teamIds.push(id);
      const member = await request.put(`${API_BASE}/groups/${id}/agents/${memberId}`, {
        headers: auth,
        data: { priority: 'normal' },
      });
      expect(member.ok()).toBe(true);
      return name;
    }

    /** A visitor writes in; the owner opens that conversation. */
    async function liveChat(question: string): Promise<string> {
      const context = await browser.newContext();
      contexts.push(context);
      const visitor = await context.newPage();
      await openWidget(visitor, organizationId);
      await visitorSends(visitor, question);
      let chatId: string | undefined;
      await expect
        .poll(
          async () => {
            const res = await request.get(`${API_BASE}/chats?view=all&limit=50`, { headers: auth });
            const { items } = (await res.json()) as {
              items: Array<{ id: string; last_event: { text?: string } | null }>;
            };
            chatId = items.find((c) => c.last_event?.text?.includes(question))?.id;
            return chatId;
          },
          { timeout: 20_000, message: 'the widget conversation never reached the API' },
        )
        .toBeTruthy();
      chatIds.push(chatId!);
      // The owner holds it, whoever routing gave it to: a hand-off by its
      // holder passes its holder over, so a chat routed to Priya on open
      // would never be handed back to her.
      const taken = await request.post(`${API_BASE}/chats/${chatId}/takeover`, { headers: auth });
      expect(taken.ok(), `takeover: ${taken.status()} ${await taken.text()}`).toBe(true);
      await agentPage.goto(`/app/inbox?chat=${chatId}`);
      await expect(agentPage.getByRole('log', { name: 'Conversation transcript' })).toContainText(
        question,
      );
      return chatId!;
    }

    const threadOf = async (chatId: string) =>
      (await (await request.get(`${API_BASE}/chats/${chatId}`, { headers: auth })).json()) as {
        thread: { assignee_id: string | null; queue_position: number | null };
        access: { group_ids: number[] };
      };

    const notice = (page: Page) => page.getByRole('status').filter({ hasText: /handed|waits/ });

    try {
      const finance = await team(`Finans e2e ${stamp}`, receiver.id);
      const queueOnly = await team(`Kuyruk e2e ${stamp}`, ownerId);
      await freeARoutingSlot(request, auth, receiver.id, receiver.concurrent_chats_limit);

      // --- 1. From the assignee menu, to a team with someone free -----------
      const firstQuestion = `Çekimim nerede? ${stamp}`;
      const first = await liveChat(firstQuestion);
      const details = agentPage.getByRole('complementary', { name: 'Conversation details' });
      await details.getByRole('button', { name: 'Change assignee' }).click();
      const financeRow = details.getByRole('button', { name: new RegExp(finance) });
      await expect(financeRow).toContainText('1 online');
      await financeRow.click();

      const dialog = agentPage.getByRole('dialog', { name: 'Transfer the conversation' });
      await expect(dialog.getByRole('radio', { name: new RegExp(finance) })).toBeChecked();
      const note = `IBAN doğrulandı, 3 gündür bekliyor ${stamp}`;
      await dialog.getByLabel('Note (optional)').fill(note);
      const transferred = agentPage.waitForResponse(
        (r) => /\/chats\/[^/]+\/transfer$/.test(r.url()) && r.request().method() === 'POST',
      );
      await dialog.getByRole('button', { name: 'Transfer' }).click();
      const answer = await transferred;
      expect(answer.status()).toBe(200);
      expect(((await answer.json()) as { outcome: string }).outcome).toBe('assigned');

      await expect(notice(agentPage)).toContainText(`Chat handed to the ${finance} team.`);
      await expect(dialog).toBeHidden();
      // Priya has it, the team has it, and the note is the agents' only.
      const handed = await threadOf(first);
      expect(handed.thread.assignee_id).toBe(receiver.id);
      expect(handed.access.group_ids).toEqual([teamIds[0]]);
      const transcript = agentPage.getByRole('log', { name: 'Conversation transcript' });
      await expect(transcript).toContainText(note);
      await expect(transcript.getByText('Internal note').last()).toBeVisible();
      await agentPage.screenshot({ path: 'kanit/in-04-transfer-team.png', fullPage: true });

      // --- 2. From the header, to a team with nobody free ---------------------
      const second = await liveChat(`Bonusum yüklenmedi ${stamp}`);
      await agentPage.getByRole('button', { name: 'Transfer…' }).click();
      const headerDialog = agentPage.getByRole('dialog', { name: 'Transfer the conversation' });
      await headerDialog.getByRole('radio', { name: new RegExp(queueOnly) }).check();
      await headerDialog.getByRole('button', { name: 'Transfer' }).click();

      await expect(notice(agentPage)).toContainText(
        `Nobody in ${queueOnly} is free right now — the chat waits in the team’s queue.`,
      );
      const waiting = await threadOf(second);
      expect(waiting.thread.assignee_id).toBeNull();
      expect(waiting.thread.queue_position).not.toBeNull();
      expect(waiting.access.group_ids).toEqual([teamIds[1]]);
      await agentPage.screenshot({ path: 'kanit/in-04-transfer-queued.png', fullPage: true });
    } finally {
      for (const chatId of chatIds) {
        await request.post(`${API_BASE}/chats/${chatId}/deactivate`, { headers: auth });
      }
      for (const id of teamIds) await request.delete(`${API_BASE}/groups/${id}`, { headers: auth });
      for (const context of contexts) await context.close();
    }
  });
});
