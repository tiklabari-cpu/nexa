/**
 * Demo seed.
 *
 * Deliberately creates **two** organizations. Cross-tenant isolation is the
 * property most easily broken without anyone noticing, so the default dataset
 * always contains a second tenant for the negative tests to reach for.
 *
 * Slice 3 fills this in once the tables exist.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  // Fails loudly if migrations have not run, which is the common cause of a
  // confusing seed error.
  await prisma.$queryRaw`SELECT 1`;
  console.log('seed: schema reachable; no tables to populate yet (arrives in slice 3)');
}

main()
  .catch((error: unknown) => {
    console.error('seed failed:', error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
