/**
 * Single sign-on, in a browser (NFR-S11 · S11-i).
 *
 * The integration suite drives federation by handing the ACS an assertion it
 * minted in-process, which proves the endpoints and cannot prove the journey.
 * This does the journey: an owner configures a connection on the Settings
 * screen, a second browser leaves the app for an identity provider on another
 * origin, that IdP posts a signed assertion back with a cross-origin form
 * navigation, and the person lands in the panel with a session that works.
 *
 * Every hop there is somewhere the product can break while every server-side
 * test stays green — a redirect the SPA swallows, a route that does not exist
 * for the authorization code to come back to, a PKCE verifier that did not
 * survive leaving the page, a form post the API refuses because it is not JSON.
 *
 * The identity provider is `apps/api/scripts/mock-idp-server.ts`, started by
 * `playwright.config.ts` on loopback. It authenticates nobody: *who* signs in is
 * a query parameter on the connection's sign-on URL, so a test can say "this
 * person, at this workspace" with no login form to script.
 *
 * The person it signs in is a *seeded* member. JIT provisioning is proven at
 * integration level; using a new address here would add a member to the roster
 * that the specs running after this one read.
 */
import type { APIRequestContext } from '@playwright/test';
import { expect, test } from './fixtures.js';
import { API_BASE, ownerAccessToken } from './fixtures.js';

const MOCK_IDP = 'http://127.0.0.1:4599';

/** A seeded Acme agent (Priya Nair) — already on the roster, so nothing is added. */
const SSO_MEMBER = 'agent2@acme.localhost';

interface IdpMetadata {
  entity_id: string;
  sso_url: string;
  certificate_pem: string;
}

/** The connection the owner just created, read back through the API. */
async function readConnectionId(request: APIRequestContext, token: string): Promise<string> {
  const response = await request.get(`${API_BASE}/settings/sso`, {
    headers: { authorization: `Bearer ${token}` },
  });
  expect(response.ok(), `list sso failed: ${response.status()}`).toBe(true);
  const { items } = (await response.json()) as { items: Array<{ id: string }> };
  expect(items.length, 'the connection the form created was not listed').toBeGreaterThan(0);
  return items[0]!.id;
}

test.describe('single sign-on', () => {
  test('an owner configures SAML, and a member signs in through the identity provider', async ({
    agentPage,
    browser,
    request,
  }) => {
    const metadata = (await (await request.get(`${MOCK_IDP}/metadata`)).json()) as IdpMetadata;

    // --- Configure, from the screen ------------------------------------------
    await agentPage.goto('/app/settings');
    const section = (): ReturnType<typeof agentPage.getByRole> =>
      agentPage.getByRole('region', { name: 'Single sign-on' });
    await expect(
      section().getByRole('heading', { name: 'Single sign-on', level: 2 }),
    ).toBeVisible();

    // Exact, because "Name attribute (optional)" is in the same form.
    await section().getByLabel('Name', { exact: true }).fill('Mock IdP (e2e)');
    await section().getByLabel('IdP entity id').fill(metadata.entity_id);
    // The subject rides on the sign-on URL: the mock IdP asks nobody to log in,
    // so this is how the test names the person the assertion will vouch for. A
    // real console would have a user directory behind the same URL.
    await section()
      .getByLabel('Sign-on URL')
      .fill(`${metadata.sso_url}?user=${encodeURIComponent(SSO_MEMBER)}`);
    await section().getByLabel('IdP signing certificate (PEM)').fill(metadata.certificate_pem);
    // The domains this identity provider may provision from (PLAN §D116). The
    // seeded member below lives on `acme.localhost`; without this the ACS
    // refuses the assertion and the journey stops one hop before the panel.
    await section().getByLabel('Verified domains').fill('acme.localhost');
    await section().getByLabel('Enable immediately').check();

    // The format check is local by design (§D99): it must not reach the IdP.
    await section().getByRole('button', { name: 'Verify format' }).click();
    await expect(section().getByRole('status')).toContainText('Looks well-formed');

    const created = agentPage.waitForResponse(
      (response) =>
        response.url().endsWith('/settings/sso') && response.request().method() === 'POST',
    );
    await section().getByRole('button', { name: 'Add connection' }).click();
    expect((await created).status()).toBe(201);
    await expect(section().locator('li').filter({ hasText: 'Mock IdP (e2e)' })).toBeVisible();
    await section().screenshot({ path: 'kanit/S11-sso-connection.png' });

    const token = await ownerAccessToken(request);
    const connectionId = await readConnectionId(request, token);

    // --- Sign in, in a browser that has never seen this workspace ------------
    // A fresh context on purpose: the owner's session in `agentPage` would keep
    // the sign-in screen from ever rendering, and a login that only works with a
    // previous session in local storage is not the one being claimed.
    const context = await browser.newContext();
    try {
      const page = await context.newPage();

      // The entry an SSO-only person uses. They have no password to type, and
      // the ACS sends an accepted unsolicited assertion back to exactly this URL
      // rather than completing it, so this is also where an IdP tile lands.
      await page.goto(`/login?sso=${connectionId}`);

      // From here nothing is clicked: the app redirects to the IdP, the IdP
      // posts the assertion to the ACS, the ACS redirects back to
      // `/auth/callback` with an authorization code, and the callback redeems it
      // with the verifier this tab kept. The rail only exists once that worked.
      await expect(page.getByRole('link', { name: 'Inbox' })).toBeVisible({ timeout: 30_000 });

      // The session is the member the assertion named, not the owner whose
      // browser configured the connection.
      await page.goto('/app/settings');
      await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();
      await page.goto('/app/inbox');
      // Wait for the seeded conversations rather than the shell: a shot of the
      // loading skeleton proves the route rendered, not that the session can
      // read the workspace's data.
      await expect(
        page.getByRole('region', { name: 'Conversations' }).getByRole('button').first(),
      ).toBeVisible();
      await page.screenshot({ path: 'kanit/S11-sso-login.png', fullPage: true });

      // A session good for more than the screen it landed on: the access token
      // it minted answers `/auth/me`, and answers with the right person.
      const me = await page.evaluate(async () => {
        const stored = localStorage.getItem('nexa.refresh_token');
        const clientId = localStorage.getItem('nexa.client_id');
        const granted = await fetch('/api/v1/auth/token', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            grant_type: 'refresh_token',
            refresh_token: stored,
            client_id: clientId,
          }),
        }).then((r) => r.json() as Promise<{ access_token: string }>);
        return fetch('/api/v1/auth/me', {
          headers: { authorization: `Bearer ${granted.access_token}` },
        }).then((r) => r.json() as Promise<{ email: string }>);
      });
      expect(me.email).toBe(SSO_MEMBER);
    } finally {
      await context.close();
    }

    // --- Leave the workspace as it was ---------------------------------------
    // The specs after this one read the same tenant, and an SSO connection is
    // not something they expect to find. The seed resets between runs; within a
    // run, this is the only cleanup there is.
    const removed = await request.delete(`${API_BASE}/settings/sso/${connectionId}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(removed.status()).toBe(204);
  });
});
