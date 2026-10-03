/**
 * What each route does when a daily mail cap refuses its mail (tm 257.14 ·
 * ADR `docs/adr/pilot-public-readiness.md` K-e(4)).
 *
 * Through the real server, whose one mailer is `CappedMailer` around the
 * spool this suite injects: an invitation reports `cap_reached` and keeps its
 * link; the ticket notice and the visitor's transcript are dropped with one
 * warning each while the workspace's own notices still go; the two-factor
 * notice — sent with `mailer.send`, past `deliver` — is capped like the rest;
 * account mail keeps the security reserve and a per-address count behind the
 * same neutral 202; a pilot deployment's ticket notice says its mailbox reads
 * no replies; the SSO challenge answers 429 instead of "try again in a
 * minute". The counter itself is `mail-caps.test.ts`.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PrismaClient } from '@prisma/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { generateTotp } from '../../src/lib/totp.js';
import { utcDayKey } from '../../src/services/ai/ai-daily-budget.js';
import { FileMailer } from '../../src/services/mail/mailer.js';
import { PILOT_NO_REPLY_LINE } from '../../src/services/tickets/ticket-email.js';
import { VALID_CERTIFICATE_PEM } from '../helpers/certificates.js';
import {
  TEST_PASSWORD,
  grantToken,
  ownerClient,
  seedFixtures,
  type Fixtures,
  type TenantFixture,
} from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

const VISITOR = 'buyer@example.test';
const TICKET_CUSTOMER = 'ada@example.test';

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

  /** Parsed lines whose `event` is `event`. */
  events(event: string): Array<Record<string, unknown>> {
    return this.lines
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .filter((line) => line['event'] === event);
  }
}

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

interface Harness {
  server: TestServer;
  spool: FileMailer;
  sink: LineSink;
  mailDir: string;
}

async function startHarness(overrides: Partial<NodeJS.ProcessEnv> = {}): Promise<Harness> {
  const mailDir = await mkdtemp(join(tmpdir(), 'siyahtus-mail-caps-routes-'));
  const spool = new FileMailer(mailDir);
  const sink = new LineSink();
  const server = await startTestServer(
    { LOG_LEVEL: 'warn', ...overrides },
    { mailer: spool, logStream: sink as unknown as NodeJS.WritableStream },
  );
  return { server, spool, sink, mailDir };
}

async function stopHarness(h: Harness): Promise<void> {
  await h.server.close();
  await rm(h.mailDir, { recursive: true, force: true });
}

/** Put a counter at `sent` for today, as the table owner. */
async function fill(
  owner: PrismaClient,
  meter: string,
  licenseId: bigint | null,
  sent: number,
): Promise<void> {
  // Today and tomorrow (UTC), so a test that straddles midnight still meets it.
  const now = new Date();
  for (const at of [now, new Date(now.getTime() + 86_400_000)]) {
    await owner.$executeRaw`
      INSERT INTO mail_daily_usage (id, license_id, day, meter, recipient_hash, sent, updated_at)
      VALUES (gen_random_uuid(), ${licenseId}::bigint, ${utcDayKey(at)}, ${meter}, NULL, ${sent}, now())
      ON CONFLICT (license_id, day, meter, recipient_hash) DO UPDATE SET sent = EXCLUDED.sent`;
  }
}

/** Solve a ticket with a template, so the customer is sent a notice. */
async function solveTicketWithNotice(
  owner: PrismaClient,
  server: TestServer,
  t: TenantFixture,
  token: string,
): Promise<void> {
  const customer = await owner.customer.create({
    data: { organizationId: t.organizationId, name: 'Ada Lovelace', email: TICKET_CUSTOMER },
    select: { id: true },
  });
  const template = await server.post(
    '/settings/ticket-email-templates',
    { name: 'Solved', subject: 'Ticket {{ticket.id}} solved', body: 'Hi {{customer.name}}.' },
    auth(token),
  );
  expect(template.statusCode).toBe(201);
  const ticket = await server.post(
    '/tickets',
    { subject: 'Parcel lost', customer_id: customer.id },
    auth(token),
  );
  expect(ticket.statusCode).toBe(201);
  const solved = await server.patch(
    `/tickets/${(ticket.json() as { id: string }).id}`,
    { status: 'solved', email_template_id: (template.json() as { id: string }).id },
    auth(token),
  );
  expect(solved.statusCode).toBe(200);
}

