/**
 * Agent availability.
 *
 * Going `accepting_chats` is the other moment capacity appears — the first
 * being a chat closing — so it drains the queue too. Without that, an agent who
 * comes online to an empty screen sits idle while customers wait for the next
 * arrival to trigger assignment.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ROUTING_STATUSES, type AgentRole } from '@nexa/types';
import { ApiError } from '../lib/api-error.js';
import { RealtimePublisher } from '../services/realtime/publisher.js';
import { RoutingService } from '../services/routing/routing-service.js';
import { roleAtLeast } from '../services/auth/principal.js';
import { writeAuditEntry } from '../services/audit/audit-log.js';

const routingStatusBody = z.object({ routing_status: z.enum(ROUTING_STATUSES) });
const notificationPrefsBody = z.object({ email: z.boolean() });
const listAgentsQuery = z.object({ status: z.enum(['active', 'suspended', 'all']).default('active') });
const suspensionBody = z.object({ suspended: z.boolean() });

/** One shape for an agent membership, so the list and the suspension reply never drift. */
type MembershipWithAgent = {
  role: string;
  routingStatus: string;
  concurrentChatsLimit: number;
  twoFactorEnabled: boolean;
  suspended: boolean;
  agent: { id: string; name: string; email: string; avatarUrl: string | null };
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
          include: { agent: { select: { id: true, name: true, email: true, avatarUrl: true } } },
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
          include: { agent: { select: { id: true, name: true, email: true, avatarUrl: true } } },
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
          include: { agent: { select: { id: true, name: true, email: true, avatarUrl: true } } },
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
