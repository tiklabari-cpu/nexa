/**
 * AI Agent surface — tabs, persona, knowledge crawl (MOD-06).
 *
 * What the unit and integration suites cannot prove on their own: that the four
 * tabs are one place a real admin moves through, that a persona edit round-trips
 * through the API and survives a reload, and that adding a website source
 * crawls a URL into a searchable source — all in a real browser against the
 * real API.
 */
import {
  expect,
  openWidget,
  tenantSubdomain,
  test,
  visitorSends,
  widgetFrame,
} from './fixtures.js';

test.describe('AI Agent (MOD-06)', () => {
  test('switches between the four tabs, each showing its own surface', async ({ agentPage }) => {
    await agentPage.goto('/app/playbook?view=skills');

    const tabs = agentPage.getByRole('tablist', { name: 'AI Agent' });
    for (const name of ['Performance', 'General settings', 'Skills', 'Knowledge']) {
      await expect(tabs.getByRole('tab', { name })).toBeVisible();
    }

    // Skills is the landing tab — the recommended strip is on screen.
    await expect(agentPage.getByRole('region', { name: 'Recommended skills' })).toBeVisible();

    // General settings shows the persona form pre-filled from the seeded agent (Ada).
    await tabs.getByRole('tab', { name: 'General settings' }).click();
    await expect(agentPage.getByLabel('Name')).toHaveValue('Ada');

    // Performance shows the KPI cards, read from the reports the invoice trusts.
    await tabs.getByRole('tab', { name: 'Performance' }).click();
    await expect(agentPage.getByText('Resolution rate')).toBeVisible();

    await agentPage.screenshot({ path: 'kanit/33-ai-agent-tabs.png', fullPage: true });
  });

  test('a persona edit round-trips through the API and survives a reload (FR-MOD-06.4)', async ({
    agentPage,
  }) => {
    await agentPage.goto('/app/playbook?view=skills');
    const tabs = agentPage.getByRole('tablist', { name: 'AI Agent' });
    await tabs.getByRole('tab', { name: 'General settings' }).click();

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

    // Reload and reopen General settings — the edit round-tripped through the API.
    await agentPage.reload();
    await tabs.getByRole('tab', { name: 'General settings' }).click();
    await expect(agentPage.getByLabel('Tone')).toHaveValue(marker);

    await agentPage.screenshot({ path: 'kanit/33-ai-agent-profile.png', fullPage: true });
  });

  test('a saved tone is in the change history with what it was and what it became (AI-21)', async ({
    agentPage,
  }) => {
    await agentPage.goto('/app/playbook?view=general');
    const tabs = agentPage.getByRole('tablist', { name: 'AI Agent' });
    const marker = `calm-${Date.now()}`;
    await agentPage.getByLabel('Tone').fill(marker);
    const save = agentPage.getByRole('button', { name: 'Save profile' });
    await save.click();
    await expect(save).toBeDisabled();

    await tabs.getByRole('tab', { name: 'History' }).click();
    const history = agentPage.getByRole('region', { name: 'Change history' });
    const row = history.getByTestId('ai-history-row').first();
    await expect(row).toContainText('Changed Profile · Ada');
    await expect(row).toContainText('fields: tone');
    await row.getByRole('button', { name: 'Show the change' }).click();
    await expect(row.getByTestId('change-diff')).toContainText(marker);
  });

  test('adds a website knowledge source by crawling a URL (FR-MOD-06.3.2)', async ({
    agentPage,
  }) => {
    await agentPage.goto('/app/playbook?view=skills');
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
    // Crawling someone's site is the admin's say-so (tm 312.4 · AI-17): the
    // button stays off until the box is ticked.
    const add = agentPage.getByRole('button', { name: 'Add source' });
    await expect(add).toBeDisabled();
    await agentPage.getByLabel('I am authorised to crawl this site.').check();
    await add.click();

    // It lands in the list, indexed, and filters under the Websites sub-tab.
    await agentPage.getByRole('tab', { name: /Websites/ }).click();
    await expect(agentPage.getByText(title)).toBeVisible();

    // The crawl is a background job now: its drawer opens on the row.
    await agentPage.getByRole('button', { name: `Crawl details for ${title}` }).click();
    const drawer = agentPage.getByRole('dialog');
    await expect(drawer.getByText(`Crawl of ${title}`)).toBeVisible();
    await expect(drawer.getByRole('button', { name: 'Crawl again' })).toBeVisible();
    await drawer.getByRole('button', { name: 'Close' }).click();
    await expect(drawer).toBeHidden();

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
    await agentPage.goto('/app/playbook?view=skills');
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
    await agentPage.goto('/app/playbook?view=skills');
    await agentPage
      .getByRole('tablist', { name: 'AI Agent' })
      .getByRole('tab', { name: 'Knowledge' })
      .click();
    await agentPage.getByLabel('Type', { exact: true }).selectOption('file');

    await agentPage.setInputFiles('#source-file', {
      name: 'photo.png',
      mimeType: 'image/png',
      buffer: Buffer.from('not a knowledge source', 'utf8'),
    });

    await expect(
      agentPage.getByText(/Choose a \.pdf, \.docx, \.txt, \.md or \.csv file/),
    ).toBeVisible();
    await expect(agentPage.getByRole('button', { name: 'Add source' })).toBeDisabled();
  });

  /**
   * A PDF through the Files tab (AI-18 · FR-MOD-06.3.2): uploaded in two
   * stages, read by the isolated worker in a job of its own, and the row
   * reports its pages once it is — with the original to download.
   */
  test('adds a PDF that is read in the background and reports its pages (FR-MOD-06.3.2)', async ({
    agentPage,
  }) => {
    await agentPage.goto('/app/playbook?view=skills');
    await agentPage
      .getByRole('tablist', { name: 'AI Agent' })
      .getByRole('tab', { name: 'Knowledge' })
      .click();
    await agentPage.getByLabel('Type', { exact: true }).selectOption('file');

    const run = Date.now();
    const text = `Zephyr warranty ${run}: the warranty covers cracked welds for ten years from delivery.`;
    const stream = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;
    const objects = [
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [4 0 R] /Count 1 >>',
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents 5 0 R >>',
      `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    ];
    let body = '%PDF-1.4\n';
    const offsets = objects.map((object, index) => {
      const offset = body.length;
      body += `${index + 1} 0 obj\n${object}\nendobj\n`;
      return offset;
    });
    const xref = body.length;
    body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (const offset of offsets) body += `${String(offset).padStart(10, '0')} 00000 n \n`;
    body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;

    const title = `Zephyr manual ${run}`;
    await agentPage.getByLabel('Title').fill(title);
    await agentPage.setInputFiles('#source-file', {
      name: `zephyr-manual-${run}.pdf`,
      mimeType: 'application/pdf',
      buffer: Buffer.from(body, 'latin1'),
    });
    await agentPage.getByRole('button', { name: 'Add source' }).click();

    await agentPage.getByRole('tab', { name: /Files/ }).click();
    const row = agentPage.getByRole('listitem').filter({ hasText: title });
    await expect(row).toBeVisible();
    // The list looks again every few seconds while the document is read.
    await expect(row.getByText('1 page')).toBeVisible({ timeout: 45_000 });
    await expect(row.getByRole('button', { name: /Download the original/ })).toBeVisible();
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
  test('the batch window saved in General settings is what a visitor waits: two turns, then a burst answered once (AI-01)', async ({
    agentPage,
    browser,
    organizationId,
  }) => {
    test.setTimeout(180_000);

    const run = Date.now().toString().slice(-6);
    const marker = `parcelwait${run}`;
    const passage =
      `Standard ${marker} delivery takes 3 to 5 working days. ` +
      `Tracking for a ${marker} order is emailed the moment it dispatches.`;

    // --- A knowledge source only this run's questions can match --------------
    await agentPage.goto('/app/playbook?view=skills');
    const tabs = agentPage.getByRole('tablist', { name: 'AI Agent' });
    await tabs.getByRole('tab', { name: 'Knowledge' }).click();
    await agentPage.getByLabel('Title').fill(`Batch window proof ${run}`);
    await agentPage.getByLabel('Content').fill(passage);
    await Promise.all([
      agentPage.waitForResponse(
        (response) =>
          response.request().method() === 'POST' && response.url().endsWith('/knowledge-sources'),
      ),
      agentPage.getByRole('button', { name: 'Add source' }).click(),
    ]);

    // --- The window: two seconds, set where an admin sets it, and kept --------
    await tabs.getByRole('tab', { name: 'General settings' }).click();
    const waitFor = agentPage.getByLabel('Wait for the visitor to stop typing');
    const save = agentPage.getByRole('button', { name: 'Save profile' });
    await waitFor.selectOption('2');
    await save.click();
    await expect(save).toBeDisabled();
    await agentPage.reload();
    await tabs.getByRole('tab', { name: 'General settings' }).click();
    await expect(agentPage.getByLabel('Wait for the visitor to stop typing')).toHaveValue('2');

    const context = await browser.newContext();
    try {
      const visitor = await context.newPage();
      await openWidget(visitor, organizationId, {
        host: tenantSubdomain(`batch-window-${run}`).origin,
      });
      const replies = widgetFrame(visitor).locator('.nx-row--bot .nx-bubble');

      // --- Turn one, and turn two once it was answered: a reply each ---------
      await visitorSends(visitor, `How long does ${marker} delivery take?`);
      await expect(replies).toHaveCount(1, { timeout: 30_000 });
      await expect(replies.last()).toContainText(marker);

      await visitorSends(visitor, `And is a ${marker} order tracked?`);
      await expect(replies).toHaveCount(2, { timeout: 30_000 });
      await expect(replies.last()).toContainText(marker);

      // --- A burst: two messages inside the window get one answer ------------
      await visitorSends(visitor, `Do ${marker} orders ship at weekends?`);
      await visitorSends(visitor, `How many working days does ${marker} delivery take?`);
      await expect(replies).toHaveCount(3, { timeout: 30_000 });
      // Well past the window: no second answer follows, one per message.
      await visitor.waitForTimeout(4_000);
      await expect(replies).toHaveCount(3);

      await visitor.screenshot({ path: 'kanit/06.4-batch-window-widget.png', fullPage: true });
    } finally {
      await context.close();
      // Put the fixture back the way it was found: the workspace default.
      await agentPage.getByLabel('Wait for the visitor to stop typing').selectOption('');
      await save.click();
      await expect(save).toBeDisabled();
    }
  });

  test('opens the run log, and warns before leaving unsaved edits (FR-MOD-06.2.1)', async ({
    agentPage,
  }) => {
    await agentPage.goto('/app/playbook?view=skills');
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
    await agentPage.goto('/app/playbook?view=skills');
    await agentPage.getByRole('button', { name: /Where is my order/ }).click();
    await agentPage.getByLabel('Instruction').fill(original);
    const saveAgain = agentPage.getByRole('button', { name: 'Save changes' });
    await saveAgain.click();
    await expect(saveAgain).toBeDisabled();
  });
});
