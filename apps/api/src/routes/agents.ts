/**
 * Agent availability.
 *
 * Going `accepting_chats` is the other moment capacity appears — the first
 * being a chat closing — so it drains the queue too. Without that, an agent who
 * comes online to an empty screen sits idle while customers wait for the next
 * arrival to trigger assignment.
 *
 * Every change of availability is also appended to `agent_presence_events`
 * (PRD §5.3-Vardiya, WORKSCHED-d). `agent_memberships.routing_status` is one
 * mutable cell that only ever answers "now"; the staffing forecast needs the
 * history behind it, and history can only be kept by writing it down as it
 * happens. Both writers — this file's routing-status handler and its suspension
 * handler — do that inside the transaction that made the change, so the log can
 * never disagree with what actually took effect.
 *
 * The two availability concepts here do not compete. `routing_status` is the
 * agent's live switch and the only thing routing reads; the *work schedule* is
 * a plan the forecast compares reality against. A rostered agent who is
 * manually offline takes no chats — the schedule never drives assignment, in
 * either direction (PLAN §C A15).
 */
import type { FastifyInstance } from 'fastify';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import {
  AGENT_ROLES,
  DEFAULT_WORK_SCHEDULE,
  GROUP_PRIORITIES,
  NOTIFICATION_CHANNELS,
  ROUTING_STATUSES,
  hasAnyScope,
  isWorkScheduleProblem,
  normalizeWorkSchedule,
  type AgentRole,
  type NotificationChannel,
  type WorkSchedule,
} from '@nexa/types';
import { ApiError } from '../lib/api-error.js';
import { RealtimePublisher } from '../services/realtime/publisher.js';
import { RoutingService } from '../services/routing/routing-service.js';
import { roleAtLeast, scopesOf, type Principal } from '../services/auth/principal.js';
import { setMembershipSuspension } from '../services/auth/membership-service.js';
import { writeAuditEntry } from '../services/audit/audit-log.js';
import {
  readNotificationPreferences,
  writeNotificationPreferences,
} from '../services/notifications/preferences.js';

const routingStatusBody = z.object({ routing_status: z.enum(ROUTING_STATUSES) });

// --- Teams (FR-MOD-04.5) ----------------------------------------------------

/** Mirrors `groups_language_code_check`: ISO 639-1, optionally with a region.
 *  Shaped here rather than left to a length bound, because the CHECK is what
 *  the column actually enforces — `en_GB` past a `min(2).max(10)` reaches
 *  Postgres, raises 23514 mid-transaction and surfaces as a 500. */
const groupLanguageCode = z
  .string()
  .trim()
  .regex(/^[a-z]{2}(-[A-Z]{2})?$/);

/** A team name is what an agent picks from a transfer menu, so it is trimmed and
 *  bounded rather than free text. `language_code` drives language-based routing
 *  and defaults to the column's `en`. */
const groupBody = z.object({
  name: z.string().trim().min(1).max(120),
  language_code: groupLanguageCode.optional(),
});

/** Both fields optional, at least one required — the edit page sends the field
 *  that moved, not the pair it read a moment ago. */
const groupPatchBody = groupBody.partial().refine((b) => Object.keys(b).length > 0, {
  message: 'send at least one of name, language_code',
});

/** `priority` is the routing preference ADR-08 step 2 reads, and the PRD's
 *  "Primary agent önceliği" is its `primary` tier. Enumerated here so a typo is
 *  a 400 rather than a row the CHECK constraint rejects mid-transaction. */
const membershipBody = z.object({ priority: z.enum(GROUP_PRIORITIES).default('normal') });

const GROUP_BODY_MESSAGE =
  'name is required (1–120 characters); language_code is a two-letter code, optionally with a region (e.g. en, en-GB).';

function parseGroupBody(raw: unknown): z.infer<typeof groupBody> {
  const parsed = groupBody.safeParse(raw);
  if (!parsed.success) {
    throw ApiError.validation(GROUP_BODY_MESSAGE);
  }
  return parsed.data;
}

function parseGroupPatchBody(raw: unknown): z.infer<typeof groupPatchBody> {
  const parsed = groupPatchBody.safeParse(raw);
  if (!parsed.success) {
    throw ApiError.validation(`Send at least one of name, language_code. ${GROUP_BODY_MESSAGE}`);
  }
  return parsed.data;
}

function parseMembershipBody(raw: unknown): z.infer<typeof membershipBody> {
  const parsed = membershipBody.safeParse(raw ?? {});
  if (!parsed.success) {
    throw ApiError.validation(`priority must be one of: ${GROUP_PRIORITIES.join(', ')}.`);
  }
  return parsed.data;
}

