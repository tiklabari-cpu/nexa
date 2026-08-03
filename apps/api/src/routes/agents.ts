/**
 * Agent availability.
 *
 * Going `accepting_chats` is the other moment capacity appears — the first
 * being a chat closing — so it drains the queue too. Without that, an agent who
 * comes online to an empty screen sits idle while customers wait for the next
 * arrival to trigger assignment.
 */
import type { FastifyInstance } from 'fastify';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { AGENT_ROLES, ROUTING_STATUSES, type AgentRole } from '@nexa/types';
import { ApiError } from '../lib/api-error.js';
import { RealtimePublisher } from '../services/realtime/publisher.js';
import { RoutingService } from '../services/routing/routing-service.js';
import { roleAtLeast } from '../services/auth/principal.js';
import { writeAuditEntry } from '../services/audit/audit-log.js';

const routingStatusBody = z.object({ routing_status: z.enum(ROUTING_STATUSES) });
const notificationPrefsBody = z.object({ email: z.boolean() });
const listAgentsQuery = z.object({ status: z.enum(['active', 'suspended', 'all']).default('active') });
const suspensionBody = z.object({ suspended: z.boolean() });
const roleChangeBody = z.object({ role: z.enum(AGENT_ROLES) });
// The complete expertise set to assign (FR-MOD-08.6.3). Coerced because JSON
// carries these as numbers; capped so a single call cannot fan out unbounded.
const setExpertiseBody = z.object({
  expertise_ids: z.array(z.coerce.bigint()).max(200),
});

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
        await tx.agentMembership.update({
          where: {
            licenseId_agentId: { licenseId: tenant.licenseId, agentId: principal.accountId },
          },
          data: { routingStatus: status },
        });

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

  app.put(
    '/agents/me/notification-preferences',
    { config: { scopes: ['agents--my:rw', 'agents--all:rw'], principals: ['agent'] } },
    async (request, reply) => {
      const parsed = notificationPrefsBody.safeParse(request.body);
      if (!parsed.success) throw ApiError.validation('email must be a boolean.');

      const principal = request.requirePrincipal();
      if (principal.kind !== 'agent') throw ApiError.authorization();

      const tenant = request.tenant();
      // Per user, per license (FR-MOD-08.2): the update is keyed on both, so the
      // same person opting out here does not affect their other workspaces, and
      // RLS keeps it inside the caller's tenant.
      await request.withTenant((tx) =>
        tx.agentMembership.update({
          where: {
            licenseId_agentId: { licenseId: tenant.licenseId, agentId: principal.accountId },
          },
          data: { notifyEmail: parsed.data.email },
        }),
      );

      return reply.send({ email: parsed.data.email });
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

        // No-op when already in the requested state: return the current agent
        // without writing a second, misleading audit entry.
        if (target.suspended === suspended) return target;

        const next = await tx.agentMembership.update({
          where: { licenseId_agentId: { licenseId: target.licenseId, agentId } },
          data: { suspended },
          include: { agent: { select: agentSelect } },
        });

        await writeAuditEntry(tx, request.auditContext(), {
          action: suspended ? 'member.suspended' : 'member.unsuspended',
          target: `account:${agentId}`,
          metadata: { role: targetRole },
        });

        return next;
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

      return reply.send({
        items: groups.map((g) => ({
          id: Number(g.id),
          name: g.name,
          language_code: g.languageCode,
          agents: g.agents.map((a) => ({ agent_id: a.agentId, priority: a.priority })),
        })),
      });
    },
  );
}
