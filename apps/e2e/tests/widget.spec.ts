/**
 * The customer widget, exercised the way it ships: embedded in a third-party
 * page, inside a cross-origin iframe, across the postMessage boundary.
 *
 * These exist because that path was broken and nothing noticed. The loader
 * created the iframe with `allow-scripts` but no `allow-same-origin`, giving the
 * document an opaque origin — so every request it made carried `Origin: null`,
 * the API refused to mint a customer token, and the widget could not
 * authenticate at all. Unit tests passed (jsdom does not model origins) and the
 * integration tests passed (they call the API directly with a well-formed
 * origin). Only a real browser could see it.
 */
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { Locator, Page } from '@playwright/test';
import {
  expect,
  test,
  HOST_PAGE,
  API_BASE,
  WIDGET_ORIGIN,
  openWidget,
  ownerAccessToken,
  signIn,
  tenantSubdomain,
  visitorSends,
  widgetFrame,
} from './fixtures.js';
import { assertNoBlockingViolations, scanScreen } from './a11y.js';

const SAMPLE_PNG = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../fixtures/sample.png',
);

/**
 * Assert an `<img>` actually decoded, not just that its box exists. A broken
 * image still has a bounding box (its `alt` text), so `toBeVisible` alone would
 * pass on a 404 — `naturalWidth > 0` is the real proof the bytes rendered.
 */
async function imageRendered(image: Locator): Promise<void> {
  await expect(image).toBeVisible({ timeout: 20_000 });
  await expect
    .poll(() => image.evaluate((el) => (el as HTMLImageElement).naturalWidth), { timeout: 20_000 })
    .toBeGreaterThan(0);
}

/**
 * The widget lives in a cross-origin iframe whose transcript is rebuilt every
 * few seconds, so a `frameLocator` handle can go stale mid-swap. Reading the
 * live DOM through the Frame each poll avoids that — index picks which image
 * once there is more than one (the visitor's, then the agent's reply).
 */
async function widgetImageRendered(page: Page, index = 0): Promise<void> {
  await expect
    .poll(
      async () =>
        page.frame({ url: /widget\.html/ })?.evaluate((i) => {
          const img = document.querySelectorAll('img.nx-attachment-img')[i] as
            HTMLImageElement | undefined;
          return img?.naturalWidth ?? 0;
        }, index) ?? 0,
      { timeout: 20_000 },
    )
    .toBeGreaterThan(0);
}

