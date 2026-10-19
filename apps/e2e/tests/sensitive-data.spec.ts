/**
 * Sensitive data in a conversation (tm 300.2 · SiyahTuş analysis AI-26).
 *
 * The API and web suites pin the masker, the policy and the badge one layer
 * at a time; only a browser shows the chain a person meets: a visitor types
 * their password into the widget, the widget reads back the masked line and
 * the warning in the visitor's language, and the agent's transcript shows the
 * same asterisks with a badge that says what was hidden — the raw value on
 * neither screen. Then the owner's page that explains it.
 */
import { expect, openWidgetAtComposer, test, widgetFrame } from './fixtures.js';

/** Letters only: a digit run near "şifre" would be masked as a code too. */
function tag(): string {
  return `kontrol${Math.random()
    .toString(36)
    .replace(/[^a-z]/g, '')
    .slice(0, 6)}`;
}

test.describe('sensitive data masking (AI-26)', () => {
  test("a visitor's password is masked for both sides, the visitor is warned, the agent sees a badge", async ({
    agentPage,
    browser,
    organizationId,
  }) => {
    await agentPage.goto('/app/inbox');
    const visitorContext = await browser.newContext();
    const visitor = await visitorContext.newPage();
    try {
      const marker = tag();
      await openWidgetAtComposer(visitor, organizationId);
      const frame = widgetFrame(visitor);
      const sent = visitor.waitForResponse(
        (response) =>
          response.url().includes('/customer/chat/events') &&
          response.request().method() === 'POST' &&
          response.ok(),
      );
      await frame
        .getByRole('textbox', { name: 'Message', exact: true })
        .fill(`${marker} bakiyem görünmüyor, yardım eder misiniz? Şifrem Ali1234!`);
      await frame.getByRole('button', { name: 'Send' }).click();
      await sent;

      // The visitor reads the server's copy: masked, and told why.
      const log = frame.getByRole('log', { name: 'Conversation' });
      await expect(log).toContainText('Şifrem ********');
      await expect(log).not.toContainText('Ali1234!');
      await expect(frame.locator('.nx-system--warning')).toContainText(
        /don't share passwords|şifre, SMS kodu/,
      );

      // The agent's transcript carries the same asterisks and names what they
      // hide. The list previews the conversation's newest line — the warning,
      // which only this spec writes.
      const list = agentPage.getByRole('region', { name: 'Conversations' });
      const row = list.getByRole('button').filter({ hasText: "please don't share passwords" });
      await expect(row.first()).toBeVisible({ timeout: 20_000 });
      await row.first().click();
      const transcript = agentPage.getByRole('log', { name: 'Conversation transcript' });
      await expect(transcript).toContainText(marker);
      await expect(transcript).toContainText('Şifrem ********');
      await expect(transcript).not.toContainText('Ali1234!');
      await expect(transcript.getByText('Sensitive data hidden (Password)')).toBeVisible();

      await agentPage.screenshot({ path: 'kanit/300.2-hassas-veri-rozeti.png', fullPage: true });
    } finally {
      await visitorContext.close();
    }
  });

  test('Settings › Security › Sensitive data explains what is masked and for whom', async ({
    agentPage,
  }) => {
    await agentPage.goto('/app/settings/sensitive-data');
    // The page's title and the section's heading both say it.
    await expect(agentPage.getByRole('heading', { name: 'Sensitive data' }).first()).toBeVisible();
    const table = agentPage.getByRole('table', { name: 'What is masked, and in whose messages' });
    const iban = table.getByRole('row', { name: /^IBAN/ });
    await expect(iban.getByRole('cell').nth(1)).toHaveText('Masked');
    await expect(iban.getByRole('cell').nth(2)).toHaveText('Shown in full');
    await expect(
      agentPage
        .getByRole('navigation', { name: 'Settings navigation' })
        .getByRole('link', { name: 'Sensitive data' }),
    ).toBeVisible();
  });
});
