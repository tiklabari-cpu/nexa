/**
 * Home dashboard — personalized welcome + Performance overview (FR-MOD-13.1).
 *
 * The audit found two of the PRD's acceptance criteria missing: a welcome line
 * naming the signed-in agent, and a Performance overview carrying the PRD's
 * quartet (Total chats/Satisfaction/Response time/Efficiency). This is the one
 * path that proves both land on a real screen, signed in as a real seeded
 * agent — not just in the unit suite's mocked dashboard payload. The rest of
 * the screen (activation checklist, live counters, "This week") is unchanged
 * by this task and already covered elsewhere.
 */
import { DEMO, expect, test } from './fixtures.js';

test.describe('Home dashboard (FR-MOD-13.1)', () => {
  test('greets the signed-in agent by name and shows the Performance overview quartet', async ({
    agentPage,
  }) => {
    await agentPage.goto('/app/home');

    await expect(agentPage.getByText(`Welcome back, ${DEMO.agentName}`)).toBeVisible();

    // Scoped to the Performance overview card, not the page as a whole: "This
    // week" (unchanged by this task) also has a card labelled "Satisfaction".
    const performance = agentPage
      .locator('section')
      .filter({ has: agentPage.getByRole('heading', { name: 'Performance overview' }) });
    await expect(performance.getByText('Total chats')).toBeVisible();
    await expect(performance.getByText('Satisfaction')).toBeVisible();
    await expect(performance.getByText('Response time')).toBeVisible();
    await expect(performance.getByText('Efficiency')).toBeVisible();

    await agentPage.screenshot({ path: 'kanit/13.1-home.png', fullPage: true });
  });
});
