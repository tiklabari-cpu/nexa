/**
 * The apps marketplace in a real browser (FR-MOD-09.2 · FR-EK-B.1 / NFR-P4).
 *
 * The integration suite already pins the endpoint — its narrowing, its cursor
 * and its tenant isolation — and the web unit suite pins the grid's windowing
 * against a mocked API. Neither can answer the question this file exists for:
 * now that the catalogue is past 100 cards, does a real browser against the
 * real API still show a directory an agent can use — one that narrows, that
 * pages all the way to its last card, and that never puts the whole catalogue
 * in the DOM to do it (NFR-P4 "yalnız görünür satır DOM'da").
 *
 * The catalogue is read from the API first and used as the oracle: its size,
 * its first card and its last card are facts about the running server rather
 * than constants copied in here, so growing the catalogue again cannot quietly
 * turn these assertions into nothing.
 */
import type { APIRequestContext } from '@playwright/test';
import { API_BASE, expect, ownerAccessToken, test } from './fixtures.js';

interface AppsPage {
  items: Array<{ id: string; name: string; channel: string | null }>;
  total: number;
  next_page_id?: string;
}

/**
 * Every card id in the live catalogue, in list order, by walking the keyset
 * cursor to its end. The contract caps `limit` at 100 and the catalogue is
 * larger than that, so a single request can no longer stand in for "all of it" —
 * the same reason the integration suite walks rather than asking for one page.
 */
