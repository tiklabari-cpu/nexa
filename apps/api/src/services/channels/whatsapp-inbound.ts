/**
 * The live WhatsApp webhook's durable inbox (tm 380 · KN-01 · GV-02 pattern).
 *
 * Meta wants a quick 200 and retries a delivery for days when it does not get
 * one, so the webhook does the cheap, certain part and leaves the rest:
 *
 *   1. {@link WhatsAppInbound.accept} — after the signature check, in the
 *      request: each business number resolves to its workspace (SECURITY
 *      DEFINER `whatsapp_resolve_phone_number`, then `withTenant`), the text is
 *      masked (AI-26 — no raw card number waits in a queue), and one row per
 *      message or status goes into `whatsapp_inbound_events`. The
 *      `(channel_id, dedup_key)` unique index makes a redelivery add nothing.
 *   2. {@link WhatsAppInbound.drain} — after the answer: the workspace's due
 *      rows, claimed under `FOR UPDATE SKIP LOCKED` with a lease, oldest first.
 *      A message becomes a chat message the way every channel's does (spam
 *      screen on an opening, the chat core's routing and realtime), its file
 *      fetched from Meta and kept only under the workspace's file-sharing
 *      rules; a status moves the outbound message's state forward and a `read`
 *      marks the chat seen (IN-05).
 *   3. {@link WhatsAppInbound.sweep} — the scheduler's pass (it rides
 *      `webhook_redelivery`): every workspace with due rows, so a row a crash
 *      or a restart left behind is taken again once its lease has run out.
 *
 * A message is taken in once even if a row is processed twice (a lease ran
 * out mid-way): the chat event and its message-log row commit together under
 * the `(channel_id, provider_message_id)` unique index
 * (`ChannelService.ingestForTenant`).
 */
import { Prisma, type PrismaClient } from '@prisma/client';
import { isLicenseClosed, type SensitiveType } from '@siyahtus/types';
import { maskForWrite } from '../../lib/sensitive-mask.js';
import { withTenant, type TenantClient, type TenantContext } from '../../lib/tenant.js';
import type { AuditContext } from '../audit/audit-log.js';
import type { CustomerPrincipal } from '../auth/principal.js';
import type { ChatService } from '../chat/chat-service.js';
import type { ObjectStore } from '../storage/object-store.js';
import { buildKey } from '../storage/upload-url.js';
import type { VirusScanner } from '../storage/virus-scanner.js';
import { ChannelCredentialRefusedError, type ChannelService } from './channel-service.js';
import { sniffAttachmentType } from './inbound-email-attachments.js';
import {
  WhatsAppGraphError,
  type WhatsAppInboundMessage,
  type WhatsAppStatus,
  type WhatsAppStatusUpdate,
  type WhatsAppWebhookBatch,
} from './whatsapp-live.js';

/** How long a claimed row is someone's before the sweep may take it again. */
export const WHATSAPP_INBOUND_LEASE_MS = 2 * 60 * 1000;
/** How many times a row is tried before it is given up as `failed`. */
export const WHATSAPP_INBOUND_MAX_ATTEMPTS = 5;
/** Rows one claim takes. */
const CLAIM_BATCH = 25;
/** How long a finished row is kept (its key still refuses a late redelivery). */
export const WHATSAPP_INBOUND_KEEP_MS = 30 * 24 * 60 * 60 * 1000;

/** The file-sharing defaults `security_settings` starts from (`routes/uploads.ts`). */
const FILE_DEFAULTS = {
  fileSharingEnabled: true,
  allowedFileTypes: ['image/png', 'image/jpeg', 'application/pdf'],
  maxFileSizeBytes: 10_485_760,
};

/** A message row's payload: the normalised message, its text already masked. */
interface MessagePayload extends WhatsAppInboundMessage {
  sensitive_types: SensitiveType[];
}

type StatusPayload = WhatsAppStatusUpdate;

/** Why a customer's file was not kept — shown to the agent in the message. */
type FileRefusal = 'sharing_off' | 'type' | 'too_large' | 'infected' | 'unavailable';

