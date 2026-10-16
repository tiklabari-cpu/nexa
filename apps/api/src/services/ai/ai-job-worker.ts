/**
 * The AI job worker (tm 289.3 · ADR-11a · SiyahTuş analysis GV-02).
 *
 * Takes the jobs the outbox wrote (`ai-jobs.ts`) and runs them: a visitor's
 * message, answered — by whatever handler the server hands to {@link
 * AiJobWorker.start} (the rule bot, the AI Agent and the assignee's notice,
 * in that order: tm 289.5). What this file owns is everything around the
 * handler that makes the answer durable and single:
 *
 *   1. **Finding work.** A claim pass every {@link AI_JOB_POLL_MS}, plus one
 *      whenever the doorbell rings (`ai-job-wakeups.ts`, `LISTEN ai_jobs`) and
 *      whenever a job of this worker finishes — its chat's next job may be the
 *      head now. At most {@link AI_JOB_CONCURRENCY} jobs at once; a pass never
 *      claims more than it can start, so nothing claimed waits here.
 *   2. **Order.** `ai_jobs_claim` hands out one job per chat, oldest first, and
 *      none while that chat's head is running under a live lease — so one
 *      chat's messages are answered in the order they came, across every API
 *      process. Different chats do not wait for each other.
 *   3. **Before the handler,** in this order: a message that already has its
 *      answer settles `done` (`already_answered`); a connection that is no
 *      longer open settles `expired` (`connection_closed`) — nobody is there
 *      to read a reply; a job whose earlier claims all died, or one older than
 *      {@link AI_JOB_FRESHNESS_MS} (GV-02-S1: 120 s), is handed to a person —
 *      an internal note, the job `failed` / `expired`, a decision record — and
 *      the model is not called. A stale answer is worse than a person's.
 *   4. **One answer per message.** The handler writes its reply with
 *      {@link AiJobRun.replyOutbox}, which, inside the reply's own
 *      transaction, refuses a second answer to the same message
 *      (`properties.reply_to_event_id`, ADR-11a §2.6) and settles the job
 *      `done` fenced by this claim's attempt number. A worker whose lease ran
 *      out while the model was thinking has lost the job to the next claim:
 *      its reply rolls back. The lease does not stop two workers from
 *      *running* the model for one message; this is what stops them from both
 *      *sending*.
 *   5. **Failures.** A handler that throws is retried once (after
 *      {@link AI_JOB_RETRY_AFTER_MS}); the last attempt hands over. A worker
 *      that dies leaves its job `running` until the lease runs out, and the
 *      next claim — any process — takes it again; the claim function itself
 *      counts the attempts and fails a job no worker survived.
 *   6. **Shutdown.** {@link AiJobWorker.stop}: no new claims, the jobs in
 *      flight get up to {@link AI_JOB_DRAIN_MS} to finish, and any still
 *      running are handed back `pending` for the next process — their late
 *      replies, if any, are refused by the fence above.
 *
 * Eligibility the worker does not decide, and why: the AI's daily caps and
 * residency are the AI step's (`AiResponder`), because the rule bot and the
 * assignee's notice in the same job are not metered and must still run; "a
 * human has taken over" belongs to AI-11's guard when it lands. Routing on
 * hand-over is nothing today: every connection is routed to people when it
 * opens and the AI never holds one, so the conversation is already where a
 * person sees it (ADR-11a §2.5 — "already queued or assigned, untouched").
 */
import type { PrismaClient } from '@prisma/client';
import { type TenantContext, withTenant } from '../../lib/tenant.js';
import type { EventOutbox, OutboxEvent, SerialisedEvent } from '../chat/chat-service.js';
import {
  AI_JOB_MAX_ATTEMPTS,
  type AiJobClaim,
  type AiJobResult,
  claimAiJobs,
  settleAiJob,
} from './ai-jobs.js';
import type { AiJobWakeups } from './ai-job-wakeups.js';
import { type AiDecisionInput, recordAiDecision } from './decision-log.js';

