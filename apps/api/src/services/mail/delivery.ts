/**
 * What a caller does with a mail that did not go out (tm 255.4).
 *
 * Until the SMTP carrier existed no caller had ever met a delivery error —
 * `FileMailer` writes a file and `NullMailer` does nothing — so nine call sites
 * had grown three habits: a bare `await` (a mail failure became the request's
 * 500), a `try/catch` that logged, and one that swallowed. With a real carrier
 * the bare `await` stopped being harmless in two places the product cannot
 * afford it:
 *
 * - `POST /auth/password-reset` only mails when the address has an account, so
 *   a 500 on that branch alone answered the question the neutral 202 exists to
 *   refuse (FR-MOD-00.3). Waiting for the carrier at all did the same thing more
 *   quietly: a real SMTP round trip is hundreds of milliseconds that the
 *   unknown-address branch never spends.
 * - `POST /invitations` mails after the invitations have committed, so a 500
 *   told an admin that invitations which exist, with working links, had failed.
 *
 * This module is the one vocabulary for both, and for the sweeps. It turns a
 * send into an outcome instead of an exception, because every caller that
 * cares has to tell three cases apart and the third is the one a `catch`
 * blurs:
 *
 * - `sent` — the carrier has it.
 * - `unconfirmed` — the message was handed over and its acceptance never
 *   confirmed (`PermanentMailError` with code `unconfirmed`, §D178). It may
 *   well have arrived. A caller must neither say "not sent" as if that were
 *   known nor send it again: both invitations and resets carry a single-use
 *   token, and a second copy is a second live link.
 * - `failed` — it did not go out: the carrier's retries ran out, the server
 *   refused it, or the mailer itself broke.
 *
 * And it keeps the address out of the log. {@link mailFailureFields} is what a
 * caller may write next to a failure: the carrier's classification and nothing
 * the recipient typed. On the reset path that is the whole point — a line
 * saying "reset mail to x@y failed" tells anybody who can read the log that x@y
 * has an account.
 */
import { maskPii } from '../../lib/log-redact.js';
import type { Mailer, Message } from './mailer.js';
import { isMailDeliveryError, type MailDeliveryError } from './mail-error.js';

export type MailOutcome =
  | { status: 'sent' }
  | { status: 'unconfirmed'; error: MailDeliveryError }
  | { status: 'failed'; error: unknown };

/** Send, and report how it went. Never throws — the caller decides what a failure means. */
export async function deliver(mailer: Mailer, message: Message): Promise<MailOutcome> {
  try {
    await mailer.send(message);
    return { status: 'sent' };
  } catch (error) {
    if (isMailDeliveryError(error) && error.code === 'unconfirmed') {
      return { status: 'unconfirmed', error };
    }
    return { status: 'failed', error };
  }
}

/**
 * A failure as it may be logged: the carrier's classification, never the
 * recipient.
 *
 * A carrier error already carries nothing personal — its message is built from
 * the code, the phase and the reply code, and `detail` was scrubbed by the
 * carrier before it was stored — so its fields go through as they are. Anything
 * else is an error nobody classified (a full disk under `FileMailer`, a bug),
 * whose message is free text; it is kept, because it is the only clue, but
 * masked the way every other free-text log field is.
 */
export function mailFailureFields(error: unknown): Record<string, unknown> {
  if (isMailDeliveryError(error)) {
    return {
      code: error.code,
      phase: error.phase,
      retryable: error.retryable,
      attempts: error.attempts,
      ...(error.smtpCode ? { smtpCode: error.smtpCode } : {}),
      ...(error.enhancedCode ? { enhancedCode: error.enhancedCode } : {}),
      ...(error.detail ? { reply: error.detail } : {}),
    };
  }
  const name = error instanceof Error ? error.name : typeof error;
  const message = error instanceof Error ? maskPii(error.message) : undefined;
  return { code: 'unexpected', name, ...(message ? { message } : {}) };
}

/** The log surface an outcome is written to — satisfied by Fastify's logger and by pino. */
export interface MailOutcomeLogger {
  warn(details: Record<string, unknown>, message: string): void;
}

/**
 * Log a mail that did not go out as `sent`; stay silent when it did (tm 256.4).
 *
 * The line carries `event` (which mail this was), the outcome and
 * {@link mailFailureFields} — never the recipient, and never the message:
 * a transcript or a ticket notice is the customer's text. `fields` is for what
 * the caller can name safely, such as a chat or ticket id.
 */
export function logUnsentMail(
  log: MailOutcomeLogger,
  event: string,
  outcome: MailOutcome,
  fields: Record<string, unknown> = {},
): void {
  if (outcome.status === 'sent') return;
  log.warn(
    { event, outcome: outcome.status, mail: mailFailureFields(outcome.error), ...fields },
    'mail not confirmed as sent',
  );
}

/**
 * Mail a request does not wait for.
 *
 * For a response that must not depend on how the mail went — the password
 * reset (tm 255.4), and since tm 256.4 the three courtesy mails a request used
 * to sit through: the assignee's new-message notice, the end-of-chat
 * transcript and a ticket's customer notice. {@link BackgroundMail.send}
 * returns at once and starts the send on a later turn of the event loop, after
 * the caller's response has been handed to the socket, so neither the
 * carrier's latency nor its failure can reach the answer. The outcome is given
 * to a callback, which logs it.
 *
 * Not a queue. Nothing is persisted, so a process that dies mid-send loses the
 * message — which for a reset is the same outcome as a lost email, and the
 * person asks again; for the courtesy mails the thing they describe (the
 * message, the closed chat, the ticket's new status) is already committed and
 * on screen. What is tracked is the in-flight set, so a graceful
 * shutdown waits for it ({@link BackgroundMail.settled}, wired to `onClose`)
 * rather than cutting a send off halfway, and a test can wait for "the mail
 * that request started" without polling a mailbox.
 */
export class BackgroundMail {
  readonly #mailer: Mailer;
  readonly #pending = new Set<Promise<void>>();

  constructor(mailer: Mailer) {
    this.#mailer = mailer;
  }

  send(message: Message, onSettled: (outcome: MailOutcome) => void): void {
    const job: Promise<void> = new Promise<void>((resolve) => setImmediate(resolve))
      .then(() => deliver(this.#mailer, message))
      .then(onSettled)
      // `deliver` cannot reject; only the callback can. A logging failure must
      // not become an unhandled rejection that takes the process down.
      .catch(() => undefined)
      .finally(() => this.#pending.delete(job));
    this.#pending.add(job);
  }

  /**
   * This as a {@link Mailer}, for a service that takes one and is called
   * from a request (tm 256.4 — `ChatService`'s close transcript, whose other
   * callers are sweeps that may wait).
   *
   * `send` resolves once the message is handed over, so to the service every
   * send succeeds: it cannot tell a failure, and it must not try to act on one.
   * What actually happened goes to `onSettled`, with the message it was about.
   */
  asMailer(onSettled: (message: Message, outcome: MailOutcome) => void): Mailer {
    return {
      send: async (message) => {
        this.send(message, (outcome) => onSettled(message, outcome));
      },
    };
  }

  /** Resolves once every send started so far — and any it started in turn — has finished. */
  async settled(): Promise<void> {
    while (this.#pending.size > 0) {
      await Promise.all([...this.#pending]);
    }
  }
}
