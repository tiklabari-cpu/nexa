/**
 * Low-severity UX fixes that only a browser can measure (tm 259.24 · UX audit
 * D1, D11, D17).
 *
 * The other items of the task are text, and the web suite pins them. These three
 * are about where things are on the screen or what the address bar does, which
 * jsdom does not lay out:
 *
 *   - D1  the rail's online-teammate avatars no longer overlap each other, and
 *         the leads pill's count badge does not sit on an avatar's status glyph.
 *   - D11 an address under /app that is not a page says so; signing in from an
 *         /app address lands on that address.
 *   - D17 the Arabic widget's launcher stays put when the greeting card widens
 *         the frame.
 */
import type { Locator, Page } from '@playwright/test';
import { DEMO, HOST_PAGE, expect, test, widgetFrame } from './fixtures.js';

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The area two boxes share; 0 when they only touch or are apart. */
function overlap(a: Box, b: Box): number {
  const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return width > 0 && height > 0 ? width * height : 0;
}

function union(...boxes: Box[]): Box {
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  const right = Math.max(...boxes.map((b) => b.x + b.width));
  const bottom = Math.max(...boxes.map((b) => b.y + b.height));
  return { x, y, width: right - x, height: bottom - y };
}

async function box(locator: Locator): Promise<Box> {
  const found = await locator.boundingBox();
  if (!found) throw new Error('element has no box');
  return found;
}

const member = (id: string, name: string, status: string) => ({
  id,
  name,
  email: `${id}@acme.localhost`,
  avatar_url: null,
  role: 'agent',
  routing_status: status,
  concurrent_chats_limit: 6,
});

async function stubRosterAndLeads(page: Page): Promise<void> {
  await page.route(/\/api\/v1\/agents(\?.*)?$/, (route) =>
    route.fulfill({
      json: {
        items: [
          member('e2e-sr', 'Sam Rivera', 'accepting_chats'),
          member('e2e-pn', 'Priya Nair', 'not_accepting_chats'),
          member('e2e-tb', 'Tom Bright', 'accepting_chats'),
        ],
      },
    }),
  );
  await page.route(/\/api\/v1\/customers\?segment=leads/, (route) =>
    route.fulfill({ json: { items: [], total: 2 } }),
  );
}

test.describe('rail presence avatars (D1)', () => {
  test('the faces and the leads badge do not overlap', async ({ agentPage }) => {
    await stubRosterAndLeads(agentPage);
    await agentPage.goto('/app/home');

    const group = agentPage.getByTestId('presence-avatars');
    const faces = group.getByRole('img');
    await expect(faces).toHaveCount(3);

    // Each item's footprint is its face plus the status glyph hanging off it.
    const footprints: Box[] = [];
    for (const item of await group.locator('li').all()) {
      footprints.push(
        union(await box(item.getByRole('img')), await box(item.locator('span[aria-hidden]'))),
      );
    }

    const leads = agentPage.getByRole('link', { name: /Leads? qualified/ });
    await expect(leads).toBeVisible();
    const leadsFootprint = union(
      await box(leads),
      await box(leads.locator('span[aria-hidden]').last()),
    );

    for (let i = 0; i < footprints.length; i += 1) {
      for (let j = i + 1; j < footprints.length; j += 1) {
        expect(overlap(footprints[i]!, footprints[j]!), `avatars ${i} and ${j}`).toBe(0);
      }
      expect(overlap(footprints[i]!, leadsFootprint), `avatar ${i} and the leads pill`).toBe(0);
    }

    await agentPage
      .getByRole('navigation', { name: 'Modules' })
      .screenshot({ path: 'kanit/259.24-rail-presence.png' });
  });
});

test.describe('unknown addresses (D11)', () => {
  test('/app/<nothing> says the page was not found and keeps the address', async ({
    agentPage,
  }) => {
    await agentPage.goto('/app/no-such-page');
    await expect(
      agentPage.getByRole('heading', { name: 'Page not found', level: 1 }),
    ).toBeVisible();
    expect(new URL(agentPage.url()).pathname).toBe('/app/no-such-page');
    // The rail is still there to leave from.
    await expect(agentPage.getByRole('link', { name: 'Inbox', exact: true })).toBeVisible();

    await agentPage.getByRole('link', { name: 'Go to the inbox' }).click();
    await expect(agentPage).toHaveURL(/\/app\/inbox$/);
  });

  test('signing in from an /app address lands on that address', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await page.goto('/app/customers');
      await page.getByLabel('Email').fill('agent2@acme.localhost');
      await page.getByLabel('Password').fill(DEMO.password);
      await page.getByRole('button', { name: 'Sign in' }).click();
      await expect(page.getByRole('heading', { name: 'Customers', level: 1 })).toBeVisible();
      expect(new URL(page.url()).pathname).toBe('/app/customers');
    } finally {
      await context.close();
    }
  });
});

test.describe('Arabic widget corner (D17)', () => {
  /**
   * The measurement the audit asked for: the launcher's box on the host page
   * with the greeting card open (a 340 px frame) and after the card is waved
   * away (an 84 px frame). Before the loader mirrored the frame's edge for a
   * right-to-left language, the launcher sat at the frame's left in both, so
   * the card's arrival moved it ~250 px.
   */
  for (const language of ['en', 'ar']) {
    test(`the launcher does not move when the greeting card closes (${language})`, async ({
      page,
      organizationId,
    }) => {
      await page.goto(
        `${HOST_PAGE}/demo.html?organization_id=${organizationId}&language=${language}`,
      );
      const frame = widgetFrame(page);
      const launcher = frame.locator('.nx-launcher');

      await expect(frame.locator('.nx-greeting')).toBeVisible();
      await expect
        .poll(async () => (await box(page.locator('#siyahtus-widget-frame'))).width)
        .toBeGreaterThan(300);
      const withCard = await box(launcher);
      const cardFrame = await box(page.locator('#siyahtus-widget-frame'));

      await frame.locator('.nx-greet-browse').click();
      await expect
        .poll(async () => (await box(page.locator('#siyahtus-widget-frame'))).width)
        .toBeLessThanOrEqual(100);
      const alone = await box(launcher);

      expect(Math.abs(withCard.x - alone.x), 'horizontal shift').toBeLessThanOrEqual(1);
      expect(Math.abs(withCard.y - alone.y), 'vertical shift').toBeLessThanOrEqual(1);

      // Arabic mirrors the workspace's bottom-right to the screen's left; the
      // launcher is in the corner the frame was pinned to either way.
      const viewport = page.viewportSize()!;
      const inLeftHalf = alone.x + alone.width / 2 < viewport.width / 2;
      expect(inLeftHalf, `launcher side for ${language}`).toBe(language === 'ar');
      expect(cardFrame.width).toBeGreaterThan(300);
    });
  }
});
