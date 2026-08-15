/**
 * Inbound channels — the asynchronous door into the inbox (FR-MOD-08.5.3).
 *
 * Email is the first: a mail provider parses a forwarded message and posts it
 * here. The route is public because no session exists yet — the recipient
 * address *is* the credential, resolved to a licence the same SECURITY DEFINER
 * way the hosted Chat page resolves one (Dilim 9). Everything past that runs
 * inside `withTenant`, so RLS holds the write to the licence the address named.
 *
 * The provider is mocked in this build (PLAN A4); a real deployment signs the
 * webhook. `INBOUND_EMAIL_SECRET`, when set, stands in for that signature.
 */
import { Buffer } from 'node:buffer';
import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import type { Env } from '../config/env.js';
import { ApiError } from '../lib/api-error.js';
import { withTenant } from '../lib/tenant.js';
import { writeAuditEntry } from '../services/audit/audit-log.js';
import { TicketService } from '../services/tickets/ticket-service.js';
import { ChatService } from '../services/chat/chat-service.js';
import { RealtimePublisher } from '../services/realtime/publisher.js';
import { ChannelService } from '../services/channels/channel-service.js';
import { isChannelType, type ChannelType } from '../services/channels/channel-adapter.js';
import {
  ingestInboundEmail,
  parseSender,
  recipientOrganizationId,
} from '../services/channels/email-inbound.js';

const outboundBody = z
  .object({
    text: z.string().trim().min(1).max(10_000),
    /** Address the reply by the chat it belongs to… */
    chat_id: z.string().trim().min(1).max(64).optional(),
    /** …or directly by the recipient's channel identity. Exactly one. */
    external_id: z.string().trim().min(1).max(128).optional(),
  })
  .refine((body) => Boolean(body.chat_id) !== Boolean(body.external_id), {
    message: 'Provide exactly one of chat_id or external_id.',
  });

/** The `:type` path segment, narrowed to a real adapter channel or a 404. */
function channelTypeParam(value: string): ChannelType {
  if (!isChannelType(value)) throw ApiError.notFound('Unknown channel.');
  return value;
}

const inboundBody = z.object({
  to: z.string().min(1).max(320),
  from: z.string().min(1).max(320),
  subject: z.string().max(998).default(''),
  // Accepted so the shape matches what a parse webhook sends, but not stored:
  // the ticket core carries no body (see TicketService).
  text: z.string().max(100_000).optional(),
  spam: z.boolean().default(false),
});

function parse<T extends z.ZodTypeAny>(schema: T, value: unknown): z.infer<T> {
  const result = schema.safeParse(value);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw ApiError.validation(
      issue ? `${issue.path.join('.') || 'body'}: ${issue.message}` : 'Invalid request.',
    );
  }
  return result.data;
}

