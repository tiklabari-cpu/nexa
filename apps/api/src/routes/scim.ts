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
 * ## What this file does not decide
 *
 * The *meaning* of the lifecycle operations — what suspending somebody does to
 * their seat count, which audit entries a provisioning run leaves, how far a
 * deprovision goes — is S11-f. What is here is the protocol and the boundary:
 * the endpoints exist, they speak SCIM, they are authenticated, and they cannot
 * reach out of their workspace.
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
  agentId: true,
  suspended: true,
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
  agentId: string;
  suspended: boolean;
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

    const row = await findMember(request, provisioned.account_id);
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

      try {
        const updated = await request.withTenant((tx) =>
          tx.agentMembership.update({
            // Keyed by the composite primary key *and* run under RLS, so it
            // cannot touch a row outside the licence even if a policy were
            // one day misconfigured.
            where: {
              licenseId_agentId: { licenseId: principal.licenseId, agentId: existing.agentId },
            },
            data: {
              ...(changes.active === undefined ? {} : { suspended: !changes.active }),
              ...(changes.externalId === undefined ? {} : { scimExternalId: changes.externalId }),
            },
            select: MEMBERSHIP_SELECT,
          }),
        );
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
      // How much further a deprovision should go — releasing the seat,
      // reassigning open chats, revoking live tokens — is S11-f.
      await request.withTenant((tx) =>
        tx.agentMembership.updateMany({
          where: { licenseId: principal.licenseId, agentId: existing.agentId, suspended: false },
          data: { suspended: true },
        }),
      );

      // 204, and repeating it is not an error: a connector retrying after a
      // timeout must converge, not alarm.
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
