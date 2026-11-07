/**
 * The visitor's unsent draft, live to the person answering (FR-MOD-02.9 /
 * FR-MOD-11.8 · tm 417.7) — in a real widget and a real console, two contexts.
 *
 * What the unit and integration suites cannot prove on their own: that while
 * the AI has the conversation the widget sends nothing at all as the visitor
 * types, that the hand-over opens the gate on the widget's own poll answer
 * (`typing_preview: true`, asked for the moment an agent speaks — tm 417.5),
 * that the draft then reaches the assigned agent's strip within two seconds
 * through the real API and RTM gateway, that it stays (faded) when the visitor
 * leaves the box, costs no request while it sits there, goes when the visitor
 * sends it, and goes when the visitor's tab closes (`pagehide` with
 * `keepalive`). The 30 s staleness is not waited for here: `typing.test.ts`
 * proves it on a fake clock (tm 417.6).
 *
 * The AI phase is the real one: a knowledge source only this run's question
 * matches, so the seeded AI agent answers instead of handing over (the same
 * path `ai-mode.spec.ts` uses).
 */
import type { Page, Response } from '@playwright/test';
import {
  API_BASE,
  expect,
  openWidget,
  ownerAccessToken,
  tenantSubdomain,
  test,
  visitorSends,
  widgetFrame,
} from './fixtures.js';

const TYPING_PATH = '/customer/chat/typing';

/** The widget's poll (`GET /customer/chat`), not one of its sub-resources. */
function isPoll(response: Response): boolean {
  return (
    response.request().method() === 'GET' &&
    new URL(response.url()).pathname.endsWith('/customer/chat') &&
    response.ok()
  );
}

/** Wait for a poll answer that opens the draft gate. */
function gateOpens(page: Page): Promise<Response> {
  return page.waitForResponse(
    async (response) =>
      isPoll(response) &&
      ((await response.json().catch(() => null)) as { typing_preview?: boolean } | null)
        ?.typing_preview === true,
    { timeout: 20_000 },
  );
}

/** Count `POST /customer/chat/typing` requests the page (and its widget frame) makes. */
function countTyping(page: Page): { readonly count: number } {
  const counter = { count: 0 };
  page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname.endsWith(TYPING_PATH)) {
      counter.count += 1;
    }
  });
  return counter;
}

