/**
 * The AI answers in the player's language (tm 387 · SiyahTuş analysis AI-30),
 * as an admin and a visitor see it.
 *
 * `multilingual.test.ts` (unit) and `ai-persona.test.ts` (integration) prove
 * the engine keeps a conversation's language, translates faithfully and hands
 * over an unsupported one. What they cannot prove is the surface: an admin
 * turns Russian on in General settings — and sees the starting language and
 * the per-language translation switch it brings — saves, and a real visitor
 * in a real widget who writes Russian reads Russian: the persona's opener and
 * the answer from a Russian knowledge source. The widget's own words stay in
 * its eight languages (K25): only the AI speaks Russian.
 *
 * The knowledge source carries a marker unique to this run (retrieval is
 * lexical), and the persona is put back afterwards so the shared seed agent
 * reads as it did for the specs after this one.
 */
import {
  expect,
  test,
  openWidget,
  tenantSubdomain,
  visitorSends,
  widgetFrame,
} from './fixtures.js';

test.describe('the AI in the player’s language (AI-30)', () => {
  test('Russian turned on in the profile: a Russian visitor reads Russian', async ({
    agentPage,
    browser,
    organizationId,
  }) => {
    test.setTimeout(120_000);

    const run = Date.now().toString().slice(-6);
    const marker = `zakaz${run}`;
    const passage = `Delivery заказа ${marker} занимает три дня, и с вами свяжется наш курьер.`;
    // Russian with the one English word the seeded skill's gate listens for
    // ("delivery") — how a player writes a brand's own term.
    const question = `Когда будет delivery заказа ${marker} и как с вами связаться?`;

    // --- A Russian knowledge source only this run's question can match --------
    await agentPage.goto('/app/playbook?view=skills');
    const tabs = agentPage.getByRole('tablist', { name: 'AI Agent' });
    await tabs.getByRole('tab', { name: 'Knowledge' }).click();
    await agentPage.getByLabel('Title').fill(`Русский ${run}`);
    await agentPage.getByLabel('Content').fill(passage);
    await Promise.all([
      agentPage.waitForResponse(
        (response) =>
          response.request().method() === 'POST' && response.url().endsWith('/knowledge-sources'),
      ),
      agentPage.getByRole('button', { name: 'Add source' }).click(),
    ]);

    // --- Russian on, and what it brings with it --------------------------------
    await tabs.getByRole('tab', { name: 'General settings' }).click();
    const russian = agentPage.getByRole('switch', { name: 'Русский', exact: true });
    const save = agentPage.getByRole('button', { name: 'Save profile' });
    const wasOn = (await russian.getAttribute('aria-checked')) === 'true';
    if (!wasOn) await russian.click();
    await expect(russian).toHaveAttribute('aria-checked', 'true');
    await expect(agentPage.getByLabel('Starting language')).toBeVisible();
    await expect(
      agentPage
        .getByRole('group', { name: 'Translate the knowledge' })
        .getByRole('checkbox', { name: 'Русский' }),
    ).toBeChecked();
    if (await save.isEnabled()) {
      await Promise.all([
        agentPage.waitForResponse(
          (response) =>
            response.request().method() === 'PATCH' && /\/ai-agents\//.test(response.url()),
        ),
        save.click(),
      ]);
      await expect(save).toBeDisabled();
    }

    try {
      // --- A visitor writes Russian ------------------------------------------------
      const site = tenantSubdomain(`multilingual-${run}`);
      const context = await browser.newContext();
      try {
        const visitor = await context.newPage();
        await openWidget(visitor, organizationId, { host: site.origin });
        await visitorSends(visitor, question);

        const reply = widgetFrame(visitor).locator('.nx-row--bot .nx-bubble').last();
        await expect(reply).toContainText(passage, { timeout: 20_000 });
        // Ada's friendly tone, said in Russian — the persona's words in the player's language.
        await expect(reply).toContainText('С удовольствием помогу!');
        await visitor.screenshot({ path: 'kanit/AI-30-russian-reply.png', fullPage: true });
      } finally {
        await context.close();
      }
    } finally {
      // --- Put the persona back for the specs after this one ----------------------
      if (!wasOn) {
        await russian.click();
        await expect(russian).toHaveAttribute('aria-checked', 'false');
        if (await save.isEnabled()) {
          await save.click();
          await expect(save).toBeDisabled();
        }
      }
    }
  });
});