/** How often the worker looks for due jobs when nothing woke it (ADR-11a §2.4). */
export const AI_JOB_POLL_MS = 500;
/** How long a claim holds its job before another worker may take it. */
export const AI_JOB_LEASE_MS = 60_000;
/** How old a job may be when it starts and still be answered (GV-02-S1). */
export const AI_JOB_FRESHNESS_MS = 120_000;
/** Jobs one worker runs at once. Each is mostly waiting on the model. */
export const AI_JOB_CONCURRENCY = 16;
/**
 * How long {@link AiJobWorker.stop} waits for the jobs in flight. Below the
 * shutdown's own ceiling (`lib/shutdown.ts` `CLOSE_TIMEOUT_MS`, 15 s), so the
 * close finishes on its own terms and a job cut off is handed back, not lost.
 */
export const AI_JOB_DRAIN_MS = 10_000;
/** The pause before a job whose handler threw is tried again. */
export const AI_JOB_RETRY_AFTER_MS = 1_000;

/** `properties.system_event` of the hand-over note. */
export const AI_JOB_HANDOVER_EVENT = 'ai_reply_expired';
/** The hand-over note — agents only, like every system line it is not translated. */
export const AI_JOB_HANDOVER_TEXT =
  'The AI reply was late, so this conversation was handed to a person.';

/** `ai_jobs.outcome` as the worker writes it. */
export const AI_JOB_OUTCOMES = {
  /** The handler's reply went out with the job. */
  replied: 'replied',
  /** The handler ran and wrote no reply (no rule, no skill, an attachment). */
  noReply: 'no_reply',
  /** The message had its answer already — a second one would be a duplicate. */
  alreadyAnswered: 'already_answered',
  /** The connection closed before the job could answer it. */
  connectionClosed: 'connection_closed',
  /** Older than {@link AI_JOB_FRESHNESS_MS}: handed to a person. */
  stale: 'stale',
  /** Every allowed attempt died with its worker: handed to a person. */
  attemptsExhausted: 'attempts_exhausted',
  /** The handler threw on its last attempt: handed to a person. */
  handlerFailed: 'handler_failed',
  /** The worker stopped with the job still running; handed back for the next one. */
  workerStopped: 'worker_stopped',
} as const;

/** Why a hand-over happened, as the note and the decision record say it. */
type HandoverReason = 'stale' | 'attempts_exhausted' | 'handler_failed';

/** Why {@link AiJobRun.replyOutbox} refused a reply. */
export type AiJobRefusal = 'already_answered' | 'connection_closed' | 'claim_lost';

/**
 * Thrown from {@link AiJobRun.replyOutbox} — inside the reply's transaction, so
 * the reply rolls back — when this run may not answer the message. A handler
 * may let it propagate or swallow it; the worker already knows.
 */
export class AiJobReplyRefusedError extends Error {
  constructor(readonly reason: AiJobRefusal) {
    super(`ai job reply refused: ${reason}`);
    this.name = 'AiJobReplyRefusedError';
  }
}

/** The logger a job's lines go to; a Fastify or pino logger is one. */
export interface AiJobLogger {
  child(bindings: Record<string, unknown>): AiJobLogger;
  debug(object: Record<string, unknown>, message: string): void;
  info(object: Record<string, unknown>, message: string): void;
  warn(object: Record<string, unknown>, message: string): void;
  error(object: Record<string, unknown>, message: string): void;
}

