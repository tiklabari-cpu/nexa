/**
 * Reply Suggestions, in the language the agent works in (FR-MOD-02.3.2).
 *
 * The chip → editable-composer hand-off has been pinned in jsdom since tm 39,
 * and the Turkish wording since tm 219. What only a real browser proves is the
 * join between the two halves: an agent who switched the console to Turkish
 * through the account menu, on a live session, answering a visitor who wrote in
 * Turkish, gets a Turkish chip shaped to what that visitor actually said — and
 * not one of the fixed English sentences the generator used to hard-code, which
 * is the defect this requirement was reopened for.
 *
 * Turkish present first, English absent second — the discipline `i18n.spec.ts`
 * sets out: `toHaveCount(0)` on a row that has not rendered yet passes for the
 * wrong reason.
 *
 * The conversation is created through the widget rather than picked out of the
 * seed, following `inbox-retry.spec.ts`: the composer only exists on an *active*
 * chat, and which seeded conversation is still active depends on what every
 * other spec in the run has archived — the first row of the All view is one of
 * them today and was measured archived. A visitor of our own is the only
 * conversation this test can make a claim about.
 */
import type { Page } from '@playwright/test';
import { expect, openWidget, signIn, test, visitorSends } from './fixtures.js';

/** The chip the two holding replies always contribute, whatever was said. */
const TR_HOLDING = 'Hâlâ üzerinde çalışıyorum — biraz sabrettiğiniz için teşekkürler.';
/** The chip an order/refund intent leads with — the context half, read in Turkish. */
const TR_ORDER = 'Memnuniyetle yardımcı olayım — kaydınızı açıp hemen bakıyorum.';

/** What those two chips said before tm 219, in every language. */
const EN_HOLDING = /still on it — please bear with me/i;
const EN_ORDER = /happy to help with that/i;

test.describe('reply suggestions (FR-MOD-02.3.2 · NFR-I18N2)', () => {
  test('a Turkish visitor gets a Turkish chip, and it fills the composer', async ({
    browser,
    organizationId,
  }) => {
    const visitorContext = await browser.newContext();
    const agentContext = await browser.newContext();
    const visitor = await visitorContext.newPage();
    const agent = await agentContext.newPage();

    try {
      await signIn(agent);
      await agent.getByLabel('Availability').selectOption('accepting_chats');

      // Six digits rather than thirteen: a 13-digit run would be rewritten by
      // card masking (FR-MOD-08.9.5) and would not read back verbatim.
      const question = `Siparişimi iptal etmek istiyorum — ${Date.now().toString().slice(-6)}`;
      await openWidget(visitor, organizationId);
      await visitorSends(visitor, question);

      // The agent works in Turkish from here on.
      await chooseTurkish(agent);
      await expect(agent.getByRole('heading', { name: 'Gelen Kutusu', level: 1 })).toBeVisible();

      const list = agent.getByRole('region', { name: 'Sohbetler' });
      await expect(list).toContainText(question, { timeout: 20_000 });
      await list.getByRole('button').first().click();
      await expect(agent.locator('main')).toContainText(question);

      const reply = agent.getByLabel('Müşteriye yanıt ver');
      await expect(reply).toBeVisible();
      await expect(reply).toHaveValue('');

      // Space in the empty reply field is the shortcut (v2-01 §307).
      await reply.press(' ');
      const chips = agent.getByRole('group', { name: 'Yanıt önerileri' });
      await expect(chips).toBeVisible();

      // Turkish first. Two chips, for two different reasons: the lead is the
      // *context* half (the visitor's Turkish "sipariş/iptal" was read at all),
      // the holding line is the half every conversation gets.
      const order = chips.getByRole('button', { name: TR_ORDER });
      await expect(order).toBeVisible();
      await expect(chips.getByRole('button', { name: TR_HOLDING })).toBeVisible();

      // English absent second — and only now that the row has rendered.
      await expect(agent.getByText(EN_HOLDING)).toHaveCount(0);
      await expect(agent.getByText(EN_ORDER)).toHaveCount(0);

      // Still a row and not a menu. The dismiss "×" carries an aria-label; the
      // chips do not, which is how they are told apart.
      const chipButtons = chips.getByRole('button').filter({ hasNotText: '×' });
      expect(await chipButtons.count()).toBeLessThanOrEqual(4);

      await agent.screenshot({ path: 'kanit/02.3.2-suggestions-tr.png', fullPage: true });

      // The acceptance criterion, in Turkish: the chip's text lands in the
      // composer as editable text, and the row retracts.
      await order.click();
      await expect(reply).toHaveValue(TR_ORDER);
      await expect(chips).toBeHidden();

      // Editable, not a locked-in send — the agent keeps typing on the end of it.
      await reply.pressSequentially(' Sipariş numaranız nedir?');
      await expect(reply).toHaveValue(`${TR_ORDER} Sipariş numaranız nedir?`);

      await agent.screenshot({ path: 'kanit/02.3.2-suggestions-tr-composer.png', fullPage: true });
    } finally {
      await visitorContext.close();
      await agentContext.close();
    }
  });
});

/**
 * Switch the console to Turkish through the account menu — the control an agent
 * actually uses, rather than writing the preference into storage behind the
 * product's back.
 *
 * The menu is a `<details>`, so its trigger toggles: it has to be closed again
 * before anything else on the page is reached for (the trap `i18n.spec.ts`
 * records).
 */
async function chooseTurkish(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Account' }).click();
  await page.getByLabel('Language').selectOption('tr');
  await page.keyboard.press('Escape');
  await expect(page.getByLabel('Dil')).toBeHidden();
}
