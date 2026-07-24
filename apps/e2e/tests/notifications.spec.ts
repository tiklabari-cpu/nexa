/**
 * Notification preferences (FR-MOD-13.8).
 *
 * The alerting itself — sound, desktop, the tab-title badge — is decided by a
 * pure function covered exhaustively in the web unit suite, and the e-mail
 * channel by an API integration test. What only a real browser can prove is
 * that the Settings surface exists and that turning notifications off actually
 * sticks: the preference lives in `localStorage`, so it must survive a reload
 * and gate the per-channel controls beneath it.
 */
import { expect, test } from './fixtures.js';

test.describe('notification settings', () => {
  test('the notifications surface toggles and the choice persists', async ({ agentPage }) => {
    await agentPage.goto('/app/settings');

    const section = agentPage.getByRole('region', { name: 'Notifications' });
    await expect(section).toBeVisible();

    const master = section.getByRole('checkbox', { name: /Enable notifications/ });
    const sound = section.getByRole('checkbox', { name: /Play a sound/ });

    // Default is on, so both the master and the per-channel toggles are live.
    await expect(master).toBeChecked();
    await expect(sound).toBeEnabled();

    await agentPage.screenshot({ path: 'kanit/16-notifications-settings.png', fullPage: true });

    // Turning the master off disables the channels under it — the negative path
    // an agent takes to go quiet.
    await master.uncheck();
    await expect(sound).toBeDisabled();

    // The choice is stored, not just in React state: it survives a reload.
    await agentPage.reload();
    const masterAfter = agentPage
      .getByRole('region', { name: 'Notifications' })
      .getByRole('checkbox', { name: /Enable notifications/ });
    await expect(masterAfter).not.toBeChecked();

    // Put it back on so the shared demo workspace is left as it was found.
    await masterAfter.check();
    await expect(masterAfter).toBeChecked();
  });
});
