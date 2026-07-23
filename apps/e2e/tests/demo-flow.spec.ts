/**
 * The headline flow, end to end and in one browser session:
 *
 *   visitor messages from the widget → routing assigns it → the agent sees it
 *   live, without reloading → agent replies → visitor sees the reply → agent
 *   adds an internal note the visitor must never see → agent archives it.
 *
 * This is the claim the README makes. Asserting it anywhere below the browser
 * would leave the two halves — widget and agent app — proven only against the
 * API, never against each other.
 */
import { expect, test, DEMO, openWidget, signIn, visitorSends, widgetFrame } from './fixtures.js';

test('a visitor conversation reaches the agent, is answered, and is archived', async ({
  browser,
  organizationId,
}) => {
  // Two separate contexts: the visitor and the agent are different people on
  // different sites, and sharing storage between them would let a bug in one
  // mask a bug in the other.
  const visitorContext = await browser.newContext();
  const agentContext = await browser.newContext();
  const visitor = await visitorContext.newPage();
  const agent = await agentContext.newPage();

  try {
    await signIn(agent);
    // The agent has to be accepting work for routing to assign anything.
    await agent.getByLabel('Availability').selectOption('accepting_chats');

    const question = `My rear brake is rubbing — ${Date.now()}`;
    await openWidget(visitor, organizationId);
    await visitorSends(visitor, question);

    // --- Live delivery ------------------------------------------------------
    // No reload anywhere in this block. If the assertion below only passes
    // after a refresh, the realtime path is broken and the inbox is a polling
    // app that happens to look live.
    // Scoped to the conversation list. An unscoped name match also hits the
    // rail's disabled "Customers" button, which is not a conversation.
    const list = agent.getByRole('region', { name: 'Conversations' });
    await expect(list).toContainText(question, { timeout: 20_000 });
    await list.getByRole('button').first().click();

    await expect(agent.locator('main')).toContainText(question);

    // --- Reply --------------------------------------------------------------
    const answer = `Bring it in and we will true the rotor — ${Date.now()}`;
    await agent.getByRole('radio', { name: 'Reply' }).click();
    await agent.getByPlaceholder('Type your reply…').fill(answer);
    await agent.getByRole('button', { name: 'Send' }).click();

    await expect(widgetFrame(visitor).getByRole('log', { name: 'Conversation' })).toContainText(
      answer,
      { timeout: 20_000 },
    );

    // --- Internal note ------------------------------------------------------
    const note = `Customer is a repeat buyer — ${Date.now()}`;
    await agent.getByRole('radio', { name: 'Internal note' }).click();
    await expect(agent.getByText('Only your team will see this.')).toBeVisible();
    await agent.getByPlaceholder('Add a note for your team…').fill(note);
    await agent.getByRole('button', { name: 'Send' }).click();
    await expect(agent.locator('main')).toContainText(note);

    // The expensive mistake this product can make is showing an internal note
    // to the customer. Assert the absence directly, after giving the widget
    // more than a poll interval to have shown it.
    await visitor.waitForTimeout(6_000);
    await expect(widgetFrame(visitor).getByRole('log', { name: 'Conversation' })).not.toContainText(
      note,
    );

    // --- Archive ------------------------------------------------------------
    await agent.getByRole('button', { name: /Archive conversation/i }).click();
    await expect(agent.locator('main')).not.toContainText('Type your reply…');
  } finally {
    await visitorContext.close();
    await agentContext.close();
  }
});

test('the agent app reports its own connection state', async ({ agentPage }) => {
  // An agent whose socket has died must be told, or they sit in front of a
  // stale inbox believing nobody has written in. Scoped to the inbox header:
  // an unscoped match also hits the "Offline" option in the availability
  // select, which reports something entirely different.
  const header = agentPage.getByRole('navigation', { name: 'Inbox views' });
  await expect(header.getByText(/Live|Reconnecting|Offline/).first()).toBeVisible();
});

test('signing in lands on the inbox and the other modules are reachable', async ({ agentPage }) => {
  await expect(agentPage).toHaveURL(/\/app\/inbox/);

  await agentPage.getByRole('link', { name: 'Reports' }).click();
  await expect(agentPage.getByRole('heading', { name: 'Reports', level: 1 })).toBeVisible();

  await agentPage.getByRole('link', { name: 'Team' }).click();
  await expect(agentPage.getByRole('heading', { name: 'Team', level: 1 })).toBeVisible();
  // Scoped to the table: the agent's name also appears in the (closed, hidden)
  // account menu, and an unscoped `.first()` picks that one.
  await expect(agentPage.getByRole('table').getByText(DEMO.agentName).first()).toBeVisible();

  await agentPage.getByRole('link', { name: 'Billing' }).click();
  await expect(agentPage.getByRole('heading', { name: 'Billing', level: 1 })).toBeVisible();

  // Deep-linkable: a reload must not send the agent back to the inbox.
  await agentPage.reload();
  await expect(agentPage.getByRole('heading', { name: 'Billing', level: 1 })).toBeVisible();
});
