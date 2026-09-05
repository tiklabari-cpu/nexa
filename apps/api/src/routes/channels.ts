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
import { selfAccountId } from '../services/auth/principal.js';
import { writeAuditEntry } from '../services/audit/audit-log.js';
import { TicketService } from '../services/tickets/ticket-service.js';
import { ChatService } from '../services/chat/chat-service.js';
import { RealtimePublisher } from '../services/realtime/publisher.js';
import { ChannelService } from '../services/channels/channel-service.js';
import { isChannelType, type ChannelType } from '../services/channels/channel-adapter.js';
import {
  ingestInboundEmail,
  parseRecipient,
  parseSender,
} from '../services/channels/email-inbound.js';
import {
  InboundEmailAddressService,
  addressFor,
} from '../services/channels/inbound-email-address.js';

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

/**
 * The message-log read filters (M-CHOBS-a).
 *
 * `limit` has no upper bound in the schema — the service clamps it to the max
 * rather than rejecting, so an over-large page is answered, not refused. Zero,
 * negatives and non-integers are still a 400: they are wrong, not merely large.
 * `direction` is the closed `channel_messages_direction_check` vocabulary, so
 * a typo is a 400 rather than a silently-empty list.
 */
const messageQuery = z.object({
  limit: z.coerce.number().int().min(1).optional(),
  page_id: z.string().max(512).optional(),
  direction: z.enum(['inbound', 'outbound']).optional(),
  chat_id: z.string().trim().min(1).max(64).optional(),
  date_from: z.coerce.date().optional(),
  date_to: z.coerce.date().optional(),
});

/** The `:type` path segment, narrowed to a real adapter channel or a 404. */
function channelTypeParam(value: string): ChannelType {
  if (!isChannelType(value)) throw ApiError.notFound('Unknown channel.');
  return value;
}

/** Who a test message comes from when the caller has no account behind it. */
const TEST_SENDER = 'test@nexa.example';

/** The one field defining an address takes; the service owns the vocabulary. */
const addressBody = z.object({ label: z.string().trim().min(1).max(32) });

/**
 * What a pre-tenant recipient resolve answers with. `address_id` is absent from
 * `auth_resolve_organization_license` (it predates addresses having rows) and
 * present from `email_resolve_inbound_address`, so the shared shape carries it
 * as optional rather than forcing two call sites to diverge.
 */
interface InboundRecipientMatch {
  license_id: bigint;
  organization_id: string;
  license_status: string;
  address_id?: string | null;
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
  const emailAddresses = new InboundEmailAddressService(env.INBOUND_EMAIL_DOMAIN);
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

  // --- The message log: what actually crossed the channel ---------------------

  /**
   * Read side of `channel_messages` (M-CHOBS-a). The table had a writer and no
   * reader, so "did that reply really go out" was a question only a psql prompt
   * could answer — and e2e, which cannot see the provider, had to stop at the
   * composer.
   *
   * Gated on `channels--all:ro` (or the write scope, which subsumes it — the
   * same pair `GET /channels` takes). Deliberately *not* the read scope alone
   * being widened: these rows carry the customer's own words, so the door stays
   * the channel-administration door rather than the inbox one. RLS confines the
   * result to the caller's workspace; no clause here does.
   */
  app.get<{ Params: { type: string } }>(
    '/channels/:type/messages',
    { config: { scopes: ['channels--all:ro', 'channels--all:rw'] } },
    async (request, reply) => {
      const type = channelTypeParam(request.params.type);
      const query = parse(messageQuery, request.query);
      if (query.date_from && query.date_to && query.date_from > query.date_to) {
        throw ApiError.validation('`date_from` must be before `date_to`.');
      }

      const result = await request.withTenant((tx) =>
        channels.listMessages(tx, type, {
          ...(query.limit !== undefined ? { limit: query.limit } : {}),
          ...(query.page_id ? { pageId: query.page_id } : {}),
          ...(query.direction ? { direction: query.direction } : {}),
          ...(query.chat_id ? { chatId: query.chat_id } : {}),
          ...(query.date_from ? { dateFrom: query.date_from } : {}),
          ...(query.date_to ? { dateTo: query.date_to } : {}),
        }),
      );

      return reply.send({
        items: result.items,
        ...(result.nextPageId ? { next_page_id: result.nextPageId } : {}),
      });
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
      // The outcome carries its own status now: a message the spam filter drops
      // is `ignored`, and — like the e-mail path — still a 200, so the provider
      // does not retry something that was refused on purpose.
      const result = await channels.ingestInbound(app.db, chats, type, request.body);
      return reply.send(result);
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
    const recipient = parseRecipient(body.to);
    if (!recipient) throw ApiError.notFound('Unknown recipient.');
    const sender = parseSender(body.from);
    if (!sender) throw ApiError.validation('from: a valid sender address is required.');

    // Two resolves, one per address shape, because they answer different
    // questions. The default address is still resolved from the organization id
    // exactly as it always was, so a workspace that never defined a labelled
    // address is unaffected by any of this, whether or not its row exists yet.
    // A labelled address has to *exist*, and only the table knows that.
    const matches =
      recipient.label === null
        ? await app.db.$queryRaw<InboundRecipientMatch[]>(
            Prisma.sql`SELECT * FROM auth_resolve_organization_license(${recipient.organizationId}::uuid)`,
          )
        : await app.db.$queryRaw<InboundRecipientMatch[]>(
            Prisma.sql`SELECT * FROM email_resolve_inbound_address(${recipient.localPart})`,
          );

    const match = matches[0];
    // Absent, or a workspace that is closed: the address no longer accepts mail.
    // A 4xx tells the provider this is permanent, not something to retry. An
    // undefined label lands here too — an address nobody created accepts nothing.
    if (!match || match.license_status === 'canceled') {
      throw ApiError.notFound('Unknown recipient.');
    }

    const tenant = { licenseId: match.license_id, organizationId: match.organization_id };
    const result = await withTenant(app.db, tenant, async (tx) => {
      // The default address materialises its row on first use, so a ticket can
      // name the mailbox it arrived at even for the address that predates the
      // table (FR-MOD-08.5.3).
      const addressId = match.address_id ?? (await emailAddresses.ensureDefault(tx, tenant)).id;
      return ingestInboundEmail(tx, tenant, tickets, {
        senderEmail: sender.email,
        senderName: sender.name,
        subject: body.subject,
        spam: body.spam,
        addressId,
      });
    });

    return reply.send(result);
  });

