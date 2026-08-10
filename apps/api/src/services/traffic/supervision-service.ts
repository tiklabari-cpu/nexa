/**
 * Who is watching which conversation (FR-MOD-13.2 · FR-MOD-03.1.1).
 *
 * Supervising is *not* assignment. A supervisor reads a conversation someone
 * else is handling, so nothing in `threads` records it — which is why the
 * Traffic board's `supervised` state had no source at all until
 * `chat_supervisions` (13.2-c) existed. This service is the only thing that
 * writes that table, and the only thing that decides who may.
 *
 * Two gates, both required, both borrowed rather than reinvented:
 *
 *   scope   — the route asks for `chats--all:ro` / `chats--access:ro`. Watching
 *             is a read, so no chat *write* scope is demanded. That keeps the
 *             decision already made on the web side (`rowActions.ts`: "A read,
 *             so it needs no write scope") true on the server too, instead of
 *             letting the two drift into disagreeing about what Supervise costs.
 *   access  — `resolveVisibility` + `canSeeChat` from `chat/access.js`, the same
 *             pair `GET /chats/{chatId}` uses. An agent may watch exactly the
 *             conversations they may open: nothing narrower (which would make
 *             the button lie) and nothing wider (which would turn a read scope
 *             into a way to observe another team's work).
 *
 * A chat the caller may not see is reported absent, never forbidden — the
 * `customers.ts` rule, for the same reason: a 403 confirms the id is real and
 * turns short ids into an enumeration oracle (NFR-S5).
 *
 * WHY THE CHAT IS RESOLVED FIRST (the trap 13.2-c left a note about): the three
 * foreign keys on `chat_supervisions` are checked by the table owner, and the
 * owner is exempt from RLS. So referential integrity alone will happily accept a
 * `chat_id` from another license as long as `license_id` matches the caller's.
 * The policy stops such a row being *read* across the tenant boundary; it does
 * not stop the pointer being formed. Resolving the chat under the tenant session
 * first — where `chats` RLS makes a foreign conversation invisible — is what
 * closes that, and it has to happen before the write, not alongside it.
 */
import { ApiError } from '../../lib/api-error.js';
import type { TenantClient } from '../../lib/tenant.js';
import { canSeeChat, resolveVisibility } from '../chat/access.js';
import type { Principal } from '../auth/principal.js';

/**
 * How long a supervision stays live without a heartbeat.
 *
 * Short on purpose. The failure mode this bounds is the abandoned tab: a
 * supervisor who closed the window without releasing, whose row would otherwise
 * claim forever that someone is watching. The client refreshes on a timer, so
 * the window only has to cover a couple of missed beats — 90 seconds tolerates
 * two misses of a 30-second heartbeat and still clears a dead watcher from the
 * board inside two minutes.
 *
 * Deliberately unlike `TrafficService`'s 30-minute visit window: that one asks
 * "is this person still on the site", a question about human browsing rhythm.
 * This one asks "is that browser tab still open", a question about a timer.
 */
export const SUPERVISION_LIVE_WINDOW_SECONDS = 90;

export interface Supervision {
  chat_id: string;
  agent_id: string;
  started_at: string;
  last_seen_at: string;
}

export class SupervisionService {
  /**
   * Register the caller as a watcher, or refresh the watch they already have.
   *
   * Idempotent by the table's own primary key `(chat_id, agent_id)`: the second
   * call from one agent updates `last_seen_at` on the single existing row rather
   * than adding a second. `started_at` is left alone, so it keeps meaning "since
   * when" across an arbitrarily long series of heartbeats. Two *different*
   * agents watching one chat are two rows — that is the point of the table.
   */
  async register(
    tx: TenantClient,
    licenseId: bigint,
    principal: Principal,
    chatId: string,
  ): Promise<Supervision> {
    const agentId = await this.#assertMayWatch(tx, principal, chatId);
    const now = new Date();

    const row = await tx.chatSupervision.upsert({
      where: { chatId_agentId: { chatId, agentId } },
      // `startedAt` is absent from the update half on purpose: a heartbeat must
      // not keep resetting when the supervisor began watching.
      update: { lastSeenAt: now },
      create: { chatId, agentId, licenseId, startedAt: now, lastSeenAt: now },
      select: { chatId: true, agentId: true, startedAt: true, lastSeenAt: true },
    });

    return {
      chat_id: row.chatId,
      agent_id: row.agentId,
      started_at: row.startedAt.toISOString(),
      last_seen_at: row.lastSeenAt.toISOString(),
    };
  }

  /**
   * Drop the caller's own watch.
   *
   * The `agentId` in the filter is taken from the principal and never from the
   * request, so there is no shape of call that releases somebody else's row —
   * one supervisor closing their tab cannot clear another's. Releasing a chat
   * nobody was watching succeeds as well: stopping something already stopped is
   * not an error, and reporting it as one would make an idempotent client
   * retry look like a failure.
   */
  async release(tx: TenantClient, principal: Principal, chatId: string): Promise<void> {
    const agentId = await this.#assertMayWatch(tx, principal, chatId);
    await tx.chatSupervision.deleteMany({ where: { chatId, agentId } });
  }

  /**
   * Chat id → the agents currently watching it, stale rows excluded.
   *
   * Shaped as a bulk lookup because its caller is the Traffic board (13.2-e),
   * which resolves a page of rows at once; asking per chat would be a query per
   * visitor. Bounded by `last_seen_at` rather than by row existence, which is
   * exactly what `(license_id, last_seen_at DESC)` indexes.
   */
  async liveByChat(
    tx: TenantClient,
    licenseId: bigint,
    chatIds: string[],
    now = new Date(),
  ): Promise<Map<string, string[]>> {
    const byChat = new Map<string, string[]>();
    if (chatIds.length === 0) return byChat;

    const rows = await tx.chatSupervision.findMany({
      where: {
        licenseId,
        chatId: { in: chatIds },
        lastSeenAt: { gte: new Date(now.getTime() - SUPERVISION_LIVE_WINDOW_SECONDS * 1000) },
      },
      orderBy: { lastSeenAt: 'desc' },
      select: { chatId: true, agentId: true },
    });

    for (const row of rows) {
      const watchers = byChat.get(row.chatId);
      if (watchers) watchers.push(row.agentId);
      else byChat.set(row.chatId, [row.agentId]);
    }
    return byChat;
  }

  /**
   * Both gates, in one place so neither verb can be given only half of them.
   *
   * Returns the account id the row will be keyed by. Only an agent principal
   * gets this far — the routes restrict `principals` to `agent`, and this is
   * why: `agent_id` references `accounts`, while a bot's id names a row in
   * `ai_agents`. A bot reaching here would not be a permission question but a
   * foreign-key violation, i.e. a 500 for what is really "bots do not watch".
   */
  async #assertMayWatch(tx: TenantClient, principal: Principal, chatId: string): Promise<string> {
    if (principal.kind !== 'agent') throw ApiError.notFound('Chat not found.');

    const visibility = await resolveVisibility(tx, principal, 'read');
    const chat = await tx.chat.findUnique({
      where: { id: chatId },
      select: {
        id: true,
        customerId: true,
        access: { select: { groupId: true } },
        users: { select: { userId: true, userType: true } },
      },
    });
    // Two different misses, one answer. `!chat` is another workspace's id (RLS
    // returned nothing) or an id that never existed; `!canSeeChat` is a real
    // conversation in this workspace that the caller's teams do not reach.
    // Distinguishing them in the response is precisely the leak (NFR-S5).
    if (!chat || !canSeeChat(visibility, chat)) throw ApiError.notFound('Chat not found.');

    return principal.accountId;
  }
}
