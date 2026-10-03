/**
 * Expired unverified sign-ups (tm 257.19 · ADR docs/adr/pilot-public-readiness.md
 * K-e(1) · PLAN §D203).
 *
 * `purge_unverified_signups` deletes whole workspaces, across tenants, as
 * SECURITY DEFINER — so most of this suite is about what it must leave alone.
 * Every "keeps" case differs from a purgeable sign-up by one condition and runs
 * beside a control that IS purged in the same call: a green "kept" then means
 * that condition held it back, not that the purge never ran.
 *
 * Sign-ups come through the real route (`POST /auth/signup` with
 * `SIGNUP_EMAIL_VERIFICATION=true`), so each carries what production's carry —
 * the link row and the audit entries — and the purge is called as the
 * scheduler calls it, over the application role's connection.
 *
 * The races hold a request's transaction open on a second connection, because
 * the question is what one transaction does while another holds rows: a
 * membership, a chat or a verification half-way through being written.
 */
import { createHash, randomBytes } from 'node:crypto';
import { PrismaClient, type Prisma } from '@prisma/client';
import { generateShortId } from '@siyahtus/types';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  PURGE_BATCH_SIZE,
  PURGE_MAX_BATCHES,
  UnverifiedSignupSweeper,
} from '../../src/services/auth/unverified-signup-sweep.js';
import { NullMailer } from '../../src/services/mail/mailer.js';
import { buildSchedulerJobs } from '../../src/services/scheduler/jobs.js';
import {
  ownerClient,
  seedFixtures,
  testEnv,
  type Fixtures,
  type TenantFixture,
} from '../helpers/fixtures.js';
import { recordingLogger } from '../helpers/scheduler.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';
import { ageSignup, signupOf, type SignupFixture } from '../helpers/unverified-signups.js';

const TTL_HOURS = 72;
const DAY_MS = 86_400_000;
const PASSWORD = 'a-quite-long-passphrase';

const KEPT = { account: 1, organization: 1, license: 1 };
const GONE = { account: 0, organization: 0, license: 0 };

/** RLS-exempt: lays fixtures down in any tenant and reads what is left. */
let owner: PrismaClient;
/** The application role — what the scheduler purges through. */
let app: PrismaClient;
/** A second owner connection: the request on the other side of every race. */
let writer: PrismaClient;
let server: TestServer;
let fx: Fixtures;
let seq = 0;

beforeAll(async () => {
  owner = ownerClient();
  writer = ownerClient();
  app = new PrismaClient({ datasourceUrl: testEnv().runtimeDatabaseUrl });
  server = await startTestServer({ SIGNUP_EMAIL_VERIFICATION: 'true' });
});

afterAll(async () => {
  await server.close();
  await Promise.all([owner.$disconnect(), writer.$disconnect(), app.$disconnect()]);
});

beforeEach(async () => {
  fx = await seedFixtures(owner);
  await clearRateLimits(server.app);
});

// --- Helpers ----------------------------------------------------------------

function randomHash(): string {
  return createHash('sha256').update(randomBytes(32)).digest('hex');
}

/** A sign-up through the route, settled: workspace, link and audit entries all written. */
async function signUp(email: string): Promise<SignupFixture> {
  const response = await server.post('/auth/signup', {
    email,
    password: PASSWORD,
    name: 'Founder',
    organization_name: `Workspace of ${email}`,
  });
  expect(response.statusCode).toBe(202);
  // The link's own audit entry is written once the mail has gone, after the answer.
  await server.app.backgroundMail.settled();
  return signupOf(owner, email);
}

/** An hour past the TTL, its sign-up link long lapsed: purgeable as it stands. */
async function expired(email: string): Promise<SignupFixture> {
  const signup = await signUp(email);
  await ageSignup(owner, signup, TTL_HOURS + 1);
  return signup;
}

/** One call, the way the scheduler makes it. */
async function purge(limit = 100): Promise<number> {
  const [row] = await app.$queryRaw<Array<{ purged: number }>>`
    SELECT purge_unverified_signups(make_interval(hours => ${TTL_HOURS}::int), ${limit}::int) AS purged`;
  return row!.purged;
}

