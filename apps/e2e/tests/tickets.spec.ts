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

  /**
   * The Tickets grid (FR-MOD-02.7). The unit suite proves the sort maths and the
   * URL round-trip; what only the live stack proves is that the sort actually
   * rides in the URL — a header click that lands in the address bar, and a pasted
   * link that reopens the grid already sorted — and that a row is the way into
   * the ticket conversation. The seed carries no tickets, so one is created (or
   * reused on a re-run) first, exactly as the priority test does.
   */
  test('sorts the tickets grid from the URL and opens a ticket from a row', async ({
    agentPage,
  }) => {
    await agentPage.goto('/app/inbox');

    // Ensure at least one ticket exists. The create resolves to the ticket pane
    // (a fresh chat) or an "Open it" prompt (a chat that already carries one, on
    // a re-run) — either way a ticket now exists, which is all the grid needs.
    await agentPage
      .getByRole('region', { name: 'Conversations' })
      .getByRole('button')
      .first()
      .click();
    await agentPage.getByRole('button', { name: 'Create ticket', exact: true }).click();
    await agentPage.getByRole('button', { name: 'Create', exact: true }).click();
    await agentPage
      .getByRole('button', { name: 'Tickets', exact: true })
      .or(agentPage.getByRole('button', { name: 'Open it' }))
      .first()
      .waitFor();

    // Open the grid from the nav (works from the pane or the chat alike).
    await agentPage.getByRole('button', { name: 'All tickets' }).click();

    // The grid is a sortable table; a header click writes the sort into the URL.
    const grid = agentPage.getByRole('table', { name: 'Tickets' });
    await expect(grid).toBeVisible();
    await agentPage.getByRole('button', { name: 'Subject' }).click();
    await expect(agentPage).toHaveURL(/ticket_sort=subject/);
    await expect(agentPage.getByRole('columnheader', { name: /Subject/ })).toHaveAttribute(
      'aria-sort',
      'ascending',
    );

    // A pasted link reopens the grid already sorted — the point of URL sorting.
    await agentPage.goto('/app/inbox?ticket_sort=subject&ticket_order=desc');
    const sortedGrid = agentPage.getByRole('table', { name: 'Tickets' });
    await expect(sortedGrid).toBeVisible();
    await expect(agentPage.getByRole('columnheader', { name: /Subject/ })).toHaveAttribute(
      'aria-sort',
      'descending',
    );

    // A row opens the ticket conversation behind it.
    await sortedGrid.getByRole('row').nth(1).getByRole('button').first().click();
    await expect(agentPage.getByRole('button', { name: 'Tickets', exact: true })).toBeVisible();
  });
});
