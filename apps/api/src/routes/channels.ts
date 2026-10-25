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
import type { FastifyBaseLogger, FastifyInstance, FastifyRequest } from 'fastify';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import type { Env } from '../config/env.js';
import { ApiError } from '../lib/api-error.js';
import { maskForWrite } from '../lib/sensitive-mask.js';
import { TicketMessageService } from '../services/tickets/ticket-message-service.js';
import { createObjectStore } from '../services/storage/object-store.js';
import { createVirusScanner } from '../services/storage/virus-scanner.js';
import { screenInboundAttachments } from '../services/channels/inbound-email-attachments.js';
import { prepareInboundBody } from '../services/channels/inbound-email-body.js';
import type { WorkspaceEventDispatcher } from '../services/webhooks/workspace-events.js';
import { withTenant } from '../lib/tenant.js';
import { selfAccountId } from '../services/auth/principal.js';
import { writeAuditEntry } from '../services/audit/audit-log.js';
import { TicketService } from '../services/tickets/ticket-service.js';
import { ChatService } from '../services/chat/chat-service.js';
import { RealtimePublisher } from '../services/realtime/publisher.js';
import { ChannelService, type InboundAudit } from '../services/channels/channel-service.js';
import { createLiveTelegram } from '../services/channels/telegram-live.js';
import { createSafeHttp, type SafeHttp } from '../lib/safe-fetch.js';
import {
  DEFAULT_PROVIDER_ENDPOINTS,
  type ProviderEndpoints,
} from '../services/apps/verifiers/types.js';
import { isChannelType, type ChannelType } from '../services/channels/channel-adapter.js';
import {
  inboundAttachmentsAllSensitive,
  ingestInboundEmail,
  isInboundSpam,
  normalizeMessageId,
  parseRecipient,
  parseSender,
  ticketOfMessageId,
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
const TEST_SENDER = 'test@siyahtus.example';

/** What a test message says, so the ticket it opens shows a first message like a real one. */
const TEST_MESSAGE_TEXT =
  'This is a test message from SiyahTuş. Mail sent to this forwarding address becomes a ticket like this one.';

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

/**
 * The provider-neutral mail (`InboundEmail`, tm 357 · HD-02). The bounds are
 * what a request may carry, not what is kept: the text is clipped to
 * `INBOUND_EMAIL_TEXT_MAX` after masking, the HTML dropped past
 * `INBOUND_EMAIL_HTML_MAX`, the files held to their own ceilings — a mail that
 * is merely long is taken in, because a refused webhook is a lost mail.
 */
const inboundBody = z.object({
  to: z.string().min(1).max(320),
  cc: z.array(z.string().max(320)).max(50).default([]),
  from: z.string().min(1).max(320),
  subject: z.string().max(998).default(''),
  text: z.string().max(2_000_000).nullish(),
  html: z.string().max(5_000_000).nullish(),
  message_id: z.string().max(998).nullish(),
  in_reply_to: z.string().max(998).nullish(),
  references: z.array(z.string().max(998)).max(100).default([]),
  // Passed through for HD-04's auto-reply guard (#359); nothing reads them yet.
  headers: z
    .object({
      auto_submitted: z.string().max(200).nullish(),
      precedence: z.string().max(200).nullish(),
      x_autoreply: z.string().max(200).nullish(),
    })
    .default({}),
  attachments: z
    .array(
      z.object({
        filename: z.string().max(255).default('attachment'),
        content_type: z.string().max(255).default('application/octet-stream'),
        size: z.number().int().min(0).optional(),
        content_base64: z.string().max(36_000_000),
      }),
    )
    .max(50)
    .default([]),
  spam: z.boolean().default(false),
});

/**
 * The webhook's request ceiling: 25 MiB of files grow by a third in base64,
 * with the text and the HTML beside them. Every other route keeps the 1 MiB
 * `server.ts` sets.
 */
const INBOUND_EMAIL_BODY_LIMIT = 36 * 1024 * 1024;

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

/**
 * A live Telegram connect (tm 263): the token alone. The bot's username comes
 * from Telegram's `getMe`; one sent here is ignored rather than trusted.
 */
const telegramLiveConnectBody = z.object({
  bot_token: z.string().trim().min(1).max(128),
  bot_username: z.string().trim().max(64).optional(),
});

export default async function channelRoutes(
  app: FastifyInstance,
  options: {
    env: Env;
    /** Fans a committed lifecycle event out to Zapier/Make subscriptions (FR-MOD-09.4). */
    automations?: WorkspaceEventDispatcher;
    /** How a live Telegram reaches the Bot API (tm 263). Omitted, the real safe client. */
    appsHttp?: SafeHttp;
    /** Provider hosts (tm 263). Omitted, the real ones. */
    appsEndpoints?: ProviderEndpoints;
  },
): Promise<void> {
  const { env, automations } = options;
  const tickets = new TicketService();
  // Only the player's side of the conversation is written here, so the mail
  // settings a reply needs (`TICKET_MAIL_OUTBOUND`) do not apply.
  const ticketMessages = new TicketMessageService();
  // Where an e-mailed file is kept and what scans it — the ones every upload uses.
  const store = createObjectStore(env.STORAGE_PROVIDER, env.storage);
  const scanner = createVirusScanner(env.VIRUS_SCANNER);
  const channels = new ChannelService(
    createLiveTelegram(env, {
      http: options.appsHttp ?? createSafeHttp(),
      endpoints: options.appsEndpoints ?? DEFAULT_PROVIDER_ENDPOINTS,
    }),
  );
  const telegramLive = channels.liveTelegram;
  const emailAddresses = new InboundEmailAddressService(env.INBOUND_EMAIL_DOMAIN);
  const publisher = new RealtimePublisher(app.redis, app.log);
  // The same chat core the widget uses — so a channel message routes, delivers
  // over realtime and counts toward AI resolution exactly like a Website chat.
  const chats = new ChatService(
    app.db,
    app.redis,
    publisher,
    undefined,
    undefined,
    undefined,
    undefined,
    automations,
  );

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
    { config: { scopes: ['channels--all:rw'], pilotRefused: true, pilotLiveParam: 'type' } },
    async (request, reply) => {
      const type = channelTypeParam(request.params.type);
      const tenant = request.tenant();
      if (type === 'telegram' && telegramLive) {
        // Live Telegram (tm 263), in three steps so no transaction waits on
        // Telegram: ask whose token this is, decide the row (the webhook URL
        // names it) and point Telegram at it, then store — token encrypted,
        // only the webhook secret's hash.
        const body = parse(telegramLiveConnectBody, request.body);
        telegramLive.assertWebhookReachable();
        telegramLive.assertTokenShape(body.bot_token);
        const { username } = await telegramLive.getMe(body.bot_token);
        const target = await request.withTenant((tx) =>
          channels.telegramLiveTarget(tx, tenant, username),
        );
        const { secret } = await telegramLive.setWebhook(body.bot_token, target.channelId);
        const channel = await request.withTenant(async (tx) => {
          const result = await channels.storeTelegramLive(tx, tenant, {
            ...target,
            username,
            token: body.bot_token,
            secret,
          });
          await writeAuditEntry(tx, request.auditContext(), {
            action: 'channel.connected',
            target: `channel:${type}`,
            metadata: { type, brand_id: result.brand_id, live: true },
          });
          return result;
        });
        return reply.send(channel);
      }
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
      const tenant = request.tenant();
      let liveToken: string | null = null;
      const changed = await request.withTenant(async (tx) => {
        // Read before the row turns off (which drops the token): the webhook is
        // removed at Telegram after commit, best effort (tm 263).
        liveToken = await channels.liveToken(tx, tenant, type);
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
      if (liveToken && telegramLive) {
        const removed = await telegramLive.deleteWebhook(liveToken);
        if (!removed) request.log.warn('telegram deleteWebhook failed after disconnect');
      }
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
    { config: { scopes: ['channels--all:rw'], pilotRefused: true, pilotLiveParam: 'type' } },
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
  //
  // `pilotRefused` (tm 257.3): in the public pilot every one of these doors is
  // shut — the Caddyfile publishes `/api/*`, so an unsigned webhook would be a
  // free ticket/chat writer for anyone, and no provider is wired behind it.
  // Disconnect and the reads stay open so a row connected before the flag was
  // set can still be closed.

  app.post<{ Params: { type: string } }>(
    '/channels/:type/webhook',
    { config: { public: true, pilotRefused: true } },
    async (request, reply) => {
      const type = channelTypeParam(request.params.type);
      // A live Telegram takes updates only on its own, secret-checked path
      // below; this flat mock door authenticates nobody (tm 263).
      if (type === 'telegram' && telegramLive) throw ApiError.notFound('Not found.');
      // The outcome carries its own status now: a message the spam filter drops
      // is `ignored`, and — like the e-mail path — still a 200, so the provider
      // does not retry something that was refused on purpose.
      const result = await channels.ingestInbound(
        app.db,
        chats,
        type,
        request.body,
        inboundAudit(request),
      );
      return reply.send(result);
    },
  );

  /**
   * The live Telegram webhook (tm 263 · FR-MOD-08.5.8). Public — Telegram has
   * no session — but not open: every update must carry the
   * `X-Telegram-Bot-Api-Secret-Token` that `setWebhook` registered, compared
   * in constant time against its hash. Not `pilotRefused`, because it is
   * authenticated; with the live channel off it is a 404 like any unknown path.
   * Whatever arrives that is not a private text message is answered 200 and
   * dropped, so Telegram does not keep retrying it.
   */
  app.post<{ Params: { channelId: string } }>(
    '/channels/telegram/webhook/:channelId',
    { config: { public: true } },
    async (request, reply) => {
      if (!telegramLive) throw ApiError.notFound('Not found.');
      const header = request.headers['x-telegram-bot-api-secret-token'];
      const result = await channels.ingestTelegramLive(
        app.db,
        chats,
        request.params.channelId,
        Array.isArray(header) ? header[0] : header,
        request.body,
        inboundAudit(request),
      );
      return reply.send(result);
    },
  );

  /**
   * A received mail becomes a ticket with its text and files (FR-MOD-08.5.3 ·
   * tm 357 · HD-02), in three steps so nothing slow sits inside a transaction
   * and nothing is stored for a mail that will not be taken in:
   *
   *   1. a short read: has this Message-ID been taken in, is it spam, does the
   *      workspace treat every file as sensitive — a redelivery or a spam mail
   *      stores no file;
   *   2. the files, outside any transaction: checked, scanned, stored
   *      (`screenInboundAttachments`) — a refused one is reported, never fatal;
   *   3. one transaction: customer, ticket, message, the refused files' line
   *      (`ingestInboundEmail`, which takes the Message-ID lock and checks
   *      again, so two racing deliveries still make one ticket). Should that
   *      transaction find the mail already in, the files step 2 stored are
   *      deleted again.
   */
  app.post(
    '/channels/email/inbound',
    { config: { public: true, pilotRefused: true }, bodyLimit: INBOUND_EMAIL_BODY_LIMIT },
    async (request, reply) => {
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
      // NUL is not text Postgres keeps; a mail client may still put one there.
      // eslint-disable-next-line no-control-regex
      const subject = body.subject.replace(/\x00/g, '');
      const mail = prepareInboundBody({ text: body.text, html: body.html });
      const messageId = normalizeMessageId(body.message_id);

      // 1. Before any file is stored.
      const screen = await withTenant(app.db, tenant, async (tx) => ({
        seen: messageId ? await ticketOfMessageId(tx, tenant, messageId) : null,
        spam: await isInboundSpam(tx, {
          maskedSubject: maskForWrite(subject, 'customer').text,
          maskedText: maskForWrite(mail.text, 'customer').text,
          providerFlagged: body.spam,
        }),
        allSensitive: await inboundAttachmentsAllSensitive(tx),
      }));
      if (screen.seen) {
        return reply.send({ status: 'created', ticket_id: screen.seen, duplicate: true });
      }
      if (screen.spam) return reply.send({ status: 'ignored', reason: 'spam' });

      // 2. The files, outside any transaction.
      const files = await screenInboundAttachments(body.attachments, {
        store,
        scanner,
        licenseId: tenant.licenseId,
        subject,
        allSensitive: screen.allSensitive,
      });

      // 3. One transaction.
      const outcome = await withTenant(app.db, tenant, async (tx) => {
        // The default address materialises its row on first use, so a ticket can
        // name the mailbox it arrived at even for the address that predates the
        // table (FR-MOD-08.5.3).
        const addressId = match.address_id ?? (await emailAddresses.ensureDefault(tx, tenant)).id;
        return ingestInboundEmail(
          tx,
          tenant,
          { tickets, messages: ticketMessages },
          {
            senderEmail: sender.email,
            senderName: sender.name,
            subject,
            spam: body.spam,
            addressId,
            body: mail,
            messageId,
            inReplyTo: normalizeMessageId(body.in_reply_to),
            attachments: files.stored,
            rejected: files.rejected,
          },
          (customerId) => inboundAudit(request)(tenant, customerId),
        );
      });

      // A race lost to another delivery of the same mail (or spam after all):
      // nothing points at the files this request stored, so they go again.
      if (outcome.result.status !== 'created' || outcome.result.duplicate) {
        await discardFiles(
          request.log,
          files.stored.map((file) => file.key),
        );
      }
      // After the commit (see `RealtimePublisher`): announced inside the
      // transaction, a listener could read the thread before the message is in it.
      if (outcome.push) {
        await publisher.publish(
          tenant,
          'ticket_message_created',
          outcome.push.audience,
          outcome.push.payload,
        );
      }
      return reply.send(outcome.result);
    },
  );

  /** Best effort: a file left behind is an orphan in the store, never a visible one. */
  async function discardFiles(log: FastifyBaseLogger, keys: readonly string[]): Promise<void> {
    for (const key of keys) {
      try {
        await store.delete(key);
      } catch (error) {
        log.warn({ err: error }, 'inbound email: could not delete an unused attachment');
      }
    }
  }

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
    { config: { scopes: ['channels--all:rw'], pilotRefused: true } },
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
    { config: { scopes: ['channels--all:rw'], pilotRefused: true } },
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
    { config: { scopes: ['channels--all:rw'], pilotRefused: true } },
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
        const ingested = await ingestInboundEmail(
          tx,
          tenant,
          { tickets, messages: ticketMessages },
          {
            senderEmail: sender.email,
            senderName: sender.name,
            subject: 'SiyahTuş test message',
            spam: false,
            addressId: address.id,
            body: prepareInboundBody({ text: TEST_MESSAGE_TEXT }),
          },
          (customerId) => inboundAudit(request)(tenant, customerId),
        );
        if (ingested.result.status !== 'created') {
          throw ApiError.validation('The workspace spam filter dropped the test message.');
        }
        return {
          outcome: ingested,
          ticket_id: ingested.result.ticket_id,
          address: addressFor(tenant.organizationId, address.label, env.INBOUND_EMAIL_DOMAIN),
        };
      });

      if (result.outcome.push) {
        await publisher.publish(
          tenant,
          'ticket_message_created',
          result.outcome.push.audience,
          result.outcome.push.payload,
        );
      }
      return reply.send({ ticket_id: result.ticket_id, address: result.address });
    },
  );
}

/**
 * The audit context an inbound channel message writes under (ID-02 · tm 286.3):
 * the sender, once the workspace and customer are resolved. No address — the
 * request comes from the provider's servers, not from the person.
 */
function inboundAudit(request: FastifyRequest): InboundAudit {
  return (tenant, customerId) =>
    request.auditContext({
      licenseId: tenant.licenseId,
      actorId: customerId,
      actorType: 'customer',
      ip: null,
    });
}
