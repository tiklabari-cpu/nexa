/**
 * Answering a ticket (HD-01 · tm 356.4) in a real browser, against the real
 * stack: a reply leaves as e-mail and the thread says so, an internal note does
 * not, "send and mark solved" moves the ticket, and a failed e-mail offers
 * "try again".
 *
 * The suite's API runs `MAIL_PROVIDER=smtp` against the SMTP stand-in with
 * `TICKET_MAIL_OUTBOUND=true` (`playwright.config.ts`), so what is asserted is
 * what a person would have received. Each test makes its own ticket — a fresh
 * subject, a standalone ticket for a customer who left an address — so the
 * shared, re-seeded workspace cannot decide the outcome.
 */
import type { APIRequestContext, Page } from '@playwright/test';
import { API_BASE, PRECHAT_VISITOR, expect, ownerAccessToken, test } from './fixtures.js';
import { mailbox, waitForMail } from './mailbox.js';

interface NewTicket {
  id: string;
  email: string;
}

/** A standalone ticket for a customer with an e-mail address, under a subject only this run uses. */
async function newTicket(request: APIRequestContext, subject: string): Promise<NewTicket> {
  const auth = { authorization: `Bearer ${await ownerAccessToken(request)}` };
  const directory = await request.get(`${API_BASE}/customers?segment=all&limit=100`, {
    headers: auth,
  });
  expect(directory.ok(), `customer directory failed: ${directory.status()}`).toBe(true);
  // Not the suite's own widget visitors, who all carry the fixture address and
  // would make every mailbox read in this file ambiguous.
  const person = (
    (await directory.json()) as { items: Array<{ id: string; email: string | null }> }
  ).items.find((candidate) => candidate.email && candidate.email !== PRECHAT_VISITOR.email);
  expect(person, 'no customer in the directory carries an e-mail address').toBeTruthy();

  const created = await request.post(`${API_BASE}/tickets`, {
    headers: auth,
    data: { subject, customer_id: person!.id },
  });
  expect(created.ok(), `ticket failed: ${created.status()}`).toBe(true);
  return { id: ((await created.json()) as { id: string }).id, email: person!.email! };
}

async function openTicket(page: Page, id: string): Promise<void> {
  await page.goto(`/app/inbox?ticket=${id}`);
  await expect(page.getByRole('region', { name: 'Conversation' })).toBeVisible();
}

