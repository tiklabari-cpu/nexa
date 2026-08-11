/**
 * WCAG 2.1 AA — the automated half of NFR-A11Y1–6 (tm 115).
 *
 * §7.2 has claimed AA since Dilim 14 on hand evidence alone; the GL-8 round
 * (tm 114) measured that no automated a11y check existed anywhere in the tree.
 * This spec is the measurement: axe-core over nine surfaces in a real browser,
 * with `serious`/`critical` as a hard gate (see `a11y.ts` for why the grade
 * split is where it is).
 *
 * The nine are the ones a user cannot route around: the door (Sign in), the
 * screen agents live in all day (Inbox), the four module screens reachable from
 * the rail (Customers, Reports, Team, Settings), the marketplace behind Settings
 * → Integrations (Apps), the customer widget in its cross-origin iframe, and the
 * one surface a signed-out stranger sees at all (public KB — served as
 * `text/html` by the API, not by the SPA, so nothing the web suite renders
 * covers it).
 *
 * The last test is the gate's own proof: a known-broken control is injected into
 * a real page and the gate is asserted to fire on it. Without that, a scan
 * silently returning nothing — a bad selector, an axe that never injected —
 * would read exactly like a clean pass.
 *
 * **Both themes, since tm 117.** The seven panel surfaces are scanned once dark
 * and once light. Until tm 117 the light ramp was unreachable — `index.html`
 * hard-coded `data-theme="dark"` — so half of `tokens.css` and half of
 * `tokens.test.ts`'s 40 contrast assertions guarded a surface axe had never
 * looked at. Now that an agent can choose it, it is measured: contrast is a
 * property of the rendered pair, and a token ramp that satisfies AA on its own
 * says nothing about a component that reaches for the wrong one. The remaining
 * two surfaces are scanned once each and are not in the loop — the public KB is
 * served as `text/html` by the API and has no panel stylesheet, and the widget's
 * theme is a separate axis (`data-nx-theme`, tm 57) that belongs to the
 * customer, not the agent.
 *
 * Each themed scan asserts the attribute it asked for is really on `<html>`
 * before it runs. A pin that silently failed would scan dark twice and report
 * "both themes green", which is the same failure mode the gate-probe test exists
 * to rule out.
 */
import {
  request as newApiContext,
  type APIRequestContext,
  type Page,
  type TestInfo,
} from '@playwright/test';
import type { Result as AxeViolation } from 'axe-core';
import { assertNoBlockingViolations, partitionViolations, scanScreen } from './a11y.js';
import {
  ACME_OWNER,
  API_BASE,
  expect,
  openWidget,
  ownerAccessTokenFor,
  test,
  widgetFrame,
} from './fixtures.js';

/** Where the public KB is served — `${API_BASE_URL}${API_PREFIX}` (server.ts). */
const PUBLIC_BASE = 'http://localhost:4000/api/v1';
const KB_SLUG = 'acme-help';
const KB_ARTICLE_SLUG = 'a11y-baseline';

const auth = (token: string) => ({ headers: { authorization: `Bearer ${token}` } });

let apiCtx: APIRequestContext;

/**
 * Stand up one published article on Acme's public KB, idempotently.
 *
 * Idempotent because the suite reruns against a database that is seeded once:
 * a plain create would 409 on the second run, and deleting first would race the
 * `public-kb` spec's own baseline. Setup goes through the API rather than the
 * database, per `fixtures.ts` — a DB insert would paper over a broken
 * management path.
 */
async function ensurePublishedArticle(api: APIRequestContext, token: string): Promise<void> {
  const enabled = await api.put(`${API_BASE}/kb-settings`, {
    ...auth(token),
    data: { enabled: true, public_slug: KB_SLUG, site_title: 'Acme Help Center' },
  });
  expect(enabled.ok(), `enable KB failed: ${enabled.status()} ${await enabled.text()}`).toBe(true);

  const listed = await api.get(`${API_BASE}/kb-articles`, auth(token));
  expect(listed.ok(), `list articles failed: ${listed.status()}`).toBe(true);
  const { items } = (await listed.json()) as { items: Array<{ id: string; slug: string }> };

  let id = items.find((article) => article.slug === KB_ARTICLE_SLUG)?.id;
  if (!id) {
    const created = await api.post(`${API_BASE}/kb-articles`, {
      ...auth(token),
      data: {
        title: 'Accessibility baseline',
        slug: KB_ARTICLE_SLUG,
        body: 'This article exists so the public reader has a page to scan.',
      },
    });
    expect(created.ok(), `create article failed: ${created.status()} ${await created.text()}`).toBe(
      true,
    );
    id = ((await created.json()) as { id: string }).id;
  }

  const published = await api.patch(`${API_BASE}/kb-articles/${id}`, {
    ...auth(token),
    data: { status: 'published' },
  });
  expect(published.ok(), `publish failed: ${published.status()} ${await published.text()}`).toBe(
    true,
  );
}