test.describe('widget embedding', () => {
  test('mounts a cross-origin iframe on the host page', async ({ page, organizationId }) => {
    await page.goto(`${HOST_PAGE}/demo.html?organization_id=${organizationId}`);

    const frame = page.locator('#nexa-widget-frame');
    await expect(frame).toBeAttached();

    // Different origin from the host page — that difference *is* the isolation.
    const src = await frame.getAttribute('src');
    expect(src).toContain('http://localhost:5174/widget.html');
    expect(new URL(src!).origin).not.toBe(new URL(HOST_PAGE).origin);

    // The proactive greeting sizes the frame to fit its card. Dismiss it and the
    // closed widget shrinks back to the launcher — a full-size transparent iframe
    // would swallow clicks on the host page.
    await widgetFrame(page).getByRole('button', { name: 'Just browsing' }).click();
    await expect.poll(async () => (await frame.boundingBox())!.width).toBeLessThanOrEqual(100);
  });

  test('gives the iframe a real origin so it can authenticate', async ({
    page,
    organizationId,
  }) => {
    // The regression guard. `allow-same-origin` is what makes the document's
    // origin real; without it `self.origin` is the string "null" and the token
    // request is rejected.
    await page.goto(`${HOST_PAGE}/demo.html?organization_id=${organizationId}`);
    const sandbox = await page.locator('#nexa-widget-frame').getAttribute('sandbox');
    expect(sandbox).toContain('allow-same-origin');

    const frameOrigin = await page.frame({ url: /widget\.html/ })!.evaluate(() => self.origin);
    expect(frameOrigin).toBe('http://localhost:5174');
  });

  test('opens, resizes the frame, and closes again', async ({ page, organizationId }) => {
    await page.goto(`${HOST_PAGE}/demo.html?organization_id=${organizationId}`);
    const frameElement = page.locator('#nexa-widget-frame');
    const frame = widgetFrame(page);

    await frame.getByRole('button', { name: 'Open chat' }).click();
    await expect(frame.getByRole('textbox', { name: 'Message' })).toBeVisible();

    // The host page grows the frame only on a validated message from the widget.
    await expect.poll(async () => (await frameElement.boundingBox())!.width).toBeGreaterThan(300);

    await frame.getByRole('button', { name: 'Close chat' }).click();
    await expect.poll(async () => (await frameElement.boundingBox())!.width).toBeLessThan(150);
  });

  test('sends a message and keeps it after a reload', async ({ page, organizationId }) => {
    await openWidget(page, organizationId);
    const text = `Do you ship to Norway? ${Date.now().toString().slice(-6)}`;
    await visitorSends(page, text);

    // A returning visitor continues the same conversation — the customer id is
    // remembered, and the token is re-minted rather than reused.
    await page.reload();
    await widgetFrame(page).getByRole('button', { name: 'Open chat' }).click();
    await expect(widgetFrame(page).getByRole('log', { name: 'Conversation' })).toContainText(text);
  });

  /**
   * The tracking code (FR-MOD-13.5, 13.5-g) as a shop actually installs it: a
   * global the host page's own script calls, on a page where the visitor never
   * touches the chat.
   *
   * That last part is the whole point of the loader's command queue. A checkout
   * confirmation page fires this on load — the panel is closed, may never be
   * opened, and the frame is very likely still booting — so a call that was
   * dropped for arriving early, or that needed the panel open to mint a token,
   * would look exactly like a working integration and record nothing. The
   * conversation is held first so there is something for the order to be
   * credited to; attribution is what the report counts.
   */
  test('reports a sale from the host page with the chat panel never opened (13.5)', async ({
    page,
    request,
    organizationId,
  }) => {
    const stamp = Date.now().toString().slice(-6);
    const site = tenantSubdomain(`checkout-${stamp}`);
    const token = await ownerAccessToken(request);
    const AMOUNT_CENTS = 9_900;

    const trackedSales = async (): Promise<number> => {
      const response = await request.get(`${API_BASE}/reports/reviews`, {
        headers: { authorization: `Bearer ${token}` },
      });
      expect(response.ok(), `reviews report failed: ${response.status()}`).toBe(true);
      return ((await response.json()) as { ecommerce: { tracked_sales: number | null } }).ecommerce
        .tracked_sales!;
    };

    await openWidget(page, organizationId, { host: site.origin });
    await visitorSends(page, `Checking out now — ${stamp}`);
    const before = await trackedSales();

    // A fresh load of the shop's page: the panel is closed again and the loader
    // is booting from scratch, exactly as it would be on a confirmation page.
    await page.reload();

    // The global is exposed by the loader itself, independently of the widget
    // having booted — so a host page can call it as soon as the script has run.
    await page.waitForFunction(
      () => typeof (window as unknown as { nexa?: unknown }).nexa === 'function',
    );
    await page.evaluate(
      ({ orderId, amountCents }) => {
        (window as unknown as { nexa: (command: string, payload: unknown) => void }).nexa(
          'trackSale',
          { external_order_id: orderId, amount_cents: amountCents, currency: 'USD' },
        );
      },
      { orderId: `E2E-CHECKOUT-${stamp}`, amountCents: AMOUNT_CENTS },
    );

    // The order lands, credited to the conversation above — with the panel
    // still closed the whole time, which is the claim this test exists to make.
    await expect.poll(trackedSales, { timeout: 20_000 }).toBe(before + 1);
    await expect(widgetFrame(page).getByRole('textbox', { name: 'Message' })).not.toBeVisible();
  });
});

