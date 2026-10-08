/**
 * The public pilot, in a real browser (tm 257.12 · epic 257's closing gate).
 *
 * Runs only under `playwright.pilot.config.ts` (`pnpm test:e2e:pilot`), whose
 * API is started with `PILOT_MODE=true`, e-mail verification on, terms and a
 * privacy policy named, and mail going to the SMTP stand-in. The main suite
 * ignores this file and keeps proving the flag-off product unchanged.
 *
 * Each test is one surface the flag changes, seen the way a pilot user would
 * see it. The refusals behind them (403 `pilot_mode`) are proven at the API by
 * the integration suite and against a built stack by `scripts/smoke.sh`'s pilot
 * profile; this file proves that the panel and the widget say the same thing.
 *
 * Calls made from Node go to the private api and mailbox ports
 * (`pilot-stack.ts`): only the browser is mapped onto the usual ones.
 */
import { request as playwrightRequest, type APIRequestContext, type Page } from '@playwright/test';
import {
  DEMO,
  expect,
  OVERDUE_OWNER,
  openWidget,
  signIn,
  signInAs,
  test,
  visitorSends,
  widgetFrame,
} from './fixtures.js';
import {
  PILOT_API_BASE,
  PILOT_CONTACT_EMAIL,
  PILOT_MAILBOX,
  PILOT_PRIVACY_URL,
  PILOT_TERMS_URL,
} from './pilot-stack.js';

/**
 * Opens `path` and checks the stack answered `GET /deployment` as a pilot. The
 * panel draws nothing before that answer (tm 259.4); the check is on the stack.
 */
async function gotoAfterDeployment(page: Page, path: string): Promise<void> {
  const deployment = page.waitForResponse(
    (response) => response.url().endsWith('/api/v1/deployment') && response.ok(),
  );
  await page.goto(path);
  const body = (await (await deployment).json()) as { pilot_mode: boolean };
  // A guard on the stack rather than on the product: without it a mis-started
  // api would turn every assertion below into a confusing red.
  expect(body.pilot_mode, 'the api under test is not in pilot mode').toBe(true);
}

interface Mail {
  to: string;
  subject: string;
  body: string;
}

/** The stand-in's messages to `to` whose subject contains `subject`, oldest first. */
async function mailTo(api: APIRequestContext, to: string, subject: string): Promise<Mail[]> {
  const response = await api.get(`${PILOT_MAILBOX}/messages?to=${encodeURIComponent(to)}`);
  expect(response.ok(), `mailbox unreachable: ${response.status()}`).toBe(true);
  const { items } = (await response.json()) as { items: Mail[] };
  return items.filter((mail) => mail.subject.includes(subject));
}

function verifyLinkIn(mail: Mail): string {
  const link = (mail.body.match(/https?:\/\/\S+/g) ?? []).find(
    (candidate) => new URL(candidate).pathname === '/verify-email',
  );
  expect(link, 'the mail carried no /verify-email link').toBeTruthy();
  return link!;
}

const TERMS_BOX = 'I agree to the Terms of Service and the Privacy Policy.';
const PASSWORD = 'pilot-e2e-password';

/** The sign-up form, filled in for a brand-new owner; the terms box is left to the caller. */
async function fillSignUp(page: Page, email: string): Promise<void> {
  await page.getByLabel('Workspace name').fill(`Pilot Co ${Date.now()}`);
  await page.getByLabel('Your name').fill('Pat Pilot');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
}

