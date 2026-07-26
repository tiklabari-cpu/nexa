/**
 * Live typing preview (FR-MOD-02.9).
 *
 * The agent side of the feature is asymmetric with the customer side, because
 * the two are on different transports. An agent holds a socket, so a visitor's
 * sneak-peek is pushed to them (the API fans it out). A visitor's widget only
 * polls, so an agent's "is typing" cannot be pushed — it is written here as a
 * short-lived flag the customer-state poll reads back. That is the whole job of
 * this service: authorise the agent for the chat, then set or clear that flag.
 *
 * The authorisation check is not incidental. Without it a `send_typing_indicator`
 * would be a way to probe which chat ids exist, and to spoof "someone is typing"
 * on a conversation the sender cannot see. It reuses the same tenant-scoped read
 * `sync` does, so RLS applies and the answer matches what the agent could learn
 * over REST anyway.
 */
import type { PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';
import { AGENT_TYPING_TTL_SECONDS, typingStateKey } from '@nexa/types';
import type { SocketPrincipal } from './auth.js';

export class TypingService {
  constructor(
    private readonly db: PrismaClient,
    private readonly redis: Redis,
  ) {}

  /**
   * Whether this socket may signal typing on the chat. Mirrors `sync`'s
   * visibility rule narrowed to a single active chat: an unrestricted token sees
   * any chat in the licence, everyone else only chats their team is routed to or
   * they are personally in. Returns false rather than throwing so the dispatcher
   * can answer an inaccessible chat exactly as it answers a missing one.
   */
  async canType(principal: SocketPrincipal, chatId: string): Promise<boolean> {
    return this.#scoped(principal, async (tx) => {
      if (principal.unrestricted) {
        const rows = await tx.$queryRaw<Array<{ ok: boolean }>>`
          SELECT true AS ok FROM chats WHERE id = ${chatId} AND active LIMIT 1
        `;
        return rows.length > 0;
      }

      const groupIds = principal.groupIds.map((g) => BigInt(g));
      const rows = await tx.$queryRaw<Array<{ ok: boolean }>>`
        SELECT true AS ok
        FROM chats c
        WHERE c.id = ${chatId} AND c.active
          AND (
            EXISTS (SELECT 1 FROM chat_access a
                    WHERE a.chat_id = c.id AND a.group_id = ANY(${groupIds}::bigint[]))
            OR EXISTS (SELECT 1 FROM chat_users u
                       WHERE u.chat_id = c.id AND u.user_id = ${principal.actorId}
                         AND u.user_type = 'agent')
          )
        LIMIT 1
      `;
      return rows.length > 0;
    });
  }

  /**
   * Set (or clear) the "an agent is typing" flag the visitor's poll reads.
   *
   * Keyed by licence so it can never cross a tenant boundary. A short TTL rather
   * than an explicit clear on every path: a socket that drops mid-keystroke must
   * not leave the widget showing "typing" forever, so the flag lapses on its own
   * if no follow-up keystroke refreshes it.
   */
  async setAgentTyping(licenseId: string, chatId: string, isTyping: boolean): Promise<void> {
    const key = typingStateKey(licenseId, chatId);
    if (isTyping) {
      await this.redis.set(key, '1', 'EX', AGENT_TYPING_TTL_SECONDS);
    } else {
      await this.redis.del(key);
    }
  }

  /** Reads through the same tenant context the REST API uses, so RLS applies. */
  async #scoped<T>(principal: SocketPrincipal, fn: (tx: PrismaClient) => Promise<T>): Promise<T> {
    return this.db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_license', ${principal.licenseId}, true)`;
      await tx.$executeRaw`SELECT set_config('app.current_organization', ${principal.organizationId}, true)`;
      return fn(tx as unknown as PrismaClient);
    });
  }
}