/** What a handler is given. */
export interface AiJobRun {
  readonly job: AiJobClaim;
  /** The visitor the message came from. */
  readonly customerId: string;
  /** Bound to the job's tenant, chat, connection, request and job ids. */
  readonly log: AiJobLogger;
  /**
   * Aborted once this claim's lease has run out, or the worker stopped without
   * waiting for it: from then on another claim may hold the job, and anything
   * this run still writes through {@link replyOutbox} is refused.
   */
  readonly signal: AbortSignal;
  /** Every reply carries these properties — the mark the duplicate check reads. */
  readonly replyProperties: { readonly reply_to_event_id: string };
  /**
   * Write the reply with this (`chats.sendEvent(…, { outbox: run.replyOutbox })`).
   * In the reply's transaction it refuses a reply that would be the message's
   * second answer, or that lands on another connection, or that this claim no
   * longer may send — throwing {@link AiJobReplyRefusedError}, which rolls the
   * reply back — and otherwise settles the job `done` with it.
   */
  readonly replyOutbox: EventOutbox;
}

/** What a handler reports; the outcome is a code (`ai_jobs_outcome_check`). */
export type AiJobHandler = (run: AiJobRun) => Promise<{ outcome?: string } | void>;

/** Where the hand-over note is written — `ChatService` is one. */
export interface AiJobNotes {
  addSystemNote(
    tenant: TenantContext,
    at: { chatId: string; threadId: string },
    note: { text: string; properties: Record<string, unknown> },
    options?: { outbox?: EventOutbox },
  ): Promise<SerialisedEvent | null>;
}

export interface AiJobWorkerOptions {
  db: PrismaClient;
  logger: AiJobLogger;
  /** The doorbell; without one the worker polls alone. */
  wakeups?: AiJobWakeups | null;
  pollMs?: number;
  leaseMs?: number;
  freshnessMs?: number;
  concurrency?: number;
  maxAttempts?: number;
  drainMs?: number;
  retryAfterMs?: number;
  /** The clock a job's age is read by. Injectable so a test need not wait 120 s. */
  now?: () => Date;
}

/** Facts about a job's conversation, read before the handler runs. */
interface JobFacts {
  open: boolean;
  customerId: string;
  answered: boolean;
}

interface InFlight {
  job: AiJobClaim;
  abort: AbortController;
  done: Promise<void>;
}

/** The ids every line about a job carries (`LOG_KEYS`, plus the job's own). */
function jobBindings(job: AiJobClaim): Record<string, unknown> {
  return {
    license_id: String(job.context.licenseId),
    organization_id: job.context.organizationId,
    chat_id: job.chatId,
    thread_id: job.threadId,
    ...(job.requestId ? { request_id: job.requestId } : {}),
    job_id: job.id,
    attempt: job.attempts,
  };
}

/** A code for `last_error`: the error's kind, never its message (which may quote the conversation). */
function errorCode(error: unknown): string {
  if (!(error instanceof Error)) return 'unknown';
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' && code ? `${error.name}:${code}` : error.name;
}

/** "Has this message been answered?" — inside `tx`, optionally not counting `except`. */
async function answeredAlready(
  tx: Pick<PrismaClient, '$queryRaw'>,
  job: AiJobClaim,
  except: string | null,
): Promise<boolean> {
  // The reply is written after the job (its transaction starts after the
  // claim), so nothing older than the job can be one; the bound lets the
  // planner skip every older month of `events`. A second of slack for the
  // millisecond the claim's timestamp lost on its way here.
  const rows = await tx.$queryRaw<Array<{ answered: boolean }>>`
    SELECT EXISTS (
      SELECT 1 FROM events e
       WHERE e.thread_id = ${job.threadId}
         AND e.created_at >= ${job.createdAt}::timestamptz - interval '1 second'
         AND e.properties @> jsonb_build_object('reply_to_event_id', ${job.triggerEventId}::text)
         AND e.id IS DISTINCT FROM ${except}::text
    ) AS answered`;
  return rows[0]?.answered === true;
}

export class AiJobWorker {
  readonly #db: PrismaClient;
  readonly #log: AiJobLogger;
  readonly #wakeups: AiJobWakeups | null;
  readonly #pollMs: number;
  readonly #leaseMs: number;
  readonly #freshnessMs: number;
  readonly #concurrency: number;
  readonly #maxAttempts: number;
  readonly #drainMs: number;
  readonly #retryAfterMs: number;
  readonly #now: () => Date;