const FILE_REFUSAL_TEXT: Record<FileRefusal, string> = {
  sharing_off: 'file sharing is turned off for this workspace',
  type: 'files of this type are not allowed',
  too_large: 'it is larger than this workspace allows',
  infected: 'it did not pass the virus scan',
  unavailable: 'it could not be downloaded from WhatsApp',
};

/** Order of the forward-only status ladder; `failed` ends it. */
const STATUS_RANK: Record<WhatsAppStatus, number> = { sent: 1, delivered: 2, read: 3, failed: 4 };

export interface WhatsAppInboundDeps {
  db: PrismaClient;
  chats: ChatService;
  channels: ChannelService;
  store: ObjectStore;
  scanner: VirusScanner;
  /** `AUDIT_CHAIN_SECRET`: a same-day return is recorded as the sender's. */
  auditChainSecret: string;
  log?: {
    warn: (obj: object, msg: string) => void;
    error: (obj: object, msg: string) => void;
  };
}

export interface AcceptResult {
  /** The workspaces that got rows — what to drain after the answer. */
  tenants: TenantContext[];
  written: number;
  /** Business numbers no live channel answers to (answered 200 all the same). */
  unknownNumbers: number;
}

export interface DrainResult {
  done: number;
  retried: number;
  failed: number;
}

interface ClaimedRow {
  id: string;
  channel_id: string;
  kind: 'message' | 'status';
  payload: Prisma.JsonValue;
  attempts: number;
  created_at: Date;
}

/** What processing a row came to; `retry` puts it back for a later pass. */
type RowOutcome = { kind: 'done' } | { kind: 'retry'; code: string };

/** What `whatsapp_inbound_events_dedup_key_check` takes: no colon, at most 255 characters. */
function fitsDedupKey(wamid: string): boolean {
  return wamid.length > 0 && wamid.length <= 255 && !wamid.includes(':');
}

class RetryLater extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

export class WhatsAppInbound {
  constructor(private readonly deps: WhatsAppInboundDeps) {}

  /** Step 1: resolve, mask, write. Never processes a message itself. */
  async accept(batches: readonly WhatsAppWebhookBatch[]): Promise<AcceptResult> {
    const result: AcceptResult = { tenants: [], written: 0, unknownNumbers: 0 };
    for (const batch of batches) {
      const matches = await this.deps.db.$queryRaw<
        Array<{
          license_id: bigint;
          organization_id: string;
          license_status: string;
          channel_id: string;
        }>
      >(Prisma.sql`SELECT * FROM whatsapp_resolve_phone_number(${batch.phoneNumberId})`);
      const match = matches.length === 1 ? matches[0] : undefined;
      // A number nobody connects (any more), or a closed workspace: answered 200
      // with nothing written — the webhook is one per Meta app, and refusing
      // it for one stale number would have Meta retry, then disable, everyone's.
      if (!match || isLicenseClosed(match.license_status)) {
        result.unknownNumbers += 1;
        continue;
      }
      const tenant = { licenseId: match.license_id, organizationId: match.organization_id };
      const rows = [
        ...batch.messages
          .filter((message) => fitsDedupKey(message.wamid))
          .map((message) => {
            const masked = maskForWrite(message.text, 'customer');
            const payload: MessagePayload = {
              ...message,
              text: masked.text,
              sensitive_types: [...masked.types],
            };
            return { dedupKey: `m:${message.wamid}`, kind: 'message', payload };
          }),
        ...batch.statuses
          .filter((status) => fitsDedupKey(status.wamid))
          .map((status) => ({
            dedupKey: `s:${status.wamid}:${status.status}`,
            kind: 'status',
            payload: status,
          })),
      ];
      if (rows.length === 0) continue;
      const { count } = await withTenant(this.deps.db, tenant, (tx) =>
        tx.whatsappInboundEvent.createMany({
          data: rows.map((row) => ({
            licenseId: tenant.licenseId,
            channelId: match.channel_id,
            dedupKey: row.dedupKey,
            kind: row.kind,
            payload: row.payload as unknown as Prisma.InputJsonValue,
          })),
          skipDuplicates: true,
        }),
      );
      result.written += count;
      if (!result.tenants.some((known) => known.licenseId === tenant.licenseId)) {
        result.tenants.push(tenant);
      }
    }
    return result;
  }

