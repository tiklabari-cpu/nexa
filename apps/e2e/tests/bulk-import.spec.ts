/**
 * Bulk CSV knowledge import, end to end (FR-MOD-06.3.2 — the "bulk/CSV import"
 * arm of the acceptance criterion).
 *
 * Seven units already cover the pieces — the RFC 4180 reader, the row schema,
 * the endpoint, the two React components, the crawl budget. What none of them
 * can prove is the thing the criterion actually claims: that an admin can pick
 * a spreadsheet out of their filesystem and end up with knowledge the AI
 * answers from. Each layer is stubbed at its own boundary, so a preview that
 * disagrees with the import, a file the browser never manages to read, a source
 * that lands under the wrong sub-tab, or a chunk that is written but never
 * retrieved would all pass every one of them.
 *
 * So this drives the whole journey in one browser session, and finishes on the
 * only evidence that "RAG indexing" is real: a question whose answer exists
 * nowhere but in the CSV that was just uploaded, asked through the skill
 * Preview — the same `SkillEngine` → `KnowledgeService.retrieve` path a live
 * customer message takes (`skill-engine.ts` `#sendMessage`), minus the writes.
 * The reply comes back as the imported sentence and the run log names the
 * imported source, which is the citation.
 *
 * The file also carries the two rows that must *not* import: an unknown `type`,
 * and a `website` row pointed at the cloud metadata address. Both have to show
 * up as skipped rows beside the successful ones — partial success is the
 * contract, and a refusal that quietly took the whole file with it would be a
 * different product.
 */
import { expect, test } from './fixtures.js';

/** Column order is free-form; this is simply the order the template writes. */
const CSV_HEADER = 'name,type,content,source_url';