/** Whether the account, its organization and its licence still exist — 1 or 0 each. */
async function presence(signup: SignupFixture): Promise<typeof KEPT> {
  const [account, organization, license] = await Promise.all([
    owner.account.count({ where: { id: signup.accountId } }),
    owner.organization.count({ where: { id: signup.organizationId } }),
    owner.license.count({ where: { id: signup.licenseId } }),
  ]);
  return { account, organization, license };
}

/**
 * Purges beside `subject` a control that differs from it only by the condition
 * under test, and checks the control went and the subject stayed.
 */
async function purgeBeside(subject: SignupFixture): Promise<void> {
  seq += 1;
  const control = await expired(`control-${String(seq)}@newco.test`);
  expect(await purge()).toBe(1);
  expect(await presence(control)).toEqual(GONE);
  expect(await presence(subject)).toEqual(KEPT);
}

/**
 * Every row that names a workspace or its people, table by table — read from
 * the catalogue like `resetDatabase` does, so a table added later is counted
 * without anybody remembering to add it here.
 */
async function footprint(target: {
  licenseId: bigint;
  organizationId: string;
  accountIds: string[];
}): Promise<Record<string, number>> {
  const columns = await owner.$queryRaw<Array<{ table: string; column: string }>>`
    SELECT c.table_name AS "table", c.column_name AS "column"
      FROM information_schema.columns c
      JOIN pg_namespace n ON n.nspname = c.table_schema
      JOIN pg_class k ON k.relname = c.table_name AND k.relnamespace = n.oid
     WHERE c.table_schema = 'public'
       AND k.relkind IN ('r', 'p')
       AND NOT k.relispartition
       AND c.column_name IN ('license_id', 'organization_id', 'account_id', 'agent_id')
     ORDER BY 1, 2`;

  const counts: Record<string, number> = {};
  for (const { table, column } of columns) {
    const values =
      column === 'license_id'
        ? [target.licenseId.toString()]
        : column === 'organization_id'
          ? [target.organizationId]
          : target.accountIds;
    const [row] = await owner.$queryRawUnsafe<Array<{ n: bigint }>>(
      `SELECT count(*) AS n FROM "${table}" WHERE "${column}"::text = ANY($1::text[])`,
      values,
    );
    counts[`${table}.${column}`] = Number(row!.n);
  }
  counts['accounts'] = await owner.account.count({ where: { id: { in: target.accountIds } } });
  counts['organizations'] = await owner.organization.count({
    where: { id: target.organizationId },
  });
  counts['licenses'] = await owner.license.count({ where: { id: target.licenseId } });
  return counts;
}

const tenantFootprint = (t: TenantFixture) =>
  footprint({
    licenseId: t.licenseId,
    organizationId: t.organizationId,
    accountIds: [t.ownerAccountId, t.agentAccountId],
  });

const signupFootprint = (s: SignupFixture) =>
  footprint({
    licenseId: s.licenseId,
    organizationId: s.organizationId,
    accountIds: [s.accountId],
  });

interface Held {
  /** Resolves once `work` is done and its locks are held; rejects if it threw. */
  ready: Promise<void>;
  release: () => void;
  /** Settles when the transaction has committed (or failed). */
  done: Promise<unknown>;
}

/** Runs `work` in a transaction on `client` and keeps it open — its locks held — until released. */
function holdOpen(
  client: PrismaClient,
  work: (tx: Prisma.TransactionClient) => Promise<unknown>,
): Held {
  let release!: () => void;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  let signalReady!: () => void;
  const readySignal = new Promise<void>((resolve) => {
    signalReady = resolve;
  });
  const done = client.$transaction(
    async (tx) => {
      await work(tx);
      signalReady();
      await released;
    },
    { maxWait: 10_000, timeout: 60_000 },
  );
  return { ready: Promise.race([readySignal, done.then(() => undefined)]), release, done };
}

