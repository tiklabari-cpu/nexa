/**
 * The production Content-Security-Policy, in a real browser (tm 434 · audit F16).
 *
 *     scripts/csp-smoke.sh        # builds the images, starts them, runs this, stops them
 *
 * The main suite runs the panel and the widget on Vite's dev servers, which send
 * no CSP at all. The policy lives only in the images' nginx configs
 * (`apps/web/nginx.conf`, `apps/widget/nginx.conf`), and
 * `apps/web/test/nginx-security.test.ts` reads those as text. So a change that
 * loads a new origin — a font, an image host, a second API — could be blocked
 * in every deployed panel while all 500-odd e2e tests stayed green.
 *
 * This file is the measurement that was missing. It runs against the BUILT
 * images, served by their own nginx (`docker-compose.full.yml`, published on
 * ports of their own by `scripts/csp-smoke.compose.yml`), and it fails on any
 * violation the browser reports:
 *
 *   - a `securitypolicyviolation` event in any frame, the panel's or the
 *     widget's iframe, reported through a binding every frame gets;
 *   - a console message about the Content Security Policy, which is how
 *     Chromium also reports what it refused.
 *
 * And it refuses to pass where there is nothing to measure: each document it
 * judges must have arrived with a `Content-Security-Policy` header. Pointed at
 * a dev server by mistake, it goes red rather than green.
 *
 * Not part of `pnpm test:e2e` (`playwright.config.ts` ignores it): that suite
 * runs the dev servers and resets the database, this one needs the images and
 * leaves the data alone. Its config is `playwright.csp.config.ts`.
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { expect, test, type Page, type Response } from '@playwright/test';
import { CSP_SMOKE_PORTS } from './csp-smoke-stack.js';

/**
 * The addresses the bundles were built for; the browser reaches the smoke's
 * ports through the config's resolver rules.
 */
const PANEL = 'http://localhost:5173';
const WIDGET = 'http://localhost:5174';
/** Calls from Node do not see those rules, so they use the published port. */
const API = `http://localhost:${CSP_SMOKE_PORTS.api}`;

/**
 * A customer's page on the name the seed trusts for Acme (`widgetDomain`),
 * served by a throwaway server on a free loopback port (`*.localhost` resolves
 * to loopback in Chromium). It is the third party's page, so it carries no
 * policy of ours; the widget's iframe inside it is what is measured.
 *
 * A real server and not `page.route`: Chromium treats a page the router made
 * up as public, and its local-network-access check then refuses the loopback
 * `loader.js` before the widget ever loads — measured, the first run's red.
 */
function hostPageHtml(organizationId: string): string {
  return `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><title>Acme Bikes — CSP smoke</title></head>
  <body>
    <h1>Acme Bikes</h1>
    <script>
      window.__siyahtus = {
        organizationId: ${JSON.stringify(organizationId)},
        widgetOrigin: ${JSON.stringify(WIDGET)},
        position: 'bottom-right',
      };
    </script>
    <script src="${WIDGET}/loader.js"></script>
  </body>
</html>`;
}

async function serveHostPage(html: string): Promise<{ url: string; close: () => Promise<void> }> {
  const server: Server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(html);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://acme-bikes.localhost:${port}/`,
    // Chromium keeps the connection alive; without this `close` waits for it.
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

/** The seeded demo owner (`apps/api/prisma/seed.ts`). */
const OWNER = { email: 'owner@acme.localhost', password: 'siyahtus-demo-password' } as const;

/** Everything the browser refused, as lines a failure prints. */
async function watchForViolations(page: Page): Promise<string[]> {
  const found: string[] = [];
  await page.exposeBinding(
    '__siyahtusCspViolation',
    ({ frame }, report: { directive: string; blocked: string; sample: string }) => {
      found.push(
        `${frame.url()}: ${report.directive} refused ${report.blocked || '(inline)'}` +
          (report.sample ? ` — ${report.sample}` : ''),
      );
    },
  );
  // Every frame, the widget's cross-origin iframe included, before its own scripts.
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (event) => {
      const report = (window as unknown as Record<string, (value: unknown) => void>)[
        '__siyahtusCspViolation'
      ];
      report?.({
        directive: event.effectiveDirective,
        blocked: event.blockedURI,
        sample: event.sample,
      });
    });
  });
  page.on('console', (message) => {
    if (/content.security.policy/i.test(message.text())) found.push(`console: ${message.text()}`);
  });
  return found;
}

/**
 * Run a flow and judge it by what the browser refused. A refusal usually
 * breaks something further on — the sign-in form never renders, a frame never
 * loads — and the step that then times out says nothing about why. So the
 * violations are checked first, and the flow's own error only after.
 */
