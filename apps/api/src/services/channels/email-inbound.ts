/**
 * Inbound email → ticket (FR-MOD-08.5.3).
 *
 * The asynchronous entry point into the inbox: a workspace forwards its support
 * mail to one of its addresses — `<organization_id>@<inbound-domain>`, or a
 * labelled `<organization_id>+support@<inbound-domain>` — a provider parses each
 * message and calls the webhook, and this turns it into a ticket on the same
 * core the agent-facing routes write to (`TicketService`, Dilim 11).
 *
 * Since tm 357 (SiyahTuş analysis HD-02) the mail is not reduced to its
 * subject: what the player wrote becomes the ticket's first message, with its
 * files, and a redelivery of the same Message-ID is the same ticket.
 *
 * Three rules the tests pin down, because each is easy to get wrong and silent
 * when wrong:
 *
 *  - A sender who already exists as a customer is reused, not duplicated. Email
 *    is the natural key here; a second record would split one person's history
 *    across two rows the directory then shows as strangers.
 *  - A workspace with the spam filter on (the default) drops a message the
 *    provider flagged, or whose subject or text the classifier calls spam,
 *    rather than filling the queue with it. The filter is a per-workspace
 *    setting, so this reads it live inside the tenant.
 *  - One Message-ID is one ticket: the provider retries what it is not sure was
 *    taken, and a retry must not open a second ticket for the same mail.
 *
 * The recipient address is resolved to a tenant *before* this runs; everything
 * here is already inside that tenant's `withTenant`, so RLS confines every read
 * and write to the licence the address pointed at.
 */
import type { TicketMessageAttachment } from '@siyahtus/types';
import type { TenantClient, TenantContext } from '../../lib/tenant.js';
import { maskForWrite } from '../../lib/sensitive-mask.js';
import type { AuditContext } from '../audit/audit-log.js';
import { evaluateSpam, isSpamFilterEnabled } from '../security/spam-filter.js';
import type { TicketMessagePush, TicketMessageService } from '../tickets/ticket-message-service.js';
import type { TicketService } from '../tickets/ticket-service.js';
import { rejectedAttachmentsNote, type RejectedAttachment } from './inbound-email-attachments.js';
import type { InboundBody } from './inbound-email-body.js';

export interface InboundEmail {
  senderEmail: string;
  senderName: string | null;
  subject: string;
  /** The provider's spam verdict. Honoured only when the workspace filter is on. */
  spam: boolean;
  /**
   * The forwarding address the message arrived at, so the ticket records which
   * mailbox it came in through. Null only when the address could not be
   * materialised, never as a routing decision.
   */
  addressId: string | null;
  /** What the player wrote (tm 357 · HD-02), split and sanitised — `prepareInboundBody`. */
  body?: InboundBody;
  /** The mail's `Message-ID`, brackets off (`normalizeMessageId`). One message per licence. */
  messageId?: string | null;
  inReplyTo?: string | null;
  /** The files already stored, outside the transaction (`screenInboundAttachments`). */
  attachments?: TicketMessageAttachment[];
  /** The files that were not kept, for the ticket's system line. */
  rejected?: RejectedAttachment[];
}

export type InboundResult =
  | {
      status: 'created';
      ticket_id: string;
      /** The Message-ID had been taken in before: this is the ticket it opened. */
      duplicate?: true;
    }
  | { status: 'ignored'; reason: 'spam' };

/** What the route needs after the commit, beside the answer to the provider. */
export interface InboundOutcome {
  result: InboundResult;
  /** The thread's realtime notice — null on a duplicate, on spam, or with nobody to tell. */
  push: TicketMessagePush | null;
}

/**
 * A parsed sender, or `null` when the address is unusable.
 *
 * Accepts both a bare `jane@example.com` and a display form
 * `Jane Doe <jane@example.com>` — a mail provider may deliver either. The email
 * is lower-cased so matching an existing customer does not depend on how the
 * sender happened to capitalise it; the column is `citext` too, so this is
 * belt-and-braces rather than the only guard.
 */
export function parseSender(raw: string): { email: string; name: string | null } | null {
  const angle = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(raw);
  const email = (angle ? (angle[2] ?? '') : raw).trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+$/.test(email)) return null;

  const rawName = angle?.[1]?.replace(/^"|"$/g, '').trim();
  return { email, name: rawName ? rawName : null };
}

