/**
 * Who and what every log line is about (ID-08 · tm 288.1).
 *
 * Fastify gives each request a child logger carrying `request_id` and nothing
 * else, so a line written deep inside the AI path said "skill engine failed"
 * and a chat id — or, depending on who wrote it, `chatId` — and never which
 * workspace, which visitor or which connection. This module rebinds the
 * request's logger as soon as each fact is known, so every line written after
 * that point carries it without the call site having to remember:
 *
 *  - authentication (`plugins/auth.ts`) binds `license_id`, `organization_id`,
 *    `actor_type`, `actor_id` — and `customer_id` for a widget token;
 *  - this plugin's `onRequest` hook binds the route's own `:chatId`,
 *    `:threadId` and `:customerId` params, after authentication;
 *  - a handler that learns the rest — the visitor's message route learns the
 *    chat and the connection only once it has written — calls
 *    `bindChatLogContext`.
 *
 * Rebinding replaces the child rather than stacking another on top of it:
 * pino does not deduplicate, so a second child carrying `chat_id` would write
 * the key twice on every line. The original request logger is kept and every
 * rebind is one `child()` of it with the merged context.
 *
 * `reply.log` is a separate property Fastify set once, at the start; the
 * `request completed` / `request errored` lines are written through it. The
 * `onSend` hook below hands it the latest logger, so the line that closes a
 * request carries what the request learnt.
 *
 * The keys are `LOG_KEYS` (`@siyahtus/types`); `scripts/audit/log-keys.mjs`
 * keeps a camelCase twin out of every log call in this app and in RTM.
 */
import type { FastifyBaseLogger, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { logContextValue, type LogContext } from '@siyahtus/types';
import type { Principal } from '../services/auth/principal.js';

const kBaseLogger = Symbol('siyahtus.baseLogger');
const kLogContext = Symbol('siyahtus.logContext');

interface ContextCarrier {
  [kBaseLogger]?: FastifyBaseLogger;
  [kLogContext]?: LogContext;
}

/**
 * Merge `context` into the request's log context and rebind `request.log`.
 *
 * Undefined values are skipped, so a caller can pass what it has without
 * filtering. A key already bound to the same value costs nothing; a key bound
 * to a different value is replaced — the latest fact wins, which is what a
 * handler that narrows from a chat to its connection wants.
 */
export function bindLogContext(request: FastifyRequest, context: LogContext): void {
  const carrier = request as FastifyRequest & ContextCarrier;
  const current = carrier[kLogContext] ?? {};
  const merged: LogContext = { ...current };
  let changed = false;
  for (const [key, value] of Object.entries(context)) {
    if (value === undefined || merged[key as keyof LogContext] === value) continue;
    (merged as Record<string, string>)[key] = value;
    changed = true;
  }
  if (!changed) return;

  const base = carrier[kBaseLogger] ?? request.log;
  carrier[kBaseLogger] = base;
  carrier[kLogContext] = merged;
  request.log = base.child(merged);
}

/** What the request's logger is bound to now — for tests and for callers that pass it on. */
export function logContextOf(request: FastifyRequest): Readonly<LogContext> {
  return (request as FastifyRequest & ContextCarrier)[kLogContext] ?? {};
}

/**
 * Bind the conversation a line is about: the day container (`chat_id`, the
 * panel's "Thread ID"), the connection (`thread_id`, its "Chat ID") and the
 * member. Call it as soon as the handler knows them.
 */
export function bindChatLogContext(
  request: FastifyRequest,
  ids: { chatId?: string | null; threadId?: string | null; customerId?: string | null },
): void {
  bindLogContext(request, {
    chat_id: logContextValue(ids.chatId),
    thread_id: logContextValue(ids.threadId),
    customer_id: logContextValue(ids.customerId),
  });
}

/** The identity half of a log context, from whoever authenticated. */
export function principalLogContext(principal: Principal): LogContext {
  const workspace = {
    license_id: logContextValue(principal.licenseId),
    organization_id: principal.organizationId,
    actor_type: principal.kind,
  };
  switch (principal.kind) {
    case 'agent':
      // An operator signed in as the member (tm 389.15): every line says so,
      // and which operator and session, so a log search for the member's
      // requests cannot mistake the operator's for theirs.
      if (principal.impersonation) {
        return {
          ...workspace,
          actor_id: principal.accountId,
          platform_admin_id: principal.impersonation.adminId,
          impersonation_session_id: principal.impersonation.sessionId,
        };
      }
      return { ...workspace, actor_id: principal.accountId };
    case 'enrollment':
      return { ...workspace, actor_id: principal.accountId };
    case 'bot':
      return { ...workspace, actor_id: principal.botId };
    case 'customer':
      return { ...workspace, actor_id: principal.customerId, customer_id: principal.customerId };
    case 'scim':
      // A directory connector names no person; the token is who acted.
      return { ...workspace, actor_id: principal.tokenId };
  }
}

/**
 * A route param worth binding: one of ours is a short id, a UUID or an event
 * id, all within this alphabet. Anything else is the caller's text, already on
 * the request line (masked), and not repeated on every line after it.
 */
const PARAM_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

const PARAM_KEYS = [
  ['chatId', 'chat_id'],
  ['threadId', 'thread_id'],
  ['customerId', 'customer_id'],
] as const;

async function logContextPlugin(app: FastifyInstance): Promise<void> {
  app.addHook('onRequest', async (request: FastifyRequest) => {
    const params = request.params as Record<string, unknown> | undefined;
    if (!params) return;
    const context: LogContext = {};
    for (const [param, key] of PARAM_KEYS) {
      const value = params[param];
      if (typeof value === 'string' && PARAM_ID_RE.test(value)) context[key] = value;
    }
    bindLogContext(request, context);
  });

  app.addHook('onSend', async (request: FastifyRequest, reply: FastifyReply) => {
    reply.log = request.log;
  });
}

export default fp(logContextPlugin, { name: 'log-context', dependencies: ['auth'] });
