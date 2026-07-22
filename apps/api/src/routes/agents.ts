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
import { ROUTING_STATUSES } from '@nexa/types';
import { ApiError } from '../lib/api-error.js';
import { RealtimePublisher } from '../services/realtime/publisher.js';
import { RoutingService } from '../services/routing/routing-service.js';

const routingStatusBody = z.object({ routing_status: z.enum(ROUTING_STATUSES) });

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

  app.get(
    '/agents',
    { config: { scopes: ['agents--all:ro', 'agents--my:ro'] } },
    async (request, reply) => {
      const agents = await request.withTenant((tx) =>
        tx.agentMembership.findMany({
          where: { suspended: false },
          include: { agent: { select: { id: true, name: true, email: true, avatarUrl: true } } },
          orderBy: { createdAt: 'asc' },
        }),
      );

      return reply.send({
        items: agents.map((m) => ({
          id: m.agent.id,
          name: m.agent.name,
          email: m.agent.email,
          avatar_url: m.agent.avatarUrl,
          role: m.role,
          routing_status: m.routingStatus,
          concurrent_chats_limit: m.concurrentChatsLimit,
          two_factor_enabled: m.twoFactorEnabled,
        })),
      });
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
