/**
 * The three courtesy mails no longer hold up the request that causes them
 * (tm 256.4).
 *
 * The assignee's new-message e-mail (FR-MOD-13.8), the end-of-chat transcript
 * (FR-MOD-08.7.4) and a ticket's customer notice (FR-MOD-08.7.5) were each
 * awaited inside the request. With the SMTP carrier that made the visitor, the
 * archiving agent and the agent moving a ticket wait for the mail server: one
 * round trip when it is healthy, ~33 s when it has stopped answering (three
 * 10 s timeouts plus backoff, PLAN §D179). Each is now handed to
 * `app.backgroundMail`.
 *
 * Proven with a carrier the test controls rather than with timings. While it
 * holds every message, all three requests must still answer — a route that
 * still awaited its mail would never return — and once it lets go, every
 * message must arrive. A carrier that refuses must cost no answer, and must
 * leave a log line naming the mail and the carrier's classification, never the
 * recipient.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PrismaClient } from '@prisma/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { grantToken, ownerClient, seedFixtures, type Fixtures } from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';
import { FileMailer, type Mailer, type Message } from '../../src/services/mail/mailer.js';
import { PermanentMailError } from '../../src/services/mail/mail-error.js';

const VISITOR = 'buyer@example.test';
const TICKET_CUSTOMER = 'ada@example.test';
/** Longer than any of these requests takes, far shorter than a hung carrier. */
const ANSWER_DEADLINE_MS = 10_000;

/**
 * The carrier under the test's hand: it holds every message until released, or
 * refuses every message, and hands what it lets through to a spool.
 */
class ControlledCarrier implements Mailer {
  mode: 'hold' | 'refuse' = 'hold';
  readonly #held: Array<() => void> = [];

  constructor(private readonly spool: FileMailer) {}

  get held(): number {
    return this.#held.length;
  }

  async send(message: Message): Promise<void> {
    if (this.mode === 'refuse') {
      throw new PermanentMailError({ code: 'rejected', phase: 'rcpt_to', smtpCode: 550 });
    }
    await new Promise<void>((resolve) => this.#held.push(resolve));
    await this.spool.send(message);
  }

  release(): void {
    for (const resolve of this.#held.splice(0)) resolve();
  }
}

/** Collects the JSON log lines the server writes. */
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
}

/** The request's answer, or a failure that says it waited for the carrier. */
async function answered<T>(what: string, request: Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${what} did not answer: it is waiting for the mail carrier`)),
      ANSWER_DEADLINE_MS,
    );
  });
  try {
    return await Promise.race([request, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

describe('courtesy mail leaves the request (tm 256.4)', () => {
  let owner: PrismaClient;
  let server: TestServer;
  let spool: FileMailer;
  let carrier: ControlledCarrier;
  let sink: LineSink;
  let mailDir: string;
  let fx: Fixtures;
  let agentToken: string;
  let adminToken: string;

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });

  beforeAll(async () => {
    owner = ownerClient();
    mailDir = await mkdtemp(join(tmpdir(), 'siyahtus-courtesy-mail-'));
    spool = new FileMailer(mailDir);
    carrier = new ControlledCarrier(spool);
    sink = new LineSink();
    server = await startTestServer(
      { LOG_LEVEL: 'warn' },
      { mailer: carrier, logStream: sink as unknown as NodeJS.WritableStream },
    );
  });

  afterAll(async () => {
    // `close` waits for the sends in flight; none may still be held.
    carrier.release();
    await server.close();
    await owner.$disconnect();
    await rm(mailDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    fx = await seedFixtures(owner);
    await clearRateLimits(server.app);
    await rm(mailDir, { recursive: true, force: true });
    carrier.mode = 'hold';
    sink.lines.length = 0;

    // Route to a team the agent is on, so the visitor's chat has an assignee
    // to e-mail and a transcript has a team copy.
    const support = await owner.group.create({
      data: { licenseId: fx.a.licenseId, name: 'Support' },
      select: { id: true },
    });
    await owner.groupAgent.create({
      data: {
        licenseId: fx.a.licenseId,
        groupId: support.id,
        agentId: fx.a.agentAccountId,
        priority: 'normal',
      },
    });
    await owner.routingRule.create({
      data: {
        licenseId: fx.a.licenseId,
        kind: 'chat',
        isFallback: true,
        targetGroupId: support.id,
      },
    });

    agentToken = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['chats--all:rw', 'chats--all:ro'],
    });
    adminToken = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['tickets--all:rw', 'tickets--all:ro', 'customers:ro'],
    });
  });

  afterEach(async () => {
    carrier.release();
    await server.app.backgroundMail.settled();
  });

  /**
   * The three requests that each cause one of the mails, every one of them
   * held to the deadline: a visitor writes in (assignee e-mail), the agent
   * archives the chat (transcript to the visitor and the agent), the agent
   * solves a ticket with a template (customer notice).
   */
  async function causeAllThree(): Promise<void> {
    const widget = await server.post(
      '/customer/token',
      { organization_id: fx.a.organizationId },
      { origin: `https://${fx.a.trustedDomain}` },
    );
    expect(widget.statusCode).toBe(200);
    const visitorToken = (widget.json() as { token: string }).token;

