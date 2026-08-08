/**
 * Command palette (⌘K) — content search and route jumping (FR-MOD-01.1.3).
 *
 * The web unit suite drives the palette's mechanics (open/close, keyboard,
 * scope gating, optimistic rollback) against a stubbed API. What only a real
 * browser proves is that the keystroke opens it over a live session, that a
 * search hits the seeded data and returns the right people and conversations,
 * that choosing a result actually lands on that record — the deep link has to
 * survive the round trip through the target screen, not just be constructed —
 * and that an action chosen here reaches the server, not merely the store.
 */
import { DEMO, expect, test } from './fixtures.js';

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

  /**
   * The action result type, end to end (FR-MOD-01.1.3, FR-EK-A.2).
   *
   * The web suite proves the palette sends the right request and rolls back a
   * refused one against a stub. What only a real stack proves is that the write
   * actually reached the server: availability decides whether the router hands
   * this agent work, so a toggle that updated nothing but the local store would
   * look identical in the browser and be wrong everywhere that matters. The
   * Team screen reads it back over the API — a different session's view of the
   * same agent — which is why the assertion lives there rather than on the
   * availability control the action itself drove.
   *
   * It toggles back before finishing. The suite shares one seed and runs
   * serially, and a specification that leaves the demo agent refusing chats
   * breaks the routing flows that come after it.
   */
  test('stops and restarts accepting chats, and the Team screen agrees', async ({ agentPage }) => {
    const palette = agentPage.getByRole('dialog', { name: 'Command palette' });

    await agentPage.keyboard.press('ControlOrMeta+k');
    await agentPage.getByRole('combobox', { name: 'Search or jump to' }).fill('accepting');
    await agentPage.getByRole('option', { name: 'Stop Accepting Chats' }).click();

    // The palette gets out of the way rather than holding the keyboard over a
    // request it has already shown the result of.
    await expect(palette).toBeHidden();

    await agentPage.getByRole('link', { name: 'Team' }).click();
    await expect(agentPage.getByRole('heading', { name: 'Team', level: 1 })).toBeVisible();
    const me = agentPage.getByRole('row').filter({ hasText: DEMO.agentName });
    await expect(me).toContainText('Not accepting');
    await agentPage.screenshot({ path: 'kanit/95-palette-action.png', fullPage: true });

    // Back on: the entry relabels itself from the status it just wrote, so the
    // same search now offers the opposite action.
    await agentPage.keyboard.press('ControlOrMeta+k');
    await agentPage.getByRole('combobox', { name: 'Search or jump to' }).fill('accepting');
    await agentPage.getByRole('option', { name: 'Start Accepting Chats' }).click();
    await expect(palette).toBeHidden();

    await agentPage.reload();
    await expect(agentPage.getByRole('row').filter({ hasText: DEMO.agentName })).toContainText(
      'Accepting chats',
    );
  });
});
