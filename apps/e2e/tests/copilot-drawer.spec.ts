/**
 * The Copilot drawer (IN-09 · tm 366.2): ask a question from any screen.
 *
 * The web suite pins the drawer against a stubbed API and the API suite pins
 * `POST /copilot/ask` against a real Postgres. What only a real browser over a
 * live stack proves is the seam between them: that Chromium leaves
 * Alt+Shift+C to the page on a Reports screen, that the drawer's question really
 * reaches the knowledge store and comes back naming the source, and that the
 * conversation outlives a move to another module but not a reload.
 */
import { API_BASE, expect, ownerAccessToken, test } from './fixtures.js';

test.describe('copilot drawer', () => {
  test('opens with the shortcut on Reports, answers from a knowledge source, keeps the conversation across pages and loses it on reload', async ({
    agentPage,
    request,
  }) => {
    const stamp = Date.now().toString().slice(-6);
    const name = `Papara limitleri ${stamp}`;
    const headers = { authorization: `Bearer ${await ownerAccessToken(request)}` };

    const created = await request.post(`${API_BASE}/copilot/knowledge`, {
      headers,
      data: {
        name,
        content: `Papara ile günlük çekim limiti 50.000 TL, tek seferde en fazla 10.000 TL çekilebilir. Kod ${stamp}.`,
      },
    });
    expect(
      created.ok(),
      `seeding the source failed: ${created.status()} ${await created.text()}`,
    ).toBe(true);
    const { id } = (await created.json()) as { id: string };

    try {
      await agentPage.goto('/app/reports');
      await expect(agentPage.getByRole('heading', { name: 'Reports', level: 1 })).toBeVisible();
      const drawer = agentPage.getByRole('complementary', { name: 'Ask Copilot' });
      await expect(drawer).toHaveCount(0);

      // --- the key opens it, with the cursor in the question box -----------------
      await agentPage.locator('main').click({ position: { x: 5, y: 5 } });
      await agentPage.keyboard.press('Alt+Shift+C');
      await expect(drawer).toBeVisible();
      const box = drawer.getByLabel('Your question');
      await expect(box).toBeFocused();

      // --- a knowledge question comes back with the source and its review date ---
      await box.fill('Papara çekim limiti ne kadar?');
      await box.press('Enter');
      const history = drawer.getByRole('log', { name: 'Copilot conversation' });
      await expect(history.getByText(name)).toBeVisible({ timeout: 30_000 });
      await expect(history.getByText(/Reviewed /).first()).toBeVisible();
      await agentPage.screenshot({ path: 'kanit/366-copilot-drawer.png', fullPage: true });

      // --- the page changes; the drawer and the conversation stay ----------------
      await agentPage.getByRole('link', { name: 'Inbox' }).click();
      await expect(agentPage).toHaveURL(/\/app\/inbox/);
      await expect(drawer).toBeVisible();
      await expect(history.getByText(name)).toBeVisible();
      await expect(history.getByText('Papara çekim limiti ne kadar?')).toBeVisible();

      // --- the key closes it from inside the box too -----------------------------
      await box.click();
      await agentPage.keyboard.press('Alt+Shift+C');
      await expect(drawer).toHaveCount(0);

      // --- a reload starts clean --------------------------------------------------
      await agentPage.keyboard.press('Alt+Shift+C');
      await expect(drawer).toBeVisible();
      await agentPage.reload();
      await expect(drawer).toHaveCount(0);
      await agentPage.locator('main').click({ position: { x: 5, y: 5 } });
      await agentPage.keyboard.press('Alt+Shift+C');
      await expect(drawer).toBeVisible();
      await expect(drawer.getByText(name)).toHaveCount(0);
    } finally {
      await request.delete(`${API_BASE}/copilot/knowledge/${id}`, { headers });
    }
  });

  test('a report question is answered with the Overview figure', async ({ agentPage }) => {
    await agentPage.goto('/app/reports');
    await expect(agentPage.getByRole('heading', { name: 'Reports', level: 1 })).toBeVisible();
    await agentPage.locator('main').click({ position: { x: 5, y: 5 } });
    await agentPage.keyboard.press('Alt+Shift+C');
    const drawer = agentPage.getByRole('complementary', { name: 'Ask Copilot' });
    await expect(drawer).toBeVisible();

    await drawer.getByLabel('Your question').fill('How many chats started this week?');
    await drawer.getByRole('button', { name: 'Ask', exact: true }).click();
    const history = drawer.getByRole('log', { name: 'Copilot conversation' });
    await expect(history.locator('[data-copilot-entry="ask"] p').nth(1)).toContainText(/\d/, {
      timeout: 30_000,
    });
    // An administrator may ask it: no refusal, and no source list (it is a figure).
    await expect(history.getByText('You are not allowed to ask this question.')).toHaveCount(0);
    await expect(history.getByText('Sources')).toHaveCount(0);
  });
});
