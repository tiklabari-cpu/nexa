/**
 * The persona's effect on an answer, as a customer actually sees it
 * (FR-MOD-06.4).
 *
 * `ai-persona.test.ts` (integration) already proves the engine shapes a reply
 * from a persona written straight to the database, posted straight to
 * `/customer/chat/events`. What that cannot prove is the surface this field
 * exists for: an admin changes the Answer length select in the Profile tab
 * (the same tab `ai-agent.spec.ts`'s persona-edit test drives for the other two
 * fields), saves, and a real visitor in a real cross-origin widget gets a
 * measurably different reply — no direct database writes, no API shortcuts.
 *
 * The knowledge article below is added through the same Knowledge tab
 * `ai-agent.spec.ts` and `bulk-import.spec.ts` already exercise, and carries a
 * marker unique to this run for the same reason `bulk-import.spec.ts`'s does:
 * retrieval is lexical, so a token that exists nowhere else in Ada's knowledge
 * base makes the answer unambiguous — if the reply contains it, it came from
 * here and not from the seeded "Delivery and returns" source.
 */
import {
  expect,
  test,
  openWidget,
  tenantSubdomain,
  visitorSends,
  widgetFrame,
} from './fixtures.js';

test.describe('persona — answer length, on a real customer (FR-MOD-06.4)', () => {
  test('an answer_length change is visible in the widget, measurably', async ({
    agentPage,
    browser,
    organizationId,
  }) => {
    test.setTimeout(120_000);

    const run = Date.now().toString().slice(-6);
    const marker = `parcelflux${run}`;
    const passage =
      `Standard ${marker} delivery takes 3 to 5 working days. ` +
      `Tracking for a ${marker} order is emailed the moment it dispatches. ` +
      `A weekend ${marker} order leaves the warehouse on the next working day. ` +
      `International ${marker} delivery takes two extra days.`;
    const firstSentence = `Standard ${marker} delivery takes 3 to 5 working days.`;
    const secondSentenceFragment = `Tracking for a ${marker} order`;
    const question = `Where is my order — how long does ${marker} delivery take?`;

    // --- A knowledge source only this run's question can match --------------
    await agentPage.goto('/app/playbook');
    await agentPage
      .getByRole('tablist', { name: 'AI Agent' })
      .getByRole('tab', { name: 'Knowledge' })
      .click();
    await agentPage.getByLabel('Title').fill(`Persona proof ${run}`);
    await agentPage.getByLabel('Content').fill(passage);
    await Promise.all([
      agentPage.waitForResponse(
        (response) =>
          response.request().method() === 'POST' && response.url().endsWith('/knowledge-sources'),
      ),
      agentPage.getByRole('button', { name: 'Add source' }).click(),
    ]);

    // --- The persona: English declared, no tone (so an opener never dilutes
    // the character budget the test measures), starting on "short" -----------
    await agentPage
      .getByRole('tablist', { name: 'AI Agent' })
      .getByRole('tab', { name: 'Profile' })
      .click();
    await agentPage.getByLabel('Tone').fill('');
    const english = agentPage.getByRole('switch', { name: 'English' });
    if ((await english.getAttribute('aria-checked')) !== 'true') await english.click();

    async function setAnswerLength(value: 'short' | 'long'): Promise<void> {
      await agentPage.getByLabel('Answer length').selectOption(value);
      const save = agentPage.getByRole('button', { name: 'Save profile' });
      // Nothing to persist if this and the earlier Tone/English edits already
      // match what is saved — the seed may already have this exact shape.
      if (await save.isDisabled()) return;
      await save.click();
      // Save settles back to disabled once the PATCH persists and refetches.
      await expect(save).toBeDisabled();
    }

    await setAnswerLength('short');

    // --- Short: a fresh visitor, a one-sentence reply ------------------------
    const shortSite = tenantSubdomain(`persona-short-${run}`);
    const shortContext = await browser.newContext();
    let shortLength = 0;
    try {
      const shortVisitor = await shortContext.newPage();
      await openWidget(shortVisitor, organizationId, { host: shortSite.origin });
      await visitorSends(shortVisitor, question);

      const shortFrame = widgetFrame(shortVisitor);
      const shortReply = shortFrame.locator('.nx-row--bot .nx-bubble').last();
      await expect(shortReply).toContainText(firstSentence, { timeout: 20_000 });
      // The budget this run is proving: "short" pays for one sentence only.
      await expect(shortReply).not.toContainText(secondSentenceFragment);
      shortLength = ((await shortReply.textContent()) ?? '').length;

      await shortVisitor.screenshot({
        path: 'kanit/06.4-persona-widget-short.png',
        fullPage: true,
      });
    } finally {
      await shortContext.close();
    }

    // --- Long: the same question, a persona now asking for more -------------
    await setAnswerLength('long');

    const longSite = tenantSubdomain(`persona-long-${run}`);
    const longContext = await browser.newContext();
    let longLength = 0;
    try {
      const longVisitor = await longContext.newPage();
      await openWidget(longVisitor, organizationId, { host: longSite.origin });
      await visitorSends(longVisitor, question);

      const longFrame = widgetFrame(longVisitor);
      const longReply = longFrame.locator('.nx-row--bot .nx-bubble').last();
      await expect(longReply).toContainText(firstSentence, { timeout: 20_000 });
      // The stitched extra sentence only a "long" budget pays for.
      await expect(longReply).toContainText(secondSentenceFragment, { timeout: 20_000 });
      longLength = ((await longReply.textContent()) ?? '').length;

      await longVisitor.screenshot({ path: 'kanit/06.4-persona-widget-long.png', fullPage: true });
    } finally {
      await longContext.close();
    }

    // The measurable gate: the same question, a longer answer, in a real
    // customer's browser — not "looks different", a length a test can assert.
    expect(longLength).toBeGreaterThan(shortLength + 40);
  });
});
