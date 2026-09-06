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
 *
 * The other half of 09.2's criterion — "Her biri OAuth/API key" — is also only
 * answerable here: the integration suite proves the endpoint stores a hash, and
 * the web unit suite proves the form posts to it against a mock. Whether an
 * admin can actually connect an API-key card in a browser, and whether the key
 * they typed stays off the screen afterwards, is a question about the two
 * together.
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

  test('connects an api_key card with a pasted key, showing only its last four (FR-MOD-09.2)', async ({
    agentPage,
  }) => {
    // A real key-shaped string, unmistakable if it ever surfaces.
    const apiKey = 'zd-live-e2e-never-shown-2f9c41';

    await agentPage.goto('/app/apps');
    const search = agentPage.getByRole('searchbox', { name: 'Search apps' });
    await search.fill('zendesk');
    // Wait for the *filtered* grid, not merely for a visible card: the search is
    // debounced, so the unfiltered list is still on screen for a moment and a
    // click landing on it is lost when the filtered response re-renders the row
    // (observed twice under load before this wait was added).
    await expect(agentPage.getByRole('list', { name: 'Apps' }).getByRole('listitem')).toHaveCount(
      1,
    );
    const card = agentPage.getByTestId('app-zendesk');
    await expect(card.getByText('Not connected')).toBeVisible();

    await card.getByRole('button', { name: 'Connect' }).click();

    // The API-key step, not the OAuth consent step: a field to paste into, and
    // no permission list to agree to — nothing is being granted here.
    const dialog = agentPage.getByRole('dialog');
    await expect(dialog.getByRole('button', { name: 'Authorize' })).toHaveCount(0);
    const submit = dialog.getByRole('button', { name: 'Connect app' });
    // Submit is refused until the key clears the bound the endpoint enforces.
    await expect(submit).toBeDisabled();

    await dialog.getByLabel('API key').fill(apiKey);
    await expect(submit).toBeEnabled();
    await submit.click();

    // The card flips to Connected and names the key by its last four characters
    // — the whole of what the product is allowed to show about it. "Not
    // connected" contains "Connected" as a substring, so the absent negative is
    // what makes the positive mean anything (channels.spec.ts' idiom).
    await expect(card.getByText('Not connected')).toHaveCount(0);
    await expect(card.getByText('Connected')).toBeVisible();
    await expect(card.getByText('••••9c41')).toBeVisible();
    // And the key itself is nowhere on the page it was just typed into.
    await expect(agentPage.getByText(apiKey)).toHaveCount(0);
    expect(await agentPage.content()).not.toContain(apiKey);

    await agentPage.screenshot({ path: 'kanit/09.2-apps-api-key.png', fullPage: true });

    // Put the shared seed back the way it was found: this suite runs against the
    // one seeded database, and a workspace left with Zendesk connected is a
    // fixture the next run did not ask for.
    await card.getByRole('button', { name: 'Disconnect' }).click();
    await expect(card.getByText('Not connected')).toBeVisible();
  });

  /**
   * The automation leg, in a browser (FR-MOD-09.4).
   *
   * The finding this closes was that Zapier's "Active zaps" and "Last zap run"
   * were fixed catalogue options — a card that looked like it was reporting and
   * was not. Neither the integration suite (which reads the endpoint) nor the
   * web unit suite (which renders a mocked response) can answer whether the
   * figure an admin actually sees moves when they wire a trigger up. This runs
   * the whole loop against the real server: connect the card, register a
   * trigger against it from the developer portal, watch the card's own number
   * go 0 → 1, then disconnect and watch the trigger go with it.
   */
  test('shows an automation card’s real trigger count, and drops it on disconnect (FR-MOD-09.4)', async ({
    agentPage,
  }) => {
    const hookUrl = `https://hooks.e2e.example/zap-${Date.now()}`;

    // The search is debounced, and the grid re-renders when its result lands —
    // so wait for the *filtered* list rather than clicking a card that is about
    // to be replaced by the same card from the next response.
    const showOnlyZapier = async (): Promise<void> => {
      await agentPage.getByRole('searchbox', { name: 'Search apps' }).fill('zapier');
      await expect(agentPage.getByRole('list', { name: 'Apps' }).getByRole('listitem')).toHaveCount(
        1,
      );
    };

    await agentPage.goto('/app/apps');
    await showOnlyZapier();
    const card = agentPage.getByTestId('app-zapier');
    await card.getByRole('button', { name: 'Connect' }).click();
    await agentPage.getByRole('dialog').getByRole('button', { name: 'Authorize' }).click();

    // Connected with nothing wired: the honest zero, and no run to report. The
    // old card would have picked one of '0'/'1'/'3'/'7' from a list here.
    const figures = agentPage.getByTestId('app-zapier-automation');
    await expect(figures).toHaveText('0 trigger(s) · last run never');

    // Wire one up, naming the card — the option only exists because the card is
    // connected (the server refuses any other).
    await agentPage.goto('/app/developers');
    await agentPage.getByRole('tab', { name: 'Webhooks' }).click();
    await agentPage.getByLabel('URL').fill(hookUrl);
    await agentPage.getByLabel('Event').selectOption('chat_started');
    await agentPage.getByLabel(/Automation app/).selectOption('zapier');
    await agentPage.getByRole('button', { name: 'Subscribe' }).click();
    await agentPage
      .getByRole('dialog', { name: 'Webhook subscribed' })
      .getByRole('button', { name: 'Done' })
      .click();
    // The row says which card owns it.
    await expect(agentPage.locator('li').filter({ hasText: hookUrl })).toContainText('via Zapier');

    // And the card's own figure moved, read back from the server.
    await agentPage.goto('/app/apps');
    await showOnlyZapier();
    await expect(figures).toHaveText('1 trigger(s) · last run never');
    await agentPage.screenshot({ path: 'kanit/09.4-apps-automation.png', fullPage: true });

    // Disconnecting takes the trigger with it — the negative gate, in a browser.
    // This also restores the shared seed workspace to how it was found.
    await card.getByRole('button', { name: 'Disconnect' }).click();
    await expect(card.getByText('Not connected')).toBeVisible();

    await agentPage.goto('/app/developers');
    await agentPage.getByRole('tab', { name: 'Webhooks' }).click();
    await expect(agentPage.locator('li').filter({ hasText: hookUrl })).toHaveCount(0);
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
