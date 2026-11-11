/**
 * The durable outgoing-mail queue (tm 464.1 · G-05 / NY-44).
 *
 * Until this, a mail lived only in the process that decided to send it:
 * `deliver()` handed it to the carrier there and then, and the one retry was
 * the SMTP carrier's own three tries inside that call (`smtp-mailer.ts`). A
 * restart between the decision and the server's `250` lost it, and so did a
 * carrier outage longer than those few seconds.
 *
 * Two halves, one table (`mail_outbox`, migration 20270102090000):
 *
 * - {@link enqueueMail} — written in the caller's transaction, so a committed
 *   decision has its mail and a rolled-back one has none. The caller names an
 *   idempotency key; a second enqueue of the same key (per workspace, or per
 *   deployment for account mail) adds nothing.
 * - {@link MailOutboxWorker} — the `mail_outbox` scheduler job. Claims due rows
 *   in batches (`FOR UPDATE SKIP LOCKED`, so two senders never hold one row),
 *   confirms its lease right before each send, hands the mail to the server's
 *   mailer through {@link deliver} and records how it went: `sent`,
 *   `unconfirmed`, a retry after an exponential backoff, or `failed` — after
 *   {@link MAIL_OUTBOX_MAX_ATTEMPTS} tries, or at once when the carrier says
 *   trying again is not allowed.
 *
 * One attempt here is one `mailer.send`: the carrier's own in-call retry still
 * rides out a blip inside it, and this queue rides out what that cannot — the
 * process going away, or the server being down for an hour.
 *
 * At least once, within the carrier's rules. A sender that dies after handing a
 * mail over and before recording it leaves the row to be taken again once its
 * lease runs out — the price of never losing one — but never past
 * {@link MAIL_OUTBOX_MAX_ATTEMPTS}, and a mail the carrier reports as
 * `unconfirmed` (handed over, acceptance never confirmed) is never sent again
 * (§D178), because a reset or an invitation carries a single-use token.
 *
 * The recipient is a column the carrier needs and nothing logs; every line
 * here carries the row id, the kind and the carrier's classification
 * ({@link mailFailureFields}), as `deliver`'s callers do.
 */
import { randomUUID } from 'node:crypto';
import type { Prisma, PrismaClient } from '@prisma/client';
import type { TenantClient } from '../../lib/tenant.js';
import { deliver, isCapRefusal, mailFailureFields, type MailOutcome } from './delivery.js';
import { isMailDeliveryError } from './mail-error.js';
import type { Mailer, Message } from './mailer.js';

/** How many times a row is handed to the carrier before it is `failed`. */
export const MAIL_OUTBOX_MAX_ATTEMPTS = 5;
/** Rows one claim takes. */
export const MAIL_OUTBOX_BATCH_SIZE = 20;
/** Rows one pass takes in all, so a backlog cannot hold the job's lock forever. */
export const MAIL_OUTBOX_MAX_PER_PASS = 200;
/**
 * How long a claim holds a row before another sender may take it, renewed right
 * before each send. Longer than one `mailer.send` can take: the SMTP carrier's
 * three tries, each bounded by `SMTP_TIMEOUT_MS` per reply.
 */
export const MAIL_OUTBOX_LEASE_SECONDS = 600;
/** How long a settled row stays (who, what kind, how it went) before the prune. */
export const MAIL_OUTBOX_KEEP_DAYS = 30;
const PRUNE_LIMIT = 1_000;

export const MAIL_OUTBOX_RETRY_BASE_MS = 60_000;
export const MAIL_OUTBOX_RETRY_CAP_MS = 3_600_000;

/**
 * Wait before the attempt after `attempt`: 1 min, 4 min, 16 min, 1 h — a
 * carrier down for about an hour and a half still gets every mail.
 */
export function mailOutboxBackoffMs(attempt: number): number {
  const uncapped = MAIL_OUTBOX_RETRY_BASE_MS * 4 ** Math.max(0, attempt - 1);
  return Math.min(uncapped, MAIL_OUTBOX_RETRY_CAP_MS);
}

/** What `payload` holds: the message minus the three things that are columns. */
export type MailOutboxPayload = Omit<Message, 'to' | 'licenseId' | 'kind'>;

const IDEMPOTENCY_KEY_MAX = 200;

