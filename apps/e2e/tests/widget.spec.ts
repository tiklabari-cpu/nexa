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
import {
  expect,
  test,
  HOST_PAGE,
  API_BASE,
  openWidget,
  visitorSends,
  widgetFrame,
} from './fixtures.js';

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
