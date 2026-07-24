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
  signIn,
  visitorSends,
  widgetFrame,
} from './fixtures.js';

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
async function widgetImageRendered(
  page: Page,
  index = 0,
): Promise<void> {
  await expect
    .poll(
      async () =>
        (page.frame({ url: /widget\.html/ })?.evaluate((i) => {
          const img = document.querySelectorAll('img.nx-attachment-img')[i] as
            | HTMLImageElement
            | undefined;
          return img?.naturalWidth ?? 0;
        }, index)) ?? 0,
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

    // The frame is launcher-sized until opened; a full-size transparent iframe
    // would swallow clicks on the host page.
    const box = await frame.boundingBox();
    expect(box!.width).toBeLessThanOrEqual(100);
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
    const text = `Do you ship to Norway? ${Date.now()}`;
    await visitorSends(page, text);

    // A returning visitor continues the same conversation — the customer id is
    // remembered, and the token is re-minted rather than reused.
    await page.reload();
    await widgetFrame(page).getByRole('button', { name: 'Open chat' }).click();
    await expect(widgetFrame(page).getByRole('log', { name: 'Conversation' })).toContainText(text);
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

      const caption = `Here is a screenshot — ${Date.now()}`;
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