/** The largest value `groups.id` (BIGSERIAL) can hold. Past it there is no row
 *  to find, and the query would reach Postgres as a range error rather than a
 *  lookup. */
const MAX_BIGSERIAL = 9223372036854775807n;

/** The path id, as a bigint. Anything that is not a plain in-range decimal is a
 *  404 rather than a 400: `/groups/banana` names no team, and saying so is the
 *  same answer as naming a team this workspace does not have. Decimal digits
 *  only — `BigInt('0x10')` is 16, so a bare `BigInt()` would quietly resolve a
 *  hex segment to a real row. */
function groupIdParam(raw: string): bigint {
  if (!/^\d{1,19}$/.test(raw)) throw new ApiError('group_not_found', 'Team not found.');
  const id = BigInt(raw);
  if (id <= 0n || id > MAX_BIGSERIAL) throw new ApiError('group_not_found', 'Team not found.');
  return id;
}

/** The agent uuid from the path, as the rest of this file parses one: a
 *  malformed segment is a 400, not a `22P02` from the `uuid` column. */
function agentIdParam(raw: string): string {
  const parsed = z.string().uuid().safeParse(raw);
  if (!parsed.success) throw ApiError.validation('agentId must be a UUID.');
  return parsed.data;
}

/**
 * The team, or a 404. Read inside the caller's tenant, so RLS — not the
 * `licenseId` in the where-clause — is what makes another workspace's team
 * unreachable; the id is there because it is half of the primary key.
 */
async function loadGroup(
  tx: Prisma.TransactionClient,
  groupId: bigint,
): Promise<{ id: bigint; name: string }> {
  const group = await tx.group.findFirst({
    where: { id: groupId },
    select: { id: true, name: true },
  });
  if (!group) throw new ApiError('group_not_found', 'Team not found.');
  return group;
}

function serialiseGroup(group: {
  id: bigint;
  name: string;
  languageCode: string;
  agents: Array<{ agentId: string; priority: string }>;
}) {
  return {
    id: Number(group.id),
    name: group.name,
    language_code: group.languageCode,
    agents: group.agents.map((a) => ({ agent_id: a.agentId, priority: a.priority })),
  };
}

/**
 * A partial change to the caller's notification channels (FR-MOD-13.8).
 *
 * Every key optional, but at least one required. Optional because a screen with
 * five checkboxes should be able to send the one that moved rather than
 * restating four it read some seconds ago and may have lost a race on; refusing
 * the empty body because a `PUT` that changes nothing and returns everything is
 * a `GET` wearing the wrong verb, and one a client would reach for by accident
 * while debugging.
 *
 * `.strict()` so a misspelled channel (`despktop`) is a 400 rather than a
 * silently dropped toggle — the failure mode where the switch on screen says
 * "off" and the server goes on interrupting.
 */
const notificationPrefsBody = z
  .object(
    Object.fromEntries(NOTIFICATION_CHANNELS.map((c) => [c, z.boolean().optional()])) as Record<
      NotificationChannel,
      z.ZodOptional<z.ZodBoolean>
    >,
  )
  .strict()
  .refine((body) => Object.values(body).some((v) => v !== undefined), 'at least one is required');
const listAgentsQuery = z.object({
  status: z.enum(['active', 'suspended', 'all']).default('active'),
});
const suspensionBody = z.object({ suspended: z.boolean() });
const roleChangeBody = z.object({ role: z.enum(AGENT_ROLES) });
// The complete expertise set to assign (FR-MOD-08.6.3). Coerced because JSON
// carries these as numbers; capped so a single call cannot fan out unbounded.
const setExpertiseBody = z.object({
  expertise_ids: z.array(z.coerce.bigint()).max(200),
});

/**
 * A work-schedule request is two different acts wearing one URL.
 *
 * Reading or rewriting *your own* rostered hours is self-service — an ordinary
 * agent, holding only `agents--my:*`, may do it. Doing either to *someone
 * else's* week is an administrative act on another person and needs the
 * tenant-wide `agents--all:*`. The route's scope list cannot draw that line on
 * its own: `agents--my:rw` satisfies it whichever id is in the path, so the
 * distinction has to be made here, against that id.
 *
 * Bot and app principals own no account, so "self" is never true for them and
 * they fall through to the administrative scope — the conservative answer for a
 * credential that belongs to no person.
 *
 * Deliberately a 403 and not a 404: the caller is refused for who they are, and
 * the id was one they supplied. Whether that agent *exists* is answered
 * afterwards under RLS, so a cross-tenant id still comes back 404 and stays
 * un-enumerable (NFR-S5).
 */
