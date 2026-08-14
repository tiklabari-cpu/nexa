/**
 * SCIM 2.0 server core (NFR-S11 · S11-e).
 *
 * The surface an identity provider's provisioning connector calls to keep this
 * workspace's member list in step with its directory: `/scim/v2/Users` for the
 * people, `/scim/v2/Groups` (read-only) for the teams they belong to.
 *
 * ## Why authentication and tenant scope are one piece of work
 *
 * A SCIM token manages the entire user lifecycle of an organisation. The two
 * questions it raises — "is this token real?" and "which workspace is it for?" —
 * cannot be released apart, because the state in between is a version where a
 * valid token from workspace A can be answered with, or made to write into,
 * workspace B. A read leak there would be bad; a *write* path is worse, and
 * every endpoint below writes.
 *
 * So both answers come from one place and neither comes from the caller:
 *
 *   - `plugins/auth.ts` resolves the bearer token to a `ScimPrincipal`, whose
 *     `licenseId`/`organizationId` are read off the token row (`api_tokens`),
 *     never off a header, a path segment or a body field;
 *   - every query here runs through `request.withTenant`, so row-level security
 *     is the thing that decides what exists — a membership of another licence is
 *     not "forbidden", it is invisible, and the endpoints answer 404 without
 *     having to remember to.
 *
 * There is no code path in this file that takes a tenant from anywhere else.
 * That is the whole claim, and the cross-tenant matrix in
 * `test/integration/scim.test.ts` is what holds it to it.
 *
 * ## What a lifecycle operation means here (S11-f)
 *
 * The protocol above says *what was asked*; this says what the product does
 * about it. Three rules, and none of them is invented for SCIM:
 *
 *   - **The effect of suspending is the effect of suspending.** A deactivation
 *     over SCIM runs the same `setMembershipSuspension` an admin's
 *     `PUT /agents/{id}/suspension` runs — the flag, the presence event, the
 *     `member.suspended` entry, and the rule that restating today's state writes
 *     nothing. A second implementation would have been the one that forgot the
 *     audit entry, and it would have been the unattended one.
 *   - **The owner cannot be deactivated.** Every other decision here is the
 *     directory's to make; this one would let an external system lock a
 *     workspace out of its own administration, so it is refused with a 403 and
 *     stays a human's job. Everything below the owner — `admin` included — is
 *     within reach, which is exactly the reach of the admin who minted the
 *     credential (`POST /settings/scim-tokens` is gated on `admin`).
 *   - **Seats follow the people, upwards only.** Provisioning past the purchased
 *     seat count raises it; deprovisioning never lowers it. The reasoning is in
 *     `ensureSeatsCoverHeadcount` — briefly, a bill that silently under-counts is
 *     worse than one that grows, and shrinking a customer's plan is a commercial
 *     decision no directory gets to make unattended.
 *
 * Audit entries reuse the existing membership vocabulary — `member.invited`,
 * `member.suspended`, `member.unsuspended` — because those are the same three
 * facts. What is different rides in the metadata: `via: 'scim'` and the
 * credential's id, which is the only way the trail can name the actor at all
 * (a connector is not a person, so `actor_id` is null; see `plugins/audit.ts`).
 *
 * ## Two things a deprovision deliberately does not do
 *
 * **It does not revoke tokens one by one.** It does not have to: every request
 * re-resolves its bearer token against the membership (`token-service.ts`), so a
 * suspended member's live sessions stop working on their next call, with no
 * sweep to get wrong and no window to get caught in. The same read is what makes
 * the sign-in path refuse them (`auth_list_memberships`).
 *
 * **It does not reassign their open chats.** Suspension already takes them out
 * of routing, and re-homing live conversations is a supervisor's judgement about
 * customers, not a directory's about employees — the product has a surface for
 * it (`chat.taken_over`) and it belongs to whoever is watching the queue.
 *
 * ## Deliberate protocol choices
 *
 * - **`accounts` is never modified.** A SCIM User's address and display name
 *   live on the global `accounts` row (PRD §8.4), which a person may share with
 *   another workspace. This endpoint writes only the membership. A create may
 *   bring a brand new account into existence; nothing here may rewrite one that
 *   already exists — the same rule `auth_provision_sso_account` states for
 *   federated sign-in, and for the same reason.
 * - **A patch that would rename a `userName` is refused, not ignored.** Silently
 *   dropping a display-name update is cosmetic staleness; silently dropping a
 *   sign-in-address change leaves the identity provider believing a person's
 *   login moved when it did not.
 * - **`PUT /Users/{id}` is not implemented.** Every connector that matters can
 *   be configured to patch, and a whole-resource replace whose only writable
 *   fields are `active` and `externalId` would be a misleading thing to publish.
 */
