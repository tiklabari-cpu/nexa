/**
 * Invitation and password-reset mail over the real carrier, failing (tm 255.4).
 *
 * `FileMailer` never throws, so until `MAIL_PROVIDER=smtp` existed the product
 * had never met a mail that did not go out — and two things were broken in a
 * way no test could see:
 *
 * - `POST /auth/password-reset` awaited the send, and only an existing account
 *   is mailed. A carrier failure turned that branch alone into a 500: the
 *   neutral 202 (FR-MOD-00.3) answered the question it exists to refuse. Even
 *   a *successful* send did, more quietly — an SMTP round trip is time the
 *   unknown-address branch never spends.
 * - `POST /invitations` sent after the invitations had committed, so one bad
 *   address made the request a 500 while every invitation sat in the database
 *   with a working link.
 *
 * Everything here runs the real `SmtpMailer` — TLS, AUTH, the retry loop —
 * against the fake server on 127.0.0.1, which is told to fail in the ways a
 * real one does: a 5xx on RCPT, a 4xx on every attempt, a connection that drops
 * after the message's terminating dot, a greeting that never comes.
 *
 * The negative cases are the point, and each one also proves the carrier was
 * really reached — a failure test that passes because nothing was attempted
 * proves nothing.
 */
import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SmtpMailer, type MailLogger } from '../../src/services/mail/smtp-mailer.js';
import {
  FAKE_SMTP_PASSWORD,
  FAKE_SMTP_USERNAME,
  FakeSmtpServer,
  type FakeReply,
  type FakeStep,
} from '../helpers/fake-smtp-server.js';
import { grantToken, ownerClient, seedFixtures, type Fixtures } from '../helpers/fixtures.js';
import { readReceivedMail, tokenIn } from '../helpers/received-mail.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';
import { SMTP_TEST_CA_PEM } from '../helpers/smtp-certificates.js';

const UNKNOWN = 'nobody-at-all@example.test';
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** Every line the server and the carrier logged, so a test can say what never appeared. */
class LineSink {
  readonly lines: string[] = [];
  write(chunk: string): boolean {
    this.lines.push(chunk);
    return true;
  }
  end(): void {}
  on(): void {}
  once(): void {}
  emit(): boolean {
    return false;
  }
  get text(): string {
    return this.lines.join('\n');
  }
}

interface Stack {
  api: TestServer;
  smtp: FakeSmtpServer;
  log: LineSink;
}

