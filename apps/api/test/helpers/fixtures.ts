/**
 * Integration test fixtures.
 *
 * Every scenario builds **two** organizations. Cross-tenant isolation is the
 * property most easily broken without anyone noticing — a single-tenant fixture
 * makes a total isolation failure look like a passing test suite.
 */
import { PrismaClient } from '@prisma/client';
import { MOBILE_REDIRECT_URI } from '@siyahtus/types';
import { hashPassword, hashToken } from '../../src/lib/crypto.js';
import { parseEnv, type Env } from '../../src/config/env.js';
import type { AuditActorType, AuditContext } from '../../src/services/audit/audit-log.js';
import type { TokenKind } from '../../src/services/auth/token-service.js';
import { platformUrlFor } from '../../scripts/test-datastores.js';

// The mock IdP harness (S11-c) is a fixture like any other; re-exported here so
// SSO test suites can reach it alongside the rest of `helpers/fixtures.js`.
export * from './mock-idp.js';

export interface TenantFixture {
  organizationId: string;
  licenseId: bigint;
  ownerAccountId: string;
  ownerEmail: string;
  agentAccountId: string;
  agentEmail: string;
  password: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  trustedDomain: string;
  customerId: string;
}

export interface Fixtures {
  a: TenantFixture;
  b: TenantFixture;
}

export const TEST_PASSWORD = 'correct-horse-battery-staple';

export function testEnv(overrides: Partial<NodeJS.ProcessEnv> = {}): Env {
  return parseEnv({
    ...process.env,
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    // The test environment names its own providers (M-PROV-a). `server.ts` used
    // to branch on `NODE_ENV` for these two; now that the env key decides, the
    // fixture has to say what the suites have always relied on — discard, so a
    // run that sends hundreds of invitations or starts hundreds of chats leaves
    // nothing on disk. Placed above `overrides` on purpose: a test that wants a
    // real spool asks for `file` (or, as the delivery tests do, passes its own
    // provider pointed at a temporary directory), and a developer's `.env`
    // cannot quietly turn spooling back on for every suite.
    MAIL_PROVIDER: 'null',
    PUSH_PROVIDER: 'null',
    // Suites sign up from one address in a loop (account-lifecycle 12 times,
    // region 11), which the hourly per-network limit (tm 257.14) would stop
    // at 10. Raised like the anonymous bucket is in CI; the limit itself is
    // proven with a low value in `signup-rate-limit.test.ts`. The daily mail
    // caps stay at their defaults: `resetDatabase` empties their counter with
    // every other table, so a suite starts each test on a fresh day's count.
    RATE_LIMIT_SIGNUP_PER_HOUR: '10000',
    // The AI answers at once (tm 292.4): a suite that sends a message and
    // waits for its answer would otherwise wait out the visitor's typing window
    // on every one. Messages already waiting are still answered together; the
    // window itself is proven with its own value in `ai-batch-lock.test.ts`.
    AI_BATCH_WINDOW_MS: '0',
    // Suites mint hundreds of visitors and send bursts of messages from one
    // address (tm 339.2): at the defaults the widget's human check would ask
    // them for one. Each signal is proven with low values in
    // `captcha-challenge.test.ts`; the provider stays the offline mock.
    CAPTCHA_PROVIDER: 'mock',
    CAPTCHA_RISK_NEW_CUSTOMERS_PER_IP: '1000000',
    CAPTCHA_RISK_MESSAGES_PER_MIN: '1000000',
    CAPTCHA_RISK_AI_TURNS_TODAY: '1000000',
    ...overrides,
  });
}

/**
 * An audit context for a service called directly, without a request.
 *
 * `ChatService.deactivate`/`resume`/`deactivateByTimeout` take one because a
 * lifecycle transition has to be recorded (FR-MOD-02.8); a route gets it from
 * `request.auditContext()`, and a test driving the service in-process has no
 * request to get it from. The chain secret is the same one `testEnv()` gives
 * the server under test, so an entry written this way lands in the same chain
 * as one written through HTTP.
 *
 * Defaults to the system actor — the shape the timeout sweep writes with — so a
 * suite that only needs the call to compile does not have to invent a person.
 */
