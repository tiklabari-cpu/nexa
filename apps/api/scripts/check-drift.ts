/**
 * Fails if the database has drifted from schema.prisma.
 *
 * `prisma migrate diff` alone cannot be used as a gate, because Prisma has no
 * syntax for index *access methods*. The pgvector ivfflat index on
 * `knowledge_chunks.embedding` therefore always shows up as a difference even
 * though the migration creates it deliberately.
 *
 * Rather than abandoning the check — and losing the ability to notice real
 * drift — this allows exactly that one known statement and fails on anything
 * else. The allowance is narrow and named, so a second unexplained diff is
 * still an error.
 */
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { loadEnvFile } from '../src/config/load-env-file.js';

loadEnvFile();

const run = promisify(execFile);
const apiRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Run Prisma's JS entrypoint under the current Node binary instead of going
 * through `pnpm exec`. On Windows the package managers are `.cmd` shims, which
 * `execFile` cannot start without a shell (ENOENT, then EINVAL once Node
 * hardened `.cmd` spawning). Resolving the module keeps the call shell-free —
 * so there is no quoting or injection surface — and behaves the same on POSIX.
 */
const prismaBin = createRequire(import.meta.url).resolve('prisma/build/index.js');

/**
 * Statements Prisma reports because it cannot model them, not because anything
 * is actually wrong. Each must name the migration that creates it for real.
 */
const KNOWN_UNMODELLABLE = [
  {
    // Created as `USING ivfflat (embedding vector_cosine_ops)` in 20260722154008_domain_model.
    pattern: /CREATE INDEX "idx_chunks_embedding" ON "public"\."knowledge_chunks"/,
    reason: 'pgvector ivfflat index — Prisma cannot express index access methods',
  },
  {
    // Created as `ON brands(license_id) WHERE is_default` in 20260802100000_brands.
    pattern: /CREATE UNIQUE INDEX "brands_one_default_per_license" ON "public"\."brands"/,
    reason:
      'partial unique index (one default brand per license) — Prisma cannot express a WHERE predicate',
  },
  {
    // Created as `ON channels(type, (config->>'address')) WHERE status = 'connected'
    // AND config->>'address' IS NOT NULL` in 20260809090000_channel_address_uniqueness.
    pattern: /CREATE UNIQUE INDEX "channels_connected_address_key" ON "public"\."channels"/,
    reason:
      'partial expression unique index (one workspace per connected channel address) — Prisma cannot express a JSON expression index or a WHERE predicate',
  },
  {
    // Created as `ON webhook_deliveries(license_id, event_id) WHERE state = 'pending'`
    // in 20260818100000_webhook_redelivery.
    pattern:
      /CREATE UNIQUE INDEX "webhook_deliveries_one_pending_per_event" ON "public"\."webhook_deliveries"/,
    reason:
      'partial unique index (one queued redelivery per event) — Prisma cannot express a WHERE predicate',
  },
  {
    // Created as `ON campaign_sends(license_id, customer_id) WHERE delivered_at
    // IS NULL` in 20260831100000_campaign_sends_delivered_at.
    pattern: /CREATE INDEX "campaign_sends_pending_by_customer_idx" ON "public"\."campaign_sends"/,
    reason:
      "partial index (poll lookup of a visitor's still-pending campaign sends) — Prisma cannot express a WHERE predicate",
  },
  {
    // Created as `ON inbound_email_addresses(license_id) WHERE label IS NULL` in
    // 20260905140000_inbound_email_addresses.
    pattern:
      /CREATE UNIQUE INDEX "inbound_email_addresses_one_default_per_license" ON "public"\."inbound_email_addresses"/,
    reason:
      'partial unique index (one default forwarding address per licence) — Prisma cannot express a WHERE predicate',
  },
];

async function main(): Promise<void> {
  const { stdout } = await run(
    process.execPath,
    [
      prismaBin,
      'migrate',
      'diff',
      '--from-schema-datamodel',
      'prisma/schema.prisma',
      '--to-schema-datasource',
      'prisma/schema.prisma',
      '--script',
    ],
    { cwd: apiRoot, env: process.env },
  );

  const statements = stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('--'));

  const unexplained = statements.filter(
    (statement) => !KNOWN_UNMODELLABLE.some((known) => known.pattern.test(statement)),
  );

  if (unexplained.length > 0) {
    console.error('Database has drifted from prisma/schema.prisma:\n');
    for (const statement of unexplained) console.error(`  ${statement}`);
    console.error('\nRun `pnpm --filter @nexa/api db:migrate` or add a migration.');
    process.exitCode = 1;
    return;
  }

  const allowed = statements.length;
  console.log(
    allowed > 0 ? `no drift (${allowed} known-unmodellable statement(s) allowed)` : 'no drift',
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