test.describe('chat page', () => {
  // FR-MOD-08.5.9: a hosted link runs the widget full-page — no launcher, no
  // iframe, no site install — and a conversation from it reaches the agent.
  test('a conversation from the hosted link reaches the agent', async ({
    browser,
    organizationId,
  }) => {
    const visitorContext = await browser.newContext();
    const agentContext = await browser.newContext();
    const visitor = await visitorContext.newPage();
    const agent = await agentContext.newPage();

    try {
      await signIn(agent);
      await agent.getByLabel('Availability').selectOption('accepting_chats');

      // The widget is the whole page here, addressed directly (not through the
      // `#nexa-widget-frame` iframe).
      await visitor.goto(`${WIDGET_ORIGIN}/chat.html?organization_id=${organizationId}`);
      const composer = visitor.getByRole('textbox', { name: 'Message' });
      await expect(composer).toBeVisible();

      const question = `From the hosted chat page — ${Date.now().toString().slice(-6)}`;
      await composer.fill(question);
      await visitor.getByRole('button', { name: 'Send' }).click();
      await expect(visitor.getByRole('log', { name: 'Conversation' })).toContainText(question);
      await visitor.screenshot({ path: 'kanit/9-chat-page.png', fullPage: true });

      const list = agent.getByRole('region', { name: 'Conversations' });
      await expect(list).toContainText(question, { timeout: 20_000 });
    } finally {
      await visitorContext.close();
      await agentContext.close();
    }
  });
});

test.describe('greeting', () => {
  // FR-MOD-11.2: a proactive card with two quick replies. "Let's chat" opens a
  // pre-chat form; "Just browsing" tucks it away and it must not nag again this
  // session. No campaigns or form-builder dependency — the form is fixed.
  test('greets proactively and opens a pre-chat form on "Let\'s chat"', async ({
    page,
    organizationId,
  }) => {
    await page.goto(`${HOST_PAGE}/demo.html?organization_id=${organizationId}`);
    const frame = widgetFrame(page);

    // Appears without the visitor clicking anything.
    await expect(frame.getByRole('button', { name: "Let's chat" })).toBeVisible();
    await page.screenshot({ path: 'kanit/12-greeting-card.png', fullPage: true });

    await frame.getByRole('button', { name: "Let's chat" }).click();
    await expect(frame.getByRole('textbox', { name: 'Your name' })).toBeVisible();
    await expect(frame.getByRole('button', { name: 'Start chat' })).toBeVisible();
    await page.screenshot({ path: 'kanit/12-prechat-form.png', fullPage: true });
  });

  test('"Just browsing" dismisses the card for the rest of the session', async ({
    page,
    organizationId,
  }) => {
    await page.goto(`${HOST_PAGE}/demo.html?organization_id=${organizationId}`);
    const frame = widgetFrame(page);

    await frame.getByRole('button', { name: 'Just browsing' }).click();
    await expect(frame.getByRole('button', { name: "Let's chat" })).toBeHidden();

    // The launcher is still there — dismissing the nudge is not closing the door.
    await expect(frame.getByRole('button', { name: 'Open chat' })).toBeVisible();

    // A reload must not bring the card back (sessionStorage remembers).
    await page.reload();
    await expect(widgetFrame(page).getByRole('button', { name: 'Open chat' })).toBeVisible();
    await expect(widgetFrame(page).getByRole('button', { name: "Let's chat" })).toBeHidden();
  });
});

