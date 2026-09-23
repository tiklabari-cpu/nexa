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

/**
 * Mail a request does not wait for.
 *
 * For a response that must not depend on how the mail went — today only the
 * password reset. {@link BackgroundMail.send} returns at once and starts the
 * send on a later turn of the event loop, after the caller's response has been
 * handed to the socket, so neither the carrier's latency nor its failure can
 * reach the answer. The outcome is given to a callback, which logs it.
 *
 * Not a queue. Nothing is persisted, so a process that dies mid-send loses the
 * message — which for a reset is the same outcome as a lost email, and the
 * person asks again. What is tracked is the in-flight set, so a graceful
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

  /** Resolves once every send started so far — and any it started in turn — has finished. */
  async settled(): Promise<void> {
    while (this.#pending.size > 0) {
      await Promise.all([...this.#pending]);
    }
  }
}
