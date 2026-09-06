/**
 * A knowledge source's row actions, end to end (FR-MOD-06.3.3).
 *
 * The row used to offer exactly one verb, and it deleted on the click. What a
 * browser proves here that a unit test cannot: the three verbs behind the `…`
 * menu each reach the real endpoint and change the real row — an edit that
 * round-trips through `PATCH` and comes back on a reload, a `reindex` that the
 * server answers, and a delete that the confirmation dialog genuinely gates
 * (cancel leaves the row exactly where it was, confirm removes it).
 *
 * The test cleans up after itself by finishing on the delete, which is also the
 * assertion — the seeded workspace is shared by every spec in this suite, so a
 * source left behind is a row later runs have to scroll past.
 */
import { request as newApiContext, type APIRequestContext } from '@playwright/test';
import { ACME_OWNER, API_BASE, expect, ownerAccessTokenFor, test } from './fixtures.js';

test.describe('playbook — knowledge source actions', () => {
  /** Unique per run: the seed is idempotent, so reruns must not collide. */
  const run = Date.now().toString().slice(-6);
  const TITLE = `E2E refund policy ${run}`;
  const RENAMED = `${TITLE} (revised)`;

  let apiCtx: APIRequestContext;
  let sourceId: string | null = null;

  test.beforeAll(async () => {
    apiCtx = await newApiContext.newContext({
      extraHTTPHeaders: { 'user-agent': 'nexa-e2e-knowledge-actions' },
    });
  });

  test.afterAll(async () => {
    // The happy path ends on a delete, so this only fires when the test failed
    // partway — a safety net, not the cleanup.
    if (sourceId) {
      const token = await ownerAccessTokenFor(apiCtx, ACME_OWNER);
      await apiCtx
        .delete(`${API_BASE}/knowledge-sources/${sourceId}`, {
          headers: { authorization: `Bearer ${token}` },
        })
        .catch(() => {});
    }
    await apiCtx.dispose();
  });

  test('edits, reindexes and (after confirming) deletes a source (FR-MOD-06.3.3)', async ({
    agentPage,
  }) => {
    await agentPage.goto('/app/playbook');
    await agentPage
      .getByRole('tablist', { name: 'AI Agent' })
      .getByRole('tab', { name: 'Knowledge' })
      .click();

    // --- A source to act on, created through the real endpoint --------------
    await agentPage.getByLabel('Title').fill(TITLE);
    await agentPage
      .getByLabel('Content')
      .fill(`Refunds are paid back to the original card within fourteen working days. Run ${run}.`);

    const [created] = await Promise.all([
      agentPage.waitForResponse(
        (response) =>
          response.request().method() === 'POST' && response.url().endsWith('/knowledge-sources'),
      ),
      agentPage.getByRole('button', { name: 'Add source' }).click(),
    ]);
    expect(created.ok(), `create failed: ${created.status()}`).toBe(true);
    sourceId = ((await created.json()) as { id: string }).id;

    const actions = agentPage.getByRole('button', { name: `Actions for ${TITLE}` });
    await expect(actions).toBeVisible();

    // --- Edit: rename and replace the text, then read it back off the API ----
    await actions.click();
    await agentPage.getByRole('button', { name: 'Edit' }).click();

    const editDialog = agentPage.getByRole('dialog');
    await editDialog.getByLabel('Title').fill(RENAMED);
    await editDialog
      .getByLabel('Content')
      .fill(`Refunds are issued as store credit only, never back to a card. Run ${run}.`);

    const [patched] = await Promise.all([
      agentPage.waitForResponse(
        (response) =>
          response.request().method() === 'PATCH' && response.url().includes('/knowledge-sources/'),
      ),
      editDialog.getByRole('button', { name: 'Save changes' }).click(),
    ]);
    expect(patched.ok(), `edit failed: ${patched.status()} ${await patched.text()}`).toBe(true);
    // Re-indexed, not merely renamed: an edit that left the old chunks would
    // keep answering from the text the admin believes they replaced.
    expect(((await patched.json()) as { chunk_count: number }).chunk_count).toBeGreaterThan(0);

    // Survives a reload, so the change is in the database rather than in the
    // page's memory of the request it just made.
    await agentPage.reload();
    await agentPage
      .getByRole('tablist', { name: 'AI Agent' })
      .getByRole('tab', { name: 'Knowledge' })
      .click();
    const renamedActions = agentPage.getByRole('button', { name: `Actions for ${RENAMED}` });
    await expect(renamedActions).toBeVisible();

    // --- Reindex: the server refreshes the source in place ------------------
    await renamedActions.click();
    const [reindexed] = await Promise.all([
      agentPage.waitForResponse((response) => response.url().includes('/reindex')),
      agentPage.getByRole('button', { name: 'Reindex' }).click(),
    ]);
    expect(reindexed.ok(), `reindex failed: ${reindexed.status()}`).toBe(true);

    await agentPage.screenshot({ path: 'kanit/06.3.3-knowledge-actions.png', fullPage: true });

    // --- Delete: cancelling really cancels ----------------------------------
    await renamedActions.click();
    await agentPage.getByRole('button', { name: 'Delete', exact: true }).click();

    const deleteDialog = agentPage.getByRole('dialog');
    await expect(deleteDialog).toContainText(RENAMED);
    await deleteDialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(deleteDialog).toBeHidden();
    // Still there — a cancelled confirmation must not have sent the delete.
    await expect(renamedActions).toBeVisible();

    // --- Delete: confirming really deletes ----------------------------------
    await renamedActions.click();
    await agentPage.getByRole('button', { name: 'Delete', exact: true }).click();
    const [deleted] = await Promise.all([
      agentPage.waitForResponse(
        (response) =>
          response.request().method() === 'DELETE' &&
          response.url().includes('/knowledge-sources/'),
      ),
      agentPage.getByRole('dialog').getByRole('button', { name: 'Delete source' }).click(),
    ]);
    expect(deleted.ok(), `delete failed: ${deleted.status()}`).toBe(true);
    await expect(renamedActions).toBeHidden();
    sourceId = null;
  });
});