describe('routes under the daily mail caps (tm 257.14)', () => {
  let owner: PrismaClient;
  let h: Harness;
  let fx: Fixtures;
  let adminToken: string;

  beforeAll(async () => {
    owner = ownerClient();
    h = await startHarness();
  });

  afterAll(async () => {
    await stopHarness(h);
    await owner.$disconnect();
  });

  beforeEach(async () => {
    fx = await seedFixtures(owner);
    await clearRateLimits(h.server.app);
    await rm(h.mailDir, { recursive: true, force: true });
    h.sink.lines.length = 0;
    adminToken = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: [
        'accounts--all:rw',
        'chats--all:rw',
        'chats--all:ro',
        'tickets--all:rw',
        'tickets--all:ro',
        'customers:ro',
      ],
    });
  });

  afterEach(async () => {
    await h.server.app.backgroundMail.settled();
  });

  const outbox = async () => {
    await h.server.app.backgroundMail.settled();
    return (await h.spool.outbox()).map((m) => `${m.kind} → ${m.to}`).sort();
  };

  it('reports an invitation the cap refused as undelivered with reason cap_reached, link intact', async () => {
    await fill(owner, 'external', fx.a.licenseId, 50);

    const response = await h.server.post(
      '/invitations',
      { emails: ['first@example.test', 'second@example.test'], role: 'agent' },
      auth(adminToken),
    );

    expect(response.statusCode).toBe(201);
    const body = response.json() as {
      items: Array<{ id: string; email: string; accept_url: string }>;
      undelivered: Array<{ id: string; email: string; reason: string }>;
    };
    expect(body.items).toHaveLength(2);
    for (const item of body.items) expect(item.accept_url).toMatch(/\/join\?token=/);
    expect(body.undelivered.map((u) => [u.email, u.reason]).sort()).toEqual([
      ['first@example.test', 'cap_reached'],
      ['second@example.test', 'cap_reached'],
    ]);
    expect(await outbox()).toEqual([]);

    // One line per refusal, from the cap; none from the route.
    expect(h.sink.events('mail.cap_reached')).toHaveLength(2);
    expect(h.sink.events('invitation.mail')).toEqual([]);
  });

  it("drops the ticket notice and the visitor's transcript with one warning each, and still mails the team", async () => {
    // Route the visitor's chat to a team the agent is on, so it has an
    // assignee to notify and a transcript has a team copy.
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
    await fill(owner, 'external', fx.a.licenseId, 50);

    const widget = await h.server.post(
      '/customer/token',
      { organization_id: fx.a.organizationId },
      { origin: `https://${fx.a.trustedDomain}` },
    );
    const visitorToken = (widget.json() as { token: string }).token;
    const written = await h.server.post(
      '/customer/chat/events',
      { text: 'Where is my parcel?', email: VISITOR },
      auth(visitorToken),
    );
    expect(written.statusCode).toBe(201);
    const chatId = (written.json() as { chat_id: string }).chat_id;
    const archived = await h.server.post(
      `/chats/${chatId}/deactivate`,
      undefined,
      auth(adminToken),
    );
    expect(archived.statusCode).toBe(200);
    await solveTicketWithNotice(owner, h.server, fx.a, adminToken);

    expect(await outbox()).toEqual(
      [
        `notification → ${fx.a.agentEmail}`, // the assignee's new-message e-mail
        `notification → ${fx.a.agentEmail}`, // the team's transcript copy
      ].sort(),
    );

    const refusals = h.sink.events('mail.cap_reached');
    expect(refusals.map((r) => r['kind']).sort()).toEqual(['chat_transcript', 'ticket_notice']);
    for (const refusal of refusals) {
      expect(refusal).toMatchObject({ license_id: fx.a.licenseId.toString(), scope: 'external' });
    }
    expect(h.sink.events('ticket.notice_mail')).toEqual([]);
    expect(h.sink.events('chat.transcript_mail')).toEqual([]);
    expect(h.sink.lines.join('\n')).not.toContain(VISITOR);
    expect(h.sink.lines.join('\n')).not.toContain(TICKET_CUSTOMER);
  });

  it('caps the two-factor notice too, though it is sent without deliver()', async () => {
    // Account mail may use the reserve, so only a full global cap stops it.
    await fill(owner, 'global', null, 400);
    const bearer = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.agentAccountId,
      scopes: ['accounts--my:rw'],
    });

    const enroll = await h.server.post(
      '/auth/2fa/enroll',
      { password: TEST_PASSWORD },
      auth(bearer),
    );
    expect(enroll.statusCode).toBe(200);
    const activated = await h.server.post(
      '/auth/2fa/activate',
      { code: generateTotp(enroll.json().secret as string, Date.now()), password: TEST_PASSWORD },
      auth(bearer),
    );

    // The factor is on whatever happened to the notice.
    expect(activated.statusCode).toBe(200);
    expect(await outbox()).toEqual([]);
    expect(h.sink.events('mail.cap_reached')).toEqual([
      expect.objectContaining({ kind: 'notification', license_id: null, scope: 'global' }),
    ]);
  });

  it('answers every password reset the same 202, and mails one address five times a day at most', async () => {
    const answers: string[] = [];
    for (let i = 0; i < 6; i += 1) {
      const response = await h.server.post('/auth/password-reset', { email: fx.a.agentEmail });
      expect(response.statusCode).toBe(202);
      answers.push(response.body);
    }

    expect(new Set(answers).size).toBe(1);
    expect(await outbox()).toEqual(
      Array.from({ length: 5 }, () => `password_reset → ${fx.a.agentEmail}`),
    );
    expect(h.sink.events('mail.cap_reached')).toEqual([
      expect.objectContaining({ kind: 'password_reset', license_id: null, scope: 'recipient' }),
    ]);
    expect(h.sink.events('password_reset.mail')).toEqual([]);
    expect(h.sink.lines.join('\n')).not.toContain(fx.a.agentEmail);
  });

  it('answers the SSO domain challenge 429 limit_reached mail_daily_cap when the cap refuses it', async () => {
    await owner.$executeRaw`DELETE FROM mail_daily_usage`;
    const enterprise = await seedFixtures(owner, { plan: 'enterprise' });
    const ownerToken = await grantToken(owner, {
      licenseId: enterprise.a.licenseId,
      organizationId: enterprise.a.organizationId,
      ownerId: enterprise.a.ownerAccountId,
      scopes: ['access_rules:rw'],
    });
    const created = await h.server.post(
      '/settings/sso',
      {
        name: 'Okta (corp)',
        idp_entity_id: 'https://idp.example.test/saml/metadata',
        idp_sso_url: 'https://idp.example.test/saml/sso',
        idp_certificate_pem: VALID_CERTIFICATE_PEM,
        verified_domains: ['acme.test'],
      },
      auth(ownerToken),
    );
    expect(created.statusCode, created.body).toBe(201);
    await fill(owner, 'workspace', enterprise.a.licenseId, 200);

    const challenge = await h.server.post(
      `/settings/sso/${(created.json() as { id: string }).id}/domains/acme.test/challenge`,
      {},
      auth(ownerToken),
    );

    expect(challenge.statusCode).toBe(429);
    expect(challenge.json().error).toMatchObject({
      type: 'limit_reached',
      details: { reason: 'mail_daily_cap', scope: 'workspace' },
    });
    const retryAfter = Number(challenge.headers['retry-after']);
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(86_400);
    expect(await outbox()).toEqual([]);
    expect(h.sink.events('sso_domain.challenge_mail')).toEqual([]);
  });
});