test.describe('campaign card', () => {
  // FR-MOD-03.3.2 (tm 176.3): the whole chain — an owner's campaign, the
  // trigger engine matching a visitor already on the site (tm 176.1/.2 built
  // the migration and the delivery), and the widget's poll carrying it —
  // proven end to end by watching it reach a real, cross-origin visitor.
  //
  // Isolation is by host, like the goals suite: every other spec's visitor is
  // on `/demo.html`, so a trigger on a bare path would nudge them too.
  test('a campaign created after a visitor arrives reaches them as a proactive card, and opens the chat', async ({
    agentPage,
    browser,
    organizationId,
  }) => {
    test.slow();
    const stamp = Date.now().toString().slice(-6);
    const name = `Card nudge ${stamp}`;
    const message = `Still deciding? Ask us anything — ${stamp}`;
    const site = tenantSubdomain(`card-${stamp}`);

    const visitorContext = await browser.newContext();
    const visitor = await visitorContext.newPage();
    try {
      // --- The visitor arrives, talks, and leaves the conversation ---------
      await openWidget(visitor, organizationId, { host: site.origin });
      await visitorSends(visitor, `Just browsing — ${stamp}`);

      const frame = widgetFrame(visitor);
      await frame.getByRole('button', { name: 'More options' }).click();
      await frame.getByRole('menuitem', { name: 'End chat' }).click();
      await frame
        .getByRole('dialog', { name: 'End this chat?' })
        .getByRole('button', { name: 'End chat' })
        .click();
      await expect(frame.getByText('Chat ended.')).toBeVisible();

      // The card only ever occupies the closed, proactive slot — a chat left
      // open on screen is not where it belongs.
      await frame.getByRole('button', { name: 'Close chat' }).click();

      // --- The owner creates a campaign matching this visitor's site -------
      await agentPage.goto('/app/customers');
      await agentPage.getByRole('link', { name: 'Campaigns' }).click();
      await agentPage.getByRole('button', { name: 'New campaign' }).click();
      const dialog = agentPage.getByRole('dialog', { name: 'New campaign' });
      await dialog.getByLabel('Name').fill(name);
      await dialog.getByLabel('Trigger — page URL contains').fill(site.hostname);
      await dialog.getByLabel('Message').fill(message);
      await dialog.getByRole('button', { name: 'Create campaign' }).click();
      await expect(agentPage.getByRole('listitem').filter({ hasText: name })).toBeVisible();

      // --- The widget's own poll picks it up, panel still closed the whole
      // time — nothing the visitor clicked made this appear. The workspace's
      // own text, shown as-is (only the CTAs below are translated).
      //
      // One closed-panel poll interval is 30 s since tm 195.1 (FR-MOD-11.1)
      // started connecting returning visitors at mount — 4 s of that from
      // every idle tab was not what a proactive nudge is worth. The card is
      // therefore up to half a minute late, and this wait has to outlast it.
      await expect(frame.getByText(message)).toBeVisible({ timeout: 60_000 });
      await expect(frame.getByRole('button', { name: "Let's chat" })).toBeVisible();
      await visitor.screenshot({ path: 'kanit/03.3.2-campaign-card.png', fullPage: true });

      // --- Clicking it opens the chat ---------------------------------------
      await frame.getByRole('button', { name: "Let's chat" }).click();
      await expect(frame.getByRole('textbox', { name: 'Your name' })).toBeVisible();
    } finally {
      await visitorContext.close();
    }
  });

  // The other order of events, and the ordinary one (FR-MOD-03.3.2, tm 176.5):
  // the campaign has been running since before this visitor existed. Until the
  // visit write path evaluated campaigns, everybody who arrived after the save
  // matched nothing at all — the test above would pass and the feature would
  // still only ever reach whoever happened to be on the site that minute.
  test('a visitor who arrives after the campaign was saved is nudged too', async ({
    agentPage,
    browser,
    organizationId,
  }) => {
    test.slow();
    const stamp = Date.now().toString().slice(-6);
    const name = `Arrival nudge ${stamp}`;
    const message = `Welcome — need a hand? ${stamp}`;
    const site = tenantSubdomain(`arrive-${stamp}`);

    // --- The campaign goes up first, with nobody on that site yet -----------
    await agentPage.goto('/app/customers');
    await agentPage.getByRole('link', { name: 'Campaigns' }).click();
    await agentPage.getByRole('button', { name: 'New campaign' }).click();
    const dialog = agentPage.getByRole('dialog', { name: 'New campaign' });
    await dialog.getByLabel('Name').fill(name);
    await dialog.getByLabel('Trigger — page URL contains').fill(site.hostname);
    await dialog.getByLabel('Message').fill(message);
    await dialog.getByRole('button', { name: 'Create campaign' }).click();
    await expect(agentPage.getByRole('listitem').filter({ hasText: name })).toBeVisible();

    const visitorContext = await browser.newContext();
    const visitor = await visitorContext.newPage();
    try {
      // --- Only now does the visitor turn up ------------------------------
      await openWidget(visitor, organizationId, { host: site.origin });
      await visitorSends(visitor, `Just looking around — ${stamp}`);

      // Writing in is what tells the server which page they are on, so the
      // nudge is earned on the way into a conversation and waits for it to
      // finish rather than covering a live transcript (`campaign-delivery.ts`).
      const frame = widgetFrame(visitor);
      await frame.getByRole('button', { name: 'More options' }).click();
      await frame.getByRole('menuitem', { name: 'End chat' }).click();
      await frame
        .getByRole('dialog', { name: 'End this chat?' })
        .getByRole('button', { name: 'End chat' })
        .click();
      await expect(frame.getByText('Chat ended.')).toBeVisible();
      await frame.getByRole('button', { name: 'Close chat' }).click();

      // Closed-panel cadence, same as the test above (tm 195.1).
      await expect(frame.getByText(message)).toBeVisible({ timeout: 60_000 });
      await visitor.screenshot({ path: 'kanit/03.3.2-campaign-arrival.png', fullPage: true });
    } finally {
      await visitorContext.close();
    }
  });
});