export function auditContextFor(
  tenant: { licenseId: bigint },
  actor: { actorId: string | null; actorType: AuditActorType } = {
    actorId: null,
    actorType: 'system',
  },
): AuditContext {
  return {
    licenseId: tenant.licenseId,
    chainSecret: testEnv().AUDIT_CHAIN_SECRET,
    actorId: actor.actorId,
    actorType: actor.actorType,
  };
}

/** Owner connection — bypasses RLS so fixtures can span tenants. */
export function ownerClient(): PrismaClient {
  return new PrismaClient({ datasourceUrl: process.env['DATABASE_URL'] });
}

/**
 * Platform connection — the `siyahtus_platform` role (tm 389.1): BYPASSRLS, so
 * it reads every tenant without `set_config`, but it is not the owner, so its
 * grants (and their REVOKEs) apply. `with-test-datastores.ts` always sets the
 * URL; a run with isolation off falls back to the same derivation.
 */
export function platformClient(): PrismaClient {
  const configured = process.env['DATABASE_PLATFORM_URL'];
  const owner = process.env['DATABASE_URL'];
  if (!configured && !owner) throw new Error('DATABASE_PLATFORM_URL or DATABASE_URL must be set');
  return new PrismaClient({ datasourceUrl: platformUrlFor(owner ?? '', configured) });
}

/**
 * Wipe every tenant table.
 *
 * Discovered from the catalogue rather than hard-coded: a list would silently
 * go stale the moment a slice adds a table, leaving residue that makes tests
 * pass or fail depending on what ran before them. Partitions and Prisma's own
 * bookkeeping are excluded.
 */
