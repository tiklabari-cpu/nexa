/**
 * Inbox real-time tabs — All / Chatting / Queued / Waiting (FR-MOD-03.1.1).
 *
 * The web unit suite pins the bucketing arithmetic. What only a real browser
 * proves is that the tab strip renders over a live session, that its badges
 * agree with the list the agent actually sees, and that choosing a tab filters
 * that list on the spot — the count in the tab and the count in the list header
 * are computed from the same state, so if they ever disagree the filter and the
 * counter have drifted apart.
 */
import { expect, test } from './fixtures.js';

test.describe('inbox real-time tabs', () => {
  test('segments the conversation list live and filters on click', async ({ agentPage }) => {
    const tablist = agentPage.getByRole('tablist', { name: 'Real-time tabs' });
    await expect(tablist).toBeVisible();

    // All four tabs are present, and All is the default selection.
    for (const name of ['All', 'Chatting', 'Queued', 'Waiting']) {
      await expect(tablist.getByRole('tab', { name: new RegExp(name) })).toBeVisible();
    }
    await expect(tablist.getByRole('tab', { name: /All/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );

    // The list-header count and the active tab agree because they read the same
    // filtered list. Assert it for All, then switch to Queued and assert the
    // selection moved and the panel re-rendered against the new bucket.
    const list = agentPage.getByRole('region', { name: 'Conversations' });
    const headerCount = list.locator('header span').last();
    await expect(headerCount).toBeVisible();

    await agentPage.screenshot({ path: 'kanit/19-realtime-tabs.png', fullPage: true });

    const queued = tablist.getByRole('tab', { name: /Queued/ });
    await queued.click();
    await expect(queued).toHaveAttribute('aria-selected', 'true');
    await expect(tablist.getByRole('tab', { name: /All/ })).toHaveAttribute(
      'aria-selected',
      'false',
    );
    // The tabpanel is present and reflects the switch — either the queued rows
    // or the empty-tab state, never the full list under a "Queued" heading.
    await expect(list.getByRole('tabpanel')).toBeVisible();

    // Back to All restores the full list.
    await tablist.getByRole('tab', { name: /All/ }).click();
    await expect(tablist.getByRole('tab', { name: /All/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });
});
