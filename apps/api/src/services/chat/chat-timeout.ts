/**
 * Chat timeout sweep (FR-MOD-08.7.3): auto-close idle, "dead" conversations.
 *
 * A workspace can set a positive `chat_timeout_seconds` (see `InboxSettings`).
 * When it does, a chat with no activity for that long is archived automatically
 * — the customer wandered off, the agent moved on, and nobody should have to
 * find and close it by hand.
 *
 * A workspace that leaves it unset still has a window for its **widget**
 * conversations: 30 minutes (owner decision K2, ID-02 · tm 286.2). The member's
 * day is a chat with one connection per visit, and a visit has to end for the
 * next one to be a connection of its own — without a window a widget
 * conversation never closed, and a member back in the afternoon was still in
 * the morning's connection. Conversations that arrived over a messaging channel
 * (WhatsApp, Telegram, …) are not visits to a page; they stay open until the
 * workspace sets a window of its own, which then covers every conversation.
 * Applying the default to workspaces that never chose one is a behaviour
 * change, announced with ID-02.
 *
 * Like the retention sweep, there is no production scheduler in this environment
 * (a project boundary), so this is a script an operator runs rather than a cron
 * job. It reuses the same two guards:
 *
 *   1. **RLS is the cross-tenant guard.** Every read and every close runs inside
 *      `withTenant`, so one workspace's sweep can neither see nor close another's
 *      chats. The tenant list itself comes from the one SECURITY DEFINER
 *      enumerator, `retention_list_tenants()` — it answers only "what tenants are
 *      there?" and is shared rather than duplicated.
 *   2. **The age predicate is the not-yet-idle guard.** A chat is a candidate
 *      only when its last activity is strictly older than the cutoff, and the
 *      cutoff always comes from a positive window: a stored non-positive value
 *      reads as unset (K2's default), so it can never collapse to "close
 *      everything now". The close itself re-checks the cutoff (see
 *      `deactivateByTimeout`), so a reply that lands mid-sweep spares the chat.
 *
 * The sweep is idempotent: a chat closed on one pass is inactive on the next and
 * no longer a candidate.
 *
 * Every close it drives is recorded in the audit trail as `chat.archived`
 * (FR-MOD-02.8), authored by the system: nobody asked for this archive, so the
 * entry carries a null actor rather than the last agent who touched the chat.
 * That is why the sweeper needs the deployment's audit chain root — the same
 * reason the retention sweep does (`retention.ts`), and it is handed in for the
 * same reason too: this codebase has no ambient environment.
 */
import { Prisma, type PrismaClient } from '@prisma/client';
import { type TenantContext, withTenant } from '../../lib/tenant.js';
import { type AuditContext } from '../audit/audit-log.js';
import { type ChatService } from './chat-service.js';
import { DEFAULT_CONNECTION_IDLE_SECONDS, readChatTimeoutSeconds } from './conversation-day.js';

export interface TenantTimeoutResult {
  /** Stringified: a bigint cannot be JSON-serialised, and this report is JSON. */
  licenseId: string;
  organizationId: string;
  /** The window this pass applied — the workspace's own, or K2's default. */
  timeoutSeconds: number;
  /**
   * True when the workspace set no window and K2's 30-minute default was
   * applied — to widget conversations only.
   */
  widgetDefault: boolean;
  closed: number;
}

export interface ChatTimeoutReport {
  startedAt: string;
  finishedAt: string;
  tenants: TenantTimeoutResult[];
  totals: { tenants: number; closed: number };
}

interface TenantRow {
  license_id: bigint;
  organization_id: string;
}

export class ChatTimeoutSweeper {
  readonly #db: PrismaClient;
  readonly #chats: ChatService;
  /** `AUDIT_CHAIN_SECRET` (NFR-C6 · C6-c) — every close this sweep writes is chained. */
  readonly #auditChainSecret: string;

