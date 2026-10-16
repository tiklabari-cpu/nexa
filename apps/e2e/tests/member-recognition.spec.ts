/**
 * Settings › Security › Member recognition, in a browser (ID-03 · tm 287.5).
 *
 * The integration suites prove the endpoints (`member-recognition-settings.test.ts`
 * and its neighbours) and `MemberRecognition.test.tsx` the screen against a mocked
 * API. What only a browser against the real stack shows is that an administrator
 * can reach the screen from the Security group, that a saved lifetime is what the
 * server answers on a reload, and that the key rotation goes through its question.
 *
 * "Forget all visitors" is walked only up to its question and its Cancel: the
 * bulk revocation refuses every member token the licence issued before it, and
 * this suite's workspace is shared with specs that hold a recognised visitor
 * open. The act itself is the integration suite's (and the unit test's).
 *
 * Self-cleaning: the lifetime this walk changes is put back. A rotation cannot be
 * undone — it only moves the key version on — and nothing else reads the version.
 */
import { expect, test } from './fixtures.js';

const SECTION = '#section-member-recognition';

test.describe('member recognition settings (ID-03)', () => {
  test('an admin finds the screen under Security, sets how long visitors are remembered and rotates the key', async ({
    agentPage,
  }) => {
    await agentPage.goto('/app/settings/member-recognition');

    const section = agentPage.locator(SECTION);
    const amount = agentPage.getByLabel('Remember for');
    await expect(amount).toHaveValue('30');
    await expect(section.getByLabel('Unit')).toHaveValue('days');

    // The navigation names the section under Security.
    await expect(
      agentPage
        .getByRole('navigation', { name: 'Settings navigation' })
        .getByRole('link', { name: 'Member recognition' }),
    ).toBeVisible();

    try {
      const saved = agentPage.waitForResponse(
        (response) =>
          response.url().endsWith('/settings/member-recognition') &&
          response.request().method() === 'PATCH',
      );
      await amount.fill('90');
      await section.getByRole('button', { name: 'Save' }).click();
      const response = await saved;
      expect(response.status()).toBe(200);
      expect((await response.json()).token_ttl_seconds).toBe(90 * 86_400);

      // Read back from the server: a value that only lived in the form would
      // come back as 30.
      await agentPage.reload();
      await expect(agentPage.getByLabel('Remember for')).toHaveValue('90');

      // The rotation asks first, and says what the grace window keeps.
      await section.getByRole('button', { name: 'Rotate the key' }).click();
      const dialog = agentPage.getByRole('dialog', { name: 'Rotate the signing key?' });
      await expect(dialog).toContainText('still recognised for 7 days');
      const rotated = agentPage.waitForResponse(
        (r) => r.url().endsWith('/rotate-key') && r.request().method() === 'POST',
      );
      await dialog.getByRole('button', { name: 'Rotate key' }).click();
      const rotation = await rotated;
      expect(rotation.status()).toBe(200);
      expect(rotation.request().postDataJSON()).toStrictEqual({
        grace_period_seconds: 7 * 86_400,
      });
      await expect(section.getByText('Current version')).toBeVisible();

      // Forgetting everyone: the question appears, and Cancel forgets nobody.
      await section.getByRole('button', { name: 'Forget all visitors' }).click();
      const forget = agentPage.getByRole('dialog', { name: 'Forget every returning visitor?' });
      await expect(forget).toContainText('This cannot be undone.');
      await forget.getByRole('button', { name: 'Cancel' }).click();
      await expect(forget).toBeHidden();
      await expect(section.getByText(/Last done/)).toHaveCount(0);
    } finally {
      // Shared seeded database: leave the workspace at the default lifetime.
      const restored = agentPage.waitForResponse(
        (r) => r.url().endsWith('/settings/member-recognition') && r.request().method() === 'PATCH',
      );
      await agentPage.getByLabel('Remember for').fill('30');
      await section.getByRole('button', { name: 'Save' }).click();
      expect((await restored).status()).toBe(200);
    }
  });
});