import { Prisma } from '@prisma/client';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ApiError, isApiError } from '../lib/api-error.js';
import type { TenantClient } from '../lib/tenant.js';
import {
  SCIM_CONTENT_TYPE,
  parseScimFilter,
  parseScimPage,
  readScimCreateUser,
  readScimPatch,
  scimErrorBody,
  scimListResponse,
  scimProblem,
  serialiseScimGroup,
  serialiseScimUser,
  type ScimGroupSource,
  type ScimPage,
  type ScimUserSource,
} from '../lib/scim.js';
import { writeAuditEntry } from '../services/audit/audit-log.js';
import { setMembershipSuspension } from '../services/auth/membership-service.js';
import { ensureSeatsCoverHeadcount } from '../services/billing/subscription-service.js';
import type { ScimPrincipal } from '../services/auth/principal.js';

/**
 * The role a SCIM-provisioned member gets.
 *
 * Fixed, and that is what keeps a SCIM token weaker than the admin who minted
 * it. If a directory could choose the role, a provisioning connector could
 * create an owner — a power no admin has, since they cannot promote anyone above
 * themselves either — and the `admin` gate on the mint endpoint would be
 * meaningless. Group-to-role mapping is out of scope for this whole item and
 * needs its own decision record (PLAN §6.1 assumptions).
 */
const SCIM_ROLE = 'agent';

/** Filters this server understands, per resource (see `parseScimFilter`). */
const USER_FILTER_ATTRIBUTES = ['userName', 'externalId', 'id', 'active'] as const;
const GROUP_FILTER_ATTRIBUTES = ['displayName', 'id'] as const;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Values no row can hold, for filters whose input cannot match anything (a
 * malformed id, say). Filtering on an impossible value rather than
 * short-circuiting keeps `totalResults` honest at 0 and the response shape
 * identical to a filter that simply found nobody — the un-enumerable answer
 * (NFR-S5) without a special case.
 */
const NO_MATCH_UUID = '00000000-0000-0000-0000-000000000000';
const NO_MATCH_ID = BigInt(-1);

const MEMBERSHIP_SELECT = {
  licenseId: true,
  agentId: true,
  suspended: true,
  // Read for the lifecycle rules rather than the response: `role` decides
  // whether a deactivation is refused (the owner) and is what the audit entry
  // records, `routingStatus` is what the presence event carries. Neither is
  // serialised — SCIM has no notion of either.
  role: true,
  routingStatus: true,
  scimExternalId: true,
  createdAt: true,
  agent: { select: { id: true, email: true, name: true } },
} satisfies Prisma.AgentMembershipSelect;

const GROUP_SELECT = {
  id: true,
  name: true,
  createdAt: true,
  agents: { select: { agent: { select: { id: true, name: true } } } },
} satisfies Prisma.GroupSelect;

interface MembershipRow {
  licenseId: bigint;
  agentId: string;
  suspended: boolean;
  role: string;
  routingStatus: string;
  scimExternalId: string | null;
  createdAt: Date;
  agent: { id: string; email: string; name: string };
}

interface GroupRow {
  id: bigint;
  name: string;
  createdAt: Date;
  agents: Array<{ agent: { id: string; name: string } }>;
}

function toUserSource(row: MembershipRow): ScimUserSource {
  return {
    accountId: row.agentId,
    email: row.agent.email,
    name: row.agent.name,
    suspended: row.suspended,
    externalId: row.scimExternalId,
    createdAt: row.createdAt,
  };
}

function toGroupSource(row: GroupRow): ScimGroupSource {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.createdAt,
    members: row.agents.map((member) => ({
      accountId: member.agent.id,
      display: member.agent.name,
    })),
  };
}

