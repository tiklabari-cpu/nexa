/**
 * The single knowledge store, end to end in the panel (AI-14 · tm 309.3).
 *
 * One list holds what the AI agent answers players from and what Copilot drafts
 * agents' replies from. What a browser proves that a unit test cannot:
 *
 * - a source added "for agents only" through the Playbook's scope fields lands
 *   in the real store with `audiences = [copilot]`, is absent from the AI
 *   agent's list (`GET /knowledge-sources`, the default every installed app
 *   reads) and present in the whole store, and shows up on the Team ›
 *   Copilot knowledge page as a filtered view of that same list — where it can
 *   be removed, and from where the Playbook's row also disappears;
 * - a person marks a source reviewed from its row menu and the server stamps it;
 * - the Knowledge Base editor's AI switch is real: a published article joins the
 *   store, switching it off takes the source out, switching it back brings it
 *   back, and the Playbook list marks the source as an article's.
 *
 * Both tests finish by deleting what they made — the seeded workspace is shared
 * by every spec in this suite.
 */
import { request as newApiContext, type APIRequestContext } from '@playwright/test';
import { ACME_OWNER, API_BASE, expect, ownerAccessTokenFor, test } from './fixtures.js';

interface StoredSource {
  id: string;
  name: string;
  audiences: string[];
  kb_article_id: string | null;
  reviewed_at: string;
}

const run = Date.now().toString().slice(-6);

let apiCtx: APIRequestContext;
let token: string;

const auth = () => ({ headers: { authorization: `Bearer ${token}` } });

/** The whole store, `audience=all` — the AI agent's slice is the default list. */
async function storeSources(): Promise<StoredSource[]> {
  const res = await apiCtx.get(`${API_BASE}/knowledge-sources?audience=all`, auth());
  expect(res.ok(), `list failed: ${res.status()}`).toBe(true);
  return ((await res.json()) as { items: StoredSource[] }).items;
}

test.beforeAll(async () => {
  apiCtx = await newApiContext.newContext({
    extraHTTPHeaders: { 'user-agent': 'siyahtus-e2e-knowledge-store' },
  });
  token = await ownerAccessTokenFor(apiCtx, ACME_OWNER);
});

test.afterAll(async () => {
  await apiCtx.dispose();
});

test.describe('knowledge store — one list, scoped (AI-14)', () => {
  const TITLE = `E2E agents-only escalation ${run}`;
  let sourceId: string | null = null;

  test.afterEach(async () => {
    if (sourceId) {
      await apiCtx.delete(`${API_BASE}/knowledge-sources/${sourceId}`, auth()).catch(() => {});
      sourceId = null;
    }
  });

  test('a source for agents only: scoped on create, in the whole store, on the Copilot page, reviewed, removed (AI-14 acceptance 1)', async ({
    agentPage,
  }) => {
    await agentPage.setViewportSize({ width: 1280, height: 1400 });
    await agentPage.goto('/app/playbook');
    await agentPage
      .getByRole('tablist', { name: 'AI Agent' })
      .getByRole('tab', { name: 'Knowledge' })
      .click();

    // --- Add it for agents only: untick the AI agent in the scope fields -----
    await agentPage.getByLabel('Title').fill(TITLE);
    await agentPage
      .getByLabel('Content')
      .fill(`Chargebacks go to the payments team, never to the player. Run ${run}.`);
    await agentPage.getByRole('button', { name: 'Who uses it and who keeps it' }).click();
    await agentPage.getByRole('checkbox', { name: 'AI agent', exact: true }).uncheck();
    await expect(agentPage.getByText(/never reaches a player/)).toBeVisible();

    const [created] = await Promise.all([
      agentPage.waitForResponse(
        (response) =>
          response.request().method() === 'POST' && response.url().endsWith('/knowledge-sources'),
      ),
      agentPage.getByRole('button', { name: 'Add source' }).click(),
    ]);
    expect(created.ok(), `create failed: ${created.status()} ${await created.text()}`).toBe(true);
    const body = (await created.json()) as StoredSource;
    sourceId = body.id;
    expect(body.audiences).toEqual(['copilot']);

    // --- The row says so, and the audience control narrows to it -------------
    const row = agentPage.getByRole('listitem').filter({ hasText: TITLE });
    await expect(row.getByText('Agents only')).toBeVisible();
    await agentPage.getByLabel('Audience').selectOption('agents_only');
    await expect(row).toBeVisible();
    await agentPage.getByLabel('Audience').selectOption('ai_agent');
    await expect(row).toBeHidden();
    await agentPage.getByLabel('Audience').selectOption('all');
    await expect(row).toBeVisible();
    await agentPage.screenshot({ path: 'kanit/ai-14-knowledge-store.png', fullPage: true });

    // --- In the store, and out of what the AI agent answers from -------------
    expect((await storeSources()).some((s) => s.id === sourceId)).toBe(true);
    const aiSlice = await apiCtx.get(`${API_BASE}/knowledge-sources`, auth());
    const aiItems = ((await aiSlice.json()) as { items: StoredSource[] }).items;
    expect(aiItems.some((s) => s.id === sourceId)).toBe(false);

    // --- Mark it reviewed from the row menu ----------------------------------
    await row.getByRole('button', { name: `Actions for ${TITLE}` }).click();
    const [reviewed] = await Promise.all([
      agentPage.waitForResponse(
        (response) => response.request().method() === 'POST' && response.url().endsWith('/review'),
      ),
      row.getByRole('button', { name: 'Mark as reviewed' }).click(),
    ]);
    expect(reviewed.ok(), `review failed: ${reviewed.status()}`).toBe(true);
    const stamp = new Date(((await reviewed.json()) as StoredSource).reviewed_at).getTime();
    expect(Date.now() - stamp).toBeLessThan(60_000);

    // --- The Copilot page is a filtered view of the same list ----------------
    await agentPage.goto('/app/team/ai-agents');
    await expect(agentPage.getByRole('heading', { name: 'Copilot knowledge' })).toBeVisible();
    const copilotRow = agentPage.getByRole('row').filter({ hasText: TITLE });
    await expect(copilotRow).toBeVisible();
    await expect(copilotRow.getByText('Agents only')).toBeVisible();

    await agentPage.getByLabel('Show').selectOption('agents_only');
    await expect(copilotRow).toBeVisible();

    // --- Removed from there, gone from the store ------------------------------
    await copilotRow.getByRole('button', { name: `Delete ${TITLE}` }).click();
    const [deleted] = await Promise.all([
      agentPage.waitForResponse((response) => response.request().method() === 'DELETE'),
      agentPage.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click(),
    ]);
    expect(deleted.ok(), `delete failed: ${deleted.status()}`).toBe(true);
    await expect(copilotRow).toBeHidden();
    expect((await storeSources()).some((s) => s.id === sourceId)).toBe(false);
    sourceId = null;
  });
});

