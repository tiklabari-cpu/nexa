/**
 * The console on a narrow screen (tm 259.25 · O6).
 *
 * The panel is laid out for a desktop: at 390 px the inbox measured ~1415 px
 * wide and the whole page slid sideways. Until the owner decides on a fully
 * responsive console, a window under 1024 px is told the console is designed
 * for desktop and offered the mobile app; "Continue anyway" opens the console
 * for the rest of the tab's session, and the page body never scrolls sideways —
 * the fixed-width columns scroll inside the module instead.
 *
 * A screenshot proves nothing here: every claim is a measurement
 * (`scrollWidth <= clientWidth`, a box's width), the PNGs are only evidence.
 */
import type { Page } from '@playwright/test';
import { continuePastNarrowNotice, expect, test } from './fixtures.js';

const PHONE = { width: 390, height: 844 } as const;
const DESKTOP = { width: 1280, height: 800 } as const;

const NOTICE = 'The console is designed for desktop';

/** How far the document is wider than the window, in px (0 = no sideways scroll). */
async function sidewaysOverflow(page: Page): Promise<number> {
  return page.evaluate(() => {
    const root = document.documentElement;
    const body = document.body;
    return Math.max(root.scrollWidth - root.clientWidth, body.scrollWidth - body.clientWidth);
  });
}

test.describe('narrow screen notice', () => {
  test('a phone sees the notice instead of the inbox; Continue anyway opens it without sideways scroll', async ({
    agentPage,
  }) => {
    await agentPage.setViewportSize(PHONE);
    await agentPage.goto('/app/inbox');

    const notice = agentPage.getByRole('heading', { name: NOTICE, level: 1 });
    await expect(notice).toBeVisible();
    await expect(agentPage.getByText(/mobile app/)).toBeVisible();
    await expect(agentPage.getByRole('link', { name: 'Inbox' })).toBeHidden();
    await expect(agentPage.getByRole('main')).toHaveCount(1);
    expect(await sidewaysOverflow(agentPage)).toBe(0);
    await agentPage.screenshot({ path: 'kanit/259.25-narrow-notice.png' });

    await agentPage.getByRole('button', { name: 'Continue anyway' }).click();
    await expect(notice).toHaveCount(0);
    await expect(agentPage.getByRole('link', { name: 'Inbox' })).toBeVisible();
    await expect(agentPage.getByRole('main')).toBeFocused();
    expect(await sidewaysOverflow(agentPage)).toBe(0);

    // The columns did not vanish: the module scrolls inside, the body does not.
    const main = agentPage.getByRole('main');
    const inner = await main.evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth }));
    expect(inner.scroll).toBeGreaterThan(inner.client);
    await agentPage.screenshot({ path: 'kanit/259.25-narrow-inbox-continued.png' });

    // Remembered for the tab's session: a reload does not ask again.
    await agentPage.reload();
    await expect(agentPage.getByRole('link', { name: 'Inbox' })).toBeVisible();
    await expect(agentPage.getByRole('heading', { name: NOTICE })).toHaveCount(0);
  });

  test('after Continue anyway, no module scrolls the page body sideways', async ({ agentPage }) => {
    await agentPage.setViewportSize(PHONE);
    await agentPage.goto('/app/inbox');
    await continuePastNarrowNotice(agentPage);

    const pages = [
      { path: '/app/inbox', heading: null },
      { path: '/app/customers', heading: 'Customers' },
      { path: '/app/billing', heading: 'Billing' },
      { path: '/app/settings/widget', heading: null },
      { path: '/app/settings/audit-log', heading: 'Audit log' },
      { path: '/app/reports', heading: 'Reports' },
      { path: '/app/team', heading: 'Team' },
    ] as const;
    const overflow: Record<string, number> = {};
    for (const { path, heading } of pages) {
      await agentPage.goto(path);
      await expect(agentPage.getByRole('link', { name: 'Inbox' })).toBeVisible();
      if (heading) {
        await expect(agentPage.getByRole('heading', { name: heading, level: 1 })).toBeVisible();
      }
      // Let late content (tables, cards) settle before measuring.
      await agentPage.waitForLoadState('networkidle');
      overflow[path] = await sidewaysOverflow(agentPage);
    }
    expect(overflow).toEqual(Object.fromEntries(pages.map(({ path }) => [path, 0])));

    // A section beside the fixed settings menu keeps a readable width (it was
    // ~90 px): the menu and the section scroll sideways together inside <main>.
    await agentPage.goto('/app/settings/notifications');
    const sectionTitle = agentPage.getByRole('heading', { name: 'Notifications', level: 1 });
    await expect(sectionTitle).toBeVisible();
    expect((await sectionTitle.boundingBox())!.width).toBeGreaterThan(150);
    expect(await sidewaysOverflow(agentPage)).toBe(0);

    await agentPage.goto('/app/customers');
    await expect(agentPage.getByRole('heading', { name: 'Customers', level: 1 })).toBeVisible();
    await agentPage.screenshot({ path: 'kanit/259.25-narrow-customers-continued.png' });
  });

  test('a desktop window never sees the notice', async ({ agentPage }) => {
    await agentPage.setViewportSize(DESKTOP);
    await agentPage.goto('/app/inbox');
    await expect(agentPage.getByRole('link', { name: 'Inbox' })).toBeVisible();
    await expect(agentPage.getByRole('heading', { name: NOTICE })).toHaveCount(0);
  });

  test('turning a tablet decides again, and the console keeps its place', async ({ agentPage }) => {
    await agentPage.setViewportSize(DESKTOP);
    await agentPage.goto('/app/customers');
    await expect(agentPage.getByRole('heading', { name: 'Customers', level: 1 })).toBeVisible();

    await agentPage.setViewportSize({ width: 800, height: 1280 });
    await expect(agentPage.getByRole('heading', { name: NOTICE, level: 1 })).toBeVisible();
    await expect(agentPage.getByRole('heading', { name: 'Customers', level: 1 })).toBeHidden();

    await agentPage.setViewportSize(DESKTOP);
    await expect(agentPage.getByRole('heading', { name: NOTICE })).toHaveCount(0);
    await expect(agentPage.getByRole('heading', { name: 'Customers', level: 1 })).toBeVisible();
    await expect(agentPage).toHaveURL(/\/app\/customers$/);
  });

  test('the Turkish console says it in Turkish', async ({ agentPage }) => {
    await agentPage.addInitScript(() => localStorage.setItem('siyahtus.locale', 'tr'));
    await agentPage.setViewportSize(PHONE);
    await agentPage.goto('/app/inbox');
    await expect(
      agentPage.getByRole('heading', { name: 'Panel masaüstü için tasarlandı', level: 1 }),
    ).toBeVisible();
    await expect(agentPage.getByRole('button', { name: 'Yine de devam et' })).toBeVisible();
  });

  test('the sign-in page at 375 px is untouched: no notice, no sideways scroll', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/');
    await expect(page.getByRole('button', { name: /^Sign in/ }).first()).toBeVisible();
    await expect(page.getByRole('heading', { name: NOTICE })).toHaveCount(0);
    expect(await sidewaysOverflow(page)).toBe(0);
  });
});