export interface EnqueueMailOptions {
  /**
   * What makes this mail this mail — `invitation:<id>`, `password_reset:<token
   * id>`. Unique per workspace (per deployment for account mail): a second
   * enqueue with the same key adds nothing, so a retried request or a replayed
   * sweep cannot mail twice.
   */
  idempotencyKey: string;
}

export type EnqueuedMail = { enqueued: true; id: string } | { enqueued: false };

/**
 * Queue `message` in `tx` — the transaction that decided to send it.
 *
 * Workspace mail (`licenseId` set) is written only inside that workspace's
 * tenant context (RLS); account mail (`licenseId` null) from anywhere. No
 * `RETURNING`: the id is chosen here, and an account-mail row is one no tenant
 * may read back.
 */
export async function enqueueMail(
  tx: Pick<TenantClient, 'mailOutbox'>,
  message: Message,
  options: EnqueueMailOptions,
): Promise<EnqueuedMail> {
  const row = mailOutboxRow(message, options.idempotencyKey);
  const { count } = await tx.mailOutbox.createMany({ data: [row], skipDuplicates: true });
  return count === 1 ? { enqueued: true, id: row.id } : { enqueued: false };
}

/**
 * The row {@link enqueueMail} writes — named for a caller that has to issue
 * the INSERT itself (`OutboxMailer`, in a batch rather than an interactive
 * transaction, tm 464.2).
 */
export function mailOutboxRow(
  message: Message,
  idempotencyKey: string,
): Prisma.MailOutboxCreateManyInput & { id: string } {
  if (idempotencyKey.length < 1 || idempotencyKey.length > IDEMPOTENCY_KEY_MAX) {
    throw new RangeError(`enqueueMail: idempotencyKey must be 1 … ${IDEMPOTENCY_KEY_MAX} chars`);
  }
  const { to, licenseId, kind, ...payload } = message;
  return {
    id: randomUUID(),
    licenseId,
    kind,
    recipient: to,
    // Strings, string arrays and `{ filename, contentType, content }` all
    // the way down; JSON drops the `undefined` optionals. The interfaces
    // only lack the index signature Prisma's JSON type asks for.
    payload: payload as unknown as Prisma.InputJsonObject,
    idempotencyKey,
  };
}

/** A row as `mail_outbox_claim` hands it out. */
export interface MailOutboxClaim {
  id: string;
  licenseId: bigint | null;
  kind: string;
  recipient: string;
  payload: unknown;
  /** The attempt this claim is — and the claim's identity for renew/settle/release. */
  attempts: number;
  createdAt: Date;
}

interface ClaimRow {
  id: string;
  license_id: bigint | null;
  kind: string;
  recipient: string;
  payload: unknown;
  attempts: number;
  created_at: Date;
}

/** Take up to `limit` due rows. Outside any tenant context: account mail has none. */
export async function claimMailOutbox(
  db: PrismaClient,
  options: { limit: number; leaseSeconds: number; maxAttempts: number },
): Promise<MailOutboxClaim[]> {
  const rows = await db.$queryRaw<ClaimRow[]>`
    SELECT id::text AS id, license_id, kind, recipient, payload, attempts, created_at
      FROM mail_outbox_claim(${options.limit}::int, ${options.leaseSeconds}::int,
                             ${options.maxAttempts}::int)`;
  return rows
    .map((row) => ({
      id: row.id,
      licenseId: row.license_id,
      kind: row.kind,
      recipient: row.recipient,
      payload: row.payload,
      attempts: row.attempts,
      createdAt: row.created_at,
    }))
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));
}

/**
 * Take the one row `id` names, if it is due — the send straight after the
 * enqueue (tm 464.2). Null when it is not: another sender holds it, it has
 * settled, or it is backing off.
 */
export async function claimMailOutboxRow(
  db: PrismaClient,
  id: string,
  options: { leaseSeconds: number; maxAttempts: number },
): Promise<MailOutboxClaim | null> {
  const rows = await db.$queryRaw<ClaimRow[]>`
    SELECT id::text AS id, license_id, kind, recipient, payload, attempts, created_at
      FROM mail_outbox_claim_one(${id}::uuid, ${options.leaseSeconds}::int,
                                 ${options.maxAttempts}::int)`;
  const row = rows[0];
  return row
    ? {
        id: row.id,
        licenseId: row.license_id,
        kind: row.kind,
        recipient: row.recipient,
        payload: row.payload,
        attempts: row.attempts,
        createdAt: row.created_at,
      }
    : null;
}