test.beforeAll(async () => {
  apiCtx = await newApiContext.newContext({
    extraHTTPHeaders: { 'user-agent': 'nexa-e2e-a11y' },
  });
  await ensurePublishedArticle(apiCtx, await ownerAccessTokenFor(apiCtx, ACME_OWNER));
});

test.afterAll(async () => {
  await apiCtx?.dispose();
});

/**
 * Scan a screen once it has actually rendered.
 *
 * The `ready` wait is not ceremony: axe reads the DOM at the instant it is
 * called, so scanning a route that is still on its loading skeleton measures the
 * skeleton — which is both clean and meaningless.
 */
async function scanReadyScreen(
  page: Page,
  screen: string,
  testInfo: TestInfo,
  ready: () => Promise<void>,
): Promise<void> {
  await ready();
  assertNoBlockingViolations(await scanScreen(page, screen, testInfo));
}

/** The panel themes an agent can choose between (`apps/web/src/lib/theme.ts`). */
const PANEL_THEMES = ['dark', 'light'] as const;
type PanelTheme = (typeof PANEL_THEMES)[number];

/**
 * Pin the panel theme for every navigation this page makes from here on.
 *
 * Through `localStorage` rather than a click, because the sign-in screen has no
 * switcher and half these scans happen before any menu is reachable — and
 * because it is the same key the boot script reads, so the pin exercises the
 * real path rather than a test-only one.
 */
async function pinTheme(page: Page, theme: PanelTheme): Promise<void> {
  await page.addInitScript((value) => {
    window.localStorage.setItem('nexa.theme', value);
  }, theme);
}

/**
 * Scan a panel surface in one theme, having first proved the theme took.
 *
 * The attribute check is the load-bearing part: without it, a pin that silently
 * did nothing would scan dark twice and report both themes clean.
 */
async function scanPanel(
  page: Page,
  screen: string,
  theme: PanelTheme,
  testInfo: TestInfo,
  ready: () => Promise<void>,
): Promise<void> {
  await scanReadyScreen(page, `${screen} (${theme})`, testInfo, async () => {
    await ready();
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
  });
}