  constructor(db: PrismaClient, chats: ChatService, auditChainSecret: string) {
    this.#db = db;
    this.#chats = chats;
    this.#auditChainSecret = auditChainSecret;
  }

  async run(options: { now?: Date } = {}): Promise<ChatTimeoutReport> {
    const now = options.now ?? new Date();
    const startedAt = now.toISOString();

    const tenants = await this.#listTenants();
    const results: TenantTimeoutResult[] = [];
    for (const tenant of tenants) {
      results.push(await this.#sweepTenant(tenant, now));
    }

    return {
      startedAt,
      finishedAt: new Date().toISOString(),
      tenants: results,
      totals: {
        tenants: results.length,
        closed: results.reduce((sum, r) => sum + r.closed, 0),
      },
    };
  }

  /**
   * Cross-tenant read via the shared SECURITY DEFINER enumerator — the only
   * place the job steps outside a single-tenant context, and it reads nothing
   * but the two ids the loop needs.
   */
  async #listTenants(): Promise<TenantRow[]> {
    return this.#db.$queryRaw<TenantRow[]>`
      SELECT license_id, organization_id FROM retention_list_tenants()`;
  }

  async #sweepTenant(tenant: TenantRow, now: Date): Promise<TenantTimeoutResult> {
    const context: TenantContext = {
      licenseId: tenant.license_id,
      organizationId: tenant.organization_id,
    };

    const configured = await withTenant(this.#db, context, (tx) => readChatTimeoutSeconds(tx));

    // Unset, or a value that should never have been stored, is K2's default —
    // and only for widget conversations. Belt-and-suspenders with the
    // endpoint's positivity check: a non-positive window must never become
    // "close every live chat".
    const own = configured !== null && configured > 0;
    const seconds = own ? configured : DEFAULT_CONNECTION_IDLE_SECONDS;

    const cutoff = new Date(now.getTime() - seconds * 1000);
    const candidates = await this.#idleChats(context, cutoff, { widgetOnly: !own });

    // One context for the whole tenant's sweep: the licence is the same for
    // every chat in it, and the actor is the system in all of them. No request
    // id and no address — there is no request and no caller, and inventing
    // either would put a fiction in an append-only table.
    const audit: AuditContext = {
      licenseId: tenant.license_id,
      chainSecret: this.#auditChainSecret,
      actorId: null,
      actorType: 'system',
    };

    let closed = 0;
    for (const chatId of candidates) {
      if (await this.#chats.deactivateByTimeout(context, chatId, cutoff, audit)) closed += 1;
    }

    return {
      licenseId: tenant.license_id.toString(),
      organizationId: tenant.organization_id,
      timeoutSeconds: seconds,
      widgetDefault: !own,
      closed,
    };
  }

  /**
   * Active chats whose newest activity is older than the cutoff, this tenant
   * only. `widgetOnly` leaves out a conversation that arrived over a messaging
   * channel — one with an inbound `channel_messages` row, the same fact the
   * inbox's channel views and Reports' channel split read (`chatIdsOnChannel`).
   */
  async #idleChats(
    context: TenantContext,
    cutoff: Date,
    options: { widgetOnly: boolean },
  ): Promise<string[]> {
    return withTenant(this.#db, context, async (tx) => {
      const rows = await tx.$queryRaw<Array<{ chat_id: string }>>`
        SELECT t.chat_id AS chat_id
        FROM threads t
        WHERE t.active = true
          AND COALESCE(
                (SELECT max(e.created_at) FROM events e WHERE e.thread_id = t.id),
                t.created_at
              ) < ${cutoff}
          ${
            options.widgetOnly
              ? Prisma.sql`AND NOT EXISTS (
                  SELECT 1 FROM channel_messages cm
                  WHERE cm.license_id = t.license_id
                    AND cm.chat_id = t.chat_id
                    AND cm.direction = 'inbound')`
              : Prisma.empty
          }`;
      return rows.map((r) => r.chat_id);
    });
  }
}
