/**
 * Settings › Usage and quotas › AI usage, in a browser (tm 283.4 · AI-16).
 *
 * `ai-usage.test.ts` (API) proves the numbers; the web unit tests prove how the
 * screen reads them. What only a browser shows is the door: the owner finds the
 * screen in the navigation and sees today's allowance, in UTC, with no editable
 * limit on it — and a teammate with the agent role neither sees the entry nor
 * lands on the page by typing its address.
 *
 * Read-only by construction (the recipient picker is not touched), so nothing
 * here needs putting back in the shared seeded database.
 */
import { expect, test, DEMO, signInAs } from './fixtures.js';

// Priya Nair — the seeded Acme teammate with the plain agent role (agent1 is an admin).
const MEMBER = { email: 'agent2@acme.localhost', password: DEMO.password } as const;

test.describe('AI usage settings (AI-16)', () => {
  test('the owner sees today’s allowance, the 30 UTC days and no way to raise the limit', async ({
    agentPage,
  }) => {
    await agentPage.goto('/app/settings/ai-usage');

    const nav = agentPage.getByRole('navigation', { name: 'Settings navigation' });
    await expect(nav.getByText('Usage and quotas', { exact: true })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'AI usage' })).toHaveAttribute(
      'aria-current',
      'page',
    );

    const section = agentPage.getByRole('region', { name: 'AI usage' });
    await expect(
      section.getByRole('progressbar', { name: 'Language model tokens', exact: true }),
    ).toBeVisible();
    await expect(
      section.getByRole('progressbar', { name: 'Embedding tokens', exact: true }),
    ).toBeVisible();
    // The day is UTC, said out loud — not the workspace's time zone.
    await expect(section.getByText(/in UTC\. The allowance renews at/)).toBeVisible();
    await expect(section.getByText(/Last 30 days \(UTC\)/)).toBeVisible();
    // The cap is the platform's: there is nothing here to edit it with.
    await expect(section.getByText(/cannot be changed here/)).toBeVisible();
    await expect(section.getByRole('spinbutton')).toHaveCount(0);

    await agentPage.screenshot({ path: 'kanit/AI-16-ai-usage.png', fullPage: true });
  });

  test('an agent gets neither the navigation entry nor the page', async ({ browser }) => {
    const context = await browser.newContext();
    const member = await context.newPage();
    try {
      await signInAs(member, MEMBER.email, MEMBER.password);
      await member.goto('/app/settings/ai-usage');

      // Sent back to the settings index, onto a section it may use.
      await expect(member).not.toHaveURL(/\/app\/settings\/ai-usage$/);
      const nav = member.getByRole('navigation', { name: 'Settings navigation' });
      await expect(nav).toBeVisible();
      await expect(nav.getByRole('link', { name: 'AI usage' })).toHaveCount(0);
      await expect(member.getByRole('region', { name: 'AI usage' })).toHaveCount(0);
    } finally {
      await context.close();
    }
  });
});