describe('the global cap and the security reserve, through the routes (tm 257.14)', () => {
  let owner: PrismaClient;
  let h: Harness;
  let fx: Fixtures;

  beforeAll(async () => {
    owner = ownerClient();
    // Workspace mail may take 2 of the day's 3; the last one is account mail's.
    h = await startHarness({ MAIL_DAILY_GLOBAL: '3', MAIL_SECURITY_RESERVE: '1' });
  });

  afterAll(async () => {
    await stopHarness(h);
    await owner.$disconnect();
  });

  beforeEach(async () => {
    fx = await seedFixtures(owner);
    await clearRateLimits(h.server.app);
    await rm(h.mailDir, { recursive: true, force: true });
  });

  const inviter = (t: TenantFixture) =>
    grantToken(owner, {
      licenseId: t.licenseId,
      organizationId: t.organizationId,
      ownerId: t.ownerAccountId,
      scopes: ['accounts--all:rw'],
    });

  const invite = async (token: string, email: string) => {
    const response = await h.server.post(
      '/invitations',
      { emails: [email], role: 'agent' },
      auth(token),
    );
    expect(response.statusCode).toBe(201);
    return (response.json() as { undelivered: Array<{ reason: string }> }).undelivered;
  };

  it('holds two workspaces to it together, and still sends a password reset from the reserve', async () => {
    const tokenA = await inviter(fx.a);
    const tokenB = await inviter(fx.b);

    expect(await invite(tokenA, 'one@example.test')).toEqual([]);
    expect(await invite(tokenB, 'two@example.test')).toEqual([]);
    // Neither workspace is near its own cap; together they have used theirs.
    expect(await invite(tokenA, 'three@example.test')).toEqual([
      expect.objectContaining({ reason: 'cap_reached' }),
    ]);

    const reset = await h.server.post('/auth/password-reset', { email: fx.a.agentEmail });
    expect(reset.statusCode).toBe(202);
    const refused = await h.server.post('/auth/password-reset', { email: fx.b.agentEmail });
    expect(refused.statusCode).toBe(202);
    expect(refused.body).toBe(reset.body);

    await h.server.app.backgroundMail.settled();
    expect((await h.spool.outbox()).map((m) => `${m.kind} → ${m.to}`).sort()).toEqual(
      [
        'invitation → one@example.test',
        'invitation → two@example.test',
        `password_reset → ${fx.a.agentEmail}`,
      ].sort(),
    );
    expect(h.sink.events('mail.cap_reached').map((r) => [r['kind'], r['scope']])).toEqual([
      ['invitation', 'global'],
      ['password_reset', 'global'],
    ]);
  });
});

