/**
 * A brand-new workspace, screen by screen: no empty screen is a dead end
 * (NY-11 · tm 473, the walk tm 400 started with Knowledge).
 *
 * A real signup (`signUpFreshOwner`) skips the setup wizard and lands in a
 * workspace with no conversation, no archive, no customer, no AI agent and no
 * website. Each screen the owner can reach must then offer the step that fills
 * it — create, connect or invite — as a link or button inside the page, and
 * pass axe in both themes. The widget step ("Install the chat widget") is a
 * setup step, so the last test proves it retires itself once a website exists.
 *
 * Screens are reached by client-side navigation from one sign-in: every
 * `page.goto` runs `POST /auth/token`, and a walk of ten pages would spend a
 * third of the 30/min anon bucket (memory: browser-ux-probe-traps).
 */
import type { Locator, Page, TestInfo } from '@playwright/test';
import { THEME_DEPENDENT_RULES, assertNoBlockingViolations, scanScreen } from './a11y.js';
import { expect, signUpFreshOwner, test } from './fixtures.js';

type PanelTheme = 'dark' | 'light';

interface EmptyScreen {
  name: string;
  path: string;
  /** Text that proves the screen is showing its empty state, not a skeleton. */
  empty: (main: Locator) => Locator;
  /** The next step it offers. */
  action: (main: Locator) => Locator;
  /** Where a link should lead; omitted for an in-place button. */
  href?: string;
}

const INSTALL_WIDGET = '/app/settings/website-widgets';

const SCREENS: readonly EmptyScreen[] = [
  {
    name: 'Home',
    path: '/app/home',
    empty: (main) => main.getByText('0 of 5 steps complete'),
    action: (main) => main.getByRole('link', { name: 'Set up' }).first(),
    href: INSTALL_WIDGET,
  },
  {
    name: 'Inbox',
    path: '/app/inbox',
    empty: (main) => main.getByText('Nothing here yet'),
    action: (main) => main.getByRole('link', { name: 'Install the chat widget' }),
    href: INSTALL_WIDGET,
  },
  {
    name: 'Archive',
    path: '/app/archive',
    empty: (main) => main.getByText('No archive yet'),
    action: (main) => main.getByRole('link', { name: 'Install the chat widget' }),
    href: INSTALL_WIDGET,
  },
  {
    name: 'Customers',
    path: '/app/customers',
    empty: (main) => main.getByText('No customers yet'),
    action: (main) => main.getByRole('link', { name: 'Install the chat widget' }),
    href: INSTALL_WIDGET,
  },
  {
    name: 'Reports',
    path: '/app/reports',
    empty: (main) => main.getByText(/^No conversations yet/),
    action: (main) => main.getByRole('link', { name: 'Install the chat widget' }),
    href: INSTALL_WIDGET,
  },
  {
    name: 'Playbook › AI Agent',
    path: '/app/playbook?view=general',
    empty: (main) => main.getByRole('heading', { name: 'Add an AI agent' }),
    action: (main) => main.getByRole('button', { name: 'Add AI agent' }),
  },
  {
    name: 'Playbook › Knowledge',
    path: '/app/playbook?view=knowledge',
    empty: (main) => main.getByText('Add an AI agent first'),
    action: (main) => main.getByRole('button', { name: 'Add an AI agent' }),
  },
  {
    name: 'Team',
    path: '/app/team',
    empty: (main) => main.getByText('No pending invitations.'),
    action: (main) => main.getByRole('button', { name: 'Invite teammates' }),
  },
  {
    name: 'Team › AI agents',
    path: '/app/team/ai-agents',
    empty: (main) => main.getByText('No chatbots yet'),
    action: (main) => main.getByRole('link', { name: 'Create an AI agent' }),
    href: '/app/playbook?view=general',
  },
  {
    name: 'Settings › Channels',
    path: '/app/settings/channels',
    empty: (main) => main.getByText('Not connected').first(),
    action: (main) => main.getByRole('button', { name: 'Connect', exact: true }).first(),
  },
];

