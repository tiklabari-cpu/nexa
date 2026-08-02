/**
 * Inbox right-panel switcher (FR-MOD-01.3).
 *
 * The web unit suite pins the persistence arithmetic. What only a real browser
 * proves is that the header control actually removes the Details panel from the
 * layout and brings it back, and that the choice survives a full reload — the
 * preference has to round-trip through `localStorage` on a live session, not
 * just in a stubbed store.
 */
import type { Page } from '@playwright/test';
import { DEMO, expect, openWidget, test, visitorSends } from './fixtures.js';

test.describe('inbox right panel', () => {
  test('toggles the Details panel and remembers the choice across a reload', async ({
    agentPage,
  }) => {
    await agentPage.goto('/app/inbox');

    // Open a seeded conversation so the transcript header and Details panel render.
    await openFirstConversation(agentPage);

    const details = agentPage.getByRole('complementary', { name: 'Conversation details' });

    // It starts open. Collapse it from the panel's own header — the panel then
    // leaves the layout and the transcript takes the full width.
    await expect(details).toBeVisible();
    await details.getByRole('button', { name: 'Collapse details panel' }).click();
    await expect(details).toBeHidden();

    await agentPage.screenshot({ path: 'kanit/28-panel-expanded.png', fullPage: true });

    // The choice survives a reload — a fresh page reads the remembered mode, so
    // the panel is still gone without touching it.
    await agentPage.reload();
    await openFirstConversation(agentPage);
    await expect(
      agentPage.getByRole('complementary', { name: 'Conversation details' }),
    ).toBeHidden();

    // The wide transcript header offers the way back; using it restores the panel.
    await agentPage.getByRole('button', { name: 'Show details panel' }).click();
    await expect(
      agentPage.getByRole('complementary', { name: 'Conversation details' }),
    ).toBeVisible();
  });
});

/**
 * Multi-agent composing conflict (FR-MOD-08.6.3).
 *
 * The web unit suite (`useInbox.test.tsx`) pins the push → store → banner
 * wiring against a fake push. What only a real browser proves is the whole
 * chain behind that push: two independent agent sessions typing at once,
 * through the RTM socket, the conflict detector, and the fan-out, landing back
 * as a visible banner — none of which a unit test touches.
 */
test.describe('multi-agent composing conflict', () => {
  test('a conflict banner appears while two agents reply to the same conversation at once', async ({
    agentPage,
    browser,
    organizationId,
  }) => {
    await agentPage.goto('/app/inbox');
    await agentPage.getByLabel('Availability').selectOption('accepting_chats');

    const visitorContext = await browser.newContext();
    const secondContext = await browser.newContext();
    const visitor = await visitorContext.newPage();
    const secondAgent = await secondContext.newPage();

    try {
      // A conversation created fresh for this test, not picked off the seeded
      // "All" view — that view has no active filter (chat-service.ts `case
      // 'all'`), so its first row can just as easily be a chat an earlier test
      // in this suite archived, whose composer is disabled and has nothing to
      // type into.
      const question = `Can two of you look at this? ${Date.now().toString().slice(-6)}`;
      await openWidget(visitor, organizationId);
      await visitorSends(visitor, question);

      await openConversation(agentPage, question);

      // The seeded Acme tenant's first non-owner agent — a distinct account so
      // the conflict detector sees two composers, not one agent twice.
      await signInAs(secondAgent, 'agent1@acme.localhost', DEMO.password);
      await secondAgent.goto('/app/inbox');
      await openConversation(secondAgent, question);

      // Both start replying to the same conversation at once.
      await agentPage.getByPlaceholder('Type your reply').fill('Looking into this now');
      await secondAgent.getByPlaceholder('Type your reply').fill('I can take this one');

      const banner = agentPage.getByTestId('conflict-banner');
      await expect(banner).toBeVisible({ timeout: 15_000 });
      await expect(banner).toContainText('2');
    } finally {
      await visitorContext.close();
      await secondContext.close();
    }
  });
});

/** Open the conversation whose last message matches `text` — never "the first one". */
async function openConversation(page: Page, text: string): Promise<void> {
  const list = page.getByRole('region', { name: 'Conversations' });
  await expect(list).toContainText(text, { timeout: 20_000 });
  await list.getByRole('button').filter({ hasText: text }).click();
}

/** Open the first conversation in the (seeded) All view. */
async function openFirstConversation(page: Page): Promise<void> {
  await page.getByRole('region', { name: 'Conversations' }).getByRole('button').first().click();
}

/** Sign in as an arbitrary seeded agent — `agentPage` only covers the tenant owner. */
async function signInAs(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('link', { name: 'Inbox' })).toBeVisible();
}
