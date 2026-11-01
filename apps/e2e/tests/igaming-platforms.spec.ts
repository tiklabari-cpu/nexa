/**
 * The iGaming platform placeholder cards, in a real browser (KN-06 F1 · K15 · tm 377).
 *
 * Settings → Integrations lists BetConstruct and EveryMatrix as "Coming soon"; their
 * "Connect" buttons cannot be pressed and there is no connection flow behind them. The
 * web unit suite holds the markup against a mocked client; what only a browser can show
 * is that the cards really paint in the shipped panel, that the button is out of the
 * way for a real click, that nothing is requested when it is pressed, and that the page
 * passes the machine accessibility measure with the disabled controls on it.
 */
import { scanScreen, assertNoBlockingViolations } from './a11y.js';
import { expect, test } from './fixtures.js';

test.describe('iGaming platform placeholders', () => {
  test('shows Coming soon cards whose Connect button is inert and sends nothing', async ({
    agentPage,
  }, testInfo) => {
    await agentPage.goto('/app/settings/integrations');

    const section = agentPage.getByRole('region', { name: 'iGaming platforms' });
    await expect(section).toBeVisible();
    for (const name of ['BetConstruct', 'EveryMatrix']) {
      const card = section.getByRole('listitem').filter({ hasText: name });
      await expect(card.getByText('Coming soon')).toBeVisible();
      const connect = card.getByRole('button', { name: 'Connect' });
      await expect(connect).toBeDisabled();
      await expect(connect).toHaveAttribute('aria-disabled', 'true');
      await expect(connect).toHaveAccessibleDescription(/not available yet/);
    }

    const requests: string[] = [];
    agentPage.on('request', (request) => requests.push(`${request.method()} ${request.url()}`));
    for (const connect of await section.getByRole('button', { name: 'Connect' }).all()) {
      await connect.click({ force: true });
    }
    // Let anything a stray handler would have fired actually leave the page.
    await agentPage.waitForTimeout(500);
    expect(requests, 'pressing Connect must not request anything').toEqual([]);

    assertNoBlockingViolations(await scanScreen(agentPage, 'Settings integrations', testInfo));
  });
});
