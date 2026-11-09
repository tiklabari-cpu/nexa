/**
 * Put a workspace on a plan the way the platform operator does (tm 432).
 *
 * The one fixture here that does not go through the workspace's public API,
 * because since tm 432 that API cannot do it: the checkout
 * (`PATCH /billing/subscription`) refuses a quoted tier with
 * `plan_requires_sales`, and Enterprise is assigned by the root panel
 * (`set-plan` on the platform API). Driving that API from a spec would take an
 * operator with an enrolled authenticator, and the only way to make the first
 * one — the bootstrap CLI — refuses once any operator exists, which
 * `platform-admin.spec.ts` depends on being first to do.
 *
 * So this shells out to `pnpm --filter @siyahtus/api seed:plan`, which runs the
 * platform's own `setPlan` against this run's database (`DATABASE_URL`, the one
 * `global-setup.ts` seeded) — the same rows the operator's action writes, minus
 * the operator's audit entry. Moving *down* to growth stays on the checkout
 * (`PATCH /billing/subscription`), which is the owner's real path and is what
 * the specs exercise.
 */
import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import type { TenantOwner } from './fixtures.js';

const run = promisify(execFile);
const repoRoot = resolve(import.meta.dirname, '../../..');

export async function assignPlan(
  owner: Pick<TenantOwner, 'email'>,
  plan: 'growth' | 'enterprise',
): Promise<void> {
  await run(
    'pnpm',
    ['--filter', '@siyahtus/api', 'seed:plan', '--owner', owner.email, '--plan', plan],
    {
      cwd: repoRoot,
      // `pnpm` is a shell shim on Windows, not a `.exe` — see `global-setup.ts`.
      shell: true,
      maxBuffer: 4 * 1024 * 1024,
    },
  );
}
