/**
 * The automatic "we received your request" reply (tm 359 · HD-04).
 *
 * A ticket rule can name a ticket e-mail template (`send_template_id`); the
 * engine (`applyTicketRules`) only *picks* it, inside the creation transaction,
 * because a mail must not leave from a transaction that can still roll back.
 * This is the rest, in two steps the caller brackets around its commit:
 *
 *  1. {@link TicketAutoAck.prepare}, still inside the transaction and after the
 *     ticket has its first message: render the template, decide whether it may
 *     go, write the ticket's system line saying so, and hand back the message.
 *  2. {@link deliverAutoAck}, after the commit: hand the message to
 *     `app.backgroundMail`.
 *
 * What it never does, because each is how an acknowledgement turns into spam:
 *
 *  - **Answer a machine.** The caller does not ask for an acknowledgement for an
 *    automatic reply (`isAutomatedMail`), and the message leaves with
 *    `Auto-Submitted: auto-replied` so the player's own auto-responder, and the
 *    next system's, stay quiet too.
 *  - **Answer a forged sender.** A mail whose SPF or DMARC the provider reports
 *    as failed opens its ticket and gets no reply ({@link senderFailedChecks}).
 *  - **Send twice.** One per ticket, the first matching rule's; and the line it
 *    writes carries the mail's own Message-ID, so the player's answer to it
 *    finds the ticket by `In-Reply-To` as well as by its signed `Reply-To`.
 *  - **Send what it cannot fully render.** The same refusals as a ticket notice
 *    (`renderTicketEmail`): a template turned off, one that has gone stale, a
 *    ticket with nobody to write to.
 */
import { randomUUID } from 'node:crypto';
import type { Env } from '../../config/env.js';
import type { TenantClient, TenantContext } from '../../lib/tenant.js';
import { type BackgroundMail, logUnsentMail, type MailOutcomeLogger } from '../mail/delivery.js';
import { ticketNoticeMail } from '../mail/templates/messages.js';
import type { PendingAck } from './apply-ticket-rules.js';
import { renderTicketEmail, withPilotNoReplyLine } from './ticket-email.js';
import type { TicketMessageService } from './ticket-message-service.js';
import type { TicketReplyAddresses } from './ticket-reply-address.js';

/** A message ready for {@link deliverAutoAck}. */
export interface AutoAckMail {
  to: string;
  ticketId: string;
  templateId: string;
  subject: string;
  body: string;
  workspaceName: string;
  /** Without brackets; the same id the ticket's system line is stored under. */
  emailMessageId: string;
  inReplyTo: string | null;
  references: string[];
  /** The ticket's signed reply address; none in the pilot, which serves no inbound mail. */
  replyTo: string | null;
}

export interface TicketAutoAckSettings {
  /** `TICKET_MAIL_OUTBOUND` (K23): off, the acknowledgement is not sent and the ticket says so. */
  outbound: boolean;
  /** The right-hand side of the `Message-ID` it goes out under. */
  messageIdDomain: string;
  replyAddresses: TicketReplyAddresses;
  /** `PILOT_MODE`: no `Reply-To`, and the mail says its mailbox reads no replies. */
  pilotMode: boolean;
}

/**
 * The right-hand side of a ticket mail's `Message-ID`: the system address's
 * domain, as the SMTP carrier would choose for a message it numbers itself.
 * Without `SMTP_FROM` (the spool in development and the test suites) a
 * reserved name (RFC 2606) that can belong to nobody.
 */
export function messageIdDomainOf(env: Pick<Env, 'SMTP_FROM'>): string {
  const from = env.SMTP_FROM ?? '';
  const domain = from.slice(from.lastIndexOf('@') + 1);
  return from.includes('@') && /^[A-Za-z0-9.-]+$/.test(domain) ? domain : 'siyahtus.invalid';
}

/**
 * When the player is expected to hear from a person (`ticket.expected_response`):
 * "within 4 hours" in hours, "from 09:00" out of them. That is the first-response
 * target of HD-05 (tm 360), which does not exist yet — until it does there is
 * nothing true to promise, so the variable is empty rather than invented.
 */
export function expectedResponseText(): string | null {
  return null;
}

/**
 * True when the provider reports that the sender's domain failed SPF or DMARC.
 * Only an explicit failure counts: a provider that reports nothing (or `pass`,
 * `none`, `neutral`) leaves the answer at "unknown", which is not a failure.
 */
export function senderFailedChecks(
  authentication: { spf?: string | null; dmarc?: string | null } | undefined,
): boolean {
  const failed = (verdict: string | null | undefined) =>
    verdict !== undefined &&
    verdict !== null &&
    /^(fail|softfail|permerror)$/i.test(verdict.trim());
  return failed(authentication?.spf) || failed(authentication?.dmarc);
}

export class TicketAutoAck {
  readonly #messages: TicketMessageService;
  readonly #settings: TicketAutoAckSettings;

  constructor(messages: TicketMessageService, settings: TicketAutoAckSettings) {
    this.#messages = messages;
    this.#settings = settings;
  }

