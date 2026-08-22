/**
 * Command palette (⌘K) — content search and route jumping (FR-MOD-01.1.3).
 *
 * The web unit suite drives the palette's mechanics (open/close, keyboard,
 * scope gating, optimistic rollback) against a stubbed API. What only a real
 * browser proves is that the keystroke opens it over a live session, that a
 * search hits the seeded data and returns the right people and conversations,
 * that choosing a result actually lands on that record — the deep link has to
 * survive the round trip through the target screen, not just be constructed —
 * and that an action chosen here reaches the server, not merely the store.
 */
import { request as newApiContext, type APIRequestContext, type Page } from '@playwright/test';

import { API_BASE, DEMO, expect, ownerAccessToken, test } from './fixtures.js';

/**
 * The demo agent's own row on the Team screen, and nothing else (tm 147).
 *
 * Scoped to the roster table on purpose. The Team screen renders a second
 * table above it — pending invitations — whose rows carry the *inviter's*
 * name in their "Invited by" column, so a page-wide
 * `getByRole('row').filter({ hasText: agentName })` matches the demo agent's
 * roster row *and* every invitation they sent. That is a strict-mode
 * violation, and it is not a hypothetical: `a11y.spec.ts` left one pending
 * invitation behind and took both availability tests here down with it, plus
 * `skills-routing.spec.ts` after them.
 *
 * The leak itself is fixed at its source, but the locator was fragile
 * independently of it: a workspace with a real outstanding invitation is a
 * perfectly ordinary product state, and this file has no business failing on
 * one.
 */
const rosterRow = (page: Page) =>
  page
    .getByRole('table', { name: 'Agents on this licence' })
    .getByRole('row')
    .filter({ hasText: DEMO.agentName });

/**
 * Availability, restored after every test in this file (tm 147).
 *
 * Two of them stop the demo agent accepting chats and turn it back on at the
 * end — which is exactly the wrong place for the restore to live, because a
 * test that fails in between never reaches it. That is what happened: one
 * assertion in the middle of the palette test failed, the agent stayed
 * refusing chats, and `skills-routing.spec.ts` then had no one to route to and
 * reported a routing defect that did not exist. One failing test should cost
 * one red, not three.
 *
 * Unconditional rather than conditional: `PUT /agents/me/routing-status` is
 * idempotent, and reading the status first only adds a request that can itself
 * be the thing that fails.
 *
 * The token is minted per teardown rather than once in `beforeAll`, because a
 * held one does not stay valid: an owner may hold 25 live sessions
 * (`MAX_ACTIVE_TOKENS_PER_OWNER`) and every signed-in test mints another, so a
 * setup token silently becomes a 401 partway down a long file. `a11y.spec.ts`
 * lost its cleanup to exactly that (tm 147), and this file has no reason to
 * repeat it for the sake of three saved requests.
 */
let apiCtx: APIRequestContext;

test.beforeAll(async () => {
  apiCtx = await newApiContext.newContext();
});

test.afterAll(async () => {
  await apiCtx?.dispose();
});

test.afterEach(async () => {
  const restored = await apiCtx.put(`${API_BASE}/agents/me/routing-status`, {
    headers: { authorization: `Bearer ${await ownerAccessToken(apiCtx)}` },
    data: { routing_status: 'accepting_chats' },
  });
  expect(
    restored.ok(),
    `could not put the demo agent back to accepting chats: ${restored.status()} ${await restored.text()}`,
  ).toBe(true);
});