  /** Step 3: every workspace with due rows. */
  async sweep(): Promise<DrainResult & { tenants: number; pruned: number }> {
    const tenants = await this.deps.db.$queryRaw<
      Array<{ license_id: bigint; organization_id: string }>
    >(Prisma.sql`SELECT * FROM whatsapp_inbound_due_tenants(${200}::int)`);
    const total = { done: 0, retried: 0, failed: 0, tenants: tenants.length, pruned: 0 };
    for (const row of tenants) {
      const tenant = { licenseId: row.license_id, organizationId: row.organization_id };
      const drained = await this.drain(tenant);
      total.done += drained.done;
      total.retried += drained.retried;
      total.failed += drained.failed;
      total.pruned += await withTenant(this.deps.db, tenant, async (tx) => {
        const { count } = await tx.whatsappInboundEvent.deleteMany({
          where: {
            state: { not: 'pending' },
            processedAt: { lt: new Date(Date.now() - WHATSAPP_INBOUND_KEEP_MS) },
          },
        });
        return count;
      });
    }
    return total;
  }

  /** Step 2: this workspace's due rows, until none is left. */
  async drain(tenant: TenantContext): Promise<DrainResult> {
    const result: DrainResult = { done: 0, retried: 0, failed: 0 };
    for (let pass = 0; pass < 40; pass += 1) {
      const claimed = await this.#claim(tenant);
      if (claimed.length === 0) break;
      for (const row of claimed) {
        let outcome: RowOutcome;
        try {
          outcome = await this.#process(tenant, row);
        } catch (error) {
          this.deps.log?.error(
            { err: error, license_id: String(tenant.licenseId), event_id: row.id },
            'whatsapp inbound row failed',
          );
          outcome = { kind: 'retry', code: error instanceof RetryLater ? error.code : 'error' };
        }
        const settled = await this.#settle(tenant, row, outcome);
        result[settled] += 1;
      }
    }
    return result;
  }