  /**
   * Settle a rule's acknowledgement for a ticket that now exists. Writes the
   * ticket's system line (what was sent, or why nothing was) and returns the
   * mail to send after the commit, or null when nothing goes.
   *
   * `thread` is the mail the player wrote, when there is one: the
   * acknowledgement is sent as its answer. `after` places the line under the
   * message it follows.
   */
  async prepare(
    tx: TenantClient,
    tenant: TenantContext,
    input: {
      ticketId: string;
      ack: PendingAck;
      thread?: { messageId: string | null; references: readonly string[] };
      after?: Date;
    },
  ): Promise<AutoAckMail | null> {
    const ticket = await tx.ticket.findUnique({
      where: { id: input.ticketId },
      select: {
        id: true,
        subject: true,
        priority: true,
        status: true,
        mergedIntoId: true,
        customer: { select: { name: true, email: true } },
      },
    });
    // Spam and merged tickets are history, not requests: nothing is owed.
    if (!ticket || ticket.mergedIntoId !== null || ticket.status === 'spam') return null;

    const template = await tx.ticketEmailTemplate.findFirst({
      where: { id: input.ack.templateId, licenseId: tenant.licenseId },
      select: { id: true, name: true, subject: true, body: true, enabled: true },
    });
    const note = (text: string, emailMessageId: string | null = null) =>
      this.#messages.recordSystemNote(tx, tenant, ticket.id, text, {
        ...(input.after ? { after: input.after } : {}),
        ...(emailMessageId ? { emailMessageId } : {}),
      });

    if (!template) {
      await note('Automatic acknowledgement not sent: its e-mail template no longer exists.');
      return null;
    }
    // A template switched off is a decision already made; it is not noise on
    // every ticket.
    if (!template.enabled) return null;

    const organization = await tx.organization.findUnique({
      where: { id: tenant.organizationId },
      select: { name: true },
    });
    const workspaceName = organization?.name ?? 'SiyahTuş';
    const outcome = renderTicketEmail(template, {
      ticketId: ticket.id,
      subject: ticket.subject,
      status: 'open',
      priority: ticket.priority,
      customerName: ticket.customer?.name ?? null,
      customerEmail: ticket.customer?.email ?? null,
      agentName: null,
      companyName: organization?.name ?? null,
      expectedResponse: expectedResponseText(),
    });

    if (!outcome.ok) {
      if (outcome.refusal.reason === 'no_recipient') {
        await note('Automatic acknowledgement not sent: no recipient address.');
      } else if (outcome.refusal.reason === 'invalid_template') {
        await note(
          `Automatic acknowledgement not sent: the e-mail template “${template.name}” is no longer valid.`,
        );
      }
      return null;
    }
    if (!this.#settings.outbound) {
      await note('Automatic acknowledgement not sent: ticket e-mail is switched off.');
      return null;
    }

    // The ticket number leads the subject whatever the template says, so the
    // player (and the inbound path) can tell what it belongs to.
    const tag = `[#${ticket.id}]`;
    const message = outcome.message;
    const emailMessageId = `${randomUUID()}@${this.#settings.messageIdDomain}`;
    const inReplyTo = input.thread?.messageId ?? null;
    await note(`Automatic acknowledgement sent: ${template.name}`, emailMessageId);
    return {
      to: message.to,
      ticketId: ticket.id,
      templateId: template.id,
      subject: message.subject.includes(tag) ? message.subject : `${tag} ${message.subject}`,
      body: this.#settings.pilotMode ? withPilotNoReplyLine(message.body) : message.body,
      workspaceName,
      emailMessageId,
      inReplyTo,
      references: inReplyTo ? [...(input.thread?.references ?? []), inReplyTo] : [],
      replyTo: this.#settings.pilotMode
        ? null
        : this.#settings.replyAddresses.addressFor(tenant, ticket.id),
    };
  }
}

/**
 * Hand a prepared acknowledgement to the mailer, after the commit. Not
 * awaited: the ticket is already durable, and the player's request must not
 * depend on the carrier's latency or its failure. A failure is logged with the
 * ids and the carrier's classification, never the address or the text.
 */
export function deliverAutoAck(
  backgroundMail: BackgroundMail,
  log: MailOutcomeLogger,
  tenant: Pick<TenantContext, 'licenseId'>,
  mail: AutoAckMail,
): void {
  backgroundMail.send(
    {
      to: mail.to,
      licenseId: tenant.licenseId,
      kind: 'ticket_notice',
      messageId: mail.emailMessageId,
      ...(mail.inReplyTo ? { inReplyTo: mail.inReplyTo } : {}),
      references: mail.references,
      ...(mail.replyTo ? { replyTo: mail.replyTo } : {}),
      fromName: mail.workspaceName,
      // RFC 3834: an automatic reply says so, so another auto-responder
      // does not answer it.
      autoSubmitted: 'auto-replied',
      // The player's language is not known to the server — the frame's few
      // words are English, as on the ticket notice.
      ...ticketNoticeMail(
        { locale: 'en' },
        { workspaceName: mail.workspaceName, subject: mail.subject, body: mail.body },
      ),
    },
    (outcome) =>
      logUnsentMail(log, 'ticket.auto_ack_mail', outcome, {
        template_id: mail.templateId,
        ticket_id: mail.ticketId,
      }),
  );
}