test.describe('unread badge', () => {
  /**
   * FR-MOD-11.1: a reply that lands while the panel is shut has to reach the
   * launcher, or the visitor only finds it by opening the chat on a hunch.
   *
   * The half that could not be faked below the browser is the *closed* widget
   * connecting at all. Until tm 195.1 nothing polled until the panel was
   * opened, so this whole sequence — visitor writes in, closes the panel, agent
   * answers — ended with a launcher that looked exactly like an unanswered one.
   * A jsdom test can drive the poll directly; only a real page can show that
   * one starts without being asked.
   *
   * Isolated by host, like the campaign specs above: this visitor gets a
   * subdomain of their own so no other spec's conversation can be the one the
   * agent answers.
   */
  test('an agent reply with the panel closed lights the launcher (FR-MOD-11.1)', async ({
    browser,
    organizationId,
  }, testInfo) => {
    // The closed panel polls every 30 s by design — the badge is worth a slow
    // test, not 900 requests an hour from every idle tab.
    test.setTimeout(180_000);
    const stamp = Date.now().toString().slice(-6);
    const site = tenantSubdomain(`unread-${stamp}`);
    const question = `Is the rack in stock — ${stamp}`;
    const answer = `Two left, we can hold one — ${stamp}`;

    const visitorContext = await browser.newContext();
    const agentContext = await browser.newContext();
    const visitor = await visitorContext.newPage();
    const agent = await agentContext.newPage();

    try {
      await signIn(agent);
      await agent.getByLabel('Availability').selectOption('accepting_chats');

      await openWidget(visitor, organizationId, { host: site.origin });
      await visitorSends(visitor, question);

      // --- The visitor walks away from an open conversation ----------------
      const frame = widgetFrame(visitor);
      await frame.getByRole('button', { name: 'Close chat' }).click();
      // Closing re-offers the greeting card; waving it away leaves the bare
      // launcher, which is the surface this test is about.
      await frame.getByRole('button', { name: 'Just browsing' }).click();

      // Nothing from the team yet, so no badge and no count in the name.
      await expect(frame.getByRole('button', { name: 'Open chat', exact: true })).toBeVisible();
      await expect(frame.locator('.nx-badge')).toBeHidden();

      // --- The agent answers -----------------------------------------------
      const list = agent.getByRole('region', { name: 'Conversations' });
      await expect(list).toContainText(question, { timeout: 20_000 });
      await list.getByRole('button').first().click();
      await agent.getByRole('radio', { name: 'Reply' }).click();
      await agent.getByPlaceholder('Type your reply').fill(answer);
      await agent.getByRole('button', { name: 'Send' }).click();
      await expect(agent.locator('main')).toContainText(answer);

      // --- …and the closed launcher says so ---------------------------------
      // Generous, because one closed-panel poll interval is 30 s.
      await expect(frame.locator('.nx-badge')).toHaveText('1', { timeout: 60_000 });
      // Through the accessibility tree, not just the pixels: the count has to
      // reach a visitor who never sees the red circle.
      await expect(frame.getByRole('button', { name: 'Open chat (1 unread)' })).toBeVisible();
      await visitor.screenshot({ path: 'kanit/11.1-unread-badge.png', fullPage: true });

      // A state axe has never seen before: white on red, on the launcher.
      assertNoBlockingViolations(await scanScreen(visitor, 'Widget unread badge', testInfo));

      // --- Opening is what marks it read ------------------------------------
      await frame.getByRole('button', { name: 'Open chat (1 unread)' }).click();
      await expect(frame.getByRole('log', { name: 'Conversation' })).toContainText(answer);
      await frame.getByRole('button', { name: 'Close chat' }).click();
      await expect(frame.getByRole('button', { name: 'Open chat', exact: true })).toBeVisible();
      await expect(frame.locator('.nx-badge')).toBeHidden();
    } finally {
      await visitorContext.close();
      await agentContext.close();
    }
  });
});

