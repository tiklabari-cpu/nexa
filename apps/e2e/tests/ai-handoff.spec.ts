/**
 * The AI agent's hand-over settings (tm 303.5 · AI-09, K9).
 *
 * What the unit suites cannot prove: that a rule written in Playbook › Profile
 * › Hand-over is held by the real API in the order it was dragged to and with
 * the switch it was given, that the thresholds, the messages and the default
 * "solved" criteria survive a reload, and that a locked platform rule is on the
 * screen without a way to touch it.
 */
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.js';

async function openHandoff(page: Page): Promise<void> {
  await page.goto('/app/playbook');
  await page
    .getByRole('tablist', { name: 'AI Agent' })
    .getByRole('tab', { name: 'Profile' })
    .click();
  await expect(page.getByRole('heading', { name: 'Hand-over rules' })).toBeVisible();
}

test.describe('AI hand-over rules (AI-09)', () => {
  test('a rule is written, ordered, switched off, kept after a reload and deleted', async ({
    agentPage,
  }) => {
    test.setTimeout(120_000);
    const run = Date.now().toString().slice(-6);
    const first = `Deposits ${run}`;
    const second = `Free spins ${run}`;
    agentPage.on('dialog', (dialog) => void dialog.accept());
    await openHandoff(agentPage);

    // The platform's rules head the list, greyed out and without a switch.
    const locked = agentPage.getByTestId('handoff-locked-G1');
    await expect(locked).toContainText('locked');
    await expect(locked.getByRole('checkbox')).toHaveCount(0);

    const add = async (title: string, phrase?: string) => {
      await agentPage.getByRole('button', { name: 'Add hand-over rule' }).click();
      const form = agentPage.getByRole('form', { name: 'New hand-over rule' });
      await form.getByLabel('Name').fill(title);
      if (phrase) {
        await form.getByLabel('When').selectOption('phrase');
        await form.getByLabel('Phrase').fill(phrase);
      }
      await form.getByLabel('Priority').selectOption('high');
      await Promise.all([
        agentPage.waitForResponse(
          (response) =>
            response.request().method() === 'POST' &&
            response.url().endsWith('/handoff-rules') &&
            response.ok(),
          // The first write of a cold stack can take longer than the default 10 s.
          { timeout: 30_000 },
        ),
        form.getByRole('button', { name: 'Save rule' }).click(),
      ]);
      await expect(form).toHaveCount(0);
    };
    await add(first);
    await add(second, 'free spins');

    const rules = agentPage.getByRole('list', { name: 'Your hand-over rules' });
    await expect(rules.getByRole('listitem').filter({ hasText: first })).toContainText(
      'the message is about Deposits',
    );
    await expect(rules.getByRole('listitem').filter({ hasText: second })).toContainText(
      'the message says “free spins”',
    );

    // The second rule goes above the first.
    await Promise.all([
      agentPage.waitForResponse(
        (response) =>
          response.request().method() === 'PUT' &&
          response.url().endsWith('/handoff-rules/order') &&
          response.ok(),
      ),
      agentPage.getByRole('button', { name: `Move “${second}” up` }).click(),
    ]);

    // And the first one is switched off.
    const toggle = agentPage.getByRole('checkbox', { name: `Rule “${first}” is on` });
    await Promise.all([
      agentPage.waitForResponse(
        (response) => response.request().method() === 'PATCH' && response.ok(),
      ),
      toggle.click(),
    ]);

    // It is the server that holds the order and the switch.
    await agentPage.reload();
    await agentPage
      .getByRole('tablist', { name: 'AI Agent' })
      .getByRole('tab', { name: 'Profile' })
      .click();
    const kept = agentPage
      .getByRole('list', { name: 'Your hand-over rules' })
      .getByRole('listitem');
    await expect(agentPage.getByRole('checkbox', { name: `Rule “${second}” is on` })).toBeChecked();
    const titles = await kept.locator('p.font-medium').allTextContents();
    expect(titles.indexOf(second)).toBeGreaterThanOrEqual(0);
    expect(titles.indexOf(second)).toBeLessThan(titles.indexOf(first));
    await expect(
      agentPage.getByRole('checkbox', { name: `Rule “${first}” is on` }),
    ).not.toBeChecked();
    await expect(agentPage.getByRole('checkbox', { name: `Rule “${second}” is on` })).toBeChecked();

    // The module scrolls inside the page: bring the part to show into view first.
    await agentPage.getByRole('heading', { name: 'Hand-over rules' }).scrollIntoViewIfNeeded();
    await agentPage.screenshot({ path: 'kanit/ai-09-handoff-rules.png' });

    // Leave the workspace as found.
    for (const title of [first, second]) {
      await Promise.all([
        agentPage.waitForResponse(
          (response) => response.request().method() === 'DELETE' && response.ok(),
        ),
        agentPage.getByRole('button', { name: `Delete “${title}”` }).click(),
      ]);
      await expect(agentPage.getByText(title, { exact: true })).toHaveCount(0);
    }
  });

  test('a threshold, a message and the “solved” criteria are saved and kept after a reload', async ({
    agentPage,
  }) => {
    test.setTimeout(120_000);
    const run = Date.now().toString().slice(-6);
    const message = `Please keep it kind ${run}.`;
    await openHandoff(agentPage);

    const save = (name: string) =>
      Promise.all([
        agentPage.waitForResponse(
          (response) =>
            response.request().method() === 'PUT' &&
            response.url().endsWith('/handoff-settings') &&
            response.ok(),
        ),
        agentPage.getByRole('button', { name }).click(),
      ]);

    const triggers = agentPage.getByRole('form', { name: 'When the agent hands over' });
    await triggers.getByLabel('Turns per procedure').fill('14');
    await save('Save triggers');

    const messages = agentPage.getByRole('form', { name: 'What the player is told' });
    await messages.getByText('Abuse', { exact: true }).click();
    await messages.getByLabel('Hand-over message: Abuse').fill(message);
    await save('Save messages');

    const resolution = agentPage.getByRole('form', { name: 'Solved criteria' });
    await resolution
      .getByRole('checkbox', { name: 'Use my own criteria instead of the platform’s' })
      .check();
    await save('Save criteria');

    await agentPage.reload();
    await agentPage
      .getByRole('tablist', { name: 'AI Agent' })
      .getByRole('tab', { name: 'Profile' })
      .click();
    await expect(
      agentPage
        .getByRole('form', { name: 'When the agent hands over' })
        .getByLabel('Turns per procedure'),
    ).toHaveValue('14');
    await expect(
      agentPage
        .getByRole('form', { name: 'What the player is told' })
        .getByLabel('Hand-over message: Abuse'),
    ).toHaveValue(message);
    await expect(
      agentPage
        .getByRole('form', { name: 'Solved criteria' })
        .getByRole('checkbox', { name: 'Use my own criteria instead of the platform’s' }),
    ).toBeChecked();

    // The module scrolls inside the page: bring the part to show into view first.
    await agentPage
      .getByRole('form', { name: 'When the agent hands over' })
      .scrollIntoViewIfNeeded();
    await agentPage.screenshot({ path: 'kanit/ai-09-handoff-settings.png' });

    // Back to what the workspace had.
    await agentPage
      .getByRole('form', { name: 'When the agent hands over' })
      .getByLabel('Turns per procedure')
      .fill('12');
    await save('Save triggers');
    const told = agentPage.getByRole('form', { name: 'What the player is told' });
    // The reload closed the reason's box again.
    await told.getByText('Abuse', { exact: true }).click();
    await told.getByLabel('Hand-over message: Abuse').fill('');
    await save('Save messages');
    await agentPage
      .getByRole('form', { name: 'Solved criteria' })
      .getByRole('checkbox', { name: 'Use my own criteria instead of the platform’s' })
      .uncheck();
    await save('Save criteria');
  });
});
