/**
 * A tenant with a ten-thousand-plus-row Tickets grid, for the NFR-P4 fps
 * measurement (tm 240).
 *
 *     pnpm --filter @nexa/api seed:fps-bench
 *
 * Deliberately **not** wired into `prisma/seed.ts`'s `main()`. That seed runs
 * on every `pnpm db:seed` — including the e2e suite's `global-setup.ts`, on
 * every single run — and every other spec in the suite pays for whatever it
 * writes (`seedPagingWorkspace`'s own docblock is explicit that sixty extra
 * rows in the *shared* tenant would have rewritten inbox counters every other
 * spec asserts on). Ten thousand rows is a cost only the one spec that needs
 * them should pay, and only when it runs — so this is a standalone script the
 * fps spec's own `test.beforeAll` invokes directly, the same way
 * `global-setup.ts` shells out to `db:seed` itself.
 *
 * Idempotent like every other seed function here: a database that already has
 * the tenant is left alone. `global-setup.ts`'s `NEXA_SEED_RESET=1` truncates
 * every table before a full suite run, so in practice this always takes the
 * create path there; the guard exists for running the fps spec on its own
 * against a database that was not just reset.
 *
 * Bulk-written via `createMany`, the same reasoning as `seedPagingWorkspace`:
 * ten thousand rows through `TicketService` would be ten thousand round trips
 * this script has no business paying for. Only what the Tickets grid actually
 * reads is written — no chats, no threads, nothing routing touches — because
 * the fps measurement never opens a conversation.
 */
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { generateShortId, MOBILE_REDIRECT_URI } from '@nexa/types';
import { loadEnvFile } from '../src/config/load-env-file.js';
import { hashPassword } from '../src/lib/crypto.js';

loadEnvFile();

const prisma = new PrismaClient();

/** Same password every seeded owner uses (`fixtures.ts`'s `DEMO_PASSWORD`). */
const PASSWORD = 'nexa-demo-password';

export const FPS_BENCH = {
  organizationName: 'FPS Bench',
  slug: 'fps-bench',
  ownerName: 'Sam Renders',
  /**
   * Comfortably past the PRD's "10.000+" floor, and an exact multiple of the
   * grid's own 50-row page (`useTickets.ts`'s `TICKET_PAGE_SIZE`) so the e2e
   * spec's page-count budget has no partial last page to special-case.
   */
  ticketCount: 10_500,
  /** Round-robin owner for the tickets — enough that the Customer column is
   * not one repeated name, small enough to stay a rounding error next to the
   * ticket count. */
  customerCount: 100,
} as const;

/** `1` → `00001`, wide enough for `ticketCount` without a sort-order collision. */
function label(index: number): string {
  return String(index + 1).padStart(5, '0');
}

async function main(): Promise<void> {
  if (process.env['NODE_ENV'] === 'production') {
    throw new Error('The fps bench seed must never run against production.');
  }

  const existing = await prisma.organization.findFirst({
    where: { name: FPS_BENCH.organizationName },
    select: { id: true },
  });
  if (existing) {
    console.log(`  ${FPS_BENCH.organizationName}: already present, skipping`);
    return;
  }

  const passwordHash = await hashPassword(PASSWORD);

  const organization = await prisma.organization.create({
    data: { name: FPS_BENCH.organizationName, region: 'eu' },
    select: { id: true },
  });
  const license = await prisma.license.create({
    data: {
      organizationId: organization.id,
      plan: 'growth',
      billingCycle: 'monthly',
      status: 'trialing',
      trialEndsAt: new Date(Date.now() + 14 * 86_400_000),
      onboardingCompletedAt: new Date(),
      demoSeededAt: new Date(),
      surveyAnsweredAt: new Date(),
    },
    select: { id: true },
  });
  const licenseId = license.id;

  const owner = await prisma.account.create({
    data: {
      email: `owner@${FPS_BENCH.slug}.localhost`,
      name: FPS_BENCH.ownerName,
      passwordHash,
    },
    select: { id: true, email: true },
  });
  await prisma.agentMembership.create({
    data: {
      licenseId,
      agentId: owner.id,
      role: 'owner',
      routingStatus: 'accepting_chats',
      concurrentChatsLimit: 6,
    },
  });
  // The console signs in through OAuth 2.1 + PKCE like any other workspace
  // (`seedPagingWorkspace`'s same note applies verbatim).
  await prisma.oauthClient.create({
    data: {
      id: `nexa-agent-app-${FPS_BENCH.slug}`,
      organizationId: organization.id,
      displayName: 'Nexa Agent App',
      clientType: 'public',
      redirectUris: ['http://localhost:5173/auth/callback', MOBILE_REDIRECT_URI],
      scopes: [],
    },
  });

  const customers = Array.from({ length: FPS_BENCH.customerCount }, (_, index) => ({
    id: randomUUID(),
    organizationId: organization.id,
    name: `FPS Customer ${label(index)}`,
    email: `customer${label(index)}@${FPS_BENCH.slug}-customer.localhost`,
    countryCode: 'NL',
    country: 'Netherlands',
  }));
  await prisma.customer.createMany({ data: customers });

  // Numbered backwards from now, one per (fictional) minute, so the grid's
  // default order — `last_message_at` descending — puts `FPS Ticket 00001`
  // first and `FPS Ticket 10500` last: the row a full page-chain has to reach.
  const base = new Date();
  const stepMs = 60_000;
  await prisma.ticket.createMany({
    data: Array.from({ length: FPS_BENCH.ticketCount }, (_, index) => {
      const activeAt = new Date(base.getTime() - index * stepMs);
      return {
        id: generateShortId(),
        licenseId,
        customerId: customers[index % customers.length]!.id,
        subject: `FPS Ticket ${label(index)}`,
        lastMessageAt: activeAt,
        createdAt: activeAt,
      };
    }),
  });

  console.log(`  ${FPS_BENCH.organizationName}  (fps fixture — ${FPS_BENCH.ticketCount} tickets)`);
  console.log(`    owner        ${owner.email} / ${PASSWORD}`);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