/**
 * A `Message-ID` as it is compared and kept: trimmed, angle brackets off, or
 * null when nothing is left. Kept without brackets so a reply's `In-Reply-To`
 * (`threadOf`) and a redelivery's lookup see one spelling.
 */
export function normalizeMessageId(raw: string | null | undefined): string | null {
  const value = raw
    ?.trim()
    .replace(/^<([^<>]*)>$/, '$1')
    .trim();
  return value ? value : null;
}

const ORG_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** A recipient address broken into the two halves routing cares about. */
export interface Recipient {
  /** The whole local part, lower-cased: `<org>` or `<org>+<label>`. */
  localPart: string;
  /** The organization id in front of the label. */
  organizationId: string;
  /** The part after the `+`, or null for the workspace's default address. */
  label: string | null;
}

/**
 * The recipient a forwarding address names, or `null` when it names none.
 *
 * The local part is the routing key: `<organization_id>` for the address every
 * workspace has always had, and `<organization_id>+<label>` for one it defined
 * (FR-MOD-08.5.3). `+` rather than a free local part because that is ordinary
 * mail sub-addressing — a provider already delivers `a+b@d` to the mailbox `a`,
 * so a catch-all forward configured before labels existed keeps working — and
 * because keeping the organization id in front is what makes two workspaces
 * unable to claim the same address.
 *
 * The domain is not checked: the local part is what maps to a workspace, and a
 * provider may rewrite the domain (subdomains, a display name) on the way in. A
 * `to` header with a display name or several recipients is tolerated by pulling
 * the address out and taking the first one.
 *
 * Parsing stops here. Whether a labelled address actually exists is a question
 * for the database, not for a regular expression.
 */
export function parseRecipient(to: string): Recipient | null {
  const first = to.split(',')[0] ?? '';
  const angle = /<([^>]+)>/.exec(first);
  const address = (angle ? (angle[1] ?? '') : first).trim();
  const localPart = address.split('@')[0]?.trim().toLowerCase();
  if (!localPart) return null;

  const plus = localPart.indexOf('+');
  const organizationId = plus === -1 ? localPart : localPart.slice(0, plus);
  const label = plus === -1 ? null : localPart.slice(plus + 1);
  if (!ORG_UUID_RE.test(organizationId)) return null;
  // A trailing `+` names no label; treat it as unroutable rather than as the
  // default address, so `<org>+@domain` cannot quietly become `<org>@domain`.
  if (label !== null && label.length === 0) return null;

  return { localPart, organizationId, label };
}

/**
 * The ticket a Message-ID already opened in this licence, or null. Read under
 * RLS. Any message counts, an agent's reply included: a reply of ours that a
 * mail loop delivers back to the inbound address is the same message, not a
 * new ticket.
 */
export async function ticketOfMessageId(
  tx: TenantClient,
  tenant: TenantContext,
  messageId: string,
): Promise<string | null> {
  const row = await tx.ticketMessage.findUnique({
    where: { licenseId_emailMessageId: { licenseId: tenant.licenseId, emailMessageId: messageId } },
    select: { ticketId: true },
  });
  return row?.ticketId ?? null;
}

/**
 * Whether the workspace's spam gate drops this mail — the engine the widget
 * screens through (FR-MOD-08.9.3), so the decision lives in one place rather
 * than being reimplemented per channel. The provider's own verdict is honoured,
 * and the masked subject *and* text (tm 357: the body is evidence too) go
 * through the deterministic content classifier — a message the provider passed
 * whose words are a content-spam flood is still dropped. No row means the
 * schema default, which is *on*, so an unconfigured workspace still drops
 * flagged spam rather than accepting it.
 */
export async function isInboundSpam(
  tx: TenantClient,
  input: { maskedSubject: string; maskedText: string; providerFlagged: boolean },
): Promise<boolean> {
  const filterEnabled = await isSpamFilterEnabled(tx);
  const text = [input.maskedSubject, input.maskedText].filter((part) => part.trim()).join('\n');
  return evaluateSpam({ filterEnabled, text, providerFlagged: input.providerFlagged }).spam;
}

