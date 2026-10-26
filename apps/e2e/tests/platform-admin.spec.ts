/**
 * The root (platform) panel, v1 (tm 389.6 · FR-ADMIN-01/02): an operator is created with the
 * bootstrap CLI, signs in, enrols the authenticator, sees the shell, and every screen on the way
 * passes axe in both themes.
 *
 * It runs against the real thing: `platform-api` (its own process, as `siyahtus_platform`),
 * the admin SPA's Vite server proxying `/platform` to it, and the run's private database. The
 * unit suite (`apps/admin`) holds the SPA's reactions to every server answer against a fake;
 * what only this level can show is that the two agree — the token swap between the password and
 * code steps, the one-time recovery sheet, a code the server accepts once, a session that
 * survives a reload — and that the page that results is accessible with the real stylesheet
 * (contrast is only decidable here: jsdom has no computed colour).
 *
 * The last one (tm 389.10 · FR-ADMIN-09) suspends a workspace from the panel and watches its
 * owner be turned away at the workspace panel's sign-in, then lifts it and watches them get in.
 *
 * The specs below are one story told in order (`serial`): the operator the first creates is the
 * one the rest sign in as. The bootstrap CLI refuses once any operator exists, so a retry of the
 * first test cannot re-create them — which is why a failure here is reported as a failure and not
 * retried into confusion. The global setup truncates every table, platform ones included, before
 * the suite, so each run starts with no operator.
 */
import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import type { Page, TestInfo } from '@playwright/test';
import { assertNoBlockingViolations, scanScreen } from './a11y.js';
import { API_BASE, expect, ownerAccessToken, test } from './fixtures.js';
import { STACK_ADMIN, STACK_API, USUAL_PORTS } from './stack-ports.js';
import { nextTotpCode, stepOf, totpCode } from './totp.js';

const run = promisify(execFile);
const repoRoot = resolve(import.meta.dirname, '../../..');

/** What the browser sees: the usual origin, which a private stack's resolver rule maps onto its own. */
const ADMIN = `http://localhost:${USUAL_PORTS.admin}`;
const SESSION_KEY = 'siyahtus.platform.session';

// The standalone Playwright browser renders the panel in the OS language otherwise (the panel
// follows `navigator.language`); the assertions below are in English.
test.use({ locale: 'en-US' });
test.describe.configure({ mode: 'serial' });

const OPERATOR = {
  email: `operator-${Date.now().toString(36)}@platform.test`,
  password: 'e2e operator password 1',
};

/** The authenticator's secret, read off the enrolment screen — the one place it is ever shown. */
let secret = '';
/** The step of the code the enrolment used; the server accepts a code once. */
let usedStep = 0;
/** The sheet issued at enrolment. */
let recoveryCodes: string[] = [];

/**
 * `pnpm --filter @siyahtus/api platform:bootstrap-admin` — the way an operator really gets the
 * first superadmin. It connects as `siyahtus_platform` with the environment this run was started
 * with (`DATABASE_PLATFORM_URL` of the private database), and takes the password from the
 * environment rather than an argument.
 */
async function bootstrapOperator(): Promise<void> {
  try {
    await run(
      'pnpm',
      ['--filter', '@siyahtus/api', 'platform:bootstrap-admin', '--email', OPERATOR.email],
      {
        cwd: repoRoot,
        // `pnpm` is a shell shim on Windows (see `global-setup.ts`).
        shell: true,
        env: { ...process.env, PLATFORM_BOOTSTRAP_PASSWORD: OPERATOR.password },
        maxBuffer: 4 * 1024 * 1024,
      },
    );
  } catch (error) {
    const output = error as { stdout?: string; stderr?: string };
    throw new Error(
      `platform:bootstrap-admin failed — it refuses once any operator exists, so a leftover one ` +
        `(a retry, or a shared database the global setup did not wipe) shows up here:\n` +
        `${output.stderr ?? ''}${output.stdout ?? ''}`,
    );
  }
}