/**
 * Runs `action` while `held` keeps its transaction open, then lets that
 * transaction commit — in a `finally`, so a failing step never leaves locks
 * behind for the next test's `TRUNCATE` to queue on. A failed commit still
 * fails the test.
 */
async function whileHeld<T>(held: Held, action: () => Promise<T>): Promise<T> {
  try {
    return await action();
  } finally {
    held.release();
    await held.done;
  }
}

/**
 * Whichever comes first: `pending` settling, or a backend of this database
 * waiting on a lock. A purge is meant to settle — it takes its locks `NOWAIT`
 * and never queues behind a request. One that queued instead would answer
 * `waiting`, and the test then lets the request commit to see what that purge
 * does next.
 */
async function settledOrWaiting(pending: Promise<unknown>): Promise<'settled' | 'waiting'> {
  let settled = false;
  void pending.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );
  const deadline = Date.now() + 15_000;
  while (!settled) {
    const [row] = await owner.$queryRaw<Array<{ waiting: bigint }>>`
      SELECT count(*) AS waiting FROM pg_stat_activity
       WHERE datname = current_database() AND wait_event_type = 'Lock'`;
    if (Number(row!.waiting) > 0) return 'waiting';
    if (Date.now() > deadline) throw new Error('neither settled nor waited on a lock');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return 'settled';
}

// ===========================================================================
// What goes
// ===========================================================================

describe('purge_unverified_signups — what goes', () => {
  it('deletes an expired, unverified sign-up nobody reached, every row of it — its audit trail included', async () => {
    const bot = await expired('bot@newco.test');
    // The two tables the licence's cascade cannot reach, deleted by hand.
    await owner.customer.create({ data: { organizationId: bot.organizationId, name: 'Visitor' } });
    await owner.trustedDomain.create({
      data: {
        organizationId: bot.organizationId,
        licenseId: bot.licenseId,
        domain: 'bot.example.test',
        includeSubdomains: true,
      },
    });

    // A whole workspace, as the route builds one — not a shell this test made up.
    const before = await signupFootprint(bot);
    expect(before).toMatchObject({
      accounts: 1,
      organizations: 1,
      licenses: 1,
      'agent_memberships.license_id': 1,
      'brands.license_id': 1,
      'oauth_clients.organization_id': 1,
      'customers.organization_id': 1,
      'trusted_domains.license_id': 1,
      'email_verification_tokens.account_id': 1,
      'audit_chain_heads.license_id': 1,
    });
    // `workspace.created` at sign-up, `auth.verification_sent` once the link went.
    expect(before['audit_log.license_id']).toBeGreaterThan(0);

    expect(await purge()).toBe(1);

    const left = Object.entries(await signupFootprint(bot)).filter(([, rows]) => rows > 0);
    expect(left).toEqual([]);
  });

  it('frees the address: signing up with it again builds a new workspace', async () => {
    const first = await expired('again@newco.test');
    expect(await purge()).toBe(1);

    const second = await signUp('again@newco.test');
    expect(second.accountId).not.toBe(first.accountId);
    expect(await presence(second)).toEqual(KEPT);
  });

  it('deletes at most p_limit accounts per call, oldest first', async () => {
    const oldest = await signUp('oldest@newco.test');
    await ageSignup(owner, oldest, TTL_HOURS + 30);
    const middle = await signUp('middle@newco.test');
    await ageSignup(owner, middle, TTL_HOURS + 20);
    const newest = await signUp('newest@newco.test');
    await ageSignup(owner, newest, TTL_HOURS + 10);

    expect(await purge(2)).toBe(2);
    expect(await presence(oldest)).toEqual(GONE);
    expect(await presence(middle)).toEqual(GONE);
    expect(await presence(newest)).toEqual(KEPT);

    expect(await purge(2)).toBe(1);
    expect(await presence(newest)).toEqual(GONE);
  });
});

// ===========================================================================
// What stays
// ===========================================================================