function requireWorkScheduleAccess(
  principal: Principal,
  agentId: string,
  adminScope: 'agents--all:ro' | 'agents--all:rw',
): void {
  if (principal.kind === 'agent' && principal.accountId === agentId) return;
  if (hasAnyScope(scopesOf(principal), [adminScope])) return;
  throw ApiError.authorization(
    `Managing another agent's work schedule requires the ${adminScope} scope.`,
  );
}

/**
 * A stored row as the contract's `WorkSchedule`.
 *
 * Normalised on the way out as well as in. `normalizeWorkSchedule` is the one
 * gate the contract names, so running it here too means the response can never
 * carry a shape the document forbids — not for a row written before a rule
 * tightened, nor for one edited by hand in psql. A row that will not normalise
 * is treated as unset rather than raised as a 500: the agent sees the default
 * week and can write over it. An agent with no row yet gets that same default,
 * which is what `normalizeWorkSchedule` returns for empty input — "not set" and
 * "set to the default" are deliberately the same answer here.
 */
function serialiseWorkSchedule(row: { timezone: string; schedule: unknown } | null): WorkSchedule {
  if (!row) return DEFAULT_WORK_SCHEDULE;
  const normalised = normalizeWorkSchedule({ timezone: row.timezone, schedule: row.schedule });
  return isWorkScheduleProblem(normalised) ? DEFAULT_WORK_SCHEDULE : normalised;
}

/**
 * The agent columns — and the expertise areas — every response here draws on, in
 * one place so the list, the suspension/role replies and the expertise reply
 * never drift. Expertise is RLS-scoped to the caller's licence, so the nested
 * read only ever returns the current tenant's areas.
 */
const agentSelect = {
  id: true,
  name: true,
  email: true,
  avatarUrl: true,
  expertise: {
    select: { expertise: { select: { id: true, name: true, slug: true } } },
  },
} satisfies Prisma.AccountSelect;

type MembershipWithAgent = {
  role: string;
  routingStatus: string;
  concurrentChatsLimit: number;
  twoFactorEnabled: boolean;
  suspended: boolean;
  agent: {
    id: string;
    name: string;
    email: string;
    avatarUrl: string | null;
    expertise: { expertise: { id: bigint; name: string; slug: string } }[];
  };
};