describe("a pilot deployment's ticket notice (tm 257.14)", () => {
  let owner: PrismaClient;

  beforeAll(() => {
    owner = ownerClient();
  });

  afterAll(async () => {
    await owner.$disconnect();
  });

  for (const pilot of [true, false]) {
    it(`${pilot ? 'ends with' : 'does not carry'} the no-replies line when PILOT_MODE=${String(pilot)}`, async () => {
      const h = await startHarness({ PILOT_MODE: String(pilot) });
      try {
        const fx = await seedFixtures(owner);
        const token = await grantToken(owner, {
          licenseId: fx.a.licenseId,
          organizationId: fx.a.organizationId,
          ownerId: fx.a.ownerAccountId,
          scopes: ['tickets--all:rw', 'tickets--all:ro', 'customers:ro'],
        });
        await solveTicketWithNotice(owner, h.server, fx.a, token);
        await h.server.app.backgroundMail.settled();

        const [notice, ...rest] = await h.spool.outbox();
        expect(rest).toEqual([]);
        expect(notice!.kind).toBe('ticket_notice');
        if (pilot) {
          expect(notice!.body).toBe(`Hi Ada Lovelace.\n\n${PILOT_NO_REPLY_LINE}`);
        } else {
          expect(notice!.body).toBe('Hi Ada Lovelace.');
          expect(notice!.body).not.toContain(PILOT_NO_REPLY_LINE);
        }
      } finally {
        await stopHarness(h);
      }
    });
  }
});