  async #claim(tenant: TenantContext): Promise<ClaimedRow[]> {
    const rows = await withTenant(this.deps.db, tenant, (tx) =>
      tx.$queryRaw<ClaimedRow[]>(Prisma.sql`
        UPDATE whatsapp_inbound_events
           SET attempts = attempts + 1,
               next_attempt_at = now() + make_interval(secs => ${WHATSAPP_INBOUND_LEASE_MS / 1000}::int)
         WHERE id IN (
           SELECT id FROM whatsapp_inbound_events
            WHERE state = 'pending' AND next_attempt_at <= now()
            ORDER BY created_at, id
            LIMIT ${CLAIM_BATCH}
            FOR UPDATE SKIP LOCKED)
        RETURNING id::text, channel_id::text, kind, payload, attempts, created_at`),
    );
    return rows.sort(
      (a, b) => a.created_at.getTime() - b.created_at.getTime() || a.id.localeCompare(b.id),
    );
  }

  async #settle(
    tenant: TenantContext,
    row: ClaimedRow,
    outcome: RowOutcome,
  ): Promise<'done' | 'retried' | 'failed'> {
    const now = new Date();
    if (outcome.kind === 'done') {
      await withTenant(this.deps.db, tenant, (tx) =>
        tx.whatsappInboundEvent.update({
          where: { id: row.id },
          data: { state: 'done', processedAt: now, payload: {}, lastError: null },
        }),
      );
      return 'done';
    }
    if (row.attempts >= WHATSAPP_INBOUND_MAX_ATTEMPTS) {
      await withTenant(this.deps.db, tenant, (tx) =>
        tx.whatsappInboundEvent.update({
          where: { id: row.id },
          data: { state: 'failed', processedAt: now, payload: {}, lastError: outcome.code },
        }),
      );
      return 'failed';
    }
    // 30 s, 2 min, 8 min, 32 min — inside the hours Meta itself keeps retrying.
    const backoffMs = 30_000 * 4 ** (row.attempts - 1);
    await withTenant(this.deps.db, tenant, (tx) =>
      tx.whatsappInboundEvent.update({
        where: { id: row.id },
        data: { nextAttemptAt: new Date(now.getTime() + backoffMs), lastError: outcome.code },
      }),
    );
    return 'retried';
  }

  async #process(tenant: TenantContext, row: ClaimedRow): Promise<RowOutcome> {
    const channel = await withTenant(this.deps.db, tenant, (tx) =>
      tx.channel.findUnique({
        where: { id: row.channel_id },
        select: { id: true, status: true, config: true, credentialCiphertext: true },
      }),
    );
    // Disconnected since the webhook wrote the row: nothing to take it into.
    if (!channel || channel.status !== 'connected' || !channel.credentialCiphertext) {
      return { kind: 'done' };
    }
    if (row.kind === 'status') {
      await this.#applyStatus(tenant, channel.id, row.payload as unknown as StatusPayload);
      return { kind: 'done' };
    }
    await this.#takeMessage(
      tenant,
      channel,
      row.payload as unknown as MessagePayload,
      row.attempts,
    );
    return { kind: 'done' };
  }

  async #takeMessage(
    tenant: TenantContext,
    channel: { id: string; config: Prisma.JsonValue; credentialCiphertext: string | null },
    message: MessagePayload,
    attempt: number,
  ): Promise<void> {
    const seen = await withTenant(this.deps.db, tenant, (tx) =>
      tx.channelMessage.findFirst({
        where: { channelId: channel.id, providerMessageId: message.wamid },
        select: { id: true },
      }),
    );
    if (seen) return;

    let attachmentUrl: string | undefined;
    let refusal: FileRefusal | null = null;
    if (message.media) {
      const kept = await this.#keepMedia(tenant, channel, message.media, attempt);
      if ('url' in kept) attachmentUrl = kept.url;
      else refusal = kept.refusal;
    }

    const notice = refusal
      ? `[WhatsApp ${message.type} not kept: ${FILE_REFUSAL_TEXT[refusal]}]`
      : '';
    let text = [message.text, notice].filter(Boolean).join('\n');
    if (!text && !attachmentUrl) text = `[WhatsApp ${message.type} message]`;
    const config = (channel.config ?? {}) as { address?: unknown };
    const address = typeof config.address === 'string' ? config.address : '';

    await this.deps.channels.ingestForTenant(
      this.deps.db,
      this.deps.chats,
      tenant,
      'whatsapp',
      { address, externalId: message.from, senderName: message.profileName, text },
      (context, customerId): AuditContext => ({
        licenseId: context.licenseId,
        chainSecret: this.deps.auditChainSecret,
        actorId: customerId,
        actorType: 'customer',
        ip: null,
      }),
      {
        providerMessageId: message.wamid,
        channelId: channel.id,
        sentAt: new Date(message.at),
        sensitiveTypes: message.sensitive_types,
        ...(attachmentUrl ? { attachmentUrl } : {}),
      },
    );
  }

  /**
   * A customer's file under the workspace's file-sharing rules — the same row
   * `POST /uploads` enforces (FR-MOD-08.9.4): sharing on, the type allowed,
   * within the size. The bytes decide the type (`sniffAttachmentType`, as for
   * e-mailed files), and the virus scan fails closed. Kept under an ordinary
   * upload key, so the agent opens it like a widget attachment.
   */
  async #keepMedia(
    tenant: TenantContext,
    channel: { id: string; credentialCiphertext: string | null },
    media: NonNullable<WhatsAppInboundMessage['media']>,
    attempt: number,
  ): Promise<{ url: string } | { refusal: FileRefusal }> {
    const rules = await withTenant(this.deps.db, tenant, async (tx: TenantClient) => {
      const row = await tx.securitySettings.findFirst({
        select: { fileSharingEnabled: true, allowedFileTypes: true, maxFileSizeBytes: true },
      });
      return {
        fileSharingEnabled: row?.fileSharingEnabled ?? FILE_DEFAULTS.fileSharingEnabled,
        allowedFileTypes: (row?.allowedFileTypes ?? FILE_DEFAULTS.allowedFileTypes).map((type) =>
          type.toLowerCase(),
        ),
        maxFileSizeBytes: row?.maxFileSizeBytes ?? FILE_DEFAULTS.maxFileSizeBytes,
      };
    });
    if (!rules.fileSharingEnabled) return { refusal: 'sharing_off' };
    // Said up front from Meta's claim; the bytes are checked again below.
    if (!rules.allowedFileTypes.includes(media.mime)) return { refusal: 'type' };

    const live = this.deps.channels.liveWhatsApp;
    const token = this.deps.channels.whatsAppToken(tenant, channel);
    if (!live || !token) return { refusal: 'unavailable' };

    let fetched;
    try {
      fetched = await live.fetchMedia(token, media.id, rules.maxFileSizeBytes);
    } catch (error) {
      if (error instanceof WhatsAppGraphError && error.tokenInvalid) {
        await this.deps.channels.noteSendFailure(
          this.deps.db,
          tenant,
          new ChannelCredentialRefusedError('whatsapp'),
        );
        return { refusal: 'unavailable' };
      }
      // Meta having a bad minute: the row is tried again later, and only the
      // last attempt gives the file up and takes the message in without it.
      if (attempt < WHATSAPP_INBOUND_MAX_ATTEMPTS) throw new RetryLater('media_unavailable');
      return { refusal: 'unavailable' };
    }
    if ('tooLarge' in fetched) return { refusal: 'too_large' };
    if (fetched.bytes.length > rules.maxFileSizeBytes) return { refusal: 'too_large' };

    const type = sniffAttachmentType(fetched.bytes);
    if (!type || !rules.allowedFileTypes.includes(type)) return { refusal: 'type' };

    let clean: boolean;
    try {
      clean = (await this.deps.scanner.scan(fetched.bytes)).clean;
    } catch {
      if (attempt < WHATSAPP_INBOUND_MAX_ATTEMPTS) throw new RetryLater('scan_unavailable');
      return { refusal: 'unavailable' };
    }
    if (!clean) return { refusal: 'infected' };

    const key = buildKey(tenant.licenseId, type);
    try {
      await this.deps.store.put(key, fetched.bytes, type);
    } catch {
      if (attempt < WHATSAPP_INBOUND_MAX_ATTEMPTS) throw new RetryLater('store_unavailable');
      return { refusal: 'unavailable' };
    }
    return { url: `/api/v1/uploads/${key}` };
  }

  /**
   * What Meta said about a message the workspace sent: forward only (a late
   * `delivered` does not undo a `read`; `failed` ends it unless it was read).
   * A `read` also moves the chat's "seen" marker, as the widget's own does
   * (IN-05 · `markCustomerSeen`) — an agent sees "Read" the same way for both.
   */
  async #applyStatus(
    tenant: TenantContext,
    channelId: string,
    status: StatusPayload,
  ): Promise<void> {
    const lower = (Object.keys(STATUS_RANK) as WhatsAppStatus[]).filter(
      (candidate) => STATUS_RANK[candidate] < STATUS_RANK[status.status],
    );
    const at = new Date(Math.min(new Date(status.at).getTime(), Date.now()));
    const target = await withTenant(this.deps.db, tenant, async (tx) => {
      const message = await tx.channelMessage.findFirst({
        where: { channelId, providerMessageId: status.wamid, direction: 'outbound' },
        select: { id: true, externalId: true },
      });
      if (!message) return null;
      const where: Prisma.ChannelMessageWhereInput =
        status.status === 'failed'
          ? { id: message.id, OR: [{ status: null }, { status: { in: ['sent', 'delivered'] } }] }
          : { id: message.id, OR: [{ status: null }, { status: { in: lower } }] };
      const { count } = await tx.channelMessage.updateMany({
        where,
        data: { status: status.status, statusAt: at },
      });
      if (count === 0 || status.status !== 'read') return null;
      const identity = await tx.channelIdentity.findFirst({
        where: { channelType: 'whatsapp', externalId: message.externalId },
        select: { customerId: true },
      });
      return identity;
    });
    if (!target) return;
    const principal: CustomerPrincipal = {
      kind: 'customer',
      customerId: target.customerId,
      organizationId: tenant.organizationId,
      licenseId: tenant.licenseId,
    };
    await this.deps.chats.markCustomerSeen(tenant, principal, at);
  }
}
