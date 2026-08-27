import { parseEnv } from './config/env.js';
import { loadEnvFile } from './config/load-env-file.js';
import { installShutdownHandlers } from './lib/shutdown.js';
import { buildServer } from './server.js';

// Before parseEnv, so a developer running this directly does not have to
// remember to source .env first.
loadEnvFile();

async function main(): Promise<void> {
  const env = parseEnv();
  const app = await buildServer({ env });

  // Turn readiness off, wait out the drain window, then let in-flight requests
  // finish before anything closes — so a redeploy never truncates a reply
  // (M-OPS-b). The sequence and why each step is in that order: lib/shutdown.ts.
  installShutdownHandlers({ app, drainMs: env.shutdownDrainMs });

  await app.listen({ port: env.API_PORT, host: env.API_HOST });
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
