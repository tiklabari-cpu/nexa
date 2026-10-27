/**
 * The iGaming template gallery, end to end in the panel (AI-15 · tm 311.4).
 *
 * What a browser proves that the unit tests cannot: the "iGaming" tab of the
 * gallery lists the server's twenty templates, a preview reads one without
 * writing anything, "Taslak olarak kur" copies it into a real switched-off
 * procedure of the workspace's AI agent, the result names the placeholder that
 * still blocks publishing, installing again makes no second copy, and the
 * draft opens in the editor.
 *
 * The seeded workspace is shared by every spec in this suite, so the test
 * starts from "no copy of this template" and deletes the one it made.
 */
import { request as newApiContext, type APIRequestContext } from '@playwright/test';
import { ACME_OWNER, API_BASE, expect, ownerAccessTokenFor, test } from './fixtures.js';

const TEMPLATE = 'deposit_not_credited';

interface SkillRow {
  id: string;
  template_key: string | null;
  active: boolean;
}

let apiCtx: APIRequestContext;
let token: string;

const auth = () => ({ headers: { authorization: `Bearer ${token}` } });

async function copies(): Promise<SkillRow[]> {
  const res = await apiCtx.get(`${API_BASE}/skills`, auth());
  expect(res.ok(), `skills failed: ${res.status()}`).toBe(true);
  return ((await res.json()) as { items: SkillRow[] }).items.filter(
    (skill) => skill.template_key === TEMPLATE,
  );
}

async function removeCopies(): Promise<void> {
  for (const skill of await copies()) {
    await apiCtx.delete(`${API_BASE}/skills/${skill.id}`, auth()).catch(() => {});
  }
}

test.beforeAll(async () => {
  apiCtx = await newApiContext.newContext({
    extraHTTPHeaders: { 'user-agent': 'siyahtus-e2e-ai-templates' },
  });
  token = await ownerAccessTokenFor(apiCtx, ACME_OWNER);
  await removeCopies();
});

test.afterAll(async () => {
  await removeCopies();
  await apiCtx.dispose();
});

test.describe('iGaming template gallery (AI-15)', () => {
  test('preview writes nothing, install makes one switched-off draft, a second install makes none', async ({
    agentPage,
  }) => {
    await agentPage.setViewportSize({ width: 1280, height: 1400 });
    await agentPage.goto('/app/playbook?view=skills');
    await agentPage.getByRole('button', { name: 'Browse templates' }).click();
    const gallery = agentPage.getByRole('dialog', { name: 'Browse templates' });
    await gallery.getByRole('tab', { name: 'iGaming' }).click();

    // --- The catalogue: twenty templates, the two locked ones marked --------
    const list = gallery.getByRole('list', { name: 'iGaming templates' });
    await expect(list.getByRole('listitem')).toHaveCount(20);
    await expect(list.getByText('Locked')).toHaveCount(2);

    // --- A preview reads one template and writes nothing ---------------------
    const row = list.getByRole('listitem').filter({ hasText: 'Locked' }).first();
    await row.getByRole('button', { name: /^Preview/ }).click();
    await expect(
      gallery.getByRole('region', { name: 'What the workspace must fill in' }),
    ).toBeVisible();
    await gallery.getByRole('button', { name: 'Back' }).click();
    expect(await copies()).toHaveLength(0);

    // --- Install: one copy, switched off, with the blockers named -----------
    await list.getByRole('button', { name: 'Install the Yatırım hesaba geçmedi template' }).click();
    const [installed] = await Promise.all([
      agentPage.waitForResponse(
        (response) =>
          response.request().method() === 'POST' &&
          response.url().endsWith(`/ai-templates/${TEMPLATE}/install`),
      ),
      gallery.getByRole('button', { name: 'Install as a draft' }).click(),
    ]);
    expect(installed.status(), await installed.text()).toBe(201);
    await expect(gallery.getByText('The draft is installed.')).toBeVisible();
    await expect(gallery.getByText('What stops publishing')).toBeVisible();

    const made = await copies();
    expect(made).toHaveLength(1);
    expect(made[0]!.active).toBe(false);

    // --- A second install makes no second copy -------------------------------
    const again = await apiCtx.post(`${API_BASE}/ai-templates/${TEMPLATE}/install`, {
      ...auth(),
      data: { ai_agent_id: await agentIdOf() },
    });
    expect(again.status()).toBe(200);
    expect(((await again.json()) as { created: boolean }).created).toBe(false);
    expect(await copies()).toHaveLength(1);

    // --- The draft opens in the editor ---------------------------------------
    await gallery.getByRole('button', { name: 'Open the draft' }).click();
    await expect(gallery).toBeHidden();
    await expect(agentPage.getByLabel('Name')).toHaveValue(/./);
    await agentPage.screenshot({ path: 'kanit/ai-15-igaming-gallery.png', fullPage: true });
  });
});

async function agentIdOf(): Promise<string> {
  const res = await apiCtx.get(`${API_BASE}/ai-agents`, auth());
  expect(res.ok()).toBe(true);
  const agent = ((await res.json()) as { items: Array<{ id: string; kind: string }> }).items.find(
    (item) => item.kind === 'ai_agent',
  );
  expect(agent, 'the seeded workspace has an AI agent').toBeDefined();
  return agent!.id;
}
