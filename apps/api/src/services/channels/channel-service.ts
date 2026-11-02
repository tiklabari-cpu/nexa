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
 * `ChatService.openOrContinueConnection` the widget uses — so routing, the
 * one-active-chat invariant, the member's day (ID-02: one chat per member per
 * day, a further connection on a same-day return), realtime delivery and
 * AI-resolution accounting all apply for free, exactly as they do for a Website
 * chat.
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
 *
 * WhatsApp can run live the same way (tm 380, `whatsapp-live.ts`): the
 * business token kept encrypted, replies sent through the Cloud API inside
 * the 24-hour window and refused past it, inbound recorded in the message's
 * own transaction so a redelivered wamid is taken in once
 * (`whatsapp-inbound.ts` owns the webhook's queue).
 *
 * Messenger and Instagram can run live too (tm 381, `meta-messaging-live.ts`):
 * the page token kept encrypted, replies sent through the page inside the
 * same 24-hour window, inbound keyed by the message's `mid` the same way.
 */
import { randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import { isLicenseClosed, type SensitiveType } from '@siyahtus/types';
import { ApiError } from '../../lib/api-error.js';
import {
  channelCredentialAad,
  decryptCredential,
  encryptCredential,
} from '../../lib/credential-cipher.js';
import { maskForWrite } from '../../lib/sensitive-mask.js';
import { withTenant, type TenantClient, type TenantContext } from '../../lib/tenant.js';
import type { AuditContext } from '../audit/audit-log.js';
import type { ChatService } from '../chat/chat-service.js';
import type { CustomerPrincipal } from '../auth/principal.js';
import { evaluateSpam, isSpamFilterEnabled } from '../security/spam-filter.js';
import { getAdapter } from './registry.js';
import type { ChannelType, NormalizedInbound } from './channel-adapter.js';
import {
  markChannelReconnectRequired,
  type ReconnectNoticeOptions,
} from './channel-reconnect-notice.js';
import { hashWebhookSecret, type TelegramLive } from './telegram-live.js';
import {
  WHATSAPP_REPLY_WINDOW_MS,
  WhatsAppGraphError,
  WhatsAppUnreachableError,
  type WhatsAppLive,
} from './whatsapp-live.js';
import { MetaGraphError, MetaGraphUnreachableError } from './meta-graph.js';
import {
  META_REPLY_WINDOW_MS,
  isMetaMessagingChannel,
  type MetaInboundMessage,
  type MetaMessagingChannel,
  type MetaMessagingLive,
  type MetaPage,
} from './meta-messaging-live.js';

/** A live channel's name as an error says it. */
const LIVE_CHANNEL_LABEL: Readonly<Record<string, string>> = {
  whatsapp: 'WhatsApp',
  messenger: 'Messenger',
  instagram: 'Instagram',
  telegram: 'Telegram',
};

function channelLabel(type: string): string {
  return LIVE_CHANNEL_LABEL[type] ?? type;
}

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

/**
 * A reply past WhatsApp's 24-hour window (tm 380). `validation` with its own
 * reason, as every channel refusal here: the closed `ErrorType` vocabulary has
 * no "conflict", and the composer reads the reason to show its band.
 */
function windowClosed(closesAt: string | null, type = 'whatsapp'): ApiError {
  const label = channelLabel(type);
  return ApiError.validation(
    `The ${label} 24-hour window is closed: ${label} only takes free text within 24 hours of the customer’s last message. You can reply when they write again.`,
    { reason: 'channel_window_closed', ...(closesAt ? { closed_at: closesAt } : {}) },
  );
}

/** What a sealed page selection is bound to (tm 381): the workspace and the selection. */
function metaSelectionAad(tenant: TenantContext, selectionId: string): string {
  return `meta-login-selection:${String(tenant.licenseId)}:${selectionId}`;
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
  /**
   * The address as a person reads it, when that differs from the routing key
   * (tm 380 — a live WhatsApp number, whose key is Meta's phone number id).
   */
  display_address: string | null;
  /** The provider refused the live credential (tm 380 — Graph error 190): reconnect it. */
  needs_reconnect: boolean;
}

interface ChannelRow {
  type: string;
  brandId: string;
  status: string;
  config: Prisma.JsonValue;
  createdAt: Date;
  credentialCiphertext: string | null;
  reconnectRequiredAt: Date | null;
}

const CHANNEL_SELECT = {
  type: true,
  brandId: true,
  status: true,
  config: true,
  createdAt: true,
  credentialCiphertext: true,
  reconnectRequiredAt: true,
} as const;

/** The live WhatsApp this service runs, when the deployment switched it on (tm 380). */
export interface LiveWhatsAppOptions {
  live: WhatsAppLive;
  /** `APPS_CREDENTIAL_KEY`. */
  credentialKey: string;
}

/** The live Messenger / Instagram this service runs, when the deployment switched either on (tm 381). */
export interface LiveMetaMessagingOptions {
  live: MetaMessagingLive;
  /** `APPS_CREDENTIAL_KEY`. */
  credentialKey: string;
}

/** What a Messenger / Instagram webhook item became (tm 381). */
export type MetaInboundOutcome =
  InboundOutcome | { status: 'ignored'; reason: 'unknown_recipient' };

export interface ChannelServiceOptions {
  whatsapp?: LiveWhatsAppOptions | null;
  /** Live Messenger / Instagram (tm 381). */
  meta?: LiveMetaMessagingOptions | null;
  /**
   * How a credential the provider refused is announced (tm 380): the mark,
   * the audit entry and the admins' e-mail. Absent, a refusal is still an
   * error to the caller but nothing is marked.
   */
  reconnect?: ReconnectNoticeOptions;
}

/**
 * Whether an agent may write to the customer of a chat now (tm 380). Only a
 * live WhatsApp has a window: free text is allowed for 24 hours after the
 * customer's last message, and F1 sends no templates, so past it nothing goes.
 */
export interface ReplyWindow {
  /** The channel the customer is reached on, or null for a Website chat. */
  channel: string | null;
  /** The channel runs on its real provider. */
  live: boolean;
  open: boolean;
  /** When the window closes (or closed); null where there is none. */
  closes_at: string | null;
}

/**
 * A reply the provider refused because the channel's credential is gone
 * (Graph error 190). Raised inside the caller's transaction; the caller marks
 * the channel after it (`ChannelService.noteSendFailure`), since a mark written
 * in the failing transaction would roll back with it.
 */
export class ChannelCredentialRefusedError extends ApiError {
  constructor(readonly channelType: ChannelType) {
    super(
      'validation',
      `Reconnect ${channelLabel(channelType)} in Settings → Channels: Meta no longer accepts this channel’s connection.`,
      { details: { reason: 'channel_needs_reconnect' } },
    );
  }
}

/** What an inbound message brings beyond its text (tm 380 — a live WhatsApp). */
export interface InboundExtras {
  /** The provider's id for it; with `channelId`, the message is taken in once. */
  providerMessageId?: string;
  channelId?: string;
  /** A file already screened and stored (`/api/v1/uploads/<key>`). */
  attachmentUrl?: string;
  /** When the customer sent it — the reply window runs from here. */
  sentAt?: Date;
  /** What was masked before the text reached this service (the queue holds it masked). */
  sensitiveTypes?: readonly SensitiveType[];
}

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
/**
 * The audit context an inbound message writes under, once its workspace and
 * sender are known (ID-02): a same-day return is recorded as the sender's
 * (`chat.connection_opened`), a rollover close as the system's. A factory,
 * because the webhook reaches this service before either is resolved.
 */
export type InboundAudit = (tenant: TenantContext, customerId: string) => AuditContext;

export type InboundOutcome =
  | { status: 'accepted'; chat_id: string; customer_id: string }
  | { status: 'ignored'; reason: 'spam' | 'duplicate' };

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
  private readonly whatsapp: LiveWhatsAppOptions | null;
  private readonly meta: LiveMetaMessagingOptions | null;

  constructor(
    private readonly telegram: LiveTelegramOptions | null = null,
    private readonly options: ChannelServiceOptions = {},
  ) {
    this.whatsapp = options.whatsapp ?? null;
    this.meta = options.meta ?? null;
  }

  /** The live Messenger / Instagram, when this deployment runs either (tm 381). */
  get liveMeta(): MetaMessagingLive | null {
    return this.meta?.live ?? null;
  }

  /** Whether `type` runs as a live Meta messaging channel here (tm 381). */
  private metaRuns(type: string): type is MetaMessagingChannel {
    return this.meta !== null && this.meta.live.runs(type);
  }

  /** The live Telegram, when this deployment runs one. */
  get liveTelegram(): TelegramLive | null {
    return this.telegram?.live ?? null;
  }

  /** The live WhatsApp, when this deployment runs one (tm 380). */
  get liveWhatsApp(): WhatsAppLive | null {
    return this.whatsapp?.live ?? null;
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
      data: {
        status: OFF,
        credentialCiphertext: null,
        webhookSecretHash: null,
        reconnectRequiredAt: null,
      },
    });
    return count;
  }

  // -------------------------------------------------------------------------
  // Live WhatsApp (tm 380)
  // -------------------------------------------------------------------------

  /**
   * Store a WhatsApp number the embedded signup connected: the business token
   * encrypted to this row, Meta's phone number id as the routing key
   * (`config.address`), the number as people read it beside it. Refuses a
   * number another workspace has connected, as every channel's connect does,
   * and clears an earlier "reconnect needed".
   */
  async storeWhatsAppLive(
    tx: TenantClient,
    tenant: TenantContext,
    input: {
      wabaId: string;
      phoneNumberId: string;
      displayPhoneNumber: string;
      verifiedName: string | null;
      token: string;
    },
  ): Promise<ConnectedChannel> {
    const whatsapp = this.requireLiveWhatsApp();
    const brandId = tenant.brandId ?? (await this.defaultBrandId(tx));
    await this.assertAddressFree(tx, 'whatsapp', input.phoneNumberId, tenant.licenseId, brandId);
    const existing = await tx.channel.findFirst({
      where: { licenseId: tenant.licenseId, brandId, type: 'whatsapp' },
      select: { id: true },
    });
    const channelId = existing?.id ?? randomUUID();
    const config = {
      address: input.phoneNumberId,
      phone_number_id: input.phoneNumberId,
      waba_id: input.wabaId,
      display_phone_number: input.displayPhoneNumber,
      verified_name: input.verifiedName,
      live: true,
    };
    const data = {
      status: CONNECTED,
      config: config as Prisma.InputJsonValue,
      credentialCiphertext: encryptCredential(
        input.token,
        whatsapp.credentialKey,
        channelCredentialAad(String(tenant.licenseId), channelId),
      ),
      webhookSecretHash: null,
      reconnectRequiredAt: null,
    };
    try {
      const row = await tx.channel.upsert({
        where: {
          licenseId_brandId_type: { licenseId: tenant.licenseId, brandId, type: 'whatsapp' },
        },
        create: { id: channelId, licenseId: tenant.licenseId, brandId, type: 'whatsapp', ...data },
        update: data,
        select: { ...CHANNEL_SELECT, id: true },
      });
      // The token was encrypted to the row read above; a concurrent connect
      // that replaced it would leave a token this row cannot decrypt.
      if (row.id !== channelId) throw addressTaken();
      return this.serialise(row);
    } catch (error) {
      if (isUniqueViolation(error)) throw addressTaken();
      throw error;
    }
  }

  /**
   * The business token of a live WhatsApp channel, decrypted, or null when the
   * row holds none (a mock connect) or it no longer decrypts (the key rotated).
   */
  whatsAppToken(
    tenant: TenantContext,
    channel: { id: string; credentialCiphertext: string | null },
  ): string | null {
    if (!this.whatsapp || !channel.credentialCiphertext) return null;
    try {
      return decryptCredential(
        channel.credentialCiphertext,
        this.whatsapp.credentialKey,
        channelCredentialAad(String(tenant.licenseId), channel.id),
      );
    } catch {
      return null;
    }
  }

  /**
   * Whether an agent may write to this customer now (tm 380). The window is
   * the customer's last message on the channel plus 24 hours; a customer whose
   * last message predates the live channel has none, which is a closed window
   * — the same answer Meta would give.
   */
  async replyWindowFor(
    tx: TenantClient,
    customerId: string,
    now: Date = new Date(),
  ): Promise<ReplyWindow> {
    const identity = await tx.channelIdentity.findFirst({
      where: { customerId },
      select: { channelType: true, lastCustomerMessageAt: true },
      orderBy: { createdAt: 'asc' },
    });
    if (!identity) return { channel: null, live: false, open: true, closes_at: null };
    const type = identity.channelType;
    // A window is Meta's rule: a live WhatsApp (tm 380), a live Messenger or
    // Instagram (tm 381). Every other channel — and these as mocks — is open.
    const windowed = (type === 'whatsapp' && this.whatsapp !== null) || this.metaRuns(type);
    if (!windowed) {
      return { channel: type, live: false, open: true, closes_at: null };
    }
    const channel = await tx.channel.findFirst({
      where: { type, status: CONNECTED },
      select: { credentialCiphertext: true },
    });
    if (!channel?.credentialCiphertext) {
      return { channel: type, live: false, open: true, closes_at: null };
    }
    const span = type === 'whatsapp' ? WHATSAPP_REPLY_WINDOW_MS : META_REPLY_WINDOW_MS;
    const last = identity.lastCustomerMessageAt;
    const closesAt = last ? new Date(last.getTime() + span) : null;
    return {
      channel: type,
      live: true,
      open: closesAt !== null && closesAt.getTime() > now.getTime(),
      closes_at: closesAt ? closesAt.toISOString() : null,
    };
  }

  /**
   * The gate an agent's reply passes before it is written (tm 380): a live
   * WhatsApp chat past its 24-hour window takes no free text, so the message
   * is refused rather than committed and then silently never delivered.
   */
  async assertReplyAllowed(tx: TenantClient, customerId: string): Promise<void> {
    const window = await this.replyWindowFor(tx, customerId);
    if (window.live && !window.open)
      throw windowClosed(window.closes_at, window.channel ?? undefined);
  }

  /**
   * After a send failed: a credential the provider refused marks the channel
   * "reconnect needed" and tells the admins, once (`channel-reconnect-notice.ts`).
   * Never throws — the caller is already handling the failure.
   */
  async noteSendFailure(db: PrismaClient, tenant: TenantContext, error: unknown): Promise<void> {
    if (!(error instanceof ChannelCredentialRefusedError) || !this.options.reconnect) return;
    try {
      await markChannelReconnectRequired(db, tenant, error.channelType, this.options.reconnect);
    } catch (markError) {
      this.options.reconnect.log?.warn(
        { err: markError, license_id: String(tenant.licenseId) },
        'channel reconnect mark failed',
      );
    }
  }

  private requireLiveWhatsApp(): LiveWhatsAppOptions {
    if (!this.whatsapp) throw ApiError.notFound('Not found.');
    return this.whatsapp;
  }

  // -------------------------------------------------------------------------
  // Live Messenger / Instagram (tm 381)
  // -------------------------------------------------------------------------

  /**
   * Store the page a Facebook Login connected: its token encrypted to this
   * row, the routing key (`config.address`) the page id for Messenger and the
   * linked Instagram account id for Instagram, the name a person reads beside
   * it. Refuses an address another workspace has connected, as every
   * channel's connect does, and clears an earlier "reconnect needed".
   */
  async storeMetaLive(
    tx: TenantClient,
    tenant: TenantContext,
    type: MetaMessagingChannel,
    page: MetaPage,
  ): Promise<ConnectedChannel> {
    const meta = this.requireLiveMeta(type);
    if (type === 'instagram' && !page.instagram) {
      throw ApiError.validation('That page has no Instagram professional account linked to it.', {
        reason: 'instagram_account_not_linked',
      });
    }
    const address = type === 'instagram' ? page.instagram!.id : page.id;
    const display =
      type === 'instagram'
        ? page.instagram!.username
          ? `@${page.instagram!.username}`
          : page.name
        : page.name;
    const brandId = tenant.brandId ?? (await this.defaultBrandId(tx));
    await this.assertAddressFree(tx, type, address, tenant.licenseId, brandId);
    const existing = await tx.channel.findFirst({
      where: { licenseId: tenant.licenseId, brandId, type },
      select: { id: true },
    });
    const channelId = existing?.id ?? randomUUID();
    const config = {
      address,
      page_id: page.id,
      page_name: page.name,
      ...(type === 'instagram'
        ? { ig_user_id: page.instagram!.id, username: page.instagram!.username }
        : {}),
      display_name: display,
      live: true,
    };
    const data = {
      status: CONNECTED,
      config: config as Prisma.InputJsonValue,
      credentialCiphertext: encryptCredential(
        page.accessToken,
        meta.credentialKey,
        channelCredentialAad(String(tenant.licenseId), channelId),
      ),
      webhookSecretHash: null,
      reconnectRequiredAt: null,
    };
    try {
      const row = await tx.channel.upsert({
        where: { licenseId_brandId_type: { licenseId: tenant.licenseId, brandId, type } },
        create: { id: channelId, licenseId: tenant.licenseId, brandId, type, ...data },
        update: data,
        select: { ...CHANNEL_SELECT, id: true },
      });
      // The token was encrypted to the row read above; a concurrent connect
      // that replaced it would leave a token this row cannot decrypt.
      if (row.id !== channelId) throw addressTaken();
      return this.serialise(row);
    } catch (error) {
      if (isUniqueViolation(error)) throw addressTaken();
      throw error;
    }
  }

  /**
   * One Messenger / Instagram message from the signed webhook (tm 381). The
   * recipient resolves the workspace (pre-tenant, as every channel), then the
   * live channel row there — a page connected as a mock, or since turned off,
   * takes nothing in. The message log row is keyed by `(channel, mid)`, so a
   * redelivery is `duplicate` and the customer's message is in the chat once.
   */
  async ingestMetaMessage(
    db: PrismaClient,
    chats: ChatService,
    message: MetaInboundMessage,
    audit: InboundAudit,
  ): Promise<MetaInboundOutcome> {
    if (!this.metaRuns(message.channel)) {
      return { status: 'ignored', reason: 'unknown_recipient' };
    }
    let tenant: TenantContext;
    try {
      tenant = await this.resolveLicense(db, message.channel, message.address);
    } catch (error) {
      if (error instanceof ApiError && error.type === 'not_found') {
        return { status: 'ignored', reason: 'unknown_recipient' };
      }
      throw error;
    }
    const channel = await withTenant(db, tenant, (tx) =>
      tx.channel.findFirst({
        where: { type: message.channel, status: CONNECTED, credentialCiphertext: { not: null } },
        select: { id: true, config: true },
      }),
    );
    const config = (channel?.config ?? {}) as { address?: unknown };
    if (!channel || config.address !== message.address) {
      return { status: 'ignored', reason: 'unknown_recipient' };
    }
    return this.ingestForTenant(
      db,
      chats,
      tenant,
      message.channel,
      {
        address: message.address,
        externalId: message.senderId,
        senderName: null,
        text: message.text,
      },
      audit,
      { providerMessageId: message.mid, channelId: channel.id, sentAt: new Date(message.at) },
    );
  }

  /**
   * An agent's reply over a live Messenger / Instagram (tm 381): the page
   * token, the 24-hour window, `messaging_type: RESPONSE`. Refused before
   * Meta is asked where it could only fail there, and Meta's own refusals
   * mapped as WhatsApp's are (190 → reconnect, outside the window → closed).
   */
  async #sendMeta(
    tx: TenantClient,
    tenant: TenantContext,
    type: MetaMessagingChannel,
    channel: { id: string; credentialCiphertext: string | null; reconnectRequiredAt: Date | null },
    config: Record<string, unknown>,
    input: { chatId?: string; externalId?: string; text: string },
  ): Promise<OutboundOutcome> {
    const meta = this.requireLiveMeta(type);
    const label = channelLabel(type);
    let token: string | null = null;
    if (channel.credentialCiphertext) {
      try {
        token = decryptCredential(
          channel.credentialCiphertext,
          meta.credentialKey,
          channelCredentialAad(String(tenant.licenseId), channel.id),
        );
      } catch {
        token = null;
      }
    }
    const pageId = typeof config.page_id === 'string' ? config.page_id : null;
    if (!token || !pageId) {
      throw ApiError.validation(
        `Reconnect ${label}: this channel was connected before it went live.`,
        {
          reason: 'channel_needs_reconnect',
        },
      );
    }
    if (channel.reconnectRequiredAt) throw new ChannelCredentialRefusedError(type);

    const identity = input.externalId
      ? await tx.channelIdentity.findFirst({
          where: { channelType: type, externalId: input.externalId },
          select: { externalId: true, customerId: true },
        })
      : await this.identityForChat(tx, type, input.chatId!);
    if (!identity) throw ApiError.validation('This chat has no identity on that channel.');
    const window = await this.replyWindowFor(tx, identity.customerId);
    if (!window.open) throw windowClosed(window.closes_at, type);

    let providerMessageId: string;
    try {
      providerMessageId = await meta.live.sendText(
        token,
        pageId,
        type,
        identity.externalId,
        input.text,
      );
    } catch (error) {
      if (error instanceof MetaGraphError && error.tokenInvalid) {
        throw new ChannelCredentialRefusedError(type);
      }
      if (error instanceof MetaGraphError && error.windowClosed) {
        throw windowClosed(window.closes_at, type);
      }
      if (error instanceof MetaGraphError && error.httpStatus < 500) {
        throw ApiError.validation(
          error.providerMessage
            ? `${label} refused the message: ${error.providerMessage}`
            : `${label} refused the message.`,
          {
            reason: 'app_provider_refused',
            ...(error.code !== null ? { provider_code: error.code } : {}),
          },
        );
      }
      if (error instanceof MetaGraphError || error instanceof MetaGraphUnreachableError) {
        throw new ApiError('service_unavailable', `${label} could not be reached. Try again.`, {
          details: { reason: 'app_provider_unavailable' },
        });
      }
      throw error;
    }

    await this.record(tx, tenant, {
      channelType: type,
      direction: 'outbound',
      externalId: identity.externalId,
      chatId: input.chatId ?? null,
      text: input.text,
      providerMessageId,
      channelId: channel.id,
      status: 'sent',
    });
    return {
      provider_message_id: providerMessageId,
      external_id: identity.externalId,
      chat_id: input.chatId ?? null,
    };
  }

  /**
   * The pages a login opened, sealed for the few minutes they wait to be
   * chosen from (tm 381): encrypted under `APPS_CREDENTIAL_KEY`, bound to the
   * workspace and the selection id, so a selection read back anywhere else
   * does not open.
   */
  sealMetaSelection(tenant: TenantContext, selectionId: string, pages: MetaPage[]): string {
    const meta = this.requireAnyLiveMeta();
    return encryptCredential(
      JSON.stringify(pages),
      meta.credentialKey,
      metaSelectionAad(tenant, selectionId),
    );
  }

  /** {@link sealMetaSelection} undone, or null when it does not open (another workspace, a rotated key). */
  openMetaSelection(tenant: TenantContext, selectionId: string, sealed: string): MetaPage[] | null {
    const meta = this.requireAnyLiveMeta();
    try {
      const pages = JSON.parse(
        decryptCredential(sealed, meta.credentialKey, metaSelectionAad(tenant, selectionId)),
      ) as unknown;
      return Array.isArray(pages) ? (pages as MetaPage[]) : null;
    } catch {
      return null;
    }
  }

  private requireAnyLiveMeta(): LiveMetaMessagingOptions {
    if (!this.meta) throw ApiError.notFound('Not found.');
    return this.meta;
  }

  private requireLiveMeta(type: string): LiveMetaMessagingOptions {
    if (!this.meta || !this.meta.live.runs(type)) throw ApiError.notFound('Not found.');
    return this.meta;
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
    audit: InboundAudit,
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
    if (isLicenseClosed(target.license_status) || !target.address) {
      throw ApiError.notFound('Unknown channel recipient.');
    }
    const normalized = telegram.live.parseUpdate(body, target.address);
    if (!normalized) return { status: 'ignored', reason: 'unsupported_update' };
    return this.ingestNormalized(db, chats, 'telegram', normalized, audit);
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
    audit: InboundAudit,
  ): Promise<InboundOutcome> {
    return this.ingestNormalized(db, chats, type, getAdapter(type).parseInbound(payload), audit);
  }

  /** The provider-agnostic half of {@link ingestInbound}, shared with the live Telegram webhook. */
  async ingestNormalized(
    db: PrismaClient,
    chats: ChatService,
    type: ChannelType,
    normalized: NormalizedInbound,
    audit: InboundAudit,
  ): Promise<InboundOutcome> {
    const tenant = await this.resolveLicense(db, type, normalized.address);
    return this.ingestForTenant(db, chats, tenant, type, normalized, audit);
  }

  /**
   * {@link ingestNormalized} once the workspace is known — the live WhatsApp
   * queue resolves it at the webhook (tm 380) and comes in here with what the
   * message brings besides its text ({@link InboundExtras}).
   *
   * With a provider message id and a channel id, the message-log row is
   * written in the chat event's own transaction (the `outbox`), under the
   * `(channel_id, provider_message_id)` unique index: a second delivery of the
   * same message rolls its event back and answers `duplicate`, so a customer's
   * message is in the chat exactly once however often the provider sends it.
   */
  async ingestForTenant(
    db: PrismaClient,
    chats: ChatService,
    tenant: TenantContext,
    type: ChannelType,
    normalized: NormalizedInbound,
    audit: InboundAudit,
    extras: InboundExtras = {},
  ): Promise<InboundOutcome> {
    // Mask before anything reads the text, so the masked value is what the spam
    // classifier sees, what the event stores, what realtime pushes and what the
    // message log keeps — the order `routes/customer.ts` and `email-inbound.ts`
    // both use, and the reason no raw secret is ever handed to the classifier.
    // Every sensitive type a player can type (AI-26 · tm 300.2), not only a card.
    const masked = maskForWrite(normalized.text, 'customer');
    const maskedText = masked.text;
    const sensitiveTypes = [...new Set([...masked.types, ...(extras.sensitiveTypes ?? [])])];
    const keyed = extras.providerMessageId !== undefined && extras.channelId !== undefined;

    // Looked up, not created: the spam gate below must be able to refuse without
    // leaving a trace, and `resolveCustomer` would already have written a
    // customer and an identity row by the time the verdict is known.
    const knownCustomerId = await withTenant(db, tenant, (tx) =>
      this.findCustomerByIdentity(tx, tenant, type, normalized.externalId),
    );

    // Whether this message opens a connection rather than continuing one — the
    // widget's own question (`opensConnection`, ID-02): a stranger always
    // does; a known sender does when there is no open conversation (a same-day
    // return included) or the open one is over.
    const opens = knownCustomerId ? await chats.opensConnection(tenant, knownCustomerId) : true;

    // Spam filter (FR-MOD-08.9.3) — the same engine, and deliberately the same
    // scope the widget uses: screen only the message that would OPEN a
    // connection. Screening every message of an established conversation would
    // put the false-positive cost on a legitimate customer mid-thread, who may
    // well paste several links at their agent's request.
    if (opens && maskedText) {
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

    // The widget's single send path (ID-02 · tm 286.3): continue the open
    // connection, or open one in the member's day — the day's first opens its
    // chat, a return the same day is a further connection under it. Decided
    // and written in one transaction, so a burst of messages cannot open two.
    // A conversation that arrived here stays open across midnight unless the
    // workspace set a timeout, the idle sweep's rule (`rolloverIdleSeconds`).
    // When the customer wrote — never later than now, so a provider clock
    // ahead of ours cannot stretch the reply window.
    const sentAt = new Date(Math.min((extras.sentAt ?? new Date()).getTime(), Date.now()));
    let connection;
    try {
      connection = await chats.openOrContinueConnection(tenant, principal, {
        customerId,
        event: {
          type: 'message',
          ...(maskedText || !extras.attachmentUrl ? { text: maskedText } : {}),
          recipients: 'all',
          ...(sensitiveTypes.length > 0 ? { sensitiveTypes } : {}),
          ...(extras.attachmentUrl ? { attachmentUrl: extras.attachmentUrl } : {}),
        },
        // A connection this opens was started through the channel (RP-02).
        initiatedBy: 'channel',
        audit: audit(tenant, customerId),
        ...(keyed
          ? {
              // The log row and the window move with the event, or not at all.
              outbox: async (tx: TenantClient, written: { chatId: string }) => {
                await this.record(tx, tenant, {
                  channelType: type,
                  direction: 'inbound',
                  externalId: normalized.externalId,
                  chatId: written.chatId,
                  text: maskedText,
                  providerMessageId: extras.providerMessageId!,
                  channelId: extras.channelId!,
                });
                await this.touchCustomerWindow(tx, tenant, type, normalized.externalId, sentAt);
              },
            }
          : {}),
      });
    } catch (error) {
      if (keyed && isUniqueViolation(error)) return { status: 'ignored', reason: 'duplicate' };
      throw error;
    }
    const chatId = connection.chat.id;

    if (!keyed) {
      await withTenant(db, tenant, (tx) =>
        this.record(tx, tenant, {
          channelType: type,
          direction: 'inbound',
          externalId: normalized.externalId,
          chatId,
          text: maskedText,
        }),
      );
    }

    return { status: 'accepted', chat_id: chatId, customer_id: customerId };
  }

  /** Forward only: the window runs from the customer's latest message, never an older one. */
  private async touchCustomerWindow(
    tx: TenantClient,
    tenant: TenantContext,
    type: ChannelType,
    externalId: string,
    sentAt: Date,
  ): Promise<void> {
    await tx.channelIdentity.updateMany({
      where: {
        licenseId: tenant.licenseId,
        channelType: type,
        externalId,
        OR: [{ lastCustomerMessageAt: null }, { lastCustomerMessageAt: { lt: sentAt } }],
      },
      data: { lastCustomerMessageAt: sentAt },
    });
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
    if (!match || isLicenseClosed(match.license_status)) {
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
      // A credential the provider refused (tm 380): marked after the failed
      // transaction, so the next reply is refused up front and the admins know.
      await this.noteSendFailure(db, tenant, error);
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
      select: {
        id: true,
        status: true,
        config: true,
        credentialCiphertext: true,
        reconnectRequiredAt: true,
      },
    });
    if (!channel || channel.status !== CONNECTED) {
      throw ApiError.validation('That channel is not connected.');
    }

    const config = (channel.config ?? {}) as Record<string, unknown>;

    // A live WhatsApp (tm 380): its own path end to end — the window, the token,
    // Meta's refusals — and the log row keyed by the wamid Meta answers with.
    if (type === 'whatsapp' && this.whatsapp) {
      return this.#sendWhatsApp(tx, tenant, channel, config, input);
    }
    // A live Messenger / Instagram (tm 381): the same shape, through the page.
    if (isMetaMessagingChannel(type) && this.metaRuns(type)) {
      return this.#sendMeta(tx, tenant, type, channel, config, input);
    }

    const externalId = input.externalId ?? (await this.externalIdForChat(tx, type, input.chatId!));

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

  /**
   * An agent's reply over a live WhatsApp (tm 380). Refused before Meta is
   * asked when it could only fail there: a channel connected while it was a
   * mock (no token), one Meta already refused (reconnect needed), a customer
   * past the 24-hour window. Meta's own refusals map the same way — a token
   * error 190 is {@link ChannelCredentialRefusedError} (the caller marks the
   * channel after its transaction), a re-engagement error is the window.
   */
  async #sendWhatsApp(
    tx: TenantClient,
    tenant: TenantContext,
    channel: { id: string; credentialCiphertext: string | null; reconnectRequiredAt: Date | null },
    config: Record<string, unknown>,
    input: { chatId?: string; externalId?: string; text: string },
  ): Promise<OutboundOutcome> {
    const whatsapp = this.requireLiveWhatsApp();
    const token = this.whatsAppToken(tenant, channel);
    if (!token) {
      throw ApiError.validation(
        'Reconnect WhatsApp: this channel was connected before it went live.',
        { reason: 'channel_needs_reconnect' },
      );
    }
    if (channel.reconnectRequiredAt) throw new ChannelCredentialRefusedError('whatsapp');
    const phoneNumberId =
      typeof config.phone_number_id === 'string' ? config.phone_number_id : null;
    if (!phoneNumberId) {
      throw ApiError.validation('Reconnect WhatsApp: the channel has no business number.', {
        reason: 'channel_needs_reconnect',
      });
    }

    const identity = input.externalId
      ? await tx.channelIdentity.findFirst({
          where: { channelType: 'whatsapp', externalId: input.externalId },
          select: { externalId: true, customerId: true },
        })
      : await this.identityForChat(tx, 'whatsapp', input.chatId!);
    if (!identity) throw ApiError.validation('This chat has no identity on that channel.');
    const window = await this.replyWindowFor(tx, identity.customerId);
    if (!window.open) throw windowClosed(window.closes_at);

    let providerMessageId: string;
    try {
      providerMessageId = await whatsapp.live.sendText(
        token,
        phoneNumberId,
        identity.externalId,
        input.text,
      );
    } catch (error) {
      if (error instanceof WhatsAppGraphError && error.tokenInvalid) {
        throw new ChannelCredentialRefusedError('whatsapp');
      }
      if (error instanceof WhatsAppGraphError && error.windowClosed) {
        throw windowClosed(window.closes_at);
      }
      if (error instanceof WhatsAppGraphError && error.httpStatus < 500) {
        throw ApiError.validation(
          error.providerMessage
            ? `WhatsApp refused the message: ${error.providerMessage}`
            : 'WhatsApp refused the message.',
          {
            reason: 'app_provider_refused',
            ...(error.code !== null ? { provider_code: error.code } : {}),
          },
        );
      }
      if (error instanceof WhatsAppGraphError || error instanceof WhatsAppUnreachableError) {
        throw new ApiError('service_unavailable', 'WhatsApp could not be reached. Try again.', {
          details: { reason: 'app_provider_unavailable' },
        });
      }
      throw error;
    }

    await this.record(tx, tenant, {
      channelType: 'whatsapp',
      direction: 'outbound',
      externalId: identity.externalId,
      chatId: input.chatId ?? null,
      text: input.text,
      providerMessageId,
      channelId: channel.id,
      status: 'sent',
    });
    return {
      provider_message_id: providerMessageId,
      external_id: identity.externalId,
      chat_id: input.chatId ?? null,
    };
  }

  /** The customer of `chatId` as known on this channel, or null. */
  private async identityForChat(
    tx: TenantClient,
    type: ChannelType,
    chatId: string,
  ): Promise<{ externalId: string; customerId: string } | null> {
    const chat = await tx.chat.findUnique({ where: { id: chatId }, select: { customerId: true } });
    if (!chat) throw ApiError.notFound('Chat not found.');
    return tx.channelIdentity.findFirst({
      where: { channelType: type, customerId: chat.customerId },
      select: { externalId: true, customerId: true },
    });
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
      /** The channel row (tm 380); with the provider id, the message's unique key. */
      channelId?: string;
      /** An outbound message's first status (tm 380 — `sent` once Meta took it). */
      status?: 'sent';
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
        ...(row.channelId ? { channelId: row.channelId } : {}),
        ...(row.status ? { status: row.status, statusAt: new Date() } : {}),
      },
    });
  }

  private serialise(row: ChannelRow): ConnectedChannel {
    const config = (row.config ?? {}) as {
      address?: unknown;
      display_phone_number?: unknown;
      display_name?: unknown;
    };
    const address = typeof config.address === 'string' ? config.address : null;
    const connected = row.status === CONNECTED;
    // A live WhatsApp's number (tm 380); a live page's name or @username (tm 381).
    const display =
      typeof config.display_phone_number === 'string' && config.display_phone_number
        ? config.display_phone_number
        : row.credentialCiphertext !== null &&
            typeof config.display_name === 'string' &&
            config.display_name
          ? config.display_name
          : null;
    return {
      type: row.type,
      brand_id: row.brandId,
      status: row.status,
      // The address is only meaningful while connected; a disconnected channel
      // reports none.
      address: connected ? address : null,
      connected,
      created_at: row.createdAt.toISOString(),
      live: connected && row.credentialCiphertext !== null,
      display_address: connected ? display : null,
      needs_reconnect: connected && row.reconnectRequiredAt !== null,
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