/** axe over the current screen in both themes; the attribute is what `tokens.css` keys off. */
async function scanBothThemes(page: Page, screen: string, testInfo: TestInfo): Promise<void> {
  for (const theme of ['light', 'dark'] as const) {
    await page.evaluate((value) => {
      document.documentElement.dataset.theme = value;
    }, theme);
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    assertNoBlockingViolations(await scanScreen(page, `Admin ${screen} (${theme})`, testInfo));
  }
  await page.evaluate(() => {
    document.documentElement.dataset.theme = 'light';
  });
}

async function typePassword(page: Page): Promise<void> {
  await page.getByLabel('Email').fill(OPERATOR.email);
  await page.getByLabel('Password').fill(OPERATOR.password);
  await page.getByRole('button', { name: 'Continue' }).click();
}

test('creates the first superadmin, enrols the authenticator and opens the shell', async ({
  page,
}, testInfo) => {
  await bootstrapOperator();

  await page.goto(`${ADMIN}/`);
  await expect(page.getByRole('heading', { name: 'Sign in to the platform panel' })).toBeVisible();
  // The strip is there before anyone has signed in, and it says which region this is.
  await expect(page.getByTestId('platform-strip')).toContainText(/PLATFORM · (EU|US)/);
  await expect(page).toHaveTitle(/^\[OPS\]/);
  await scanBothThemes(page, 'sign-in', testInfo);

  await typePassword(page);

  // No authenticator yet: the password earned the right to set one up, not a session.
  await expect(page.getByRole('heading', { name: 'Set up your authenticator' })).toBeVisible();
  await expect(page.getByRole('navigation')).toHaveCount(0);
  secret = (await page.getByTestId('enroll-secret').innerText()).replace(/\s+/g, '');
  expect(secret).toMatch(/^[A-Z2-7]{32}$/);
  await scanBothThemes(page, 'enrolment', testInfo);

  usedStep = stepOf();
  await page.getByLabel('Code from the app').fill(totpCode(secret, usedStep));
  await page.getByRole('button', { name: 'Activate' }).click();

  // Signed in underneath, but held at the one-time recovery sheet.
  const sheet = page.getByRole('list', { name: 'Recovery codes' });
  await expect(sheet).toBeVisible();
  recoveryCodes = (await sheet.getByRole('listitem').allInnerTexts()).map((code) => code.trim());
  expect(recoveryCodes).toHaveLength(10);
  expect(new Set(recoveryCodes).size).toBe(10);
  await expect(page.getByRole('navigation')).toHaveCount(0);
  await scanBothThemes(page, 'recovery sheet', testInfo);

  await expect(page.getByRole('button', { name: 'Continue to the panel' })).toBeDisabled();
  await page.getByLabel('I have saved these codes').check();
  await page.getByRole('button', { name: 'Continue to the panel' }).click();

  // The shell: the twelve pages a superadmin can open, on the dashboard.
  const menu = page.getByRole('navigation', { name: 'Main menu' });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('link')).toHaveCount(12);
  await expect(page.getByRole('heading', { name: 'Dashboard', level: 1 })).toBeVisible();
  await expect(page.getByText(`Signed in as ${OPERATOR.email}`)).toBeVisible();
  await expect(page.getByTestId('platform-strip')).toContainText(/PLATFORM · (EU|US)/);
  await expect(page).toHaveTitle(/^\[OPS\] Dashboard/);
  await scanBothThemes(page, 'dashboard', testInfo);

  // Navigating is client-side and the menu marks where the operator is.
  await menu.getByRole('link', { name: 'Audit' }).click();
  await expect(page).toHaveURL(`${ADMIN}/audit`);
  await expect(menu.getByRole('link', { name: 'Audit' })).toHaveAttribute('aria-current', 'page');
  await scanBothThemes(page, 'audit placeholder', testInfo);

  // An address that is not a page says so, inside the shell.
  await page.goto(`${ADMIN}/no-such-page`);
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
  await scanBothThemes(page, 'not found', testInfo);

  // The session is the tab's: a reload resumes it without the password.
  expect(await page.evaluate((key) => sessionStorage.getItem(key), SESSION_KEY)).toBeTruthy();
  await page.reload();
  await expect(page.getByRole('navigation', { name: 'Main menu' })).toBeVisible();
});

