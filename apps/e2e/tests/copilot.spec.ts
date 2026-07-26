/**
 * Copilot assist panel (FR-MOD-12.1).
 *
 * The web suite pins each assist against a stubbed API. What only a real browser
 * proves is the wiring: the Copilot control in the transcript header actually
 * swaps the right panel over to Copilot for the open conversation, the three
 * assists are on offer, and the Details tab brings the context panel back.
 */
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.js';

test.describe('copilot panel', () => {
  // The transcript header is deliberately tight; at the default width its
  // right-side actions (Copy link, Create ticket, Copilot) slide under the
  // details panel. A roomy desktop viewport is what an agent actually works in
  // — the same accommodation tickets.spec makes for the same header.
  test.use({ viewport: { width: 1680, height: 1050 } });

  test('opens Copilot from the transcript header and returns to Details', async ({ agentPage }) => {
    await agentPage.goto('/app/inbox');
    await openFirstConversation(agentPage);

    // Details is the default right panel.
    await expect(
      agentPage.getByRole('complementary', { name: 'Conversation details' }),
    ).toBeVisible();

    // The Copilot control in the header swaps the panel over.
    await agentPage.getByRole('button', { name: 'Copilot' }).click();
    const copilot = agentPage.getByRole('complementary', { name: 'Copilot' });
    await expect(copilot).toBeVisible();

    // The three assists are on offer (12.1 / 12.3).
    await expect(copilot.getByRole('button', { name: 'Summarise conversation' })).toBeVisible();
    await expect(copilot.getByRole('button', { name: 'Draft a reply' })).toBeVisible();
    await expect(copilot.getByRole('button', { name: 'Rephrase' })).toBeVisible();

    await agentPage.screenshot({ path: 'kanit/36-copilot-panel.png', fullPage: true });

    // The Details tab brings the context panel back.
    await copilot.getByRole('button', { name: 'Details' }).click();
    await expect(
      agentPage.getByRole('complementary', { name: 'Conversation details' }),
    ).toBeVisible();
  });
});

/** Open the first conversation in the (seeded) All view. */
async function openFirstConversation(page: Page): Promise<void> {
  await page.getByRole('region', { name: 'Conversations' }).getByRole('button').first().click();
}