async function catalogueIds(api: APIRequestContext, token: string): Promise<string[]> {
  const ids: string[] = [];
  let cursor: string | undefined;

  for (let page = 0; page < 20; page += 1) {
    const query = cursor ? `?limit=100&page_id=${cursor}` : '?limit=100';
    const response = await api.get(`${API_BASE}/settings/apps${query}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.ok(), `apps list failed: ${response.status()} ${await response.text()}`).toBe(
      true,
    );

    const body = (await response.json()) as AppsPage;
    ids.push(...body.items.map((item) => item.id));
    if (body.next_page_id === undefined) return ids;
    cursor = body.next_page_id;
  }

  throw new Error('the apps cursor never ended');
}

test.describe('apps marketplace', () => {
  test('pages a 100+ catalogue to its last card without holding it in the DOM (NFR-P4)', async ({
    agentPage,
    request,
  }) => {
    const ids = await catalogueIds(request, await ownerAccessToken(request));
    expect(ids.length, 'the 09.2 v2 catalogue is 100+ cards').toBeGreaterThanOrEqual(100);
    const firstCard = ids[0]!;
    const lastCard = ids[ids.length - 1]!;

    // The Apps route is not on the module rail — Settings → Integrations is the
    // only door to it, so the walk starts there rather than at a typed URL.
    await agentPage.goto('/app/settings');
    await agentPage.getByRole('link', { name: 'Open marketplace' }).click();
    await expect(agentPage).toHaveURL(/\/app\/apps$/);
    await expect(agentPage.getByRole('heading', { name: 'Apps', level: 1 })).toBeVisible();

    const grid = agentPage.getByRole('list', { name: 'Apps' });
    const cards = grid.getByRole('listitem');
    await expect(agentPage.getByTestId(`app-${firstCard}`)).toBeVisible();

    // The measurement NFR-P4 asks for: what the catalogue holds vs. what the
    // browser actually painted.
    const atFirstPaint = await cards.count();
    expect(atFirstPaint).toBeGreaterThan(0);
    expect(atFirstPaint, 'the whole catalogue must never be in the DOM').toBeLessThan(ids.length);

    await agentPage.screenshot({ path: 'kanit/09.2-apps-marketplace.png', fullPage: true });

    // Page to the end of the chain. The button removes itself on the last page,
    // which is what makes "no button left" the honest end condition; it is only
    // clicked while idle, because a click during a fetch is one the button
    // itself refuses.
    const loadMore = agentPage.getByRole('button', { name: 'Load more' });
    await expect(loadMore, 'a 100+ catalogue takes more than one page').toBeVisible();
    await expect
      .poll(
        async () => {
          if ((await loadMore.count()) > 0 && (await loadMore.isEnabled())) await loadMore.click();
          return loadMore.count();
        },
        { timeout: 30_000, message: 'the marketplace page chain never ended' },
      )
      .toBe(0);

    // The chain reached the catalogue's last card…
    await grid.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await expect(agentPage.getByTestId(`app-${lastCard}`)).toBeVisible();

    // …and the first one left the DOM on the way there, which is the whole
    // point: every card was reachable, none of them stayed.
    await expect(agentPage.getByTestId(`app-${firstCard}`)).toHaveCount(0);

    const wholeCatalogueLoaded = await cards.count();
    expect(wholeCatalogueLoaded).toBeLessThan(ids.length);
    console.log(
      `NFR-P4 (09.2 marketplace): catalogue ${ids.length} cards · DOM ${atFirstPaint} at first ` +
        `paint · ${wholeCatalogueLoaded} with every page loaded`,
    );
  });

  test('narrows the grid by search and by category', async ({ agentPage }) => {
    await agentPage.goto('/app/apps');
    const grid = agentPage.getByRole('list', { name: 'Apps' });
    const cards = grid.getByRole('listitem');
    await expect(cards.first()).toBeVisible();

    // A search that names one card leaves exactly that card — and, with a single
    // match, nothing left to chain.
    const search = agentPage.getByRole('searchbox', { name: 'Search apps' });
    await search.fill('shopify');
    await expect(cards).toHaveCount(1);
    await expect(agentPage.getByTestId('app-shopify')).toBeVisible();
    await expect(agentPage.getByTestId('app-hubspot')).toHaveCount(0);
    await expect(agentPage.getByRole('button', { name: 'Load more' })).toHaveCount(0);

    // A search nothing matches says so, rather than showing an empty grid.
    await search.fill('no-app-is-called-this');
    await expect(agentPage.getByText('No apps match')).toBeVisible();

    await search.fill('');
    await expect(cards.first()).toBeVisible();

    // A category chip narrows the same way: every card still rendered carries
    // that category, and a card from another one is gone.
    const categories = agentPage.getByRole('group', { name: 'Filter by category' });
    const payments = categories.getByRole('button', { name: 'Payments', exact: true });
    await payments.click();
    await expect(payments).toHaveAttribute('aria-pressed', 'true');
    await expect(agentPage.getByTestId('app-stripe')).toBeVisible();
    await expect(agentPage.getByTestId('app-hubspot')).toHaveCount(0);
    await expect(cards.filter({ hasNotText: 'Payments' })).toHaveCount(0);
    expect(await cards.count()).toBeGreaterThan(0);
  });

  test('sends a channel-typed app to Channels instead of offering Connect', async ({
    agentPage,
  }) => {
    await agentPage.goto('/app/apps');

    // The channel-typed cards are the tail of a 100+ catalogue, so the chip is
    // how a user reaches them without scrolling the whole directory.
    const categories = agentPage.getByRole('group', { name: 'Filter by category' });
    await categories.getByRole('button', { name: 'Channels', exact: true }).click();

    const card = agentPage.getByTestId('app-whatsapp');
    await expect(card).toBeVisible();
    // KK 09.2 "kanal-tipli olanlar Channels'ta da yönetilir": the marketplace
    // lists it for discovery but owns no connection of its own for it.
    await expect(card.getByRole('button', { name: 'Connect' })).toHaveCount(0);
    const manage = card.getByRole('link', { name: 'Manage in Channels' });
    await expect(manage).toBeVisible();

    await manage.click();
    await expect(agentPage).toHaveURL(/\/app\/settings#section-channels$/);
    await expect(agentPage.getByRole('region', { name: 'Channels' })).toBeVisible();
  });
});