test('refuses a replayed code, accepts the next one, and signs out', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto(`${ADMIN}/`);
  await typePassword(page);

  await expect(page.getByRole('heading', { name: 'Enter your authenticator code' })).toBeVisible();

  // The enrolment spent this step's code. Presenting it again — within its thirty seconds, from
  // the same authenticator — is a 401 like a wrong one (replay protection).
  await page.getByLabel('Authenticator code').fill(totpCode(secret, usedStep));
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page.getByRole('alert')).toContainText('That code did not work.');
  await expect(page.getByRole('navigation')).toHaveCount(0);

  // A reload at the code step resumes at the code step (`GET /auth/me` → 403 + `next`).
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Enter your authenticator code' })).toBeVisible();

  const fresh = await nextTotpCode(secret, usedStep);
  usedStep = stepOf();
  await page.getByLabel('Authenticator code').fill(fresh);
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page.getByRole('navigation', { name: 'Main menu' })).toBeVisible();

  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in to the platform panel' })).toBeVisible();
  expect(await page.evaluate((key) => sessionStorage.getItem(key), SESSION_KEY)).toBeNull();
  // An own sign-out is not "your session ended".
  await expect(page.getByText('Your session ended. Sign in again.')).toHaveCount(0);
});

test('signs in with a recovery code, once', async ({ page }) => {
  await page.goto(`${ADMIN}/`);
  await typePassword(page);
  await page.getByRole('button', { name: 'Use a recovery code instead' }).click();
  await page.getByLabel('Recovery code').fill(recoveryCodes[0]!);
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page.getByRole('navigation', { name: 'Main menu' })).toBeVisible();
  await page.getByRole('button', { name: 'Sign out' }).click();

  // Each code works once.
  await typePassword(page);
  await page.getByRole('button', { name: 'Use a recovery code instead' }).click();
  await page.getByLabel('Recovery code').fill(recoveryCodes[0]!);
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page.getByRole('alert')).toContainText('That code did not work.');
  await expect(page.getByRole('navigation')).toHaveCount(0);
});

test('reaches platform-api only through its own origin, and the tenant API knows nothing of it', async ({
  request,
}) => {
  // Through the admin server's same-origin proxy (dialled as Node must: the shard's own port):
  // the unauthenticated region the strip shows.
  const meta = await request.get(`${STACK_ADMIN}/platform/v1/meta`);
  expect(meta.ok(), `GET /platform/v1/meta → ${meta.status()}`).toBe(true);
  expect((await meta.json()) as { region: string }).toMatchObject({
    region: expect.stringMatching(/^(eu|us)$/),
  });

  // The workspace API never serves the platform surface (it is loaded in the platform process
  // only): not even to a signed-in workspace owner. Without a token it would answer 401 for any
  // path, which proves nothing about the route.
  const token = await ownerAccessToken(request);
  const tenant = await request.get(`${STACK_API}/platform/v1/meta`, {
    headers: { authorization: `Bearer ${token}` },
  });
  expect(tenant.status()).toBe(404);
});