describe('auth mail over the real carrier (tm 255.4)', () => {
  let owner: PrismaClient;
  let fx: Fixtures;
  let ownerToken: string;
  const stacks: Stack[] = [];

  const auth = () => ({ authorization: `Bearer ${ownerToken}` });

  beforeAll(() => {
    owner = ownerClient();
  });

  afterAll(async () => {
    await owner.$disconnect();
  });

  beforeEach(async () => {
    fx = await seedFixtures(owner);
    ownerToken = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['accounts--all:rw'],
    });
  });

  afterEach(async () => {
    for (const { api, smtp } of stacks.splice(0)) {
      await api.close();
      await smtp.stop();
    }
  });

  /**
   * A server whose mailer is the SMTP carrier, pointed at a fake server that
   * answers `respond` where it is given and like a healthy server elsewhere.
   * The carrier's retry pause is skipped; its attempts and timeouts are real.
   */
  async function stack(
    respond?: (step: FakeStep) => FakeReply | undefined,
    carrier: { timeoutMs?: number; maxAttempts?: number } = {},
  ): Promise<Stack> {
    const smtp = await FakeSmtpServer.start({ mode: 'starttls', ...(respond ? { respond } : {}) });
    const log = new LineSink();
    const logger: MailLogger = {
      debug: (details, message) => log.write(JSON.stringify({ ...details, message })),
      info: (details, message) => log.write(JSON.stringify({ ...details, message })),
      warn: (details, message) => log.write(JSON.stringify({ ...details, message })),
      error: (details, message) => log.write(JSON.stringify({ ...details, message })),
    };
    const mailer = new SmtpMailer(
      {
        host: '127.0.0.1',
        port: smtp.port,
        secure: false,
        username: FAKE_SMTP_USERNAME,
        password: FAKE_SMTP_PASSWORD,
        from: 'info@nolnk.test',
        timeoutMs: carrier.timeoutMs ?? 2_000,
      },
      {
        ca: SMTP_TEST_CA_PEM,
        logger,
        sleep: async () => undefined,
        ...(carrier.maxAttempts ? { maxAttempts: carrier.maxAttempts } : {}),
      },
    );
    const api = await startTestServer(
      { LOG_LEVEL: 'info' },
      { mailer, logStream: log as unknown as NodeJS.WritableStream },
    );
    await clearRateLimits(api.app);
    const built = { api, smtp, log };
    stacks.push(built);
    return built;
  }

  /** Every recipient the fake server was asked to accept, across all sessions. */
  function recipients(smtp: FakeSmtpServer): string[] {
    return smtp.sessions.flatMap((session) =>
      session.commands
        .filter((line) => /^RCPT TO:/i.test(line))
        .map((line) => line.replace(/^RCPT TO:\s*<?([^>]*)>?.*$/i, '$1').toLowerCase()),
    );
  }

  function unique(label: string): string {
    return `${label}-${randomUUID().slice(0, 8)}@example.test`;
  }

  // =========================================================================
  // The reset answers the same whatever the carrier does
  // =========================================================================

  describe('password reset — the carrier cannot answer for the account (FR-MOD-00.3)', () => {
    const failures: Array<{
      name: string;
      respond: (step: FakeStep) => FakeReply | undefined;
      /** Sessions the carrier opens for the one existing account. */
      attempts: number;
    }> = [
      {
        name: 'a permanent refusal (550 on RCPT)',
        respond: (step) => (step.verb === 'RCPT' ? '550 5.1.1 Mailbox unavailable' : undefined),
        attempts: 1,
      },
      {
        name: 'a transient failure that outlasts every retry (451 on RCPT)',
        respond: (step) => (step.verb === 'RCPT' ? '451 4.3.0 Try again later' : undefined),
        attempts: 3,
      },
      {
        name: 'a message whose acceptance never comes back (dropped after the dot)',
        respond: (step) => (step.verb === 'MESSAGE' ? { close: true } : undefined),
        attempts: 1,
      },
    ];

    for (const failure of failures) {
      it(`answers an existing and an unknown address identically under ${failure.name}`, async () => {
        const { api, smtp, log } = await stack(failure.respond);

        const known = await api.post('/auth/password-reset', { email: fx.a.ownerEmail });
        const unknown = await api.post('/auth/password-reset', { email: UNKNOWN });

        expect(known.statusCode).toBe(202);
        expect(unknown.statusCode).toBe(known.statusCode);
        // Byte for byte, not "both look fine".
        expect(known.body).toBe(unknown.body);

        // The carrier really was tried — for the account, and only for it.
        await api.app.backgroundMail.settled();
        expect(smtp.sessions).toHaveLength(failure.attempts);
        expect(new Set(recipients(smtp))).toEqual(new Set([fx.a.ownerEmail.toLowerCase()]));

        // Logged, by classification — and nowhere with the address that would
        // tell a log reader this account exists.
        expect(log.text).toContain('password_reset.mail');
        expect(log.text.toLowerCase()).not.toContain(fx.a.ownerEmail.toLowerCase());
      });
    }

    it('answers before the carrier has said a word', async () => {
      // The server accepts the connection and never greets. Before this task
      // the route awaited the carrier, so this request took the full timeout
      // and the unknown address took none of it.
      const { api, smtp } = await stack(
        (step) => (step.verb === 'GREETING' ? { hang: true } : undefined),
        { timeoutMs: 3_000, maxAttempts: 1 },
      );

      const started = performance.now();
      const known = await api.post('/auth/password-reset', { email: fx.a.ownerEmail });
      const elapsed = performance.now() - started;

      expect(known.statusCode).toBe(202);
      expect(elapsed).toBeLessThan(1_500);

      // And the send did happen, after the answer: one session, timed out.
      await api.app.backgroundMail.settled();
      expect(smtp.sessions).toHaveLength(1);
    });

    it('delivers a link that works once when the carrier accepts', async () => {
      const { api, smtp } = await stack();

      await api.post('/auth/password-reset', { email: fx.a.ownerEmail });
      await api.app.backgroundMail.settled();

      expect(smtp.messages).toHaveLength(1);
      const mail = readReceivedMail(smtp.messages[0]!);
      expect(mail.to).toBe(fx.a.ownerEmail);
      const token = tokenIn(mail.body, '/reset-password');
      expect(token).toBeTruthy();

      const first = await api.post('/auth/password-reset/confirm', {
        token,
        password: 'a-new-long-passphrase',
      });
      expect(first.statusCode).toBe(204);
      const second = await api.post('/auth/password-reset/confirm', {
        token,
        password: 'another-long-passphrase',
      });
      expect(second.statusCode).toBe(401);
    });
  });

  // =========================================================================
  // Invitations are not undone by their mail
  // =========================================================================

  describe('invitations — a mail failure does not fail the invitation (FR-MOD-04.4)', () => {
    it('answers 201, names the one address that failed, and keeps all three live', async () => {
      const [first, second, third] = [unique('first'), unique('second'), unique('third')];
      const { api, smtp, log } = await stack((step) =>
        step.verb === 'RCPT' && step.line.toLowerCase().includes(second)
          ? '550 5.1.1 Mailbox unavailable'
          : undefined,
      );

      const response = await api.post(
        '/invitations',
        { emails: [first, second, third], role: 'agent' },
        auth(),
      );

      expect(response.statusCode).toBe(201);
      const body = response.json() as {
        items: Array<{ id: string; email: string; accept_url: string }>;
        undelivered: Array<{ id: string; email: string; reason: string }>;
      };
      expect(body.items.map((item) => item.email)).toEqual([first, second, third]);
      const failed = body.items[1]!;
      expect(body.undelivered).toEqual([{ id: failed.id, email: second, reason: 'failed' }]);

      // All three committed, and every link — the failed one's included — opens.
      const stored = await owner.invitation.count({
        where: { email: { in: [first, second, third] }, acceptedAt: null },
      });
      expect(stored).toBe(3);
      for (const item of body.items) {
        const token = new URL(item.accept_url).searchParams.get('token')!;
        const preview = await api.get(
          `/auth/invitations/preview?token=${encodeURIComponent(token)}`,
        );
        expect(preview.statusCode).toBe(200);
        expect((preview.json() as { email: string }).email).toBe(item.email);
      }

      // The other two did go out.
      expect(smtp.messages.map((raw) => readReceivedMail(raw).to).sort()).toEqual(
        [first, third].sort(),
      );
      // The log names the invitation, not the address.
      expect(log.text).toContain(failed.id);
      expect(log.text.toLowerCase()).not.toContain(second);
    });

    it('reports an unconfirmed send as unconfirmed, and never sends it twice', async () => {
      const address = unique('maybe');
      const { api, smtp } = await stack((step) =>
        step.verb === 'MESSAGE' ? { close: true } : undefined,
      );

      const response = await api.post('/invitations', { emails: [address] }, auth());

      expect(response.statusCode).toBe(201);
      const body = response.json() as {
        items: Array<{ id: string }>;
        undelivered: Array<{ id: string; email: string; reason: string }>;
      };
      expect(body.undelivered).toEqual([
        { id: body.items[0]!.id, email: address, reason: 'unconfirmed' },
      ]);
      // The single-use link went over the wire once, and only once.
      expect(smtp.dataCommands).toBe(1);
    });

    it('re-inviting the failed address replaces its invitation rather than adding one', async () => {
      const address = unique('retry');
      let refuse = true;
      const { api } = await stack((step) =>
        refuse && step.verb === 'RCPT' ? '550 5.1.1 Mailbox unavailable' : undefined,
      );

      const firstTry = await api.post('/invitations', { emails: [address] }, auth());
      expect(firstTry.statusCode).toBe(201);
      const before = firstTry.json() as {
        items: Array<{ accept_url: string }>;
        undelivered: unknown[];
      };
      expect(before.undelivered).toHaveLength(1);

      refuse = false;
      const secondTry = await api.post('/invitations', { emails: [address] }, auth());
      expect(secondTry.statusCode).toBe(201);
      const after = secondTry.json() as {
        items: Array<{ accept_url: string }>;
        undelivered: unknown[];
      };
      expect(after.undelivered).toEqual([]);

      expect(await owner.invitation.count({ where: { email: address, acceptedAt: null } })).toBe(1);

      const tokenOf = (url: string) => new URL(url).searchParams.get('token')!;
      const stale = await api.get(
        `/auth/invitations/preview?token=${encodeURIComponent(tokenOf(before.items[0]!.accept_url))}`,
      );
      expect(stale.statusCode).toBe(401);
      const fresh = await api.get(
        `/auth/invitations/preview?token=${encodeURIComponent(tokenOf(after.items[0]!.accept_url))}`,
      );
      expect(fresh.statusCode).toBe(200);
    });
  });

  // =========================================================================
  // Token lifetimes — verified, not changed
  // =========================================================================

  describe('token lifetimes stay as they were', () => {
    /** Move a stored expiry into the past as if `ms` had passed since it was issued. */
    async function age(table: 'password_reset_tokens' | 'invitations', id: string, ms: number) {
      const shift = `${ms} milliseconds`;
      if (table === 'password_reset_tokens') {
        await owner.$executeRaw`
          UPDATE password_reset_tokens SET expires_at = expires_at - ${shift}::interval
          WHERE token_hash = ${id}`;
      } else {
        await owner.$executeRaw`
          UPDATE invitations SET expires_at = expires_at - ${shift}::interval WHERE id = ${id}::uuid`;
      }
    }

    async function mailedResetToken(stackUnderTest: Stack): Promise<string> {
      const { api, smtp } = stackUnderTest;
      const already = smtp.messages.length;
      await api.post('/auth/password-reset', { email: fx.a.ownerEmail });
      await api.app.backgroundMail.settled();
      expect(smtp.messages).toHaveLength(already + 1);
      return tokenIn(readReceivedMail(smtp.messages.at(-1)!).body, '/reset-password')!;
    }

    it('a reset link lasts one hour and works once (FR-MOD-00.3)', async () => {
      const current = await stack();

      const requestedFrom = Date.now();
      const onTime = await mailedResetToken(current);
      const requestedBy = Date.now();

      const [row] = await owner.passwordResetToken.findMany({ where: { usedAt: null } });
      expect(row!.expiresAt.getTime()).toBeGreaterThanOrEqual(requestedFrom + HOUR_MS);
      expect(row!.expiresAt.getTime()).toBeLessThanOrEqual(requestedBy + HOUR_MS);

      // Fifty-nine minutes on, it still works — once.
      await age('password_reset_tokens', row!.tokenHash, 59 * 60 * 1000);
      const used = await current.api.post('/auth/password-reset/confirm', {
        token: onTime,
        password: 'a-new-long-passphrase',
      });
      expect(used.statusCode).toBe(204);
      const reused = await current.api.post('/auth/password-reset/confirm', {
        token: onTime,
        password: 'another-long-passphrase',
      });
      expect(reused.statusCode).toBe(401);

      // An hour on, a fresh one does not.
      const late = await mailedResetToken(current);
      const [lateRow] = await owner.passwordResetToken.findMany({ where: { usedAt: null } });
      await age('password_reset_tokens', lateRow!.tokenHash, HOUR_MS);
      const expired = await current.api.post('/auth/password-reset/confirm', {
        token: late,
        password: 'a-third-long-passphrase',
      });
      expect(expired.statusCode).toBe(401);
    });

    it('an invitation lasts seven days and works once', async () => {
      const { api, smtp } = await stack();
      const [onTime, late] = [unique('on-time'), unique('late')];

      const invitedFrom = Date.now();
      const response = await api.post('/invitations', { emails: [onTime, late] }, auth());
      const invitedBy = Date.now();
      expect(response.statusCode).toBe(201);
      const { items } = response.json() as {
        items: Array<{ id: string; email: string; expires_at: string }>;
      };
      for (const item of items) {
        const expires = new Date(item.expires_at).getTime();
        expect(expires).toBeGreaterThanOrEqual(invitedFrom + 7 * DAY_MS);
        expect(expires).toBeLessThanOrEqual(invitedBy + 7 * DAY_MS);
      }

      // The tokens as the invitees get them: out of the mail.
      const tokenFor = (address: string) =>
        tokenIn(
          smtp.messages.map(readReceivedMail).find((mail) => mail.to === address)!.body,
          '/join',
        )!;

      // A minute short of seven days, it works — once.
      await age('invitations', items[0]!.id, 7 * DAY_MS - 60_000);
      const accepted = await api.post('/auth/invitations/accept', {
        token: tokenFor(onTime),
        name: 'On Time',
        password: 'a-quite-long-passphrase',
      });
      expect(accepted.statusCode).toBe(200);
      const again = await api.post('/auth/invitations/accept', {
        token: tokenFor(onTime),
        name: 'On Time',
        password: 'a-quite-long-passphrase',
      });
      expect(again.statusCode).toBe(401);

      // Seven days on, it does not.
      await age('invitations', items[1]!.id, 7 * DAY_MS);
      const preview = await api.get(
        `/auth/invitations/preview?token=${encodeURIComponent(tokenFor(late))}`,
      );
      expect(preview.statusCode).toBe(401);
      const expired = await api.post('/auth/invitations/accept', {
        token: tokenFor(late),
        name: 'Too Late',
        password: 'a-quite-long-passphrase',
      });
      expect(expired.statusCode).toBe(401);
    });
  });
});
