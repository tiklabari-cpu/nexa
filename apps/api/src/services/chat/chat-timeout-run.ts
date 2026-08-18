/**
 * `chat-timeout:run` — the manual trigger for the idle-chat sweep (FR-MOD-08.7.3).
 *
 * There is no *external* scheduler in this environment (a project boundary) —
 * no host cron, no managed job runner — so this script is how an operator (or
 * CI) drives the sweep by hand. Since M-SCHED-b the in-process scheduler
 * (`services/scheduler/jobs.ts`) also calls `ChatTimeoutSweeper.run()` on its
 * own interval, the same way this script does. It connects as the runtime
 * (RLS-bound) role, so every read and close is scoped to its own workspace
 * exactly as a request would be.
 *
 * Unlike the retention sweep this has no dry-run: closing an idle chat is
 * reversible (the customer returning simply opens a new thread), so there is no
 * irreversible blast radius to preview. The machine-readable report goes to
 * stdout; a one-line human summary goes to stderr.
 *
 *   pnpm --filter @nexa/api chat-timeout:run
 */
import { loadEnvFile } from '../../config/load-env-file.js';

loadEnvFile();

import { PrismaClient } from '@prisma/client';
import { parseEnv } from '../../config/env.js';
import { createMailer } from '../mail/mailer.js';
import { ChatService } from './chat-service.js';
import { ChatTimeoutSweeper } from './chat-timeout.js';

/**
 * Redis is only touched by the send path's idempotency check, never by a close,
 * so the sweep needs no live cache. This stub satisfies the type without one.
 */
const NO_REDIS = {
  set: async (): Promise<string | null> => null,
  get: async (): Promise<string | null> => null,
};

async function main(): Promise<void> {
  const env = parseEnv();
  const db = new PrismaClient({ datasourceUrl: env.runtimeDatabaseUrl });
  try {
    // No publisher: realtime fan-out is an enhancement over polling, and a
    // background sweep has no socket to push to. Agents see the close on their
    // next poll. A mailer, though, is wired: an idle chat closed by the sweep
    // gets its transcript e-mailed exactly as a hand-archived one does
    // (FR-MOD-08.7.4), written to disk like all outgoing mail (PLAN A4).
    const chats = new ChatService(
      db,
      NO_REDIS,
      undefined,
      undefined,
      { aiOverageCents: env.AI_OVERAGE_CENTS, aiIncluded: env.AI_RESOLUTIONS_INCLUDED },
      createMailer(env.MAIL_PROVIDER, { dir: env.MAIL_DIR }),
    );
    const report = await new ChatTimeoutSweeper(db, chats).run();

    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    process.stderr.write(
      `chat-timeout: closed ${report.totals.closed} idle chat(s) ` +
        `across ${report.totals.tenants} tenant(s)\n`,
    );
  } finally {
    await db.$disconnect();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  );
  process.exitCode = 1;
});
