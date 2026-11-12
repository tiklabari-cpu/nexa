/**
 * Settings and Customers below the desktop layout (GV-04 · tm 472.1).
 *
 * Runs in the `narrow-375` and `narrow-768` projects only (`playwright.config.ts`
 * `NARROW_SPECS`): a phone and a tablet held upright, with touch.
 *
 *   Settings   the navigation is a page of its own (`/app/settings`) and a
 *              section opens in its place, under a link back to the list.
 *   Customers  the table is a list of cards, and an opened record fills the
 *              screen with a way back.
 *
 * Neither shows the "designed for desktop" band. Every claim is a measurement:
 * the document, the shell's <main> and the page's own scroller are never wider
 * than the window, no control sits past the window's edge (cut off by a card)
 * unless it is inside a scroller of its own — a wide table that scrolls in
 * place — and the navigation's targets are at least 44 px tall. Every Settings
 * section the owner can open is visited, so a section that grows a fixed-width
 * field fails here by name. The PNGs are only evidence.
 */
import { expect, test } from './fixtures.js';
import { BAND, FITS, expectTouchSized, measureFit, widthTag, type Fit } from './narrow-fit.js';

test.describe('Settings on a narrow window (tm 472.1)', () => {
  test('every section the owner can open fits the window, with no band', async ({
    agentPage,
  }, testInfo) => {
    test.setTimeout(240_000);
    await agentPage.goto('/app/settings');
    await expect(agentPage.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();
    const nav = agentPage.getByRole('navigation', { name: 'Settings navigation' });
    await expect(nav).toBeVisible();
    await expect(agentPage.getByRole('region', { name: BAND })).toHaveCount(0);
    await agentPage.waitForLoadState('networkidle');
    expect(await measureFit(agentPage)).toEqual(FITS);
    await agentPage.screenshot({ path: `kanit/472.1-settings-list-${widthTag(testInfo)}.png` });

    // The sections under Settings' own address; the two that are other modules'
    // pages (the AI agent, Billing) are not this screen.
    const hrefs = (
      await nav.locator('a').evaluateAll((links) => links.map((a) => a.getAttribute('href') ?? ''))
    ).filter((href) => href.startsWith('/app/settings/'));
    expect(hrefs.length).toBeGreaterThan(30);

    const misfits: Record<string, Fit | 'band'> = {};
    for (const href of hrefs) {
      await agentPage.goto(href);
      await expect(agentPage.getByRole('heading', { level: 1 })).toBeVisible();
      await expect(agentPage.getByRole('link', { name: 'All settings' })).toBeVisible();
      // Let late content (tables, cards) settle before measuring.
      await agentPage.waitForLoadState('networkidle');
      if ((await agentPage.getByRole('region', { name: BAND }).count()) > 0) {
        misfits[href] = 'band';
        continue;
      }
      const fit = await measureFit(agentPage);
      if (JSON.stringify(fit) !== JSON.stringify(FITS)) misfits[href] = fit;
    }
    expect(misfits).toEqual({});
  });

  test('a section opens in place of the list, and the way back returns to it', async ({
    agentPage,
  }, testInfo) => {
    await agentPage.goto('/app/settings');
    const nav = agentPage.getByRole('navigation', { name: 'Settings navigation' });
    const tags = nav.getByRole('link', { name: 'Tags', exact: true });
    await expectTouchSized(tags);
    await expectTouchSized(agentPage.getByRole('combobox', { name: 'Search settings' }));
    await tags.tap();

    await expect(agentPage).toHaveURL(/\/app\/settings\/tags$/);
    await expect(agentPage.getByRole('heading', { name: 'Tags', level: 1 })).toBeVisible();
    // The section has the screen: the menu is not beside it.
    await expect(nav).toHaveCount(0);
    await expect(agentPage.getByRole('region', { name: BAND })).toHaveCount(0);
    await agentPage.waitForLoadState('networkidle');
    expect(await measureFit(agentPage)).toEqual(FITS);
    await agentPage.screenshot({ path: `kanit/472.1-settings-section-${widthTag(testInfo)}.png` });

    const back = agentPage.getByRole('link', { name: 'All settings' });
    await expectTouchSized(back);
    await back.tap();
    await expect(agentPage).toHaveURL(/\/app\/settings$/);
    await expect(nav.getByRole('link', { name: 'Tags', exact: true })).toBeVisible();
  });
});

test.describe('Customers on a narrow window (tm 472.1)', () => {
  test('the table is a list of cards, and a record fills the screen with a way back', async ({
    agentPage,
  }, testInfo) => {
    const tag = widthTag(testInfo);
    await agentPage.goto('/app/customers');
    await expect(agentPage.getByRole('heading', { name: 'Customers', level: 1 })).toBeVisible();
    await expect(agentPage.getByRole('region', { name: BAND })).toHaveCount(0);

    const list = agentPage.getByRole('list', { name: 'Customers' });
    const firstCard = list.getByRole('listitem').first().getByRole('button');
    await expect(firstCard).toBeVisible();
    await expect(agentPage.getByRole('table')).toHaveCount(0);
    await expectTouchSized(firstCard);
    await expectTouchSized(agentPage.getByRole('tab', { name: 'All' }));
    await expectTouchSized(agentPage.getByRole('link', { name: 'Contacts' }));
    await expectTouchSized(agentPage.getByRole('searchbox', { name: 'Search customers' }));
    await agentPage.waitForLoadState('networkidle');
    expect(await measureFit(agentPage)).toEqual(FITS);
    await agentPage.screenshot({ path: `kanit/472.1-customers-cards-${tag}.png` });

    // Sorting moved from the column headers to a menu.
    const sort = agentPage.getByRole('combobox', { name: 'Sort by' });
    await expectTouchSized(sort);
    await sort.selectOption('name:asc');
    await expect(agentPage).toHaveURL(/customer_sort=name/);
    await expect(firstCard).toBeVisible();

    // The card's first line opens with the person's name (or "Unnamed visitor").
    const name = (
      await list.getByRole('listitem').first().locator('span.truncate').first().innerText()
    ).trim();
    await firstCard.tap();
    await expect(agentPage.getByRole('heading', { name, level: 2 })).toBeVisible();
    await expect(list).toHaveCount(0);
    const back = agentPage.getByRole('button', { name: 'All customers' });
    await expectTouchSized(back);
    await agentPage.waitForLoadState('networkidle');
    expect(await measureFit(agentPage)).toEqual(FITS);
    await agentPage.screenshot({ path: `kanit/472.1-customers-record-${tag}.png` });

    await back.tap();
    await expect(list.getByRole('listitem').first()).toBeVisible();
    await expect(agentPage.getByRole('heading', { name, level: 2 })).toHaveCount(0);
  });
});