test.describe('knowledge — bulk CSV import (FR-MOD-06.3.2)', () => {
  test('a CSV imports row by row, skips what it must, and answers through RAG', async ({
    agentPage,
  }) => {
    // One long journey rather than four short ones: every step after the upload
    // depends on the rows written by the step before, and re-importing per test
    // would prove less while costing more. The default 45s budget covers a
    // single screen, not five plus three crawls.
    test.setTimeout(120_000);

    // Unique per run. `global-setup` reseeds but the seed is idempotent — it
    // does not truncate — so sources accumulate across runs and a fixed name
    // would collide with yesterday's.
    const run = Date.now().toString().slice(-6);

    // The marker is a nonsense token on purpose. Retrieval here is lexical
    // (`@nexa/ai-mock`'s hashed bag of words), so a word that exists in no
    // seeded source and in no other row of this file makes the retrieval
    // unambiguous: if the answer comes back, it came back from this CSV.
    const marker = `flugelbrace${run}`;
    const articleName = `Zephyr warranty ${run}`;
    const articleContent = `The ${marker} warranty covers cracked welds for ten years from purchase.`;
    const faqName = `Zephyr sizing ${run}`;
    const faqContent = 'Frame sizes run from 48 to 62 centimetres. Measure inseam before choosing a size.';
    const websiteName = `Zephyr recall ${run}`;
    const websiteUrl = `https://help.example.com/zephyr-recall-${run}`;
    const badTypeName = `Broken type ${run}`;
    const metadataProbeName = `Metadata probe ${run}`;

    const csv =
      [
        CSV_HEADER,
        `${articleName},article,"${articleContent}",`,
        `${faqName},faq,"${faqContent}",`,
        `${websiteName},website,,${websiteUrl}`,
        // Rejected on its own row by the schema: `podcast` is not one of the
        // four kinds the knowledge list can file a source under.
        `${badTypeName},podcast,"A row nobody should be able to import.",`,
        // Rejected by the SSRF guard, per row, before any fetch is attempted —
        // 169.254.169.254 is the cloud instance metadata address.
        `${metadataProbeName},website,,http://169.254.169.254/latest/meta-data/`,
      ].join('\r\n') + '\r\n';

    const fileName = `nexa-bulk-${run}.csv`;

    await agentPage.goto('/app/playbook');
    await agentPage
      .getByRole('tablist', { name: 'AI Agent' })
      .getByRole('tab', { name: 'Knowledge' })
      .click();

    // --- The template an admin starts from ----------------------------------
    await agentPage.getByRole('button', { name: 'Bulk import' }).click();

    const downloadPromise = agentPage.waitForEvent('download');
    await agentPage.getByRole('button', { name: 'Download template' }).click();
    const template = await downloadPromise;
    expect(template.suggestedFilename()).toBe('knowledge-bulk-import-template.csv');

    // --- Preview: the server judges the file, nothing is written ------------
    await agentPage.setInputFiles('#bulk-import-file', {
      name: fileName,
      mimeType: 'text/csv',
      buffer: Buffer.from(csv, 'utf8'),
    });

    // The preview table is named after the file it previews, so this locator
    // cannot accidentally match the completed-import table later on.
    const preview = agentPage.getByRole('table', { name: `Preview — ${fileName}` });
    await expect(preview).toBeVisible({ timeout: 30_000 });
    await expect(preview.getByRole('row').filter({ hasText: articleName })).toContainText('Imported');
    await expect(preview.getByRole('row').filter({ hasText: badTypeName })).toContainText('Skipped');
    await expect(
      preview.getByRole('row').filter({ hasText: metadataProbeName }),
    ).toContainText('Skipped');
    await expect(agentPage.getByText('3 imported · 2 skipped').first()).toBeVisible();

    // A dry run writes nothing: the three good rows are still absent from the
    // source list underneath. Proving this before Import is what makes the
    // preview a preview rather than a differently-worded import. Scoped to the
    // list — the preview table names these rows too, which is the point of it.
    const sourceNamed = (name: string) =>
      agentPage.getByRole('listitem').filter({ hasText: name });
    await expect(sourceNamed(articleName)).toHaveCount(0);

    await agentPage.screenshot({ path: 'kanit/33-bulk-import-preview.png', fullPage: true });

    // --- Import: the same verdicts, this time with rows behind them ---------
    await agentPage.getByRole('button', { name: 'Import', exact: true }).click();

    const imported = agentPage.getByRole('table', { name: 'Import complete' });
    await expect(imported).toBeVisible({ timeout: 60_000 });
    await expect(imported.getByRole('row').filter({ hasText: articleName })).toContainText(
      'Imported',
    );
    await expect(imported.getByRole('row').filter({ hasText: faqName })).toContainText('Imported');
    // The website row went out to the (mocked) network, was parsed, and indexed.
    await expect(imported.getByRole('row').filter({ hasText: websiteName })).toContainText(
      'Imported',
    );

    // Each refusal keeps its row number and says which field failed. The SSRF
    // refusal deliberately names no host, address or scheme (`knowledge-bulk-
    // crawl.ts`): across 200 rows a distinguishable reason is a free network map.
    const badTypeRow = imported.getByRole('row').filter({ hasText: badTypeName });
    await expect(badTypeRow).toContainText('Skipped');
    await expect(badTypeRow).toContainText(/type:/);
    const probeRow = imported.getByRole('row').filter({ hasText: metadataProbeName });
    await expect(probeRow).toContainText('Skipped');
    await expect(probeRow).toContainText('this URL cannot be fetched');
    await expect(probeRow).not.toContainText('169.254');

    await agentPage.screenshot({ path: 'kanit/33-bulk-import-results.png', fullPage: true });

    await agentPage.getByRole('button', { name: 'Done' }).click();

    // --- The sources are really in the knowledge base, filed by kind --------
    const kinds = agentPage.getByRole('tablist', { name: 'Knowledge types' });

    await kinds.getByRole('tab', { name: /Articles/ }).click();
    await expect(sourceNamed(articleName)).toBeVisible();

    await kinds.getByRole('tab', { name: /FAQ/ }).click();
    await expect(sourceNamed(faqName)).toBeVisible();

    await kinds.getByRole('tab', { name: /Websites/ }).click();
    const websiteRow = sourceNamed(websiteName);
    await expect(websiteRow).toBeVisible();
    // Crawled *and* parsed: a source with chunks is what the list calls Indexed.
    await expect(websiteRow).toContainText('Indexed');
    await expect(websiteRow).toContainText(websiteUrl);

    // Neither refused row became a source anywhere in the list.
    await kinds.getByRole('tab', { name: /^All/ }).click();
    await expect(sourceNamed(badTypeName)).toHaveCount(0);
    await expect(sourceNamed(metadataProbeName)).toHaveCount(0);

    // --- RAG: the imported text is what the AI answers with -----------------
    // Preview runs the real engine against the real index (`POST /skills/
    // preview`), scoped to this workspace's AI agent — the same agent the bulk
    // import wrote into. Nothing is stubbed between the question and pgvector.
    await agentPage
      .getByRole('tablist', { name: 'AI Agent' })
      .getByRole('tab', { name: 'Skills' })
      .click();

    await agentPage
      .getByRole('region', { name: 'Recommended skills' })
      .getByRole('button', { name: 'Try this' })
      .first()
      .click();
    await expect(agentPage.getByLabel('Name')).toHaveValue('Where is my order?');

    await agentPage
      .getByLabel('A message a customer might send')
      .fill(`Where is my order — does the ${marker} warranty cover a cracked weld?`);
    await agentPage.getByRole('button', { name: 'Run preview' }).click();

    // The answer is the sentence that arrived in the CSV a minute ago, and the
    // run log cites the source it came from by name. Neither string exists in
    // the seed.
    const reply = agentPage.locator('p').filter({ hasText: 'Reply to the customer' });
    await expect(reply).toContainText(articleContent);
    await expect(agentPage.locator('li').filter({ hasText: 'answered from' })).toContainText(
      articleName,
    );

    // The preview card sits below the fold on a default viewport, and a
    // screenshot that does not show the answer is not evidence of one.
    await reply.scrollIntoViewIfNeeded();
    await agentPage.screenshot({ path: 'kanit/33-bulk-import-rag-answer.png', fullPage: true });
  });
});