/** How a claim ends, as `mail_outbox_settle` records it. */
export type MailOutboxSettlement =
  | { status: 'sent' }
  | { status: 'unconfirmed'; error: string }
  | { status: 'pending'; error: string; retryAfterMs: number }
  | { status: 'failed'; error: string };

export interface MailOutboxRetryPolicy {
  maxAttempts: number;
  backoffMs: (attempt: number) => number;
}

/**
 * What a send's outcome means for its row, after `attempt` tries.
 *
 * A carrier error decides by its own `retryable` (`mail-error.ts`): a 4xx, a
 * timeout or a dropped connection before hand-over may be tried again; a 5xx,
 * a refused login, a daily cap's refusal and `unconfirmed` may not. Anything
 * else never reached a carrier (`FileMailer`'s disk, the caps' database) and
 * is tried again.
 */
export function settlementFor(
  outcome: MailOutcome,
  attempt: number,
  policy: MailOutboxRetryPolicy,
): MailOutboxSettlement {
  if (outcome.status === 'sent') return { status: 'sent' };
  if (outcome.status === 'unconfirmed') return { status: 'unconfirmed', error: 'unconfirmed' };
  const { error } = outcome;
  const code = isMailDeliveryError(error) ? error.code : 'unexpected';
  const retryable = isMailDeliveryError(error) ? error.retryable : true;
  if (retryable && attempt < policy.maxAttempts) {
    return { status: 'pending', error: code, retryAfterMs: policy.backoffMs(attempt) };
  }
  return { status: 'failed', error: code };
}

/**
 * The message a claimed row describes, or null when its payload is not one.
 * The columns go last: a payload cannot name another recipient or workspace.
 */
export function messageFromClaim(claim: MailOutboxClaim): Message | null {
  const payload = claim.payload;
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return null;
  const fields = payload as Record<string, unknown>;
  if (typeof fields['subject'] !== 'string' || typeof fields['body'] !== 'string') return null;
  return {
    ...(fields as unknown as MailOutboxPayload),
    to: claim.recipient,
    licenseId: claim.licenseId,
    kind: claim.kind as Message['kind'],
  };
}

/** The log surface the sender needs — satisfied by Fastify's logger and by pino. */
export interface MailOutboxLogger {
  warn(details: Record<string, unknown>, message: string): void;
  error(details: Record<string, unknown>, message: string): void;
}

const SILENT: MailOutboxLogger = { warn: () => undefined, error: () => undefined };

/**
 * A row that has reached its end — `sent`, `unconfirmed` or `failed` — as the
 * sender recorded it (tm 464.2). Told to {@link MailOutboxWorkerOptions.onSettled}
 * whichever path sent it: the request's own send straight after its commit or
 * the scheduler's retry an hour later, so a caller that writes an outcome back
 * (a ticket reply's `delivery_status`) hears the last word, not the first try.
 */
export interface MailOutboxSettledEvent {
  outboxId: string;
  licenseId: bigint | null;
  kind: string;
  /** The message as it was sent; null when its payload was not one. */
  message: Message | null;
  status: 'sent' | 'unconfirmed' | 'failed';
  /** The carrier's outcome, when the carrier was reached. */
  outcome: MailOutcome | null;
}

/** How one claimed row went, for the caller that sent it now. */
export type MailOutboxSendResult =
  /** Another sender holds or has settled it — it is theirs to send. */
  | { status: 'taken' }
  /** This try failed and the row waits for a retry (the scheduler's job). */
  | { status: 'queued'; outcome: MailOutcome | null }
  | { status: 'sent' | 'unconfirmed' | 'failed'; outcome: MailOutcome | null };

export interface MailOutboxWorkerOptions {
  /** The server's mailer — the capped one, over the configured carrier. */
  mailer: Mailer;
  logger?: MailOutboxLogger;
  /**
   * Called once a row reaches its end and that end is recorded. Awaited; a
   * throw is logged and does not undo the settlement.
   */
  onSettled?: (event: MailOutboxSettledEvent) => Promise<void>;
  maxAttempts?: number;
  batchSize?: number;
  maxPerPass?: number;
  leaseSeconds?: number;
  backoffMs?: (attempt: number) => number;
  keepDays?: number;
}

