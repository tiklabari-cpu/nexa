/**
 * WCAG 2.1 AA — the automated half of NFR-A11Y1–6 (tm 115).
 *
 * §7.2 has claimed AA since Dilim 14 on hand evidence alone; the GL-8 round
 * (tm 114) measured that no automated a11y check existed anywhere in the tree.
 * This spec is the measurement: axe-core over twenty-two surfaces in a real
 * browser, with `serious`/`critical` as a hard gate (see `a11y.ts` for why the
 * grade split is where it is).
 *
 * The twenty-two are the ones a user cannot route around: the registration
 * funnel a signed-out stranger reaches before an account exists (Sign up,
 * Forgot password, Reset password, Join — tm 137.1), the first-run wizard a
 * brand-new owner lands on straight after (Onboarding — tm 137.1), the door
 * back in for everyone else (Sign in), the screen agents live in all day
 * (Inbox), the workspace landing dashboard (Home — tm 137.2), the seven
 * module screens reachable from the rail (Customers, Reports, Team, Settings,
 * Billing, Playbook, Developers — the last three tm 137.3) plus three more of
 * Customers' own tabs (real-time traffic, campaigns, goals — tm 137.2), the
 * two screens reached only through Settings (the marketplace — Apps — and the
 * audit trail — Audit log, tm 137.3), the customer widget in its
 * cross-origin iframe, and the one surface a signed-out stranger sees at all
 * outside the funnel (public KB — served as `text/html` by the API, not by
 * the SPA, so nothing the web suite renders covers it).
 *
 * The last test is the gate's own proof: a known-broken control is injected into
 * a real page and the gate is asserted to fire on it. Without that, a scan
 * silently returning nothing — a bad selector, an axe that never injected —
 * would read exactly like a clean pass.
 *
 * **Both themes, since tm 117.** The twenty-eight panel surfaces (or states of
 * one — a modal, a selected tab, a freshly opened editor) are scanned once
 * dark and once light. Until tm 117 the light ramp was unreachable —
 * `index.html` hard-coded `data-theme="dark"` — so half of `tokens.css` and
 * half of `tokens.test.ts`'s 40 contrast assertions guarded a surface axe had
 * never looked at. Now that an agent can choose it, it is measured: contrast is
 * a property of the rendered pair, and a token ramp that satisfies AA on its own
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
 *
 * **Interaction states, since tm 123.** Every scan above reads a page nobody is
 * touching, and until now that was the whole suite: `focus` and `hover` matched
 * zero times in this file. So the focus ring and the hover colours — states a
 * keyboard user is in for the entire session — had never been measured, at any
 * level. The three `focus and hover` tests below put controls into those states
 * and then measure, and because axe has no rule for focus-indicator contrast
 * (the ring is not text) the ring itself is measured directly against what is
 * painted behind it, to the 3:1 of WCAG 1.4.11. `a11y.ts` carries the reasoning.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  request as newApiContext,
  type APIRequestContext,
  type Locator,
  type Page,
  type TestInfo,
} from '@playwright/test';
import type { Result as AxeViolation } from 'axe-core';
import {
  assertFocusRingVisible,
  assertNoBlockingViolations,
  contrastRatio,
  describeFocusRing,
  measureFocusRing,
  NON_TEXT_CONTRAST_MIN,
  partitionViolations,
  scanScreen,
} from './a11y.js';
import {
  ACME_OWNER,
  API_BASE,
  DEMO,
  expect,
  openWidget,
  ownerAccessTokenFor,
  signUpFreshOwner,
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

/**
 * An *active* conversation for the composer scan, and its id.
 *
 * The composer only renders its mode tabs on an active chat — an archived one
 * replaces the whole control with "This conversation is archived. Reopen it to
 * reply." — and the seeded inbox is mostly archive: on the run that first
 * exposed this it was 27 of 28, and the All view opened on an archived one. A
 * scan that clicked "the first conversation" would therefore have measured the
 * archived notice and reported it green, which is the same class of blind spot
 * this test exists to close.
 *
 * Started through the Agent Chat API rather than the browser, and returned by
 * id so the scan can deep-link to it (`?chat=`) instead of depending on where
 * some view happens to sort it. Idempotent by the one-active-chat invariant:
 * `POST /chats` hands back the customer's existing active chat with a 200
 * rather than failing, so re-runs neither accumulate chats nor race the specs
 * that create their own.
 */