/**
 * A duplicate key, however it surfaced.
 *
 * Prisma reports one as `P2002` from a model call and as `P2010` carrying the
 * driver's SQLSTATE from a raw one — and this file makes both kinds of call, so
 * checking only the first would turn "that externalId is taken" into a 500 on
 * the create path but not on the patch path.
 */
function isUniqueViolation(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (error.code === 'P2002') return true;
  const meta = error.meta as { code?: unknown } | undefined;
  return meta?.code === '23505' || error.message.includes('23505');
}

/** Group ids are per-license integers (PRD §8.4), so a SCIM id is their text. */
function readBigIntId(raw: string): bigint | null {
  if (!/^\d{1,19}$/.test(raw)) return null;
  try {
    return BigInt(raw);
  } catch {
    return null;
  }
}

export default async function scimRoutes(
  app: FastifyInstance,
  options: {
    /** `API_BASE_URL` + the version prefix + `/scim/v2` — what `meta.location` is built on. */
    baseUrl: string;
  },
): Promise<void> {
  const { baseUrl } = options;

  /**
   * SCIM's media type (RFC 7644 §3.1). Fastify parses `application/json` out of
   * the box and nothing else, so without this a POST from Okta — which sends
   * `application/scim+json` — is refused as an unsupported media type before any
   * of the logic below runs. Registered inside this plugin, like the SAML form
   * parser, so the rest of the API keeps accepting exactly what it accepted
   * before.
   */
  app.addContentTypeParser(SCIM_CONTENT_TYPE, { parseAs: 'string' }, (_request, body, done) => {
    const raw = (body as string).trim();
    if (raw === '') return done(null, undefined);
    try {
      done(null, JSON.parse(raw) as unknown);
    } catch {
      done(scimProblem('validation', 'The request body is not valid JSON.', 'invalidSyntax'));
    }
  });

  /**
   * RFC 7644 §3.12 instead of ADR-06, for this plugin only.
   *
   * Set on the encapsulated instance, so it governs every route below *and*
   * every failure raised on their behalf by the shared hooks — a 401 from the
   * authentication plugin and a 429 from the rate limiter reach a SCIM client in
   * the envelope its connector parses, not in ours. The error taxonomy is
   * unchanged: these are the same `ApiError` values the rest of the API throws,
   * rendered differently on the way out.
   */
  app.setErrorHandler((error, request: FastifyRequest, reply: FastifyReply) => {
    const apiError = isApiError(error)
      ? error
      : // Anything unrecognised is flattened, exactly as the global handler does:
        // a driver message or a stack frame must not leave the process.
        ApiError.internal('Internal server error.', error);

    const payload = {
      err: error,
      request_id: request.id,
      error_type: apiError.type,
      method: request.method,
      url: request.url,
    };
    if (apiError.status >= 500) request.log.error(payload, apiError.message);
    else request.log.warn(payload, apiError.message);

    if (apiError.headers) reply.headers(apiError.headers);
    return reply.status(apiError.status).type(SCIM_CONTENT_TYPE).send(scimErrorBody(apiError));
  });

  /** Every SCIM route: a SCIM token and nothing else (see `plugins/auth.ts`). */
  const scimRoute = { config: { principals: ['scim' as const] } };

  /**
   * The caller's workspace.
   *
   * The `principals` gate has already refused every other kind, so this is a
   * narrowing rather than a check — but it throws instead of casting, so a route
   * registered one day without that config fails on its first request instead of
   * running with a tenant derived from the wrong sort of principal.
   */
  function principalOf(request: FastifyRequest): ScimPrincipal {
    const principal = request.requirePrincipal();
    if (principal.kind !== 'scim') throw ApiError.notFound('Resource not found.');
    return principal;
  }

  function scimReply(reply: FastifyReply, status: number, body: unknown): FastifyReply {
    return reply.status(status).type(SCIM_CONTENT_TYPE).send(body);
  }

  function readPage(query: unknown): ScimPage {
    const parsed = parseScimPage((query ?? {}) as { startIndex?: unknown; count?: unknown });
    if (!parsed.ok) throw scimProblem('validation', parsed.detail, 'invalidValue');
    return parsed.page;
  }

  function rejectFilter(
    reason: 'malformed' | 'unsupported_attribute',
    attributes: readonly string[],
    resource: string,
  ): never {
    throw scimProblem(
      'validation',
      reason === 'unsupported_attribute'
        ? `This server filters ${resource} on ${attributes.join(', ')} only.`
        : 'Only filters of the form `attribute eq "value"` are supported.',
      'invalidFilter',
    );
  }

  /**
   * Turn `?filter=` into a `where` fragment, or refuse it as `invalidFilter`.
   *
   * The filter never reaches SQL as text. `parseScimFilter` returns one
   * attribute and one value, and the attribute→column mapping is the closed list
   * below — so client input decides what a column is compared *to*, never which
   * column is compared.
   */
  function userFilter(raw: unknown): Prisma.AgentMembershipWhereInput {
    if (raw === undefined || raw === null || raw === '') return {};
    if (typeof raw !== 'string') {
      throw scimProblem('validation', 'filter must be a string.', 'invalidFilter');
    }
    const parsed = parseScimFilter(raw, USER_FILTER_ATTRIBUTES);
    if (!parsed.ok) rejectFilter(parsed.reason, USER_FILTER_ATTRIBUTES, 'Users');

    const { attribute, value } = parsed.filter;
    if (attribute === 'active') return { suspended: !(value as boolean) };
    if (attribute === 'externalId') return { scimExternalId: String(value) };
    if (attribute === 'id') {
      return { agentId: UUID_RE.test(String(value)) ? String(value) : NO_MATCH_UUID };
    }
    return { agent: { email: String(value) } };
  }

  function groupFilter(raw: unknown): Prisma.GroupWhereInput {
    if (raw === undefined || raw === null || raw === '') return {};
    if (typeof raw !== 'string') {
      throw scimProblem('validation', 'filter must be a string.', 'invalidFilter');
    }
    const parsed = parseScimFilter(raw, GROUP_FILTER_ATTRIBUTES);
    if (!parsed.ok) rejectFilter(parsed.reason, GROUP_FILTER_ATTRIBUTES, 'Groups');

    const { attribute, value } = parsed.filter;
    if (attribute === 'id') return { id: readBigIntId(String(value)) ?? NO_MATCH_ID };
    return { name: String(value) };
  }

  /**
   * The membership a SCIM id names, or a 404.
   *
   * One reader for all four Users routes, so "does this person exist for this
   * caller?" is answered in exactly one place. Under `withTenant`, a member of
   * another workspace is not visible at all — the row simply is not there — so
   * the cross-tenant answer and the never-existed answer are the same 404
   * without either being special-cased (NFR-S5).
   */
  async function findMember(request: FastifyRequest, rawId: string): Promise<MembershipRow> {
    // A non-uuid id cannot be a member, and saying so before the query keeps
    // Postgres from raising a cast error we would then have to interpret.
    if (!UUID_RE.test(rawId)) throw scimProblem('not_found', 'User not found.');
    const row = await request.withTenant((tx) =>
      tx.agentMembership.findFirst({ where: { agentId: rawId }, select: MEMBERSHIP_SELECT }),
    );
    if (!row) throw scimProblem('not_found', 'User not found.');
    return row;
  }

  // --- Lifecycle semantics (S11-f) -------------------------------------------

  /**
   * What every entry this file writes says about who acted.
   *
   * A provisioning connector is not a person and not one of the workspace's
   * bots, so `plugins/audit.ts` records it as `system` with a null `actor_id`.
   * That is honest and, on its own, useless: a workspace may hold several live
   * SCIM credentials, and "the system suspended Ada" does not tell an owner
   * which integration to go and look at. The token's id closes that gap. It is
   * a reference, not a secret — the secret half of that row exists only as a
   * digest — and `sanitizeAuditMetadata` names the key explicitly for that
   * reason.
   */
  function scimActor(
    principal: ScimPrincipal,
    extra: Record<string, unknown> = {},
  ): Record<string, unknown> {
    return { via: 'scim', scim_token_id: principal.tokenId, ...extra };
  }

  /**
   * Refuse to deactivate the workspace owner.
   *
   * The one lifecycle decision this endpoint takes away from the directory. An
   * owner who cannot sign in is a workspace with no one able to change its
   * billing, its security settings — or this very connector — and a directory
   * arrives at that state by the most ordinary route there is: somebody removes
   * the founder's record from an HR system that was never the source of truth
   * for who runs the workspace. `PUT /agents/{id}/suspension` refuses the same
   * thing for the same reason; this is that rule, not a second one.
   *
   * A 403 rather than the 404 the cross-tenant cases answer: this member is one
   * the token may legitimately read, so hiding them would leave the connector
   * retrying against a resource it can see in its own list.
   */
  function refuseOwnerDeactivation(row: MembershipRow): void {
    if (row.role !== 'owner') return;
    throw scimProblem(
      'authorization',
      'The workspace owner cannot be deactivated over SCIM: an owner who cannot sign in ' +
        'leaves the workspace with nobody able to administer it, including this connector. ' +
        'Transfer ownership first, or make the change as an owner.',
    );
  }

  /**
   * Reconcile the purchased seat count with the headcount this call just grew,
   * and record it if it moved.
   *
   * `billing.subscription_updated` is the existing action for "the shape of this
   * workspace's bill changed", and this *is* that — the fact that no human
   * pressed a button is the reason it is worth recording, not a reason to use a
   * different word for it. The metadata names the field and both figures; the
   * amounts live in the subscription row, as they do for the checkout path.
   */
  async function applySeatEffect(
    tx: TenantClient,
    request: FastifyRequest,
    principal: ScimPrincipal,
  ): Promise<void> {
    const moved = await ensureSeatsCoverHeadcount(tx, request.tenant());
    if (!moved) return;
    await writeAuditEntry(tx, request.auditContext(), {
      action: 'billing.subscription_updated',
      metadata: scimActor(principal, { fields: ['seats'], from: moved.from, to: moved.to }),
    });
  }

  // --- GET /scim/v2/Users ----------------------------------------------------

  app.get('/scim/v2/Users', scimRoute, async (request, reply) => {
    principalOf(request);
    const page = readPage(request.query);
    const where = userFilter((request.query as { filter?: unknown } | undefined)?.filter);

    const { total, rows } = await request.withTenant(async (tx) => ({
      total: await tx.agentMembership.count({ where }),
      // `count=0` is a legitimate "how many are there?" probe (RFC 7644
      // §3.4.2.4) — answer it without reading anybody.
      rows:
        page.count === 0
          ? []
          : await tx.agentMembership.findMany({
              where,
              select: MEMBERSHIP_SELECT,
              // Stable across pages: `createdAt` alone repeats for members added
              // in one transaction (a seed, a bulk import), and a sync paging
              // through an unstable order silently skips people.
              orderBy: [{ createdAt: 'asc' }, { agentId: 'asc' }],
              skip: page.startIndex - 1,
              take: page.count,
            }),
    }));

    return scimReply(
      reply,
      200,
      scimListResponse({
        totalResults: total,
        startIndex: page.startIndex,
        resources: rows.map((row) => serialiseScimUser(toUserSource(row), baseUrl)),
      }),
    );
  });

  // --- GET /scim/v2/Users/:userId --------------------------------------------

  app.get<{ Params: { userId: string } }>(
    '/scim/v2/Users/:userId',
    scimRoute,
    async (request, reply) => {
      const row = await findMember(request, request.params.userId);
      return scimReply(reply, 200, serialiseScimUser(toUserSource(row), baseUrl));
    },
  );

  // --- POST /scim/v2/Users ---------------------------------------------------

  app.post('/scim/v2/Users', scimRoute, async (request, reply) => {
    const principal = principalOf(request);
    const parsed = readScimCreateUser(request.body);
    if (!parsed.ok) throw scimProblem('validation', parsed.detail, parsed.scimType);
    const { user } = parsed;

    // The account may already exist in another workspace, where this tenant
    // context cannot see it (`accounts` visibility is derived from shared
    // membership). A SECURITY DEFINER resolver settles find-or-create and the
    // duplicate-membership question in one statement — see the migration. The
    // licence it writes into is the principal's, never anything in the body.
    let provisioned: { account_id: string; membership_created: boolean } | undefined;
    try {
      [provisioned] = await app.db.$queryRaw<
        Array<{ account_id: string; account_created: boolean; membership_created: boolean }>
      >`SELECT * FROM scim_provision_member(
          ${principal.licenseId}, ${user.userName}::citext, ${user.displayName},
          ${SCIM_ROLE}, ${user.externalId}, ${user.active})`;
    } catch (error) {
      // The only unique index this insert can trip is `(license_id,
      // scim_external_id)`: another member of this workspace already carries the
      // id the directory just sent.
      if (isUniqueViolation(error)) {
        throw scimProblem(
          'account_exists',
          'Another member of this workspace already has that externalId.',
          'uniqueness',
        );
      }
      throw error;
    }

    if (!provisioned || !provisioned.membership_created) {
      // RFC 7644 §3.3: a create whose userName is taken is 409 `uniqueness`, and
      // the connector's next move is to look the existing resource up and patch
      // it. Telling it the truth is what makes that recovery possible.
      throw scimProblem(
        'account_exists',
        'A user with that userName already exists in this workspace.',
        'uniqueness',
      );
    }

    // Reading the new membership back, recording it and reconciling the seat
    // count are one transaction: a workspace whose headcount grew without its
    // bill following, or without a line in the trail saying who did it, is
    // exactly the divergence this sub-task exists to close.
    const row = await request.withTenant(async (tx) => {
      const created = await tx.agentMembership.findFirst({
        where: { agentId: provisioned.account_id },
        select: MEMBERSHIP_SELECT,
      });
      // A statement ago a SECURITY DEFINER function reported writing this row
      // for this licence. Not finding it is not "no such user" — it is this
      // process disagreeing with the database about what it just did.
      if (!created) throw ApiError.internal('The provisioned membership could not be read back.');

      await writeAuditEntry(tx, request.auditContext(), {
        action: 'member.invited',
        // The invitation path targets the invitation row it created; there is
        // none here — a directory does not ask, it states — so the entry names
        // the person, which is what a reader is looking for either way.
        target: `account:${created.agentId}`,
        metadata: scimActor(principal, { role: created.role, active: !created.suspended }),
      });

      // A member created `active: false` is suspended from the first moment and
      // occupies no seat, so this is a no-op for them by construction rather
      // than by a special case.
      await applySeatEffect(tx, request, principal);
      return created;
    });

    reply.header('Location', `${baseUrl}/Users/${provisioned.account_id}`);
    return scimReply(reply, 201, serialiseScimUser(toUserSource(row), baseUrl));
  });

  // --- PATCH /scim/v2/Users/:userId ------------------------------------------

  app.patch<{ Params: { userId: string } }>(
    '/scim/v2/Users/:userId',
    scimRoute,
    async (request, reply) => {
      const principal = principalOf(request);
      const existing = await findMember(request, request.params.userId);

      const parsed = readScimPatch(request.body);
      if (!parsed.ok) throw scimProblem('validation', parsed.detail, parsed.scimType);
      const { changes, assertedUserNames } = parsed.patch;

      // A rename attempt is refused rather than dropped. See the file header:
      // the address is the sign-in identifier, and letting a connector believe it
      // moved one when it did not is a divergence with consequences. Repeating
      // the *current* address — which is what a full-profile sync does every
      // night — is not a rename and passes.
      const rename = assertedUserNames.find(
        (name) => name.toLowerCase() !== existing.agent.email.toLowerCase(),
      );
      if (rename !== undefined) {
        throw scimProblem(
          'validation',
          'userName is not writable over SCIM: the address identifies a person across every ' +
            "workspace they belong to, so it is changed by that person, not by one workspace's " +
            'directory.',
          'mutability',
        );
      }

      if (changes.active === undefined && changes.externalId === undefined) {
        // Nothing this server owns was named. Answering with the resource is the
        // honest result — the client sees exactly what is stored.
        return scimReply(reply, 200, serialiseScimUser(toUserSource(existing), baseUrl));
      }

      // Checked before anything is written, and only against a *de*activation:
      // an operation that reinstates the owner asks for a state they are always
      // already in, and refusing it would fail the nightly full-profile sync
      // that merely restates the truth about everybody.
      if (changes.active === false) refuseOwnerDeactivation(existing);

      try {
        const updated = await request.withTenant(async (tx) => {
          if (changes.externalId !== undefined) {
            await tx.agentMembership.update({
              // Keyed by the composite primary key *and* run under RLS, so it
              // cannot touch a row outside the licence even if a policy were
              // one day misconfigured.
              where: {
                licenseId_agentId: { licenseId: principal.licenseId, agentId: existing.agentId },
              },
              data: { scimExternalId: changes.externalId },
            });
          }

          if (changes.active !== undefined) {
            // The shared effect, not a second implementation of it — see the
            // file header. It also owns the "already in that state" case, which
            // is what keeps a nightly reconciliation from writing an audit
            // entry per member per night.
            const changed = await setMembershipSuspension(
              tx,
              request.auditContext(),
              existing,
              !changes.active,
              { metadata: scimActor(principal) },
            );
            // Only a reinstatement can grow the headcount. A suspension shrinks
            // it and deliberately leaves the purchased count alone.
            if (changed && changes.active) await applySeatEffect(tx, request, principal);
          }

          return tx.agentMembership.findFirstOrThrow({
            where: { agentId: existing.agentId },
            select: MEMBERSHIP_SELECT,
          });
        });
        return scimReply(reply, 200, serialiseScimUser(toUserSource(updated), baseUrl));
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw scimProblem(
            'account_exists',
            'Another member of this workspace already has that externalId.',
            'uniqueness',
          );
        }
        throw error;
      }
    },
  );

  // --- DELETE /scim/v2/Users/:userId -----------------------------------------

  app.delete<{ Params: { userId: string } }>(
    '/scim/v2/Users/:userId',
    scimRoute,
    async (request, reply) => {
      const principal = principalOf(request);
      const existing = await findMember(request, request.params.userId);

      // Deprovisioning suspends the membership; it does not delete the person.
      //
      // `agent_memberships` is referenced by chats, tickets, presence history and
      // the audit trail, so removing the row would either cascade a workspace's
      // conversation history away or fail on a foreign key — and a directory
      // saying "this employee has left" is not a request to erase what they did.
      // Suspension is already this product's phrase for "may no longer sign in or
      // be routed work" (`auth_list_memberships` filters it out), so a leaver
      // stops being able to reach the workspace the moment this returns.
      //
      // Which is to say: a deprovision is a deactivation with a different verb
      // in front of it, so it runs the same code, refuses on the same owner, and
      // leaves the same `member.suspended` entry. What it deliberately does not
      // do — release the seat, reassign open chats, hunt down live tokens — is
      // reasoned about in the file header.
      refuseOwnerDeactivation(existing);

      await request.withTenant((tx) =>
        setMembershipSuspension(tx, request.auditContext(), existing, true, {
          metadata: scimActor(principal),
        }),
      );

      // 204, and repeating it is not an error: a connector retrying after a
      // timeout must converge, not alarm. The second call finds the membership
      // already suspended, writes nothing, and answers the same.
      return reply.status(204).send();
    },
  );

  // --- GET /scim/v2/Groups ---------------------------------------------------
  //
  // Read-only, by decision (PLAN §6.1 assumptions): a directory may see which
  // teams exist and who is in them, but team membership drives chat routing in
  // this product, so letting an external system rewrite the routing topology is a
  // much larger claim than "keep the user list in step". Group-to-role mapping is
  // out of scope for the same reason and needs its own record.

  app.get('/scim/v2/Groups', scimRoute, async (request, reply) => {
    principalOf(request);
    const page = readPage(request.query);
    const where = groupFilter((request.query as { filter?: unknown } | undefined)?.filter);

    const { total, rows } = await request.withTenant(async (tx) => ({
      total: await tx.group.count({ where }),
      rows:
        page.count === 0
          ? []
          : await tx.group.findMany({
              where,
              select: GROUP_SELECT,
              orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
              skip: page.startIndex - 1,
              take: page.count,
            }),
    }));

    return scimReply(
      reply,
      200,
      scimListResponse({
        totalResults: total,
        startIndex: page.startIndex,
        resources: rows.map((row) => serialiseScimGroup(toGroupSource(row), baseUrl)),
      }),
    );
  });

  app.get<{ Params: { groupId: string } }>(
    '/scim/v2/Groups/:groupId',
    scimRoute,
    async (request, reply) => {
      principalOf(request);
      const id = readBigIntId(request.params.groupId);
      const row =
        id === null
          ? null
          : await request.withTenant((tx) =>
              tx.group.findFirst({ where: { id }, select: GROUP_SELECT }),
            );
      if (!row) throw scimProblem('not_found', 'Group not found.');
      return scimReply(reply, 200, serialiseScimGroup(toGroupSource(row), baseUrl));
    },
  );
}