/** Constant-time compare, so a wrong secret cannot be guessed a byte at a time. */
function secretMatches(provided: string | undefined, expected: string): boolean {
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export default async function channelRoutes(
  app: FastifyInstance,
  options: { env: Env },
): Promise<void> {
  const { env } = options;
  const tickets = new TicketService();
  const channels = new ChannelService();
  const publisher = new RealtimePublisher(app.redis, app.log);
  // The same chat core the widget uses — so a channel message routes, delivers
  // over realtime and counts toward AI resolution exactly like a Website chat.
  const chats = new ChatService(app.db, app.redis, publisher);

  // --- Adapter channels: connect / list / disconnect (the `channels` consumer)

  app.get(
    '/channels',
    { config: { scopes: ['channels--all:ro', 'channels--all:rw'] } },
    async (request, reply) => {
      const items = await request.withTenant((tx) => channels.list(tx));
      return reply.send({ items });
    },
  );

  app.post<{ Params: { type: string } }>(
    '/channels/:type/connect',
    { config: { scopes: ['channels--all:rw'] } },
    async (request, reply) => {
      const type = channelTypeParam(request.params.type);
      const tenant = request.tenant();
      const channel = await request.withTenant(async (tx) => {
        const result = await channels.connect(tx, tenant, type, request.body);
        // The bot token / API key / webhook secret and the address itself
        // (number, @handle, mailbox) stay out — the `channels` row already
        // holds them; the entry names only what kind of channel and brand.
        await writeAuditEntry(tx, request.auditContext(), {
          action: 'channel.connected',
          target: `channel:${type}`,
          metadata: { type, brand_id: result.brand_id },
        });
        return result;
      });
      return reply.send(channel);
    },
  );

  app.post<{ Params: { type: string } }>(
    '/channels/:type/disconnect',
    { config: { scopes: ['channels--all:rw'] } },
    async (request, reply) => {
      const type = channelTypeParam(request.params.type);
      const changed = await request.withTenant(async (tx) => {
        const count = await channels.disconnect(tx, type);
        // Only a disconnect that actually changed something is worth an entry
        // — a 404 (nothing connected) is not an event.
        if (count > 0) {
          await writeAuditEntry(tx, request.auditContext(), {
            action: 'channel.disconnected',
            target: `channel:${type}`,
            metadata: { type },
          });
        }
        return count;
      });
      // Nothing changed means no such connected channel in this tenant — 404
      // keeps that indistinguishable from another tenant's (NFR-S5).
      if (changed === 0) throw ApiError.notFound('Channel not found.');
      return reply.status(204).send();
    },
  );

  // --- Outbound: an agent reply leaves through the channel (mock) -------------

  app.post<{ Params: { type: string } }>(
    '/channels/:type/messages',
    { config: { scopes: ['channels--all:rw'] } },
    async (request, reply) => {
      const type = channelTypeParam(request.params.type);
      const body = parse(outboundBody, request.body);
      const tenant = request.tenant();

      const result = await request.withTenant((tx) =>
        channels.sendOutbound(tx, tenant, type, {
          text: body.text,
          ...(body.chat_id ? { chatId: body.chat_id } : {}),
          ...(body.external_id ? { externalId: body.external_id } : {}),
        }),
      );
      return reply.send(result);
    },
  );

  // --- Inbound: a provider webhook becomes a chat -----------------------------
  //
  // Public because no session exists when a provider calls in — the channel
  // address in the body is what routes it to a workspace. The provider is mocked
  // in this build (MASTER-PROMPT §5); a real deployment verifies its signature
  // at the edge (§9, out of scope).

  app.post<{ Params: { type: string } }>(
    '/channels/:type/webhook',
    { config: { public: true } },
    async (request, reply) => {
      const type = channelTypeParam(request.params.type);
      const result = await channels.ingestInbound(app.db, chats, type, request.body);
      return reply.send({ status: 'accepted', ...result });
    },
  );

  app.post('/channels/email/inbound', { config: { public: true } }, async (request, reply) => {
    if (env.INBOUND_EMAIL_SECRET) {
      const header = request.headers['x-inbound-secret'];
      const provided = Array.isArray(header) ? header[0] : header;
      if (!secretMatches(provided, env.INBOUND_EMAIL_SECRET)) {
        throw ApiError.authentication('Invalid inbound webhook secret.');
      }
    }

    const body = parse(inboundBody, request.body);

    // Both are transport concerns, settled before any tenant context: the
    // recipient names the workspace, the sender names the customer.
    const organizationId = recipientOrganizationId(body.to);
    if (!organizationId) throw ApiError.notFound('Unknown recipient.');
    const sender = parseSender(body.from);
    if (!sender) throw ApiError.validation('from: a valid sender address is required.');

    const matches = await app.db.$queryRaw<
      Array<{ license_id: bigint; organization_id: string; license_status: string }>
    >(Prisma.sql`SELECT * FROM auth_resolve_organization_license(${organizationId}::uuid)`);

    const match = matches[0];
    // Absent, or a workspace that is closed: the address no longer accepts mail.
    // A 4xx tells the provider this is permanent, not something to retry.
    if (!match || match.license_status === 'canceled') {
      throw ApiError.notFound('Unknown recipient.');
    }

    const tenant = { licenseId: match.license_id, organizationId: match.organization_id };
    const result = await withTenant(app.db, tenant, (tx) =>
      ingestInboundEmail(tx, tenant, tickets, {
        senderEmail: sender.email,
        senderName: sender.name,
        subject: body.subject,
        spam: body.spam,
      }),
    );

    return reply.send(result);
  });
}