async function ensureActiveChat(api: APIRequestContext, token: string): Promise<string> {
  const customers = await api.get(`${API_BASE}/customers?segment=all&limit=1`, auth(token));
  expect(customers.ok(), `list customers failed: ${customers.status()}`).toBe(true);
  const { items } = (await customers.json()) as { items: Array<{ id: string }> };
  expect(items[0], 'seeded tenant has no customers to open a chat with').toBeDefined();

  const started = await api.post(`${API_BASE}/chats`, {
    ...auth(token),
    data: { customer_id: items[0]!.id, assign_to_me: true },
  });
  expect(started.ok(), `start chat failed: ${started.status()} ${await started.text()}`).toBe(true);
  const chat = (await started.json()) as { id: string; active: boolean };
  expect(chat.active, 'the chat the composer scan opens must be active').toBe(true);
  return chat.id;
}

/**
 * A live `/join` link the way it reaches an invitee's inbox: the raw token
 * only ever appears in this create response (`account-lifecycle.ts` — the
 * list endpoint returns none, since only the hash is stored). The invitee's
 * address is fixed and re-invited on every run rather than minted fresh: the
 * insert upserts on `(license_id, email)` for an unaccepted invitation, so
 * this never accumulates rows the way a `Date.now()` email would.
 *
 * Scans the `needs_password` branch — a brand-new address — because that is
 * the fuller form (name + password, two labelled fields); an already-known
 * address renders a one-line notice instead and shares its markup with the
 * other `AuthCard` screens already in this file.
 */
async function ensureJoinInvitation(api: APIRequestContext, ownerToken: string): Promise<string> {
  const created = await api.post(`${API_BASE}/invitations`, {
    ...auth(ownerToken),
    data: { emails: ['a11y-join@nexa.test'], role: 'agent' },
  });
  expect(created.ok(), `invite failed: ${created.status()} ${await created.text()}`).toBe(true);
  const { items } = (await created.json()) as { items: Array<{ accept_url: string }> };
  const token = new URL(items[0]!.accept_url).searchParams.get('token');
  expect(token, 'invitation accept_url carried no token').toBeTruthy();
  return token!;
}

/** The active chat the composer scan deep-links to (`ensureActiveChat`). */
let activeChatId: string;
/** The invitation token the join-page scan deep-links to (`ensureJoinInvitation`). */
let joinToken: string;
/** An owner Bearer token, for the skill-editor scan's own cleanup (no delete UI exists). */
let ownerToken: string;

