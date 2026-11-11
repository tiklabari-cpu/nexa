/**
 * Settings → "send a test e-mail" (tm 464.3 · G-05 / NY-44).
 *
 * `POST /settings/email/test` mails the caller — an administrator — and only
 * the caller, through the durable outbox like every other mail, and answers
 * with how the first try went:
 *
 *   - an admin gets `202`, a `smtp_test` row in `mail_outbox` addressed to
 *     their own address, and the message in the spool;
 *   - a body naming another recipient changes nothing;
 *   - an agent is refused before anything is queued;
 *   - five an hour per member, the sixth is `429` with `Retry-After`;
 *   - a retryable failure is `queued` with its classification and the outbox
 *     sends it later; a permanent one is `failed` — and neither carries the
 *     server's reply text.
 */
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FileMailer, type Mailer, type Message } from '../../src/services/mail/mailer.js';
import { PermanentMailError, TransientMailError } from '../../src/services/mail/mail-error.js';
import { grantToken, ownerClient, seedFixtures, type Fixtures } from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

const SERVER_REPLY = 'mailbox owner-secret@relay.example.test unknown';

/** A carrier that spools, or fails the way it is told to — and counts each attempt. */
class SwitchableCarrier implements Mailer {
  mode: 'ok' | 'transient' | 'auth' = 'ok';
  readonly attempts: Message[] = [];

  constructor(private readonly spool: FileMailer) {}

  async send(message: Message): Promise<void> {
    this.attempts.push(message);
    if (this.mode === 'transient') {
      throw new TransientMailError({
        code: 'rejected',
        phase: 'rcpt_to',
        smtpCode: 451,
        detail: SERVER_REPLY,
      });
    }
    if (this.mode === 'auth') {
      throw new PermanentMailError({
        code: 'auth',
        phase: 'auth',
        smtpCode: 535,
        enhancedCode: '5.7.8',
        detail: SERVER_REPLY,
      });
    }
    await this.spool.send(message);
  }
}