export async function resetDatabase(db: PrismaClient): Promise<void> {
  const tables = await db.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename <> '_prisma_migrations'
      -- Partitions are truncated through their parent.
      AND tablename NOT LIKE 'events\\_%'
  `;
  if (tables.length === 0) return;

  const quoted = tables.map((t) => `"${t.tablename}"`).join(', ');
  // Retried when Postgres picks the TRUNCATE as a deadlock victim (40P01). A
  // server booting in the suite starts its AI job worker with a claim pass
  // (`AiJobWorker.start`), and that pass takes up whatever jobs an earlier
  // file left `pending` — `ai-jobs-outbox.test.ts` writes them without a
  // worker. Nothing awaits the pass, so it can still be reading `events`
  // while the first `beforeEach` truncates: two lock orders, one deadlock. The
  // victim's statement is rolled back whole, so running it again is safe.
  for (let attempt = 1; ; attempt += 1) {
    try {
      await db.$executeRawUnsafe(`TRUNCATE TABLE ${quoted} RESTART IDENTITY CASCADE`);
      break;
    } catch (error) {
      if (attempt >= 3 || !String((error as Error).message).includes('40P01')) throw error;
    }
  }
  await applyLicenseIdOffset(db);
}

/**
 * Pushes `licenses_id_seq` past this run's reserved range.
 *
 * Redis pub/sub channels are *not* scoped by logical database, and
 * `licenseChannel()` names them after an autoincrement id — so two concurrent
 * runs would both publish and subscribe on `siyahtus:rtm:license:1` and read each
 * other's envelopes, however well the rows underneath are separated. Offsetting
 * the sequence makes the channel names disjoint too.
 *
 * `RESTART IDENTITY` above resets the sequence to 1, so this has to run *after*
 * every truncation, not once at provisioning time. Unset (a developer running
 * against the shared database) means offset 0 and today's behaviour.
 */
async function applyLicenseIdOffset(db: PrismaClient): Promise<void> {
  const raw = process.env['SIYAHTUS_TEST_LICENSE_ID_OFFSET'];
  if (!raw) return;

  const offset = Number(raw);
  if (!Number.isSafeInteger(offset) || offset <= 0) {
    throw new Error(`SIYAHTUS_TEST_LICENSE_ID_OFFSET must be a positive integer, got "${raw}"`);
  }
  await db.$executeRawUnsafe(`ALTER SEQUENCE IF EXISTS licenses_id_seq RESTART WITH ${offset + 1}`);
}

let passwordHashCache: string | null = null;

/**
 * scrypt is deliberately slow (~100 ms). Hashing the same test password once
 * and reusing the result keeps the suite fast without weakening the parameters
 * the production code actually uses.
 */
async function testPasswordHash(): Promise<string> {
  passwordHashCache ??= await hashPassword(TEST_PASSWORD);
  return passwordHashCache;
}

async function seedTenant(db: PrismaClient, slug: string, index: number): Promise<TenantFixture> {
  const passwordHash = await testPasswordHash();

  const organization = await db.organization.create({
    data: { name: `Org ${slug.toUpperCase()}`, region: 'eu' },
    select: { id: true },
  });

  const license = await db.license.create({
    data: {
      organizationId: organization.id,
      plan: 'growth',
      status: 'trialing',
      trialEndsAt: new Date(Date.now() + 14 * 86_400_000),
    },
    select: { id: true },
  });

  const owner = await db.account.create({
    data: { email: `owner-${slug}@example.test`, name: `Owner ${slug}`, passwordHash },
    select: { id: true, email: true },
  });
  const agent = await db.account.create({
    data: { email: `agent-${slug}@example.test`, name: `Agent ${slug}`, passwordHash },
    select: { id: true, email: true },
  });

  await db.agentMembership.createMany({
    data: [
      { licenseId: license.id, agentId: owner.id, role: 'owner', routingStatus: 'accepting_chats' },
      { licenseId: license.id, agentId: agent.id, role: 'agent', routingStatus: 'accepting_chats' },
    ],
  });

  const clientId = `client_${slug}_${index}`;
  const clientSecret = `secret_${slug}_${index}`;
  const redirectUri = `https://app-${slug}.example.test/callback`;

  await db.oauthClient.create({
    data: {
      id: clientId,
      organizationId: organization.id,
      displayName: `SiyahTuş Agent App (${slug})`,
      clientType: 'public',
      // The three shapes a first-party client really carries: the hosted
      // console, a developer's Vite server, and the phone's private-use scheme
      // (13.7-b). `auth_signup` registers the last one for every new workspace,
      // so a fixture without it would test a client no deployment has.
      redirectUris: [redirectUri, 'http://localhost:5173/callback', MOBILE_REDIRECT_URI],
      scopes: [],
    },
  });

  const trustedDomain = `shop-${slug}.example.test`;
  await db.trustedDomain.create({
    data: {
      organizationId: organization.id,
      licenseId: license.id,
      domain: trustedDomain,
      includeSubdomains: true,
    },
  });

  const customer = await db.customer.create({
    data: { organizationId: organization.id, name: `Customer ${slug}` },
    select: { id: true },
  });

  return {
    organizationId: organization.id,
    licenseId: license.id,
    ownerAccountId: owner.id,
    ownerEmail: owner.email,
    agentAccountId: agent.id,
    agentEmail: agent.email,
    password: TEST_PASSWORD,
    clientId,
    clientSecret,
    redirectUri,
    trustedDomain,
    customerId: customer.id,
  };
}

export interface SeedOptions {
  /**
   * Put both tenants on a plan (FR-MOD-11.5), by writing the subscription row
   * entitlements are derived from.
   *
   * Omitted means **no subscription row at all** — a trial, which is what a
   * fresh signup looks like and what every suite written before the entitlement
   * gate has been running against. `lib/entitlements.ts` reads that as `growth`,
   * so the default fixture unlocks nothing beyond self-serve.
   *
   * That default is deliberate and worth keeping. A suite exercising an
   * Enterprise capability has to say `{ plan: 'enterprise' }` out loud, which
   * makes the commercial requirement visible in the file that depends on it;
   * flipping the default the other way would have made every gate in the
   * product untested by construction, and a newly gated endpoint would go green
   * everywhere instead of failing in the one suite that should notice.
   */
  plan?: string;
}

export async function seedFixtures(db: PrismaClient, options: SeedOptions = {}): Promise<Fixtures> {
  await resetDatabase(db);
  const fixtures = {
    a: await seedTenant(db, 'a', 1),
    b: await seedTenant(db, 'b', 2),
  };
  if (options.plan !== undefined) {
    // Both tenants, so the cross-tenant half of a suite is testing isolation
    // rather than accidentally testing the gate.
    await seedSubscription(db, fixtures.a.licenseId, options.plan);
    await seedSubscription(db, fixtures.b.licenseId, options.plan);
  }
  return fixtures;
}

