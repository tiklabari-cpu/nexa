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
import { expect, test } from './fixtures.js';

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

/** Open the first conversation in the (seeded) All view. */
async function openFirstConversation(page: Page): Promise<void> {
  await page.getByRole('region', { name: 'Conversations' }).getByRole('button').first().click();
}