describe('POST /settings/email/test (tm 464.3)', () => {
  let owner: PrismaClient;
  let server: TestServer;
  let mailDir: string;
  let carrier: SwitchableCarrier;
  let fx: Fixtures;
  let seq = 0;

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });
  const sendTest = (token: string, body?: unknown) =>
    server.post('/settings/email/test', body, auth(token));

  beforeAll(async () => {
    owner = ownerClient();
    mailDir = await mkdtemp(join(tmpdir(), 'siyahtus-smtp-test-'));
    carrier = new SwitchableCarrier(new FileMailer(mailDir));
    // The injected carrier stands in for the SMTP one the setting names.
    server = await startTestServer({ MAIL_PROVIDER: 'smtp' }, { mailer: carrier });
  });

  afterAll(async () => {
    await server.close();
    await owner.$disconnect();
    await rm(mailDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    fx = await seedFixtures(owner);
    await clearRateLimits(server.app);
    await rm(mailDir, { recursive: true, force: true });
    await owner.mailOutbox.deleteMany({});
    carrier.mode = 'ok';
    carrier.attempts.length = 0;
  });

  async function seedMember(role: 'admin' | 'agent', locale: string | null = null) {
    const email = `${role}-${(seq += 1)}-${Date.now()}@example.test`;
    const account = await owner.account.create({
      data: { email, name: `Smtp ${role}` },
      select: { id: true },
    });
    await owner.agentMembership.create({
      data: { licenseId: fx.a.licenseId, agentId: account.id, role, locale },
    });
    const token = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: account.id,
      scopes: ['access_rules:rw'],
    });
    return { accountId: account.id, email, token };
  }

  const testRows = () =>
    owner.mailOutbox.findMany({
      where: { kind: 'smtp_test' },
      orderBy: { createdAt: 'asc' },
      select: { licenseId: true, recipient: true, status: true, attempts: true },
    });

  async function spooled(): Promise<Array<Message & { licenseId: string }>> {
    const files = await readdir(mailDir).catch(() => [] as string[]);
    return Promise.all(
      files.map(async (f) => JSON.parse(await readFile(join(mailDir, f), 'utf8'))),
    );
  }

  it('mails the admin at their own address through the outbox, and says it was sent', async () => {
    const admin = await seedMember('admin');

    const res = await sendTest(admin.token);

    expect(res.statusCode, res.body).toBe(202);
    expect(res.json()).toEqual({ status: 'sent', to: admin.email, provider: 'smtp', error: null });
    expect(await testRows()).toEqual([
      { licenseId: fx.a.licenseId, recipient: admin.email, status: 'sent', attempts: 1 },
    ]);
    const mails = await spooled();
    expect(mails).toHaveLength(1);
    expect(mails[0]).toMatchObject({
      to: admin.email,
      kind: 'smtp_test',
      subject: 'SiyahTuş test email',
      locale: 'en',
    });
  });

  it('ignores a recipient in the body — the caller is the only one it mails', async () => {
    const admin = await seedMember('admin');

    const res = await sendTest(admin.token, { to: 'stranger@example.test' });

    expect(res.statusCode, res.body).toBe(202);
    expect(carrier.attempts.map((m) => m.to)).toEqual([admin.email]);
    expect((await testRows()).map((r) => r.recipient)).toEqual([admin.email]);
  });

  it('writes the message in the member’s own language', async () => {
    const admin = await seedMember('admin', 'tr');

    expect((await sendTest(admin.token)).statusCode).toBe(202);

    expect(carrier.attempts[0]).toMatchObject({
      kind: 'smtp_test',
      locale: 'tr',
      subject: 'SiyahTuş test e-postası',
    });
  });

  it('lets the owner send one too (owner is above admin)', async () => {
    const token = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['access_rules:rw'],
    });

    const res = await sendTest(token);

    expect(res.statusCode, res.body).toBe(202);
    expect(res.json()).toMatchObject({ status: 'sent', to: fx.a.ownerEmail });
  });

  it('refuses an agent before anything is queued', async () => {
    const agent = await seedMember('agent');

    const res = await sendTest(agent.token);

    expect(res.statusCode, res.body).toBe(403);
    expect(await testRows()).toEqual([]);
    expect(carrier.attempts).toEqual([]);
  });

  it('allows five an hour per member and answers the sixth 429 with Retry-After', async () => {
    const admin = await seedMember('admin');
    for (let i = 0; i < 5; i += 1) {
      expect((await sendTest(admin.token)).statusCode).toBe(202);
    }

    const sixth = await sendTest(admin.token);

    expect(sixth.statusCode, sixth.body).toBe(429);
    expect(Number(sixth.headers['retry-after'])).toBeGreaterThan(0);
    expect(Number(sixth.headers['retry-after'])).toBeLessThanOrEqual(3600);
    expect(await testRows()).toHaveLength(5);

    // The budget is the member's, not the workspace's.
    const other = await seedMember('admin');
    expect((await sendTest(other.token)).statusCode).toBe(202);
  });

  it('answers a retryable failure as queued with its classification, and the outbox sends it later', async () => {
    const admin = await seedMember('admin');
    carrier.mode = 'transient';

    const res = await sendTest(admin.token);

    expect(res.statusCode, res.body).toBe(202);
    expect(res.json()).toEqual({
      status: 'queued',
      to: admin.email,
      provider: 'smtp',
      error: { code: 'rejected', phase: 'rcpt_to', smtp_code: 451 },
    });
    expect(res.body).not.toContain('owner-secret');
    expect(await testRows()).toEqual([expect.objectContaining({ status: 'pending' })]);

    carrier.mode = 'ok';
    await owner.mailOutbox.updateMany({
      where: { status: 'pending' },
      data: { nextAttemptAt: new Date(Date.now() - 1_000) },
    });
    await server.app.mailOutbox.createWorker().run();
    expect(await testRows()).toEqual([expect.objectContaining({ status: 'sent', attempts: 2 })]);
    expect(await spooled()).toHaveLength(1);
  });

  it('answers refused credentials as failed with the SMTP code and never the server’s words', async () => {
    const admin = await seedMember('admin');
    carrier.mode = 'auth';

    const res = await sendTest(admin.token);

    expect(res.statusCode, res.body).toBe(202);
    expect(res.json()).toEqual({
      status: 'failed',
      to: admin.email,
      provider: 'smtp',
      error: { code: 'auth', phase: 'auth', smtp_code: 535 },
    });
    expect(res.body).not.toContain('owner-secret');
    expect(await testRows()).toEqual([expect.objectContaining({ status: 'failed' })]);
    // Permanent: nothing waits for a retry.
    expect(carrier.attempts).toHaveLength(1);
  });
});