  #handler: AiJobHandler | null = null;
  #notes: AiJobNotes | null = null;
  #timer: NodeJS.Timeout | null = null;
  #stopping = false;
  /** The claim pass under way, resolving to how many jobs it took. One at a time. */
  #pass: Promise<number> | null = null;
  /** Something asked for a pass while one was under way: run another after it. */
  #again = false;
  /** One failure warning per outage of the claim itself. */
  #claimFailing = false;
  /** Keyed by job and attempt: a job this worker re-claimed after its own lease ran out is a second run. */
  readonly #inFlight = new Map<string, InFlight>();

  constructor(options: AiJobWorkerOptions) {
    this.#db = options.db;
    this.#log = options.logger;
    this.#wakeups = options.wakeups ?? null;
    this.#pollMs = options.pollMs ?? AI_JOB_POLL_MS;
    this.#leaseMs = options.leaseMs ?? AI_JOB_LEASE_MS;
    this.#freshnessMs = options.freshnessMs ?? AI_JOB_FRESHNESS_MS;
    this.#concurrency = options.concurrency ?? AI_JOB_CONCURRENCY;
    this.#maxAttempts = options.maxAttempts ?? AI_JOB_MAX_ATTEMPTS;
    this.#drainMs = options.drainMs ?? AI_JOB_DRAIN_MS;
    this.#retryAfterMs = options.retryAfterMs ?? AI_JOB_RETRY_AFTER_MS;
    this.#now = options.now ?? (() => new Date());
    if (!Number.isInteger(this.#concurrency) || this.#concurrency < 1) {
      throw new RangeError('AiJobWorker: concurrency must be a positive integer');
    }
  }

  /**
   * Begin taking jobs: `handler` answers them, `notes` writes the hand-over
   * note. Once per worker.
   */
  start(options: { handler: AiJobHandler; notes: AiJobNotes }): void {
    if (this.#handler || this.#stopping) throw new Error('AiJobWorker: start() once per worker');
    this.#handler = options.handler;
    this.#notes = options.notes;
    this.#timer = setInterval(() => this.wake(), this.#pollMs);
    // A worker is never the reason a process stays up.
    this.#timer.unref();
    this.#wakeups?.start(() => this.wake());
    this.wake();
  }

  /** Whether {@link start} has run and {@link stop} has not. */
  get started(): boolean {
    return this.#handler !== null && !this.#stopping;
  }

  /** Jobs this worker is running right now. */
  get inFlight(): number {
    return this.#inFlight.size;
  }

  /** Look for due jobs now. Cheap to call often: concurrent calls fold into one pass. */
  wake(): void {
    if (!this.#handler || this.#stopping) return;
    if (this.#pass) {
      this.#again = true;
      return;
    }
    this.#pass = this.#claimPass().finally(() => {
      this.#pass = null;
      if (this.#again) {
        this.#again = false;
        this.wake();
      }
    });
  }

  /**
   * Resolves once nothing is in flight and a pass finds nothing due — "what
   * the messages so far set off has run". For tests and scripts; a job handed
   * back with a delay is not due yet and is not waited for.
   */
  async idle(): Promise<void> {
    for (;;) {
      while (this.#pass || this.#inFlight.size > 0) {
        await this.#pass;
        await Promise.all([...this.#inFlight.values()].map((run) => run.done));
      }
      if (!this.started) return;
      this.wake();
      const claimed = await this.#pass;
      if (claimed === 0 && !this.#pass && this.#inFlight.size === 0) return;
    }
  }

  /**
   * Stop taking jobs and let the ones in flight finish, for up to `drainMs`.
   * Any still running then are handed back `pending`, for the next claim to
   * take at once; whatever they write afterwards is refused by the fence.
   */
  async stop(options: { drainMs?: number } = {}): Promise<void> {
    if (!this.#handler || this.#stopping) return;
    this.#stopping = true;
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
    await this.#wakeups?.stop();
    // A pass already under way finishes, and what it claimed is in flight now.
    await this.#pass;

    if (this.#inFlight.size === 0) return;
    const drainMs = options.drainMs ?? this.#drainMs;
    this.#log.info(
      { in_flight: this.#inFlight.size, drain_ms: drainMs },
      'waiting for ai jobs in flight',
    );
    let timer: NodeJS.Timeout | undefined;
    const finished = await Promise.race([
      Promise.all([...this.#inFlight.values()].map((run) => run.done)).then(() => true),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), drainMs);
        timer.unref();
      }),
    ]);
    if (timer) clearTimeout(timer);
    if (finished) return;

    const left = [...this.#inFlight.values()];
    this.#log.warn(
      { in_flight: left.length, drain_ms: drainMs },
      'ai jobs still running at shutdown; handing them back',
    );
    await Promise.all(
      left.map(async ({ job, abort }) => {
        abort.abort(new Error('the worker stopped'));
        await this.#settle(job, {
          state: 'pending',
          outcome: AI_JOB_OUTCOMES.workerStopped,
        }).catch((error: unknown) =>
          this.#log
            .child(jobBindings(job))
            .warn({ err: error }, 'ai job could not be handed back; its lease will free it'),
        );
      }),
    );
  }

  /** One claim pass. Never rejects: a failing claim is retried by the next poll. */
  async #claimPass(): Promise<number> {
    const free = this.#concurrency - this.#inFlight.size;
    if (free <= 0) return 0;
    let claims: AiJobClaim[];
    try {
      claims = await claimAiJobs(this.#db, {
        limit: free,
        leaseMs: this.#leaseMs,
        maxAttempts: this.#maxAttempts,
      });
    } catch (error) {
      if (!this.#claimFailing) {
        this.#claimFailing = true;
        this.#log.error({ err: error }, 'ai jobs could not be claimed; retrying every poll');
      }
      return 0;
    }
    if (this.#claimFailing) {
      this.#claimFailing = false;
      this.#log.info({}, 'ai jobs can be claimed again');
    }
    for (const job of claims) this.#launch(job);
    // A full pass may have left more due: look again once it is done.
    if (claims.length === free) this.#again = true;
    return claims.length;
  }

  #launch(job: AiJobClaim): void {
    const key = `${job.id}:${job.attempts}`;
    const abort = new AbortController();
    const lease = setTimeout(() => abort.abort(new Error('the lease ran out')), this.#leaseMs);
    lease.unref();
    const log = this.#log.child(jobBindings(job));
    const done = this.#run(job, log, abort.signal)
      .catch((error: unknown) => {
        // `#run` handles its own failures; this is the backstop for a bug in it.
        log.error({ err: error }, 'ai job run failed');
      })
      .finally(() => {
        clearTimeout(lease);
        this.#inFlight.delete(key);
        // This job's chat may have its next job at the head now.
        this.wake();
      });
    this.#inFlight.set(key, { job, abort, done });
  }

  async #run(job: AiJobClaim, log: AiJobLogger, signal: AbortSignal): Promise<void> {
    let facts: JobFacts | null;
    try {
      facts = await this.#facts(job);
    } catch (error) {
      log.warn({ err: error }, 'ai job could not be read; trying again shortly');
      await this.#retry(job, log, 'worker_error', error);
      return;
    }
    // The connection is gone (deleted with its chat), and the job with it.
    if (!facts) return;

    if (facts.answered) {
      await this.#finish(job, log, { state: 'done', outcome: AI_JOB_OUTCOMES.alreadyAnswered });
      return;
    }
    if (!facts.open) {
      await this.#closed(job, log, facts.customerId);
      return;
    }
    if (job.exhausted) {
      await this.#handOver(job, log, facts.customerId, 'attempts_exhausted');
      return;
    }
    const ageMs = this.#now().getTime() - job.createdAt.getTime();
    if (ageMs > this.#freshnessMs) {
      await this.#handOver(job, log, facts.customerId, 'stale', { ageMs });
      return;
    }

    const refused: { reason: AiJobRefusal | null } = { reason: null };
    let result: { outcome?: string } | void = undefined;
    try {
      result = await this.#handler!({
        job,
        customerId: facts.customerId,
        log,
        signal,
        replyProperties: { reply_to_event_id: job.triggerEventId },
        replyOutbox: this.#replyGuard(job, refused),
      });
    } catch (error) {
      if (!refused.reason) {
        await this.#failed(job, log, facts.customerId, error);
        return;
      }
      // The handler let the refusal through; what it means is below.
    }

