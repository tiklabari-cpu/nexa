/**
 * The owner's live smoke for the chat provider (tm 481 · K51):
 *
 *   pnpm --filter @siyahtus/api llm:smoke
 *   docker compose -f docker-compose.pilot.yml run --rm --no-deps api node dist/scripts/llm-smoke.js
 *
 * Reads the same `LLM_*` variables the server does (the repo-root `.env` in a
 * checkout, the container's environment in the pilot image), makes three tiny
 * calls with the owner's own key, and prints one line per call. Never prints
 * the key, a prompt or a reply. Exit 0 all passed, 1 one failed, 2 not
 * configured (nothing sent). The logic and its tests are in
 * `src/services/ai/provider/llm-smoke.ts`; see
 * `docs/runbooks/ai-pilot-llm-cutover.md` for when to run it.
 */
import { performance } from 'node:perf_hooks';
import { loadEnvFile } from '../src/config/load-env-file.js';
import { runLlmSmokeFromEnv } from '../src/services/ai/provider/llm-smoke.js';

loadEnvFile();
process.exitCode = await runLlmSmokeFromEnv(process.env, {
  write: (line) => process.stdout.write(`${line}\n`),
  now: () => performance.now(),
});
