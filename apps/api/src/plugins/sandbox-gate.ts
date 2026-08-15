/**
 * A sandbox has no commercial existence (FR-MOD-11.5 · 11.5-f).
 *
 * The sandbox licence is a second tenant, and almost everything that keeps it
 * separate is row level security doing its ordinary job — its chats, reports,
 * settings and members are invisible to the parent because they belong to a
 * different licence, with no code anywhere aware of the word "sandbox". This
 * hook is the exception, because billing is the one place where *separate* is
 * not enough: a sandbox that quietly kept its own subscription, card and
 * purchased API packages would be perfectly isolated and also a second bill.
 *
 * So: every write under `/billing/` is refused inside a sandbox. Reads stay
 * open — the same split `plugins/entitlement-gate.ts` makes, and for the same
 * reason. `GET /billing/subscription` inside a sandbox truthfully answers "no
 * subscription, self-serve tier", which is exactly what a screen needs to say
 * "this is a sandbox, nothing here is charged"; 403-ing it would leave the page
 * unable to explain itself and protect nothing.
 *
 * Matched on the path prefix rather than a `config` flag on each route. A
 * per-route annotation is one forgotten line away from a hole, and the hole
 * here is a workspace nobody is billing for — the same argument
 * `plugins/license-gate.ts` makes for enforcing read-only mode as a hook.
 *
 * What this does *not* have to cover, because the licence boundary already
 * does: seat counts (`ensureSeatsCoverHeadcount` counts memberships under the
 * caller's own licence, so a sandbox's members are never seats on the parent's
 * bill), the meter (`services/billing/metering.ts` refuses at the insert), and
 * every report (built from licence-scoped rows). Each of those was checked
 * rather than assumed — see `test/integration/sandbox.test.ts`.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { ApiError } from '../lib/api-error.js';
import { isSandboxLicense } from '../services/billing/sandbox-service.js';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * The commercial surface, by path.
 *
 * Hard-coded like `license-gate`'s `ALWAYS_ALLOWED` rather than derived from
 * `API_PREFIX`: a plugin importing from `server.ts` would close a cycle, and the
 * mount point has been `/api/v1` since the first commit.
 */
const BILLING_PATH = /^\/api\/v1\/billing\//;

async function sandboxGatePlugin(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', async (request: FastifyRequest) => {
    if (!request.principal) return;
    if (!MUTATING_METHODS.has(request.method)) return;
    if (!BILLING_PATH.test(request.url)) return;

    // One indexed primary-key lookup, and only on a billing write — a few dozen
    // requests in the life of a workspace. Read fresh rather than cached for
    // the same reason the licence gate reads fresh: a cached answer would keep
    // being right long enough to be wrong exactly once.
    const sandbox = await request.withTenant((tx) =>
      isSandboxLicense(tx, request.tenant().licenseId),
    );
    if (!sandbox) return;

    throw new ApiError(
      'not_allowed',
      'This is a sandbox workspace. It is never billed, so it has no subscription, card or usage packages — make commercial changes in the production workspace.',
      // Named so a console that landed here from a deep link can say which
      // workspace it is in rather than showing an unexplained refusal. It
      // discloses nothing: the caller holds a credential for this licence and
      // `GET /settings/sandbox` tells them the same thing.
      { details: { sandbox: true } },
    );
  });
}

export default fp(sandboxGatePlugin, { name: 'sandbox-gate', dependencies: ['auth'] });
