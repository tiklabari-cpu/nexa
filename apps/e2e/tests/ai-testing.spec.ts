/**
 * The AI Agent's Test tab — the simulation lab (tm 314.5 · AI-19).
 *
 * What the unit suites cannot prove: that a scenario written in the editor is
 * stored, queued, played by the real worker on the real engine and read back
 * with its checks, the judge's advice and its transcript; that "talk like a
 * player" answers through the same turn with its decision trace; that the
 * compliance pack the API serves is the locked list the tab draws; and that a
 * team member never sees the tab.
 *
 * Serial: one open run per agent and target, and the scenarios list is shared.
 * Every scenario written here is deleted again.
 */
import type { Page } from '@playwright/test';
import { expect, test, DEMO, signInAs } from './fixtures.js';

// Priya Nair — the seeded Acme teammate with the plain agent role.
const MEMBER = { email: 'agent2@acme.localhost', password: DEMO.password } as const;

test.describe.configure({ mode: 'serial' });

async function openTestTab(page: Page): Promise<void> {
  await page.goto('/app/playbook');
  await page.getByRole('tablist', { name: 'AI Agent' }).getByRole('tab', { name: 'Test' }).click();
  await expect(page.getByRole('region', { name: 'Test lab' })).toBeVisible();
}

async function deleteScenario(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: `Delete ${name}` }).click();
  const dialog = page.getByRole('dialog', { name: 'Delete this scenario?' });
  await dialog.getByRole('button', { name: 'Delete' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('button', { name: `Delete ${name}` })).toHaveCount(0);
}

test.describe('AI test lab (AI-19)', () => {
  test('the compliance pack is listed locked, with the publish gate it sets', async ({
    agentPage,
  }) => {
    await openTestTab(agentPage);

    const pack = agentPage.getByRole('region', { name: 'Compliance pack' });
    await expect(
      pack.getByText(/Publishing (open|closed)|Pre-publish run in progress/),
    ).toBeVisible();
    await pack.getByText('Show the locked scenarios').click();
    const list = pack.getByRole('list', { name: 'Locked compliance scenarios' });
    // G1, G2, G3, G5, G7, G11, G16 × TR/EN.
    await expect(list.getByRole('listitem')).toHaveCount(14);
    await expect(list.getByText('Locked')).toHaveCount(14);
    await expect(list.getByRole('button')).toHaveCount(0);
  });

  test('a scenario is written, run on the draft and read back with its checks and transcript', async ({
    agentPage,
  }) => {
    const name = `E2E order ${Date.now().toString().slice(-6)}`;
    await openTestTab(agentPage);

    await agentPage.getByRole('button', { name: 'New scenario' }).click();
    const editor = agentPage.getByRole('region', { name: 'New scenario' });
    await expect(editor.getByRole('note')).toContainText('Use made-up data only.');
    await editor.getByLabel('Name').fill(name);
    await editor.getByLabel('Player message 1', { exact: true }).fill('Where is my order?');
    await editor.getByRole('button', { name: 'Save scenario' }).click();

    await expect(agentPage.getByRole('region', { name: 'Test lab' })).toBeVisible();
    try {
      const scenarios = agentPage.getByRole('list', { name: 'Scenarios' });
      await expect(scenarios.getByText(name, { exact: true })).toBeVisible();

      await agentPage.getByRole('button', { name: `Run ${name}` }).click();
      const results = agentPage.getByRole('region', { name: 'Run results' });
      await expect(results).toBeVisible();
      // Queued, then played by the API's worker; the panel reads it until it ends.
      await expect(results.getByText('Completed')).toBeVisible({ timeout: 60_000 });
      const row = results.getByTestId('run-result');
      await expect(row).toHaveCount(1);
      await expect(row.getByText(name, { exact: true })).toBeVisible();
      await expect(row.getByText(/Passed|Failed|Could not be played/).first()).toBeVisible();

      await row.getByText(name, { exact: true }).click();
      await expect(row.getByText(/^Hard checks — \d+ of \d+ failed$/)).toBeVisible();
      await expect(row.getByText('Judge’s suggestion')).toBeVisible();
      const conversation = row.getByRole('list', { name: 'Conversation' });
      await expect(conversation.getByText('Where is my order?')).toBeVisible();

      // The run is in the history too.
      await expect(
        agentPage.getByRole('list', { name: 'Runs' }).getByText('Manual run · Draft').first(),
      ).toBeVisible();
    } finally {
      await deleteScenario(agentPage, name);
    }
  });

  test('talking like a player shows the decision trace, and the talk is saved as a scenario', async ({
    agentPage,
  }) => {
    const name = `E2E sandbox ${Date.now().toString().slice(-6)}`;
    await openTestTab(agentPage);

    await agentPage.getByRole('button', { name: 'Talk like a player' }).click();
    const sandbox = agentPage.getByRole('region', { name: 'Talk like a player' });
    await sandbox.getByRole('button', { name: /^(Start a conversation|Start over)$/ }).click();
    await sandbox.getByLabel('Your message as the player').fill('Where is my order?');
    await sandbox.getByRole('button', { name: 'Send' }).click();

    const conversation = sandbox.getByRole('list', { name: 'Conversation' });
    await expect(conversation.getByText('Where is my order?').last()).toBeVisible();
    const trace = conversation.getByTestId('decision-trace').last();
    await expect(trace).toBeVisible();
    await expect(trace.getByText('Decision', { exact: true })).toBeVisible();
    await expect(trace.getByText('Procedure', { exact: true })).toBeVisible();
    await expect(trace.getByText('Sources', { exact: true })).toBeVisible();

    await sandbox.getByLabel('Scenario name').fill(name);
    await sandbox.getByRole('button', { name: 'Save as scenario' }).click();
    await expect(sandbox.getByText(`“${name}” was saved to the scenarios.`)).toBeVisible();

    await sandbox.getByRole('button', { name: 'Back to the lab' }).click();
    const scenarios = agentPage.getByRole('list', { name: 'Scenarios' });
    await expect(scenarios.getByText(name, { exact: true })).toBeVisible();
    await expect(scenarios.getByText(/Saved from a conversation/).first()).toBeVisible();
    await deleteScenario(agentPage, name);
  });

  test('a team member has no Test tab', async ({ browser }) => {
    const context = await browser.newContext();
    const member = await context.newPage();
    try {
      await signInAs(member, MEMBER.email, MEMBER.password);
      await member.goto('/app/playbook');
      await expect(member.getByRole('navigation').first()).toBeVisible();
      await expect(member.getByRole('tab', { name: 'Test' })).toHaveCount(0);
      await expect(member.getByRole('region', { name: 'Test lab' })).toHaveCount(0);
    } finally {
      await context.close();
    }
  });
});
