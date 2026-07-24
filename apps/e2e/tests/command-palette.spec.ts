/**
 * Command palette (⌘K) — content search and route jumping (FR-MOD-01.1.3).
 *
 * The web unit suite drives the palette's mechanics (open/close, keyboard,
 * scope gating) against a stubbed API. What only a real browser proves is that
 * the keystroke opens it over a live session, that a search hits the seeded data
 * and returns the right people and conversations, and that choosing a result
 * actually lands on that record — the deep link has to survive the round trip
 * through the target screen, not just be constructed.
 */
import { expect, test } from './fixtures.js';

test.describe('command palette', () => {
  test('searches the workspace and opens the chosen record', async ({ agentPage }) => {
    // Opens from wherever the agent is — here, the inbox.
    await agentPage.keyboard.press('ControlOrMeta+k');
    const palette = agentPage.getByRole('dialog', { name: 'Command palette' });
    await expect(palette).toBeVisible();

    const input = palette.getByRole('combobox', { name: 'Search or jump to' });
    await input.fill('Alex');

    // A single query reaches across resources: Alex is a seeded customer with a
    // conversation, so both the person and the chat surface under their groups.
    await expect(palette.getByRole('option', { name: /Alex Moreau/ }).first()).toBeVisible();
    await agentPage.screenshot({ path: 'kanit/18-command-palette.png', fullPage: true });

    // Choosing the customer opens their record on the Customers screen — the
    // deep link is honoured by the page, not just formed by the palette.
    await palette.getByRole('option', { name: /alex@acme-customer/ }).click();
    await expect(agentPage.getByRole('heading', { name: 'Customers', level: 1 })).toBeVisible();
    await expect(agentPage.getByRole('heading', { name: 'Alex Moreau', level: 2 })).toBeVisible();
    await expect(palette).toBeHidden();
  });

  test('jumps straight to a module by name', async ({ agentPage }) => {
    await agentPage.keyboard.press('ControlOrMeta+k');
    const input = agentPage.getByRole('combobox', { name: 'Search or jump to' });
    await input.fill('Report');

    await agentPage.getByRole('option', { name: /Reports/ }).click();
    await expect(agentPage.getByRole('heading', { name: 'Reports', level: 1 })).toBeVisible();
    await expect(agentPage.getByRole('dialog', { name: 'Command palette' })).toBeHidden();
  });
});
