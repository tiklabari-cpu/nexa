/**
 * `platform:bootstrap-admin` — create the root panel's first superadmin
 * (tm 389.4 · FR-ADMIN-03). Refuses once any operator exists.
 *
 *   pnpm --filter @siyahtus/api platform:bootstrap-admin --email ops@example.com
 *   printf %s "$PW" | pnpm --filter @siyahtus/api platform:bootstrap-admin --email ops@example.com
 *   PLATFORM_BOOTSTRAP_PASSWORD=… pnpm --filter @siyahtus/api platform:bootstrap-admin --email …
 *
 * In a built image (no tsx): `node dist/src/services/platform/bootstrap-admin-run.js --email …`,
 * e.g. `docker compose exec -T platform-api node dist/src/services/platform/bootstrap-admin-run.js`.
 *
 * The password is read from `PLATFORM_BOOTSTRAP_PASSWORD`, else from stdin —
 * prompted without echo at a terminal, the first line when piped — and never
 * from an argument, which would leave it in the shell history and the process
 * list. It connects as `siyahtus_platform` (`DATABASE_PLATFORM_URL`), with the
 * platform process's own boot rules. The authenticator is enrolled at the
 * first sign-in.
 */
import { loadEnvFile } from '../../config/load-env-file.js';

loadEnvFile();

import { PrismaClient } from '@prisma/client';
import { parseEnv } from '../../config/env.js';
import { assertPlatformEnv } from '../../config/platform-env.js';
import {
  bootstrapPlatformAdmin,
  cleanPasswordInput,
  parseBootstrapArgs,
  PlatformBootstrapRefused,
} from './bootstrap-admin.js';
import { PlatformAuditLog } from './platform-audit.js';

const CTRL_C = String.fromCharCode(3);
const BACKSPACE = String.fromCharCode(8);
const DELETE = String.fromCharCode(127);

function readAll(stream: NodeJS.ReadStream): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    stream.setEncoding('utf8');
    stream.on('data', (chunk: string) => {
      data += chunk;
    });
    stream.on('end', () => resolve(data));
    stream.on('error', reject);
  });
}

/** A line typed at the terminal, not echoed. */
function promptHidden(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    process.stderr.write(prompt);
    stdin.setRawMode(true);
    stdin.setEncoding('utf8');
    stdin.resume();
    let value = '';
    const finish = (outcome: () => void): void => {
      stdin.off('data', onData);
      stdin.setRawMode(false);
      stdin.pause();
      process.stderr.write('\n');
      outcome();
    };
    const onData = (chunk: string): void => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') return finish(() => resolve(value));
        if (ch === CTRL_C) return finish(() => reject(new PlatformBootstrapRefused('Cancelled.')));
        if (ch === BACKSPACE || ch === DELETE) value = value.slice(0, -1);
        else value += ch;
      }
    };
    stdin.on('data', onData);
  });
}

async function readPassword(): Promise<string> {
  const fromEnv = process.env['PLATFORM_BOOTSTRAP_PASSWORD'];
  if (fromEnv) return cleanPasswordInput(fromEnv);
  if (process.stdin.isTTY) {
    return cleanPasswordInput(await promptHidden('Password for the first superadmin: '));
  }
  return cleanPasswordInput(await readAll(process.stdin));
}

async function main(): Promise<void> {
  const args = parseBootstrapArgs(process.argv.slice(2));
  const env = parseEnv();
  const platform = assertPlatformEnv(env);
  const password = await readPassword();

  const db = new PrismaClient({ datasourceUrl: platform.databaseUrl });
  try {
    const audit = new PlatformAuditLog(db, {
      settingsKey: platform.settingsKey,
      tenantChainSecret: env.AUDIT_CHAIN_SECRET,
    });
    const admin = await bootstrapPlatformAdmin(db, { email: args.email, password, audit });
    process.stdout.write(
      `${JSON.stringify({ id: admin.id, email: admin.email, role: 'superadmin' })}\n`,
    );
    process.stderr.write(
      `platform:bootstrap-admin: ${admin.email} is the first superadmin. Sign in at ` +
        `${platform.adminOrigin} and set up the authenticator; invite everyone else from there.\n`,
    );
  } finally {
    await db.$disconnect();
  }
}

main().catch((error: unknown) => {
  if (error instanceof PlatformBootstrapRefused) {
    process.stderr.write(`platform:bootstrap-admin: ${error.message}\n`);
  } else {
    console.error(error);
  }
  process.exitCode = 1;
});