function serialiseAgent(m: MembershipWithAgent) {
  return {
    id: m.agent.id,
    name: m.agent.name,
    email: m.agent.email,
    avatar_url: m.agent.avatarUrl,
    role: m.role,
    routing_status: m.routingStatus,
    concurrent_chats_limit: m.concurrentChatsLimit,
    two_factor_enabled: m.twoFactorEnabled,
    suspended: m.suspended,
    expertise: m.agent.expertise
      .map((e) => ({ id: Number(e.expertise.id), name: e.expertise.name, slug: e.expertise.slug }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}

export default async function agentRoutes(app: FastifyInstance): Promise<void> {
  const routing = new RoutingService();
  const publisher = new RealtimePublisher(app.redis, app.log);

  app.put(
    '/agents/me/routing-status',
    { config: { scopes: ['agents--my:rw', 'agents--all:rw'], principals: ['agent'] } },
    async (request, reply) => {
      const parsed = routingStatusBody.safeParse(request.body);
      if (!parsed.success) {
        throw ApiError.validation('routing_status must be one of: ' + ROUTING_STATUSES.join(', '));
      }

      const principal = request.requirePrincipal();
      if (principal.kind !== 'agent') throw ApiError.authorization();

      const tenant = request.tenant();
      const status = parsed.data.routing_status;

      const drained = await request.withTenant(async (tx) => {
        // Whether this is a real change is decided by the UPDATE's own WHERE
        // clause rather than by reading the column and comparing. Two requests
        // racing to set the same status would both read the old value and both
        // conclude they were the transition, and the log's one promise — a row
        // per actual change — would break under exactly the concurrency it
        // exists to record. The membership itself is guaranteed to be there:
        // resolving the bearer token already refused a principal without one
        // (`token-service.ts`).
        const transition = await tx.agentMembership.updateMany({
          where: {
            licenseId: tenant.licenseId,
            agentId: principal.accountId,
            routingStatus: { not: status },
          },
          data: { routingStatus: status },
        });

        // The presence log, written in the same transaction as the drain below
        // and for the same reason the drain is in one: if the assignment rolls
        // back, the row claiming this agent came online has to roll back with
        // it. An event that outlived a failed request would report coverage
        // that never happened — and nothing downstream could tell.
        //
        // Re-sending the status the agent already holds writes nothing, so the
        // log stays a history of changes rather than of button presses.
        if (transition.count > 0) {
          await tx.agentPresenceEvent.create({
            data: { licenseId: tenant.licenseId, agentId: principal.accountId, status },
          });
        }

        // Only becoming available can free capacity; going away cannot.
        return status === 'accepting_chats' ? routing.drainQueue(tx, tenant.licenseId) : [];
      });

      await publisher.publish(
        tenant,
        'routing_status_set',
        { allAgents: true },
        { agent_id: principal.accountId, status },
      );

      for (const assignment of drained) {
        await publisher.publish(
          tenant,
          'incoming_chat',
          { agentIds: [assignment.assigneeId] },
          {
            requester_id: null,
            chat: { id: assignment.chatId, thread: { id: assignment.threadId } },
          },
        );
      }

      return reply.send({
        routing_status: status,
        assigned_from_queue: drained.map((d) => d.chatId),
      });
    },
  );

  app.get(
    '/agents/me/notification-preferences',
    { config: { scopes: ['agents--my:ro', 'agents--all:ro'], principals: ['agent'] } },
    async (request, reply) => {
      const principal = request.requirePrincipal();
      if (principal.kind !== 'agent') throw ApiError.authorization();

      const tenant = request.tenant();
      const prefs = await request.withTenant((tx) =>
        readNotificationPreferences(tx, {
          licenseId: tenant.licenseId,
          agentId: principal.accountId,
        }),
      );
      return reply.send(prefs);
    },
  );

  app.put(
    '/agents/me/notification-preferences',
    { config: { scopes: ['agents--my:rw', 'agents--all:rw'], principals: ['agent'] } },
    async (request, reply) => {
      const parsed = notificationPrefsBody.safeParse(request.body);
      if (!parsed.success) {
        throw ApiError.validation(
          `Send at least one of ${NOTIFICATION_CHANNELS.join(', ')} as a boolean.`,
        );
      }

      const principal = request.requirePrincipal();
      if (principal.kind !== 'agent') throw ApiError.authorization();

      const tenant = request.tenant();
      // Per user, per license (FR-MOD-08.2): the update is keyed on both, so the
      // same person opting out here does not affect their other workspaces, and
      // RLS keeps it inside the caller's tenant.
      const prefs = await request.withTenant((tx) =>
        writeNotificationPreferences(tx, {
          licenseId: tenant.licenseId,
          agentId: principal.accountId,
          patch: parsed.data,
        }),
      );

      return reply.send(prefs);
    },
  );

  app.get(
    '/agents',
    { config: { scopes: ['agents--all:ro', 'agents--my:ro'] } },
    async (request, reply) => {
      const parsed = listAgentsQuery.safeParse(request.query);
      if (!parsed.success) {
        throw ApiError.validation('status must be one of: active, suspended, all.');
      }
      const { status } = parsed.data;
      // Default stays `active` so every existing caller — assignee pickers,
      // routing UIs — keeps seeing only agents who can actually take work.
      const where =
        status === 'active'
          ? { suspended: false }
          : status === 'suspended'
            ? { suspended: true }
            : {};

      const agents = await request.withTenant((tx) =>
        tx.agentMembership.findMany({
          where,
          include: { agent: { select: agentSelect } },
          orderBy: { createdAt: 'asc' },
        }),
      );

      return reply.send({ items: agents.map(serialiseAgent) });
    },
  );

  app.put<{ Params: { agentId: string } }>(
    '/agents/:agentId/suspension',
    { config: { scopes: ['agents--all:rw'] } },
    async (request, reply) => {
      const params = z.object({ agentId: z.string().uuid() }).safeParse(request.params);
      if (!params.success) throw ApiError.validation('agentId must be a UUID.');
      const parsedBody = suspensionBody.safeParse(request.body);
      if (!parsedBody.success) throw ApiError.validation('suspended must be a boolean.');

      const { agentId } = params.data;
      const { suspended } = parsedBody.data;

      // Both gates, as everywhere else: the scope says the token may, the role
      // says the person may. Suspension is an owner/admin action on someone
      // *else*, so a bot token or an agent-role user is refused here.
      const principal = request.requirePrincipal();
      if (principal.kind !== 'agent') {
        throw ApiError.authorization('Only a signed-in teammate can change suspension.');
      }
      const actorRole = principal.role;
      if (!roleAtLeast(actorRole, 'admin')) {
        throw ApiError.authorization('Only an admin or owner can suspend agents.');
      }

      const updated = await request.withTenant(async (tx) => {
        // RLS scopes this to the caller's licence, so a hit is always in-tenant
        // and a miss is a 404 that keeps ids un-enumerable across tenants.
        const target = await tx.agentMembership.findFirst({
          where: { agentId },
          include: { agent: { select: agentSelect } },
        });
        if (!target) throw ApiError.notFound('Agent not found.');

        const targetRole = target.role as AgentRole;

        // The owner holds the workspace; suspending them (or, for an admin,
        // anyone above their own rank) is a way to lock the last key inside.
        if (suspended) {
          if (targetRole === 'owner') {
            throw ApiError.authorization('The owner cannot be suspended.');
          }
          if (target.agentId === principal.accountId) {
            throw ApiError.authorization('You cannot suspend yourself.');
          }
        }
        if (!roleAtLeast(actorRole, targetRole)) {
          throw ApiError.authorization('You cannot change an agent above your own role.');
        }

        // The effect — the flag, the presence event, the audit entry, and the
        // no-op rule that keeps a repeat from writing a second misleading entry
        // — is shared with SCIM deprovisioning (`membership-service.ts`). Only
        // the ceiling above this line is specific to a person asking.
        const changed = await setMembershipSuspension(
          tx,
          request.auditContext(),
          target,
          suspended,
        );
        if (!changed) return target;

        return tx.agentMembership.findFirstOrThrow({
          where: { agentId },
          include: { agent: { select: agentSelect } },
        });
      });

      return reply.send(serialiseAgent(updated));
    },
  );

  app.put<{ Params: { agentId: string } }>(
    '/agents/:agentId/role',
    // The double gate, in config so it reads at a glance: the scope says the
    // token may administer agents, `minimumRole: admin` says the *person* is an
    // admin or owner. An agent-role user holding a broad PAT is refused here.
    { config: { scopes: ['agents--all:rw'], minimumRole: 'admin' } },
    async (request, reply) => {
      const params = z.object({ agentId: z.string().uuid() }).safeParse(request.params);
      if (!params.success) throw ApiError.validation('agentId must be a UUID.');
      const parsedBody = roleChangeBody.safeParse(request.body);
      if (!parsedBody.success) {
        throw ApiError.validation('role must be one of: ' + AGENT_ROLES.join(', '));
      }

      const { agentId } = params.data;
      const nextRole = parsedBody.data.role;

      // `minimumRole` already proved this is an agent principal of admin rank or
      // above; the narrowing is for the type system (accountId/role below) and a
      // second line of defence.
      const principal = request.requirePrincipal();
      if (principal.kind !== 'agent') {
        throw ApiError.authorization('Only a signed-in teammate can change a role.');
      }
      const actorRole = principal.role;

      const updated = await request.withTenant(async (tx) => {
        // RLS scopes this to the caller's licence, so a hit is always in-tenant
        // and a miss is a 404 that keeps ids un-enumerable across tenants (NFR-S5).
        const target = await tx.agentMembership.findFirst({
          where: { agentId },
          include: { agent: { select: agentSelect } },
        });
        if (!target) throw ApiError.notFound('Agent not found.');

        const currentRole = target.role as AgentRole;

        // The privilege ceiling, kept as one reasoning unit: drop any single
        // guard and the escalation boundary leaks (an admin who could make
        // themselves owner would collapse the whole of RBAC).
        //
        //   - No one changes their own role — you can neither hand yourself
        //     power nor lock yourself out.
        //   - The owner's role is immutable here; handing over the workspace is a
        //     separate, heavier operation (the last-owner invariant) and out of
        //     scope. Ownership is never *granted* here either — promoting anyone
        //     to owner is that same transfer, refused.
        //   - The caller may not touch a teammate ranked above them, nor grant a
        //     role above their own rank. Both are the escalation NFR-S12 guards
        //     against; each is a 403, not a 400, even when the body parsed.
        if (target.agentId === principal.accountId) {
          throw ApiError.authorization('You cannot change your own role.');
        }
        if (currentRole === 'owner') {
          throw ApiError.authorization('The owner cannot be moved to another role here.');
        }
        if (nextRole === 'owner') {
          throw ApiError.authorization('Ownership transfer is not supported here.');
        }
        if (!roleAtLeast(actorRole, currentRole)) {
          throw ApiError.authorization('You cannot change an agent above your own role.');
        }
        if (!roleAtLeast(actorRole, nextRole)) {
          throw ApiError.authorization('You cannot grant a role above your own.');
        }

        // No-op when the role is unchanged: return the current agent without
        // writing a second, misleading audit entry.
        if (currentRole === nextRole) return target;

        const next = await tx.agentMembership.update({
          where: { licenseId_agentId: { licenseId: target.licenseId, agentId } },
          data: { role: nextRole },
          include: { agent: { select: agentSelect } },
        });

        await writeAuditEntry(tx, request.auditContext(), {
          action: 'member.role_changed',
          target: `account:${agentId}`,
          metadata: { from: currentRole, to: nextRole },
        });

        return next;
      });

      return reply.send(serialiseAgent(updated));
    },
  );

  app.put<{ Params: { agentId: string } }>(
    '/agents/:agentId/expertise',
    // The double gate, as with role changes: the scope says the token may
    // administer agents, `minimumRole: admin` says the person is an admin or
    // owner. A bot token or an agent-role user is refused here.
    { config: { scopes: ['agents--all:rw'], minimumRole: 'admin' } },
    async (request, reply) => {
      const params = z.object({ agentId: z.string().uuid() }).safeParse(request.params);
      if (!params.success) throw ApiError.validation('agentId must be a UUID.');
      const parsedBody = setExpertiseBody.safeParse(request.body);
      if (!parsedBody.success) {
        throw ApiError.validation('expertise_ids must be an array of expertise-area ids.');
      }

      const { agentId } = params.data;
      const tenant = request.tenant();

      // The body is the *complete* set; de-duplicate so a repeated id is neither
      // counted twice against the catalogue check nor inserted twice.
      const expertiseIds = [
        ...new Set(parsedBody.data.expertise_ids.map((id) => id.toString())),
      ].map((id) => BigInt(id));

      const updated = await request.withTenant(async (tx) => {
        // RLS scopes this to the caller's licence, so an agent in another
        // workspace is simply not found — a 404 that keeps ids un-enumerable
        // across tenants (NFR-S5).
        const target = await tx.agentMembership.findFirst({ where: { agentId } });
        if (!target) throw ApiError.notFound('Agent not found.');

        // Every id must name an area on this licence. RLS means a cross-tenant or
        // unknown id returns nothing, so a short count is a 404 — no id is ever
        // confirmed to exist outside the caller's tenant.
        if (expertiseIds.length > 0) {
          const found = await tx.expertise.findMany({
            where: { id: { in: expertiseIds } },
            select: { id: true },
          });
          if (found.length !== expertiseIds.length) {
            throw ApiError.notFound('One or more expertise areas were not found.');
          }
        }

        // Full replacement: clear the current set, then lay down the new one. Two
        // identical calls leave the same rows (idempotent), and an empty list is
        // a valid way to clear every area.
        await tx.agentExpertise.deleteMany({ where: { agentId } });
        if (expertiseIds.length > 0) {
          await tx.agentExpertise.createMany({
            data: expertiseIds.map((expertiseId) => ({
              licenseId: tenant.licenseId,
              agentId,
              expertiseId,
            })),
          });
        }

        return tx.agentMembership.findFirstOrThrow({
          where: { agentId },
          include: { agent: { select: agentSelect } },
        });
      });

      return reply.send(serialiseAgent(updated));
    },
  );

  app.get<{ Params: { agentId: string } }>(
    '/agents/:agentId/work-schedule',
    { config: { scopes: ['agents--all:ro', 'agents--my:ro'] } },
    async (request, reply) => {
      const params = z.object({ agentId: z.string().uuid() }).safeParse(request.params);
      if (!params.success) throw ApiError.validation('agentId must be a UUID.');
      const { agentId } = params.data;

      requireWorkScheduleAccess(request.requirePrincipal(), agentId, 'agents--all:ro');

      const row = await request.withTenant(async (tx) => {
        // The membership is checked first because without it "this agent has no
        // schedule yet" and "there is no such agent" would both answer 200 with
        // the default week — and the second one would quietly confirm an id.
        // RLS scopes the lookup to the caller's licence, so an agent in another
        // workspace is simply not found (NFR-S5).
        const member = await tx.agentMembership.findFirst({
          where: { agentId },
          select: { agentId: true },
        });
        if (!member) throw ApiError.notFound('Agent not found.');

        return tx.workSchedule.findFirst({
          where: { agentId },
          select: { timezone: true, schedule: true },
        });
      });

      return reply.send(serialiseWorkSchedule(row));
    },
  );

  app.put<{ Params: { agentId: string } }>(
    '/agents/:agentId/work-schedule',
    // The same scope pair as `PUT /agents/me/routing-status`: the list admits
    // both the self-service and the administrative caller, and
    // `requireWorkScheduleAccess` decides which of the two this request is.
    { config: { scopes: ['agents--my:rw', 'agents--all:rw'] } },
    async (request, reply) => {
      const params = z.object({ agentId: z.string().uuid() }).safeParse(request.params);
      if (!params.success) throw ApiError.validation('agentId must be a UUID.');
      const { agentId } = params.data;

      requireWorkScheduleAccess(request.requirePrincipal(), agentId, 'agents--all:rw');

      // The only rule applied here is that the payload is an object at all.
      // Everything about *what a valid week is* — weekday names, `HH:MM`, start
      // before end, no day listed twice — belongs to `normalizeWorkSchedule`,
      // the single gate this route and the settings form share, so the two can
      // never drift into disagreeing about what they accept.
      const body = z.object({}).passthrough().safeParse(request.body);
      if (!body.success) {
        throw ApiError.validation('The request body must be a work schedule object.');
      }

      const normalised = normalizeWorkSchedule(body.data);
      if (isWorkScheduleProblem(normalised)) {
        throw ApiError.validation(normalised.problem.message, {
          reason: normalised.problem.reason,
        });
      }

      const tenant = request.tenant();
      const schedule = normalised.schedule as unknown as Prisma.InputJsonValue;

      await request.withTenant(async (tx) => {
        const member = await tx.agentMembership.findFirst({
          where: { agentId },
          select: { agentId: true },
        });
        if (!member) throw ApiError.notFound('Agent not found.');

        // Replace, not patch — the same wholesale shape `setAgentExpertise`
        // uses. The body is the complete week, so one upsert on
        // (licence, agent) is the entire write and two identical calls leave
        // identical rows.
        await tx.workSchedule.upsert({
          where: { licenseId_agentId: { licenseId: tenant.licenseId, agentId } },
          create: { licenseId: tenant.licenseId, agentId, timezone: normalised.timezone, schedule },
          update: { timezone: normalised.timezone, schedule },
        });

        // Written on every accepted PUT, including one that stores the same
        // week again: unlike a suspension flag there is no "real transition" to
        // detect cheaply, and the question this trail answers — who rewrote
        // whose hours, and when — is about the act, not the delta. The metadata
        // carries the shape of the week, never the individual times.
        await writeAuditEntry(tx, request.auditContext(), {
          action: 'work_schedule.updated',
          target: `account:${agentId}`,
          metadata: {
            timezone: normalised.timezone,
            enabled_days: normalised.schedule.filter((slot) => slot.enabled).length,
          },
        });
      });

      return reply.send(normalised);
    },
  );

  app.get(
    '/groups',
    { config: { scopes: ['groups--all:ro', 'groups--my:ro'] } },
    async (request, reply) => {
      const groups = await request.withTenant((tx) =>
        tx.group.findMany({
          include: { agents: { select: { agentId: true, priority: true } } },
          orderBy: { id: 'asc' },
        }),
      );

      return reply.send({ items: groups.map(serialiseGroup) });
    },
  );

  // --- Teams: the write half (FR-MOD-04.5) ----------------------------------
  //
  // `GET /groups` shipped alone, so a workspace could read the teams it had and
  // create none. That is not a missing convenience: routing resolves an agent
  // through `group_agents` (ADR-08 step 2), so a workspace opened from scratch
  // had no team, no membership and therefore nowhere to route a conversation —
  // a Must/MVP requirement that read as delivered because the read endpoint
  // existed.

  app.post('/groups', { config: { scopes: ['groups--all:rw'] } }, async (request, reply) => {
    const body = parseGroupBody(request.body);
    const tenant = request.tenant();

    const group = await request.withTenant(async (tx) => {
      const created = await tx.group.create({
        data: {
          licenseId: tenant.licenseId,
          name: body.name,
          ...(body.language_code !== undefined ? { languageCode: body.language_code } : {}),
        },
        include: { agents: { select: { agentId: true, priority: true } } },
      });
      await writeAuditEntry(tx, request.auditContext(), {
        action: 'group.created',
        target: `group:${created.id}`,
        metadata: { name: created.name, language_code: created.languageCode },
      });
      return created;
    });

    return reply.code(201).send(serialiseGroup(group));
  });

  app.patch<{ Params: { groupId: string } }>(
    '/groups/:groupId',
    { config: { scopes: ['groups--all:rw'] } },
    async (request, reply) => {
      const groupId = groupIdParam(request.params.groupId);
      const body = parseGroupPatchBody(request.body);

      const group = await request.withTenant(async (tx) => {
        await loadGroup(tx, groupId);
        const updated = await tx.group.update({
          where: { licenseId_id: { licenseId: request.tenant().licenseId, id: groupId } },
          data: {
            ...(body.name !== undefined ? { name: body.name } : {}),
            ...(body.language_code !== undefined ? { languageCode: body.language_code } : {}),
          },
          include: { agents: { select: { agentId: true, priority: true } } },
        });
        await writeAuditEntry(tx, request.auditContext(), {
          action: 'group.updated',
          target: `group:${groupId}`,
          metadata: { name: updated.name, language_code: updated.languageCode },
        });
        return updated;
      });

      return reply.send(serialiseGroup(group));
    },
  );

  app.delete<{ Params: { groupId: string } }>(
    '/groups/:groupId',
    { config: { scopes: ['groups--all:rw'] } },
    async (request, reply) => {
      const groupId = groupIdParam(request.params.groupId);

      await request.withTenant(async (tx) => {
        await loadGroup(tx, groupId);

        // Neither `routing_rules.target_group_id` nor `chat_access.group_id`
        // carries a foreign key, so the database will not stop a delete that
        // strands them — these two checks are the only thing that does.
        //
        // A rule pointing at a deleted team routes nothing and says nothing; a
        // live chat reachable only through it becomes invisible to every agent
        // at once. Both are refusals rather than cascades: which team should
        // inherit the work is an operator's decision, not a default.
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

        // Memberships cascade with the group (`GroupAgent.group` onDelete
        // Cascade). The `chat_access` rows of archived chats are left alone on
        // purpose: they are the record of who could see a conversation while it
        // was open, group ids are never reused (a per-table sequence), and so
        // an orphan row grants nobody anything.
        await tx.group.delete({
          where: { licenseId_id: { licenseId: request.tenant().licenseId, id: groupId } },
        });
        await writeAuditEntry(tx, request.auditContext(), {
          action: 'group.deleted',
          target: `group:${groupId}`,
          metadata: {},
        });
      });

      return reply.code(204).send();
    },
  );

  app.put<{ Params: { groupId: string; agentId: string } }>(
    '/groups/:groupId/agents/:agentId',
    { config: { scopes: ['groups--all:rw'] } },
    async (request, reply) => {
      const groupId = groupIdParam(request.params.groupId);
      const agentId = agentIdParam(request.params.agentId);
      const { priority } = parseMembershipBody(request.body);

      const group = await request.withTenant(async (tx) => {
        await loadGroup(tx, groupId);

        // A membership is what routing reads, so the agent must actually belong
        // to this workspace. RLS scopes the lookup; without the check an unknown
        // uuid would be accepted and then never match anyone.
        const member = await tx.agentMembership.findFirst({
          where: { agentId },
          select: { agentId: true },
        });
        if (!member) throw ApiError.notFound('That agent is not a member of this workspace.');

        await tx.groupAgent.upsert({
          where: {
            licenseId_groupId_agentId: {
              licenseId: request.tenant().licenseId,
              groupId,
              agentId,
            },
          },
          create: { licenseId: request.tenant().licenseId, groupId, agentId, priority },
          update: { priority },
        });
        await writeAuditEntry(tx, request.auditContext(), {
          action: 'group.member_set',
          target: `group:${groupId}`,
          metadata: { agent_id: agentId, priority },
        });

        return tx.group.findUniqueOrThrow({
          where: { licenseId_id: { licenseId: request.tenant().licenseId, id: groupId } },
          include: { agents: { select: { agentId: true, priority: true } } },
        });
      });

      return reply.send(serialiseGroup(group));
    },
  );

  app.delete<{ Params: { groupId: string; agentId: string } }>(
    '/groups/:groupId/agents/:agentId',
    { config: { scopes: ['groups--all:rw'] } },
    async (request, reply) => {
      const groupId = groupIdParam(request.params.groupId);
      const agentId = agentIdParam(request.params.agentId);

      await request.withTenant(async (tx) => {
        await loadGroup(tx, groupId);
        const removed = await tx.groupAgent.deleteMany({ where: { groupId, agentId } });
        if (removed.count === 0) {
          throw ApiError.notFound('That agent is not in this team.');
        }
        await writeAuditEntry(tx, request.auditContext(), {
          action: 'group.member_removed',
          target: `group:${groupId}`,
          metadata: { agent_id: agentId },
        });
      });

      return reply.code(204).send();
    },
  );
}
