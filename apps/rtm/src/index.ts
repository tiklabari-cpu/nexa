import { parseEnv } from './config/env.js';
import { buildRtmServer } from './server.js';

async function main(): Promise<void> {
  const env = parseEnv();
  const server = buildRtmServer(env);

  // The drain itself lives in `server.close()` (M-OPS-b): readiness turns
  // false, new upgrades are refused, the window is waited out, then every open
  // socket is told to go away with close code 1001 so the client reconnects
  // somewhere else rather than reporting an error.
  //
  // `process.on`, not `once`: a second signal has to mean something. An
  // orchestrator that has run out of patience sends SIGTERM again on its way to
  // SIGKILL, and `once` would hand that one to Node's default handler, which
  // terminates immediately — indistinguishable from a crash in the logs.
  let shuttingDown = false;
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      if (shuttingDown) {
        process.exit(1);
        return;
      }
      shuttingDown = true;
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
