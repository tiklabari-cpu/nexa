/**
 * The structured knowledge tables, end to end in the panel (AI-13 · tm 310.5).
 *
 * What a browser proves that the unit tests cannot: the "Tables" tab of the AI
 * Agent page talks to the real API — a payment method added through the form
 * lands in the real table (and its row text in the knowledge store), the server
 * refuses a row that contradicts itself and the form keeps what was typed, a
 * person marks a row reviewed, the export is a CSV that carries the row, and
 * the access information card loads with its "entered by your workspace" note.
 *
 * The test deletes the row it made — the seeded workspace is shared by every
 * spec in this suite. The access information card is only read here: its
 * setting has no delete, and a leftover would speak for the whole workspace.
 */
import { request as newApiContext, type APIRequestContext } from '@playwright/test';
import { ACME_OWNER, API_BASE, expect, ownerAccessTokenFor, test } from './fixtures.js';

interface StoredRow {
  id: string;
  name: string;
  min_amount: number | null;
  expected_minutes: number | null;
  reviewed_at: string;
  stale: boolean;
}

const run = Date.now().toString().slice(-6);
const NAME = `E2E Papara ${run}`;

let apiCtx: APIRequestContext;
let token: string;

const auth = () => ({ headers: { authorization: `Bearer ${token}` } });

async function paymentMethods(): Promise<StoredRow[]> {
  const res = await apiCtx.get(`${API_BASE}/knowledge-tables/payment-methods`, auth());
  expect(res.ok(), `list failed: ${res.status()}`).toBe(true);
  return ((await res.json()) as { items: StoredRow[] }).items;
}

test.beforeAll(async () => {
  apiCtx = await newApiContext.newContext({
    extraHTTPHeaders: { 'user-agent': 'siyahtus-e2e-knowledge-tables' },
  });
  token = await ownerAccessTokenFor(apiCtx, ACME_OWNER);
});

test.afterAll(async () => {
  for (const row of (await paymentMethods()).filter((r) => r.name.startsWith('E2E Papara'))) {
    await apiCtx
      .delete(`${API_BASE}/knowledge-tables/payment-methods/${row.id}`, auth())
      .catch(() => {});
  }
  await apiCtx.dispose();
});

test.describe('structured knowledge tables (AI-13)', () => {
  test('add a payment method, see the server refuse a contradiction, review it, export it', async ({
    agentPage,
  }) => {
    // The contract first, straight at the API: a contradicting row is a 400 that
    // names the field. It also warms the stack — the first write of a fresh stack
    // is slower than the form's ten-second expectations below.
    const refused = await apiCtx.post(`${API_BASE}/knowledge-tables/payment-methods`, {
      ...auth(),
      data: { name: NAME, direction: 'deposit', min_amount: 500, max_amount: 100 },
    });
    expect(refused.status()).toBe(400);
    expect(
      ((await refused.json()) as { error: { details: { problems: unknown[] } } }).error.details
        .problems,
    ).toEqual([{ field: 'min_amount', code: 'min_above_max' }]);
    await agentPage.setViewportSize({ width: 1280, height: 1600 });
    await agentPage.goto('/app/playbook?view=skills');
    await agentPage
      .getByRole('tablist', { name: 'AI Agent' })
      .getByRole('tab', { name: 'Tables' })
      .click();
    await expect(agentPage.getByRole('tab', { name: /Payment methods/ })).toBeVisible();

    // --- A row that contradicts itself is refused beside its fields ----------
    await agentPage.getByRole('button', { name: 'Add a row' }).click();
    const form = agentPage.getByRole('form', { name: 'Add a row' });
    await form.getByLabel(/^Name/).fill(NAME);
    await form.getByLabel('Minimum amount').fill('500');
    await form.getByLabel('Maximum amount').fill('100');
    await form.getByRole('button', { name: 'Save' }).click();
    await expect(form.getByText('The minimum is above the maximum.')).toBeVisible();
    expect((await paymentMethods()).some((row) => row.name === NAME)).toBe(false);

    // --- Fixed, the same form saves it ---------------------------------------
    await form.getByLabel('Minimum amount').fill('100');
    await form.getByLabel('Maximum amount').fill('50000');
    await form.getByLabel('Expected minutes').fill('30');
    const [created] = await Promise.all([
      agentPage.waitForResponse(
        (response) =>
          response.request().method() === 'POST' &&
          response.url().endsWith('/knowledge-tables/payment-methods'),
      ),
      form.getByRole('button', { name: 'Save' }).click(),
    ]);
    expect(created.ok(), `create failed: ${created.status()} ${await created.text()}`).toBe(true);
    const row = agentPage.getByRole('row').filter({ hasText: NAME });
    await expect(row).toBeVisible();
    await expect(row).toContainText('100 – 50000 TRY');
    await expect(row).toContainText('Reviewed');
    const stored = (await paymentMethods()).find((r) => r.name === NAME);
    expect(stored?.expected_minutes).toBe(30);
    expect(stored?.stale).toBe(false);

    // --- Reviewed: the server stamps it, nothing else changes ----------------
    const [reviewed] = await Promise.all([
      agentPage.waitForResponse(
        (response) => response.request().method() === 'POST' && response.url().endsWith('/review'),
      ),
      row.getByRole('button', { name: `Mark ${NAME} as reviewed` }).click(),
    ]);
    expect(reviewed.ok()).toBe(true);
    const after = (await paymentMethods()).find((r) => r.name === NAME);
    expect(after?.min_amount).toBe(100);
    expect(Date.parse(after!.reviewed_at)).toBeGreaterThanOrEqual(Date.parse(stored!.reviewed_at));

    // --- The export is a CSV that carries the row ----------------------------
    const [download] = await Promise.all([
      agentPage.waitForEvent('download'),
      agentPage.getByRole('button', { name: 'Export CSV' }).click(),
    ]);
    const csv = await (await import('node:fs/promises')).readFile((await download.path())!, 'utf8');
    expect(csv.split('\n')[0]).toContain('name');
    expect(csv).toContain(NAME);

    // --- The access information card: loaded, with the workspace's own note --
    const card = agentPage.getByRole('region', { name: 'Access information' });
    await expect(card).toContainText('This information is entered by your workspace');
    await agentPage.screenshot({ path: 'kanit/ai-13-knowledge-tables.png', fullPage: true });

    // --- Delete asks first ---------------------------------------------------
    await row.getByRole('button', { name: `Delete ${NAME}` }).click();
    await agentPage
      .getByRole('dialog')
      .getByRole('button', { name: 'Delete', exact: true })
      .click();
    await expect(row).toBeHidden();
    expect((await paymentMethods()).some((r) => r.name === NAME)).toBe(false);
  });
});
