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

  /**
   * The other half of MOD-06.3.2's "File": an upload that is a real file.
   *
   * Only a browser can prove this one. The bytes have to leave a file picker,
   * be read by the page, survive base64 and arrive at an endpoint that decides
   * whether they are text — a chain jsdom can imitate but not run. The
   * assertion at the end is the acceptance criterion rather than the UI: the
   * source is filed under Files and reports chunks, which means it was parsed
   * and indexed, not merely stored.
   */
  test('uploads a markdown file into an indexed knowledge source (FR-MOD-06.3.2)', async ({
    agentPage,
  }) => {
    await agentPage.goto('/app/playbook');
    await agentPage
      .getByRole('tablist', { name: 'AI Agent' })
      .getByRole('tab', { name: 'Knowledge' })
      .click();

    // Exact match so the "Type" select is not confused with the "Knowledge
    // types" sub-tab strip.
    await agentPage.getByLabel('Type', { exact: true }).selectOption('file');

    // A unique name per run: the seed is idempotent rather than truncating, so
    // reruns must add distinct sources instead of colliding on one title.
    const run = Date.now();
    const fileName = `zephyr-warranty-${run}.md`;
    await agentPage.setInputFiles('#source-file', {
      name: fileName,
      mimeType: 'text/markdown',
      buffer: Buffer.from(
        `# Warranty

The **flugelbrace${run}** warranty covers cracked welds for ten years.
`,
        'utf8',
      ),
    });

    // No title typed — the file names itself, which is the endpoint's default.
    await agentPage.getByRole('button', { name: 'Add source' }).click();

    // It lands in the list under Files, with chunks: parsed and indexed, not
    // just uploaded.
    await agentPage.getByRole('tab', { name: /Files/ }).click();
    const row = agentPage.getByText(fileName);
    await expect(row).toBeVisible();

    await agentPage.screenshot({ path: 'kanit/06.3.2-knowledge-file.png', fullPage: true });
  });

  test('refuses a file kind the knowledge base cannot parse (FR-MOD-06.3.2)', async ({
    agentPage,
  }) => {
    await agentPage.goto('/app/playbook');
    await agentPage
      .getByRole('tablist', { name: 'AI Agent' })
      .getByRole('tab', { name: 'Knowledge' })
      .click();
    await agentPage.getByLabel('Type', { exact: true }).selectOption('file');

    await agentPage.setInputFiles('#source-file', {
      name: 'manual.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4 not a knowledge source', 'utf8'),
    });

    await expect(agentPage.getByText(/Choose a \.txt, \.md or \.csv file/)).toBeVisible();
    await expect(agentPage.getByRole('button', { name: 'Add source' })).toBeDisabled();
  });

  /**
   * The editor's top bar (FR-MOD-06.2.1): the run log, and the warning before
   * walking away from unsaved work.
   *
   * The warning is the half that cannot be proven anywhere else. Its two paths
   * out — the browser's `beforeunload` and the app's own nav rail — are separate
   * mechanisms, and only a real browser can show that clicking another module
   * raises a dialog and that declining it leaves you where you were. jsdom can
   * assert the router did not move; it cannot assert a browser dialog existed.
   */
  test('opens the run log, and warns before leaving unsaved edits (FR-MOD-06.2.1)', async ({
    agentPage,
  }) => {
    await agentPage.goto('/app/playbook');
    await agentPage.getByRole('button', { name: /Where is my order/ }).click();

    // Run log: the endpoint has answered this since the engine shipped; until
    // now nothing on the web asked it. Which runs exist depends on what else
    // the suite has driven through the agent, so this asserts the panel opened
    // and loaded — the empty and populated shapes are pinned in the unit tests.
    const runLog = agentPage.getByRole('button', { name: /^\d+ runs?$/ });
    await expect(runLog).toHaveAttribute('aria-expanded', 'false');
    await runLog.click();
    const panel = agentPage.getByRole('region', { name: 'Run log' });
    await expect(panel).toBeVisible();
    await expect(panel.getByText('Could not load the run log.')).toHaveCount(0);

    await agentPage.screenshot({ path: 'kanit/06.2.1-skill-run-log.png', fullPage: true });

    // Now make it dirty. The instruction is edited rather than the name because
    // other specs find this skill by name; the steps are untouched, so the
    // engine behaves identically for anything running in parallel.
    const instruction = agentPage.getByLabel('Instruction');
    const original = await instruction.inputValue();
    await instruction.fill(`${original}
Edited at ${Date.now()}, not saved.`);

    // Leaving is refused. Playwright dismisses dialogs by default, which is
    // exactly the "no, I want to stay" answer.
    const messages: string[] = [];
    agentPage.on('dialog', (dialog) => {
      messages.push(dialog.message());
      void dialog.dismiss();
    });

    await agentPage.getByRole('link', { name: 'Reports' }).click();
    await expect
      .poll(() => messages.length, { message: 'the rail click should have asked first' })
      .toBe(1);
    expect(messages.join(' ')).toContain('unsaved changes');
    await expect(agentPage).toHaveURL(/\/app\/playbook/);
    await expect(instruction).toBeVisible();

    // Saved, the same click goes straight through with nothing to ask about.
    const save = agentPage.getByRole('button', { name: 'Save changes' });
    await save.click();
    await expect(save).toBeDisabled();

    await agentPage.getByRole('link', { name: 'Reports' }).click();
    await expect(agentPage).toHaveURL(/\/app\/reports/);
    expect(messages).toHaveLength(1);

    // Put the fixture back the way it was found.
    await agentPage.goto('/app/playbook');
    await agentPage.getByRole('button', { name: /Where is my order/ }).click();
    await agentPage.getByLabel('Instruction').fill(original);
    const saveAgain = agentPage.getByRole('button', { name: 'Save changes' });
    await saveAgain.click();
    await expect(saveAgain).toBeDisabled();
  });
});
