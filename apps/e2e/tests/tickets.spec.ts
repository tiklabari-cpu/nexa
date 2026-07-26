/**
 * The ticket HelpDesk surface (PRD FR-MOD-13.6) in a real browser.
 *
 * The web unit suite pins each control's exact request — including merge and
 * unmerge, which mutate cross-ticket state the seed cannot reset between runs
 * and so are proven there rather than here. What only the live stack proves is
 * that the pane created from a conversation actually reaches the API: a priority
 * that survives its round-trip (the select is bound to server data, so a value
 * that sticks is a write that landed) and a follower that comes back from the
 * server as a removable row.
 *
 * Kept idempotent because the e2e seed reseeds without truncating: the ticket is
 * created *or reopened*, priority is set to the same level each run, and adding a
 * follower is a server-side no-op when it is already there.
 */
import { expect, test } from './fixtures.js';

test.describe('ticket HelpDesk surface', () => {
  // The transcript header is deliberately tight; at the default width its
  // right-side actions slide under the details panel. A roomy desktop viewport
  // keeps "Create ticket" clickable without collapsing the panel.
  test.use({ viewport: { width: 1680, height: 1050 } });

  test('sets a ticket priority and adds a follower against the live API', async ({ agentPage }) => {
    await agentPage.goto('/app/inbox');

    // Open the first seeded conversation, then create a ticket from it.
    await agentPage
      .getByRole('region', { name: 'Conversations' })
      .getByRole('button')
      .first()
      .click();
    await agentPage.getByRole('button', { name: 'Create ticket', exact: true }).click();
    await agentPage.getByRole('button', { name: 'Create', exact: true }).click();

    // A fresh chat opens the ticket pane directly; a chat that already carries a
    // ticket (a re-run) offers "Open it". Either way we end up on the pane.
    const openExisting = agentPage.getByRole('button', { name: 'Open it' });
    const priority = agentPage.getByLabel('Priority');
    await priority.or(openExisting).first().waitFor();
    if (await openExisting.isVisible()) await openExisting.click();
    await expect(priority).toBeVisible();

    // The select is controlled by the server's value, so it only reads Urgent
    // once the PATCH has round-tripped — which is the proof the write landed.
    await priority.selectOption('100');
    await expect(priority).toHaveValue('100');

    // Follow the ticket. The picker is disabled until the agent list loads and
    // when everyone already follows (possible on a re-run), so accept either an
    // enabled picker to add through or a follower row that is already present.
    const followerSelect = agentPage.getByLabel('Add a follower');
    const removeButton = agentPage.getByRole('button', { name: /^Remove / });
    await expect
      .poll(async () => (await followerSelect.isEnabled()) || (await removeButton.count()) > 0)
      .toBe(true);
    if (await followerSelect.isEnabled()) {
      await followerSelect.selectOption({ index: 1 });
      await agentPage.getByRole('button', { name: 'Add', exact: true }).click();
    }
    await expect(removeButton.first()).toBeVisible();
  });
});