test.describe('agent identity', () => {
  // FR-MOD-11.3: the visitor should see who they are talking to. Acme's AI
  // persona ("Ada") is active, so its name — not the agent's copilot, and not a
  // generic title — heads the panel.
  test('names the persona the visitor is talking to', async ({ page, organizationId }) => {
    await openWidget(page, organizationId);
    const frame = widgetFrame(page);

    await expect(frame.getByRole('heading', { name: 'Ada' })).toBeVisible({ timeout: 20_000 });
    await page.screenshot({ path: 'kanit/11-persona-header.png', fullPage: true });
  });
});

test.describe('emoji picker', () => {
  // FR-MOD-11.4: the composer's fourth tool — message, attach, emoji, send.
  // Proven end to end rather than only against the picker's own unit tests,
  // because a surrogate-pair glyph is exactly what a caret-math slip or a
  // lossy request body would corrupt silently.
  test('inserts an emoji at the caret and it reaches the transcript intact', async ({
    page,
    organizationId,
  }) => {
    await openWidget(page, organizationId);
    const frame = widgetFrame(page);
    const composer = frame.getByRole('textbox', { name: 'Message' });

    const stamp = Date.now().toString().slice(-6);
    const before = `Order ${stamp} `;
    await composer.fill(`${before}!`);
    // Caret placed right after the order number — not at the end — so the
    // assertion below actually exercises "at the caret", not just "appended".
    await composer.evaluate((el: HTMLTextAreaElement, pos: number) => {
      el.setSelectionRange(pos, pos);
    }, before.length);

    const trigger = frame.getByRole('button', { name: 'Insert emoji' });
    await trigger.click();
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    // U+1F600 GRINNING FACE — a surrogate pair (2 UTF-16 code units, not 1).
    await frame.getByRole('button', { name: '😀' }).click();
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await expect(composer).toHaveValue(`${before}😀!`);

    await frame.getByRole('button', { name: 'Send' }).click();
    // The pair survives the round trip through the request body and the
    // server's own storage/echo — nothing split or substituted it.
    await expect(frame.getByRole('log', { name: 'Conversation' })).toContainText(`${before}😀!`);
  });
});

