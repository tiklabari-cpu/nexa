/**
 * Browse templates → a working skill (FR-MOD-05.1, FR-EK-B.1).
 *
 * The one thing the unit tests structurally cannot prove: that choosing a
 * template card actually mints a skill through the real API and lands the admin
 * in an editor already filled in. The catalogue's promise — every template's
 * steps pass `POST /skills` — is only worth anything if the round trip works, so
 * this drives it end to end: open the gallery, pick a card, and read the
 * template's own words back out of the editor.
 *
 * At 31+ entries the gallery is windowed and filterable (05.6-tmpl31-d): a
 * category tab narrows the catalogue by type, and only the tab's first entry is
 * guaranteed inside the default scroll window, so the a card-picking assertions
 * below select a tab (or search) before reaching for "the first card" — a real
 * browser's viewport is not the fixed 640px unit tests pin, so nothing here
 * assumes a specific row count is on screen, only that the *first* row of
 * whatever is showing is deterministic.
 */
import { request as newApiContext, type APIRequestContext } from '@playwright/test';
import { ACME_OWNER, API_BASE, expect, ownerAccessTokenFor, test } from './fixtures.js';

test.describe('playbook — browse templates', () => {
  test('a template card opens a pre-filled skill editor', async ({ agentPage }) => {
    await agentPage.goto('/app/playbook');

    // The gallery is a primary header action, reachable and labelled.
    await agentPage.getByRole('button', { name: 'Browse templates' }).click();

    const gallery = agentPage.getByRole('dialog', { name: 'Browse templates' });
    await expect(gallery).toBeVisible();

    // A category tab per type, the catalogue's own scale (FR-EK-B.1).
    await expect(gallery.getByRole('tab', { name: /All/ })).toBeVisible();
    await expect(gallery.getByRole('tab', { name: /Prebuilt/ })).toBeVisible();
    await expect(gallery.getByRole('tab', { name: /AI/ })).toBeVisible();
    await expect(gallery.getByRole('tab', { name: /Trending/ })).toBeVisible();

    // A card whose skill needs an external system says so before you pick it —
    // Trending's first entry needs Shopify, and a tab's first row is always in
    // the window regardless of viewport height.
    await gallery.getByRole('tab', { name: /Trending/ }).click();
    await expect(gallery.getByText(/Shopify app connected/)).toBeVisible();

    // Back to the unfiltered catalogue for the round trip below.
    await gallery.getByRole('tab', { name: /All/ }).click();

    // Catalogue order: the first "Use template" is "Where is my order?".
    await gallery.getByRole('button', { name: 'Use template' }).first().click();

    // Choosing closes the gallery and opens the editor on the new skill.
    await expect(gallery).toBeHidden();

    // Pre-filled, not blank: the template's name, instruction and compiled
    // steps are all there for the admin to edit rather than author.
    await expect(agentPage.getByLabel('Name')).toHaveValue('Where is my order?');
    await expect(agentPage.getByLabel('Instruction')).toHaveValue(/ask for their order number/);
    await expect(agentPage.getByText(/Ask for order_number/)).toBeVisible();
    await expect(agentPage.getByText(/Tag the conversation/)).toBeVisible();

    // The editor only renders for a skill the list query actually returned, so
    // its being open on this one is the proof the template minted a real,
    // persisted skill — not a client-side draft.
    await expect(agentPage.getByRole('region', { name: 'Where is my order?' })).toBeVisible();

    await agentPage.screenshot({ path: 'kanit/32-playbook-template-editor.png', fullPage: true });
  });

  test('finds a template by search and creates a skill from it (05.6-tmpl31-d)', async ({
    agentPage,
  }) => {
    await agentPage.goto('/app/playbook');
    await agentPage.getByRole('button', { name: 'Browse templates' }).click();

    const gallery = agentPage.getByRole('dialog', { name: 'Browse templates' });
    await expect(gallery).toBeVisible();

    // A debounced name/summary search narrows the 31+ card catalogue to the
    // one card an admin is actually looking for.
    await gallery.getByPlaceholder('Search templates…').fill('warranty');
    await expect(gallery.getByRole('button', { name: 'Use template' })).toHaveCount(1);

    await gallery.getByRole('button', { name: 'Use template' }).click();
    await expect(gallery).toBeHidden();

    await expect(agentPage.getByLabel('Name')).toHaveValue('Warranty coverage');
    await expect(agentPage.getByRole('region', { name: 'Warranty coverage' })).toBeVisible();

    await agentPage.screenshot({ path: 'kanit/32-playbook-template-search.png', fullPage: true });
  });

  test('"Try this" on a recommended card opens a pre-filled editor (FR-MOD-05.2)', async ({
    agentPage,
  }) => {
    await agentPage.goto('/app/playbook');

    // The recommended strip is inline on the page, not behind the gallery.
    const strip = agentPage.getByRole('region', { name: 'Recommended skills' });
    await expect(strip).toBeVisible();

    // A card whose skill needs an external system warns here too, before you pick it.
    await expect(strip.getByText(/Shopify app connected/)).toBeVisible();

    // Featured order: the first "Try this" is "Where is my order?".
    await strip.getByRole('button', { name: 'Try this' }).first().click();

    // Try this copies the template into a real, persisted skill and opens the
    // editor on it — same round trip as the gallery, reached from a single click.
    await expect(agentPage.getByLabel('Name')).toHaveValue('Where is my order?');
    await expect(agentPage.getByLabel('Instruction')).toHaveValue(/ask for their order number/);
    await expect(agentPage.getByRole('region', { name: 'Where is my order?' })).toBeVisible();

    await agentPage.screenshot({ path: 'kanit/32-recommended-try-this.png', fullPage: true });
  });
});

