/**
 * The platform-api process (tm 389.3): `node dist/src/platform.js`, from the
 * same image as the tenant API — compose and Helm give it this command and
 * `SIYAHTUS_MIGRATE_ON_START=false` (the tenant API migrates).
 */
import { parseEnv } from './config/env.js';
import { loadEnvFile } from './config/load-env-file.js';
import { assertPlatformEnv } from './config/platform-env.js';
import { installShutdownHandlers } from './lib/shutdown.js';
import { buildPlatformServer } from './platform-server.js';

loadEnvFile();

/** How long a failed boot may take to let go of its connections before it is cut. */
const FAILED_BOOT_EXIT_MS = 5_000;

async function main(): Promise<void> {
  const env = parseEnv();
  // The platform's own boot rules — refused here, never in the tenant API.
  const platform = assertPlatformEnv(env);
  const app = await buildPlatformServer({ env, platform });

  installShutdownHandlers({ app, drainMs: env.shutdownDrainMs });

  await app.listen({ port: platform.port, host: platform.host });
}

main().catch((error: unknown) => {
  console.error(error);
  // `exitCode`, not `exit()`: an immediate exit after a fetch asserts in libuv
  // on Windows. A boot that failed half-way may still hold a Redis reconnect
  // loop open, though, so the exit is forced if the loop does not drain.
  process.exitCode = 1;
  setTimeout(() => process.exit(1), FAILED_BOOT_EXIT_MS).unref();
});
