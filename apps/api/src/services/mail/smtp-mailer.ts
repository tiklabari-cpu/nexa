/**
 * `MAIL_PROVIDER=smtp` — the mailer that actually sends (tm 255.3 · pilot:
 * PrivateEmail, ADR docs/adr/pilot-llm-embedding-provider.md §9.3).
 *
 * `Mailer.send()` and its nine callers are unchanged: this is a different
 * carrier behind the same verb. What it adds is the one thing `FileMailer`
 * never had to have — a failure — and a policy for it:
 *
 * - **Transient** ({@link TransientMailError}: 4xx, a timeout or a dropped
 *   connection before the message was handed over) is retried, with the
 *   webhook burst's curve (`webhook-dispatcher.ts`): exponential from one
 *   second, capped, {@link SMTP_MAX_ATTEMPTS} attempts in all. The message is
 *   composed once, so every attempt carries the same `Message-ID`.
 * - **Permanent** ({@link PermanentMailError}: 5xx, a refused login, a
 *   certificate that does not verify, and `unconfirmed`) is never retried —
 *   not once. `smtp-session.ts` explains why a message whose acceptance was
 *   never confirmed belongs here: once the server has it, a second attempt is
 *   a second email carrying the same single-use token.
 *
 * What reaches the caller after that is a classified error; what the caller
 * then does — tell the user, keep the invitation — is tm 255.4's.
 *
 * ## The log
 *
 * Connection and delivery events go to pino with the host, port, attempt,
 * phase and reply codes. The recipient, the subject and the body never do —
 * not in a field, and not inside a server reply either: reply text is kept
 * only after {@link SmtpMailer}'s scrubber has replaced the recipient, the
 * credentials (plain and base64, the forms they cross the wire in) and
 * anything address-shaped. {@link SMTP_SECRET_LOG_PATHS} covers the other way
 * a credential could reach a line — somebody logging the configuration — for
 * the server's logger and for the default one here alike.
 */
import { randomUUID } from 'node:crypto';
import pino from 'pino';
import { maskPii } from '../../lib/log-redact.js';
import { composeMessage } from './mime.js';
import type { Mailer, Message } from './mailer.js';
import { PermanentMailError, isMailDeliveryError, type MailDeliveryError } from './mail-error.js';
import { deliverOnce, type SmtpConfig } from './smtp-session.js';

export type { SmtpConfig } from './smtp-session.js';

/** `SMTP_TIMEOUT_MS` when unset: per connection and per reply. */
export const SMTP_DEFAULT_TIMEOUT_MS = 10_000;

/**
 * Attempts per message, first included. Three, like the webhook burst: this
 * runs inside the request that asked for the email, so what it can ride out is
 * a blip, and holding the request open longer only delays the answer to a
 * server that is plainly down.
 */
export const SMTP_MAX_ATTEMPTS = 3;
export const SMTP_RETRY_BACKOFF_BASE_MS = 1_000;
export const SMTP_RETRY_BACKOFF_CAP_MS = 8_000;

/** Wait before the attempt after `attempt`: 1 s, 2 s, 4 s, 8 s, 8 s … */
export function smtpRetryBackoffMs(attempt: number): number {
  const uncapped = SMTP_RETRY_BACKOFF_BASE_MS * 2 ** Math.max(0, attempt - 1);
  return Math.min(uncapped, SMTP_RETRY_BACKOFF_CAP_MS);
}

/**
 * Where an SMTP credential would sit if anyone logged the configuration: the
 * env keys, the carrier's `smtp.{username,password}`, and `env.mail.smtp` —
 * each at the top of a log object and one level down (`{ env }`, `{ config }`),
 * since pino paths do not recurse. Spread into the server's pino
 * `redact.paths` and used by {@link defaultMailLogger}.
 */
export const SMTP_SECRET_LOG_PATHS = [
  'SMTP_USERNAME',
  'SMTP_PASSWORD',
  '*.SMTP_USERNAME',
  '*.SMTP_PASSWORD',
  'smtp.username',
  'smtp.password',
  '*.smtp.username',
  '*.smtp.password',
  'mail.smtp.username',
  'mail.smtp.password',
  '*.mail.smtp.username',
  '*.mail.smtp.password',
];

/** The narrow log surface the carrier needs — satisfied by Fastify's logger and by pino. */
export interface MailLogger {
  debug(details: Record<string, unknown>, message: string): void;
  info(details: Record<string, unknown>, message: string): void;
  warn(details: Record<string, unknown>, message: string): void;
  error(details: Record<string, unknown>, message: string): void;
}

/**
 * For the processes with no Fastify logger to hand in — the `*:run` scripts.
 * Stderr, because those scripts print their JSON report on stdout.
 */
export function defaultMailLogger(): MailLogger {
  return pino(
    {
      base: { component: 'mailer' },
      redact: { paths: SMTP_SECRET_LOG_PATHS, censor: '[redacted]' },
    },
    pino.destination(2),
  );
}

export interface SmtpMailerOptions {
  logger?: MailLogger | undefined;
  /** Attempts per message; {@link SMTP_MAX_ATTEMPTS} by default. */
  maxAttempts?: number;
  /** Injectable so tests do not actually wait. */
  sleep?: (ms: number) => Promise<void>;
  backoffMs?: (attempt: number) => number;
  now?: () => Date;
  /**
   * Extra trust anchors for the server's certificate — the tests hand in their
   * own CA. There is deliberately no option that relaxes verification.
   */
  ca?: string;
}

