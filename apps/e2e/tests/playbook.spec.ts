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
import { expect, test } from './fixtures.js';

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
