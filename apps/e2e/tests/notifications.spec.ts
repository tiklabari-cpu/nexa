/**
 * Notification preferences (FR-MOD-13.8).
 *
 * The alerting itself — sound, desktop, the tab-title badge — is decided by a
 * pure function covered exhaustively in the web unit suite, and the e-mail
 * channel by an API integration test. What only a real browser can prove is
 * that the Settings surface exists and that turning notifications off actually
 * sticks: it must survive a reload and gate the per-channel controls beneath it.
 *
 * The preference lives on the account, not in the browser (13.7-c) — so unlike
 * `localStorage`, it is shared by every test that signs in as the demo owner,
 * and a write this file loses is a write the next test inherits (tm 250).
 */
import type { Page, Response } from '@playwright/test';
import {
  ACME_OWNER,
  API_BASE,
  expect,
  openWidget,
  ownerAccessTokenFor,
  test,
  visitorSends,
} from './fixtures.js';

/** The RTM gateway's admin `/health`, where open connections are counted. */
const RTM_BASE = 'http://localhost:4001';

const PREFERENCES_PATH = '/agents/me/notification-preferences';

/**
 * The server's answer to one write of the master switch. Start waiting before
 * the click: on an idle machine the response can land before the next line.
 */
function masterSwitchSaved(page: Page, enabled: boolean): Promise<Response> {
  return page.waitForResponse(
    (response) =>
      response.request().method() === 'PUT' &&
      response.url().endsWith(PREFERENCES_PATH) &&
      (response.request().postDataJSON() as { enabled?: boolean } | null)?.enabled === enabled,
  );
}

test.describe('notification settings (FR-MOD-13.8)', () => {
  test('the notifications surface toggles and the choice persists', async ({ agentPage }) => {
    await agentPage.goto('/app/settings');

    const section = agentPage.getByRole('region', { name: 'Notifications' });
    await expect(section).toBeVisible();

    const master = section.getByRole('checkbox', { name: /Enable notifications/ });
    const sound = section.getByRole('checkbox', { name: /Play a sound/ });

    // Default is on, so both the master and the per-channel toggles are live.
    await expect(master).toBeChecked();
    await expect(sound).toBeEnabled();

    // `fullPage: true` is useless on this route and was actively misleading:
    // `html, body, #root` are all `height: 100%`, so the document never scrolls
    // — the `Page` container does. A full-page capture therefore grows the
    // capture box without revealing anything below the fold, and Notifications
    // is the fourth section down. The file this line wrote was byte-identical to
    // `8-channels-grid.png` and `08.5.7-instagram-disconnected.png`: three names,
    // one picture of Settings → Channels, none of them notifications (tm 116).
    // Scroll the section into view and capture the viewport instead.
    await section.scrollIntoViewIfNeeded();
    await agentPage.screenshot({ path: 'kanit/16-notifications-settings.png' });

    // Every toggle here is optimistic: the checkbox moves before the PUT has
    // left the browser, so asserting on the checkbox proves React state and
    // nothing more. Navigating on that alone raced the write, and the race had
    // two losers, measured by holding each write back with `page.route` (tm
    // 250): a reload that cancels the "off" write fails the reload assertion
    // below, and a teardown that cancels the "back on" write leaves the account
    // silenced for the next test — which then watched a tab title that could
    // never rise. One or the other, never both, which is why they alternated.
    // Each write therefore waits for the server's own answer.

    // Turning the master off disables the channels under it — the negative path
    // an agent takes to go quiet.
    const turnedOff = masterSwitchSaved(agentPage, false);
    await master.uncheck();
    await expect(sound).toBeDisabled();
    expect(await (await turnedOff).json()).toMatchObject({ enabled: false });

    // The choice is stored, not just in React state: it survives a reload.
    await agentPage.reload();
    const masterAfter = agentPage
      .getByRole('region', { name: 'Notifications' })
      .getByRole('checkbox', { name: /Enable notifications/ });
    await expect(masterAfter).not.toBeChecked();

    // Put it back on so the shared demo workspace is left as it was found.
    const turnedOn = masterSwitchSaved(agentPage, true);
    await masterAfter.check();
    await expect(masterAfter).toBeChecked();
    expect(await (await turnedOn).json()).toMatchObject({ enabled: true });
  });
});

