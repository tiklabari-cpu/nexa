/**
 * The widget's human check and its setting in the console (tm 339.3 · GV-01 3/3).
 *
 * A normal visitor is never asked (the risk thresholds are 1 000 000 on this
 * stack); a workspace that chose "before every new conversation" asks the
 * visitor once, with the mock provider's checkbox — no frame, no Cloudflare —
 * and does not ask again after they pass.
 *
 * Run against a second brand on a subdomain of its own, like the pre-chat
 * spec: the default brand — the one every other spec's visitor is on — keeps
 * its "only when something looks wrong" mode. The brand and its website are
 * removed again whatever the outcome.
 */
import {
  API_BASE,
  expect,
  introduceVisitor,
  ownerAccessToken,
  tenantSubdomain,
  test,
  widgetFrame,
} from './fixtures.js';

test.describe('human check in the widget (GV-01)', () => {
  test('a visitor is asked once before the first message, and not again after passing', async ({
    browser,
    request,
    organizationId,
  }) => {
    test.slow();
    const stamp = Date.now().toString().slice(-6);
    const auth = { authorization: `Bearer ${await ownerAccessToken(request)}` };
    const site = tenantSubdomain(`challenge-${stamp}`);
    let brandId: string | null = null;
    let websiteId: string | null = null;

    try {
      const brand = await request.post(`${API_BASE}/brands`, {
        headers: auth,
        data: { name: `Challenge ${stamp}`, slug: `challenge-${stamp}` },
      });
      expect(brand.status(), await brand.text()).toBe(201);
      brandId = ((await brand.json()) as { id: string }).id;
      const brandAuth = { ...auth, 'x-siyahtus-brand': brandId };
      const website = await request.post(`${API_BASE}/websites`, {
        headers: brandAuth,
        data: { domain: site.hostname },
      });
      expect(website.status(), await website.text()).toBe(201);
      websiteId = ((await website.json()) as { id: string }).id;
      const saved = await request.patch(`${API_BASE}/settings/security`, {
        headers: brandAuth,
        data: { captcha_mode: 'always_on_chat_start' },
      });
      expect(saved.status(), await saved.text()).toBe(200);

      const context = await browser.newContext();
      try {
        const page = await context.newPage();
        const events: Array<Record<string, unknown>> = [];
        const statuses: number[] = [];
        page.on('request', (r) => {
          if (r.url().includes('/customer/chat/events') && r.method() === 'POST') {
            events.push(r.postDataJSON() as Record<string, unknown>);
          }
        });
        page.on('response', (r) => {
          if (r.url().includes('/customer/chat/events') && r.request().method() === 'POST') {
            statuses.push(r.status());
          }
        });
        await page.goto(`${site.origin}/demo.html?organization_id=${organizationId}`);
        const frame = widgetFrame(page);
        await frame.getByRole('button', { name: 'Open chat' }).click();

        // Opening the panel asks nothing: the mint is not the gate in this mode.
        await expect(frame.getByRole('button', { name: 'Start chat' })).toBeVisible();
        await expect(frame.getByRole('group', { name: 'Quick check' })).toBeHidden();

        // --- The first message opens a conversation: the check comes first.
        const first = `Merhaba, kargom nerede ${stamp}`;
        await introduceVisitor(frame, first);
        const check = frame.getByRole('group', { name: 'Quick check' });
        await expect(check).toBeVisible();
        await expect(check.getByText('Please confirm you are a person to continue.')).toBeVisible();
        // The panel is the check's alone while it is up, and nothing left the page.
        await expect(frame.getByRole('textbox', { name: 'Message', exact: true })).toBeHidden();
        expect(statuses).toEqual([403]);
        expect(events[0]).not.toHaveProperty('challenge_token');
        await page.screenshot({ path: 'kanit/gv-01-widget-challenge.png' });

        // A keyboard reaches the box and ticks it.
        const tick = check.getByRole('checkbox', { name: 'I am not a robot' });
        await tick.focus();
        await page.keyboard.press('Space');

        await expect(check).toBeHidden();
        await expect(frame.getByRole('log', { name: 'Conversation' })).toContainText(first);
        // The bubble is optimistic: the responses are what prove the send landed.
        await expect.poll(() => statuses).toEqual([403, 201]);
        expect(events[1]).toMatchObject({ text: first, challenge_token: 'mock-captcha-pass' });
        // The same message and key: one conversation, however many rounds.
        expect(events[1]!['idempotency_key']).toBe(events[0]!['idempotency_key']);

        // --- Passed: the next message is not asked for a check again.
        const second = `Teşekkürler ${stamp}`;
        await frame.getByRole('textbox', { name: 'Message', exact: true }).fill(second);
        await frame.getByRole('button', { name: 'Send' }).click();
        await expect(frame.getByRole('log', { name: 'Conversation' })).toContainText(second);
        await expect(check).toBeHidden();
        await expect.poll(() => statuses).toEqual([403, 201, 201]);
        expect(events[2]).not.toHaveProperty('challenge_token');
      } finally {
        await context.close();
      }
    } finally {
      if (websiteId) {
        await request.delete(`${API_BASE}/websites/${websiteId}`, {
          headers: { ...auth, ...(brandId ? { 'x-siyahtus-brand': brandId } : {}) },
        });
      }
      if (brandId) await request.delete(`${API_BASE}/brands/${brandId}`, { headers: auth });
    }
  });

  test('declining the check keeps the message and starts nothing', async ({
    browser,
    request,
    organizationId,
  }) => {
    test.slow();
    const stamp = Date.now().toString().slice(-6);
    const auth = { authorization: `Bearer ${await ownerAccessToken(request)}` };
    const site = tenantSubdomain(`decline-${stamp}`);
    let brandId: string | null = null;
    let websiteId: string | null = null;

    try {
      const brand = await request.post(`${API_BASE}/brands`, {
        headers: auth,
        data: { name: `Decline ${stamp}`, slug: `decline-${stamp}` },
      });
      expect(brand.status(), await brand.text()).toBe(201);
      brandId = ((await brand.json()) as { id: string }).id;
      const brandAuth = { ...auth, 'x-siyahtus-brand': brandId };
      const website = await request.post(`${API_BASE}/websites`, {
        headers: brandAuth,
        data: { domain: site.hostname },
      });
      expect(website.status(), await website.text()).toBe(201);
      websiteId = ((await website.json()) as { id: string }).id;
      const saved = await request.patch(`${API_BASE}/settings/security`, {
        headers: brandAuth,
        data: { captcha_mode: 'always_on_chat_start' },
      });
      expect(saved.status(), await saved.text()).toBe(200);

      const context = await browser.newContext();
      try {
        const page = await context.newPage();
        await page.goto(`${site.origin}/demo.html?organization_id=${organizationId}`);
        const frame = widgetFrame(page);
        await frame.getByRole('button', { name: 'Open chat' }).click();
        await introduceVisitor(frame, `Vazgeçeceğim ${stamp}`);
        const check = frame.getByRole('group', { name: 'Quick check' });
        await expect(check).toBeVisible();

        await check.getByRole('button', { name: 'Not now' }).click();
        await expect(check).toBeHidden();
        await expect(
          frame.getByText('We could not confirm you are a person. Please try again.'),
        ).toBeVisible();
        await expect(frame.getByRole('textbox', { name: 'Message', exact: true })).toHaveValue(
          `Vazgeçeceğim ${stamp}`,
        );
      } finally {
        await context.close();
      }
    } finally {
      if (websiteId) {
        await request.delete(`${API_BASE}/websites/${websiteId}`, {
          headers: { ...auth, ...(brandId ? { 'x-siyahtus-brand': brandId } : {}) },
        });
      }
      if (brandId) await request.delete(`${API_BASE}/brands/${brandId}`, { headers: auth });
    }
  });
});

