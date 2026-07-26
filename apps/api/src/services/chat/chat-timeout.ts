/**
 * Chat timeout sweep (FR-MOD-08.7.3): auto-close idle, "dead" conversations.
 *
 * A workspace can set a positive `chat_timeout_seconds` (see `InboxSettings`).
 * When it does, a chat with no activity for that long is archived automatically
 * — the customer wandered off, the agent moved on, and nobody should have to
 * find and close it by hand. Workspaces that leave it unset are never swept.
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
 *      cutoff comes from a positive window; a non-positive window is skipped
 *      entirely, so it can never collapse to "close everything now". The close
 *      itself re-checks the cutoff (see `deactivateByTimeout`), so a reply that
 *      lands mid-sweep spares the chat.
 *
 * The sweep is idempotent: a chat closed on one pass is inactive on the next and
 * no longer a candidate.
 */
import { type PrismaClient } from '@prisma/client';
import { type TenantContext, withTenant } from '../../lib/tenant.js';
import { type ChatService } from './chat-service.js';

export interface TenantTimeoutResult {
  /** Stringified: a bigint cannot be JSON-serialised, and this report is JSON. */
  licenseId: string;
  organizationId: string;
  /** The configured window, or null when the workspace has not enabled it. */
  timeoutSeconds: number | null;
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

  constructor(db: PrismaClient, chats: ChatService) {
    this.#db = db;
    this.#chats = chats;
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

    const seconds = await withTenant(this.#db, context, async (tx) => {
      const row = await tx.inboxSettings.findFirst({ select: { chatTimeoutSeconds: true } });
      return row?.chatTimeoutSeconds ?? null;
    });

    // Unset, or a value that should never have been stored: nothing to sweep.
    // Belt-and-suspenders with the endpoint's positivity check — a non-positive
    // window here would otherwise mean "close every live chat".
    if (seconds === null || seconds <= 0) {
      return {
        licenseId: tenant.license_id.toString(),
        organizationId: tenant.organization_id,
        timeoutSeconds: null,
        closed: 0,
      };
    }

    const cutoff = new Date(now.getTime() - seconds * 1000);
    const candidates = await this.#idleChats(context, cutoff);

    let closed = 0;
    for (const chatId of candidates) {
      if (await this.#chats.deactivateByTimeout(context, chatId, cutoff)) closed += 1;
    }

    return {
      licenseId: tenant.license_id.toString(),
      organizationId: tenant.organization_id,
      timeoutSeconds: seconds,
      closed,
    };
  }

  /** Active chats whose newest activity is older than the cutoff, this tenant only. */
  async #idleChats(context: TenantContext, cutoff: Date): Promise<string[]> {
    return withTenant(this.#db, context, async (tx) => {
      const rows = await tx.$queryRaw<Array<{ chat_id: string }>>`
        SELECT t.chat_id AS chat_id
        FROM threads t
        WHERE t.active = true
          AND COALESCE(
                (SELECT max(e.created_at) FROM events e WHERE e.thread_id = t.id),
                t.created_at
              ) < ${cutoff}`;
      return rows.map((r) => r.chat_id);
    });
  }
}