test.describe('WCAG 2.1 AA (axe)', () => {
  for (const theme of PANEL_THEMES) {
    test.describe(`${theme} theme`, () => {
      test('sign-in page has no serious or critical violations', async ({ page }, testInfo) => {
        await pinTheme(page, theme);
        await page.goto('/');
        await scanPanel(page, 'Sign in', theme, testInfo, async () => {
          await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
        });
      });

      test('inbox has no serious or critical violations', async ({ agentPage }, testInfo) => {
        await pinTheme(agentPage, theme);
        await agentPage.goto('/app/inbox');
        await scanPanel(agentPage, 'Inbox', theme, testInfo, async () => {
          await expect(agentPage.getByRole('heading', { name: 'Inbox', level: 1 })).toBeVisible();
        });
      });

      test('customers has no serious or critical violations', async ({ agentPage }, testInfo) => {
        await pinTheme(agentPage, theme);
        await agentPage.goto('/app/customers');
        await scanPanel(agentPage, 'Customers', theme, testInfo, async () => {
          await expect(agentPage.getByRole('table', { name: 'Customers' })).toBeVisible();
        });
      });

      test('reports has no serious or critical violations', async ({ agentPage }, testInfo) => {
        await pinTheme(agentPage, theme);
        await agentPage.goto('/app/reports');
        await scanPanel(agentPage, 'Reports', theme, testInfo, async () => {
          await expect(agentPage.getByRole('heading', { name: 'Reports', level: 1 })).toBeVisible();
        });
      });

      test('team has no serious or critical violations', async ({ agentPage }, testInfo) => {
        await pinTheme(agentPage, theme);
        await agentPage.goto('/app/team');
        await scanPanel(agentPage, 'Team', theme, testInfo, async () => {
          await expect(agentPage.getByRole('heading', { name: 'Team', level: 1 })).toBeVisible();
        });
      });

      test('settings has no serious or critical violations', async ({ agentPage }, testInfo) => {
        await pinTheme(agentPage, theme);
        await agentPage.goto('/app/settings');
        await scanPanel(agentPage, 'Settings', theme, testInfo, async () => {
          await expect(
            agentPage.getByRole('heading', { name: 'Settings', level: 1 }),
          ).toBeVisible();
        });
      });

      test('apps marketplace has no serious or critical violations', async ({
        agentPage,
      }, testInfo) => {
        await pinTheme(agentPage, theme);
        await agentPage.goto('/app/apps');
        await scanPanel(agentPage, 'Apps', theme, testInfo, async () => {
          await expect(agentPage.getByRole('heading', { name: 'Apps', level: 1 })).toBeVisible();
          // Cards arrive after the catalogue fetch; an empty grid is not the screen.
          await expect(
            agentPage.getByRole('list', { name: 'Apps' }).getByRole('listitem').first(),
          ).toBeVisible();
        });
      });
    });
  }

  /**
   * The visitor's surface, scanned inside its own cross-origin iframe.
   *
   * It carries white text on the tenant's brand colour — header, the visitor's
   * own bubbles, the launcher — and that colour comes from the widget's shipped
   * default, so a palette defect here reaches every customer of every workspace
   * rather than the handful of agents behind the sign-in.
   */
  test('customer widget has no serious or critical violations', async ({
    page,
    organizationId,
  }, testInfo) => {
    await openWidget(page, organizationId);
    await scanReadyScreen(page, 'Widget', testInfo, async () => {
      await expect(widgetFrame(page).getByRole('log', { name: 'Conversation' })).toBeVisible();
    });
  });

  test('public knowledge base has no serious or critical violations', async ({
    page,
  }, testInfo) => {
    await page.goto(`${PUBLIC_BASE}/public/kb/${KB_SLUG}/${KB_ARTICLE_SLUG}`);
    await scanReadyScreen(page, 'Public KB', testInfo, async () => {
      await expect(page.getByRole('heading', { name: 'Accessibility baseline' })).toBeVisible();
    });
  });

  /**
   * The gate's own test.
   *
   * Two halves, because they can fail independently. `partitionViolations` is
   * fed a hand-built `serious` finding to prove the classification — including
   * that a named exception moves it out of `blocking` and into `excused`, which
   * is the only mechanism that can ever silence this suite. Then a genuinely
   * broken control (a `<button>` with no accessible name — axe rule
   * `button-name`, impact `critical`) is injected into a real, rendered page and
   * the gate is asserted to throw on it. Together they rule out the failure that
   * would be invisible otherwise: a scan that reports nothing because it never
   * really ran.
   */
  test('the gate fails on a serious violation', async ({ page }, testInfo) => {
    const handBuilt = {
      id: 'color-contrast',
      impact: 'serious' as const,
      help: 'Elements must meet minimum colour contrast ratio thresholds',
      helpUrl: 'https://dequeuniversity.com/rules/axe/4.12/color-contrast',
      description: 'hand-built, for this test only',
      tags: ['wcag2aa'],
      nodes: [{ target: ['.pretend'], html: '<p class="pretend">x</p>' }],
    } as unknown as AxeViolation;

    const gated = partitionViolations('Reports', [handBuilt]);
    expect(gated.blocking.map((violation) => violation.id)).toEqual(['color-contrast']);
    expect(() => assertNoBlockingViolations(gated)).toThrow(/color-contrast/);

    // The same finding, excused by name on that one screen, must stop blocking —
    // and must still be excused on that screen only.
    const excuse = [{ rule: 'color-contrast', screens: ['Reports'], reason: 'test fixture' }];
    expect(partitionViolations('Reports', [handBuilt], excuse).blocking).toEqual([]);
    expect(partitionViolations('Reports', [handBuilt], excuse).excused).toHaveLength(1);
    expect(partitionViolations('Inbox', [handBuilt], excuse).blocking).toHaveLength(1);

    // End to end: break a real page and watch the real scan catch it.
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
    await page.evaluate(() => {
      const broken = document.createElement('button');
      broken.id = 'a11y-gate-probe';
      document.body.append(broken);
    });

    const scan = await scanScreen(page, 'Gate probe', testInfo);
    expect(
      scan.blocking.map((violation) => violation.id),
      'an unnamed button is axe rule `button-name`, impact critical',
    ).toContain('button-name');
    expect(() => assertNoBlockingViolations(scan)).toThrow(/button-name/);
  });
});
