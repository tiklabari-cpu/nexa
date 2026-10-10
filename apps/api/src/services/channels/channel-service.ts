/**
 * Channel adapters — the consumer the `channels` table never had (PLAN §8).
 *
 * This is the provider-agnostic half of the omnichannel adapters (FR-MOD-08.5.4
 * -.6): connecting a channel, resolving an inbound provider webhook to a chat,
 * and sending an agent reply back out. The provider-specific parts live in the
 * adapters (`messenger`/`sms`/`whatsapp`); everything here is written once.
 *
 * Inbound reuses the chat core rather than re-implementing it. The external
 * sender is resolved to a customer (reused on return via `channel_identities`),
 * a `CustomerPrincipal` is built for them, and the message goes through the same
 * `ChatService.start` / `sendEvent` the widget uses — so routing, the one-active
 * -chat invariant, realtime delivery and AI-resolution accounting all apply for
 * free, exactly as they do for a Website chat.
 *
 * Isolation is enforced by RLS: every write below runs inside `withTenant`, so a
 * channel, identity or message-log row belongs to exactly one licence and
 * another tenant's rows are invisible (NFR-S5). The one pre-tenant step —
 * turning the address a provider names into a licence — goes through the
 * `channel_resolve_license` SECURITY DEFINER function, because no session exists
 * when a provider calls in.
 *
 * Telegram can also run live (tm 263, `telegram-live.ts`): built with a
 * {@link TelegramLive}, this service keeps the bot token encrypted on the
 * channel row, sends replies through the real Bot API, and resolves the live
 * webhook by channel id (`channel_webhook_target`). Without one it is exactly
 * the mock it was.
 */
import { randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import { ApiError } from '../../lib/api-error.js';
import {
  channelCredentialAad,
  decryptCredential,
  encryptCredential,
} from '../../lib/credential-cipher.js';
import { maskCardNumbers } from '../../lib/cc-mask.js';
import { withTenant, type TenantClient, type TenantContext } from '../../lib/tenant.js';
import type { ChatService } from '../chat/chat-service.js';
import type { CustomerPrincipal } from '../auth/principal.js';
import { evaluateSpam, isSpamFilterEnabled } from '../security/spam-filter.js';
import { getAdapter } from './registry.js';
import type { ChannelType, NormalizedInbound } from './channel-adapter.js';
import { hashWebhookSecret, type TelegramLive } from './telegram-live.js';

/** The channel `status` values the `channels_status_check` constraint allows
 *  that matter here: `connected` (on) and `off`. */
const CONNECTED = 'connected';
const OFF = 'off';

/**
 * The refusal both halves of the address-ownership guard raise (08.5.7-d).
 *
 * Deliberately says nothing about *who* holds the address. That the address is
 * taken is unavoidable — it is the rejection — but naming the workspace behind
 * it would turn a public page id into a lookup for "which company uses SiyahTuş"
 * (NFR-S5). `validation` (400) rather than a new conflict type: the contract
 * already documents 400 here, so the client story is unchanged.
 */
function addressTaken(): ApiError {
  return ApiError.validation('That channel address is already connected.');
}

/** A unique-index violation, as Prisma reports it (same probe as websites.ts). */
function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

export interface ConnectedChannel {
  type: string;
  /** The brand this channel belongs to (Multibrand, PRD §5.3). */
  brand_id: string;
  status: string;
  /** The workspace's channel address (page id / phone number), or null if off. */
  address: string | null;
  connected: boolean;
  created_at: string;
  /** True for a channel connected to its real provider (tm 263 — a live Telegram bot). */
  live: boolean;
}

interface ChannelRow {
  type: string;
  brandId: string;
  status: string;
  config: Prisma.JsonValue;
  createdAt: Date;
  credentialCiphertext: string | null;
}

const CHANNEL_SELECT = {
  type: true,
  brandId: true,
  status: true,
  config: true,
  createdAt: true,
  credentialCiphertext: true,
} as const;

/** The live Telegram channel this service runs, when the deployment switched it on (tm 263). */
export interface LiveTelegramOptions {
  live: TelegramLive;
  /** `APPS_CREDENTIAL_KEY`. */
  credentialKey: string;
}

/** Where a live Telegram connect is going, resolved before Telegram is told. */
export interface TelegramLiveTarget {
  channelId: string;
  brandId: string;
}

/**
 * What an inbound webhook became.
 *
 * `ignored` mirrors the inbound-email result rather than an error status: the
 * provider did nothing wrong and must not retry a message that was dropped on
 * purpose, so the call still succeeds.
 */
export type InboundOutcome =
  | { status: 'accepted'; chat_id: string; customer_id: string }
  | { status: 'ignored'; reason: 'spam' };

export interface OutboundOutcome {
  provider_message_id: string;
  external_id: string;
  chat_id: string | null;
}

/** One row of the message log, as the read surface returns it. */
export interface ChannelMessageItem {
  id: string;
  direction: string;
  external_id: string;
  chat_id: string | null;
  text: string | null;
  provider_message_id: string | null;
  created_at: string;
}

export interface ChannelMessageListOptions {
  /** Clamped to [1, 100]; defaults to 25. Over the max is clamped, not rejected. */
  limit?: number;
  /** Opaque keyset cursor from a previous page. */
  pageId?: string;
  /** `inbound` or `outbound`; both when omitted. */
  direction?: 'inbound' | 'outbound';
  chatId?: string;
  /** Open-ended when omitted — unlike the audit trail there is no default window. */
  dateFrom?: Date;
  dateTo?: Date;
}

/** Ordering is (created_at DESC, id DESC), so the cursor carries both. */
interface MessageCursor {
  createdAt: string;
  id: string;
}

const MESSAGES_DEFAULT_LIMIT = 25;
const MESSAGES_MAX_LIMIT = 100;

export class ChannelService {
  constructor(private readonly telegram: LiveTelegramOptions | null = null) {}

  /** The live Telegram, when this deployment runs one. */
  get liveTelegram(): TelegramLive | null {
    return this.telegram?.live ?? null;
  }

  // -------------------------------------------------------------------------
  // Connect / list / disconnect — the `channels` table consumer
  // -------------------------------------------------------------------------

  /**
   * Connect a channel (the mock OAuth / provisioning / linking step) and mark it
   * `on`. Upsert on the `(license_id, brand_id, type)` unique key: re-connecting
   * a channel updates its config in place rather than failing or duplicating.
   *
   * Refuses an address another connected channel already owns (08.5.7-d). That
   * check is what makes the inbound side safe: an address is the only thing an
   * unauthenticated webhook presents, so two channels answering to one address
   * would mean a customer's message landing in whichever workspace Postgres
   * returned first (NFR-S4/S5).
   */
  async connect(
    tx: TenantClient,
    tenant: TenantContext,
    type: ChannelType,
    input: unknown,
  ): Promise<ConnectedChannel> {
    const { address, config } = getAdapter(type).parseConnect(input);
    // `address` is stored inside config so the SECURITY DEFINER resolver can find
    // it (`config->>'address'`) without a tenant context.
    const stored = { ...config, address } as Prisma.InputJsonValue;
    // A channel belongs to exactly one brand (brand_id is NOT NULL). Connect
    // under the request's brand when `X-SiyahTus-Brand` named one, otherwise the
    // license default — which is the sole brand for a single-brand workspace.
    const brandId = tenant.brandId ?? (await this.defaultBrandId(tx));

    await this.assertAddressFree(tx, type, address, tenant.licenseId, brandId);

    try {
      const row = await tx.channel.upsert({
        where: { licenseId_brandId_type: { licenseId: tenant.licenseId, brandId, type } },
        // `connected` is the "on" value the channels_status_check allows (the
        // others are `off` and `soon`).
        create: { licenseId: tenant.licenseId, brandId, type, status: CONNECTED, config: stored },
        update: { status: CONNECTED, config: stored },
        select: CHANNEL_SELECT,
      });
      return this.serialise(row);
    } catch (error) {
      // The check above is check-then-write, so two connects racing on the same
      // address can both pass it. The partial unique index is what actually
      // decides; the loser arrives here and gets the identical refusal, so the
      // outcome is deterministic even though the winner is not.
      if (isUniqueViolation(error)) throw addressTaken();
      throw error;
    }
  }

  /**
   * Refuse `address` if a *different* channel row already holds it while
   * connected.
   *
   * Goes through the SECURITY DEFINER `channel_address_owner` rather than a
   * plain query, because RLS hides other tenants' channels from this session by
   * design — without it the write path could not tell "another workspace owns
   * this" from "nobody does". Compared against `(license, brand)`, the same key
   * the upsert targets, so re-connecting or re-configuring one's own channel
   * stays allowed and a second brand of the same license is refused like anyone
   * else (the resolver answers with a license, not a brand, so two rows are
   * ambiguous even inside one workspace).
   */
  private async assertAddressFree(
    tx: TenantClient,
    type: ChannelType,
    address: string,
    licenseId: bigint,
    brandId: string,
  ): Promise<void> {
    const owners = await tx.$queryRaw<Array<{ license_id: bigint; brand_id: string }>>(
      Prisma.sql`SELECT * FROM channel_address_owner(${type}, ${address})`,
    );
    const heldByAnother = owners.some(
      (owner) => owner.license_id !== licenseId || owner.brand_id !== brandId,
    );
    if (heldByAnother) throw addressTaken();
  }

  /**
   * The license's default brand, resolved under the caller's tenant context.
   * Every license has exactly one (migration backfill / seed / signup), so a
   * channel connected without an explicit brand has a home. Throws rather than
   * inventing one if the invariant is ever broken.
   */
  private async defaultBrandId(tx: TenantClient): Promise<string> {
    const brand = await tx.brand.findFirst({
      where: { isDefault: true },
      select: { id: true },
    });
    if (!brand) throw ApiError.validation('This workspace has no default brand.');
    return brand.id;
  }

  /** Every channel the workspace has ever connected, connected-first is not
   *  meaningful here so oldest-first for a stable order. Brand-scoped by RLS:
   *  under a brand context only that brand's channels are visible. */
  async list(tx: TenantClient): Promise<ConnectedChannel[]> {
    const rows = await tx.channel.findMany({
      orderBy: { createdAt: 'asc' },
      select: CHANNEL_SELECT,
    });
    return rows.map((row) => this.serialise(row));
  }

  /**
   * Turn a channel off. Scoped update under RLS, so an id from another tenant
   * changes nothing and the route answers 404 — ids stay un-enumerable (NFR-S5).
   * The row is kept (not deleted) so its message-log history survives.
   */
  async disconnect(tx: TenantClient, type: ChannelType): Promise<number> {
    const { count } = await tx.channel.updateMany({
      where: { type, status: { not: OFF } },
      // A live channel's token and webhook secret go with it: an off channel
      // has nothing left to authenticate or to send with (tm 263).
      data: { status: OFF, credentialCiphertext: null, webhookSecretHash: null },
    });
    return count;
  }

  // -------------------------------------------------------------------------
  // Live Telegram (tm 263)
  // -------------------------------------------------------------------------

  /**
   * Where a live Telegram connect will write: this brand's existing Telegram
   * row if there is one, else a fresh id — decided before Telegram is told,
   * because the webhook URL names the row. Refuses a bot another workspace has
   * connected, as every channel's connect does.
   */
  async telegramLiveTarget(
    tx: TenantClient,
    tenant: TenantContext,
    username: string,
  ): Promise<TelegramLiveTarget> {
    const brandId = tenant.brandId ?? (await this.defaultBrandId(tx));
    await this.assertAddressFree(tx, 'telegram', username, tenant.licenseId, brandId);
    const existing = await tx.channel.findFirst({
      where: { licenseId: tenant.licenseId, brandId, type: 'telegram' },
      select: { id: true },
    });
    return { channelId: existing?.id ?? randomUUID(), brandId };
  }

  /** Store a verified live bot: token encrypted to this row, only the secret's hash kept. */
  async storeTelegramLive(
    tx: TenantClient,
    tenant: TenantContext,
    input: TelegramLiveTarget & { username: string; token: string; secret: string },
  ): Promise<ConnectedChannel> {
    const telegram = this.requireLiveTelegram();
    const config = { bot_username: input.username, address: input.username, live: true };
    const data = {
      status: CONNECTED,
      config: config as Prisma.InputJsonValue,
      credentialCiphertext: encryptCredential(
        input.token,
        telegram.credentialKey,
        channelCredentialAad(String(tenant.licenseId), input.channelId),
      ),
      webhookSecretHash: hashWebhookSecret(input.secret),
    };
    try {
      const row = await tx.channel.upsert({
        where: {
          licenseId_brandId_type: {
            licenseId: tenant.licenseId,
            brandId: input.brandId,
            type: 'telegram',
          },
        },
        create: {
          id: input.channelId,
          licenseId: tenant.licenseId,
          brandId: input.brandId,
          type: 'telegram',
          ...data,
        },
        update: data,
        select: { ...CHANNEL_SELECT, id: true },
      });
      // The row that existed when the target was read is the row Telegram was
      // pointed at; a concurrent connect that replaced it would leave the
      // webhook naming a row with another secret, so say so instead.
      if (row.id !== input.channelId) throw addressTaken();
      return this.serialise(row);
    } catch (error) {
      if (isUniqueViolation(error)) throw addressTaken();
      throw error;
    }
  }

  /**
   * The live bot token of this workspace's `type` channel, decrypted, or null
   * — read before a disconnect so the webhook can be removed at Telegram after
   * the row is off.
   */
  async liveToken(
    tx: TenantClient,
    tenant: TenantContext,
    type: ChannelType,
  ): Promise<string | null> {
    if (type !== 'telegram' || !this.telegram) return null;
    const row = await tx.channel.findFirst({
      where: { type, status: CONNECTED },
      select: { id: true, credentialCiphertext: true },
    });
    if (!row?.credentialCiphertext) return null;
    try {
      return decryptCredential(
        row.credentialCiphertext,
        this.telegram.credentialKey,
        channelCredentialAad(String(tenant.licenseId), row.id),
      );
    } catch {
      return null;
    }
  }

  /**
   * The live webhook's door (`POST /channels/telegram/webhook/{id}`): resolve
   * the channel by id before any tenant context exists, check Telegram's
   * secret header in constant time, then hand the update to the same inbound
   * path every channel takes. An unknown id and a wrong secret are the same
   * 401, so the path cannot be used to learn which ids exist.
   */
  async ingestTelegramLive(
    db: PrismaClient,
    chats: ChatService,
    channelId: string,
    secretHeader: string | undefined,
    body: unknown,
  ): Promise<InboundOutcome | { status: 'ignored'; reason: 'unsupported_update' }> {
    const telegram = this.requireLiveTelegram();
    const rows = /^[0-9a-f-]{36}$/i.test(channelId)
      ? await db.$queryRaw<
          Array<{
            license_id: bigint;
            organization_id: string;
            license_status: string;
            channel_type: string;
            address: string | null;
            webhook_secret_hash: string;
          }>
        >(Prisma.sql`SELECT * FROM channel_webhook_target(${channelId}::uuid)`)
      : [];
    const target = rows[0];
    if (
      !target ||
      target.channel_type !== 'telegram' ||
      !telegram.live.secretMatches(secretHeader, target.webhook_secret_hash)
    ) {
      throw ApiError.authentication('Invalid webhook secret.');
    }
    if (target.license_status === 'canceled' || !target.address) {
      throw ApiError.notFound('Unknown channel recipient.');
    }
    const normalized = telegram.live.parseUpdate(body, target.address);
    if (!normalized) return { status: 'ignored', reason: 'unsupported_update' };
    return this.ingestNormalized(db, chats, 'telegram', normalized);
  }

  private requireLiveTelegram(): LiveTelegramOptions {
    if (!this.telegram) throw ApiError.notFound('Not found.');
    return this.telegram;
  }

  // -------------------------------------------------------------------------
  // Inbound — provider webhook → chat
  // -------------------------------------------------------------------------

  /**
   * Turn an inbound provider webhook into a chat message. Resolves the licence
   * from the channel address (pre-tenant, SECURITY DEFINER), then reuses the
   * chat core exactly as the widget does.
   *
   * The two visitor-safety gates the widget applies (FR-MOD-08.9.5 masking and
   * FR-MOD-08.9.3 spam) run here rather than in the route, because this is the
   * only entry the provider webhook takes: `routes/customer.ts` guards the
   * widget and `email-inbound.ts` guards e-mail, and a connected channel used to
   * pass neither — so a raw PAN arriving over WhatsApp reached the database
   * while the same digits typed into the widget did not.
   */
  async ingestInbound(
    db: PrismaClient,
    chats: ChatService,
    type: ChannelType,
    payload: unknown,
  ): Promise<InboundOutcome> {
    return this.ingestNormalized(db, chats, type, getAdapter(type).parseInbound(payload));
  }

  /** The provider-agnostic half of {@link ingestInbound}, shared with the live Telegram webhook. */
  async ingestNormalized(
    db: PrismaClient,
    chats: ChatService,
    type: ChannelType,
    normalized: NormalizedInbound,
  ): Promise<InboundOutcome> {
    const tenant = await this.resolveLicense(db, type, normalized.address);

    // Mask before anything reads the text, so the masked value is what the spam
    // classifier sees, what the event stores, what realtime pushes and what the
    // message log keeps — the order `routes/customer.ts` and `email-inbound.ts`
    // both use, and the reason no raw PAN is ever handed to the classifier.
    const maskedText = maskCardNumbers(normalized.text);

    // Looked up, not created: the spam gate below must be able to refuse without
    // leaving a trace, and `resolveCustomer` would already have written a
    // customer and an identity row by the time the verdict is known.
    const knownCustomerId = await withTenant(db, tenant, (tx) =>
      this.findCustomerByIdentity(tx, tenant, type, normalized.externalId),
    );

    const existing = knownCustomerId
      ? await withTenant(db, tenant, (tx) =>
          tx.chat.findFirst({
            where: { customerId: knownCustomerId, active: true },
            select: { id: true },
          }),
        )
      : null;

    // Spam filter (FR-MOD-08.9.3) — the same engine, and deliberately the same
    // scope the widget uses: screen only the message that would OPEN a chat.
    // Screening every message of an established conversation would put the
    // false-positive cost on a legitimate customer mid-thread, who may well
    // paste several links at their agent's request.
    if (!existing && maskedText) {
      const spamFilterOn = await withTenant(db, tenant, (tx) => isSpamFilterEnabled(tx));
      if (evaluateSpam({ filterEnabled: spamFilterOn, text: maskedText }).spam) {
        return { status: 'ignored', reason: 'spam' };
      }
    }

    const customerId =
      knownCustomerId ??
      (await withTenant(db, tenant, (tx) =>
        this.resolveCustomer(tx, tenant, type, normalized.externalId, normalized.senderName),
      ));

    const principal: CustomerPrincipal = {
      kind: 'customer',
      customerId,
      organizationId: tenant.organizationId,
      licenseId: tenant.licenseId,
    };

    // Same two paths the widget's single send endpoint takes: continue the open
    // conversation, or open one. `start` reuses an existing active chat too, so
    // the check is an optimisation, not the safety net.
    let chatId: string;
    if (existing) {
      await chats.sendEvent(tenant, principal, existing.id, {
        type: 'message',
        text: maskedText,
        recipients: 'all',
      });
      chatId = existing.id;
    } else {
      const { chat } = await chats.start(tenant, principal, {
        customerId,
        assignToMe: false,
        initialEvent: { type: 'message', text: maskedText, recipients: 'all' },
      });
      chatId = chat.id;
    }

    await withTenant(db, tenant, (tx) =>
      this.record(tx, tenant, {
        channelType: type,
        direction: 'inbound',
        externalId: normalized.externalId,
        chatId,
        text: maskedText,
      }),
    );

    return { status: 'accepted', chat_id: chatId, customer_id: customerId };
  }

  /**
   * The customer this external sender already maps to, or null for a stranger.
   *
   * The read half of {@link resolveCustomer}: it answers "would this message
   * open a chat?" without writing, which is what lets the spam gate refuse a
   * first contact and leave nothing behind.
   */
  private async findCustomerByIdentity(
    tx: TenantClient,
    tenant: TenantContext,
    type: ChannelType,
    externalId: string,
  ): Promise<string | null> {
    const identity = await tx.channelIdentity.findUnique({
      where: {
        licenseId_channelType_externalId: {
          licenseId: tenant.licenseId,
          channelType: type,
          externalId,
        },
      },
      select: { customerId: true },
    });
    return identity?.customerId ?? null;
  }

  /**
   * The licence a channel address belongs to, or a 4xx the provider reads as
   * permanent. `channel_resolve_license` only matches a channel that is `on`, so
   * a disconnected channel stops accepting inbound at once. A closed workspace
   * is a 404 too — the address no longer routes anywhere.
   *
   * The read half of address ownership (08.5.7-d): more than one match is
   * refused outright rather than resolved to `rows[0]`.
   */
  async resolveLicense(
    db: PrismaClient,
    type: ChannelType,
    address: string,
  ): Promise<TenantContext> {
    const rows = await db.$queryRaw<
      Array<{ license_id: bigint; organization_id: string; license_status: string }>
    >(Prisma.sql`SELECT * FROM channel_resolve_license(${type}, ${address})`);

    // The unique index makes this unreachable for anything written since it
    // exists — which is exactly why the branch stays: it covers what the index
    // cannot, i.e. rows that predate it or a manual write around the service.
    // Taking `rows[0]` there would hand a stranger's message to whichever tenant
    // Postgres listed first, in undefined order and with no trace (NFR-S5).
    // `internal` because the caller did nothing wrong and the invariant is
    // broken on our side: 5xx is logged at error level, so it surfaces instead
    // of hiding behind a routine "unknown recipient" 404.
    if (rows.length > 1) {
      throw ApiError.internal('Channel address is ambiguous.');
    }

    const match = rows[0];
    if (!match || match.license_status === 'canceled') {
      throw ApiError.notFound('Unknown channel recipient.');
    }
    return { licenseId: match.license_id, organizationId: match.organization_id };
  }

  /**
   * The customer behind an external sender id, created on first contact and
   * reused after. The `(license, channel, external_id)` identity is the natural
   * key — matching it keeps a returning sender's history in one conversation
   * rather than spawning a stranger per message.
   */
  async resolveCustomer(
    tx: TenantClient,
    tenant: TenantContext,
    type: ChannelType,
    externalId: string,
    senderName: string | null,
  ): Promise<string> {
    const identity = await tx.channelIdentity.findUnique({
      where: {
        licenseId_channelType_externalId: {
          licenseId: tenant.licenseId,
          channelType: type,
          externalId,
        },
      },
      select: { customerId: true },
    });
    if (identity) {
      await tx.customer.update({
        where: { id: identity.customerId },
        data: { lastActivityAt: new Date() },
      });
      return identity.customerId;
    }

    const customer = await tx.customer.create({
      data: {
        organizationId: tenant.organizationId,
        name: senderName,
        isLead: true,
        lastActivityAt: new Date(),
      },
      select: { id: true },
    });
    await tx.channelIdentity.create({
      data: {
        licenseId: tenant.licenseId,
        channelType: type,
        externalId,
        customerId: customer.id,
      },
    });
    return customer.id;
  }

  // -------------------------------------------------------------------------
  // Outbound — chat reply → provider
  // -------------------------------------------------------------------------

  /**
   * Carry an agent's reply out through the channel the conversation arrived on
   * — the `ChannelDispatcher` the chat core calls after it has committed the
   * event (FR-MOD-08.5.4-.8).
   *
   * Until this existed `sendOutbound` had exactly one caller, the admin
   * `POST /channels/:type/messages`, so an agent answering in the console wrote
   * a message the customer never received: five connected channels were, in
   * practice, a one-way inbox feed.
   *
   * Two rules make it safe to call on *every* agent message:
   *  - a chat with no channel identity is a Website chat, and returns silently;
   *  - a provider failure is logged and swallowed. The reply is already in the
   *    database and on its way to the agent's own screen; throwing here would
   *    turn someone else's outage into a failed request and, with it, a message
   *    the agent believes was never sent.
   */
  async dispatchAgentReply(
    db: PrismaClient,
    tenant: TenantContext,
    chatId: string,
    text: string,
    log?: { error: (obj: object, msg: string) => void },
  ): Promise<void> {
    try {
      const identity = await withTenant(db, tenant, async (tx) => {
        const chat = await tx.chat.findUnique({
          where: { id: chatId },
          select: { customerId: true },
        });
        if (!chat) return null;
        // The channel this customer is reachable on. `findFirst` rather than a
        // keyed read because the identity is keyed by channel, not by chat — a
        // customer who has written from two channels resolves to the one that
        // was created first, which is the conversation they are in.
        return tx.channelIdentity.findFirst({
          where: { customerId: chat.customerId },
          select: { channelType: true },
          orderBy: { createdAt: 'asc' },
        });
      });

      if (!identity) return;

      await withTenant(db, tenant, (tx) =>
        this.sendOutbound(tx, tenant, identity.channelType as ChannelType, { chatId, text }),
      );
    } catch (error) {
      // Includes the ordinary refusals `sendOutbound` raises — a channel the
      // workspace has since disconnected, or a chat with no reply address on it.
      // Those are not errors of the agent's making either, so they take the same
      // path: recorded for an operator, invisible to the request.
      log?.error(
        { err: error, chat_id: chatId, license_id: String(tenant.licenseId) },
        'channel reply delivery failed',
      );
    }
  }

  /**
   * Send an outbound message through a connected channel and log it. Addressed
   * either directly (`externalId`) or by the chat it belongs to (the recipient's
   * identity is looked up from `channel_identities`). Refuses a channel that is
   * not connected, and a chat with no identity on this channel.
   */
  async sendOutbound(
    tx: TenantClient,
    tenant: TenantContext,
    type: ChannelType,
    input: { chatId?: string; externalId?: string; text: string },
  ): Promise<OutboundOutcome> {
    // findFirst by type, not the compound key: RLS already narrows to this
    // license and — under a brand context — to that one brand's channel.
    const channel = await tx.channel.findFirst({
      where: { type },
      select: { id: true, status: true, config: true, credentialCiphertext: true },
    });
    if (!channel || channel.status !== CONNECTED) {
      throw ApiError.validation('That channel is not connected.');
    }

    const externalId = input.externalId ?? (await this.externalIdForChat(tx, type, input.chatId!));
    const config = (channel.config ?? {}) as Record<string, unknown>;

    // A Telegram connected while it was a mock has no token to send with: once
    // the channel is live, a "sent" mock id would be a reply nobody receives.
    if (type === 'telegram' && this.telegram && !channel.credentialCiphertext) {
      throw ApiError.validation(
        'Reconnect Telegram: this channel was connected before it went live.',
        {
          reason: 'channel_needs_reconnect',
        },
      );
    }

    let providerMessageId: string;
    if (type === 'telegram' && channel.credentialCiphertext && this.telegram) {
      // A live bot (tm 263): the reply really leaves, through the Bot API.
      const token = decryptCredential(
        channel.credentialCiphertext,
        this.telegram.credentialKey,
        channelCredentialAad(String(tenant.licenseId), channel.id),
      );
      providerMessageId = await this.telegram.live.sendMessage(token, externalId, input.text);
    } else {
      ({ providerMessageId } = await getAdapter(type).send({
        config,
        externalId,
        text: input.text,
      }));
    }

    await this.record(tx, tenant, {
      channelType: type,
      direction: 'outbound',
      externalId,
      chatId: input.chatId ?? null,
      text: input.text,
      providerMessageId,
    });

    return {
      provider_message_id: providerMessageId,
      external_id: externalId,
      chat_id: input.chatId ?? null,
    };
  }

  /** The sender identity to reply to: the customer of `chatId` as known on this
   *  channel. A chat that never arrived over this channel has no reply address. */
  private async externalIdForChat(
    tx: TenantClient,
    type: ChannelType,
    chatId: string,
  ): Promise<string> {
    const chat = await tx.chat.findUnique({ where: { id: chatId }, select: { customerId: true } });
    if (!chat) throw ApiError.notFound('Chat not found.');

    const identity = await tx.channelIdentity.findFirst({
      where: { channelType: type, customerId: chat.customerId },
      select: { externalId: true },
    });
    if (!identity) {
      throw ApiError.validation('This chat has no identity on that channel.');
    }
    return identity.externalId;
  }

  // -------------------------------------------------------------------------
  // Message log
  // -------------------------------------------------------------------------

  /**
   * A page of what actually crossed this channel, newest first (M-CHOBS-a).
   *
   * The log has had a writer since the adapters landed and no reader at all,
   * which is what made delivery unobservable: `dispatchAgentReply` swallows a
   * provider failure on purpose (a customer's outage must not fail the agent's
   * request), so the row written here was the only evidence a reply had left —
   * and nothing could read it. e2e asserted the console half and stopped.
   *
   * Three things this deliberately does not do:
   *
   *   - **No `license_id` clause.** `tx` comes from `withTenant`, and the
   *     `channel_messages_tenant` policy is the boundary. A copy of it here
   *     would suggest the filter is what protects the tenant, and would be the
   *     more dangerous state once the two drifted apart (NFR-S5). The same
   *     reasoning `audit-log-reader.ts` records.
   *   - **No brand narrowing.** `channel_messages` carries no `brand_id`; the
   *     row is keyed by licence and channel. A brand-scoped caller sees the
   *     licence's whole log for that channel, which is honest — pretending
   *     otherwise would need a join the table cannot serve.
   *   - **No default window.** The audit trail defaults to 30 days because the
   *     PRD bounds it; this log is bounded by the channel instead, and an
   *     operator checking "did last month's reply go out" should not have to
   *     know a hidden cut-off exists.
   *
   * Keyset, not offset: messages arrive continuously, so an offset page shifts
   * under the reader and skips rows. The `(license_id, channel_type,
   * created_at)` index serves the base query directly and
   * `(license_id, chat_id)` serves the `chatId` filter — measured before any
   * new index was considered (`channel-messages.test.ts`).
   */
  async listMessages(
    tx: TenantClient,
    type: ChannelType,
    options: ChannelMessageListOptions = {},
  ): Promise<{ items: ChannelMessageItem[]; nextPageId?: string }> {
    const limit = clampMessageLimit(options.limit);
    const cursor = decodeMessageCursor(options.pageId);

    const filters: Prisma.ChannelMessageWhereInput[] = [{ channelType: type }];
    if (options.direction) filters.push({ direction: options.direction });
    if (options.chatId) filters.push({ chatId: options.chatId });
    if (options.dateFrom || options.dateTo) {
      const createdAt: Prisma.DateTimeFilter = {};
      if (options.dateFrom) createdAt.gte = options.dateFrom;
      if (options.dateTo) createdAt.lte = options.dateTo;
      filters.push({ createdAt });
    }
    if (cursor) {
      const at = new Date(cursor.createdAt);
      filters.push({
        OR: [{ createdAt: { lt: at } }, { createdAt: at, id: { lt: cursor.id } }],
      });
    }

    // One extra row tells us whether another page exists without a second count.
    const rows = await tx.channelMessage.findMany({
      where: { AND: filters },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page.at(-1);

    return {
      items: page.map((row) => ({
        id: row.id,
        direction: row.direction,
        external_id: row.externalId,
        chat_id: row.chatId,
        text: row.text,
        provider_message_id: row.providerMessageId,
        created_at: row.createdAt.toISOString(),
      })),
      ...(hasMore && last
        ? {
            nextPageId: encodeMessageCursor({
              createdAt: last.createdAt.toISOString(),
              id: last.id,
            }),
          }
        : {}),
    };
  }

  private async record(
    tx: TenantClient,
    tenant: TenantContext,
    row: {
      channelType: string;
      direction: 'inbound' | 'outbound';
      externalId: string;
      chatId: string | null;
      text: string;
      providerMessageId?: string;
    },
  ): Promise<void> {
    await tx.channelMessage.create({
      data: {
        licenseId: tenant.licenseId,
        channelType: row.channelType,
        direction: row.direction,
        externalId: row.externalId,
        chatId: row.chatId,
        text: row.text,
        providerMessageId: row.providerMessageId ?? null,
      },
    });
  }

  private serialise(row: ChannelRow): ConnectedChannel {
    const config = (row.config ?? {}) as { address?: unknown };
    const address = typeof config.address === 'string' ? config.address : null;
    return {
      type: row.type,
      brand_id: row.brandId,
      status: row.status,
      // The address is only meaningful while connected; a disconnected channel
      // reports none.
      address: row.status === CONNECTED ? address : null,
      connected: row.status === CONNECTED,
      created_at: row.createdAt.toISOString(),
      live: row.status === CONNECTED && row.credentialCiphertext !== null,
    };
  }
}

/** Clamp rather than reject: a caller asking for too many gets the maximum. */
function clampMessageLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return MESSAGES_DEFAULT_LIMIT;
  return Math.min(Math.max(1, Math.floor(limit)), MESSAGES_MAX_LIMIT);
}

function encodeMessageCursor(cursor: MessageCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

function decodeMessageCursor(pageId: string | undefined): MessageCursor | null {
  if (!pageId) return null;
  try {
    const parsed = JSON.parse(Buffer.from(pageId, 'base64url').toString('utf8')) as MessageCursor;
    // A malformed cursor is a stale bookmark, not an error: start from the top
    // rather than failing the whole request. Same call `audit-log-reader.ts`
    // makes, and the reason the route does not validate it either.
    return typeof parsed?.id === 'string' && typeof parsed?.createdAt === 'string' ? parsed : null;
  } catch {
    return null;
  }
}