test('suspends a workspace from the panel: its owner is turned away at sign-in until the suspension is lifted', async ({
  page,
  request,
}, testInfo) => {
  // Three codes from three different thirty-second steps: the sign-in, then a fresh one for each
  // of the two destructive actions (`recentTotp`).
  test.setTimeout(180_000);

  // A workspace of its own — the seeded ones serve every other spec in parallel.
  const unique = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6)}`;
  const owner = { email: `owner-${unique}@suspend.test`, password: 'suspend e2e password 1' };
  const name = `Suspend Co ${unique}`;
  const signup = await request.post(`${API_BASE}/auth/signup`, {
    data: {
      email: owner.email,
      password: owner.password,
      name: 'Robin Owner',
      organization_name: name,
    },
  });
  expect(signup.ok(), `signup → ${signup.status()}`).toBe(true);
  const login = await request.post(`${API_BASE}/auth/login`, {
    data: { email: owner.email, password: owner.password },
  });
  const { memberships } = (await login.json()) as { memberships: Array<{ license_id: string }> };
  const licenseId = memberships[0]!.license_id;

  // The operator opens the workspace.
  await page.goto(`${ADMIN}/workspaces/${licenseId}`);
  await typePassword(page);
  const signInCode = await nextTotpCode(secret, usedStep);
  usedStep = stepOf();
  await page.getByLabel('Authenticator code').fill(signInCode);
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible();

  const act = async (label: string, confirm: string, why: string) => {
    await page.getByRole('button', { name: 'Actions' }).click();
    await page.getByRole('button', { name: label }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Reason').fill(why);
    const code = await nextTotpCode(secret, usedStep);
    usedStep = stepOf();
    await dialog.getByLabel('Authenticator code').fill(code);
    await dialog.getByRole('button', { name: confirm }).click();
    await expect(page.getByText(`${label}: done.`)).toBeVisible();
  };

  await act('Suspend', 'Suspend', 'e2e: chargeback investigation');
  await expect(
    page.getByText('Nobody in the workspace can sign in.', { exact: false }),
  ).toBeVisible();
  await scanBothThemes(page, 'suspended workspace', testInfo);

  // The owner, at the workspace panel: the password is right, the workspace is locked.
  const tenant = await page.context().newPage();
  await tenant.goto('/');
  await tenant.getByLabel('Email').fill(owner.email);
  await tenant.getByLabel('Password').fill(owner.password);
  await tenant.getByRole('button', { name: 'Sign in' }).click();
  await expect(
    tenant.getByText(
      'This workspace is temporarily suspended. Contact SiyahTuş support for details.',
    ),
  ).toBeVisible();
  await expect(tenant.getByRole('link', { name: 'Inbox' })).toHaveCount(0);

  await act('Lift suspension', 'Lift suspension', 'e2e: investigation closed');

  // Back in: a fresh workspace opens on its first-run wizard.
  await tenant.getByRole('button', { name: 'Sign in' }).click();
  await expect(tenant.getByRole('heading', { name: 'Set up your workspace' })).toBeVisible();
});

test('opens the Operations page: every section answers from the real stack and passes axe', async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);

  await page.goto(`${ADMIN}/operations`);
  await typePassword(page);
  const signInCode = await nextTotpCode(secret, usedStep);
  usedStep = stepOf();
  await page.getByLabel('Authenticator code').fill(signInCode);
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page.getByRole('heading', { name: 'Operations', level: 1 })).toBeVisible();

  for (const heading of [
    'Scheduler jobs',
    'Job queues',
    'Webhook deliveries',
    'SIEM export',
    'Event partitions',
    'Unverified sign-ups',
    'Component status',
  ]) {
    await expect(page.getByRole('heading', { name: heading, level: 2 })).toBeVisible();
  }

  // The partitions are the real `events` table's, read past row-level security.
  const partitions = page.getByRole('table', { name: 'Monthly partitions of the events table' });
  await expect(partitions).toContainText('events_default');
  // The queue table is there; the document worker is not part of this build.
  const queues = page.getByRole('table', {
    name: 'Background job queues and what is waiting in them',
  });
  await expect(queues).toContainText('AI replies');
  await expect(queues.getByRole('row', { name: /Document worker/ })).toContainText('Not installed');
  // Whatever the stack's scheduler is doing, the page said so rather than failing.
  await expect(page.getByText('This section could not be loaded')).toHaveCount(0);
  await expect(
    page.getByRole('list', { name: 'Component status' }).getByRole('listitem'),
  ).toHaveCount(12);

  await scanBothThemes(page, 'operations', testInfo);
});
