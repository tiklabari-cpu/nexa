/**
 * One visitor message being answered (tm 289.5 · ADR-11a · GV-02) — what the
 * rule bot (`bots/rule-bot-responder.ts`) and the AI Agent
 * (`ai/ai-responder.ts`) are given in place of the request that wrote the
 * message.
 *
 * The answer runs in the AI job worker, after the response and possibly in
 * another process (`ai/ai-job-worker.ts`): nothing here may come from the
 * connection the message arrived on. The customer routes build one from the
 * job (`routes/customer.ts`, `answerVisitorMessage`).
 *
 * Here, beside the chat core, rather than under `services/ai/`: the rule bot
 * takes it too, and the rule bot reaches no AI module at all (FR-MOD-06.6,
 * `bots/rule-bot-isolation.test.ts`). So does the refusal a reply can meet.
 */
import type { IdentityTrust } from '@siyahtus/types';
import type { TenantClient, TenantContext } from '../../lib/tenant.js';
import type { EventOutbox } from './chat-service.js';

/** The lines a turn writes; the job's logger, bound to its ids, is one. */
export interface TurnLogger {
  info(object: Record<string, unknown>, message: string): void;
  warn(object: Record<string, unknown>, message: string): void;
  error(object: Record<string, unknown>, message: string): void;
}

export interface VisitorTurn {
  readonly tenant: TenantContext;
  /** The day container (panel "Thread ID"). */
  readonly chatId: string;
  /** The connection (panel "Chat ID") the message was written on. */
  readonly threadId: string;
  readonly customerId: string;
  /** The visitor's message the turn answers. */
  readonly triggerEventId: string;
  /** The request that wrote the message, for the decision record. */
  readonly requestId: string | null;
  readonly log: TurnLogger;
  /** One transaction in the turn's tenant. */
  readonly withTenant: <T>(fn: (tx: TenantClient) => Promise<T>) => Promise<T>;
  /** Residency (NFR-C4 · C4-e): throws unless this workspace's content may reach the model. */
  requireAiInference(): Promise<void>;
  /** The daily AI caps (tm 257.8): throws `AiDailyCapError` once today's allowance is spent. */
  requireAiBudget(): Promise<void>;
  /** Merged into the reply's properties — the mark the job's duplicate check reads. */
  readonly replyProperties: Readonly<Record<string, unknown>>;
  /**
   * Written with the reply, in its transaction: refuses a second answer to the
   * message (throwing {@link AiJobReplyRefusedError}, which rolls the reply
   * back) and settles the job with the first.
   */
  readonly replyOutbox: EventOutbox;
  /**
   * How the visitor who wrote the message proved who they are (tm 294 · K4),
   * as the job recorded it: what the turn may recall of the day's earlier
   * connections. `claimed` when nothing was recorded.
   */
  readonly identityTrust: IdentityTrust;
}

/** Why a reply was refused. */
export type AiJobRefusal = 'already_answered' | 'connection_closed' | 'claim_lost';

/**
 * Thrown from the reply's outbox — inside the reply's transaction, so the
 * reply rolls back — when this run may not answer the message. A responder
 * lets it through: it is not a failure, and the worker already knows.
 */
export class AiJobReplyRefusedError extends Error {
  constructor(readonly reason: AiJobRefusal) {
    super(`ai job reply refused: ${reason}`);
    this.name = 'AiJobReplyRefusedError';
  }
}
