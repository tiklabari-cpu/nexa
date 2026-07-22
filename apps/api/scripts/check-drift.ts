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
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const apiRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

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
];

async function main(): Promise<void> {
  const { stdout } = await run(
    'pnpm',
    [
      'exec',
      'prisma',
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
