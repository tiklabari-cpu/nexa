/**
 * Customer-facing copy carries no internal codes (tm 259.14, UX audit O7).
 *
 * The AI agents page, the Reports tabs and the Billing packages used to print
 * the repository's own bookkeeping in parentheses — "(FR-MOD-12.2)",
 * "(PRD §7.3.2)", "(ADR-13)". `locale-copy.test.ts` proves it for every catalogue
 * value; this proves it for what a browser actually renders on those pages, in
 * both languages, including hover text (`title`) and accessible names.
 */
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.js';

const INTERNAL_REF = /\b(?:N?FR-[A-Z0-9]|ADR-?\d|PRD\b|WORKSCHED|tm \d)|§\s*\d|\bNFR-[A-Z]/;

/** Everything a reader sees or hears on the page right now. */
async function readableText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const attrs = Array.from(
      document.querySelectorAll('[title], [aria-label], [aria-description]'),
    ).flatMap((el) =>
      ['title', 'aria-label', 'aria-description'].map((a) => el.getAttribute(a) ?? ''),
    );
    return [document.body.innerText, ...attrs].join('\n');
  });
}

async function expectNoInternalRef(page: Page, where: string): Promise<void> {
  const text = await readableText(page);
  const hit = INTERNAL_REF.exec(text);
  expect(hit, `${where}: "${hit?.[0]}" is shown to the customer`).toBeNull();
}

test.describe('no internal codes in customer copy', () => {
  test('the AI agents page and every Reports tab, in English', async ({ agentPage }) => {
    await agentPage.goto('/app/team/ai-agents');
    await expect(agentPage.getByRole('heading', { name: 'Copilot knowledge' })).toBeVisible();
    await expectNoInternalRef(agentPage, '/app/team/ai-agents');

    await agentPage.goto('/app/team');
    await expect(agentPage.getByRole('heading', { name: 'Team', level: 1 })).toBeVisible();
    await expectNoInternalRef(agentPage, '/app/team');

    await agentPage.goto('/app/reports');
    await expect(agentPage.getByRole('heading', { name: 'Reports', level: 1 })).toBeVisible();
    const tabs = agentPage.getByRole('tab');
    const names = await tabs.allInnerTexts();
    expect(names.length).toBeGreaterThan(3);
    for (const name of names) {
      await agentPage.getByRole('tab', { name: name.trim() }).first().click();
      await expect(agentPage.getByRole('tab', { name: name.trim() }).first()).toHaveAttribute(
        'aria-selected',
        'true',
      );
      await expectNoInternalRef(agentPage, `/app/reports › ${name.trim()}`);
    }
  });

  test('the same pages in Turkish', async ({ agentPage }) => {
    await agentPage.addInitScript(() => window.localStorage.setItem('siyahtus.locale', 'tr'));
    await agentPage.goto('/app/reports');
    await expect(agentPage.getByRole('heading', { name: 'Raporlar', level: 1 })).toBeVisible();
    const names = await agentPage.getByRole('tab').allInnerTexts();
    for (const name of names) {
      await agentPage.getByRole('tab', { name: name.trim() }).first().click();
      await expectNoInternalRef(agentPage, `/app/reports › ${name.trim()}`);
    }
    await agentPage.goto('/app/team/ai-agents');
    await expect(agentPage.getByRole('heading', { name: 'Copilot bilgisi' })).toBeVisible();
    await expectNoInternalRef(agentPage, '/app/team/ai-agents (tr)');
  });
});