/**
 * Give a license the subscription row `lib/entitlements.ts` derives its plan
 * from — for suites that build their own tenants instead of using
 * {@link seedFixtures}, and for the negative half of an entitlement test.
 *
 * The amounts are the catalogue's self-serve figures whatever the plan, exactly
 * as a real Enterprise row looks after `updateSubscription` moves a workspace
 * up: a quoted tier states no price, so the numbers already on the row stay put
 * (`services/billing/subscription-service.ts`).
 */
export async function seedSubscription(
  db: PrismaClient,
  licenseId: bigint,
  plan: string,
): Promise<void> {
  await db.subscription.create({ data: { licenseId, plan, status: 'active', seats: 2 } });
}

/**
 * Give a license its default brand and return the id.
 *
 * Fixtures are deliberately brandless (78.1's isolation suites assert the exact
 * brand set of a fresh license), so a suite that exercises a brand-scoped table
 * — websites or the widget/security/inbox settings — seeds the default brand on
 * demand, the row backfill/seed/signup lay down in production. Only one default
 * is allowed per license (a partial unique index), so call it once per license.
 */
export async function seedDefaultBrand(db: PrismaClient, licenseId: bigint): Promise<string> {
  const brand = await db.brand.create({
    data: { licenseId, name: 'Default', slug: 'default', isDefault: true },
    select: { id: true },
  });
  return brand.id;
}

/**
 * Insert a token directly, bypassing the API, so tests can construct exactly
 * the credential they want to probe with (wrong tenant, missing scope, expired).
 */
export async function grantToken(
  db: PrismaClient,
  input: {
    licenseId: bigint;
    organizationId: string;
    ownerId: string;
    scopes: string[];
    kind?: TokenKind;
    expiresAt?: Date | null;
    revokedAt?: Date | null;
    /** Position the token in time — session-policy tests need a stale credential. */
    lastUsedAt?: Date | null;
    createdAt?: Date;
    /**
     * The OAuth client a session was issued to. Omitted, an `oauth` token has
     * none and resolves like a partner app's grant: its own list, capped by the
     * permission matrix. The workspace's sign-in client (`TenantFixture
     * .clientId`, no scope list of its own) makes it a panel session, which
     * follows the matrix both ways (tm 325.3).
     */
    clientId?: string;
  },
): Promise<string> {
  const token = `test_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`;
  await db.apiToken.create({
    data: {
      licenseId: input.licenseId,
      organizationId: input.organizationId,
      ownerId: input.ownerId,
      kind: input.kind ?? 'pat',
      tokenHash: hashToken(token),
      scopes: input.scopes,
      name: 'test token',
      ...(input.clientId !== undefined ? { clientId: input.clientId } : {}),
      expiresAt: input.expiresAt ?? null,
      revokedAt: input.revokedAt ?? null,
      ...(input.lastUsedAt !== undefined ? { lastUsedAt: input.lastUsedAt } : {}),
      ...(input.createdAt !== undefined ? { createdAt: input.createdAt } : {}),
    },
  });
  return token;
}

/**
 * Mark every domain a connection claims as proved (§D134).
 *
 * Claiming a domain no longer confines provisioning to it; *proving* it does,
 * and the proof is a token mailed to a reserved mailbox at the domain. That
 * flow has its own suite (`sso-domain-ownership.test.ts`), which drives it end
 * to end through the spool. Everywhere else the flow is setup rather than
 * subject, so this writes the state it ends in.
 *
 * The rows themselves are not created here — a trigger on `sso_connections`
 * opens one per claimed domain and destroys it when the claim goes, so a
 * fixture that invented rows could produce a shape the product never reaches.
 * All this does is answer the challenge.
 */
export async function proveSsoDomains(db: PrismaClient, connectionId: string): Promise<void> {
  await db.ssoDomainVerification.updateMany({
    where: { connectionId },
    data: { verifiedAt: new Date(), tokenHash: null },
  });
}
