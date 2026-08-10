/**
 * Runs a test command against datastores nobody else is using.
 *
 *     tsx scripts/with-test-datastores.ts vitest run --dir test/integration
 *
 * Provisions a private Postgres database and leases a private Redis index
 * (see `test-datastores.ts` for why), runs the command with `DATABASE_URL`,
 * `DATABASE_APP_URL` and `REDIS_URL` repointed at them, then tears both down —
 * including when the command fails or the window is interrupted.
 *
 * Everything downstream reads those three variables from the environment, so no
 * test, helper or fixture needs to know this exists. `@nexa/rtm` invokes this
 * same script by relative path: it shares the API's schema and datastores, so a
 * second copy of the harness would be a second thing to keep in step.
 *
 * Set `NEXA_TEST_ISOLATION=off` to run against the shared development database
 * instead — useful when inspecting the leftovers of a failing test by hand.
 */
import { spawn } from 'node:child_process';
import { loadEnvFile } from '../src/config/load-env-file.js';
import {
  provisionIsolatedDatastores,
  type IsolatedDatastoreEnv,
  type IsolatedDatastores,
} from './test-datastores.js';

loadEnvFile();

const argv = process.argv.slice(2);
if (argv.length === 0) {
  console.error('usage: with-test-datastores.ts <command> [args...]');
  process.exit(2);
}

const [command] = argv as [string, ...string[]];

/**
 * The command has to go through a shell — the test runners are `.bin` shims,
 * which are `.cmd` files on Windows and invisible to `CreateProcess` without
 * one. Passing an argument *array* alongside `shell: true` concatenates without
 * escaping (Node's DEP0190), so the line is assembled and quoted here instead.
 */
function commandLine(): string {
  return argv.map((arg) => (/^[\w@%+=:,./-]+$/.test(arg) ? arg : `"${arg}"`)).join(' ');
}

function runCommand(overrides: Partial<IsolatedDatastoreEnv>): Promise<number> {
  return new Promise((resolvePromise) => {
    const child = spawn(commandLine(), {
      stdio: 'inherit',
      shell: true,
      env: { ...process.env, ...overrides },
    });

    const forward = (signal: NodeJS.Signals) => (): void => {
      child.kill(signal);
    };
    const onInt = forward('SIGINT');
    const onTerm = forward('SIGTERM');
    process.on('SIGINT', onInt);
    process.on('SIGTERM', onTerm);

    child.on('error', (error) => {
      console.error(`failed to start "${command}": ${error.message}`);
      resolvePromise(1);
    });
    child.on('close', (code, signal) => {
      process.off('SIGINT', onInt);
      process.off('SIGTERM', onTerm);
      // A signalled child has no exit code; report failure rather than success.
      resolvePromise(code ?? (signal ? 1 : 0));
    });
  });
}

async function main(): Promise<number> {
  if (process.env['NEXA_TEST_ISOLATION'] === 'off') {
    console.error('[test-datastores] isolation disabled — using the shared database');
    return runCommand({});
  }

  let datastores: IsolatedDatastores;
  try {
    datastores = await provisionIsolatedDatastores();
  } catch (error) {
    console.error(
      `[test-datastores] could not isolate the datastores: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    // Deliberately fatal. Falling back to the shared database would reintroduce
    // exactly the cross-window corruption this exists to prevent, and it would
    // do it silently — the failures would land on whoever ran next.
    return 1;
  }

  console.error(
    `[test-datastores] postgres=${datastores.databaseName} redis=db${datastores.redisIndex}`,
  );

  try {
    return await runCommand(datastores.env);
  } finally {
    await datastores.release().catch((error: unknown) => {
      console.error(
        `[test-datastores] cleanup failed (a later run will sweep it): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    });
  }
}

process.exitCode = await main();
