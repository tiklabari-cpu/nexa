/**
 * What it *means* to create, rename, delete or staff a team — in one place,
 * because there are now two callers (FR-MOD-04.5 · NFR-S11 · M-TEAM-e).
 *
 * `POST/PATCH/DELETE /groups` and `PUT/DELETE /groups/{id}/agents/{id}` are an
 * admin arranging their workspace from the console; `POST/PUT/PATCH/DELETE
 * /scim/v2/Groups` is a directory connector pushing the same arrangement from an
 * identity provider. They differ entirely in who may ask, in how the request is
 * spelled and in how a refusal is rendered — and not at all in what has to
 * happen to the database afterwards.
 *
 * That "not at all" is why this file exists rather than a second implementation
 * inside `routes/scim.ts`. Team membership is access control here:
 * `chat_access.group_id` is what makes a conversation visible to an agent
 * (`services/chat/access.ts`), and `routing_rules.target_group_id` is what sends
 * one to a team in the first place (ADR-08 step 2). **Neither column carries a
 * foreign key**, so the database will not stop a delete that strands them — the
 * two refusals in `deleteGroup` are the only thing that does. A provisioning
 * path carrying its own copy of that code is a path where one of the two checks
 * is missing, and it would be the unattended path that missed it.
 *
 * ## What stays with the caller
 *
 * Everything about *whether the asker may*, and everything about *how a refusal
 * is spelled*. The console route brings `groups--all:rw` and ADR-06 errors; the
 * SCIM route brings a provisioning credential, the `sso` entitlement and RFC
 * 7644's envelope. Neither generalises to the other, and folding them together
 * here would produce a function whose refusals nobody could predict from the
 * call site.
 *
 * The one rule this file does keep is the one that is about the workspace rather
 * than the asker: every query runs on the `tx` the caller opened with
 * `withTenant`, so row-level security — not a `licenseId` in a where-clause — is
 * what makes another workspace's team unreachable. The composite keys name the
 * licence as well, so even a misconfigured policy could not widen them.
 *
 * ## Audit entries are written only when something moved
 *
 * A directory reconciliation restates the whole workspace every night. If a
 * restatement wrote `group.member_set` per member per night, the trail would
 * grow without recording a single change and the entries that *are* changes
 * would be unfindable among them. So each writer below reports whether it
 * changed anything and only then appends — the rule `setMembershipSuspension`
 * already holds to, for the same reason and against the same caller.
 *
 * ## Who may be on a team (AU-01 · K14 · ADR-08a §2.6 · tm 305.3)
 *
 * A team that requires areas of expertise (`group_expertise`) takes only a
 * member who holds every one of them. Routing gives nobody else its
 * conversations (`routing-service.ts`, the defence at selection), so admitting
 * them would be the silent grant `workspaceMemberIds` refuses — a person on the
 * team's screen who never gets its work. The check is at joining; a team that
 * grows its requirement later, or an agent who loses an area, narrows routing
 * and nothing else.
 *
 * The Responsible Gambling team (`topic_role = 'responsible_gambling'`) is the
 * exception, because there membership itself is the rule: only trained agents
 * are on it (K14), and the conversations it can see are the ones a player
 * asked for help with. So for that team the rule holds at all times — every
 * write that would leave a member short of its requirement is refused
 * ({@link assertKeepsTeamTraining} for an agent's own areas) — and the team
 * itself is fixed: never deleted, never without its role, never without a
 * requirement ({@link assertExpertiseRemovable} for the catalogue). Its name
 * is the one thing that changes.
 *
 * Those writes are spread over five endpoints and two tables, and a check that
 * reads one table while another transaction writes the other passes for both.
 * So each of them first takes {@link lockTeamStaffing} — one advisory lock per
 * workspace — and reads after it. Admin writes, rare, and short.
 */
import { Prisma } from '@prisma/client';
import {
  RESPONSIBLE_GAMBLING_ROLE,
  assignmentModeAllowed,
  type AfterHoursMode,
  type GroupAssignmentMode,
  type GroupPriority,
  type QueueTopicRole,
} from '@siyahtus/types';
import { ApiError } from '../../lib/api-error.js';
import type { TenantClient } from '../../lib/tenant.js';
import { writeAuditEntry, type AuditContext } from '../audit/audit-log.js';

/**
 * The team as the console serialises it. SCIM reads its own projection
 * afterwards — it needs the members' display names, which routing does not.
 */
export interface GroupWithAgents {
  id: bigint;
  name: string;
  languageCode: string;
  topicRole: string | null;
  afterHoursMode: string;
  assignmentMode: string;
  requiredExpertise: Array<{ expertiseId: bigint }>;
  agents: Array<{ agentId: string; priority: string; isLead: boolean }>;
}

