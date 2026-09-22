/**
 * Why a message did not go out — and whether trying again is allowed (tm 255.3).
 *
 * `FileMailer` never fails in practice, so until the SMTP carrier existed no
 * caller had ever met a delivery error. This module fixes the vocabulary before
 * one does: tm 255.4 decides what an invitation or a password reset does when
 * mail fails, and it decides by *type*, so the type has to say the one thing
 * that matters for that decision.
 *
 * That thing is retry, not blame. Two classes, one question each:
 *
 * - {@link TransientMailError} — the message was **not** accepted and sending
 *   it again may work: an SMTP 4xx, a timeout or dropped connection before the
 *   message was handed over. The carrier has already retried it; what reaches
 *   the caller means those retries ran out.
 * - {@link PermanentMailError} — sending it again must not happen: an SMTP 5xx,
 *   a rejected login (535), a server whose certificate does not verify, a
 *   message that cannot be expressed on the wire — and `unconfirmed`, below.
 *
 * `unconfirmed` is why "permanent" is defined by retry rather than by outcome.
 * Once the message's terminating `.` has been written, the server may have
 * accepted it even if its `250` never arrives. Sending it again from there is
 * how an invitation or a password reset — both of which carry a single-use
 * token — arrives twice, so the carrier treats that window as final: at most
 * once, never at least once (§D178).
 *
 * Nothing on these errors can carry a secret or a person. The message is built
 * from the code, the phase and the reply code; the server's reply text is kept
 * separately in {@link MailDeliveryError.detail}, and only after the carrier has
 * scrubbed the recipient, the credentials and anything address-shaped out of it.
 */

/** What went wrong, as a stable machine-readable word (logged, and read by 255.4). */
export type MailErrorCode =
  /** A connect, greeting or command reply did not arrive within `SMTP_TIMEOUT_MS`. */
  | 'timeout'
  /** The connection could not be opened, or dropped before the message was handed over. */
  | 'connection'
  /** The server's certificate did not verify, or it would not upgrade to TLS. */
  | 'tls'
  /**
   * AUTH failed: refused credentials (535 and the rest of AUTH's 5xx, permanent),
   * a temporary failure (454, transient), or no mechanism this carrier speaks.
   */
  | 'auth'
  /** An SMTP reply refused a step: 4xx on a transient error, 5xx on a permanent one. */
  | 'rejected'
  /** The server said something SMTP does not allow at that point. */
  | 'protocol'
  /** The message was handed over but its acceptance was never confirmed — see the module note. */
  | 'unconfirmed'
  /** The message itself cannot be sent (an address that is not one). Nothing was contacted. */
  | 'invalid_message';

/** The SMTP step a failure happened in. */
export type MailPhase =
  | 'compose'
  | 'connect'
  | 'greeting'
  | 'ehlo'
  | 'starttls'
  | 'auth'
  | 'mail_from'
  | 'rcpt_to'
  | 'data'
  | 'message';

export interface MailErrorDetails {
  code: MailErrorCode;
  phase: MailPhase;
  /** The three-digit SMTP reply code, when a reply caused this. */
  smtpCode?: number;
  /** The RFC 3463 enhanced status code (`5.7.8`), when the reply carried one. */
  enhancedCode?: string;
  /** The server's reply text, already scrubbed of the recipient, credentials and addresses. */
  detail?: string;
}

export abstract class MailDeliveryError extends Error {
  /** Whether sending the same message again is allowed. The only thing 255.4 branches on. */
  abstract readonly retryable: boolean;
  readonly code: MailErrorCode;
  readonly phase: MailPhase;
  readonly smtpCode: number | undefined;
  readonly enhancedCode: string | undefined;
  readonly detail: string | undefined;
  /**
   * How many times the carrier tried before giving this up. Set by the retry
   * loop; `1` for anything it would not retry.
   */
  attempts = 1;

  constructor(details: MailErrorDetails) {
    const reply = details.smtpCode
      ? ` (${details.smtpCode}${details.enhancedCode ? ` ${details.enhancedCode}` : ''})`
      : '';
    super(`mail ${details.code} during ${details.phase}${reply}`);
    this.name = new.target.name;
    this.code = details.code;
    this.phase = details.phase;
    this.smtpCode = details.smtpCode;
    this.enhancedCode = details.enhancedCode;
    this.detail = details.detail;
  }
}

/** Not accepted; another attempt may succeed. What the caller sees once the carrier's own retries ran out. */
export class TransientMailError extends MailDeliveryError {
  readonly retryable = true;
}

/** Must not be sent again — refused for good, or possibly already delivered (`unconfirmed`). */
export class PermanentMailError extends MailDeliveryError {
  readonly retryable = false;
}

export function isMailDeliveryError(error: unknown): error is MailDeliveryError {
  return error instanceof MailDeliveryError;
}
