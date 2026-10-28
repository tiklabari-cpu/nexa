/**
 * AI configuration versions in the Playbook (tm 316.4 · SiyahTuş analysis
 * AI-20 · ADR-14b §2.10).
 *
 * What the unit suites cannot prove on their own: that a real save of an
 * editing screen makes the version bar read the real draft endpoint again,
 * that the difference names the change, that "Send for review" stays closed —
 * and says why — while the compliance pack has not passed for the draft, that
 * Versions reads the agent's versions, and that the Inbox band reads the
 * gateway's `ai_config_published` frame.
 *
 * The seeded agent of the e2e stack has never been published (the seed writes
 * no version, ADR-14b §2.3): the bar reads "Nothing published yet" and every
 * item of the draft counts as a change. Publishing itself — four eyes, the
 * Founder rule, rollback — is proven against the API (`ai-config-workflow`,
 * `ai-config-runtime` integration tests).
 *
 * The test restores what it changed (the persona's tone) for the specs that
 * follow on the same stack. The marker has no digits: a run-unique number can
 * read as a card and be masked (AI-26).
 */
import type { Page, WebSocketRoute } from '@playwright/test';
import { expect, test } from './fixtures.js';

function letters(): string {
  return Array.from({ length: 8 }, () =>
    String.fromCharCode(97 + Math.floor(Math.random() * 26)),
  ).join('');
}

test.describe('AI configuration versions (AI-20)', () => {
  test('a saved edit is read back on the version bar, named in the difference, and cannot be sent before the compliance pack passed', async ({
    agentPage,
  }) => {
    await agentPage.goto('/app/playbook?view=general');
    const bar = agentPage.getByTestId('ai-version-bar');
    await expect(bar.getByTestId('ai-version-live')).toHaveText(
      /^(Live: v\d+(\.\d+)?|Nothing published yet)$/,
    );
    const draftLine = bar.getByTestId('ai-version-draft');
    await expect(draftLine).toHaveText(/^Draft: \d+ changes?$/);
    // The editing screens say what they edit.
    await expect(agentPage.getByTestId('ai-draft-strip')).toContainText(
      'What you save here is the draft.',
    );

    const tone = agentPage.getByLabel('Tone');
    const original = await tone.inputValue();
    const save = agentPage.getByRole('button', { name: 'Save profile' });
    const rereads = () =>
      agentPage.waitForResponse(
        (response) =>
          response.url().includes('/ai/config/draft/diff') &&
          response.request().method() === 'GET' &&
          response.ok(),
      );

    try {
      // The profile form invalidates its own query only: the bar still reads the draft again.
      const reread = rereads();
      await tone.fill(`formal ${letters()}`);
      await save.click();
      await expect(save).toBeDisabled();
      await reread;

      await expect(draftLine).toHaveText(/^Draft: [1-9]\d* changes?$/);
      await bar.getByRole('button', { name: 'See changes' }).click();
      await expect(bar.getByTestId('ai-config-diff-agent')).toContainText('Persona');

      // Nobody ran the pre-publish test for this revision: closed, with the reason (AI-20 KK).
      const submit = bar.getByRole('button', { name: 'Send for review' });
      await expect(submit).toBeDisabled();
      await expect(bar).toContainText('The compliance pack must pass for this draft.');
      await bar.getByRole('button', { name: 'Run the pre-publish test' }).click();
      await expect(
        agentPage.getByRole('tab', { name: 'Test', exact: true, selected: true }),
      ).toBeVisible();
    } finally {
      await agentPage.getByRole('tab', { name: 'General settings' }).click();
      await agentPage.getByLabel('Tone').fill(original);
      if (await save.isEnabled()) {
        await save.click();
        await expect(save).toBeDisabled();
      }
    }
  });

  test('Versions reads the agent’s versions', async ({ agentPage }) => {
    await agentPage.goto('/app/playbook?view=versions');
    const versions = agentPage.getByTestId('ai-versions');
    await expect(versions.getByRole('heading', { name: 'Versions' })).toBeVisible();
    const live = await agentPage.getByTestId('ai-version-live').innerText();
    if (live === 'Nothing published yet') {
      await expect(versions.getByText('No versions yet')).toBeVisible();
    } else {
      const row = versions.getByTestId('ai-version-row').filter({ hasText: 'Live' });
      await expect(row).toHaveCount(1);
      // The live version is never offered as a rollback target.
      await expect(row.getByRole('button', { name: 'Roll back to this version' })).toHaveCount(0);
    }
  });

  test('the Inbox band names a version the gateway says went live', async ({ agentPage }) => {
    const socket = await interceptRealtime(agentPage);
    socket().send(
      JSON.stringify({
        action: 'ai_config_published',
        type: 'push',
        payload: {
          ai_agent_id: '00000000-0000-4000-8000-000000000001',
          version_id: '00000000-0000-4000-8000-000000000002',
          label: 'v9',
          seq: 9,
          published_at: new Date().toISOString(),
          rollback_of: null,
        },
      }),
    );
    const band = agentPage.getByTestId('ai-config-published-band');
    await expect(band).toContainText('AI configuration v9 is live');
    await expect(band.getByRole('link', { name: 'See versions' })).toHaveAttribute(
      'href',
      '/app/playbook?view=versions&version=00000000-0000-4000-8000-000000000002',
    );
    await band.getByRole('button', { name: 'Dismiss' }).click();
    await expect(band).toHaveCount(0);
  });
});

/** Route the panel's socket through the test, so a push can be added to the gateway's own. */
async function interceptRealtime(page: Page): Promise<() => WebSocketRoute> {
  let socket: WebSocketRoute | undefined;
  await page.routeWebSocket(/:4001\//, (ws) => {
    ws.connectToServer();
    socket = ws;
  });
  await page.goto('/app/inbox');
  await expect(page.getByRole('navigation', { name: 'Inbox views' }).getByText('Live')).toBeVisible(
    {
      timeout: 15_000,
    },
  );
  return () => {
    if (!socket) throw new Error('the panel never opened its socket');
    return socket;
  };
}