/**
 * How many members of each team are accepting chats right now — not
 * suspended, not awaiting approval — whatever their load (`Group.
 * accepting_count`, IN-04: "Finance · 2 online"). A team with nobody reads 0.
 */
export async function acceptingCounts(
  tx: TenantClient,
  licenseId: bigint,
  groupIds: readonly bigint[],
): Promise<Map<bigint, number>> {
  if (groupIds.length === 0) return new Map();
  const rows = await tx.$queryRaw<Array<{ group_id: bigint; accepting: number }>>`
    SELECT ga.group_id, COUNT(*)::int AS accepting
    FROM group_agents ga
    JOIN agent_memberships m ON m.license_id = ga.license_id AND m.agent_id = ga.agent_id
    WHERE ga.license_id = ${licenseId}
      AND ga.group_id IN (${Prisma.join([...groupIds])})
      AND m.routing_status = 'accepting_chats'
      AND NOT m.suspended
      AND NOT m.awaiting_approval
    GROUP BY ga.group_id
  `;
  return new Map(rows.map((row) => [row.group_id, row.accepting]));
}

/** What a read of a team includes, so every reader serialises the same shape. */
export const GROUP_INCLUDE = {
  agents: { select: { agentId: true, priority: true, isLead: true } },
  requiredExpertise: { select: { expertiseId: true }, orderBy: { expertiseId: 'asc' } },
} as const;

/**
 * A team's queue settings (AU-01 · ADR-08a · tm 305.1), as a writer names
 * them. Each is optional and an omitted one is left alone — on create that
 * means no role, `queue` and no requirement. `topicRole: null` clears the role;
 * `requiredExpertiseIds` is the complete set, `[]` clearing it.
 *
 * Only the console names these. A directory connector has no attribute for
 * any of them, so a nightly SCIM restatement leaves a team's queue as an admin
 * set it — the reason `setGroupMember` leaves a tier alone when none is named.
 */
export interface GroupQueueSettings {
  topicRole?: QueueTopicRole | null;
  afterHoursMode?: AfterHoursMode;
  assignmentMode?: GroupAssignmentMode;
  requiredExpertiseIds?: readonly bigint[];
}

/**
 * Refuse a team that would be the Responsible Gambling team in manual mode
 * (WG-07 decision 1): its conversations are taken without waiting for someone
 * to choose them. A 400 — the body asks for a combination the product does not
 * have — naming what refused it, whichever of the two fields moved. The CHECK
 * `groups_rg_assignment_mode_check` holds the same rule under the API.
 */
function assertAssignmentModeAllowed(topicRole: string | null, mode: string): void {
  if (assignmentModeAllowed(topicRole, mode as GroupAssignmentMode)) return;
  throw ApiError.validation(
    'The responsible gambling team cannot use manual assignment: its conversations must be taken without waiting.',
    { reason: 'assignment_mode', topic_role: RESPONSIBLE_GAMBLING_ROLE },
  );
}

function topicRoleTaken(role: string, holderId?: bigint): ApiError {
  return new ApiError(
    'group_topic_role_taken',
    'Another team already handles this topic. Clear it there first.',
    {
      details: {
        topic_role: role,
        ...(holderId !== undefined ? { group_id: Number(holderId) } : {}),
      },
    },
  );
}

/**
 * Refuse a topic role another team of this workspace holds (K14: the role is
 * what a hand-over resolves, so it must name one team). Asked before the write
 * so the refusal can name the holder; the partial unique index
 * `groups_license_id_topic_role_key` still decides a race between two writers,
 * and {@link writeTopicRole} turns its violation into the same refusal.
 */
async function assertTopicRoleFree(
  tx: TenantClient,
  role: QueueTopicRole,
  exceptGroupId?: bigint,
): Promise<void> {
  const holder = await tx.group.findFirst({
    where: {
      topicRole: role,
      ...(exceptGroupId !== undefined ? { id: { not: exceptGroupId } } : {}),
    },
    select: { id: true },
  });
  if (holder) throw topicRoleTaken(role, holder.id);
}

/**
 * Run a `groups` write that may set a topic role. A unique violation there can
 * only be the role index — the key is a sequence — and arrives when another
 * writer took the role between the check and this write.
 */
async function writeTopicRole<T>(
  role: string | null | undefined,
  write: () => Promise<T>,
): Promise<T> {
  try {
    return await write();
  } catch (error) {
    if (role && error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw topicRoleTaken(role);
    }
    throw error;
  }
}