describe('purge_unverified_signups — what stays', () => {
  it('keeps an owner who verified', async () => {
    const verified = await expired('verified@newco.test');
    await owner.account.update({
      where: { id: verified.accountId },
      data: { emailVerifiedAt: new Date() },
    });
    await purgeBeside(verified);
  });

  it('keeps a sign-up still inside the TTL, even with its link lapsed', async () => {
    const young = await signUp('young@newco.test');
    // 71 hours: the 24-hour link lapsed long ago, so only the TTL holds it.
    await ageSignup(owner, young, TTL_HOURS - 1);
    await purgeBeside(young);
  });

  it('keeps a workspace a visitor has chatted in', async () => {
    const chatted = await expired('chatted@newco.test');
    const customer = await owner.customer.create({
      data: { organizationId: chatted.organizationId, name: 'Visitor' },
      select: { id: true },
    });
    await owner.chat.create({
      data: { id: generateShortId(), licenseId: chatted.licenseId, customerId: customer.id },
    });
    await purgeBeside(chatted);
    expect(await owner.customer.count({ where: { id: customer.id } })).toBe(1);
  });

  it('keeps a workspace with a ticket in it', async () => {
    const ticketed = await expired('ticketed@newco.test');
    await owner.ticket.create({
      data: { id: generateShortId(), licenseId: ticketed.licenseId, subject: 'Hello?' },
    });
    await purgeBeside(ticketed);
  });

  it('keeps a workspace with a second member', async () => {
    const shared = await expired('shared@newco.test');
    const teammate = await owner.account.create({
      data: { email: 'teammate@newco.test', name: 'Teammate', passwordHash: 'unused' },
      select: { id: true },
    });
    await owner.agentMembership.create({
      data: {
        licenseId: shared.licenseId,
        agentId: teammate.id,
        role: 'agent',
        routingStatus: 'accepting_chats',
      },
    });
    await purgeBeside(shared);
  });

  it('keeps a workspace with an open invitation out of it', async () => {
    const inviting = await expired('inviting@newco.test');
    await owner.invitation.create({
      data: {
        licenseId: inviting.licenseId,
        organizationId: inviting.organizationId,
        email: 'invitee@newco.test',
        role: 'agent',
        tokenHash: randomHash(),
        invitedById: inviting.accountId,
        expiresAt: new Date(Date.now() + 7 * DAY_MS),
      },
    });
    await purgeBeside(inviting);
  });

  it('keeps an account that belongs to a second workspace', async () => {
    const member = await expired('member@newco.test');
    await owner.agentMembership.create({
      data: {
        licenseId: fx.a.licenseId,
        agentId: member.accountId,
        role: 'agent',
        routingStatus: 'accepting_chats',
      },
    });
    await purgeBeside(member);
    expect(await owner.agentMembership.count({ where: { agentId: member.accountId } })).toBe(2);
  });

  it('keeps an address another workspace has invited, and lets it go once that invitation lapses', async () => {
    const invited = await expired('invited@newco.test');
    const invitation = await owner.invitation.create({
      data: {
        licenseId: fx.a.licenseId,
        organizationId: fx.a.organizationId,
        email: invited.email,
        role: 'agent',
        tokenHash: randomHash(),
        invitedById: fx.a.ownerAccountId,
        expiresAt: new Date(Date.now() + 7 * DAY_MS),
      },
      select: { id: true },
    });
    await purgeBeside(invited);

    await owner.invitation.update({
      where: { id: invitation.id },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });
    expect(await purge()).toBe(1);
    expect(await presence(invited)).toEqual(GONE);
    // The inviting workspace keeps its (lapsed) invitation and everything else.
    expect(await owner.invitation.count({ where: { id: invitation.id } })).toBe(1);
  });

  it('keeps a sandbox', async () => {
    // A sandbox licence the account owns alone and was created with: every
    // other condition holds, so only the sandbox exclusion keeps it.
    const sandbox = await expired('sandbox@newco.test');
    await owner.license.update({
      where: { id: sandbox.licenseId },
      data: { sandboxOfLicenseId: fx.a.licenseId },
    });
    await purgeBeside(sandbox);
  });

  it('keeps a workspace that has a sandbox of its own', async () => {
    const parent = await expired('parent@newco.test');
    const sandboxOrg = await owner.organization.create({
      data: { name: 'Parent (Sandbox)', region: 'eu' },
      select: { id: true },
    });
    const child = await owner.license.create({
      data: {
        organizationId: sandboxOrg.id,
        status: 'active',
        sandboxOfLicenseId: parent.licenseId,
      },
      select: { id: true },
    });
    await purgeBeside(parent);
    expect(await owner.license.count({ where: { id: child.id } })).toBe(1);
  });

  it('keeps an organization that holds a second licence', async () => {
    const crowded = await expired('crowded@newco.test');
    const second = await owner.license.create({
      data: { organizationId: crowded.organizationId },
      select: { id: true },
    });
    await purgeBeside(crowded);
    expect(await owner.license.count({ where: { id: second.id } })).toBe(1);
  });

  it('keeps a workspace the account did not sign up with', async () => {
    // Owned, alone, empty — but its licence was not created in the account's
    // own sign-up transaction, the one instant `auth_signup` stamps on both.
    const adopted = await expired('adopted@newco.test');
    await owner.$executeRaw`
      UPDATE licenses SET created_at = created_at - interval '1 second'
       WHERE id = ${adopted.licenseId}`;
    await purgeBeside(adopted);
  });

  it('keeps an account that does not own the workspace it belongs to', async () => {
    const demoted = await expired('demoted@newco.test');
    await owner.agentMembership.updateMany({
      where: { licenseId: demoted.licenseId, agentId: demoted.accountId },
      data: { role: 'admin' },
    });
    await purgeBeside(demoted);
  });

  it('keeps an account whose newest link still works, and lets it go once that link lapses', async () => {
    const asked = await expired('asked@newco.test');
    // What "send it again" does, a minute before the TTL ran out.
    await app.$queryRaw`
      SELECT auth_request_email_verification(${asked.email}::citext, ${randomHash()},
                                             now() + interval '23 hours')`;
    await purgeBeside(asked);

    await owner.emailVerificationToken.updateMany({
      where: { accountId: asked.accountId },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });
    expect(await purge()).toBe(1);
    expect(await presence(asked)).toEqual(GONE);
  });

  it('keeps an account with a password reset link that still works', async () => {
    // Completing a reset verifies the address (tm 257.7), so it is a link too.
    const resetting = await expired('resetting@newco.test');
    await app.$queryRaw`
      SELECT auth_request_password_reset(${resetting.email}::citext, ${randomHash()},
                                         now() + interval '1 hour')`;
    await purgeBeside(resetting);
  });
});