async function pinTheme(page: Page, theme: PanelTheme): Promise<void> {
  await page.addInitScript((value) => {
    window.localStorage.setItem('siyahtus.theme', value);
  }, theme);
}

/** In-app navigation: the router follows `popstate`, no token round trip. */
async function navigate(page: Page, path: string): Promise<void> {
  await page.evaluate((to) => {
    window.history.pushState({}, '', to);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, path);
  const [pathname] = path.split('?');
  await expect(page).toHaveURL(new RegExp(`${pathname!.replace(/[/?]/g, '\\$&')}`));
}

async function freshWorkspace(page: Page, theme: PanelTheme): Promise<void> {
  await pinTheme(page, theme);
  await signUpFreshOwner(page);
  await page.getByRole('button', { name: 'Skip setup' }).click();
  await expect(page).toHaveURL(/\/app\/inbox/);
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
}

async function walk(page: Page, theme: PanelTheme, testInfo: TestInfo): Promise<void> {
  for (const screen of SCREENS) {
    await test.step(`${screen.name} (${theme})`, async () => {
      await navigate(page, screen.path);
      const main = page.getByRole('main');
      await expect(screen.empty(main), `${screen.name}: empty state`).toBeVisible();
      const action = screen.action(main);
      await expect(action, `${screen.name}: next step`).toBeVisible();
      await expect(action).toBeEnabled();
      if (screen.href) await expect(action).toHaveAttribute('href', screen.href);
      // Nothing still loading underneath the scan.
      await expect(page.locator('.animate-pulse')).toHaveCount(0);
      assertNoBlockingViolations(
        await scanScreen(
          page,
          `Empty ${screen.name} (${theme})`,
          testInfo,
          theme === 'light' ? { rules: THEME_DEPENDENT_RULES } : {},
        ),
      );
    });
  }
}

test.describe('a new workspace has no dead-end empty screen (NY-11 · tm 473)', () => {
  test('every empty screen offers its next step, axe clean (dark)', async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    await freshWorkspace(page, 'dark');
    await walk(page, 'dark', testInfo);
  });

  test('every empty screen offers its next step, axe clean (light)', async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    await freshWorkspace(page, 'light');
    await walk(page, 'light', testInfo);
  });

  test('the widget step retires once a website has the widget', async ({ page }) => {
    await freshWorkspace(page, 'dark');

    // The step leads where it says, and taking it there is the whole of it.
    const inbox = page.getByRole('main');
    await inbox.getByRole('link', { name: 'Install the chat widget' }).click();
    await expect(page).toHaveURL(/\/app\/settings\/website-widgets/);
    await page.getByLabel('Website domain').fill(`shop-${Date.now()}.example`);
    await page.getByRole('button', { name: 'Add website' }).click();
    await expect(page.getByRole('main').getByText('No websites yet')).toHaveCount(0);

    // Back on the empty screens: the setup step is gone, the emptiness stays.
    await navigate(page, '/app/inbox');
    await expect(inbox.getByText('Nothing here yet')).toBeVisible();
    await expect(inbox.getByRole('link', { name: 'Install the chat widget' })).toHaveCount(0);

    // The archive and customers still lead somewhere: the inbox.
    for (const [path, empty] of [
      ['/app/archive', 'No archive yet'],
      ['/app/customers', 'No customers yet'],
    ] as const) {
      await navigate(page, path);
      await expect(inbox.getByText(empty)).toBeVisible();
      await expect(inbox.getByRole('link', { name: 'Go to inbox' })).toHaveAttribute(
        'href',
        '/app/inbox',
      );
      await expect(inbox.getByRole('link', { name: 'Install the chat widget' })).toHaveCount(0);
    }

    await navigate(page, '/app/reports');
    await expect(inbox.getByRole('heading', { name: 'Volume' })).toBeVisible();
    await expect(page.locator('.animate-pulse')).toHaveCount(0);
    await expect(inbox.getByText(/^No conversations yet/)).toHaveCount(0);
  });
});
