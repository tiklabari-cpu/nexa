/**
 * Demo seed.
 *
 * Creates **two** organizations, always. Cross-tenant isolation is the property
 * most easily broken without anyone noticing, and a single-tenant dataset makes
 * a total isolation failure look like everything working. Having a second
 * tenant present in every developer's database means an accidental leak shows
 * up as visibly wrong data rather than as nothing at all.
 *
 * Idempotent: safe to re-run against an already-seeded database.
 *
 * Slice 3 extends this with chats, threads, events, tags and routing rules.
 */
import { PrismaClient } from '@prisma/client';
import { hashPassword, hashToken } from '../src/lib/crypto.js';

const prisma = new PrismaClient();

const DEMO_PASSWORD = 'nexa-demo-password';
const AGENT_CLIENT_ID = 'nexa-agent-app';

interface TenantSpec {
  slug: string;
  organizationName: string;
  ownerName: string;
  agentNames: string[];
  widgetDomain: string;
}

const TENANTS: TenantSpec[] = [
  {
    slug: 'acme',
    organizationName: 'Acme Bikes',
    ownerName: 'Dana Okonkwo',
    agentNames: ['Sam Rivera', 'Priya Nair'],
    widgetDomain: 'acme-bikes.localhost',
  },
  {
    // Present so isolation failures are visible, not to be logged into.
    slug: 'northwind',
    organizationName: 'Northwind Supply',
    ownerName: 'Lee Whitfield',
    agentNames: ['Jordan Ames'],
    widgetDomain: 'northwind-supply.localhost',
  },
];

async function seedTenant(spec: TenantSpec, passwordHash: string): Promise<void> {
  const existing = await prisma.organization.findFirst({
    where: { name: spec.organizationName },
    select: { id: true },
  });
  if (existing) {
    console.log(`  ${spec.organizationName}: already present, skipping`);
    return;
  }

  const organization = await prisma.organization.create({
    data: { name: spec.organizationName, region: 'eu' },
    select: { id: true },
  });

  const license = await prisma.license.create({
    data: {
      organizationId: organization.id,
      plan: 'growth',
      billingCycle: 'monthly',
      status: 'trialing',
      trialEndsAt: new Date(Date.now() + 14 * 86_400_000),
    },
    select: { id: true },
  });

  const owner = await prisma.account.create({
    data: {
      email: `owner@${spec.slug}.localhost`,
      name: spec.ownerName,
      passwordHash,
    },
    select: { id: true, email: true },
  });

  await prisma.agentMembership.create({
    data: {
      licenseId: license.id,
      agentId: owner.id,
      role: 'owner',
      routingStatus: 'accepting_chats',
      concurrentChatsLimit: 6,
    },
  });

  for (const [index, name] of spec.agentNames.entries()) {
    const agent = await prisma.account.create({
      data: {
        email: `agent${index + 1}@${spec.slug}.localhost`,
        name,
        passwordHash,
      },
      select: { id: true },
    });
    await prisma.agentMembership.create({
      data: {
        licenseId: license.id,
        agentId: agent.id,
        role: index === 0 ? 'admin' : 'agent',
        routingStatus: 'accepting_chats',
        concurrentChatsLimit: 6,
      },
    });
  }

  await prisma.oauthClient.create({
    data: {
      // Per-tenant id: a client belongs to exactly one organization, and the
      // authorize endpoint refuses a mismatch.
      id: `${AGENT_CLIENT_ID}-${spec.slug}`,
      organizationId: organization.id,
      displayName: 'Nexa Agent App',
      // Public client: OAuth 2.1 relies on PKCE rather than a secret for
      // anything that runs in a browser, where no secret can stay secret.
      clientType: 'public',
      redirectUris: ['http://localhost:5173/auth/callback'],
      scopes: [],
    },
  });

  await prisma.trustedDomain.create({
    data: {
      organizationId: organization.id,
      licenseId: license.id,
      domain: spec.widgetDomain,
      includeSubdomains: true,
    },
  });

  await prisma.customer.createMany({
    data: [
      {
        organizationId: organization.id,
        name: 'Robin Fields',
        email: `robin@${spec.slug}-customer.localhost`,
        countryCode: 'GB',
        country: 'United Kingdom',
        lastActivityAt: new Date(),
      },
      {
        organizationId: organization.id,
        name: 'Alex Moreau',
        email: `alex@${spec.slug}-customer.localhost`,
        countryCode: 'FR',
        country: 'France',
        isLead: true,
        lastActivityAt: new Date(Date.now() - 3_600_000),
      },
    ],
  });

  // A ready-made PAT so `curl` works immediately after `make dev`. Development
  // only, and deterministic on purpose — see the warning printed below.
  const demoToken = `nexa_pat_demo_${spec.slug}`;
  await prisma.apiToken.create({
    data: {
      licenseId: license.id,
      organizationId: organization.id,
      ownerId: owner.id,
      kind: 'pat',
      tokenHash: hashToken(demoToken),
      name: 'Demo token (seed)',
      scopes: [
        'accounts--my:rw',
        'agents--all:rw',
        'chats--all:rw',
        'customers:rw',
        'groups--all:rw',
        'tags--all:rw',
        'reports_read',
      ],
    },
  });

  console.log(`  ${spec.organizationName}`);
  console.log(`    license      ${license.id}`);
  console.log(`    owner        ${owner.email} / ${DEMO_PASSWORD}`);
  console.log(`    client_id    ${AGENT_CLIENT_ID}-${spec.slug}`);
  console.log(`    widget host  ${spec.widgetDomain}`);
  console.log(`    demo token   ${demoToken}`);
}

async function main(): Promise<void> {
  if (process.env['NODE_ENV'] === 'production') {
    throw new Error('The demo seed must never run against production.');
  }

  // Hash once: scrypt is deliberately slow, and every demo account shares the
  // same password anyway.
  const passwordHash = await hashPassword(DEMO_PASSWORD);

  console.log('seeding demo data');
  for (const spec of TENANTS) {
    await seedTenant(spec, passwordHash);
  }

  console.log('');
  console.log('  ⚠  Seed credentials are public and identical on every machine.');
  console.log('     They exist for local development only.');
}

main()
  .catch((error: unknown) => {
    console.error('seed failed:', error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
