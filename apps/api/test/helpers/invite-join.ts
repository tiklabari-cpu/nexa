/**
 * Joining a workspace as a newcomer, the way it works since tm 282 (GV-03):
 * accepting the invitation creates an unverified account and mails a
 * verification link to the invited address; opening that link with the
 * password is the join. A suite that only needs "a newcomer joined" calls
 * {@link acceptAndVerify}; one about the gap between the two calls each half
 * itself.
 */
import { expect } from 'vitest';
import type { LightMyRequestResponse } from 'fastify';
import type { Mailer, Message } from '../../src/services/mail/mailer.js';
import type { TestServer } from './server.js';

/** Keeps what was sent, newest last, so a test can read the link out of it. */
export class MemoryMailer implements Mailer {
  readonly sent: Message[] = [];

  async send(message: Message): Promise<void> {
    this.sent.push(message);
  }

  clear(): void {
    this.sent.length = 0;
  }
}

/** The `token` of the newest verification link mailed to `email`. */
export async function verificationTokenFor(
  server: TestServer,
  mailer: MemoryMailer,
  email: string,
): Promise<string> {
  await server.app.backgroundMail.settled();
  const mail = mailer.sent
    .filter((m) => m.kind === 'email_verification' && m.to.toLowerCase() === email.toLowerCase())
    .at(-1);
  expect(mail, `no verification mail to ${email}`).toBeDefined();
  const match = /https?:\/\/\S+\/verify-email\?token=\S+/.exec(mail!.body);
  expect(match, `no /verify-email link in: ${mail!.body}`).not.toBeNull();
  return new URL(match![0]).searchParams.get('token')!;
}

/**
 * Accept an invitation as a newcomer, then open the link mailed to `email`.
 * Both answers are returned; the accept is expected to be the 202 every
 * unverified account gets.
 */
export async function acceptAndVerify(
  server: TestServer,
  mailer: MemoryMailer,
  input: { token: string; email: string; name?: string; password: string },
): Promise<{ accepted: LightMyRequestResponse; verified: LightMyRequestResponse }> {
  const accepted = await server.post('/auth/invitations/accept', {
    token: input.token,
    name: input.name ?? 'Newcomer',
    password: input.password,
  });
  expect(accepted.statusCode, accepted.payload).toBe(202);
  const link = await verificationTokenFor(server, mailer, input.email);
  const verified = await server.post('/auth/verify-email', {
    token: link,
    password: input.password,
  });
  return { accepted, verified };
}
