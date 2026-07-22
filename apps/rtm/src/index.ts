import { parseEnv } from './config/env.js';
import { buildRtmServer } from './server.js';

async function main(): Promise<void> {
  const env = parseEnv();
  const server = buildRtmServer(env);

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      void server.close().then(
        () => process.exit(0),
        () => process.exit(1),
      );
    });
  }

  await server.listen();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
