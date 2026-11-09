/**
 * Put a seeded workspace on a plan the way the root panel does — for the e2e
 * suite and local demos (tm 432).
 *
 *     pnpm --filter @siyahtus/api seed:plan --owner owner@acme.localhost --plan enterprise
 *
 * Since tm 432 the workspace's own checkout (`PATCH /billing/subscription`)
 * refuses a quoted tier with `plan_requires_sales`: Enterprise is the
 * platform's to assign (`POST /workspaces/{licenseId}/set-plan` on the platform
 * API). The browser suite moves the demo tenant down to growth through the
 * checkout and must put it back, and a fresh signup that needs a sandbox must
 * reach Enterprise at all — but driving the platform API takes an operator
 * with an enrolled authenticator, and the bootstrap CLI that makes one refuses
 * once any operator exists (`platform-admin.spec.ts` is the first to need it).
 *
 * So this calls the platform's own {@link setPlan} — the same rows, the same
 * pricing rule, `licenses.plan` included — in a transaction on `DATABASE_URL`,
 * the database the e2e run seeded. What it skips is the operator's double audit
 * entry, because no operator acted; it is a fixture, like `db:seed` and
 * `seed:fps-bench` beside it, and refuses to run with `NODE_ENV=production`.
 *
 * The workspace is named by its owner's e-mail, which is what the e2e fixtures
 * hold (`TenantOwner`). An address that owns more than one workspace (a
 * sandbox's owner, after the sandbox exists) is refused rather than guessed.
 */
import { PrismaClient } from '@prisma/client';
import { loadEnvFile } from '../src/config/load-env-file.js';
import { isPlanId, PLAN_IDS } from '../src/services/billing/subscription-service.js';
import { setPlan } from '../src/services/platform/workspace-actions.js';

loadEnvFile();

interface SeedPlanArgs {
  owner: string;
  plan: string;
}

/** `--owner <email> --plan <id>`, both required; anything else is refused. */
function parseSeedPlanArgs(argv: readonly string[]): SeedPlanArgs {
  const values = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === '--') continue;
    if (flag !== '--owner' && flag !== '--plan') throw new Error(`Unknown argument: ${flag}`);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`${flag} needs a value`);
    values.set(flag, value);
    i += 1;
  }
  const owner = values.get('--owner');
  const plan = values.get('--plan');
  if (!owner || !plan) {
    throw new Error('Usage: seed:plan --owner <owner e-mail> --plan <plan id>');
  }
  return { owner, plan };
}

async function main(): Promise<void> {
  if (process.env['NODE_ENV'] === 'production') {
    throw new Error('seed:plan is a fixture and must never run against production.');
  }
  const { owner, plan } = parseSeedPlanArgs(process.argv.slice(2));
  if (!isPlanId(plan)) {
    throw new Error(`Unknown plan "${plan}"; the catalogue has ${PLAN_IDS.join(', ')}.`);
  }

  const prisma = new PrismaClient();
  try {
    const memberships = await prisma.agentMembership.findMany({
      where: { role: 'owner', agent: { email: owner } },
      select: { licenseId: true },
    });
    if (memberships.length !== 1) {
      throw new Error(
        `${owner} owns ${memberships.length} workspaces; seed:plan needs exactly one.`,
      );
    }
    const licenseId = memberships[0]!.licenseId;
    const outcome = await prisma.$transaction((tx) => setPlan(tx, licenseId, plan));
    console.log(
      outcome.unchanged
        ? `  ${owner}: already on ${plan}`
        : `  ${owner}: ${String(outcome.payload['from'])} → ${plan}`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
