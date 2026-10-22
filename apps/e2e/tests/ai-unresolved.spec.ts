/**
 * The AI Agent's Unresolved questions tab (tm 317.3 · AI-22).
 *
 * What the unit suites cannot prove: that the tab, drawn beside Performance,
 * reads the real endpoints with the filters the bar sets; that the surge
 * threshold typed in the panel is stored and read back after a reload; and
 * that a team member never sees the tab.
 *
 * Clusters themselves are the scheduler's (every 15 minutes) and the e2e stack
 * runs none — the capture, the clustering, the moves on a cluster and the
 * masked examples are proven against a real database in
 * `apps/api/test/integration/ai-unresolved-*.test.ts`. Everything here goes
 * through the public API, so the list may or may not hold clusters another spec
 * left; the assertions hold for both. The threshold is put back to the default.
 *
 * Serial: the threshold is one workspace setting.
 */
import type { Page } from '@playwright/test';
import { expect, test, DEMO, signInAs } from './fixtures.js';

// Priya Nair — the seeded Acme teammate with the plain agent role.
const MEMBER = { email: 'agent2@acme.localhost', password: DEMO.password } as const;

test.describe.configure({ mode: 'serial' });

async function openTab(page: Page): Promise<void> {
  await page.goto('/app/playbook');
  await page
    .getByRole('tablist', { name: 'AI Agent' })
    .getByRole('tab', { name: 'Unresolved questions' })
    .click();
  await expect(page.getByRole('region', { name: 'Unresolved questions' })).toBeVisible();
}

test.describe('Unresolved questions (AI-22)', () => {
  test('the tab sits beside Performance and reads the report with the filters it is given', async ({
    agentPage,
  }) => {
    await agentPage.goto('/app/playbook');
    const tabs = agentPage.getByRole('tablist', { name: 'AI Agent' }).getByRole('tab');
    // The tabs are drawn once the signed-in agent and the AI agent are known.
    await expect(tabs.filter({ hasText: 'Unresolved questions' })).toBeVisible();
    const names = await tabs.allTextContents();
    expect(names.indexOf('Unresolved questions')).toBe(names.indexOf('Performance') + 1);

    const requests: string[] = [];
    agentPage.on('request', (request) => {
      if (request.url().includes('/ai/unresolved/clusters?')) requests.push(request.url());
    });
    await openTab(agentPage);
    await expect.poll(() => requests.length).toBeGreaterThan(0);
    expect(requests[0]).toMatch(/status=open&sort=count_7d/);

    // A filter that matches nothing says so, and clearing it goes back to the default view.
    await agentPage.getByLabel('Reason').selectOption('agent_flagged');
    await expect(agentPage.getByText('No clusters match')).toBeVisible();
    expect(requests.at(-1)).toMatch(/reason=agent_flagged/);
    await agentPage.getByRole('button', { name: 'Clear filters' }).click();
    await expect(agentPage.getByText('No clusters match')).toHaveCount(0);
    await expect(agentPage.getByLabel('Reason')).toHaveValue('');
  });

  test('the surge threshold is saved, read back after a reload and put back', async ({
    agentPage,
  }) => {
    await openTab(agentPage);
    const box = agentPage.getByLabel('Messages in an hour');
    try {
      await box.fill('35');
      await agentPage.getByRole('button', { name: 'Save' }).click();
      await expect(agentPage.getByRole('button', { name: 'Save' })).toBeDisabled();

      await openTab(agentPage);
      await expect(agentPage.getByLabel('Messages in an hour')).toHaveValue('35');

      // Out of range is not sent.
      await agentPage.getByLabel('Messages in an hour').fill('3');
      await expect(agentPage.getByRole('button', { name: 'Save' })).toBeDisabled();
    } finally {
      await openTab(agentPage);
      await agentPage.getByLabel('Messages in an hour').fill('20');
      await agentPage.getByRole('button', { name: 'Save' }).click();
      await expect(agentPage.getByRole('button', { name: 'Save' })).toBeDisabled();
    }
    await openTab(agentPage);
    await expect(agentPage.getByLabel('Messages in an hour')).toHaveValue('20');
  });

  test('a team member has no Unresolved questions tab', async ({ browser }) => {
    const context = await browser.newContext();
    const member = await context.newPage();
    try {
      await signInAs(member, MEMBER.email, MEMBER.password);
      await member.goto('/app/playbook');
      await expect(member.getByRole('navigation').first()).toBeVisible();
      await expect(member.getByRole('tab', { name: 'Unresolved questions' })).toHaveCount(0);
      await expect(member.getByRole('region', { name: 'Unresolved questions' })).toHaveCount(0);
    } finally {
      await context.close();
    }
  });
});
