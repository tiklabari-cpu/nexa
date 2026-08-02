/**
 * Publishes an `agent_conflict_warning` for the gateway to fan out
 * (FR-MOD-08.6.3). This is the RTM side of `RealtimePublisher`.
 *
 * Until now the gateway has only *consumed* bus envelopes; this is the first
 * thing it publishes. It keeps the two properties the API publisher has:
 *
 *  - **An empty audience is never emitted.** A warning addressed to nobody is
 *    either wasted work or, in a careless gateway, a broadcast of who is working
 *    which chat. Fail closed — the same default `PushAudience` documents.
 *
 *  - **Publishing never fails the request.** A conflict warning is advisory and
 *    ephemeral: if it does not go out, both agents keep typing and the next
 *    keystroke re-detects the conflict and re-publishes. Breaking
 *    `send_typing_indicator` because Redis blinked would trade a cosmetic blip
 *    for a broken feature, so every failure here is swallowed.
 *
 * One divergence from the API publisher, and it is deliberate. On the API side a
 * service layer already holds the domain context and hands the publisher a
 * finished payload; the gateway has no such layer above it, so this publisher
 * resolves the one field the wire contract needs and the typing frame does not
 * carry — the chat's active thread. That read goes through the caller's tenant
 * context, so a chat the caller cannot see resolves to nothing and nothing is
 * published.
 *
 * No `originConnectionId` is set: unlike an echoed event, *every* conflicting
 * agent must see the warning, and the origin socket is one of them. The gateway
 * drops the origin when that field is present (fanout.ts), so it is left off.
 */
import type { PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';
import type { Logger } from 'pino';
import {
  licenseChannel,
  type AgentConflictWarningPush,
  type BusEnvelope,
} from '@nexa/types';
import type { SocketPrincipal } from './auth.js';
import type { ComposingAgent } from './conflict.js';

const ACTION = 'agent_conflict_warning' as const;

export class ConflictPublisher {
  constructor(
    private readonly db: PrismaClient,
    private readonly redis: Redis,
    private readonly log: Logger,
  ) {}

  /**
   * Warn every agent composing `chatId` at once that they are not alone. The
   * `agents` are the composing set the detector reported — the audience is
   * exactly them, so a warning never reaches an agent who is not in the conflict.
   */
  async publish(
    principal: SocketPrincipal,
    chatId: string,
    agents: ComposingAgent[],
  ): Promise<void> {
    const agentIds = [...new Set(agents.map((agent) => agent.agentId))];
    // Fail closed: an audience of nobody is meaningless, and the opposite
    // default would tell every agent in the licence who is working this chat.
    if (agentIds.length === 0) {
      this.log.warn({ action: ACTION }, 'refusing to publish a conflict warning with no audience');
      return;
    }

    try {
      const threadId = await this.#activeThreadId(principal, chatId);
      // No active thread means nothing coherent to warn about; the read is
      // RLS-scoped, so a chat the caller cannot see also lands here.
      if (!threadId) {
        this.log.warn({ action: ACTION }, 'no active thread for conflict warning — skipping');
        return;
      }

      const now = Date.now();
      const payload: AgentConflictWarningPush = {
        chat_id: chatId,
        thread_id: threadId,
        agents: agents.map((agent) => ({
          agent_id: agent.agentId,
          since: new Date(agent.since).toISOString(),
        })),
        detected_at: new Date(now).toISOString(),
      };

      const envelope: BusEnvelope<AgentConflictWarningPush> = {
        v: 1,
        licenseId: principal.licenseId,
        organizationId: principal.organizationId,
        action: ACTION,
        audience: { agentIds },
        payload,
        at: now,
      };

      await this.redis.publish(licenseChannel(principal.licenseId), JSON.stringify(envelope));
    } catch (error) {
      // Never rethrow: a lost warning is re-published on the next keystroke, and
      // the typing indicator it rides on must still succeed.
      this.log.error({ err: error, action: ACTION }, 'conflict warning publish failed');
    }
  }

  /** The chat's active thread, read through the caller's tenant context (RLS). */
  async #activeThreadId(principal: SocketPrincipal, chatId: string): Promise<string | null> {
    return this.db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_license', ${principal.licenseId}, true)`;
      await tx.$executeRaw`SELECT set_config('app.current_organization', ${principal.organizationId}, true)`;
      const rows = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM threads WHERE chat_id = ${chatId} AND active LIMIT 1
      `;
      return rows[0]?.id ?? null;
    });
  }
}
