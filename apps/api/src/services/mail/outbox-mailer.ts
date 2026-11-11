/**
 * Every mail the API sends, through the durable outbox (tm 464.2 · G-05 / NY-44).
 *
 * 464.1 built `mail_outbox` and the job that drains it; nothing wrote to it.
 * This is the {@link Mailer} the server now hands every caller in place of the
 * capped carrier: `send` writes the message to the outbox, commits, and sends
 * that row at once through the carrier — so a request or a sweep sees its mail
 * leave as fast as before — and a first try that fails retryably stays queued
 * for the `mail_outbox` job instead of being lost with the process.
 *
 * What a caller learns from `send`:
 *
 * - it resolves when the carrier took the mail, **or** when the outbox holds it
 *   for a retry. Either way the mail is no longer the caller's to send: a sweep
 *   that used to try again on its next pass must not (that would be a second
 *   copy once the outbox's own retry lands), and an invitation the outbox will
 *   still deliver is not "undelivered".
 * - it throws what the carrier threw when the mail will never go out — a
 *   permanent refusal, a daily cap (`MailCapError`, so `isCapRefusal` still
 *   reads it), or `unconfirmed` (handed over, never confirmed — not sent
 *   again, §D178). `deliver()` turns those into outcomes as it always has.
 *
 * Callers that decide inside a transaction should queue in it instead
 * (`enqueueMail`) and hand the id to {@link OutboxMailer.dispatch} after
 * the commit — a committed decision then has its mail even if the process dies
 * before it reaches this line. `send` writes in a transaction of its own: the
 * mail is durable from that moment, which is the best a caller that holds no
 * transaction (or must not lengthen one — the password reset's timing, tm
 * 255.4) can have.
 */
import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import type { MailOutcome } from './delivery.js';
import { PermanentMailError } from './mail-error.js';
import type { Mailer, Message } from './mailer.js';
import {
  mailOutboxRow,
  MailOutboxWorker,
  type MailOutboxLogger,
  type MailOutboxSendResult,
  type MailOutboxSettledEvent,
} from './outbox.js';

declare module 'fastify' {
  interface FastifyInstance {
    /** The server's mailer (tm 464.2) — for a caller that queues in its own transaction. */
    mailOutbox: OutboxMailer;
  }
}

/**
 * How a dispatched mail stands once its first try is over: the carrier's
 * outcome, or `queued` — the outbox holds it for a retry (or another sender
 * is sending it), and its end is told to the settle hook, not to this caller.
 */
export type MailDispatchOutcome = MailOutcome | { status: 'queued' };

export interface OutboxMailerOptions {
  logger?: MailOutboxLogger;
  /** Told every row's end, whichever sender settled it (a ticket reply's status). */
  onSettled?: (event: MailOutboxSettledEvent) => Promise<void>;
}

export class OutboxMailer implements Mailer {
  /** The carrier the outbox sends through — the capped one. */
  readonly carrier: Mailer;
  readonly #db: PrismaClient;
  readonly #options: OutboxMailerOptions;
  readonly #worker: MailOutboxWorker;

  constructor(db: PrismaClient, carrier: Mailer, options: OutboxMailerOptions = {}) {
    this.#db = db;
    this.carrier = carrier;
    this.#options = options;
    this.#worker = this.createWorker(options.logger);
  }

  /** The sender over the same carrier and settle hook — the `mail_outbox` job's. */
  createWorker(logger?: MailOutboxLogger): MailOutboxWorker {
    return new MailOutboxWorker(this.#db, {
      mailer: this.carrier,
      ...(logger ? { logger } : {}),
      ...(this.#options.onSettled ? { onSettled: this.#options.onSettled } : {}),
    });
  }

  /**
   * Queue `message` in a transaction of its own. A workspace's mail is written
   * under that workspace's licence (RLS); account mail under none. Returns the
   * row id, or null when `idempotencyKey` was queued before.
   */
  async enqueue(message: Message, idempotencyKey?: string): Promise<string | null> {
    const row = mailOutboxRow(message, idempotencyKey ?? `${message.kind}:${randomUUID()}`);
    const insert = this.#db.mailOutbox.createMany({ data: [row], skipDuplicates: true });
    // One statement, or a batch of two — never an interactive transaction,
    // whose 2 s wait for a connection is a mail lost under load, where the
    // send this replaced needed no connection at all.
    const { count } =
      message.licenseId === null
        ? await insert
        : (
            await this.#db.$transaction([
              this.#db
                .$executeRaw`SELECT set_config('app.current_license', ${message.licenseId.toString()}, true)`,
              insert,
            ])
          )[1];
    return count === 1 ? row.id : null;
  }

  /** Send the committed row `id` now; see {@link MailDispatchOutcome}. */
  async dispatch(id: string): Promise<MailDispatchOutcome> {
    return outcomeOf(await this.#worker.sendNow(id));
  }

  /** Queue and send now. A key queued before is `queued`: its mail is the earlier row's. */
  async post(message: Message, idempotencyKey?: string): Promise<MailDispatchOutcome> {
    const id = await this.enqueue(message, idempotencyKey);
    return id === null ? { status: 'queued' } : this.dispatch(id);
  }

  async send(message: Message): Promise<void> {
    const outcome = await this.post(message);
    if (outcome.status === 'sent' || outcome.status === 'queued') return;
    throw outcome.error;
  }
}

function outcomeOf(result: MailOutboxSendResult): MailDispatchOutcome {
  switch (result.status) {
    case 'taken':
    case 'queued':
      return { status: 'queued' };
    case 'sent':
      return { status: 'sent' };
    case 'unconfirmed':
    case 'failed':
      // The carrier's own outcome; none only for a row whose payload was not a
      // message, which this process's enqueue cannot write.
      return (
        result.outcome ?? {
          status: 'failed',
          error: new PermanentMailError({ code: 'invalid_message', phase: 'compose' }),
        }
      );
  }
}

/** Whether `mailer` queues through the outbox — the server's always does. */
export function isOutboxMailer(mailer: Mailer): mailer is OutboxMailer {
  return mailer instanceof OutboxMailer;
}
