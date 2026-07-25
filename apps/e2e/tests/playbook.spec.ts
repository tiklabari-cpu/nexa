/**
 * Browse templates → a working skill (FR-MOD-05.1).
 *
 * The one thing the unit tests structurally cannot prove: that choosing a
 * template card actually mints a skill through the real API and lands the admin
 * in an editor already filled in. The catalogue's promise — every template's
 * steps pass `POST /skills` — is only worth anything if the round trip works, so
 * this drives it end to end: open the gallery, pick a card, and read the
 * template's own words back out of the editor.
 */
import { expect, test } from './fixtures.js';

test.describe('playbook — browse templates', () => {
  test('a template card opens a pre-filled skill editor', async ({ agentPage }) => {
    await agentPage.goto('/app/playbook');

    // The gallery is a primary header action, reachable and labelled.
    await agentPage.getByRole('button', { name: 'Browse templates' }).click();

    const gallery = agentPage.getByRole('dialog', { name: 'Browse templates' });
    await expect(gallery).toBeVisible();

    // Grouped by type — the three the catalogue advertises.
    await expect(gallery.getByRole('heading', { name: /Prebuilt/ })).toBeVisible();
    await expect(gallery.getByRole('heading', { name: /AI/ })).toBeVisible();
    await expect(gallery.getByRole('heading', { name: /Trending/ })).toBeVisible();

    // A card whose skill needs an external system says so before you pick it.
    await expect(gallery.getByText(/Shopify app connected/)).toBeVisible();

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
});