/** The workspace's "treat every e-mailed file as sensitive" (`security_settings`). */
export async function inboundAttachmentsAllSensitive(tx: TenantClient): Promise<boolean> {
  const settings = await tx.securitySettings.findFirst({
    select: { inboundAttachmentsSensitive: true },
  });
  return settings?.inboundAttachmentsSensitive ?? false;
}

/**
 * One received mail into the inbox, in one transaction: the customer, the
 * ticket, the player's message and — when files were refused — the line saying
 * which. The files themselves were stored before this ran.
 *
 * Idempotent on the Message-ID (tm 357 · HD-02): the first thing taken is a
 * transaction-scoped lock on the licence and the id, so two deliveries of the
 * same mail racing in serialise here, and the second finds the first one's
 * message and answers with its ticket — one mail, one ticket, however often the
 * provider retries. A mail with no Message-ID has nothing to be recognised by
 * and is taken in every time.
 *
 * Matching the mail to an existing ticket (the player answering a reply) is
 * HD-03 (#358); until then every new Message-ID opens a ticket.
 */
export async function ingestInboundEmail(
  tx: TenantClient,
  tenant: TenantContext,
  services: { tickets: TicketService; messages: TicketMessageService },
  email: InboundEmail,
  auditFor: (customerId: string) => AuditContext,
): Promise<InboundOutcome> {
  const messageId = email.messageId ?? null;
  if (messageId) {
    // `$executeRaw`: the lock function returns `void`, which `$queryRaw` cannot read back.
    await tx.$executeRaw`
      SELECT pg_advisory_xact_lock(hashtextextended(${`inbound_email:${tenant.licenseId}:${messageId}`}, 0))`;
    const seen = await ticketOfMessageId(tx, tenant, messageId);
    if (seen)
      return { result: { status: 'created', ticket_id: seen, duplicate: true }, push: null };
  }

  // Mask the subject once (FR-MOD-08.9.5 · AI-26), up front — the same value is
  // what the spam classifier sees and what the ticket stores, so, as on the
  // widget path, no raw card, password or code is ever handed to the classifier.
  // The text is masked for the classifier the same way; the message masks what
  // it stores itself (`recordCustomerMessage`).
  const maskedSubject = maskForWrite(email.subject, 'customer').text;
  const text = email.body?.text ?? '';
  const spam = await isInboundSpam(tx, {
    maskedSubject,
    maskedText: maskForWrite(text, 'customer').text,
    providerFlagged: email.spam,
  });
  if (spam) return { result: { status: 'ignored', reason: 'spam' }, push: null };

  // Match on email alone: RLS has already scoped this to the one organization,
  // and `citext` makes the comparison case-insensitive. A hit is reused so the
  // returning writer keeps one history; a miss becomes a new customer.
  const existing = await tx.customer.findFirst({
    where: { email: email.senderEmail },
    select: { id: true },
  });

  const customerId =
    existing?.id ??
    (
      await tx.customer.create({
        data: {
          organizationId: tenant.organizationId,
          email: email.senderEmail,
          name: email.senderName,
          lastActivityAt: new Date(),
        },
        select: { id: true },
      })
    ).id;

  const ticket = await services.tickets.createFromEmail(tx, tenant, {
    // The masked subject (computed above) is what the ticket stores and what the
    // triage rules see (FR-MOD-08.9.5).
    subject: maskedSubject,
    customerId,
    inboundAddressId: email.addressId,
  });

  // The ticket's first message: what the player wrote, its files, and its
  // Message-ID — the key a redelivery, and (HD-03) the player's next answer,
  // find this ticket by.
  const written = await services.messages.recordCustomerMessage(tx, tenant, auditFor(customerId), {
    ticketId: ticket.id,
    text,
    textFull: email.body?.full ?? null,
    html: email.body?.html ?? null,
    emailMessageId: messageId,
    inReplyTo: email.inReplyTo ?? null,
    attachments: email.attachments ?? [],
  });
  if (email.rejected && email.rejected.length > 0) {
    // A file's name is the player's text, masked like the rest of it.
    const note = maskForWrite(rejectedAttachmentsNote(email.rejected), 'customer').text;
    await services.messages.recordSystemNote(
      tx,
      tenant,
      written.message.ticket_id,
      note,
      new Date(written.message.created_at),
    );
  }
  return { result: { status: 'created', ticket_id: ticket.id }, push: written.push };
}