/** One pass, as the scheduler logs it. */
export interface MailOutboxReport {
  claimed: number;
  sent: number;
  unconfirmed: number;
  retried: number;
  failed: number;
  /** Claimed rows another sender took before this one could send or record them. */
  lost: number;
  /** Claimed rows handed back untried because the pass was stopped. */
  released: number;
  pruned: number;
}

export class MailOutboxWorker {
  readonly #db: PrismaClient;
  readonly #mailer: Mailer;
  readonly #log: MailOutboxLogger;
  readonly #policy: MailOutboxRetryPolicy;
  readonly #batchSize: number;
  readonly #maxPerPass: number;
  readonly #leaseSeconds: number;
  readonly #keepDays: number;
  readonly #onSettled: MailOutboxWorkerOptions['onSettled'];

  constructor(db: PrismaClient, options: MailOutboxWorkerOptions) {
    this.#db = db;
    this.#mailer = options.mailer;
    this.#log = options.logger ?? SILENT;
    this.#onSettled = options.onSettled;
    this.#policy = {
      maxAttempts: options.maxAttempts ?? MAIL_OUTBOX_MAX_ATTEMPTS,
      backoffMs: options.backoffMs ?? mailOutboxBackoffMs,
    };
    this.#batchSize = options.batchSize ?? MAIL_OUTBOX_BATCH_SIZE;
    this.#maxPerPass = options.maxPerPass ?? MAIL_OUTBOX_MAX_PER_PASS;
    this.#leaseSeconds = options.leaseSeconds ?? MAIL_OUTBOX_LEASE_SECONDS;
    this.#keepDays = options.keepDays ?? MAIL_OUTBOX_KEEP_DAYS;
  }

  /**
   * Send what is due, a batch at a time, until a claim comes back short, the
   * pass has taken {@link MAIL_OUTBOX_MAX_PER_PASS} rows, or `signal` aborts —
   * then the batch's untried rows are handed back. Sends one at a time: the
   * carrier opens a connection per mail, and a burst of them is how a sender
   * meets a provider's rate limit.
   */
  async run({ signal }: { signal?: AbortSignal } = {}): Promise<MailOutboxReport> {
    const report: MailOutboxReport = {
      claimed: 0,
      sent: 0,
      unconfirmed: 0,
      retried: 0,
      failed: 0,
      lost: 0,
      released: 0,
      pruned: 0,
    };

    while (!signal?.aborted && report.claimed < this.#maxPerPass) {
      const limit = Math.min(this.#batchSize, this.#maxPerPass - report.claimed);
      const batch = await claimMailOutbox(this.#db, {
        limit,
        leaseSeconds: this.#leaseSeconds,
        maxAttempts: this.#policy.maxAttempts,
      });
      report.claimed += batch.length;
      for (const [index, claim] of batch.entries()) {
        if (signal?.aborted) {
          for (const untried of batch.slice(index)) {
            if (await this.#release(untried)) report.released += 1;
          }
          break;
        }
        await this.#sendOne(claim, report);
      }
      if (batch.length < limit) break;
    }

    if (!signal?.aborted) {
      const rows = await this.#db.$queryRaw<Array<{ pruned: number }>>`
        SELECT mail_outbox_prune(${this.#keepDays}::int, ${PRUNE_LIMIT}::int) AS pruned`;
      report.pruned = rows[0]?.pruned ?? 0;
    }
    return report;
  }

  /**
   * Send the one row `id` names now, if it is due (tm 464.2) — what a caller
   * does straight after committing its enqueue, so the mail leaves as fast as
   * it did before the outbox. A first try that fails retryably leaves the row
   * to the scheduler's job, exactly as a row of a pass would be.
   */
  async sendNow(id: string): Promise<MailOutboxSendResult> {
    const claim = await claimMailOutboxRow(this.#db, id, {
      leaseSeconds: this.#leaseSeconds,
      maxAttempts: this.#policy.maxAttempts,
    });
    if (!claim) return { status: 'taken' };
    const report: MailOutboxReport = {
      claimed: 1,
      sent: 0,
      unconfirmed: 0,
      retried: 0,
      failed: 0,
      lost: 0,
      released: 0,
      pruned: 0,
    };
    return this.#sendOne(claim, report);
  }

  async #sendOne(claim: MailOutboxClaim, report: MailOutboxReport): Promise<MailOutboxSendResult> {
    const fields = {
      event: 'mail.outbox',
      outbox_id: claim.id,
      kind: claim.kind,
      attempt: claim.attempts,
      ...(claim.licenseId === null ? {} : { license_id: claim.licenseId.toString() }),
    };

    // Still ours, and the lease starts over: whatever the carrier takes, no
    // other claim can take this row while it is being sent.
    const held = await this.#db.$queryRaw<Array<{ held: boolean }>>`
      SELECT mail_outbox_renew(${claim.id}::uuid, ${claim.attempts}::int,
                               ${this.#leaseSeconds}::int) AS held`;
    if (held[0]?.held !== true) {
      report.lost += 1;
      this.#log.warn(
        { ...fields, outcome: 'lease_lost' },
        'mail outbox row taken by another sender',
      );
      return { status: 'taken' };
    }

    const message = messageFromClaim(claim);
    const outcome: MailOutcome | null = message ? await deliver(this.#mailer, message) : null;
    const settlement: MailOutboxSettlement = outcome
      ? settlementFor(outcome, claim.attempts, this.#policy)
      : { status: 'failed', error: 'invalid_message' };
    // The carrier's classification (phase, reply code) — never the recipient.
    const carrier =
      outcome && outcome.status !== 'sent' ? { mail: mailFailureFields(outcome.error) } : {};

    const error = settlement.status === 'sent' ? null : settlement.error;
    const retryAfterSeconds =
      settlement.status === 'pending' ? Math.ceil(settlement.retryAfterMs / 1000) : 0;
    const settled = await this.#db.$queryRaw<Array<{ settled: boolean }>>`
      SELECT mail_outbox_settle(${claim.id}::uuid, ${claim.attempts}::int,
                                ${settlement.status}::text, ${error}::text,
                                ${retryAfterSeconds}::int) AS settled`;
    if (settled[0]?.settled !== true) {
      report.lost += 1;
      this.#log.warn(
        { ...fields, outcome: settlement.status, recorded: false },
        'mail outbox row taken by another sender before its outcome was recorded',
      );
      return { status: 'taken' };
    }

    if (settlement.status !== 'pending') {
      await this.#tellSettled({
        outboxId: claim.id,
        licenseId: claim.licenseId,
        kind: claim.kind,
        message,
        status: settlement.status,
        outcome,
      });
    }

    switch (settlement.status) {
      case 'sent':
        report.sent += 1;
        return { status: 'sent', outcome };
      case 'unconfirmed':
        report.unconfirmed += 1;
        this.#log.warn(
          { ...fields, outcome: 'unconfirmed', ...carrier },
          'mail handed over but not confirmed; not sent again',
        );
        return { status: 'unconfirmed', outcome };
      case 'pending':
        report.retried += 1;
        this.#log.warn(
          {
            ...fields,
            outcome: 'retry',
            code: settlement.error,
            retry_in_ms: settlement.retryAfterMs,
            ...carrier,
          },
          'mail not sent; will retry',
        );
        return { status: 'queued', outcome };
      case 'failed':
        report.failed += 1;
        // A daily cap's refusal was logged where it was decided (`mail-caps.ts`).
        if (!(outcome && isCapRefusal(outcome))) {
          this.#log.error(
            { ...fields, outcome: 'failed', code: settlement.error, ...carrier },
            'mail not sent; giving up',
          );
        }
        return { status: 'failed', outcome };
    }
  }

  async #tellSettled(event: MailOutboxSettledEvent): Promise<void> {
    if (!this.#onSettled) return;
    try {
      await this.#onSettled(event);
    } catch (error) {
      this.#log.error(
        {
          event: 'mail.outbox',
          outbox_id: event.outboxId,
          kind: event.kind,
          outcome: 'settled_hook_failed',
          ...mailFailureFields(error),
        },
        'mail outbox settlement not passed on',
      );
    }
  }

  async #release(claim: MailOutboxClaim): Promise<boolean> {
    const rows = await this.#db.$queryRaw<Array<{ released: boolean }>>`
      SELECT mail_outbox_release(${claim.id}::uuid, ${claim.attempts}::int) AS released`;
    return rows[0]?.released === true;
  }
}