/** Ids once each, ascending — the order the team reads them back in. */
function distinctIds(ids: readonly bigint[]): bigint[] {
  return [...new Set(ids.map(String))].map(BigInt).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

function sameIds(a: readonly bigint[], b: readonly bigint[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

/**
 * Every id names an expertise area on this licence, or a 404. RLS scopes the
 * lookup, so another workspace's area is not found — the answer an invented id
 * gets, which keeps ids un-enumerable (NFR-S5), as `PUT /agents/{id}/expertise`
 * and a routing rule's `expertise_ids` answer.
 */
async function assertExpertiseExists(tx: TenantClient, ids: readonly bigint[]): Promise<void> {
  if (ids.length === 0) return;
  const found = await tx.expertise.count({ where: { id: { in: [...ids] } } });
  if (found !== ids.length) throw ApiError.notFound('One or more expertise areas were not found.');
}

/** Make the team's requirement exactly `ids` — cleared, then laid down. */
async function replaceRequiredExpertise(
  tx: TenantClient,
  licenseId: bigint,
  groupId: bigint,
  ids: readonly bigint[],
): Promise<void> {
  await tx.groupExpertise.deleteMany({ where: { groupId } });
  if (ids.length > 0) {
    await tx.groupExpertise.createMany({
      data: ids.map((expertiseId) => ({ licenseId, groupId, expertiseId })),
    });
  }
}

/**
 * Serialise, within one workspace, the writes that decide who may be on a team
 * (see the header): a membership added, a team's role or requirement changed,
 * an agent's areas replaced, an area or a team deleted. Held to the end of the
 * caller's transaction; taken before the write's own reads, so what it checks
 * is what the last of them committed. Re-entrant, so a SCIM replacement that
 * adds several members takes it once in effect.
 */
export async function lockTeamStaffing(tx: TenantClient, licenseId: bigint): Promise<void> {
  await tx.$executeRaw`
    SELECT pg_advisory_xact_lock(hashtext('siyahtus.team-staffing'), hashtext(${String(licenseId)}))`;
}

type ProtectedReason = 'delete' | 'topic_role' | 'required_expertise';

const PROTECTED_MESSAGES: Readonly<Record<ProtectedReason, string>> = {
  delete: 'The responsible gambling team cannot be deleted. Rename it instead.',
  topic_role: 'The responsible gambling team keeps its topic. Rename it instead.',
  required_expertise:
    'The responsible gambling team must require its training: at least one area of expertise.',
};

/** The Responsible Gambling team's refusal (K14 · ADR-08a §2.6). */
function protectedTeam(reason: ProtectedReason, groupId?: bigint): ApiError {
  return new ApiError('group_protected', PROTECTED_MESSAGES[reason], {
    details: {
      reason,
      topic_role: RESPONSIBLE_GAMBLING_ROLE,
      ...(groupId !== undefined ? { group_id: Number(groupId) } : {}),
    },
  });
}

/**
 * Of `agentIds`, each one short of `expertiseIds`, with the areas they lack in
 * the order given. RLS scopes the read, so an area held in another workspace
 * is not held here.
 */
async function shortOfExpertise(
  tx: TenantClient,
  agentIds: readonly string[],
  expertiseIds: readonly bigint[],
): Promise<Map<string, bigint[]>> {
  const short = new Map<string, bigint[]>();
  if (agentIds.length === 0 || expertiseIds.length === 0) return short;
  const held = await tx.agentExpertise.findMany({
    where: { agentId: { in: [...agentIds] }, expertiseId: { in: [...expertiseIds] } },
    select: { agentId: true, expertiseId: true },
  });
  const has = new Set(held.map((row) => `${row.agentId}:${row.expertiseId}`));
  for (const agentId of agentIds) {
    const missing = expertiseIds.filter((id) => !has.has(`${agentId}:${id}`));
    if (missing.length > 0) short.set(agentId, missing);
  }
  return short;
}

/**
 * The Responsible Gambling team's members all hold `required` — asked when the
 * team gets the role or its requirement changes. Names every member short of
 * it, so the admin sees the whole list at once rather than one per attempt.
 */
async function assertMembersHold(
  tx: TenantClient,
  groupId: bigint,
  agentIds: readonly string[],
  required: readonly bigint[],
): Promise<void> {
  const short = await shortOfExpertise(tx, agentIds, required);
  if (short.size === 0) return;
  throw new ApiError(
    'group_expertise_missing',
    'Some members of the responsible gambling team do not hold the expertise it requires. Add it to them, or take them off the team first.',
    {
      details: {
        group_id: Number(groupId),
        agent_ids: [...short.keys()].sort(),
        expertise_ids: [...new Set([...short.values()].flat().map(String))]
          .map(BigInt)
          .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
          .map(Number),
      },
    },
  );
}

/**
 * An agent's areas are about to become `nextExpertiseIds` (`PUT
 * /agents/{id}/expertise`, a complete set): refuse it when it drops an area the
 * Responsible Gambling team requires while they are on that team. Only what
 * this write removes is refused — an area they never held is the requirement
 * check's business, not this one's. Takes {@link lockTeamStaffing}.
 */
export async function assertKeepsTeamTraining(
  tx: TenantClient,
  licenseId: bigint,
  agentId: string,
  nextExpertiseIds: readonly bigint[],
): Promise<void> {
  await lockTeamStaffing(tx, licenseId);
  const team = await tx.group.findFirst({
    where: { licenseId, topicRole: RESPONSIBLE_GAMBLING_ROLE, agents: { some: { agentId } } },
    select: { id: true, requiredExpertise: { select: { expertiseId: true } } },
  });
  if (!team) return;

  const next = new Set(nextExpertiseIds.map(String));
  const required = team.requiredExpertise.map((row) => row.expertiseId);
  const held = await tx.agentExpertise.findMany({
    where: { agentId, expertiseId: { in: required } },
    select: { expertiseId: true },
  });
  const dropped = held
    .map((row) => row.expertiseId)
    .filter((id) => !next.has(String(id)))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  if (dropped.length === 0) return;

  throw new ApiError(
    'group_expertise_missing',
    'This agent is on the responsible gambling team, which requires this expertise. Take them off the team first.',
    {
      details: { group_id: Number(team.id), agent_id: agentId, expertise_ids: dropped.map(Number) },
    },
  );
}

/**
 * An area of expertise is about to be deleted (`DELETE
 * /settings/expertise/{id}`), which cascades it out of every requirement: refuse
 * it when it is the last one the Responsible Gambling team requires. Another
 * team, or the Responsible Gambling team with a second area left, loses it the
 * way the agents do — its members still hold what remains. Takes
 * {@link lockTeamStaffing}.
 */
export async function assertExpertiseRemovable(
  tx: TenantClient,
  licenseId: bigint,
  expertiseId: bigint,
): Promise<void> {
  await lockTeamStaffing(tx, licenseId);
  const team = await tx.group.findFirst({
    where: { licenseId, topicRole: RESPONSIBLE_GAMBLING_ROLE },
    select: { id: true, requiredExpertise: { select: { expertiseId: true } } },
  });
  if (!team) return;
  const remaining = team.requiredExpertise.filter((row) => row.expertiseId !== expertiseId);
  if (remaining.length === 0 && team.requiredExpertise.length > 0) {
    throw protectedTeam('required_expertise', team.id);
  }
}

/** The fields every `group.created` / `group.updated` entry records. */
function groupAuditFields(group: GroupWithAgents): Record<string, unknown> {
  return {
    name: group.name,
    language_code: group.languageCode,
    topic_role: group.topicRole,
    after_hours_mode: group.afterHoursMode,
    assignment_mode: group.assignmentMode,
    required_expertise_ids: group.requiredExpertise.map((row) => Number(row.expertiseId)),
  };
}

/**
 * The tier a membership gets when nobody names one. `primary` is the PRD's
 * "Primary agent önceliği"; `normal` is the column default and what a directory
 * — which has no notion of a routing preference — provisions into.
 */
export const DEFAULT_GROUP_PRIORITY: GroupPriority = 'normal';

export interface AuditOptions {
  /**
   * Merged into every entry this call writes. SCIM uses it to name the
   * credential that ordered the change (`via: 'scim'` plus the token id); the
   * console route has an `actor_id` and needs nothing.
   */
  metadata?: Record<string, unknown>;
}

/**
 * The largest value `groups.id` (a `BIGSERIAL`, PRD §8.4) can hold. Past it
 * there is no row to find, and the query would reach Postgres as a range error
 * rather than as a lookup that found nothing.
 */
const MAX_GROUP_ID = 9223372036854775807n;

/**
 * A group id as it arrives from a client, or null when it cannot name a team.
 *
 * Shared by both callers because getting it wrong is not a cosmetic difference.
 * Decimal digits only: `BigInt('0x10')` is 16, so a bare `BigInt()` would let
 * `/groups/0x10` quietly rename team 16 — which is what it did until tm 175.1
 * measured it. The upper bound is the other half: nineteen digits fit the
 * pattern but not the column, and an out-of-range bigint is a 500 rather than a
 * 404.
 *
 * Null rather than a thrown error, because the two callers spell the refusal
 * differently and one of them (`?filter=id eq "…"`) does not refuse at all — it
 * filters on a value no row can hold, so an unparseable id answers zero results
 * in the same shape as a real one that matched nobody (NFR-S5).
 */
export function parseGroupId(raw: string): bigint | null {
  if (!/^\d{1,19}$/.test(raw)) return null;
  const id = BigInt(raw);
  if (id <= 0n || id > MAX_GROUP_ID) return null;
  return id;
}

/**
 * The team a caller named, or a 404.
 *
 * Read inside the caller's tenant, so a team of another workspace is not
 * "forbidden" — it is not there, and the answer is the one an id that never
 * existed gets (NFR-S5).
 */
export async function loadGroup(
  tx: TenantClient,
  groupId: bigint,
): Promise<{ id: bigint; name: string }> {
  const group = await tx.group.findFirst({
    where: { id: groupId },
    select: { id: true, name: true },
  });
  if (!group) throw new ApiError('group_not_found', 'Team not found.');
  return group;
}

/**
 * The team with its membership, for a caller that has already established the
 * team exists. Throws rather than answering null: at this point a missing row is
 * this process disagreeing with the transaction it is inside.
 */
export async function readGroup(
  tx: TenantClient,
  licenseId: bigint,
  groupId: bigint,
): Promise<GroupWithAgents> {
  return tx.group.findUniqueOrThrow({
    where: { licenseId_id: { licenseId, id: groupId } },
    include: GROUP_INCLUDE,
  });
}

/**
 * Which of `agentIds` actually belong to this workspace.
 *
 * A `group_agents` row for somebody who is not a member matches nobody in
 * routing (`routing-service.ts` joins through `agent_memberships`), so it is a
 * grant that silently does nothing — the worst shape an access-control row can
 * take, because every screen will show the person on the team. RLS scopes the
 * lookup; what to *say* about the ids that came back missing is the caller's,
 * because the two callers say different things (a 404 naming the agent, or a 400
 * naming the offending value in a SCIM body).
 */
export async function workspaceMemberIds(
  tx: TenantClient,
  agentIds: readonly string[],
): Promise<Set<string>> {
  if (agentIds.length === 0) return new Set();
  const rows = await tx.agentMembership.findMany({
    where: { agentId: { in: [...new Set(agentIds)] } },
    select: { agentId: true },
  });
  return new Set(rows.map((row) => row.agentId));
}

export async function createGroup(
  tx: TenantClient,
  audit: AuditContext,
  licenseId: bigint,
  input: { name: string; languageCode?: string } & GroupQueueSettings,
  options: AuditOptions = {},
): Promise<GroupWithAgents> {
  const expertiseIds = distinctIds(input.requiredExpertiseIds ?? []);
  // The Responsible Gambling team is made with its training (K14): a team
  // whose requirement is empty would count everyone as trained.
  if (input.topicRole === RESPONSIBLE_GAMBLING_ROLE) {
    await lockTeamStaffing(tx, licenseId);
    if (expertiseIds.length === 0) throw protectedTeam('required_expertise');
  }
  assertAssignmentModeAllowed(input.topicRole ?? null, input.assignmentMode ?? 'auto');
  if (input.topicRole) await assertTopicRoleFree(tx, input.topicRole);
  await assertExpertiseExists(tx, expertiseIds);

  const { id } = await writeTopicRole(input.topicRole, () =>
    tx.group.create({
      data: {
        licenseId,
        name: input.name,
        ...(input.languageCode !== undefined ? { languageCode: input.languageCode } : {}),
        ...(input.topicRole ? { topicRole: input.topicRole } : {}),
        ...(input.afterHoursMode !== undefined ? { afterHoursMode: input.afterHoursMode } : {}),
        ...(input.assignmentMode !== undefined ? { assignmentMode: input.assignmentMode } : {}),
      },
      select: { id: true },
    }),
  );
  await replaceRequiredExpertise(tx, licenseId, id, expertiseIds);
  const created = await readGroup(tx, licenseId, id);

  await writeAuditEntry(tx, audit, {
    action: 'group.created',
    target: `group:${created.id}`,
    metadata: { ...options.metadata, ...groupAuditFields(created) },
  });
  return created;
}

/**
 * Rename a team, change the language it routes for, or its queue settings.
 *
 * The entry is written only when a field actually moved. A nightly `PUT
 * /scim/v2/Groups/{id}` restates the name it read an hour ago; recording that as
 * a change would bury the rename somebody actually made. The same holds for a
 * requirement restated in another order: the set is compared, not the list.
 *
 * The Responsible Gambling team is renamed only (K14 · ADR-08a §2.6): its role
 * stays, its requirement never empties, and it never requires more than every
 * member holds — nor does a team take the role while a member lacks its
 * requirement.
 */
export async function updateGroup(
  tx: TenantClient,
  audit: AuditContext,
  licenseId: bigint,
  groupId: bigint,
  input: { name?: string; languageCode?: string } & GroupQueueSettings,
  options: AuditOptions = {},
): Promise<GroupWithAgents> {
  if (input.topicRole !== undefined || input.requiredExpertiseIds !== undefined) {
    await lockTeamStaffing(tx, licenseId);
  }
  const before = await readGroup(tx, licenseId, groupId);
  const roleMoved = input.topicRole !== undefined && input.topicRole !== before.topicRole;
  const fieldsMoved =
    (input.name !== undefined && input.name !== before.name) ||
    (input.languageCode !== undefined && input.languageCode !== before.languageCode) ||
    roleMoved ||
    (input.afterHoursMode !== undefined && input.afterHoursMode !== before.afterHoursMode) ||
    (input.assignmentMode !== undefined && input.assignmentMode !== before.assignmentMode);
  const wantedExpertise =
    input.requiredExpertiseIds !== undefined ? distinctIds(input.requiredExpertiseIds) : null;
  const expertiseMoved =
    wantedExpertise !== null &&
    !sameIds(
      wantedExpertise,
      before.requiredExpertise.map((row) => row.expertiseId),
    );
  if (!fieldsMoved && !expertiseMoved) return before;

  const required =
    wantedExpertise !== null && expertiseMoved
      ? wantedExpertise
      : before.requiredExpertise.map((row) => row.expertiseId);
  const responsibleGambling =
    (roleMoved ? input.topicRole : before.topicRole) === RESPONSIBLE_GAMBLING_ROLE;
  if (roleMoved && before.topicRole === RESPONSIBLE_GAMBLING_ROLE) {
    throw protectedTeam('topic_role', groupId);
  }
  if (responsibleGambling && required.length === 0) {
    throw protectedTeam('required_expertise', groupId);
  }
  assertAssignmentModeAllowed(
    roleMoved ? (input.topicRole ?? null) : before.topicRole,
    input.assignmentMode ?? before.assignmentMode,
  );

  if (roleMoved && input.topicRole) await assertTopicRoleFree(tx, input.topicRole, groupId);
  if (wantedExpertise !== null && expertiseMoved) {
    await assertExpertiseExists(tx, wantedExpertise);
  }
  if (responsibleGambling && (roleMoved || expertiseMoved)) {
    await assertMembersHold(
      tx,
      groupId,
      before.agents.map((member) => member.agentId),
      required,
    );
  }

  if (fieldsMoved) {
    await writeTopicRole(roleMoved ? input.topicRole : null, () =>
      tx.group.update({
        where: { licenseId_id: { licenseId, id: groupId } },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.languageCode !== undefined ? { languageCode: input.languageCode } : {}),
          ...(input.topicRole !== undefined ? { topicRole: input.topicRole } : {}),
          ...(input.afterHoursMode !== undefined ? { afterHoursMode: input.afterHoursMode } : {}),
          ...(input.assignmentMode !== undefined ? { assignmentMode: input.assignmentMode } : {}),
        },
        select: { id: true },
      }),
    );
  }
  if (wantedExpertise !== null && expertiseMoved) {
    await replaceRequiredExpertise(tx, licenseId, groupId, wantedExpertise);
  }
  const updated = await readGroup(tx, licenseId, groupId);

  await writeAuditEntry(tx, audit, {
    action: 'group.updated',
    target: `group:${groupId}`,
    metadata: { ...options.metadata, ...groupAuditFields(updated) },
  });
  return updated;
}

/**
 * Delete a team, unless something still depends on it.
 *
 * Neither `routing_rules.target_group_id` nor `chat_access.group_id` carries a
 * foreign key, so the database will not stop a delete that strands them — these
 * two checks are the only thing that does.
 *
 * A rule pointing at a deleted team routes nothing and says nothing; a live chat
 * reachable only through it becomes invisible to every agent at once. Both are
 * refusals rather than cascades: which team should inherit the work is an
 * operator's decision, not a default — and least of all a default taken
 * unattended by a directory sync at three in the morning.
 *
 * The Responsible Gambling team is never deleted (K14), whatever depends on it:
 * its conversations have no other team to go to (ADR-08a §2.6). Read under
 * {@link lockTeamStaffing}, so a team given the role meanwhile is not deleted
 * on a stale read.
 */
export async function deleteGroup(
  tx: TenantClient,
  audit: AuditContext,
  licenseId: bigint,
  groupId: bigint,
  options: AuditOptions = {},
): Promise<void> {
  await lockTeamStaffing(tx, licenseId);
  const team = await tx.group.findUnique({
    where: { licenseId_id: { licenseId, id: groupId } },
    select: { topicRole: true },
  });
  if (team?.topicRole === RESPONSIBLE_GAMBLING_ROLE) throw protectedTeam('delete', groupId);

  const rule = await tx.routingRule.findFirst({
    where: { targetGroupId: groupId },
    select: { id: true, kind: true, isFallback: true },
  });
  if (rule) {
    throw new ApiError(
      'group_in_use',
      'A routing rule still sends conversations to this team. Point the rule elsewhere first.',
      { details: { rule_id: rule.id, kind: rule.kind, is_fallback: rule.isFallback } },
    );
  }

  const activeChats = await tx.chat.count({
    where: { active: true, access: { some: { groupId } } },
  });
  if (activeChats > 0) {
    throw new ApiError(
      'group_in_use',
      'Conversations are still open with this team. Transfer or close them first.',
      { details: { active_chats: activeChats } },
    );
  }

  // A saved reply scoped to this team (FR-MOD-08.7.2) is the third thing that
  // would be stranded. `canned_responses.group_id` carries no foreign key
  // either, so the two alternatives were: let the delete through and repair the
  // rows, or refuse. Repairing means `ON DELETE SET NULL` semantics — the row
  // survives with no team — and the only legal shape for a reply with no team
  // is `visibility = 'all'`, so deleting a team would silently publish that
  // team's private replies to the whole workspace. A refusal costs an admin one
  // extra step and is visible; the widening would be neither.
  const scopedReplies = await tx.cannedResponse.count({ where: { groupId } });
  if (scopedReplies > 0) {
    throw new ApiError(
      'group_in_use',
      'Saved replies are still scoped to this team. Re-scope or delete them first.',
      { details: { canned_responses: scopedReplies } },
    );
  }

  // Memberships cascade with the group (`GroupAgent.group` onDelete Cascade).
  // The `chat_access` rows of archived chats are left alone on purpose: they are
  // the record of who could see a conversation while it was open, group ids are
  // never reused (a sequence), and so an orphan row grants nobody anything.
  await tx.group.delete({ where: { licenseId_id: { licenseId, id: groupId } } });
  await writeAuditEntry(tx, audit, {
    action: 'group.deleted',
    target: `group:${groupId}`,
    metadata: { ...options.metadata },
  });
}

/**
 * Put an agent on a team, or move the tier they are already on.
 *
 * `priority: undefined` means "whatever they have, or `normal` if this is new".
 * That is the provisioning case, and it is deliberately *not* the same as
 * sending `normal`: SCIM has no attribute for a routing preference, so a
 * directory sync re-asserting the whole membership set would otherwise reset
 * every `primary` agent in the workspace to `normal` — silently, nightly, and
 * visible only as customers no longer reaching the person meant to answer them
 * first. The console always names a tier, because its dropdown always has one
 * selected.
 *
 * A new member must hold every area the team requires (AU-01 · K14 — the
 * Responsible Gambling team's training): a 409 naming what they lack. Checked
 * where a membership is created, by the console and a directory alike; moving
 * the tier of somebody already on the team is not a new grant and is not
 * re-checked, so a nightly SCIM restatement never trips over a member who was
 * on the team before the requirement was.
 *
 * `lead` (RL-01 · tm 324.2) marks the member as the team's lead, and follows
 * the tier's rule: `undefined` keeps the mark they have, `false` for a new
 * member — so a directory, which never names one, never clears one. Only a
 * Team Lead leads (400 `lead_requires_team_lead` otherwise); leaving the role
 * clears the marks (`clearLeadMarks`). *Who* may set it — an admin or the
 * owner — is the caller's question, not this function's: the console asks it,
 * SCIM never passes the field.
 *
 * Returns whether anything changed, which is also what decides whether an entry
 * is written.
 */
export async function setGroupMember(
  tx: TenantClient,
  audit: AuditContext,
  licenseId: bigint,
  input: { groupId: bigint; agentId: string; priority?: GroupPriority; lead?: boolean },
  options: AuditOptions = {},
): Promise<boolean> {
  const { groupId, agentId } = input;

  // A membership is what routing reads, so the agent must actually belong to
  // this workspace. Without the check an unknown uuid would be accepted and then
  // never match anyone.
  const members = await workspaceMemberIds(tx, [agentId]);
  if (!members.has(agentId)) {
    throw ApiError.notFound('That agent is not a member of this workspace.');
  }

  if (input.lead === true) {
    const membership = await tx.agentMembership.findFirst({
      where: { agentId },
      select: { role: true },
    });
    if (membership?.role !== 'team_lead') {
      throw ApiError.validation(
        'lead: Only a Team Lead leads a team. Make them a Team Lead first.',
        {
          reason: 'lead_requires_team_lead',
        },
      );
    }
  }

  const key = { licenseId_groupId_agentId: { licenseId, groupId, agentId } };
  const existing = await tx.groupAgent.findUnique({
    where: key,
    select: { priority: true, isLead: true },
  });
  const wanted = input.priority ?? (existing?.priority as GroupPriority | undefined);
  const lead = input.lead ?? existing?.isLead ?? false;

  if (
    existing &&
    (wanted === undefined || wanted === existing.priority) &&
    lead === existing.isLead
  ) {
    return false;
  }

  if (!existing) {
    await lockTeamStaffing(tx, licenseId);
    const required = await tx.groupExpertise.findMany({
      where: { groupId },
      select: { expertiseId: true },
      orderBy: { expertiseId: 'asc' },
    });
    const missing = (
      await shortOfExpertise(
        tx,
        [agentId],
        required.map((row) => row.expertiseId),
      )
    ).get(agentId);
    if (missing) {
      throw new ApiError(
        'group_expertise_missing',
        'This agent does not hold every area of expertise the team requires. Add it to them first.',
        {
          details: {
            group_id: Number(groupId),
            agent_id: agentId,
            expertise_ids: missing.map(Number),
          },
        },
      );
    }
  }

  const priority = wanted ?? DEFAULT_GROUP_PRIORITY;
  await tx.groupAgent.upsert({
    where: key,
    create: { licenseId, groupId, agentId, priority, isLead: lead },
    update: { priority, isLead: lead },
  });
  await writeAuditEntry(tx, audit, {
    action: 'group.member_set',
    target: `group:${groupId}`,
    metadata: { ...options.metadata, agent_id: agentId, priority, lead },
  });
  return true;
}

/**
 * Clear every lead mark `agentId` holds (RL-01 · tm 324.2), in the role
 * change that takes them off `team_lead`: leading is the Team Lead's, so a
 * mark left on an admin or a Team Member would be a lead the role no longer
 * backs — and the first thing RL-03's team-bounded checks would read. Returns
 * the teams cleared, in id order, for the role change's own audit entry.
 */
export async function clearLeadMarks(tx: TenantClient, agentId: string): Promise<bigint[]> {
  const led = await tx.groupAgent.findMany({
    where: { agentId, isLead: true },
    select: { groupId: true },
    orderBy: { groupId: 'asc' },
  });
  if (led.length === 0) return [];
  await tx.groupAgent.updateMany({ where: { agentId, isLead: true }, data: { isLead: false } });
  return led.map((row) => row.groupId);
}

/**
 * Take an agent off a team.
 *
 * Returns whether a row was actually removed. The console turns `false` into a
 * 404 — an admin who pressed Remove on somebody who is not there is looking at a
 * stale screen and should be told. A directory connector retrying after a
 * timeout has the opposite need: it must converge, so the SCIM route reads the
 * same `false` as "already in the state you asked for" and answers success.
 * Which is why the decision is the caller's rather than this function's.
 */
export async function removeGroupMember(
  tx: TenantClient,
  audit: AuditContext,
  licenseId: bigint,
  input: { groupId: bigint; agentId: string },
  options: AuditOptions = {},
): Promise<boolean> {
  const { groupId, agentId } = input;
  const removed = await tx.groupAgent.deleteMany({ where: { licenseId, groupId, agentId } });
  if (removed.count === 0) return false;

  await writeAuditEntry(tx, audit, {
    action: 'group.member_removed',
    target: `group:${groupId}`,
    metadata: { ...options.metadata, agent_id: agentId },
  });
  return true;
}

/**
 * Make the team's membership exactly `agentIds`.
 *
 * The shape a directory works in: RFC 7644 has no "add one" verb for a `PUT`,
 * and its `replace` on `members` names the set rather than a delta. Composed of
 * the two writers above rather than written as its own pair of statements, so a
 * replacement leaves exactly the entries the equivalent sequence of console
 * clicks would, and an agent already on the team keeps the tier an admin gave
 * them.
 *
 * Removals run first, so a replacement that merely restates the same people in a
 * different order writes nothing at all.
 */
export async function replaceGroupMembers(
  tx: TenantClient,
  audit: AuditContext,
  licenseId: bigint,
  groupId: bigint,
  agentIds: readonly string[],
  options: AuditOptions = {},
): Promise<void> {
  const wanted = new Set(agentIds);
  const current = await tx.groupAgent.findMany({ where: { groupId }, select: { agentId: true } });

  for (const row of current) {
    if (!wanted.has(row.agentId)) {
      await removeGroupMember(tx, audit, licenseId, { groupId, agentId: row.agentId }, options);
    }
  }
  for (const agentId of wanted) {
    await setGroupMember(tx, audit, licenseId, { groupId, agentId }, options);
  }
}