test.describe('abuse protection in the console (GV-01)', () => {
  test('the owner reads the allowance and the mode, and a change reaches the server', async ({
    agentPage,
    request,
  }) => {
    const auth = { authorization: `Bearer ${await ownerAccessToken(request)}` };
    const read = async (): Promise<Record<string, unknown>> => {
      const response = await request.get(`${API_BASE}/settings/security`, { headers: auth });
      expect(response.status(), await response.text()).toBe(200);
      return (await response.json()) as Record<string, unknown>;
    };
    const before = await read();

    try {
      await agentPage.goto('/app/settings/abuse-protection');
      await expect(
        agentPage.getByRole('heading', { name: 'Abuse protection', level: 2 }),
      ).toBeVisible();
      await expect(agentPage.getByLabel('AI replies per visitor per day')).toHaveValue(
        String(before['ai_turns_per_customer_day']),
      );
      // Today's use of the allowance: counts for the owner, nothing else.
      const quota = agentPage.getByRole('region', { name: 'AI allowance today' });
      await expect(quota).toBeVisible();
      await expect(quota.getByText('Allowance per visitor')).toBeVisible();
      await agentPage.screenshot({ path: 'kanit/gv-01-abuse-protection.png', fullPage: true });

      await agentPage.getByLabel('AI replies per visitor per day').fill('25');
      await agentPage.getByRole('radio', { name: /Never ask/ }).check();
      await agentPage.getByRole('button', { name: 'Save' }).click();
      await expect
        .poll(async () => {
          const now = await read();
          return [now['ai_turns_per_customer_day'], now['captcha_mode']];
        })
        .toEqual([25, 'off']);

      // It survives a reload: the screen reads what the server holds.
      await agentPage.reload();
      await expect(agentPage.getByLabel('AI replies per visitor per day')).toHaveValue('25');
      await expect(agentPage.getByRole('radio', { name: /Never ask/ })).toBeChecked();
    } finally {
      // The default brand keeps the mode and allowance every other spec expects.
      await request.patch(`${API_BASE}/settings/security`, {
        headers: auth,
        data: {
          ai_turns_per_customer_day: before['ai_turns_per_customer_day'],
          captcha_mode: before['captcha_mode'],
        },
      });
    }
  });
});