test.describe('knowledge base — the AI switch (AI-14-S2)', () => {
  const ARTICLE_TITLE = `E2E help article ${run}`;
  const ARTICLE_SLUG = `e2e-help-article-${run}`;
  let articleId: string | null = null;

  test.afterEach(async () => {
    if (articleId) {
      await apiCtx.delete(`${API_BASE}/kb-articles/${articleId}`, auth()).catch(() => {});
      articleId = null;
    }
  });

  test('a published article joins the store, the switch takes it out and back, and the list marks it as an article’s (AI-14 acceptance 3)', async ({
    agentPage,
  }) => {
    await agentPage.setViewportSize({ width: 1280, height: 1600 });
    await agentPage.goto('/app/playbook');
    await agentPage.getByRole('tab', { name: 'Public KB' }).click();
    await agentPage.getByRole('button', { name: 'New article' }).click();

    const editor = agentPage.getByRole('dialog', { name: 'New article' });
    await expect(editor.getByRole('checkbox', { name: 'AI agent' })).toBeChecked();
    await editor.getByLabel('Title', { exact: true }).fill(ARTICLE_TITLE);
    await editor.getByLabel('Slug', { exact: true }).fill(ARTICLE_SLUG);
    await editor
      .getByLabel('Body', { exact: true })
      .fill(`Refunds reach the original card within fourteen days. Run ${run}.`);
    const [created] = await Promise.all([
      agentPage.waitForResponse(
        (response) =>
          response.request().method() === 'POST' && response.url().endsWith('/kb-articles'),
      ),
      editor.getByRole('button', { name: 'Create article' }).click(),
    ]);
    expect(created.ok(), `create failed: ${created.status()}`).toBe(true);
    articleId = ((await created.json()) as { id: string }).id;

    const mirrored = async (): Promise<StoredSource | undefined> =>
      (await storeSources()).find((s) => s.kb_article_id === articleId);

    // A draft is not in the store; published, it is.
    expect(await mirrored()).toBeUndefined();
    await editor.getByRole('button', { name: 'Publish', exact: true }).click();
    await expect(editor.getByRole('button', { name: 'Unpublish', exact: true })).toBeVisible();
    await expect.poll(async () => (await mirrored())?.audiences).toEqual(['ai_agent', 'copilot']);

    // The first save made the article; from here the same button saves it.
    const save = editor.getByRole('button', { name: 'Save changes' });

    // --- Switch the AI off for this article: its source goes -----------------
    await editor.getByRole('checkbox', { name: 'AI agent' }).uncheck();
    await editor.getByRole('checkbox', { name: 'Copilot' }).uncheck();
    await expect(editor.getByText(/does not use this article/)).toBeVisible();
    await save.click();
    await expect.poll(async () => await mirrored()).toBeUndefined();

    // --- And back on: the source returns -------------------------------------
    await editor.getByRole('checkbox', { name: 'AI agent' }).check();
    await editor.getByRole('checkbox', { name: 'Copilot' }).check();
    await save.click();
    await expect.poll(async () => (await mirrored())?.audiences).toEqual(['ai_agent', 'copilot']);

    // --- The Playbook's list marks it as a Knowledge Base article's ----------
    // Leaving a form that was edited asks the browser to confirm; accept it.
    agentPage.on('dialog', (dialog) => void dialog.accept());
    await agentPage.goto('/app/playbook');
    await agentPage
      .getByRole('tablist', { name: 'AI Agent' })
      .getByRole('tab', { name: 'Knowledge' })
      .click();
    const row = agentPage.getByRole('listitem').filter({ hasText: ARTICLE_TITLE });
    await expect(row.getByText('Knowledge Base article')).toBeVisible();
    await expect(row.getByText('AI agent + Copilot')).toBeVisible();
  });
});
