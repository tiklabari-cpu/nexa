/**
 * AI Agent surface — tabs, persona, knowledge crawl (MOD-06).
 *
 * What the unit and integration suites cannot prove on their own: that the four
 * tabs are one place a real admin moves through, that a persona edit round-trips
 * through the API and survives a reload, and that adding a website source
 * crawls a URL into a searchable source — all in a real browser against the
 * real API.
 */
import { expect, test } from './fixtures.js';

test.describe('AI Agent (MOD-06)', () => {
  test('switches between the four tabs, each showing its own surface', async ({ agentPage }) => {
    await agentPage.goto('/app/playbook');

    const tabs = agentPage.getByRole('tablist', { name: 'AI Agent' });
    for (const name of ['Performance', 'Profile', 'Skills', 'Knowledge']) {
      await expect(tabs.getByRole('tab', { name })).toBeVisible();
    }

    // Skills is the landing tab — the recommended strip is on screen.
    await expect(agentPage.getByRole('region', { name: 'Recommended skills' })).toBeVisible();

    // Profile shows the persona form pre-filled from the seeded agent (Ada).
    await tabs.getByRole('tab', { name: 'Profile' }).click();
    await expect(agentPage.getByLabel('Name')).toHaveValue('Ada');

    // Performance shows the KPI cards, read from the reports the invoice trusts.
    await tabs.getByRole('tab', { name: 'Performance' }).click();
    await expect(agentPage.getByText('Resolution rate')).toBeVisible();

    await agentPage.screenshot({ path: 'kanit/33-ai-agent-tabs.png', fullPage: true });
  });

  test('a persona edit round-trips through the API and survives a reload (FR-MOD-06.4)', async ({
    agentPage,
  }) => {
    await agentPage.goto('/app/playbook');
    const tabs = agentPage.getByRole('tablist', { name: 'AI Agent' });
    await tabs.getByRole('tab', { name: 'Profile' }).click();

    const save = agentPage.getByRole('button', { name: 'Save profile' });

    // The name is required — clearing it disables Save; the widget shows it, so
    // it is restored to Ada (widget.spec keys on that name) without persisting.
    const name = agentPage.getByLabel('Name');
    await name.clear();
    await expect(save).toBeDisabled();
    await name.fill('Ada');

    // Change a free-text persona field the widget header does not key on, to a
    // value unique per run — so the test is robust to the idempotent seed and
    // never collides with widget.spec's persona-name assertion.
    const marker = `professional-${Date.now()}`;
    const tone = agentPage.getByLabel('Tone');
    await tone.fill(marker);
    await save.click();
    // Save settles back to disabled once the PATCH persists and the agent refetches.
    await expect(save).toBeDisabled();

    // Reload and reopen Profile — the edit round-tripped through the API.
    await agentPage.reload();
    await tabs.getByRole('tab', { name: 'Profile' }).click();
    await expect(agentPage.getByLabel('Tone')).toHaveValue(marker);

    await agentPage.screenshot({ path: 'kanit/33-ai-agent-profile.png', fullPage: true });
  });

  test('adds a website knowledge source by crawling a URL (FR-MOD-06.3.2)', async ({
    agentPage,
  }) => {
    await agentPage.goto('/app/playbook');
    await agentPage
      .getByRole('tablist', { name: 'AI Agent' })
      .getByRole('tab', { name: 'Knowledge' })
      .click();

    // Choosing Website swaps the content box for a URL to crawl. Exact match so
    // the "Type" select is not confused with the "Knowledge types" sub-tab strip.
    await agentPage.getByLabel('Type', { exact: true }).selectOption('website');
    // A unique title per run keeps the test robust to the idempotent seed —
    // reruns add distinct sources rather than colliding on one name.
    const title = `Crawled policy ${Date.now()}`;
    await agentPage.getByLabel('Title').fill(title);
    await agentPage.getByLabel('Website URL').fill(`https://help.example.com/policy-${Date.now()}`);
    await agentPage.getByRole('button', { name: 'Add source' }).click();

    // It lands in the list, indexed, and filters under the Websites sub-tab.
    await agentPage.getByRole('tab', { name: /Websites/ }).click();
    await expect(agentPage.getByText(title)).toBeVisible();

    await agentPage.screenshot({ path: 'kanit/33-knowledge-website.png', fullPage: true });
  });
});