/** An addr-spec this carrier can put on the wire: ASCII, one `@`, nothing that ends a command or a header. */
const ADDRESS = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?$/;

export function isSendableAddress(address: string): boolean {
  return address.length <= 254 && ADDRESS.test(address);
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const REPLY_DETAIL_LIMIT = 200;

export class SmtpMailer implements Mailer {
  readonly #config: SmtpConfig;
  readonly #log: MailLogger;
  readonly #maxAttempts: number;
  readonly #sleep: (ms: number) => Promise<void>;
  readonly #backoffMs: (attempt: number) => number;
  readonly #now: () => Date;
  readonly #ca: string | undefined;
  readonly #domain: string;

  constructor(config: SmtpConfig, options: SmtpMailerOptions = {}) {
    // A sender that is not an address fails at boot, where an operator reads
    // it, rather than as a 5xx on the first password reset.
    if (!isSendableAddress(config.from)) {
      throw new Error('SMTP_FROM must be a bare email address (name@domain).');
    }
    this.#config = config;
    this.#log = options.logger ?? defaultMailLogger();
    this.#maxAttempts = Math.max(1, options.maxAttempts ?? SMTP_MAX_ATTEMPTS);
    this.#sleep = options.sleep ?? defaultSleep;
    this.#backoffMs = options.backoffMs ?? smtpRetryBackoffMs;
    this.#now = options.now ?? (() => new Date());
    this.#ca = options.ca;
    this.#domain = config.from.slice(config.from.lastIndexOf('@') + 1);
  }

  async send(message: Message): Promise<void> {
    const { host, port, secure } = this.#config;
    const where = { host, port, secure, kind: message.kind };

    if (!isSendableAddress(message.to)) {
      // Nothing is contacted: no server can deliver to this, now or later.
      const error = new PermanentMailError({ code: 'invalid_message', phase: 'compose' });
      this.#log.error(
        { ...where, event: 'smtp.failed', ...fieldsOf(error) },
        'smtp message not sent',
      );
      throw error;
    }

    const messageId = `${randomUUID()}@${this.#domain}`;
    const data = composeMessage({
      from: this.#config.from,
      to: message.to,
      subject: message.subject,
      body: message.body,
      date: this.#now(),
      messageId,
    });
    const scrub = this.#scrubber(message.to);

    for (let attempt = 1; ; attempt += 1) {
      const started = Date.now();
      this.#log.debug({ ...where, event: 'smtp.attempt', attempt }, 'smtp connecting');
      try {
        const receipt = await deliverOnce(
          { config: this.#config, clientName: this.#domain, ca: this.#ca, scrub },
          { from: this.#config.from, to: message.to },
          data,
        );
        this.#log.info(
          {
            ...where,
            event: 'smtp.accepted',
            attempt,
            messageId,
            tls: receipt.tlsProtocol,
            auth: receipt.authMechanism,
            durationMs: Date.now() - started,
          },
          'smtp message accepted',
        );
        return;
      } catch (caught) {
        const error: MailDeliveryError = isMailDeliveryError(caught)
          ? caught
          : new PermanentMailError({ code: 'protocol', phase: 'message' });
        error.attempts = attempt;
        const fields = { ...where, attempt, messageId, ...fieldsOf(error) };
        if (error.retryable && attempt < this.#maxAttempts) {
          const delayMs = this.#backoffMs(attempt);
          this.#log.warn(
            { ...fields, event: 'smtp.retry', delayMs },
            'smtp attempt failed, retrying',
          );
          await this.#sleep(delayMs);
          continue;
        }
        this.#log.error({ ...fields, event: 'smtp.failed' }, 'smtp message not sent');
        throw error;
      }
    }
  }

  /**
   * Server text as it may be kept: the recipient (any case), the credentials in
   * every form this carrier sends them, then any other address, then a length
   * cap. Order matters — the exact values go first, so a credential that does
   * not look like an address is still removed.
   */
  #scrubber(recipient: string): (text: string) => string {
    const { username, password } = this.#config;
    const secrets = [
      password,
      username,
      Buffer.from(password, 'utf8').toString('base64'),
      Buffer.from(username, 'utf8').toString('base64'),
      Buffer.from(`\0${username}\0${password}`, 'utf8').toString('base64'),
    ].filter((value) => value.length > 0);
    const recipientPattern = new RegExp(escapeRegExp(recipient), 'gi');
    return (text) => {
      let scrubbed = text.replace(recipientPattern, '[redacted]');
      for (const secret of secrets) scrubbed = scrubbed.split(secret).join('[redacted]');
      scrubbed = maskPii(scrubbed);
      return scrubbed.length > REPLY_DETAIL_LIMIT
        ? `${scrubbed.slice(0, REPLY_DETAIL_LIMIT)}…`
        : scrubbed;
    };
  }
}

function fieldsOf(error: MailDeliveryError): Record<string, unknown> {
  return {
    code: error.code,
    phase: error.phase,
    retryable: error.retryable,
    ...(error.smtpCode ? { smtpCode: error.smtpCode } : {}),
    ...(error.enhancedCode ? { enhancedCode: error.enhancedCode } : {}),
    ...(error.detail ? { reply: error.detail } : {}),
  };
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