test.describe('public pilot (PILOT_MODE=true)', () => {
  test('W1 sign-in shows no demo credentials, and links the terms and the privacy policy', async ({
    page,
  }) => {
    await gotoAfterDeployment(page, '/');
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();

    // The seed's owner exists only where the seed ran; a pilot visitor would
    // be shown a password for an account that is not there.
    await expect(page.getByText(DEMO.email)).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Terms of Service' })).toHaveAttribute(
      'href',
      PILOT_TERMS_URL,
    );
    await expect(page.getByRole('link', { name: 'Privacy Policy' })).toHaveAttribute(
      'href',
      PILOT_PRIVACY_URL,
    );
  });

  test('W2 sign-up has no region picker, and cannot be sent until the terms are accepted', async ({
    page,
  }) => {
    await gotoAfterDeployment(page, '/signup');
    await expect(page.getByRole('heading', { name: 'Create a workspace' })).toBeVisible();

    // One deployment, one region: nothing to choose.
    await expect(page.getByLabel('Data region')).toHaveCount(0);

    const box = page.getByRole('checkbox', { name: TERMS_BOX });
    await expect(box).not.toBeChecked();
    const links = page.locator('#signup-terms-links');
    await expect(links.getByRole('link', { name: 'Terms of Service' })).toHaveAttribute(
      'href',
      PILOT_TERMS_URL,
    );
    await expect(links.getByRole('link', { name: 'Privacy Policy' })).toHaveAttribute(
      'href',
      PILOT_PRIVACY_URL,
    );

    // Every field valid, and still nothing to send without the box.
    await fillSignUp(page, `pilot-w2-${Date.now()}@pilot.test`);
    const submit = page.getByRole('button', { name: 'Create workspace' });
    await expect(submit).toBeDisabled();
    await box.check();
    await expect(submit).toBeEnabled();
    await box.uncheck();
    await expect(submit).toBeDisabled();
  });

  test('W3 a new owner confirms the address by mail before the first sign-in, then onboards without sample data', async ({
    page,
  }) => {
    const api = await playwrightRequest.newContext();
    try {
      const email = `pilot-w3-${Date.now()}@pilot.test`;
      const subject = 'Confirm your email address';

      // --- Sign up: no session, a mail instead ------------------------------
      await gotoAfterDeployment(page, '/signup');
      await fillSignUp(page, email);
      await page.getByRole('checkbox', { name: TERMS_BOX }).check();
      await page.getByRole('button', { name: 'Create workspace' }).click();
      await expect(page.getByRole('heading', { name: 'Check your inbox' })).toBeVisible();
      await expect(page.getByText(email)).toBeVisible();
      await expect.poll(async () => (await mailTo(api, email, subject)).length).toBe(1);

      // --- Signing in before confirming is refused, and offers a new link ----
      await page.goto('/');
      await page.getByLabel('Email').fill(email);
      await page.getByLabel('Password').fill(PASSWORD);
      await page.getByRole('button', { name: 'Sign in' }).click();
      await expect(page.getByRole('heading', { name: 'Confirm your email first' })).toBeVisible();
      await expect(page.getByRole('link', { name: 'Inbox' })).toHaveCount(0);

      await page.getByRole('button', { name: 'Send the link again' }).click();
      await expect(
        page.getByText('If that address is waiting to be confirmed, a new link is on its way.'),
      ).toBeVisible();
      await expect.poll(async () => (await mailTo(api, email, subject)).length).toBe(2);

      // --- The newest link plus the password: confirmed and signed in --------
      const mails = await mailTo(api, email, subject);
      await page.goto(verifyLinkIn(mails[mails.length - 1]!));
      await expect(page.getByRole('heading', { name: 'Confirm your email' })).toBeVisible();
      await page.getByLabel('Password').fill(PASSWORD);
      await page.getByRole('button', { name: 'Confirm and sign in' }).click();

      // --- Onboarding: four steps, no channel tour, no sample data ------------
      await expect(page.getByRole('heading', { name: 'Set up your workspace' })).toBeVisible();
      await expect(page).toHaveURL(/\/app\/onboarding/);
      await expect(page.getByText('Step 1 of 4')).toBeVisible();
      await expect(page.getByText('Add sample data to explore')).toHaveCount(0);
      await expect(page.getByText('See the other ways customers can reach you')).toHaveCount(0);

      await page.getByRole('button', { name: 'Continue' }).click();
      await expect(page.getByRole('heading', { name: 'Connect your first website' })).toBeVisible();
      await page.getByRole('button', { name: 'Continue' }).click();
      // Website → Company: the channels step is not there.
      await expect(page.getByRole('heading', { name: 'How big is your team?' })).toBeVisible();
      await page.getByRole('button', { name: 'Continue' }).click();
      await expect(page.getByRole('heading', { name: 'Invite your team' })).toBeVisible();
      await expect(page.getByText('Step 4 of 4')).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Add sample data' })).toHaveCount(0);
      await page.screenshot({ path: 'kanit/257.12-pilot-onboarding.png', fullPage: true });

      await page.getByRole('button', { name: 'Finish setup' }).click();
      await expect(page).toHaveURL(/\/app\/inbox/);
    } finally {
      await api.dispose();
    }
  });

  test('W4 there is no Billing, and an ended trial points at the contact address, not Subscribe', async ({
    page,
  }) => {
    await signInAs(page, OVERDUE_OWNER.email, OVERDUE_OWNER.password);

    const badge = page.getByTestId('trial-badge');
    await expect(badge).toContainText('Your pilot trial has ended');
    await expect(badge.getByRole('link', { name: PILOT_CONTACT_EMAIL })).toHaveAttribute(
      'href',
      `mailto:${PILOT_CONTACT_EMAIL}`,
    );
    await expect(badge.getByRole('link', { name: 'Subscribe' })).toHaveCount(0);

    const modules = page.getByRole('navigation', { name: 'Modules' });
    await expect(modules.getByRole('link', { name: 'Inbox' })).toBeVisible();
    await expect(modules.getByRole('link', { name: 'Billing' })).toHaveCount(0);
    await page.screenshot({ path: 'kanit/257.12-pilot-trial-ended.png', fullPage: true });

    // The bookmark and the typed address lead to the inbox too.
    await page.goto('/app/billing');
    await expect(page).toHaveURL(/\/app\/inbox/);
  });

  test('W5 Settings → Channels offers only Website and Chat page, and the app menu has no Apps', async ({
    page,
  }) => {
    await signIn(page);
    // The stack itself, once: the inbox's socket reaches this run's rtm through
    // the resolver mapping, not a dev rtm on the usual port.
    await expect(
      page.getByRole('navigation', { name: 'Inbox views' }).getByText('Live'),
    ).toBeVisible({ timeout: 15_000 });
    await page.goto('/app/settings/channels');

    await expect(page.getByTestId('channel-website')).toBeVisible();
    await expect(page.getByTestId('channel-chat-page')).toBeVisible();
    await expect(page.locator('[data-testid^="channel-"]')).toHaveCount(2);
    await expect(page.getByTestId('channel-email')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Manage addresses' })).toHaveCount(0);
    await page.screenshot({ path: 'kanit/257.12-pilot-channels.png', fullPage: true });

    const menu = page.getByRole('button', { name: 'App menu' });
    await menu.click();
    await expect(menu).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByRole('link', { name: 'Apps' })).toHaveCount(0);

    await page.goto('/app/apps');
    await expect(page).toHaveURL(/\/app\/inbox/);
  });

  test('W6 the widget marks the AI Agent reply as AI, links the privacy policy, and does not link "Powered by"', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const api = await playwrightRequest.newContext();
    let organizationId: string;
    try {
      const login = await api.post(`${PILOT_API_BASE}/auth/login`, {
        data: { email: DEMO.email, password: DEMO.password },
      });
      expect(login.ok(), `login failed: ${login.status()}`).toBe(true);
      const { memberships } = (await login.json()) as {
        memberships: Array<{ organization_id: string; organization_name: string }>;
      };
      const acme = memberships.find((m) => m.organization_name.startsWith('Acme'));
      expect(acme, 'seeded Acme tenant not found').toBeTruthy();
      organizationId = acme!.organization_id;
    } finally {
      await api.dispose();
    }

    await openWidget(page, organizationId);
    const frame = widgetFrame(page);

    // Answered from the seeded "Delivery and returns" source by the AI Agent.
    await visitorSends(page, 'How many working days does standard delivery take?');
    const reply = frame.locator('.nx-row--bot').filter({ hasText: 'working days' }).last();
    await expect(reply).toBeVisible({ timeout: 30_000 });
    await expect(reply.getByRole('img', { name: 'Reply written by AI' })).toBeVisible();

    await expect(frame.getByText('Powered by SiyahTuş')).toBeVisible();
    await expect(frame.getByRole('link', { name: 'Powered by SiyahTuş' })).toHaveCount(0);
    await expect(frame.getByRole('link', { name: 'Privacy' })).toHaveAttribute(
      'href',
      PILOT_PRIVACY_URL,
    );
    await page.screenshot({ path: 'kanit/257.12-pilot-widget.png', fullPage: true });
  });

  test('W7 nothing is drawn as an ordinary deployment while GET /deployment is on its way', async ({
    page,
  }) => {
    // Signed out: the sign-in form waits for the answer instead of offering
    // the seed's password first and taking it back when the answer arrives.
    let release = await holdDeployment(page);
    await page.goto('/');
    await expect(page.getByRole('status')).toHaveText('Loading…');
    await expect(page.getByText(DEMO.email)).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Sign in' })).toHaveCount(0);
    release();
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
    await expect(page.getByText(DEMO.email)).toHaveCount(0);
    await page.unroute(DEPLOYMENT_ROUTE);

    // Signed in: a reload restores the session, and the shell waits too — no
    // Billing in the rail, no menu to find Apps in.
    await signIn(page);
    release = await holdDeployment(page);
    await page.reload();
    // The restore shows "Loading…" of its own, so a bare "no Billing" would
    // pass before the shell had a chance to appear. Give it that chance — an
    // ordinary page load has its shell up well inside this — and read the
    // screen as it is at that moment.
    await page
      .getByRole('link', { name: 'Inbox' })
      .waitFor({ timeout: 3_000 })
      .catch(() => undefined);
    expect(await page.getByRole('link', { name: 'Billing' }).count()).toBe(0);
    expect(await page.getByRole('button', { name: 'App menu' }).count()).toBe(0);
    await expect(page.getByRole('status')).toHaveText('Loading…');
    await page.screenshot({ path: 'kanit/259-4-deployment-loading.png', fullPage: true });
    release();
    const modules = page.getByRole('navigation', { name: 'Modules' });
    await expect(modules.getByRole('link', { name: 'Inbox' })).toBeVisible();
    await expect(modules.getByRole('link', { name: 'Billing' })).toHaveCount(0);
  });

  test('W8 a GET /deployment that keeps failing ends on "cannot reach the server", and "Try again" recovers', async ({
    page,
  }) => {
    let failed = 0;
    await page.route(DEPLOYMENT_ROUTE, (route) => {
      failed += 1;
      return route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: { type: 'internal', message: 'unavailable' } }),
      });
    });
    await page.goto('/');

    // Three attempts with backoff in between, then the screen — never the
    // ordinary deployment's sign-in form with the demo password on it.
    await expect(page.getByRole('heading', { name: 'Cannot reach the server' })).toBeVisible({
      timeout: 15_000,
    });
    expect(failed).toBe(3);
    await expect(page.getByText(DEMO.email)).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Sign in' })).toHaveCount(0);
    await page.screenshot({ path: 'kanit/259-4-deployment-unreachable.png', fullPage: true });

    await page.unroute(DEPLOYMENT_ROUTE);
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
    await expect(page.getByText(DEMO.email)).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Terms of Service' })).toHaveAttribute(
      'href',
      PILOT_TERMS_URL,
    );
  });
});

const DEPLOYMENT_ROUTE = '**/api/v1/deployment';

/**
 * Holds every `GET /deployment` the page sends until the returned function is
 * called (tm 259.4) — a slow network, made deterministic: whatever the screen
 * shows meanwhile stays on it for as long as an assertion needs to look.
 */
async function holdDeployment(page: Page): Promise<() => void> {
  let release!: () => void;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(DEPLOYMENT_ROUTE, async (route) => {
    await released;
    await route.continue();
  });
  return release;
}