test.describe('notifications away from the inbox (FR-MOD-13.8)', () => {
  /**
   * The socket used to belong to `InboxPage`, so its lifetime was one route's
   * lifetime: an agent who opened Reports closed their connection and was told
   * nothing until they navigated back. Two halves are proven here, because
   * either one alone would pass for the wrong reason.
   *
   * **The connection survives the route change** — counted at the gateway
   * (`GET /health`, admin-only, reports `registry.size`), not inferred from the
   * app. Before this change the count dropped by one the moment the agent left
   * the inbox; that is the measurement, and nothing about focus or preferences
   * can flatter it.
   *
   * **A message that arrives while the agent is elsewhere still notifies.** The
   * tab title is the channel a browser test can observe: the chime needs an
   * audio device and the desktop alert a permission grant headless Chromium
   * will not give.
   *
   * No screenshot: the proof is `document.title` and a JSON field, neither of
   * which is in the viewport. A picture of the Reports page would be evidence
   * of nothing — the mistake `16-notifications-settings.png` above was fixed
   * for (tm 116).
   */
  test('keeps the connection and the alerts alive after the agent walks over to Reports', async ({
    agentPage,
    browser,
    organizationId,
    request,
  }) => {
    const adminToken = await ownerAccessTokenFor(request, ACME_OWNER);
    const gatewayConnections = async (): Promise<number> => {
      const response = await request.get(`${RTM_BASE}/health`, {
        headers: { authorization: `Bearer ${adminToken}` },
      });
      expect(response.ok(), `rtm health: ${response.status()}`).toBe(true);
      const body = (await response.json()) as { connections?: number };
      expect(body.connections, 'admin /health must report the connection count').toBeDefined();
      return body.connections!;
    };

    // The badge only rises for an account with notifications on, and the test
    // above turns them off and back on for this same account. State that here
    // rather than inherit it: when that restore was lost, this test read "Nexa"
    // for twenty seconds with a healthy socket, and the red named the socket.
    // Before `goto`, because the page caches the preference when it loads the
    // profile — a write after that would not reach `decideNotification`.
    const enabled = await request.put(`${API_BASE}${PREFERENCES_PATH}`, {
      headers: { authorization: `Bearer ${adminToken}` },
      data: { enabled: true },
    });
    expect(enabled.ok(), `notification preferences: ${enabled.status()}`).toBe(true);

    await agentPage.goto('/app/inbox');
    // The app's own report that the socket is up, so the test starts from a
    // known-live connection rather than a hopeful wait.
    await expect(agentPage.getByRole('region', { name: 'Conversations' })).toBeVisible();
    await expect(
      agentPage.getByRole('navigation', { name: 'Inbox views' }).getByText('Live'),
    ).toBeVisible({ timeout: 20_000 });

    const visitorContext = await browser.newContext();
    const visitor = await visitorContext.newPage();
    try {
      const stamp = Date.now().toString().slice(-6);
      await openWidget(visitor, organizationId);
      await visitorSends(visitor, `Hello, are you open today? ${stamp}`);
      await expect(agentPage.getByRole('region', { name: 'Conversations' })).toContainText(stamp, {
        timeout: 20_000,
      });

      // Both sockets — this agent and that visitor — are established and idle,
      // so the count is stable and any change from here is the navigation's.
      const before = await gatewayConnections();

      // Walk away from the inbox the way an agent does: through the rail, not a
      // reload, so the shell stays mounted and this exercises the lifetime that
      // used to end here.
      await agentPage.getByRole('link', { name: 'Reports' }).click();
      await expect(agentPage.getByRole('heading', { name: 'Reports' })).toBeVisible();
      expect(agentPage.url()).toContain('/app/reports');

      // Held, not merely sampled once: a socket closed on unmount would be gone
      // from the registry well inside this window (the old behaviour), and a
      // client that reconnected in a loop would show up as a number that moves.
      for (let i = 0; i < 4; i += 1) {
        await agentPage.waitForTimeout(500);
        expect(await gatewayConnections(), 'the gateway lost a connection on navigation').toBe(
          before,
        );
      }

      // The one thing headless Chromium will not model. Measured: with a second
      // tab in front, with `Emulation.setFocusEmulationEnabled` off, and even
      // frozen, this page still answers `hasFocus() === true` and
      // `visibilityState === 'visible'` — there is no window manager to be
      // behind. So the *browser* is corrected here, not the app:
      // `useNotifications` still calls `document.hasFocus()` and
      // `decideNotification` still decides. Patched by `evaluate` rather than
      // an init script so nothing reloads — the shell keeps the socket it
      // opened back on the inbox, which is the whole point of the test.
      await agentPage.evaluate(() => {
        Object.defineProperty(document, 'hasFocus', { value: () => false, configurable: true });
      });
      expect(await agentPage.title()).toBe('Nexa');

      await visitorSends(visitor, `Still there? ${stamp}`);

      // A page with no inbox on it, on a socket opened before the agent ever
      // came here, raising the unread badge.
      await expect.poll(() => agentPage.title(), { timeout: 20_000 }).toBe('(1) Nexa');
    } finally {
      await visitorContext.close();
    }
  });
});
