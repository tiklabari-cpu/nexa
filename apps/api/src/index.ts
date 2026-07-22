import { parseEnv } from './config/env.js';
import { loadEnvFile } from './config/load-env-file.js';
import { buildServer } from './server.js';

// Before parseEnv, so a developer running this directly does not have to
// remember to source .env first.
loadEnvFile();

async function main(): Promise<void> {
  const env = parseEnv();
  const app = await buildServer({ env });

  // Drain in-flight requests before exiting so a deploy never truncates a reply.
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      app.log.info({ signal }, 'shutting down');
      void app.close().then(
        () => process.exit(0),
        (error: unknown) => {
          app.log.error({ err: error }, 'error during shutdown');
          process.exit(1);
        },
      );
    });
  }

  await app.listen({ port: env.API_PORT, host: env.API_HOST });
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
