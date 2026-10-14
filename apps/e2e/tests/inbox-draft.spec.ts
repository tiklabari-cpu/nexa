/**
 * What an agent typed for one visitor never follows them into another visitor's
 * conversation (tm 277.1, IN-01) — and is waiting for them when they come back
 * to that visitor (tm 277.2).
 *
 * The inbox renders one `Composer` for whichever conversation is open, and the
 * text, the attachment and the reply/note mode live in that component's state.
 * Before the fix it carried no `key`, so switching to a conversation whose
 * detail was already cached kept the same instance — and the words written to
 * player A, A's receipt, and the "Internal note" toggle were all sitting in B's
 * box, one Enter away from B. The first visit to a conversation hid the bug:
 * its detail query has no placeholder, so the composer unmounted while it
 * loaded. That is why this test opens B once before writing to A — an agent
 * flicking back and forth between two open chats is the case that leaked.
 *
 * The web suite cannot see this: it is a property of how `InboxPage` mounts the
 * composer across a real navigation with a warm query cache, which is what a
 * browser session has and a mocked render does not.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Browser, BrowserContext } from '@playwright/test';
import { expect, openWidget, test, visitorSends } from './fixtures.js';

const SAMPLE_PNG = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../fixtures/sample.png',
);

async function visitorAsks(
  browser: Browser,
  organizationId: string,
  question: string,
): Promise<BrowserContext> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await openWidget(page, organizationId);
  await visitorSends(page, question);
  return context;
}

test.describe('inbox composer across conversations', () => {
  test('a draft, its attachment and note mode written for A do not follow the agent to B, and Enter there sends nothing', async ({
    agentPage,
    browser,
    organizationId,
  }) => {
    // Six digits, like `demo-flow.spec.ts`: clear of the card-mask window.
    const stamp = Date.now().toString().slice(-6);
    const questionA = `Where is my withdrawal? A-${stamp}`;
    const questionB = `Can I change my username? B-${stamp}`;
    const draft = `Your account is under review — A only ${stamp}`;

    const visitorA = await visitorAsks(browser, organizationId, questionA);
    const visitorB = await visitorAsks(browser, organizationId, questionB);

    try {
      await agentPage.goto('/app/inbox');
      const list = agentPage.getByRole('region', { name: 'Conversations' });
      const transcript = agentPage.getByRole('log', { name: 'Conversation transcript' });
      const box = agentPage.locator('#composer-input');
      const rowA = list.getByRole('button').filter({ hasText: questionA });
      const rowB = list.getByRole('button').filter({ hasText: questionB });
      await expect(list).toContainText(questionA, { timeout: 20_000 });
      await expect(list).toContainText(questionB, { timeout: 20_000 });

      // B first, so its detail is in the cache when the agent comes back to it.
      await rowB.click();
      await expect(transcript).toContainText(questionB);
      await expect(box).toBeVisible();

      // A: a reply-in-progress that is an internal note, with a file attached.
      await rowA.click();
      await expect(transcript).toContainText(questionA);
      await agentPage.getByRole('radio', { name: 'Internal note' }).click();
      await box.fill(draft);
      await agentPage.locator('input[type="file"]').setInputFiles(SAMPLE_PNG);
      await expect(agentPage.getByTestId('composer-attachment')).toContainText('sample.png');

      // B: anchored on B's own transcript being on screen with its composer, so
      // the absences below are read off B's composer and not a loading frame.
      await rowB.click();
      await expect(transcript).toContainText(questionB);
      await expect(transcript).not.toContainText(questionA);
      await expect(box).toBeVisible();
      await expect(box).toHaveValue('');
      await expect(agentPage.getByRole('radio', { name: 'Reply' })).toBeChecked();
      await expect(agentPage.getByTestId('composer-attachment')).toHaveCount(0);
      await agentPage.screenshot({ path: 'kanit/277.1-b-kutusu-bos.png', fullPage: true });

      // Enter in B's empty box sends nothing — not A's words, not A's file.
      const sends: string[] = [];
      agentPage.on('request', (request) => {
        if (request.method() === 'POST' && /\/chats\/[^/]+\/events$/.test(request.url())) {
          sends.push(request.url());
        }
      });
      await box.focus();
      await agentPage.keyboard.press('Enter');
      // Past the composer's own path to a request: `submit` posts synchronously
      // through `send.mutate`, so a send would be on the wire well inside this.
      await agentPage.waitForTimeout(1_500);
      expect(sends).toEqual([]);
      await expect(transcript).not.toContainText(draft);

      // Back on A: the words and the note mode are waiting (tm 277.2's
      // per-conversation draft store), the file is not (it never is).
      await rowA.click();
      await expect(transcript).toContainText(questionA);
      await expect(box).toBeVisible();
      await expect(box).toHaveValue(draft);
      await expect(agentPage.getByRole('radio', { name: 'Internal note' })).toBeChecked();
      await expect(agentPage.getByTestId('composer-attachment')).toHaveCount(0);

      // And B is still clean after the round trip.
      await rowB.click();
      await expect(transcript).toContainText(questionB);
      await expect(box).toHaveValue('');
      await expect(agentPage.getByRole('radio', { name: 'Reply' })).toBeChecked();
    } finally {
      await visitorA.close();
      await visitorB.close();
    }
  });
});