async function judged(violations: string[], flow: () => Promise<void>): Promise<void> {
  let failure: unknown = null;
  try {
    await flow();
  } catch (error) {
    failure = error;
  }
  expect(violations, 'the browser refused these under the production CSP').toEqual([]);
  if (failure) throw failure;
}

/** The response carried a policy, and it is the production one, not an empty shell. */
function expectPolicy(response: Response | null, what: string): void {
  expect(response, `${what}: no response`).not.toBeNull();
  const policy = response!.headers()['content-security-policy'];
  expect(
    policy,
    `${what} arrived without a Content-Security-Policy — this is not the built image`,
  ).toBeDefined();
  expect(policy).toContain('connect-src');
}

async function acmeOrganizationId(page: Page): Promise<string> {
  const response = await page.request.post(`${API}/api/v1/auth/login`, { data: OWNER });
  expect(response.ok(), `login failed: ${response.status()} ${await response.text()}`).toBe(true);
  const body = (await response.json()) as {
    memberships: Array<{ organization_id: string; organization_name: string }>;
  };
  const acme = body.memberships.find((m) => m.organization_name.startsWith('Acme'));
  expect(acme, 'seeded Acme tenant not found').toBeDefined();
  return acme!.organization_id;
}

test.describe('the production CSP refuses nothing the product needs (tm 434)', () => {
  test('the panel: sign-in, the inbox and its realtime socket', async ({ page }) => {
    const violations = await watchForViolations(page);
    const sockets: string[] = [];
    page.on('websocket', (socket) => sockets.push(socket.url()));

    await judged(violations, async () => {
      expectPolicy(await page.goto(`${PANEL}/`), 'the panel');
      await page.getByLabel('Email').fill(OWNER.email);
      await page.getByLabel('Password').fill(OWNER.password);
      await page.getByRole('button', { name: 'Sign in' }).click();
      await expect(page.getByRole('link', { name: 'Inbox' })).toBeVisible();

      await page.getByRole('link', { name: 'Inbox' }).click();
      await page.waitForURL(/\/app\/inbox/);
      // The RTM socket is the one connection that cannot be same-origin, so it is
      // the one a narrowed `connect-src` refuses first. Wait until it opens — or
      // until the browser says it refused it.
      await expect
        .poll(() => sockets.some((url) => url.includes('/rtm/ws')) || violations.length > 0, {
          timeout: 20_000,
          message: 'the panel neither opened its RTM socket nor reported a refusal',
        })
        .toBe(true);
      await page.waitForLoadState('networkidle');
    });
  });

  test("the widget: a visitor on a customer's page opens it and sends a message", async ({
    page,
  }) => {
    const organizationId = await acmeOrganizationId(page);
    const violations = await watchForViolations(page);
    const sockets: string[] = [];
    page.on('websocket', (socket) => sockets.push(socket.url()));

    const host = await serveHostPage(hostPageHtml(organizationId));
    await judged(violations, async () => {
      try {
        await visitorSendsOneMessage(page, host.url);
        // Once the conversation exists the widget opens its own RTM socket, and
        // its poll drops to a heartbeat — so the network never goes idle. Wait
        // for that socket, or for the browser to say it refused it.
        await expect
          .poll(
            () =>
              sockets.some((url) => url.startsWith('ws://localhost:4001/')) ||
              violations.length > 0,
            {
              timeout: 20_000,
              message: 'the widget neither opened its RTM socket nor reported a refusal',
            },
          )
          .toBe(true);
      } finally {
        await host.close();
      }
    });
  });
});

/** The widget's own steps, as a first-time visitor takes them. */
async function visitorSendsOneMessage(page: Page, hostPage: string): Promise<void> {
  const widgetDocument = page.waitForResponse((response) =>
    response.url().startsWith(`${WIDGET}/widget.html`),
  );
  await page.goto(hostPage);
  expectPolicy(await widgetDocument, "the widget's iframe");

  const frame = page.frameLocator('#siyahtus-widget-frame');
  await frame.getByRole('button', { name: 'Open chat' }).click();
  await expect(frame.getByRole('button', { name: 'Start chat' })).toBeVisible();

  const text = `CSP smoke ${Date.now().toString().slice(-6)}`;
  const recorded = page.waitForResponse(
    (response) =>
      response.url().includes('/customer/chat/events') &&
      response.request().method() === 'POST' &&
      response.ok(),
  );
  await frame.getByRole('textbox', { name: 'Full name' }).fill('CSP Smoke');
  await frame.getByRole('textbox', { name: 'Username' }).fill('csp_smoke');
  await frame.getByRole('textbox', { name: 'Email', exact: true }).fill('csp-smoke@example.test');
  await frame.getByRole('textbox', { name: 'Your message' }).fill(text);
  await frame.getByRole('button', { name: 'Start chat' }).click();
  await recorded;
  await expect(frame.getByRole('log', { name: 'Conversation' })).toContainText(text);
}