test.beforeAll(async () => {
  apiCtx = await newApiContext.newContext({
    extraHTTPHeaders: { 'user-agent': 'nexa-e2e-a11y' },
  });
  const token = await ownerAccessTokenFor(apiCtx, ACME_OWNER);
  ownerToken = token;
  await ensurePublishedArticle(apiCtx, token);
  activeChatId = await ensureActiveChat(apiCtx, token);
  joinToken = await ensureJoinInvitation(apiCtx, token);
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

/** A control to put into an interaction state, named for the failure message. */
interface StateTarget {
  name: string;
  find: (page: Page) => Locator;
}

/**
 * Fill the sign-in form without submitting it.
 *
 * Needed because the submit button is `disabled` until both fields validate, and
 * a disabled control cannot be focused at all — so the screen's primary button
 * is unreachable to any state measurement while the form is empty. The
 * credentials are the seeded demo ones and are never sent: nothing here clicks.
 */
async function fillSignInForm(page: Page): Promise<void> {
  await page.getByLabel('Email').fill(DEMO.email);
  await page.getByLabel('Password').fill(DEMO.password);
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeEnabled();
}

/**
 * Focus a control the way a keyboard user reaches it.
 *
 * The `Tab` is not decoration. Chromium decides `:focus-visible` from the
 * document's "last interaction was a key" flag, which a click clears and a
 * keypress sets — so focusing straight after the sign-in *click* that
 * `agentPage` performs would land the control in plain `:focus`, paint no ring,
 * and hand back a measurement of the wrong state. Pressing `Tab` first restores
 * keyboard modality; `.focus()` then lands on the exact control instead of
 * wherever the tab order happens to go, which keeps the target stable as screens
 * gain and lose controls. `measureFocusRing` re-checks `:focus-visible` at read
 * time, so if this heuristic ever stops holding the suite says so rather than
 * quietly measuring nothing.
 */
async function focusWithKeyboard(page: Page, locator: Locator): Promise<void> {
  await page.keyboard.press('Tab');
  await locator.focus();
  await expect(locator).toBeFocused();
}

/**
 * Render the interaction states on one screen, then measure both halves.
 *
 * Focus and hover are asserted *together*, in one scan: the last focus target
 * stays focused while the pointer rests on the hover target, so the axe pass
 * grades a page carrying both states at once — which is what a real screen looks
 * like mid-interaction and is strictly more than either state alone.
 */
async function scanInteractionStates(
  page: Page,
  screen: string,
  theme: PanelTheme,
  testInfo: TestInfo,
  targets: { focus: readonly StateTarget[]; hover: StateTarget },
): Promise<void> {
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);

  for (const target of targets.focus) {
    const control = target.find(page);
    await expect(control).toBeVisible();
    await focusWithKeyboard(page, control);

    const ring = await measureFocusRing(`${screen} (${theme})`, target.name, control);
    // The measurement is the deliverable, same as `summariseScan` — it has to
    // reach the run log so the ratios can be read off a plain `test:e2e`.
    console.log(describeFocusRing(ring));
    assertFocusRingVisible(ring);
  }

  const hovered = targets.hover.find(page);
  await expect(hovered).toBeVisible();
  await hovered.hover();

  // The pointer moving does not blur anything, so the page is now focused *and*
  // hovered. Proved rather than assumed: a scan of a state that silently ended
  // is the failure this whole file exists to rule out.
  const stillFocused = targets.focus[targets.focus.length - 1]!.find(page);
  await expect(stillFocused).toBeFocused();

  assertNoBlockingViolations(await scanScreen(page, `${screen} focus+hover (${theme})`, testInfo));
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

      /**
       * The composer's "Internal note" tab, *selected*.
       *
       * Not reachable from the inbox scan above, and that is the whole point:
       * the inbox loads with no conversation open, and the composer — once one
       * is — defaults to `mode='all'`, where the note tab is plain
       * `text-content-secondary`. Its selected colours were therefore never in
       * the DOM when axe looked, so sixteen scans across tm 115 and tm 117
       * reported the inbox green while `bg-note` + literal `text-white`
       * measured 1.47:1 on the dark theme (tm 120). A scan is only evidence for
       * the states it actually renders; this one renders the state.
       */
      test('the selected internal-note tab has no serious or critical violations', async ({
        agentPage,
      }, testInfo) => {
        await pinTheme(agentPage, theme);
        // Deep-linked rather than clicked out of the list: `?chat=` opens this
        // exact conversation, so the scan cannot drift onto whichever one the
        // seed or an earlier spec left at the top (`ensureActiveChat`).
        await agentPage.goto(`/app/inbox?chat=${activeChatId}`);
        await scanPanel(agentPage, 'Inbox internal note', theme, testInfo, async () => {
          const noteTab = agentPage.getByRole('radio', { name: 'Internal note' });
          await expect(noteTab).toBeVisible();
          await noteTab.click();
          // Assert the selection took before scanning. An unselected tab is the
          // exact state that hid the defect, and a scan of it would read as a
          // clean pass for a pair that was never rendered.
          await expect(noteTab).toHaveAttribute('aria-checked', 'true');
          await expect(agentPage.getByText('Only your team will see this.')).toBeVisible();
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

      /**
       * Home + the three Engage tabs of Customers (Faz-4 K11 · tm 137.2).
       *
       * `a11y.spec.ts` had measured seven panel surfaces (tm 115/117) and the
       * pre-`/app` funnel (tm 137.1) but never the workspace landing dashboard or
       * three of Customers' four tabs — `/app/customers` (Contacts) was in the
       * loop since tm 115, `real-time`/`campaigns`/`goals` were not. Seeded Acme
       * has neither campaigns nor goals, so both list screens render in their
       * *empty* state with two identically-named "New …" buttons live at once
       * (the toolbar and the empty-state action) — `.first()` picks the toolbar
       * one deterministically rather than failing strict-mode on the ambiguity.
       */
      test('home has no serious or critical violations', async ({ agentPage }, testInfo) => {
        await pinTheme(agentPage, theme);
        await agentPage.goto('/app/home');
        await scanPanel(agentPage, 'Home', theme, testInfo, async () => {
          // The last section to render — its presence means the dashboard fetch
          // resolved, not just that the h1 painted before the loading skeleton.
          await expect(
            agentPage.getByRole('heading', { name: 'This week', level: 2 }),
          ).toBeVisible();
        });
      });

      test('customers real-time traffic has no serious or critical violations', async ({
        agentPage,
      }, testInfo) => {
        await pinTheme(agentPage, theme);
        await agentPage.goto('/app/customers/real-time');
        await scanPanel(agentPage, 'Customers real-time', theme, testInfo, async () => {
          await expect(agentPage.getByRole('tablist', { name: 'Traffic status' })).toBeVisible();
        });
      });

      test('customers campaigns has no serious or critical violations', async ({
        agentPage,
      }, testInfo) => {
        await pinTheme(agentPage, theme);
        await agentPage.goto('/app/customers/campaigns');
        await scanPanel(agentPage, 'Customers campaigns', theme, testInfo, async () => {
          await expect(
            agentPage.getByRole('button', { name: 'New campaign' }).first(),
          ).toBeVisible();
        });
      });

      // The create form, open — not reachable from the list scan above, the same
      // reason the composer's selected note tab (tm 120) needed its own scan.
      test('the campaign builder has no serious or critical violations', async ({
        agentPage,
      }, testInfo) => {
        await pinTheme(agentPage, theme);
        await agentPage.goto('/app/customers/campaigns');
        await scanPanel(agentPage, 'Campaign builder', theme, testInfo, async () => {
          await agentPage.getByRole('button', { name: 'New campaign' }).first().click();
          await expect(agentPage.getByRole('dialog', { name: 'New campaign' })).toBeVisible();
        });
      });

      test('customers goals has no serious or critical violations', async ({
        agentPage,
      }, testInfo) => {
        await pinTheme(agentPage, theme);
        await agentPage.goto('/app/customers/goals');
        await scanPanel(agentPage, 'Customers goals', theme, testInfo, async () => {
          await expect(agentPage.getByRole('button', { name: 'New goal' }).first()).toBeVisible();
        });
      });

      test('the goal create modal has no serious or critical violations', async ({
        agentPage,
      }, testInfo) => {
        await pinTheme(agentPage, theme);
        await agentPage.goto('/app/customers/goals');
        await scanPanel(agentPage, 'Goal create modal', theme, testInfo, async () => {
          await agentPage.getByRole('button', { name: 'New goal' }).first().click();
          await expect(agentPage.getByRole('dialog', { name: 'New goal' })).toBeVisible();
        });
      });

      /**
       * The last four module screens + two states beneath them (Faz-4 K11 ·
       * tm 137.3): Billing, Playbook, the audit trail behind Settings, and
       * Developers. `a11y.spec.ts` had measured the four other rail-adjacent
       * module screens (Customers/Reports/Team/Settings, tm 115/117) but never
       * these four.
       */
      test('billing has no serious or critical violations', async ({ agentPage }, testInfo) => {
        await pinTheme(agentPage, theme);
        await agentPage.goto('/app/billing');
        await scanPanel(agentPage, 'Billing', theme, testInfo, async () => {
          await expect(agentPage.getByRole('heading', { name: 'Billing', level: 1 })).toBeVisible();
          // Past the loading skeleton — the plan/seats card only renders once
          // the subscription fetch resolves.
          await expect(agentPage.getByRole('region', { name: 'Manage plan' })).toBeVisible();
        });
      });

      test('playbook has no serious or critical violations', async ({ agentPage }, testInfo) => {
        await pinTheme(agentPage, theme);
        await agentPage.goto('/app/playbook');
        await scanPanel(agentPage, 'Playbook', theme, testInfo, async () => {
          await expect(
            agentPage.getByRole('heading', { name: 'AI Agent', level: 1 }),
          ).toBeVisible();
          await expect(agentPage.getByRole('region', { name: 'Recommended skills' })).toBeVisible();
        });
      });

      // Not reachable from the scan above — the editor only renders once a
      // skill is selected, the same reason the campaign/goal builders each
      // needed their own scan. A skill is created fresh rather than reusing
      // the seeded "Where is my order" one: `playbook.spec.ts`'s template
      // flows mint their own skills sharing a near-identical name ("Where is
      // my order?"), and once the shared e2e database has accumulated a run
      // or two a substring filter could no longer tell the two apart. There
      // is no delete affordance in the UI, so the fresh skill is removed
      // through the API afterwards.
      test('the skill editor has no serious or critical violations', async ({
        agentPage,
      }, testInfo) => {
        await pinTheme(agentPage, theme);
        await agentPage.goto('/app/playbook');

        let skillId = '';
        try {
          await scanPanel(agentPage, 'Skill editor', theme, testInfo, async () => {
            const created = agentPage.waitForResponse(
              (response) =>
                response.url().endsWith('/skills') && response.request().method() === 'POST',
            );
            await agentPage.getByRole('button', { name: 'New skill' }).click();
            const skill = (await (await created).json()) as { id: string; name: string };
            skillId = skill.id;
            await expect(agentPage.getByRole('region', { name: skill.name })).toBeVisible();
          });
        } finally {
          if (skillId) await apiCtx.delete(`${API_BASE}/skills/${skillId}`, auth(ownerToken));
        }
      });

      test('audit log has no serious or critical violations', async ({ agentPage }, testInfo) => {
        await pinTheme(agentPage, theme);
        await agentPage.goto('/app/settings/audit-log');
        await scanPanel(agentPage, 'Audit log', theme, testInfo, async () => {
          await expect(
            agentPage.getByRole('heading', { name: 'Audit log', level: 1 }),
          ).toBeVisible();
          // Non-empty without seeding anything — the `agentPage` fixture's own
          // sign-in, moments before this test runs, is already in the trail
          // (settings.spec.ts precedent).
          await expect(agentPage.getByRole('table', { name: 'Audit log' })).toBeVisible();
        });
      });

      test('developers has no serious or critical violations', async ({ agentPage }, testInfo) => {
        await pinTheme(agentPage, theme);
        await agentPage.goto('/app/developers');
        await scanPanel(agentPage, 'Developers', theme, testInfo, async () => {
          await expect(
            agentPage.getByRole('heading', { name: 'Developers', level: 1 }),
          ).toBeVisible();
          await expect(agentPage.getByRole('tablist', { name: 'Developer portal' })).toBeVisible();
        });
      });

      // Not reachable from the scan above — the dialog only renders once
      // opened, the same reason the campaign/goal builders each needed their
      // own scan. Nothing is persisted: the form is never submitted.
      test('the register app dialog has no serious or critical violations', async ({
        agentPage,
      }, testInfo) => {
        await pinTheme(agentPage, theme);
        await agentPage.goto('/app/developers');
        await scanPanel(agentPage, 'Register app dialog', theme, testInfo, async () => {
          await agentPage.getByRole('button', { name: 'Register app' }).click();
          await expect(agentPage.getByRole('dialog', { name: 'Register app' })).toBeVisible();
        });
      });

      /**
       * The registration funnel + first-run wizard (Faz-4 K11 · tm 137.1).
       *
       * These five are the rest of the pre-`/app` surface: nobody reaches the
       * inbox without passing through at least sign-in, and a meaningful slice
       * of users pass through one of these instead — creating a workspace,
       * recovering a password, or accepting a teammate invite. `a11y.spec.ts`
       * had measured `Sign in` since tm 115 but never its four siblings, and
       * never the wizard every brand-new owner lands on straight after.
       */
      test('sign-up page has no serious or critical violations', async ({ page }, testInfo) => {
        await pinTheme(page, theme);
        await page.goto('/signup');
        await scanPanel(page, 'Sign up', theme, testInfo, async () => {
          await expect(page.getByRole('button', { name: 'Create workspace' })).toBeVisible();
        });
      });

      test('forgot-password page has no serious or critical violations', async ({
        page,
      }, testInfo) => {
        await pinTheme(page, theme);
        await page.goto('/forgot-password');
        await scanPanel(page, 'Forgot password', theme, testInfo, async () => {
          await expect(page.getByRole('button', { name: 'Send link' })).toBeVisible();
        });
      });

      test('reset-password page has no serious or critical violations', async ({
        page,
      }, testInfo) => {
        await pinTheme(page, theme);
        await page.goto('/reset-password');
        await scanPanel(page, 'Reset password', theme, testInfo, async () => {
          await expect(page.getByRole('button', { name: 'Set password' })).toBeVisible();
        });
      });

      // The `needs_password` branch (`ensureJoinInvitation`) — the fuller of
      // the two forms this screen renders, with two labelled fields.
      test('join page has no serious or critical violations', async ({ page }, testInfo) => {
        await pinTheme(page, theme);
        await page.goto(`/join?token=${joinToken}`);
        await scanPanel(page, 'Join', theme, testInfo, async () => {
          await expect(page.getByRole('button', { name: 'Join workspace' })).toBeVisible();
        });
      });

      // A signup of its own (`signUpFreshOwner`), not a deep link — the wizard
      // only ever renders for a workspace that has never finished setup, and
      // the seeded Acme tenant ships pre-onboarded.
      test('onboarding wizard has no serious or critical violations', async ({
        page,
      }, testInfo) => {
        await pinTheme(page, theme);
        await signUpFreshOwner(page);
        await scanPanel(page, 'Onboarding', theme, testInfo, async () => {
          await expect(page.getByRole('heading', { name: /Welcome/ })).toBeVisible();
        });
      });

      /**
       * The door, focused and hovered.
       *
       * A signed-out stranger on a keyboard sees this screen before any other,
       * and its submit button is the app's most-copied control shape — a solid
       * `bg-brand-500` fill with `hover:bg-brand-600`. Both states are rendered
       * here: the ring on the button and on the field, the hover on the button.
       */
      test('focus and hover states on the sign-in page have no serious or critical violations', async ({
        page,
      }, testInfo) => {
        await pinTheme(page, theme);
        await page.goto('/');
        await fillSignInForm(page);

        await scanInteractionStates(page, 'Sign in', theme, testInfo, {
          focus: [
            { name: 'Sign in button', find: (p) => p.getByRole('button', { name: 'Sign in' }) },
            { name: 'Email field', find: (p) => p.getByLabel('Email') },
          ],
          hover: {
            name: 'Sign in button',
            find: (p) => p.getByRole('button', { name: 'Sign in' }),
          },
        });
      });

      /**
       * The screen agents live in all day, with every backdrop a ring can land
       * on in one page.
       *
       * The rail is the interesting one: it is the single surface that does not
       * follow the theme (`--bg-rail` is near-black in both), so a ring tuned
       * against the light panel has to clear it there too. The composer supplies
       * the case that motivated the backdrop walk in `a11y.ts` — the selected
       * "Reply" tab is a solid brand fill, and a ring measured against the fill
       * rather than the surface behind it would read 1.00:1 and be wrong.
       */
      test('focus and hover states in the inbox have no serious or critical violations', async ({
        agentPage,
      }, testInfo) => {
        await pinTheme(agentPage, theme);
        // Same active chat the internal-note scan uses: the seeded All view opens
        // on an archived conversation, which renders no composer at all.
        await agentPage.goto(`/app/inbox?chat=${activeChatId}`);
        await expect(agentPage.getByRole('heading', { name: 'Inbox', level: 1 })).toBeVisible();
        await expect(agentPage.getByPlaceholder('Type your reply')).toBeVisible();

        await scanInteractionStates(agentPage, 'Inbox', theme, testInfo, {
          focus: [
            { name: 'Rail link (Inbox)', find: (p) => p.getByRole('link', { name: 'Inbox' }) },
            {
              name: 'Composer "Reply" tab (brand fill)',
              find: (p) => p.getByRole('radio', { name: 'Reply' }),
            },
            {
              name: 'Composer "Internal note" tab',
              find: (p) => p.getByRole('radio', { name: 'Internal note' }),
            },
            { name: 'Composer input', find: (p) => p.getByPlaceholder('Type your reply') },
          ],
          hover: {
            name: 'Conversation row',
            find: (p) =>
              p.getByRole('region', { name: 'Conversations' }).getByRole('button').first(),
          },
        });
      });

      /**
       * A dense table, where hover is load-bearing rather than cosmetic.
       *
       * Rows carry `hover:bg-surface-2` as their only affordance that they are
       * clickable, and the search box is one of the app's `outline-none` inputs —
       * between them this screen exercises both halves on colours the static
       * scans never see.
       */
      test('focus and hover states in the customers table have no serious or critical violations', async ({
        agentPage,
      }, testInfo) => {
        await pinTheme(agentPage, theme);
        await agentPage.goto('/app/customers');
        await expect(agentPage.getByRole('table', { name: 'Customers' })).toBeVisible();

        const firstRowControl = (p: Page): Locator =>
          p.getByRole('table', { name: 'Customers' }).getByRole('button').first();

        await scanInteractionStates(agentPage, 'Customers', theme, testInfo, {
          focus: [
            { name: 'Customer row control', find: firstRowControl },
            {
              name: 'Search box',
              find: (p) => p.getByRole('searchbox', { name: 'Search customers' }),
            },
          ],
          hover: { name: 'Customer row control', find: firstRowControl },
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
   * Pins the doc-comment's "every `/app/*` route" claim to the router itself
   * (Faz-4 K11 · tm 137.3) — otherwise the surface count above is just a
   * comment nothing checks, and 137.1/137.2/137.3 each closing their slice of
   * routes by hand is exactly how seven of thirteen went unmeasured for as
   * long as they did (§D113). `App.tsx`'s only paired `<Route>...</Route>` is
   * the `AppShell` one — every route it nests is a plain self-closing
   * `<Route path="…" />`, including the index redirect, which carries no
   * `path` attribute at all and so is not picked up. A route added to
   * `AppShell` without a matching entry in `SCANNED_APP_ROUTES` — or a scan
   * removed without the route going with it — fails this rather than quietly
   * drifting.
   *
   * `/app/onboarding` is excluded on purpose: it lives outside the `AppShell`
   * tree entirely (App.tsx's separate onboarding-gate branch, reached only
   * while `onboarding_completed` is false) and is scanned above through a
   * fresh signup rather than a `goto`.
   */
  test('the axe suite scans every /app/* route App.tsx defines', () => {
    const appTsxSource = readFileSync(
      path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/src/App.tsx'),
      'utf-8',
    );
    const shellBlock = /<Route path="\/app" element=\{<AppShell \/>\}>([\s\S]*?)<\/Route>/.exec(
      appTsxSource,
    );
    expect(shellBlock, 'App.tsx no longer nests routes the way this pin expects').toBeTruthy();

    const definedRoutes = [...shellBlock![1]!.matchAll(/<Route path="([^"]+)"/g)]
      .map((match) => `/app/${match[1]}`)
      .sort();

    const SCANNED_APP_ROUTES = [
      '/app/home',
      '/app/inbox',
      '/app/customers',
      '/app/customers/campaigns',
      '/app/customers/goals',
      '/app/customers/real-time',
      '/app/team',
      '/app/reports',
      '/app/billing',
      '/app/playbook',
      '/app/settings',
      '/app/settings/audit-log',
      '/app/apps',
      '/app/developers',
    ].sort();

    expect(definedRoutes).toEqual(SCANNED_APP_ROUTES);
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

  /**
   * The focus-ring gate's own test — the same proof, for the half axe cannot do.
   *
   * A measurement nobody has ever seen fail is not a gate: `measureFocusRing`
   * could read the wrong element, miss `:focus-visible`, or resolve a backdrop
   * that is never painted, and every one of those returns a comfortable ratio
   * that reads exactly like a conforming ring. So the ring is broken on purpose,
   * in the two ways a real one breaks, and the gate is asserted to fire on both:
   *
   *   1. painted in the colour of what is behind it — the 1.4.11 failure, which
   *      is what a designer produces by picking the ring off the palette
   *      without checking it against the surface;
   *   2. not painted at all (`outline: none`) — the older and commoner defect,
   *      and the one 79 `outline-none` call sites in this app are one cascade
   *      change away from.
   *
   * Both are injected into a real, rendered, focused control rather than
   * simulated, and the ratio is re-measured green afterwards so a probe that
   * simply broke the page for good cannot pass for a working gate.
   */
  test('the focus-ring gate fails on a ring that cannot be seen', async ({ page }) => {
    // Pure half first: the classification is decidable without a browser.
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#2d67fa', '#ffffff')).toBeGreaterThan(NON_TEXT_CONTRAST_MIN);
    expect(() =>
      assertFocusRingVisible({
        screen: 'Fixture',
        target: 'hand-built',
        focusVisible: false,
        ring: '#2d67fa',
        backdrop: '#ffffff',
        width: 2,
        style: 'solid',
        offset: 2,
        ratio: 4.74,
      }),
    ).toThrow(/never matched/);

    await page.goto('/');
    await fillSignInForm(page);
    const button = page.getByRole('button', { name: 'Sign in' });
    await focusWithKeyboard(page, button);

    const healthy = await measureFocusRing('Gate probe', 'Sign in button', button);
    console.log(describeFocusRing(healthy));
    assertFocusRingVisible(healthy);

    // (1) Repaint the ring in exactly the colour the measurement found behind
    // it. `!important` because `[data-theme]` outranks a plain `:root` and this
    // has to hold on whichever theme the run picked up.
    const sameAsBackdrop = await page.addStyleTag({
      content: `:root { --focus-ring: ${healthy.backdrop} !important; }`,
    });
    const invisible = await measureFocusRing(
      'Gate probe',
      'Sign in button (ring = backdrop)',
      button,
    );
    console.log(describeFocusRing(invisible));
    expect(invisible.focusVisible, 'the probe must still be measuring a focused control').toBe(
      true,
    );
    expect(invisible.ratio).toBeLessThan(NON_TEXT_CONTRAST_MIN);
    expect(() => assertFocusRingVisible(invisible)).toThrow(/cannot be seen/);
    await sameAsBackdrop.evaluate((tag) => tag.parentNode?.removeChild(tag));

    // (2) Remove the indicator outright, the way `outline-none` does.
    const removed = await page.addStyleTag({
      content: ':focus-visible { outline: none !important; }',
    });
    const missing = await measureFocusRing('Gate probe', 'Sign in button (no outline)', button);
    console.log(describeFocusRing(missing));
    expect(missing.style, 'a removed indicator is `outline-style: none`').toBe('none');
    // And its *colour* still measures comfortably — `outline-color` falls back to
    // `currentcolor`, so the ratio alone reports a healthy ring on a control that
    // draws none. That is exactly why the assertion looks at the style too, and
    // why a gate built on the ratio by itself would have passed this.
    expect(missing.ratio).toBeGreaterThan(NON_TEXT_CONTRAST_MIN);
    expect(() => assertFocusRingVisible(missing)).toThrow(/draws no focus indicator/);
    await removed.evaluate((tag) => tag.parentNode?.removeChild(tag));

    // Green again — otherwise the two failures above prove only that the page
    // is broken, not that the measurement tracks it.
    const recovered = await measureFocusRing('Gate probe', 'Sign in button (restored)', button);
    console.log(describeFocusRing(recovered));
    assertFocusRingVisible(recovered);
    expect(recovered.ratio).toBeCloseTo(healthy.ratio, 2);
  });
});