    switch (refused.reason) {
      case 'claim_lost':
        log.info({}, 'another claim holds this job now; its reply was not sent');
        return;
      case 'connection_closed':
        await this.#closed(job, log, facts.customerId);
        return;
      case 'already_answered':
        await this.#finish(job, log, { state: 'done', outcome: AI_JOB_OUTCOMES.alreadyAnswered });
        return;
      case null: {
        // Settled already when the reply went out with the job; then this is a no-op.
        const outcome = (result && result.outcome) || AI_JOB_OUTCOMES.noReply;
        await this.#finish(job, log, { state: 'done', outcome }, { quiet: true });
        return;
      }
    }
  }

  /** The conversation's state, read in the job's tenant before anything runs. */
  async #facts(job: AiJobClaim): Promise<JobFacts | null> {
    return withTenant(this.#db, job.context, async (tx) => {
      const rows = await tx.$queryRaw<Array<{ open: boolean; customer_id: string }>>`
        SELECT (t.active AND c.active) AS open, c.customer_id::text AS customer_id
          FROM threads t JOIN chats c ON c.id = t.chat_id
         WHERE t.id = ${job.threadId}`;
      const row = rows[0];
      if (!row) return null;
      return {
        open: row.open,
        customerId: row.customer_id,
        answered: await answeredAlready(tx, job, null),
      };
    });
  }

  /** The outbox a reply is written with — see {@link AiJobRun.replyOutbox}. */
  #replyGuard(job: AiJobClaim, refused: { reason: AiJobRefusal | null }): EventOutbox {
    const refuse = (reason: AiJobRefusal): never => {
      refused.reason ??= reason;
      throw new AiJobReplyRefusedError(reason);
    };
    return async (tx, written: OutboxEvent) => {
      if (written.event.properties['reply_to_event_id'] !== job.triggerEventId) {
        // A reply without the mark could not be found by the duplicate check.
        throw new Error('an ai job reply must carry run.replyProperties');
      }
      if (written.threadId !== job.threadId) refuse('connection_closed');
      if (await answeredAlready(tx, job, written.event.id)) refuse('already_answered');
      const settled = await settleAiJob(tx, job, {
        state: 'done',
        outcome: AI_JOB_OUTCOMES.replied,
      });
      if (!settled) refuse('claim_lost');
    };
  }

  /** Settle in the job's tenant. False when this claim no longer holds the job. */
  #settle(job: AiJobClaim, result: AiJobResult): Promise<boolean> {
    return withTenant(this.#db, job.context, (tx) => settleAiJob(tx, job, result));
  }

  async #finish(
    job: AiJobClaim,
    log: AiJobLogger,
    result: AiJobResult,
    options: { quiet?: boolean } = {},
  ): Promise<boolean> {
    const settled = await this.#settle(job, result);
    if (settled) {
      log.debug({ state: result.state, outcome: result.outcome }, 'ai job finished');
    } else if (!options.quiet) {
      log.info({ outcome: result.outcome }, 'ai job was no longer this claim to settle');
    }
    return settled;
  }

  /** A connection that closed under the job: nothing to answer, nobody to hand over to. */
  async #closed(job: AiJobClaim, log: AiJobLogger, customerId: string): Promise<void> {
    const settled = await this.#finish(job, log, {
      state: 'expired',
      outcome: AI_JOB_OUTCOMES.connectionClosed,
    });
    if (settled) {
      await this.#record(job, log, customerId, {
        decision: 'expired',
        details: { reason: AI_JOB_OUTCOMES.connectionClosed },
      });
    }
  }

  /** A handler that threw: once more after a pause, or a person on the last attempt. */
  async #failed(
    job: AiJobClaim,
    log: AiJobLogger,
    customerId: string,
    error: unknown,
  ): Promise<void> {
    if (job.attempts < this.#maxAttempts) {
      log.warn({ err: error }, 'ai job handler failed; trying again shortly');
      await this.#retry(job, log, AI_JOB_OUTCOMES.handlerFailed, error);
      return;
    }
    log.error({ err: error }, 'ai job handler failed on its last attempt; handing over');
    await this.#handOver(job, log, customerId, 'handler_failed', { error });
  }

  async #retry(job: AiJobClaim, log: AiJobLogger, outcome: string, error: unknown): Promise<void> {
    await this.#settle(job, {
      state: 'pending',
      outcome,
      error: errorCode(error),
      retryAfterMs: this.#retryAfterMs,
    }).catch((settleError: unknown) =>
      log.warn({ err: settleError }, 'ai job could not be handed back; its lease will free it'),
    );
  }

  /**
   * Leave the message to a person (ADR-11a §2.5): an internal note on the
   * connection, written in the transaction that settles the job — so only the
   * claim that still holds the job leaves one — then a decision record. The
   * model is not called.
   */
  async #handOver(
    job: AiJobClaim,
    log: AiJobLogger,
    customerId: string,
    reason: HandoverReason,
    extra: { ageMs?: number; error?: unknown } = {},
  ): Promise<void> {
    const result: AiJobResult = {
      state: reason === 'stale' ? 'expired' : 'failed',
      outcome: reason,
      ...(extra.error !== undefined ? { error: errorCode(extra.error) } : {}),
    };
    let lost = false;
    let note: SerialisedEvent | null;
    try {
      note = await this.#notes!.addSystemNote(
        job.context,
        { chatId: job.chatId, threadId: job.threadId },
        {
          text: AI_JOB_HANDOVER_TEXT,
          properties: {
            system_event: AI_JOB_HANDOVER_EVENT,
            reason,
            trigger_event_id: job.triggerEventId,
          },
        },
        {
          outbox: async (tx) => {
            if (!(await settleAiJob(tx, job, result))) {
              lost = true;
              throw new AiJobReplyRefusedError('claim_lost');
            }
          },
        },
      );
    } catch (error) {
      if (lost) {
        log.info({ reason }, 'another claim holds this job now; no hand-over note from this one');
        return;
      }
      throw error;
    }
    if (note === null) {
      // The connection closed in the meantime: nobody to hand it to.
      await this.#closed(job, log, customerId);
      return;
    }

    log.warn(
      { reason, ...(extra.ageMs !== undefined ? { age_ms: extra.ageMs } : {}) },
      'ai job handed to a person',
    );
    await this.#record(job, log, customerId, {
      decision: reason === 'stale' ? 'expired' : 'handoff',
      handoffReason: reason,
      ...(extra.error !== undefined ? { errorType: errorCode(extra.error) } : {}),
      details: {
        note_event_id: note.id,
        ...(extra.ageMs !== undefined ? { age_ms: extra.ageMs } : {}),
      },
    });
  }

  /** One decision record (ID-08) for a job the worker ended without the handler. */
  async #record(
    job: AiJobClaim,
    log: AiJobLogger,
    customerId: string,
    input: Pick<AiDecisionInput, 'decision' | 'handoffReason' | 'errorType' | 'details'>,
  ): Promise<void> {
    await recordAiDecision(
      (fn) => withTenant(this.#db, job.context, fn),
      job.context,
      {
        ...input,
        chatId: job.chatId,
        threadId: job.threadId,
        customerId,
        triggerEventId: job.triggerEventId,
        requestId: job.requestId,
        jobId: job.id,
      },
      log,
    );
  }
}