test.describe('attachments', () => {
  // FR-MOD-02.3.5 + FR-MOD-11.4: a file can be attached from either composer,
  // sent, and seen on the other side — proven across the real cross-origin
  // boundary rather than against the API. Screenshots land in `kanit/` because
  // the config only keeps artefacts on failure, and a passing autonomous run
  // must still leave a human something to look at.
  test('a file crosses from visitor to agent and back', async ({ browser, organizationId }) => {
    const visitorContext = await browser.newContext();
    const agentContext = await browser.newContext();
    const visitor = await visitorContext.newPage();
    const agent = await agentContext.newPage();

    try {
      await signIn(agent);
      await agent.getByLabel('Availability').selectOption('accepting_chats');

      // --- Visitor attaches an image -----------------------------------------
      await openWidget(visitor, organizationId);
      const frame = widgetFrame(visitor);

      // The input is hidden and driven by the paperclip; setInputFiles does not
      // need it visible, and this is exactly what the click would trigger.
      await frame.locator('input[type="file"]').setInputFiles(SAMPLE_PNG);
      await expect(frame.locator('.nx-chip')).toContainText('sample.png');

      const caption = `Here is a screenshot — ${Date.now().toString().slice(-6)}`;
      await frame.getByRole('textbox', { name: 'Message' }).fill(caption);
      await frame.getByRole('button', { name: 'Send' }).click();

      // The visitor sees their own image inline (fetched with their token). Wait
      // for the pixels, not just the element: the blob loads asynchronously, and
      // a bare `toBeVisible` passes on the alt-text box before the image paints.
      await widgetImageRendered(visitor, 0);
      await visitor.screenshot({ path: 'kanit/5-widget-musteri-ek.png', fullPage: true });

      // --- The agent sees it -------------------------------------------------
      const list = agent.getByRole('region', { name: 'Conversations' });
      await expect(list).toContainText(caption, { timeout: 20_000 });
      await list.getByRole('button').first().click();
      await expect(agent.locator('main')).toContainText(caption);

      // The attachment renders in the agent's transcript, bytes and all.
      await imageRendered(agent.getByTestId('attachment-image').first());
      await agent.screenshot({ path: 'kanit/5-inbox-agent-gorur.png', fullPage: true });

      // --- Agent attaches one back -------------------------------------------
      await agent.getByRole('radio', { name: 'Reply' }).click();
      await agent.locator('input[type="file"]').setInputFiles(SAMPLE_PNG);
      await expect(agent.getByTestId('composer-attachment')).toContainText('sample.png');
      await agent.getByRole('button', { name: 'Send' }).click();

      // The visitor sees the agent's image (polling picks it up within seconds).
      await widgetImageRendered(visitor, 1);
      await visitor.screenshot({ path: 'kanit/5-widget-agent-ek.png', fullPage: true });
    } finally {
      await visitorContext.close();
      await agentContext.close();
    }
  });

  test('the server refuses an attachment_url that is not a real upload', async ({
    request,
    organizationId,
  }) => {
    // The client-side type/size checks are courtesy only; this is the refusal
    // that actually matters, asserted directly (FR-MOD-08.9.4).
    const token = await request.post(`${API_BASE}/customer/token`, {
      headers: { origin: WIDGET_ORIGIN },
      data: { organization_id: organizationId, host_origin: HOST_PAGE },
    });
    const { token: customerToken } = (await token.json()) as { token: string };

    const response = await request.post(`${API_BASE}/customer/chat/events`, {
      headers: { authorization: `Bearer ${customerToken}` },
      data: { attachment_url: 'https://evil.example/tracker.png' },
    });
    expect(response.status()).toBe(400);
    expect(((await response.json()) as { error: { type: string } }).error.type).toBe('validation');
  });
});

test.describe('trusted domains', () => {
  test('refuses a token for an origin the organization did not authorise', async ({
    request,
    organizationId,
  }) => {
    const response = await request.post(`${API_BASE}/customer/token`, {
      headers: { origin: 'http://localhost:5174' },
      data: { organization_id: organizationId, host_origin: 'https://not-a-customer.example' },
    });

    expect(response.status()).toBe(403);
    const body = (await response.json()) as { error: { type: string } };
    expect(body.error.type).toBe('authorization');
  });

  test('refuses an opaque origin', async ({ request, organizationId }) => {
    // What a sandboxed frame without `allow-same-origin` sends. An origin that
    // identifies nothing cannot be checked against an allowlist.
    const response = await request.post(`${API_BASE}/customer/token`, {
      headers: { origin: 'null' },
      data: { organization_id: organizationId },
    });
    expect(response.status()).toBe(403);
  });

  test('accepts the authorised host origin', async ({ request, organizationId }) => {
    const response = await request.post(`${API_BASE}/customer/token`, {
      headers: { origin: 'http://localhost:5174' },
      data: { organization_id: organizationId, host_origin: HOST_PAGE },
    });
    expect(response.ok(), await response.text()).toBe(true);

    const body = (await response.json()) as { token: string; customer_id: string };
    expect(body.token).toBeTruthy();
    expect(body.customer_id).toBeTruthy();
  });
});
