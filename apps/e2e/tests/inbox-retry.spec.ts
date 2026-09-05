/**
 * A reply the network dropped is not lost (FR-MOD-02.3.3 · FR-MOD-02.3.6).
 *
 * The web suite pins the arithmetic — what the store holds, which key the
 * second attempt carries, that the composer is never written over. What only a
 * real browser proves is the half that arithmetic cannot reach: that a request
 * killed at the transport layer (not a stubbed rejection) surfaces on the real
 * inbox as a message the agent can still see and press, and that pressing it
 * puts that message — once — in front of the customer.
 *
 * The abort is applied to the agent's page only, and only to the first POST, so
 * everything after it is the product's own behaviour against a live API.
 */
import type { Locator } from '@playwright/test';
import { expect, openWidget, signIn, test, visitorSends, widgetFrame } from './fixtures.js';

/** How many times `needle` appears in what a region actually renders. */
async function occurrencesIn(region: Locator, needle: string): Promise<number> {
  return (await region.innerText()).split(needle).length - 1;
}

test('a dropped reply keeps its Retry, and the retry reaches the visitor once', async ({
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

    // Six digits, like `demo-flow.spec.ts`: a 13-digit run would be rewritten by
    // card masking (FR-MOD-08.9.5) and the text would not read back verbatim.
    const question = `My chain keeps slipping — ${Date.now().toString().slice(-6)}`;
    await openWidget(visitor, organizationId);
    await visitorSends(visitor, question);

    const list = agent.getByRole('region', { name: 'Conversations' });
    await expect(list).toContainText(question, { timeout: 20_000 });
    await list.getByRole('button').first().click();
    await expect(agent.locator('main')).toContainText(question);

    // Drop exactly one send at the transport layer — the browser sees a failed
    // request, which is what an agent on a flaky connection actually gets. The
    // transcript's own GET of the same path must keep working, so only the POST
    // is touched.
    let dropNext = true;
    await agent.route('**/api/v1/chats/*/events', async (route) => {
      if (dropNext && route.request().method() === 'POST') {
        dropNext = false;
        await route.abort('failed');
        return;
      }
      await route.continue();
    });

    const answer = `Bring it in and we will re-tension it — ${Date.now().toString().slice(-6)}`;
    await agent.getByPlaceholder('Type your reply').fill(answer);
    await agent.getByRole('button', { name: 'Send' }).click();

    // The message survived the failure: it is in the transcript, marked unsent,
    // with the control that sends it again. Before this feature the composer had
    // already cleared and the optimistic bubble had rolled back, so at this
    // point the agent's words existed nowhere on the screen.
    const failed = agent.getByTestId('failed-send');
    await expect(failed).toContainText(answer);
    await expect(agent.getByText('Not sent')).toBeVisible();
    await agent.screenshot({ path: 'kanit/02.3.6-send-failed-retry.png', fullPage: true });

    await agent.getByRole('button', { name: 'Retry' }).click();

    // It reaches the customer…
    await expect(widgetFrame(visitor).getByRole('log', { name: 'Conversation' })).toContainText(
      answer,
      { timeout: 20_000 },
    );
    // …and the failed row is gone, because the message is now a real event.
    await expect(failed).toBeHidden();

    // Exactly once, on both sides. Two copies is the worst outcome this feature
    // could have, and it is reachable two ways: the failed row left standing
    // beside the real event, or a retry that minted a fresh idempotency key.
    // Counted out of the rendered text rather than by locator, because the same
    // sentence nests inside several elements and a count of *nodes* would not
    // answer the question asked here.
    //
    // (The server-side half of the dedupe — the same key posted twice yielding
    // one event — is `apps/api/test/integration/chats.test.ts`; the abort above
    // is client-side, so this first attempt never reached it.)
    expect(
      await occurrencesIn(agent.getByRole('log', { name: 'Conversation transcript' }), answer),
    ).toBe(1);
    expect(
      await occurrencesIn(widgetFrame(visitor).getByRole('log', { name: 'Conversation' }), answer),
    ).toBe(1);
  } finally {
    await visitorContext.close();
    await agentContext.close();
  }
});