test.describe('visitor draft preview (FR-MOD-11.8)', () => {
  test('nothing is sent while the AI answers; after the hand-over the agent sees the draft within 2 s, it stays on blur, and sending or closing the tab takes it away (FR-MOD-11.8 · FR-MOD-02.9)', async ({
    agentPage,
    browser,
    organizationId,
    request,
  }) => {
    test.setTimeout(240_000);

    const run = Date.now().toString().slice(-6);
    const marker = `sneakpeek${run}`;
    const passage =
      `Standard ${marker} delivery takes 3 to 5 working days. ` +
      `Tracking for a ${marker} order is emailed the moment it dispatches.`;

    // --- A knowledge source only this run's question can match ----------------
    await agentPage.goto('/app/playbook?view=skills');
    const tabs = agentPage.getByRole('tablist', { name: 'AI Agent' });
    await tabs.getByRole('tab', { name: 'Knowledge' }).click();
    await agentPage.getByLabel('Title').fill(`Draft preview proof ${run}`);
    await agentPage.getByLabel('Content').fill(passage);
    const [created] = await Promise.all([
      agentPage.waitForResponse(
        (response) =>
          response.request().method() === 'POST' && response.url().endsWith('/knowledge-sources'),
      ),
      agentPage.getByRole('button', { name: 'Add source' }).click(),
    ]);
    const sourceId = ((await created.json()) as { id: string }).id;

    const site = tenantSubdomain(`sneak-peek-${run}`);
    const context = await browser.newContext();
    try {
      const visitor = await context.newPage();
      const typing = countTyping(visitor);
      await openWidget(visitor, organizationId, { host: site.origin });
      const frame = widgetFrame(visitor);
      const box = frame.getByRole('textbox', { name: 'Message', exact: true });
      const replies = frame.locator('.nx-row--bot .nx-bubble');

      // --- AI phase: the AI answers, and typing sends nothing ---------------------
      const opened = visitor.waitForResponse(
        (response) =>
          response.url().includes('/customer/chat/events') &&
          response.request().method() === 'POST' &&
          response.ok(),
      );
      await visitorSends(visitor, `How long does ${marker} delivery take?`);
      const { chat_id: chatId } = (await (await opened).json()) as { chat_id: string };
      await expect(replies).toHaveCount(1, { timeout: 30_000 });
      await expect(replies.last()).toContainText(marker);

      await agentPage.goto(`/app/inbox?chat=${chatId}`);
      const badge = agentPage.locator('[data-ai-mode]');
      await expect(badge).toHaveAttribute('data-ai-mode', 'ai', { timeout: 20_000 });

      // The polite live region is there before the first keystroke (step 7), empty.
      const status = agentPage.getByTestId('typing-indicator-status');
      await expect(status).toBeAttached();
      await expect(status).toHaveAttribute('role', 'status');
      await expect(status).toHaveText('');
      const strip = agentPage.getByTestId('typing-indicator');
      const draftText = agentPage.getByTestId('typing-preview-text');

      await visitor.bringToFront();
      await box.pressSequentially(`Is a ${marker} order tracked`, { delay: 40 });
      await visitor.waitForTimeout(2_000);
      expect(typing.count, 'no typing request while the AI has the chat').toBe(0);
      await expect(strip).toHaveCount(0);
      await box.fill('');
      await visitor.waitForTimeout(500);
      expect(typing.count).toBe(0);

      // --- Hand-over: the owner takes the chat over and is its assignee --------
      // Routing seated another agent behind the AI when the chat opened, so a
      // reply alone would leave that agent assigned (and the draft theirs): the
      // takeover is what makes this console the one the draft goes to. The gate
      // opens on the widget's own poll answer, asked for the moment
      // `chat_taken_over` arrives (tm 417.5) — not on the poll's cadence.
      const gate = gateOpens(visitor);
      const details = agentPage.getByRole('complementary', { name: 'Conversation details' });
      await details.getByRole('button', { name: 'Take over' }).click();
      const dialog = agentPage.getByRole('dialog', { name: 'Take over this chat?' });
      const taken = agentPage.waitForResponse(
        (response) =>
          response.url().endsWith(`/chats/${chatId}/takeover`) &&
          response.request().method() === 'POST',
      );
      await dialog.getByRole('button', { name: 'Take over' }).click();
      expect((await taken).status()).toBe(200);
      await expect(dialog).toHaveCount(0);
      await expect(badge).toHaveAttribute('data-ai-mode', 'human', { timeout: 20_000 });
      await gate;
      await expect(status).toHaveText('');
      expect(typing.count).toBe(0);

      // --- The draft reaches the agent within 2 s of the gate opening -------------
      const draft = 'Merhaba, siparişim';
      await visitor.bringToFront();
      const typedAt = Date.now();
      await box.fill(draft);
      await expect(draftText).toHaveText(`“${draft}”`, { timeout: 2_000 });
      const shownAfterMs = Date.now() - typedAt;
      console.log(`FR-MOD-11.8 draft on the agent's strip ${shownAfterMs} ms after the keystroke`);
      await expect(status).not.toHaveText('');
      const sentForDraft = typing.count;
      expect(sentForDraft).toBeGreaterThanOrEqual(1);

      // --- Blur: the draft stays, faded, and the idle box costs no request ------
      await box.blur();
      await visitor.waitForTimeout(7_000);
      await expect(agentPage.getByTestId('typing-preview-draft')).toBeVisible();
      await expect(draftText).toHaveText(`“${draft}”`);
      expect(typing.count, 'a draft that sits in the box sends nothing').toBe(sentForDraft);

      await agentPage.screenshot({ path: 'kanit/417-7-visitor-draft-strip.png' });

      // --- Sent: the strip goes, the message is in the transcript, no ghost ------
      await frame.getByRole('button', { name: 'Send' }).click();
      await expect(frame.getByRole('log', { name: 'Conversation' })).toContainText(draft);
      await expect(agentPage.getByRole('log', { name: 'Conversation transcript' })).toContainText(
        draft,
        { timeout: 10_000 },
      );
      await expect(strip).toHaveCount(0, { timeout: 5_000 });
      await agentPage.waitForTimeout(3_000);
      await expect(strip).toHaveCount(0);
      await visitor.close();

      // --- The tab closes: a new tab's draft goes when it is closed --------------
      const second = await context.newPage();
      const secondTyping = countTyping(second);
      const secondGate = gateOpens(second);
      await openWidget(second, organizationId, { host: site.origin });
      await secondGate;
      const secondBox = widgetFrame(second).getByRole('textbox', { name: 'Message', exact: true });
      await expect(widgetFrame(second).getByRole('log', { name: 'Conversation' })).toContainText(
        draft,
      );
      const another = 'Bir sorum daha var';
      await second.bringToFront();
      await secondBox.pressSequentially(another, { delay: 30 });
      await expect(draftText).toHaveText(`“${another}”`, { timeout: 3_000 });
      expect(secondTyping.count).toBeGreaterThanOrEqual(1);

      await second.close({ runBeforeUnload: true });
      await expect(strip).toHaveCount(0, { timeout: 2_000 });
    } finally {
      await context.close();
      // Taken away again: a later spec's delivery question must not find it.
      await request
        .delete(`${API_BASE}/knowledge-sources/${sourceId}`, {
          headers: { authorization: `Bearer ${await ownerAccessToken(request)}` },
        })
        .catch(() => {});
    }
  });
});
