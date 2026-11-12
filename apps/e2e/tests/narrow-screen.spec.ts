/**
 * The console on a narrow screen (tm 259.25 · O6, per screen since GV-04 · tm 385).
 *
 * Most of the panel is still laid out for a desktop. Below 1024 px a screen not
 * yet adapted shows a "designed for desktop" band above itself (the mobile app
 * named as another way); "Continue anyway" dismisses it for the rest of the
 * tab's session, and the page body never scrolls sideways — fixed-width columns
 * scroll inside the module instead. The inbox is adapted and shows no band:
 * `narrow-inbox.spec.ts` drives it at 375 and 768 px; so are Settings and
 * Customers (tm 472.1), `narrow-settings-customers.spec.ts`, and Archive and
 * Reports (tm 472.3), `narrow-archive-reports.spec.ts`.
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

test.describe('narrow screen band', () => {
  test('a phone sees the band above an unadapted screen; Continue anyway dismisses it for the tab', async ({
    agentPage,
  }) => {
    await agentPage.setViewportSize(PHONE);
    await agentPage.goto('/app/team');

    const band = agentPage.getByRole('region', { name: NOTICE });
    await expect(band).toBeVisible();
    await expect(band).toContainText(/mobile app/);
    // A band, not a stand-in: the rail and the screen are there with it.
    await expect(agentPage.getByRole('link', { name: 'Inbox' })).toBeVisible();
    await expect(agentPage.getByRole('heading', { name: 'Team', level: 1 })).toBeVisible();
    await expect(agentPage.getByRole('main')).toHaveCount(1);
    expect(await sidewaysOverflow(agentPage)).toBe(0);
    await agentPage.screenshot({ path: 'kanit/259.25-narrow-notice.png' });

    await agentPage.getByRole('button', { name: 'Continue anyway' }).click();
    await expect(band).toHaveCount(0);
    expect(await sidewaysOverflow(agentPage)).toBe(0);

    // Remembered for the tab's session: a reload does not show it again.
    await agentPage.reload();
    await expect(agentPage.getByRole('link', { name: 'Inbox' })).toBeVisible();
    await expect(agentPage.getByRole('heading', { name: 'Team', level: 1 })).toBeVisible();
    await expect(agentPage.getByRole('region', { name: NOTICE })).toHaveCount(0);
  });

  test('the inbox on a phone shows no band (GV-04)', async ({ agentPage }) => {
    await agentPage.setViewportSize(PHONE);
    await agentPage.goto('/app/inbox');
    await expect(agentPage.getByRole('heading', { name: 'Inbox', level: 1 })).toBeVisible();
    await expect(agentPage.getByRole('region', { name: NOTICE })).toHaveCount(0);
    expect(await sidewaysOverflow(agentPage)).toBe(0);
  });

  test('after Continue anyway, no module scrolls the page body sideways', async ({ agentPage }) => {
    await agentPage.setViewportSize(PHONE);
    await agentPage.goto('/app/team');
    await continuePastNarrowNotice(agentPage);

    const pages = [
      { path: '/app/inbox', heading: 'Inbox' },
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

    // A section keeps a readable width (it was ~90 px beside the fixed menu):
    // below 1024 px it has the screen, the menu a page of its own (tm 472.1).
    await agentPage.goto('/app/settings/notifications');
    const sectionTitle = agentPage.getByRole('heading', { name: 'Notifications', level: 1 });
    await expect(sectionTitle).toBeVisible();
    expect((await sectionTitle.boundingBox())!.width).toBeGreaterThan(150);
    expect(await sidewaysOverflow(agentPage)).toBe(0);

    await agentPage.goto('/app/customers');
    await expect(agentPage.getByRole('heading', { name: 'Customers', level: 1 })).toBeVisible();
    await agentPage.screenshot({ path: 'kanit/259.25-narrow-customers-continued.png' });
  });

  test('a desktop window never sees the band', async ({ agentPage }) => {
    await agentPage.setViewportSize(DESKTOP);
    await agentPage.goto('/app/customers');
    await expect(agentPage.getByRole('heading', { name: 'Customers', level: 1 })).toBeVisible();
    await expect(agentPage.getByRole('region', { name: NOTICE })).toHaveCount(0);
  });

  test('turning a tablet decides again, and the console keeps its place', async ({ agentPage }) => {
    await agentPage.setViewportSize(DESKTOP);
    await agentPage.goto('/app/team');
    await expect(agentPage.getByRole('heading', { name: 'Team', level: 1 })).toBeVisible();

    await agentPage.setViewportSize({ width: 800, height: 1280 });
    await expect(agentPage.getByRole('region', { name: NOTICE })).toBeVisible();
    await expect(agentPage.getByRole('heading', { name: 'Team', level: 1 })).toBeVisible();

    await agentPage.setViewportSize(DESKTOP);
    await expect(agentPage.getByRole('region', { name: NOTICE })).toHaveCount(0);
    await expect(agentPage.getByRole('heading', { name: 'Team', level: 1 })).toBeVisible();
    await expect(agentPage).toHaveURL(/\/app\/team$/);
  });

  test('the Turkish console says it in Turkish', async ({ agentPage }) => {
    await agentPage.addInitScript(() => localStorage.setItem('siyahtus.locale', 'tr'));
    await agentPage.setViewportSize(PHONE);
    await agentPage.goto('/app/team');
    await expect(
      agentPage.getByRole('region', { name: 'Panel masaüstü için tasarlandı' }),
    ).toBeVisible();
    await expect(agentPage.getByRole('button', { name: 'Yine de devam et' })).toBeVisible();
  });

  test('the sign-in page at 375 px is untouched: no band, no sideways scroll', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/');
    await expect(page.getByRole('button', { name: /^Sign in/ }).first()).toBeVisible();
    await expect(page.getByRole('region', { name: NOTICE })).toHaveCount(0);
    expect(await sidewaysOverflow(page)).toBe(0);
  });
});
