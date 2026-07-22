/**
 * Integration test fixtures.
 *
 * Every scenario builds **two** organizations. Cross-tenant isolation is the
 * property most easily broken without anyone noticing — a single-tenant fixture
 * makes a total isolation failure look like a passing test suite.
 */
import { PrismaClient } from '@prisma/client';
import { hashPassword, hashToken } from '../../src/lib/crypto.js';
import { parseEnv, type Env } from '../../src/config/env.js';

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
    ...overrides,
  });
}

/** Owner connection — bypasses RLS so fixtures can span tenants. */
export function ownerClient(): PrismaClient {
  return new PrismaClient({ datasourceUrl: process.env['DATABASE_URL'] });
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
  await db.$executeRawUnsafe(`TRUNCATE TABLE ${quoted} RESTART IDENTITY CASCADE`);
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
      displayName: `Nexa Agent App (${slug})`,
      clientType: 'public',
      redirectUris: [redirectUri, 'http://localhost:5173/callback'],
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

export async function seedFixtures(db: PrismaClient): Promise<Fixtures> {
  await resetDatabase(db);
  return {
    a: await seedTenant(db, 'a', 1),
    b: await seedTenant(db, 'b', 2),
  };
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
    kind?: 'pat' | 'oauth' | 'bot';
    expiresAt?: Date | null;
    revokedAt?: Date | null;
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
      expiresAt: input.expiresAt ?? null,
      revokedAt: input.revokedAt ?? null,
    },
  });
  return token;
}