// ===========================================================================
// Isolation
// ===========================================================================

describe('a purge leaves every other tenant exactly as it was (NFR-S4)', () => {
  it('changes no row of either seeded tenant, nor of a sign-up it keeps', async () => {
    const bot = await expired('bot@newco.test');
    const fresh = await signUp('fresh@newco.test');
    const before = {
      a: await tenantFootprint(fx.a),
      b: await tenantFootprint(fx.b),
      fresh: await signupFootprint(fresh),
    };

    expect(await purge()).toBe(1);

    expect(await presence(bot)).toEqual(GONE);
    expect({
      a: await tenantFootprint(fx.a),
      b: await tenantFootprint(fx.b),
      fresh: await signupFootprint(fresh),
    }).toEqual(before);
  });
});

// ===========================================================================
// Concurrent requests
// ===========================================================================

describe('purge_unverified_signups — under concurrent requests', () => {
  it('neither waits for nor deletes under a membership being written elsewhere; once it commits, the account stays', async () => {
    const joining = await expired('joining@newco.test');
    const held = holdOpen(writer, (tx) =>
      tx.agentMembership.create({
        data: {
          licenseId: fx.a.licenseId,
          agentId: joining.accountId,
          role: 'agent',
          routingStatus: 'accepting_chats',
        },
      }),
    );
    await held.ready;

    const purging = purge();
    const how = await whileHeld(held, () => settledOrWaiting(purging));

    expect(how).toBe('settled');
    expect(await purging).toBe(0);
    expect(await presence(joining)).toEqual(KEPT);
    expect(await owner.agentMembership.count({ where: { agentId: joining.accountId } })).toBe(2);
    // Committed now, so the predicate itself keeps it from here on.
    expect(await purge()).toBe(0);
  });

  it("neither waits for nor deletes under a visitor's first chat being written; once it commits, the workspace stays", async () => {
    const visited = await expired('visited@newco.test');
    const customer = await owner.customer.create({
      data: { organizationId: visited.organizationId, name: 'First visitor' },
      select: { id: true },
    });
    const chatId = generateShortId();
    const held = holdOpen(writer, (tx) =>
      tx.chat.create({
        data: { id: chatId, licenseId: visited.licenseId, customerId: customer.id },
      }),
    );
    await held.ready;

    const purging = purge();
    const how = await whileHeld(held, () => settledOrWaiting(purging));

    expect(how).toBe('settled');
    expect(await purging).toBe(0);
    expect(await presence(visited)).toEqual(KEPT);
    expect(await owner.chat.count({ where: { id: chatId } })).toBe(1);
    expect(await purge()).toBe(0);
  });

  it('lets a verification already under way finish, even when its link lapses before the purge looks — verified, never half-deleted', async () => {
    const late = await expired('late@newco.test');
    const { passwordHash } = await owner.account.findUniqueOrThrow({
      where: { id: late.accountId },
      select: { passwordHash: true },
    });
    // Asked again just before the TTL, with a link about to lapse.
    const tokenHash = randomHash();
    await app.$queryRaw`
      SELECT auth_request_email_verification(${late.email}::citext, ${tokenHash},
                                             clock_timestamp() + interval '2 seconds')`;

    // The owner opens it just in time. Inside a transaction a link's expiry is
    // judged against the transaction's start, so a verification begun before
    // the link lapsed spends it after — the window this test wants: the
    // address marked verified, uncommitted, with the link already lapsed. To
    // the purge, which cannot see the uncommitted verification, the account is
    // a candidate again.
    const held = holdOpen(writer, async (tx) => {
      await tx.$queryRaw`SELECT now()`;
      for (;;) {
        const [row] = await tx.$queryRaw<Array<{ lapsed: boolean }>>`
          SELECT expires_at < clock_timestamp() AS lapsed FROM email_verification_tokens
           WHERE token_hash = ${tokenHash}`;
        if (row!.lapsed) break;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      const rows = await tx.$queryRaw<Array<{ verified_account: string }>>`
        SELECT * FROM auth_consume_email_verification(${tokenHash}, ${passwordHash}, 14)`;
      expect(rows.map((row) => row.verified_account)).toEqual([late.accountId]);
    });
    await held.ready;

    const purging = purge();
    const how = await whileHeld(held, () => settledOrWaiting(purging));

    expect(how).toBe('settled');
    expect(await purging).toBe(0);
    const account = await owner.account.findUniqueOrThrow({ where: { id: late.accountId } });
    expect(account.emailVerifiedAt).not.toBeNull();
    expect(await presence(late)).toEqual(KEPT);
    expect(await purge()).toBe(0);
  });

  it('asks again under lock: an account verified while the purge is busy with an older one is kept', async () => {
    const older = await expired('older@newco.test');
    await ageSignup(owner, older, 10);
    const younger = await expired('younger@newco.test');
    const customer = await owner.customer.create({
      data: { organizationId: older.organizationId, name: 'Lingering visitor' },
      select: { id: true },
    });

    // A request holding a row deep in the older workspace — one the purge
    // deletes without locking it first — so the purge, already past its scan
    // with both sign-ups as candidates, waits there.
    const held = holdOpen(
      writer,
      (tx) => tx.$queryRaw`SELECT id FROM customers WHERE id = ${customer.id}::uuid FOR UPDATE`,
    );
    await held.ready;

    const purging = purge();
    const how = await whileHeld(held, async () => {
      const outcome = await settledOrWaiting(purging);
      // Meanwhile the younger sign-up's owner verifies, and that commits.
      await owner.account.update({
        where: { id: younger.accountId },
        data: { emailVerifiedAt: new Date() },
      });
      return outcome;
    });

    expect(how).toBe('waiting');
    expect(await purging).toBe(1);
    expect(await presence(older)).toEqual(GONE);
    expect(await presence(younger)).toEqual(KEPT);
  });

  it('lets a purge under way finish: a verification arriving meanwhile verifies nothing, and nothing of the account is left — deleted, never half-verified', async () => {
    const gone = await expired('gone@newco.test');
    const { tokenHash } = await owner.emailVerificationToken.findFirstOrThrow({
      where: { accountId: gone.accountId },
      select: { tokenHash: true },
    });
    const { passwordHash } = await owner.account.findUniqueOrThrow({
      where: { id: gone.accountId },
      select: { passwordHash: true },
    });

    const held = holdOpen(app, async (tx) => {
      const [row] = await tx.$queryRaw<Array<{ purged: number }>>`
        SELECT purge_unverified_signups(make_interval(hours => ${TTL_HOURS}::int), 100) AS purged`;
      expect(row!.purged).toBe(1);
    });
    await held.ready;

    const verifying = writer.$queryRaw<Array<{ verified_account: string }>>`
      SELECT * FROM auth_consume_email_verification(${tokenHash}, ${passwordHash}, 14)`;
    const how = await whileHeld(held, () => settledOrWaiting(verifying));

    expect(how).toBe('settled');
    expect(await verifying).toEqual([]);
    const left = Object.entries(await signupFootprint(gone)).filter(([, rows]) => rows > 0);
    expect(left).toEqual([]);
  });
});

// ===========================================================================
// The function itself
// ===========================================================================

describe('purge_unverified_signups — the function', () => {
  it('runs as its owner for the application role alone; the predicate is nobody else’s to call', async () => {
    const rows = await owner.$queryRaw<
      Array<{
        name: string;
        definer: boolean;
        config: string[] | null;
        publicCan: boolean;
        appCan: boolean;
      }>
    >`
      SELECT p.proname AS name,
             p.prosecdef AS definer,
             p.proconfig AS config,
             has_function_privilege('public', p.oid, 'EXECUTE') AS "publicCan",
             has_function_privilege('siyahtus_app', p.oid, 'EXECUTE') AS "appCan"
        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public'
         AND p.proname IN ('purge_unverified_signups', 'unverified_signup_purgeable')
       ORDER BY p.proname`;

    expect(rows.map((row) => ({ ...row, config: [...(row.config ?? [])].sort() }))).toEqual([
      {
        name: 'purge_unverified_signups',
        definer: true,
        config: ['lock_timeout=5s', 'search_path=public, pg_temp'],
        publicCan: false,
        appCan: true,
      },
      {
        name: 'unverified_signup_purgeable',
        definer: false,
        config: ['search_path=public, pg_temp'],
        publicCan: false,
        appCan: false,
      },
    ]);

    await expect(
      app.$queryRaw`SELECT * FROM unverified_signup_purgeable(${fx.a.ownerAccountId}::uuid, now())`,
    ).rejects.toThrow(/permission denied/);
  });

  it('refuses a TTL that is not positive and a limit below one, and deletes nothing', async () => {
    const bot = await expired('bot@newco.test');
    await expect(
      app.$queryRaw`SELECT purge_unverified_signups(interval '0 hours', 10)`,
    ).rejects.toThrow(/p_ttl must be positive/);
    await expect(
      app.$queryRaw`SELECT purge_unverified_signups(interval '-1 hours', 10)`,
    ).rejects.toThrow(/p_ttl must be positive/);
    await expect(
      app.$queryRaw`SELECT purge_unverified_signups(interval '72 hours', 0)`,
    ).rejects.toThrow(/p_limit must be at least 1/);
    expect(await presence(bot)).toEqual(KEPT);
  });
});

// ===========================================================================
// The scheduler job
// ===========================================================================

describe('the unverified_signups job', () => {
  const jobFor = (overrides: Partial<NodeJS.ProcessEnv> = {}) =>
    buildSchedulerJobs({
      db: app,
      env: testEnv({ SIGNUP_EMAIL_VERIFICATION: 'true', ...overrides }),
      mailer: new NullMailer(),
    }).find((job) => job.name === 'unverified_signups')!;

  it('purges what the function finds and logs the count alone — no address, name or id', async () => {
    const bots = [
      await expired('one@newco.test'),
      await expired('two@newco.test'),
      await expired('three@newco.test'),
    ];
    const fresh = await signUp('fresh@newco.test');
    const job = jobFor();
    expect(job.enabled).toBe(true);

    const log = recordingLogger();
    const outcome = await job.run({ signal: new AbortController().signal, logger: log.logger });

    expect(outcome?.counts).toEqual({ purged: 3, batches: 1 });
    for (const bot of bots) expect(await presence(bot)).toEqual(GONE);
    expect(await presence(fresh)).toEqual(KEPT);
    expect(log.lines).toEqual([
      {
        level: 'info',
        payload: { event: 'signup.unverified_purged', count: 3 },
        message: 'expired unverified sign-ups purged',
      },
    ]);
    const written = JSON.stringify(log.lines);
    for (const bot of bots) {
      expect(written).not.toContain(bot.email);
      expect(written).not.toContain(bot.accountId);
      expect(written).not.toContain(bot.organizationId);
    }
    expect(written).not.toContain('Founder');

    // Nothing left to purge: the pass still reports, and no event is logged.
    const quiet = recordingLogger();
    const again = await job.run({ signal: new AbortController().signal, logger: quiet.logger });
    expect(again?.counts).toEqual({ purged: 0, batches: 1 });
    expect(quiet.lines).toEqual([]);
  });

  it('measures the TTL in UNVERIFIED_SIGNUP_TTL_HOURS', async () => {
    const day = await signUp('day@newco.test');
    await ageSignup(owner, day, 30);
    const context = { signal: new AbortController().signal, logger: recordingLogger().logger };

    expect((await jobFor().run(context))?.counts).toEqual({ purged: 0, batches: 1 });
    expect(await presence(day)).toEqual(KEPT);
    expect((await jobFor({ UNVERIFIED_SIGNUP_TTL_HOURS: '24' }).run(context))?.counts).toEqual({
      purged: 1,
      batches: 1,
    });
    expect(await presence(day)).toEqual(GONE);
  });

  it('works off a backlog a batch at a time, stopping at its cap or at the first short batch', async () => {
    const backlog: SignupFixture[] = [];
    for (let n = 0; n < 5; n += 1) backlog.push(await expired(`backlog-${String(n)}@newco.test`));

    const capped = new UnverifiedSignupSweeper(app, {
      ttlHours: TTL_HOURS,
      batchSize: 2,
      maxBatches: 2,
    });
    expect(await capped.run()).toEqual({ totals: { purged: 4, batches: 2 } });

    const rest = new UnverifiedSignupSweeper(app, { ttlHours: TTL_HOURS, batchSize: 2 });
    expect(await rest.run()).toEqual({ totals: { purged: 1, batches: 1 } });
    for (const signup of backlog) expect(await presence(signup)).toEqual(GONE);
  });

  it('keeps a batch within the 64 subtransaction ids Postgres caches per transaction, and a pass at a thousand', () => {
    // Each purged account is a subtransaction holding its id until the call
    // commits; past 64, every other session's snapshot is suboverflowed.
    expect(PURGE_BATCH_SIZE).toBeLessThanOrEqual(64);
    expect(PURGE_BATCH_SIZE * PURGE_MAX_BATCHES).toBe(1000);
  });

  it('starts no batch once the scheduler is stopping', async () => {
    const bot = await expired('bot@newco.test');
    const stopping = new AbortController();
    stopping.abort();

    const sweeper = new UnverifiedSignupSweeper(app, { ttlHours: TTL_HOURS });
    expect(await sweeper.run({ signal: stopping.signal })).toEqual({
      totals: { purged: 0, batches: 0 },
    });
    expect(await presence(bot)).toEqual(KEPT);
  });
});