  // --- Forwarding addresses: which mailboxes this workspace accepts mail at ---
  //
  // The console half of FR-MOD-08.5.3. Behind the same `channels--all` door as
  // the rest of channel administration, and confined to the caller's workspace
  // by RLS; nothing here carries a tenant predicate of its own.

  app.get(
    '/channels/email/addresses',
    { config: { scopes: ['channels--all:ro', 'channels--all:rw'] } },
    async (request, reply) => {
      const tenant = request.tenant();
      const items = await request.withTenant((tx) => emailAddresses.list(tx, tenant));
      return reply.send({ domain: env.INBOUND_EMAIL_DOMAIN, items });
    },
  );

  app.post(
    '/channels/email/addresses',
    { config: { scopes: ['channels--all:rw'] } },
    async (request, reply) => {
      const { label } = parse(addressBody, request.body);
      const tenant = request.tenant();
      const created = await request.withTenant(async (tx) => {
        const address = await emailAddresses.create(tx, tenant, label);
        // The address itself is the interesting half of this entry: it is a new
        // door customer mail can arrive through, and which one opened is the
        // point. Unlike a channel credential it is not a secret — the workspace
        // hands it to a mail provider — so it is recorded rather than withheld.
        await writeAuditEntry(tx, request.auditContext(), {
          action: 'email_address.created',
          target: `email_address:${address.id}`,
          metadata: { address: address.address },
        });
        return address;
      });
      return reply.status(201).send(created);
    },
  );

  app.delete<{ Params: { addressId: string } }>(
    '/channels/email/addresses/:addressId',
    { config: { scopes: ['channels--all:rw'] } },
    async (request, reply) => {
      const tenant = request.tenant();
      const { addressId } = request.params;
      await request.withTenant(async (tx) => {
        const removed = await emailAddresses.remove(tx, addressId);
        await writeAuditEntry(tx, request.auditContext(), {
          action: 'email_address.deleted',
          target: `email_address:${addressId}`,
          metadata: {
            address: addressFor(tenant.organizationId, removed.label, env.INBOUND_EMAIL_DOMAIN),
          },
        });
      });
      return reply.status(204).send();
    },
  );

  app.post<{ Params: { addressId: string } }>(
    '/channels/email/addresses/:addressId/test',
    { config: { scopes: ['channels--all:rw'] } },
    async (request, reply) => {
      const tenant = request.tenant();
      const accountId = selfAccountId(request.requirePrincipal());

      const result = await request.withTenant(async (tx) => {
        const address = await emailAddresses.load(tx, request.params.addressId);
        // Addressed from the agent who asked, so the ticket it produces names a
        // real person somebody can answer rather than a fictional customer. A
        // caller with no account behind it (a bot token) falls back to a fixed
        // address; the pipeline it exercises is identical either way.
        const account = accountId
          ? await tx.account.findUnique({ where: { id: accountId }, select: { email: true } })
          : null;
        const sender = parseSender(account?.email ?? TEST_SENDER) ?? {
          email: TEST_SENDER,
          name: null,
        };
        // Deliberately the same call the provider webhook makes, with the same
        // spam gate and the same customer matching: a test that took a shortcut
        // past the pipeline would prove nothing about the pipeline. `spam:
        // false` stands in for the provider's verdict, not for a bypass — a
        // workspace whose own filter would drop this still sees it dropped.
        const ingested = await ingestInboundEmail(tx, tenant, tickets, {
          senderEmail: sender.email,
          senderName: sender.name,
          subject: 'Nexa test message',
          spam: false,
          addressId: address.id,
        });
        if (ingested.status !== 'created') {
          throw ApiError.validation('The workspace spam filter dropped the test message.');
        }
        return {
          ticket_id: ingested.ticket_id,
          address: addressFor(tenant.organizationId, address.label, env.INBOUND_EMAIL_DOMAIN),
        };
      });

      return reply.send(result);
    },
  );
}