test.describe('ticket reply thread (HD-01)', () => {
  test.use({ viewport: { width: 1680, height: 1050 } });

  test('a reply is e-mailed with the ticket number, an internal note never is', async ({
    agentPage,
    request,
  }) => {
    const stamp = Date.now();
    const ticket = await newTicket(request, `E2E reply ${stamp}`);
    const NOTE = `team-only note ${stamp}`;
    const REPLY = `We are on it ${stamp}`;
    await openTicket(agentPage, ticket.id);

    // The note first: if it were going to reach the mail path, it would be in
    // the mailbox by the time the reply's mail is.
    await agentPage.getByRole('tab', { name: 'Internal note' }).click();
    await agentPage.getByLabel('Internal note', { exact: true }).fill(NOTE);
    await agentPage.getByRole('button', { name: 'Add note' }).click();

    const thread = agentPage.getByRole('region', { name: 'Conversation' });
    const noteLine = thread.locator('li[data-kind="internal_note"]', { hasText: NOTE });
    await expect(noteLine).toBeVisible();
    await expect(noteLine.getByText('Internal note · only your team sees this')).toBeVisible();
    // A note carries no e-mail state at all.
    await expect(noteLine).not.toContainText(/Sent|Sending|Could not send|Not sent/);

    await agentPage.getByRole('tab', { name: 'Reply' }).click();
    await agentPage.getByLabel('Reply to the player').fill(REPLY);
    await agentPage.getByRole('button', { name: 'Send reply', exact: true }).click();

    const replyLine = thread.locator('li[data-kind="agent_reply"]', { hasText: REPLY });
    await expect(replyLine).toBeVisible();

    // The mail that left: addressed to the player, the ticket number in the
    // subject, the reply's text in the body.
    const mail = await waitForMail(request, ticket.email, `[#${ticket.id}]`);
    expect(mail.body).toContain(REPLY);

    // ...and the thread says so, without a reload: a push, or the thread's own
    // re-read while the reply is still on its way (a ticket nobody holds has no
    // one for the push to go to).
    await expect(replyLine).toContainText('Sent', { timeout: 15_000 });

    // The note's text appears in no message anywhere in the mailbox.
    const everything = await mailbox(request);
    expect(everything.some((m) => (m.subject + m.body + (m.html ?? '')).includes(NOTE))).toBe(
      false,
    );

    // Replying moved the ticket to "waiting on the player".
    await expect(agentPage.getByLabel('Status')).toHaveValue('pending');

    await agentPage.screenshot({ path: 'kanit/13.6-ticket-reply-thread.png', fullPage: true });
  });

  test('"Send and mark solved" answers and solves in one gesture', async ({
    agentPage,
    request,
  }) => {
    const stamp = Date.now();
    const ticket = await newTicket(request, `E2E solve ${stamp}`);
    await openTicket(agentPage, ticket.id);

    await agentPage.getByLabel('Reply to the player').fill(`All sorted ${stamp}`);
    await agentPage.getByRole('button', { name: 'Send and mark solved' }).click();

    await expect(agentPage.getByLabel('Status')).toHaveValue('solved');
    await waitForMail(request, ticket.email, `[#${ticket.id}]`);
  });

  test('a failed e-mail offers "try again", which asks the server to send that reply again', async ({
    agentPage,
    request,
  }) => {
    const stamp = Date.now();
    const ticket = await newTicket(request, `E2E retry ${stamp}`);
    const auth = { authorization: `Bearer ${await ownerAccessToken(request)}` };

    // A real reply, sent and settled before the page opens, so no delivery push
    // can arrive later and redraw the badge the read below fakes.
    const written = await request.post(`${API_BASE}/tickets/${ticket.id}/messages`, {
      headers: auth,
      data: {
        kind: 'reply',
        text: `Retry me ${stamp}`,
        idempotency_key: `e2e-retry-${stamp}`,
      },
    });
    expect(written.ok(), `reply failed: ${written.status()}`).toBe(true);
    await waitForMail(request, ticket.email, `[#${ticket.id}]`);
    await expect
      .poll(async () => {
        const read = await request.get(`${API_BASE}/tickets/${ticket.id}/messages`, {
          headers: auth,
        });
        const items = ((await read.json()) as { items: Array<{ delivery_status: string | null }> })
          .items;
        return items.at(-1)?.delivery_status;
      })
      .toBe('sent');

    // The stand-in mail server accepts everything, so a failed delivery cannot
    // be provoked for real; the read is told the reply failed, and everything
    // after it — the click, the request, the server's answer — is the real stack.
    await agentPage.route(`**/tickets/${ticket.id}/messages?*`, async (route) => {
      // Read through the API directly: `route.fetch` would go back through the
      // dev server on a name that resolves to an address it does not listen on.
      const response = await request.get(`${API_BASE}/tickets/${ticket.id}/messages?limit=50`, {
        headers: auth,
      });
      const body = (await response.json()) as {
        items: Array<{ kind: string; delivery_status: string | null }>;
      };
      for (const item of body.items) {
        if (item.kind === 'agent_reply') item.delivery_status = 'failed';
      }
      await route.fulfill({ json: body });
    });
    await openTicket(agentPage, ticket.id);

    const tryAgain = agentPage.getByRole('button', { name: 'Try again' });
    await expect(agentPage.getByText('Could not send')).toBeVisible();

    const resend = agentPage.waitForRequest(
      (req) => req.method() === 'POST' && /\/messages\/[0-9a-f-]+\/resend$/.test(req.url()),
    );
    await tryAgain.click();
    expect((await resend).url()).toContain(`/tickets/${ticket.id}/messages/`);
  });
});
