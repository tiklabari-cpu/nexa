/**
 * The daily outgoing-mail caps (tm 257.14 · ADR
 * `docs/adr/pilot-public-readiness.md` K-e(4)): how much mail a workspace, and
 * the deployment as a whole, may hand the carrier in one UTC day.
 *
 * Sign-up is public in the pilot. Every invitation, ticket notice and
 * visitor transcript leaves from the deployment's own sender carrying text a
 * tenant or a visitor wrote, and before this nothing counted it: a stranger
 * could open a workspace and spend the sender's reputation — and the mail
 * account itself, which a provider suspends past its daily limit, taking
 * every password reset with it. Four counts bound that:
 *
 * - **per workspace** (`MAIL_DAILY_PER_WORKSPACE`) — everything it sends;
 * - **external per workspace** (`MAIL_DAILY_EXTERNAL_PER_WORKSPACE`) — the
 *   part leaving it ({@link EXTERNAL_KINDS}), the part a stranger would use;
 * - **global** (`MAIL_DAILY_GLOBAL`) — the deployment, under the provider's
 *   own limit; workspace mail stops `MAIL_SECURITY_RESERVE` short of it, so
 *   the top of the day is kept for account mail and a day of invitations
 *   cannot lock anybody out of a password reset;
 * - **per recipient** ({@link SECURITY_MAIL_PER_RECIPIENT}) — the account mail
 *   an anonymous caller can trigger ({@link RECIPIENT_CAPPED_KINDS}), so the
 *   reset form cannot be pointed at one address all day.
 *
 * **One wrapper, around every mailer.** {@link CappedMailer} wraps whatever
 * `createMailer` built — in the server and in the three command-line jobs —
 * so a send site cannot miss it: the two-factor notice, which calls
 * `mailer.send` without `deliver`, is counted like the rest. It counts what is
 * handed to the carrier, not what a caller did: an invitation POSTed again to
 * a live address mails again and counts again, without spending a seat.
 *
 * **Counted in Postgres, for every provider.** Redis buckets here fail open
 * (`plugins/rate-limit.ts`), and a cap that opens when Redis is away is not
 * one; a database that is away fails the send instead. The check and the
 * increment are one statement per row in `mail_budget_spend` (migration
 * `20261003150000_mail_daily_usage`). `file` and `null` mail is counted too,
 * so the suites drive the counter production uses.
 *
 * **A refusal is a failed send.** {@link MailCapError} (`code: 'cap_reached'`)
 * is thrown before the carrier is asked, so every caller meets it where it
 * already meets a carrier failure — `deliver` reports `failed` — and decides
 * there: an invitation lists it as undelivered, a scheduled report keeps its
 * period for the next sweep, the SSO challenge answers 429, the rest drop it.
 * Each refusal writes exactly one warning line, here, where it is decided —
 * `{ event: 'mail.cap_reached', kind, license_id, scope }`, never the
 * recipient — and callers do not log it again (`isCapRefusal`).
 *
 * A mail the carrier refused for good is given back (`mail_budget_refund`), so
 * a morning of carrier outage does not spend the day; one whose acceptance was
 * never confirmed (`unconfirmed`) may have arrived and stays counted.
 */
import { createHash } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import type { Env } from '../../config/env.js';
import { utcDayKey } from '../ai/ai-daily-budget.js';
import { createMailer, type Mailer, type Message } from './mailer.js';
import { MailCapError, isMailDeliveryError, type MailCapScope } from './mail-error.js';
import { defaultMailLogger } from './smtp-mailer.js';

/**
 * Account mail an anonymous caller can cause, and therefore point at an
 * address it does not own: the reset form, sign-up and its resend. Counted per
 * address per day, the address hashed so the table is not a list of them. The
 * two-factor notice is account mail too, but only the signed-in holder can
 * cause it.
 */
export const RECIPIENT_CAPPED_KINDS: ReadonlySet<Message['kind']> = new Set([
  'password_reset',
  'email_verification',
  'account_exists_notice',
]);

/**
 * Those mails per address per day, all three kinds together — one count, so a
 * caller cannot reach fifteen by taking turns. A sign-up's link plus a few
 * resends and a reset fit; a form pointed at someone's address all day does
 * not.
 */
export const SECURITY_MAIL_PER_RECIPIENT = 5;

/**
 * Workspace mail that leaves the workspace: the invitation (to somebody who is
 * not a member yet), the ticket notice and the visitor's transcript (to an
 * address a customer or a visitor typed). Assignee notices, the team's
 * transcript copy, scheduled reports and SLA digests go to the workspace's own
 * people.
 */
export const EXTERNAL_KINDS: ReadonlySet<Message['kind']> = new Set([
  'invitation',
  'ticket_notice',
  'chat_transcript',
]);

export interface MailDailyCaps {
  workspace: number;
  external: number;
  global: number;
  reserve: number;
  recipient: number;
}