/**
 * Authoring a skill's steps from the editor (FR-MOD-06.2.4).
 *
 * The flow below was *impossible* until this task: "New skill" mints a skill
 * with `steps: []` (`playbook.ts`'s `POST /skills`), and the editor could add
 * no step, delete none and retype none — only `transfer_to_team`'s team was
 * editable at all. So a skill that did not start life as a template could never
 * gain a single step, and the ordered-steps surface the PRD counts was reachable
 * only through the gallery.
 *
 * It is driven end to end rather than in jsdom because the claim is about what
 * *persists*: the unit tests can prove the right `PATCH` body leaves the
 * browser, but only a reload proves the steps came back in the order they were
 * put in, through the real API and a real database.
 */
test.describe('playbook — step authoring', () => {
  /** Unique per run: the list is filtered by this name after the reload. */
  const SKILL_NAME = `E2E authored steps ${Date.now().toString().slice(-6)}`;

  let apiCtx: APIRequestContext;
  let skillId: string | null = null;

  test.beforeAll(async () => {
    apiCtx = await newApiContext.newContext({
      extraHTTPHeaders: { 'user-agent': 'nexa-e2e-playbook-steps' },
    });
  });

  test.afterAll(async () => {
    // The seeded workspace is shared by every spec in this suite, and a skill
    // left behind is a row that later runs have to scroll past — the template
    // tests above already look for "the first card" in a list this one would
    // grow. So the skill this test authors is removed again.
    if (skillId) {
      const token = await ownerAccessTokenFor(apiCtx, ACME_OWNER);
      await apiCtx
        .delete(`${API_BASE}/skills/${skillId}`, {
          headers: { authorization: `Bearer ${token}` },
        })
        .catch(() => {});
    }
    await apiCtx.dispose();
  });

  test('adds, orders and saves steps on a skill that had none (FR-MOD-06.2.4)', async ({
    agentPage,
  }) => {
    await agentPage.goto('/app/playbook');

    // Catch the id on the way past, so teardown can remove the row again.
    const [created] = await Promise.all([
      agentPage.waitForResponse(
        (response) => response.request().method() === 'POST' && response.url().endsWith('/skills'),
      ),
      agentPage.getByRole('button', { name: 'New skill', exact: true }).click(),
    ]);
    skillId = ((await created.json()) as { id: string }).id;

    // Born with nothing to run — the state this whole test exists to get out of.
    await expect(agentPage.getByText(/No steps yet/)).toBeVisible();

    const name = agentPage.getByLabel('Name');
    await name.fill(SKILL_NAME);

    // Two steps, authored from the six-type vocabulary, each opening onto its
    // own parameters. Scoped to the step list: a step's fields share labels
    // with the app shell, where "Team" is also a nav destination.
    const stepList = agentPage.getByRole('list', { name: 'Steps' });

    await agentPage.getByLabel('Step type to add').selectOption('tag');
    await agentPage.getByRole('button', { name: 'Add step' }).click();
    await stepList.getByLabel('Tag', { exact: true }).fill('shipping');

    await agentPage.getByLabel('Step type to add').selectOption('transfer_to_team');
    await agentPage.getByRole('button', { name: 'Add step' }).click();
    await stepList.getByLabel('Team', { exact: true }).fill('Support');

    // Order is behaviour: a hand-over before the tag means the tag never runs.
    // The keyboard alternative to drag does the reordering (NFR-A11Y4).
    await agentPage.getByRole('button', { name: 'Move step 2 up' }).click();

    await agentPage.screenshot({ path: 'kanit/06.2.4-step-authoring.png', fullPage: true });

    const [saved] = await Promise.all([
      agentPage.waitForResponse(
        (response) =>
          response.request().method() === 'PATCH' && response.url().includes('/skills/'),
      ),
      agentPage.getByRole('button', { name: 'Save changes' }).click(),
    ]);
    expect(saved.ok(), `save failed: ${saved.status()} ${await saved.text()}`).toBe(true);

    // Reload, find it again by name, and read the steps back out of the API's
    // answer rather than out of the editor's memory.
    await agentPage.reload();
    await agentPage.getByPlaceholder('Search skills…').fill(SKILL_NAME);
    await agentPage.getByRole('button', { name: SKILL_NAME }).click();

    const editor = agentPage.getByRole('region', { name: SKILL_NAME });
    const steps = editor.getByRole('list', { name: 'Steps' }).getByRole('listitem');
    await expect(steps).toHaveCount(2);
    await expect(steps.nth(0)).toContainText('Hand over to Support');
    await expect(steps.nth(1)).toContainText('Tag the conversation');
  });
});
