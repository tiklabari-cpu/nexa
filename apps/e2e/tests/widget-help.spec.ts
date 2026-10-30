/**
 * The widget's "Help" tab, end to end (WG-12 · tm 348).
 *
 * The API suite pins the search's rules against the real database — published
 * only, the token's workspace only, Turkish letters, one 404 for every miss —
 * and the widget unit suite pins the tab's screens. What only a browser over
 * both proves: a workspace turns the tab on in its widget settings, a visitor
 * opens the panel, searches "papara" and finds the published "Papara ile
 * yatırım" but not the draft beside it, reads the article inside the widget,
 * and is one click from a chat — the pre-chat form, on the article screen.
 *
 * Setup goes through the API like every spec here (fixtures.ts's rule), with a
 * stamp in each title so another run's articles cannot answer, and puts the
 * workspace back the way it found it: articles deleted, the tab off.
 */
import { API_BASE, expect, openWidget, ownerAccessToken, test, widgetFrame } from './fixtures.js';

test('a visitor finds a published article in the Help tab, never the draft, and starts a chat in one click', async ({
  browser,
  organizationId,
  request,
}) => {
  const stamp = Date.now().toString().slice(-6);
  const headers = { authorization: `Bearer ${await ownerAccessToken(request)}` };
  const created: string[] = [];

  async function article(title: string, slug: string, publish: boolean): Promise<void> {
    const res = await request.post(`${API_BASE}/kb-articles`, {
      headers,
      data: {
        title,
        slug,
        body: `## Adımlar\n\n- Kasiyer sayfasında **Papara** seçin.\n- Kod ${stamp} ile onaylayın.`,
      },
    });
    expect(res.ok(), `create article failed: ${res.status()} ${await res.text()}`).toBe(true);
    const { id } = (await res.json()) as { id: string };
    created.push(id);
    if (!publish) return;
    const published = await request.patch(`${API_BASE}/kb-articles/${id}`, {
      headers,
      data: { status: 'published' },
    });
    expect(published.ok(), `publish failed: ${published.status()}`).toBe(true);
  }

  const visitorContext = await browser.newContext();
  const visitor = await visitorContext.newPage();
  try {
    const on = await request.put(`${API_BASE}/settings/widget`, {
      headers,
      data: { help_enabled: true },
    });
    expect(on.ok(), `turning the Help tab on failed: ${on.status()} ${await on.text()}`).toBe(true);
    await article(`Papara ile yatırım ${stamp}`, `papara-ile-yatirim-${stamp}`, true);
    await article(`Papara taslak ${stamp}`, `papara-taslak-${stamp}`, false);

    await openWidget(visitor, organizationId);
    const frame = widgetFrame(visitor);
    await frame.getByRole('button', { name: 'Help' }).click();
    const help = frame.getByRole('region', { name: 'Help' });
    await help.getByRole('searchbox', { name: 'Search help articles' }).fill(`papara ${stamp}`);
    await help.getByRole('searchbox', { name: 'Search help articles' }).press('Enter');

    const hit = help.getByRole('button', { name: new RegExp(`Papara ile yatırım ${stamp}`) });
    await expect(hit).toBeVisible();
    await expect(
      help.getByRole('button', { name: new RegExp(`Papara taslak ${stamp}`) }),
    ).toHaveCount(0);
    await expect(help.locator('.nx-help-hit')).toHaveCount(1);

    await hit.click();
    await expect(help.getByRole('heading', { name: `Papara ile yatırım ${stamp}` })).toBeFocused();
    await expect(help.getByRole('listitem').filter({ hasText: `Kod ${stamp}` })).toBeVisible();
    await visitor.screenshot({ path: 'kanit/WG-12-widget-help.png' });

    // One click from the article: the conversation, the pre-chat form of a first visitor.
    await help.getByRole('button', { name: 'Start a chat' }).click();
    await expect(help).toHaveCount(0);
    await expect(frame.getByRole('button', { name: 'Start chat' })).toBeVisible();
  } finally {
    await visitorContext.close();
    for (const id of created) await request.delete(`${API_BASE}/kb-articles/${id}`, { headers });
    await request.put(`${API_BASE}/settings/widget`, { headers, data: { help_enabled: false } });
  }
});