/** The four `MAIL_*` settings, plus the fixed per-recipient count. */
export function mailDailyCaps(
  env: Pick<
    Env,
    | 'MAIL_DAILY_PER_WORKSPACE'
    | 'MAIL_DAILY_EXTERNAL_PER_WORKSPACE'
    | 'MAIL_DAILY_GLOBAL'
    | 'MAIL_SECURITY_RESERVE'
  >,
): MailDailyCaps {
  return {
    workspace: env.MAIL_DAILY_PER_WORKSPACE,
    external: env.MAIL_DAILY_EXTERNAL_PER_WORKSPACE,
    global: env.MAIL_DAILY_GLOBAL,
    reserve: env.MAIL_SECURITY_RESERVE,
    recipient: SECURITY_MAIL_PER_RECIPIENT,
  };
}

/** SHA-256 of the address as a mailbox compares it — trimmed, lower-cased. */
export function recipientHash(address: string): string {
  return createHash('sha256').update(address.trim().toLowerCase()).digest('hex');
}

/** Which rows a message counts on, on which day. */
interface Charge {
  licenseId: bigint | null;
  day: string;
  external: boolean;
  recipient: string | null;
}

function chargeFor(message: Message, at: Date): Charge {
  const workspace = message.licenseId !== null;
  return {
    licenseId: message.licenseId,
    day: utcDayKey(at),
    external: workspace && EXTERNAL_KINDS.has(message.kind),
    recipient:
      !workspace && RECIPIENT_CAPPED_KINDS.has(message.kind) ? recipientHash(message.to) : null,
  };
}

export interface MailCapLogger {
  warn(details: Record<string, unknown>, message: string): void;
  error(details: Record<string, unknown>, message: string): void;
}

export interface CappedMailerOptions {
  logger: MailCapLogger;
  /** The clock the day is read from. */
  now?: () => Date;
}

/**
 * `carrier`, behind the daily caps: each message is counted before it is
 * handed over, or refused with {@link MailCapError} and never handed over.
 */
export class CappedMailer implements Mailer {
  readonly #carrier: Mailer;
  readonly #db: PrismaClient;
  readonly #caps: MailDailyCaps;
  readonly #log: MailCapLogger;
  readonly #now: () => Date;

  constructor(
    carrier: Mailer,
    db: PrismaClient,
    caps: MailDailyCaps,
    options: CappedMailerOptions,
  ) {
    this.#carrier = carrier;
    this.#db = db;
    this.#caps = caps;
    this.#log = options.logger;
    this.#now = options.now ?? (() => new Date());
  }

  async send(message: Message): Promise<void> {
    const charge = chargeFor(message, this.#now());
    const caps = this.#caps;
    const rows = await this.#db.$queryRaw<Array<{ scope: MailCapScope | null }>>`
      SELECT mail_budget_spend(${charge.licenseId}::bigint, ${charge.day}::text,
        ${charge.external}::boolean, ${charge.recipient}::text,
        ${caps.workspace}::int, ${caps.external}::int, ${caps.global}::int,
        ${caps.reserve}::int, ${caps.recipient}::int) AS scope`;
    const scope = rows[0]?.scope ?? null;
    if (scope) {
      this.#log.warn(
        {
          event: 'mail.cap_reached',
          kind: message.kind,
          license_id: message.licenseId === null ? null : message.licenseId.toString(),
          scope,
        },
        'daily mail cap reached; the message was not sent',
      );
      throw new MailCapError(scope);
    }

    try {
      await this.#carrier.send(message);
    } catch (error) {
      // Given back unless it may have arrived: `unconfirmed` was handed over
      // and never confirmed, and counting it errs toward the cap.
      if (!(isMailDeliveryError(error) && error.code === 'unconfirmed')) {
        await this.#refund(charge, message);
      }
      throw error;
    }
  }

  /**
   * Never throws: the send's own failure is what the caller must see. A refund
   * that did not land leaves the mail counted, which errs toward the cap.
   */
  async #refund(charge: Charge, message: Message): Promise<void> {
    try {
      await this.#db.$executeRaw`
        SELECT mail_budget_refund(${charge.licenseId}::bigint, ${charge.day}::text,
          ${charge.external}::boolean, ${charge.recipient}::text)`;
    } catch (error) {
      this.#log.error(
        {
          err: error,
          event: 'mail.budget_refund_failed',
          kind: message.kind,
          license_id: message.licenseId === null ? null : message.licenseId.toString(),
        },
        'daily mail cap could not be refunded; the failed mail stays counted',
      );
    }
  }
}

/**
 * The mailer a command-line job sends with (`sla:run`, `chat-timeout:run`,
 * `scheduled-reports:run`): whatever `MAIL_PROVIDER` names, behind the same
 * caps and the same counter as the server's, logging to stderr because the
 * jobs print their report on stdout.
 */
export function createJobMailer(
  env: Pick<
    Env,
    | 'MAIL_PROVIDER'
    | 'mail'
    | 'MAIL_DAILY_PER_WORKSPACE'
    | 'MAIL_DAILY_EXTERNAL_PER_WORKSPACE'
    | 'MAIL_DAILY_GLOBAL'
    | 'MAIL_SECURITY_RESERVE'
  >,
  db: PrismaClient,
): CappedMailer {
  const logger = defaultMailLogger();
  return new CappedMailer(
    createMailer(env.MAIL_PROVIDER, { ...env.mail, logger }),
    db,
    mailDailyCaps(env),
    {
      logger,
    },
  );
}