test.describe('command palette', () => {
  test('searches the workspace and opens the chosen record', async ({ agentPage }) => {
    // Opens from wherever the agent is — here, the inbox.
    await agentPage.keyboard.press('ControlOrMeta+k');
    const palette = agentPage.getByRole('dialog', { name: 'Command palette' });
    await expect(palette).toBeVisible();

    const input = palette.getByRole('combobox', { name: 'Search or jump to' });
    await input.fill('Alex');

    // A single query reaches across resources: Alex is a seeded customer with a
    // conversation, so both the person and the chat surface under their groups.
    await expect(palette.getByRole('option', { name: /Alex Moreau/ }).first()).toBeVisible();
    await agentPage.screenshot({ path: 'kanit/18-command-palette.png', fullPage: true });

    // Choosing the customer opens their record on the Customers screen — the
    // deep link is honoured by the page, not just formed by the palette.
    await palette.getByRole('option', { name: /alex@acme-customer/ }).click();
    await expect(agentPage.getByRole('heading', { name: 'Customers', level: 1 })).toBeVisible();
    await expect(agentPage.getByRole('heading', { name: 'Alex Moreau', level: 2 })).toBeVisible();
    await expect(palette).toBeHidden();
  });

  test('jumps straight to a module by name', async ({ agentPage }) => {
    await agentPage.keyboard.press('ControlOrMeta+k');
    const input = agentPage.getByRole('combobox', { name: 'Search or jump to' });
    await input.fill('Report');

    await agentPage.getByRole('option', { name: /Reports/ }).click();
    await expect(agentPage.getByRole('heading', { name: 'Reports', level: 1 })).toBeVisible();
    await expect(agentPage.getByRole('dialog', { name: 'Command palette' })).toBeHidden();
  });

  /**
   * The action result type, end to end (FR-MOD-01.1.3, FR-EK-A.2).
   *
   * The web suite proves the palette sends the right request and rolls back a
   * refused one against a stub. What only a real stack proves is that the write
   * actually reached the server: availability decides whether the router hands
   * this agent work, so a toggle that updated nothing but the local store would
   * look identical in the browser and be wrong everywhere that matters. The
   * Team screen reads it back over the API — a different session's view of the
   * same agent — which is why the assertion lives there rather than on the
   * availability control the action itself drove.
   *
   * It toggles back before finishing. The suite shares one seed and runs
   * serially, and a specification that leaves the demo agent refusing chats
   * breaks the routing flows that come after it.
   */
  test('stops and restarts accepting chats, and the Team screen agrees', async ({ agentPage }) => {
    const palette = agentPage.getByRole('dialog', { name: 'Command palette' });

    await agentPage.keyboard.press('ControlOrMeta+k');
    await agentPage.getByRole('combobox', { name: 'Search or jump to' }).fill('accepting');
    await agentPage.getByRole('option', { name: 'Stop Accepting Chats' }).click();

    // The palette gets out of the way rather than holding the keyboard over a
    // request it has already shown the result of.
    await expect(palette).toBeHidden();

    await agentPage.getByRole('link', { name: 'Team' }).click();
    await expect(agentPage.getByRole('heading', { name: 'Team', level: 1 })).toBeVisible();
    const me = rosterRow(agentPage);
    await expect(me).toContainText('Not accepting');
    await agentPage.screenshot({ path: 'kanit/95-palette-action.png', fullPage: true });

    // Back on: the entry relabels itself from the status it just wrote, so the
    // same search now offers the opposite action.
    await agentPage.keyboard.press('ControlOrMeta+k');
    await agentPage.getByRole('combobox', { name: 'Search or jump to' }).fill('accepting');
    await agentPage.getByRole('option', { name: 'Start Accepting Chats' }).click();
    await expect(palette).toBeHidden();

    await agentPage.reload();
    await expect(rosterRow(agentPage)).toContainText('Accepting chats');
  });

  /**
   * The acceptance criterion, in one session (FR-MOD-01.1.3, NFR-A11Y6).
   *
   * The criterion names three result kinds — an action, a destination and an
   * AI question — plus the placeholder and ↑↓/esc. The tests above each prove
   * one kind well, and that is exactly what leaves the criterion unproven: it
   * is a claim about one palette, and a palette that could do any one of the
   * three per page load would satisfy all of them separately and still fail
   * the thing being asked. So this runs the whole criterion through a single
   * signed-in session, on the keyboard alone, in the order an agent would
   * meet it — jump somewhere, do something, ask something, get out.
   *
   * It leaves availability as it found it. The suite shares one seed and runs
   * serially, so an agent left refusing chats breaks the routing flows that
   * come after this file.
   */
  test('proves all three result kinds — navigate, act, ask — in one session', async ({
    agentPage,
  }) => {
    // Four palette round trips and a reload, against live servers.
    test.slow();

    const palette = agentPage.getByRole('dialog', { name: 'Command palette' });
    const input = agentPage.getByRole('combobox', { name: 'Search or jump to' });
    const openPalette = async (): Promise<void> => {
      await agentPage.keyboard.press('ControlOrMeta+k');
      await expect(palette).toBeVisible();
    };

    // ── Opens, and says what it is for ──────────────────────────────────────
    await openPalette();
    await expect(input).toHaveAttribute('placeholder', 'Search Text or go to…');

    // ── ↑↓ walk the list and wrap at both ends ──────────────────────────────
    // Asserted on the empty query on purpose: with nothing typed the palette
    // fires no searches, so the row set is fixed and the highlight cannot be
    // reset out from under the keystroke by a reply arriving mid-assertion.
    // Park the pointer off the rows first: they also highlight on hover, and
    // the palette opens under wherever the mouse was left, so the starting
    // position is whatever the previous click happened to be over.
    await agentPage.mouse.move(0, 0);
    const rows = await palette.getByRole('option').count();
    expect(rows).toBeGreaterThan(1);
    const start = await input.getAttribute('aria-activedescendant');
    const startIndex = Number(start?.replace('command-option-', ''));

    // Walk up to the first row, wherever we came in…
    for (let i = 0; i < startIndex; i += 1) await agentPage.keyboard.press('ArrowUp');
    await expect(input).toHaveAttribute('aria-activedescendant', 'command-option-0');
    // …then one step past it, which lands on the last row rather than nothing.
    await agentPage.keyboard.press('ArrowUp');
    await expect(input).toHaveAttribute('aria-activedescendant', `command-option-${rows - 1}`);
    // And down from the last comes back around to the first.
    await agentPage.keyboard.press('ArrowDown');
    await expect(input).toHaveAttribute('aria-activedescendant', 'command-option-0');

    // ── Kind 1: navigation ──────────────────────────────────────────────────
    await input.fill('Reports');
    await expect(palette.getByRole('option', { name: /Reports/ })).toBeVisible();
    await agentPage.keyboard.press('Enter');
    await expect(agentPage.getByRole('heading', { name: 'Reports', level: 1 })).toBeVisible();
    await expect(palette).toBeHidden();

    // ── Kind 2: an action, which reaches the server ─────────────────────────
    await openPalette();
    await input.fill('accepting');
    await expect(palette.getByRole('option', { name: 'Stop Accepting Chats' })).toBeVisible();
    await agentPage.keyboard.press('Enter');
    await expect(palette).toBeHidden();

    // Read back through a different screen, over the API: a toggle that moved
    // only the local store would look identical here and be wrong everywhere
    // routing decisions are made.
    await agentPage.getByRole('link', { name: 'Team' }).click();
    await expect(rosterRow(agentPage)).toContainText('Not accepting');

    // Put it back before anything downstream depends on it.
    await openPalette();
    await input.fill('accepting');
    await agentPage.getByRole('option', { name: 'Start Accepting Chats' }).click();
    await expect(palette).toBeHidden();
    await agentPage.reload();
    await expect(rosterRow(agentPage)).toContainText('Accepting chats');

    // ── Kind 3: a question nothing else can answer ──────────────────────────
    // The criterion's own example. It matches no action, no module and no
    // record, which is precisely when the palette stops searching and offers
    // to ask instead.
    await openPalette();
    await input.fill("Summarize my team's activity");
    await expect(palette.getByRole('option', { name: /Ask AI/ })).toBeVisible();
    await agentPage.keyboard.press('Enter');

    // A real figure, computed by the same report builder the Reports screen
    // reads (ADR-09) — not a canned sentence — and the palette stays open to
    // show it, because closing over the answer would discard the reason the
    // question was asked.
    await expect(palette).toContainText(/handled \d+ chats? in this period/);
    await expect(palette).toContainText('Source: totals.chats');
    await agentPage.screenshot({ path: 'kanit/95-palette-ai-answer.png', fullPage: true });

    // ── And Escape ends it ──────────────────────────────────────────────────
    await agentPage.keyboard.press('Escape');
    await expect(palette).toBeHidden();
  });
});
