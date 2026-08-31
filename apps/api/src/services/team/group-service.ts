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
 */
import type { GroupPriority } from '@nexa/types';
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
  agents: Array<{ agentId: string; priority: string }>;
}

const GROUP_INCLUDE = { agents: { select: { agentId: true, priority: true } } } as const;

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
  input: { name: string; languageCode?: string },
  options: AuditOptions = {},
): Promise<GroupWithAgents> {
  const created = await tx.group.create({
    data: {
      licenseId,
      name: input.name,
      ...(input.languageCode !== undefined ? { languageCode: input.languageCode } : {}),
    },
    include: GROUP_INCLUDE,
  });
  await writeAuditEntry(tx, audit, {
    action: 'group.created',
    target: `group:${created.id}`,
    metadata: { ...options.metadata, name: created.name, language_code: created.languageCode },
  });
  return created;
}

/**
 * Rename a team, or change the language it routes for.
 *
 * The entry is written only when a field actually moved. A nightly `PUT
 * /scim/v2/Groups/{id}` restates the name it read an hour ago; recording that as
 * a change would bury the rename somebody actually made.
 */
export async function updateGroup(
  tx: TenantClient,
  audit: AuditContext,
  licenseId: bigint,
  groupId: bigint,
  input: { name?: string; languageCode?: string },
  options: AuditOptions = {},
): Promise<GroupWithAgents> {
  const before = await readGroup(tx, licenseId, groupId);
  const moved =
    (input.name !== undefined && input.name !== before.name) ||
    (input.languageCode !== undefined && input.languageCode !== before.languageCode);
  if (!moved) return before;

  const updated = await tx.group.update({
    where: { licenseId_id: { licenseId, id: groupId } },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.languageCode !== undefined ? { languageCode: input.languageCode } : {}),
    },
    include: GROUP_INCLUDE,
  });
  await writeAuditEntry(tx, audit, {
    action: 'group.updated',
    target: `group:${groupId}`,
    metadata: { ...options.metadata, name: updated.name, language_code: updated.languageCode },
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
 */
export async function deleteGroup(
  tx: TenantClient,
  audit: AuditContext,
  licenseId: bigint,
  groupId: bigint,
  options: AuditOptions = {},
): Promise<void> {
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
 * Returns whether anything changed, which is also what decides whether an entry
 * is written.
 */
export async function setGroupMember(
  tx: TenantClient,
  audit: AuditContext,
  licenseId: bigint,
  input: { groupId: bigint; agentId: string; priority?: GroupPriority },
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

  const key = { licenseId_groupId_agentId: { licenseId, groupId, agentId } };
  const existing = await tx.groupAgent.findUnique({ where: key, select: { priority: true } });
  const wanted = input.priority ?? (existing?.priority as GroupPriority | undefined);

  if (existing && (wanted === undefined || wanted === existing.priority)) return false;

  const priority = wanted ?? DEFAULT_GROUP_PRIORITY;
  await tx.groupAgent.upsert({
    where: key,
    create: { licenseId, groupId, agentId, priority },
    update: { priority },
  });
  await writeAuditEntry(tx, audit, {
    action: 'group.member_set',
    target: `group:${groupId}`,
    metadata: { ...options.metadata, agent_id: agentId, priority },
  });
  return true;
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
