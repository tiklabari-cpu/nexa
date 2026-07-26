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
 */
import { Prisma, type PrismaClient } from '@prisma/client';
import { ApiError } from '../../lib/api-error.js';
import { withTenant, type TenantClient, type TenantContext } from '../../lib/tenant.js';
import type { ChatService } from '../chat/chat-service.js';
import type { CustomerPrincipal } from '../auth/principal.js';
import { getAdapter } from './registry.js';
import type { ChannelType } from './channel-adapter.js';

/** The channel `status` values the `channels_status_check` constraint allows
 *  that matter here: `connected` (on) and `off`. */
const CONNECTED = 'connected';
const OFF = 'off';

export interface ConnectedChannel {
  type: string;
  status: string;
  /** The workspace's channel address (page id / phone number), or null if off. */
  address: string | null;
  connected: boolean;
  created_at: string;
}

interface ChannelRow {
  type: string;
  status: string;
  config: Prisma.JsonValue;
  createdAt: Date;
}

export interface InboundOutcome {
  chat_id: string;
  customer_id: string;
}

export interface OutboundOutcome {
  provider_message_id: string;
  external_id: string;
  chat_id: string | null;
}

export class ChannelService {
  // -------------------------------------------------------------------------
  // Connect / list / disconnect — the `channels` table consumer
  // -------------------------------------------------------------------------

  /**
   * Connect a channel (the mock OAuth / provisioning / linking step) and mark it
   * `on`. Upsert on the `(license_id, type)` unique key: re-connecting a channel
   * updates its config in place rather than failing or duplicating.
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

    const row = await tx.channel.upsert({
      where: { licenseId_type: { licenseId: tenant.licenseId, type } },
      // `connected` is the "on" value the channels_status_check allows (the
      // others are `off` and `soon`).
      create: { licenseId: tenant.licenseId, type, status: CONNECTED, config: stored },
      update: { status: CONNECTED, config: stored },
      select: { type: true, status: true, config: true, createdAt: true },
    });
    return this.serialise(row);
  }

  /** Every channel the workspace has ever connected, connected-first is not
   *  meaningful here so oldest-first for a stable order. */
  async list(tx: TenantClient): Promise<ConnectedChannel[]> {
    const rows = await tx.channel.findMany({
      orderBy: { createdAt: 'asc' },
      select: { type: true, status: true, config: true, createdAt: true },
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
      data: { status: OFF },
    });
    return count;
  }

  // -------------------------------------------------------------------------
  // Inbound — provider webhook → chat
  // -------------------------------------------------------------------------

  /**
   * Turn an inbound provider webhook into a chat message. Resolves the licence
   * from the channel address (pre-tenant, SECURITY DEFINER), then reuses the
   * chat core exactly as the widget does.
   */
  async ingestInbound(
    db: PrismaClient,
    chats: ChatService,
    type: ChannelType,
    payload: unknown,
  ): Promise<InboundOutcome> {
    const normalized = getAdapter(type).parseInbound(payload);
    const tenant = await this.resolveLicense(db, type, normalized.address);

    const customerId = await withTenant(db, tenant, (tx) =>
      this.resolveCustomer(tx, tenant, type, normalized.externalId, normalized.senderName),
    );

    const principal: CustomerPrincipal = {
      kind: 'customer',
      customerId,
      organizationId: tenant.organizationId,
      licenseId: tenant.licenseId,
    };

    const existing = await withTenant(db, tenant, (tx) =>
      tx.chat.findFirst({ where: { customerId, active: true }, select: { id: true } }),
    );

    // Same two paths the widget's single send endpoint takes: continue the open
    // conversation, or open one. `start` reuses an existing active chat too, so
    // the check is an optimisation, not the safety net.
    let chatId: string;
    if (existing) {
      await chats.sendEvent(tenant, principal, existing.id, {
        type: 'message',
        text: normalized.text,
        recipients: 'all',
      });
      chatId = existing.id;
    } else {
      const { chat } = await chats.start(tenant, principal, {
        customerId,
        assignToMe: false,
        initialEvent: { type: 'message', text: normalized.text, recipients: 'all' },
      });
      chatId = chat.id;
    }

    await withTenant(db, tenant, (tx) =>
      this.record(tx, tenant, {
        channelType: type,
        direction: 'inbound',
        externalId: normalized.externalId,
        chatId,
        text: normalized.text,
      }),
    );

    return { chat_id: chatId, customer_id: customerId };
  }

  /**
   * The licence a channel address belongs to, or a 4xx the provider reads as
   * permanent. `channel_resolve_license` only matches a channel that is `on`, so
   * a disconnected channel stops accepting inbound at once. A closed workspace
   * is a 404 too — the address no longer routes anywhere.
   */
  async resolveLicense(
    db: PrismaClient,
    type: ChannelType,
    address: string,
  ): Promise<TenantContext> {
    const rows = await db.$queryRaw<
      Array<{ license_id: bigint; organization_id: string; license_status: string }>
    >(Prisma.sql`SELECT * FROM channel_resolve_license(${type}, ${address})`);

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
    const channel = await tx.channel.findUnique({
      where: { licenseId_type: { licenseId: tenant.licenseId, type } },
      select: { status: true, config: true },
    });
    if (!channel || channel.status !== CONNECTED) {
      throw ApiError.validation('That channel is not connected.');
    }

    const externalId = input.externalId ?? (await this.externalIdForChat(tx, type, input.chatId!));
    const config = (channel.config ?? {}) as Record<string, unknown>;

    const { providerMessageId } = await getAdapter(type).send({
      config,
      externalId,
      text: input.text,
    });

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
      status: row.status,
      // The address is only meaningful while connected; a disconnected channel
      // reports none.
      address: row.status === CONNECTED ? address : null,
      connected: row.status === CONNECTED,
      created_at: row.createdAt.toISOString(),
    };
  }
}
