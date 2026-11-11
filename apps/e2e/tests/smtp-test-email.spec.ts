/**
 * Settings → Ticket e-mails → "Send test email" (tm 464.3 · G-05).
 *
 * The owner asks for a test message from the panel; the API queues it in the
 * durable outbox and sends it through the stack's real SMTP session (mock
 * server, TLS + AUTH) to the owner's own address. The screen says it was
 * sent, and the mailbox has it.
 */
import { DEMO, expect, test } from './fixtures.js';
import { waitForMail } from './mailbox.js';

test('an administrator mails themselves a test message from Settings', async ({
  agentPage,
  request,
}) => {
  await agentPage.goto('/app/settings/ticket-email-templates');
  const section = agentPage.getByRole('region', { name: 'Test email' });
  await section.getByRole('button', { name: 'Send test email' }).click();

  await expect(section.getByRole('status')).toHaveText(
    `Test email sent to ${DEMO.email}. Check your inbox, and the spam folder if it is not there.`,
  );
  const mail = await waitForMail(request, DEMO.email, 'SiyahTuş test email');
  expect(mail.body).toContain('Mail delivery works');
});
