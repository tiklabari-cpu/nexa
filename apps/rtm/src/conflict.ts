/**
 * Multi-agent composing-conflict detection (FR-MOD-08.6.3).
 *
 * When a second agent starts replying in a chat someone else is already
 * replying to, the workspace wants to warn them before two answers race out.
 * This service is the detector: it records who is composing and reports back
 * when more than one agent is at once. It does not push anything — the
 * dispatcher wires the decision to an `agent_conflict_warning` envelope
 * (a later slice); here we only decide.
 *
 * Two properties make this security-sensitive rather than a bookkeeping helper:
 *
 *  - Authorization. Recording is gated by the same tenant-scoped visibility
 *    read `typing` uses, so a caller can neither register on nor learn about a
 *    chat they cannot see. Without it, `is_typing` would be a way to probe which
 *    chat ids exist and to discover which agents are working which conversation.
 *    An inaccessible chat answers exactly as a missing one: an empty set,
 *    nothing written.
 *
 *  - Atomicity. Detection must survive two agents registering at the same
 *    instant. A read-then-write — "who is here? nobody? then it is just me" —
 *    lets both concurrent writers read a pre-insert view and each conclude they
 *    are alone, so the conflict vanishes precisely when it matters. The prune,
 *    the write and the read-back are therefore one Redis script, so whoever
 *    lands second always observes the first.
 */
import type { PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';
import { AGENT_COMPOSING_TTL_SECONDS, composerStateKey } from '@nexa/types';
import type { SocketPrincipal } from './auth.js';

/** One agent currently composing a reply in a chat. */
export interface ComposingAgent {
  agentId: string;
  /** Unix ms of this agent's most recent composing signal in the window. */
  since: number;
}

export interface ConflictDecision {
  /**
   * Everyone composing in the window, the caller included. Empty when the
   * caller cannot see the chat — deliberately indistinguishable from a chat
   * that does not exist.
   */
  agents: ComposingAgent[];
  /** True when two or more distinct agents are composing at once. */
  conflict: boolean;
}

/**
 * KEYS[1] composer registry key · ARGV: now(ms), windowMs, agentId, op
 * where op is 'add' (still composing) or 'remove' (stopped). Returns the
 * surviving members as a flat [member, score, member, score, ...] array.
 *
 * Prune → mutate → read in one script so the whole thing is atomic. Pruning by
 * score first means a writer that stopped refreshing is gone before the
 * survivors are read, so a dropped socket never lingers as a phantom conflict;
 * doing the read in the same call means a racing registrant cannot slip in
 * between another's write and read and be missed.
 */
const COMPOSER_REGISTRY_LUA = `
local key    = KEYS[1]
local now    = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local member = ARGV[3]
local op     = ARGV[4]

redis.call('ZREMRANGEBYSCORE', key, 0, now - window)

if op == 'remove' then
  redis.call('ZREM', key, member)
else
  redis.call('ZADD', key, now, member)
  -- Only a live registration keeps the registry alive; a withdrawal must not
  -- prolong it. Per-agent expiry is still the score prune above — this is the
  -- backstop that clears a chat nobody is composing in.
  redis.call('PEXPIRE', key, window)
end

return redis.call('ZRANGE', key, 0, -1, 'WITHSCORES')
`;

export class ConflictDetectionService {
  #scriptSha: string | null = null;

  constructor(
    private readonly db: PrismaClient,
    private readonly redis: Redis,
    /**
     * How long a registration survives without a refresh. Injectable so a test
     * can use a sub-second window; production uses the shared constant.
     */
    private readonly windowMs: number = AGENT_COMPOSING_TTL_SECONDS * 1_000,
  ) {}

  /**
   * Record (`isComposing`) or withdraw (`!isComposing`) the agent as composing
   * on the chat and report who else is. Authorises first, so an agent who
   * cannot see the chat neither writes nor learns anything: an empty decision,
   * the same answer a missing chat gives.
   */
  async record(
    principal: SocketPrincipal,
    chatId: string,
    isComposing: boolean,
  ): Promise<ConflictDecision> {
    if (!(await this.#canAccess(principal, chatId))) {
      return { agents: [], conflict: false };
    }

    // Keyed by the socket's own licence, never a client-supplied one, so the
    // same chat id in two tenants can never collide on one registry.
    const key = composerStateKey(principal.licenseId, chatId);
    const members = parseMembers(await this.#runRegistry(key, principal.actorId, isComposing));
    // Sorted-set members are unique by construction, so the length is the count
    // of distinct agents — a repeated register by one agent never trips this.
    return { agents: members, conflict: members.length >= 2 };
  }

  /** Runs the registry script, loading it once and reloading on a cache flush. */
  async #runRegistry(key: string, agentId: string, isComposing: boolean): Promise<unknown> {
    const args = [String(Date.now()), String(this.windowMs), agentId, isComposing ? 'add' : 'remove'];
    try {
      if (!this.#scriptSha) {
        this.#scriptSha = (await this.redis.script('LOAD', COMPOSER_REGISTRY_LUA)) as string;
      }
      return await this.redis.evalsha(this.#scriptSha, 1, key, ...args);
    } catch (error) {
      // NOSCRIPT means Redis restarted and dropped the cached script — reload.
      if (error instanceof Error && error.message.includes('NOSCRIPT')) {
        this.#scriptSha = null;
        return this.redis.eval(COMPOSER_REGISTRY_LUA, 1, key, ...args);
      }
      throw error;
    }
  }

  /**
   * Whether this socket may compose on the chat. Copied verbatim from `typing`'s
   * `canType` on purpose: the two features share one visibility rule — an
   * unrestricted token sees any active chat in the licence, everyone else only
   * chats their team is routed to or they are personally in — and letting the
   * copies drift would open an authorization gap in one but not the other.
   * Returns false rather than throwing so the caller can answer an inaccessible
   * chat exactly as it answers a missing one.
   */
  async #canAccess(principal: SocketPrincipal, chatId: string): Promise<boolean> {
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

  /** Reads through the same tenant context the REST API uses, so RLS applies. */
  async #scoped<T>(principal: SocketPrincipal, fn: (tx: PrismaClient) => Promise<T>): Promise<T> {
    return this.db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_license', ${principal.licenseId}, true)`;
      await tx.$executeRaw`SELECT set_config('app.current_organization', ${principal.organizationId}, true)`;
      return fn(tx as unknown as PrismaClient);
    });
  }
}

/** ZRANGE WITHSCORES comes back flat: [member, score, member, score, ...]. */
function parseMembers(raw: unknown): ComposingAgent[] {
  if (!Array.isArray(raw)) return [];
  const agents: ComposingAgent[] = [];
  for (let i = 0; i + 1 < raw.length; i += 2) {
    agents.push({ agentId: String(raw[i]), since: Number(raw[i + 1]) });
  }
  return agents;
}