    const written = await answered(
      'the visitor message',
      server.post(
        '/customer/chat/events',
        { text: 'Where is my parcel?', email: VISITOR },
        auth(visitorToken),
      ),
    );
    expect(written.statusCode).toBe(201);
    const chatId = (written.json() as { chat_id: string }).chat_id;

    const archived = await answered(
      'the archive',
      server.post(`/chats/${chatId}/deactivate`, undefined, auth(agentToken)),
    );
    expect(archived.statusCode).toBe(200);

    const customer = await owner.customer.create({
      data: { organizationId: fx.a.organizationId, name: 'Ada Lovelace', email: TICKET_CUSTOMER },
      select: { id: true },
    });
    const template = await server.post(
      '/settings/ticket-email-templates',
      { name: 'Solved', subject: 'Ticket {{ticket.id}} solved', body: 'Hi {{customer.name}}.' },
      auth(adminToken),
    );
    expect(template.statusCode).toBe(201);
    const ticket = await server.post(
      '/tickets',
      { subject: 'Parcel lost', customer_id: customer.id },
      auth(adminToken),
    );
    expect(ticket.statusCode).toBe(201);

    const solved = await answered(
      'the ticket update',
      server.patch(
        `/tickets/${(ticket.json() as { id: string }).id}`,
        {
          status: 'solved',
          email_template_id: (template.json() as { id: string }).id,
        },
        auth(adminToken),
      ),
    );
    expect(solved.statusCode).toBe(200);
  }

  it('answers all three while the carrier holds every message, and delivers them once it answers (FR-MOD-13.8 · FR-MOD-08.7.4 · FR-MOD-08.7.5)', async () => {
    await causeAllThree();

    // Every mail is on its way and stuck with the carrier — the answers above
    // came back without them: the assignee's, two transcript copies, the notice.
    await vi.waitFor(() => expect(carrier.held).toBe(4), { timeout: 5_000 });
    expect(await spool.outbox()).toEqual([]);

    carrier.release();
    await server.app.backgroundMail.settled();

    const delivered = (await spool.outbox()).map((m) => `${m.kind} → ${m.to}`).sort();
    expect(delivered).toEqual(
      [
        `notification → ${fx.a.agentEmail}`, // the assignee's new-message e-mail
        `notification → ${fx.a.agentEmail}`, // the team copy of the transcript
        `notification → ${VISITOR}`, // the visitor's copy of the transcript
        `ticket_notice → ${TICKET_CUSTOMER}`,
      ].sort(),
    );
  });

  it('answers all three when the carrier refuses, and logs each refusal without its recipient', async () => {
    carrier.mode = 'refuse';

    await causeAllThree();
    await server.app.backgroundMail.settled();

    expect(await spool.outbox()).toEqual([]);

    const events = ['assignee_notification.mail', 'chat.transcript_mail', 'ticket.notice_mail'];
    const failures = sink.lines
      .flatMap((line) => line.split('\n'))
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .filter((entry) => events.includes(entry['event'] as string));

    // One line per message that did not go out: the transcript has two copies.
    expect(failures.map((entry) => entry['event']).sort()).toEqual(
      [
        'assignee_notification.mail',
        'chat.transcript_mail',
        'chat.transcript_mail',
        'ticket.notice_mail',
      ].sort(),
    );
    for (const entry of failures) {
      expect(entry).toMatchObject({
        outcome: 'failed',
        mail: { code: 'rejected', phase: 'rcpt_to', smtpCode: 550 },
      });
    }
    const written = JSON.stringify(failures);
    for (const address of [VISITOR, TICKET_CUSTOMER, fx.a.agentEmail]) {
      expect(written).not.toContain(address);
    }
  });
});
