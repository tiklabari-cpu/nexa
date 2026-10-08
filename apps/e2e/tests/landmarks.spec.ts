/**
 * Page structure in a browser (tm 259.20 · O15).
 *
 * axe measured 45 panel pages with no `<main>`, 10 with content outside every
 * landmark, a tab title that read "SiyahTuş" on every screen, and one h1
 * ("Customers") on four of them. The web suite proves the pieces in jsdom; what
 * only a browser can show is the Tab order, where focus lands, and the title the
 * tab actually carries — plus, in `a11y.spec.ts`, that no scanned screen is left
 * without them.
 */
import { expect, test } from './fixtures.js';

/** Every module address, with the h1 it opens on and so the tab title it earns. */
const SCREENS = [
  { path: '/app/inbox', heading: 'Inbox' },
  { path: '/app/home', heading: 'Home' },
  { path: '/app/customers', heading: 'Customers' },
  { path: '/app/customers/real-time', heading: 'Real-time traffic' },
  { path: '/app/customers/campaigns', heading: 'Campaigns' },
  { path: '/app/customers/goals', heading: 'Goals' },
  { path: '/app/team', heading: 'Team' },
  { path: '/app/reports', heading: 'Reports' },
  { path: '/app/playbook', heading: 'AI Agent' },
] as const;

test.describe('landmarks, skip link and tab titles', () => {
  test('Tab reaches "Skip to content" first, and Enter puts focus on the main region', async ({
    agentPage,
  }) => {
    await agentPage.goto('/app/reports');
    await expect(agentPage.getByRole('heading', { name: 'Reports', level: 1 })).toBeVisible();

    await agentPage.keyboard.press('Tab');
    const skip = agentPage.getByRole('link', { name: 'Skip to content' });
    await expect(skip).toBeFocused();
    // Hidden until focused, then really on screen — a clipped link that takes
    // focus but cannot be seen is the other way this fails.
    const box = await skip.boundingBox();
    expect(box, 'the focused skip link has a box').not.toBeNull();
    expect(box!.width).toBeGreaterThan(40);
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.y).toBeGreaterThanOrEqual(0);

    await agentPage.keyboard.press('Enter');
    await expect(agentPage.locator('main#main')).toBeFocused();
    // Focus was moved by hand: the address bar is untouched.
    expect(agentPage.url()).not.toContain('#');
  });

  for (const { path, heading } of SCREENS) {
    test(`${path} has one main region, an h1 "${heading}" and the tab title to match`, async ({
      agentPage,
    }) => {
      await agentPage.goto(path);
      await expect(agentPage.getByRole('heading', { name: heading, level: 1 })).toBeVisible();

      await expect(agentPage.getByRole('main')).toHaveCount(1);
      await expect(agentPage.getByRole('heading', { level: 1 })).toHaveCount(1);
      await expect.poll(() => agentPage.title()).toBe(`${heading} · SiyahTuş`);
    });
  }

  test('the title and <html lang> follow the console language', async ({ agentPage }) => {
    await agentPage.goto('/app/inbox');
    await expect(agentPage.getByRole('heading', { name: 'Inbox', level: 1 })).toBeVisible();
    expect(await agentPage.evaluate(() => document.documentElement.lang)).toBe('en');

    await agentPage.getByRole('button', { name: 'Account' }).click();
    await agentPage.getByLabel('Language').selectOption('tr');
    await agentPage.keyboard.press('Escape');

    await expect(agentPage.getByRole('heading', { name: 'Gelen Kutusu', level: 1 })).toBeVisible();
    await expect.poll(() => agentPage.title()).toBe('Gelen Kutusu · SiyahTuş');
    expect(await agentPage.evaluate(() => document.documentElement.lang)).toBe('tr');

    // Put the owner's remembered language back for the specs after this one.
    await agentPage.getByRole('button', { name: 'Hesap' }).click();
    await agentPage.getByLabel('Dil').selectOption('en');
    await agentPage.keyboard.press('Escape');
    await expect(agentPage.getByRole('heading', { name: 'Inbox', level: 1 })).toBeVisible();
  });
});
