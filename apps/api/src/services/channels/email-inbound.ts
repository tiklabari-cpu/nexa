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
 * Since tm 358 (HD-03) a player's answer joins the ticket it answers instead
 * of opening another — see {@link ingestInboundEmail} for the order it is
 * matched in and what a match does to the ticket.
 *
 * Rules the tests pin down, because each is easy to get wrong and silent when
 * wrong:
 *
 *  - A sender who already exists as a customer is reused, not duplicated. Email
 *    is the natural key here; a second record would split one person's history
 *    across two rows the directory then shows as strangers.
 *  - A workspace with the spam filter on (the default) drops a message the
 *    provider flagged, or whose subject or text the classifier calls spam,
 *    rather than filling the queue with it. The filter is a per-workspace
 *    setting, so this reads it live inside the tenant. It runs before any
 *    matching: spam does not get to write into an existing ticket either.
 *  - One Message-ID is one ticket: the provider retries what it is not sure was
 *    taken, and a retry must not open a second ticket for the same mail.
 *  - An automatic reply never moves a ticket: two auto-responders answering
 *    each other would otherwise reopen it forever.
 *
 * The recipient address is resolved to a tenant *before* this runs; everything
 * here is already inside that tenant's `withTenant`, so RLS confines every read
 * and write to the licence the address pointed at.
 */
import { TICKET_REOPEN_WINDOW_DAYS_DEFAULT, type TicketMessageAttachment } from '@siyahtus/types';
import type { TenantClient, TenantContext } from '../../lib/tenant.js';
import { clipText } from '../../lib/clip-text.js';
import { maskForWrite } from '../../lib/sensitive-mask.js';
import type { AuditContext } from '../audit/audit-log.js';
import { evaluateSpam, isSpamFilterEnabled } from '../security/spam-filter.js';
import {
  lockedReplyTarget,
  type TicketMessagePush,
  type TicketMessageService,
} from '../tickets/ticket-message-service.js';
import type { TicketReplyAddresses } from '../tickets/ticket-reply-address.js';
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
  /** The mail's `References`, oldest first, brackets off (tm 358). */
  references?: string[];
  /**
   * The ticket reply-address labels (`t-<ticket>-<signature>`) among this
   * workspace's recipients, in routing order (tm 358). Unverified: the
   * signature is checked here, against the licence.
   */
  replyLabels?: string[];
  /** An auto-reply, out-of-office or bulk mail (`isAutomatedMail`, tm 358). */
  automated?: boolean;
  /** The files already stored, outside the transaction (`screenInboundAttachments`). */
  attachments?: TicketMessageAttachment[];
  /** The files that were not kept, for the ticket's system line. */
  rejected?: RejectedAttachment[];
}

export type InboundResult =
  | {
      status: 'created';
      ticket_id: string;
      /** The Message-ID had been taken in before: this is the ticket it went to. */
      duplicate?: true;
      /** The closed or old ticket this mail answered, which it did not reopen (tm 358). */
      related_ticket_id?: string;
    }
  | {
      /** Added to an existing ticket (tm 358 · HD-03). */
      status: 'threaded';
      ticket_id: string;
      /** A solved ticket went back to open. */
      reopened?: true;
      /** From an address other than the ticket's player. */
      sender_mismatch?: true;
      /** An automatic reply, kept as a system line only. */
      automated?: true;
    }
  | { status: 'ignored'; reason: 'spam' | 'rate_limited' };

/** What the route needs after the commit, beside the answer to the provider. */
export interface InboundOutcome {
  result: InboundResult;
  /** The thread's realtime notice — null on a duplicate, on spam, or with nobody to tell. */
  push: TicketMessagePush | null;
  /**
   * Whether the files stored before the transaction are on a message now.
   * False — a duplicate, spam, an automatic reply, a refused sender — and the
   * route deletes them: nothing points at them.
   */
  filesKept: boolean;
}

/** What `ingestInboundEmail` writes with. */
export interface InboundServices {
  tickets: TicketService;
  messages: TicketMessageService;
  /** Verifies reply-address labels. Absent, no label matches (the console's test message). */
  replyAddresses?: TicketReplyAddresses;
  /**
   * Charged once for each ticket this mail would open, or reopen from `solved`
   * — "may this sender open one more this hour?" (tm 358 loop guard). Absent,
   * there is no limit (the console's test message).
   */
  openBudget?: (senderEmail: string) => Promise<boolean>;
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

/** Every `local@domain` in a header value, display names and separators aside. */
const ADDRESS_RE = /[^\s<>,;:"()[\]]+@[^\s<>,;:"()[\]]+/g;

/**
 * The workspace addresses a mail was delivered for, in the order they decide
 * routing (tm 358): the envelope recipients first (`Delivered-To` — the address
 * this one delivery is for), then `To`, then `Cc`. Anything that is not a
 * workspace address (the player's friend on "reply all") is left out, and an
 * address named twice counts once.
 */
export function recipientsOf(fields: readonly string[]): Recipient[] {
  const seen = new Set<string>();
  const out: Recipient[] = [];
  for (const field of fields) {
    for (const address of field.match(ADDRESS_RE) ?? []) {
      const recipient = parseRecipient(address);
      if (recipient && !seen.has(recipient.localPart)) {
        seen.add(recipient.localPart);
        out.push(recipient);
      }
    }
  }
  return out;
}

/** The auto-reply headers, as the webhook passes them through (`InboundEmail.headers`). */
export interface AutoReplyHeaders {
  auto_submitted?: string | null | undefined;
  precedence?: string | null | undefined;
  x_autoreply?: string | null | undefined;
  x_auto_response_suppress?: string | null | undefined;
}

/**
 * Whether a mail was written by a machine answering another mail (tm 358 loop
 * guard): `Auto-Submitted` other than `no` (RFC 3834 — `auto-replied`,
 * `auto-generated`), any `X-Autoreply`, `Precedence: bulk | junk | auto_reply`,
 * or any `X-Auto-Response-Suppress` (Exchange puts it on its own out-of-office
 * replies). Such a mail must not reopen a ticket or open one that something
 * would answer — two auto-responders would otherwise keep each other busy.
 */
export function isAutomatedMail(headers: AutoReplyHeaders): boolean {
  const autoSubmitted = headers.auto_submitted?.split(';')[0]?.trim().toLowerCase();
  if (autoSubmitted && autoSubmitted !== 'no') return true;
  const autoreply = headers.x_autoreply?.trim().toLowerCase();
  if (autoreply && autoreply !== 'no') return true;
  if (headers.x_auto_response_suppress?.trim()) return true;
  const precedence = headers.precedence?.trim().toLowerCase();
  return precedence === 'bulk' || precedence === 'junk' || precedence === 'auto_reply';
}

/** `[#<ticket id>]` — the tag every ticket reply leads its subject with (`ticketReplyMail`). */
const SUBJECT_TICKET_RE = /\[#([0-9A-HJKMNP-TV-Z]{10})\]/i;

/** The ticket id a subject's `[#…]` tag names, upper-cased as tickets store it, or null. */
export function ticketIdInSubject(subject: string): string | null {
  return SUBJECT_TICKET_RE.exec(subject)?.[1]?.toUpperCase() ?? null;
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
 * How many days after its last activity a player's answer still reopens a
 * solved ticket — the default brand's `inbox_settings` row, the shipped 30
 * without one. Mail arrives for the workspace, not for a brand.
 */
export async function ticketReopenWindowDays(tx: TenantClient): Promise<number> {
  const settings = await tx.inboxSettings.findFirst({
    where: { brand: { isDefault: true } },
    select: { ticketReopenWindowDays: true },
  });
  return settings?.ticketReopenWindowDays ?? TICKET_REOPEN_WINDOW_DAYS_DEFAULT;
}

/** How a mail found its ticket — the order {@link ingestInboundEmail} tries them in. */
type MatchedBy = 'reply_address' | 'thread' | 'subject';

/** The most `In-Reply-To` + `References` ids looked up for one mail. */
const THREAD_IDS_MAX = 50;

/**
 * The existing ticket a mail answers, or null (tm 358 · HD-03), first match wins:
 *
 *  1. a reply-address label whose signature is this licence's, naming a ticket
 *     this licence holds — a forged, damaged or foreign one is skipped;
 *  2. `In-Reply-To`, then `References` newest first, naming a message any
 *     ticket of this licence holds — what a mail client keeps when the player
 *     typed the support address in by hand instead of answering;
 *  3. `[#<id>]` in the subject, and only when the sender is that ticket's
 *     player: the tag is printed in every subject, so on its own it proves
 *     nothing about who is writing.
 */
async function matchTicket(
  tx: TenantClient,
  tenant: TenantContext,
  replyAddresses: TicketReplyAddresses | undefined,
  email: InboundEmail,
): Promise<{ ticketId: string; by: MatchedBy } | null> {
  if (replyAddresses) {
    for (const label of email.replyLabels ?? []) {
      const ticketId = replyAddresses.ticketOf(tenant.licenseId, label);
      if (
        ticketId &&
        (await tx.ticket.findUnique({ where: { id: ticketId }, select: { id: true } }))
      ) {
        return { ticketId, by: 'reply_address' };
      }
    }
  }

  const threadIds = [
    ...new Set(
      [email.inReplyTo, ...[...(email.references ?? [])].reverse()].filter(
        (id): id is string => Boolean(id) && id !== email.messageId,
      ),
    ),
  ].slice(0, THREAD_IDS_MAX);
  if (threadIds.length > 0) {
    const rows = await tx.ticketMessage.findMany({
      where: { emailMessageId: { in: threadIds } },
      select: { ticketId: true, emailMessageId: true },
    });
    const byId = new Map(rows.map((row) => [row.emailMessageId, row.ticketId]));
    for (const id of threadIds) {
      const ticketId = byId.get(id);
      if (ticketId) return { ticketId, by: 'thread' };
    }
  }

  const tagged = ticketIdInSubject(email.subject);
  if (tagged) {
    const ticket = await tx.ticket.findUnique({
      where: { id: tagged },
      select: { id: true, customer: { select: { email: true } } },
    });
    if (ticket && sameAddress(ticket.customer?.email, email.senderEmail)) {
      return { ticketId: ticket.id, by: 'subject' };
    }
  }
  return null;
}

function sameAddress(a: string | null | undefined, b: string): boolean {
  return Boolean(a) && a!.trim().toLowerCase() === b.trim().toLowerCase();
}

/** The customer a sender is: matched by email (RLS + `citext`), created on a miss. */
async function customerOf(
  tx: TenantClient,
  tenant: TenantContext,
  email: InboundEmail,
): Promise<string> {
  // Match on email alone: RLS has already scoped this to the one organization,
  // and `citext` makes the comparison case-insensitive. A hit is reused so the
  // returning writer keeps one history; a miss becomes a new customer.
  const existing = await tx.customer.findFirst({
    where: { email: email.senderEmail },
    select: { id: true },
  });
  if (existing) return existing.id;
  const created = await tx.customer.create({
    data: {
      organizationId: tenant.organizationId,
      email: email.senderEmail,
      name: email.senderName,
      lastActivityAt: new Date(),
    },
    select: { id: true },
  });
  return created.id;
}

/** The most of an automatic reply's text its system line quotes. */
const AUTOMATED_QUOTE_MAX = 2_000;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * One received mail into the inbox, in one transaction: the customer, the
 * ticket — a new one, or the one it answers — the player's message and, when
 * files were refused, the line saying which. The files themselves were stored
 * before this ran.
 *
 * Idempotent on the Message-ID (tm 357 · HD-02): the first thing taken is a
 * transaction-scoped lock on the licence and the id, so two deliveries of the
 * same mail racing in serialise here, and the second finds the first one's
 * message and answers with its ticket — one mail, one ticket, however often the
 * provider retries. A mail with no Message-ID has nothing to be recognised by
 * and is taken in every time.
 *
 * Then the spam gate, then the ticket it answers (tm 358 · HD-03, the order is
 * `matchTicket`'s). On a match the ticket is locked — its primary, when it was
 * merged — and what happens depends on where it stands:
 *
 *  - an automatic reply is a system line, nothing more: no reopening, no new
 *    ticket, no message a rule or an acknowledgement could answer;
 *  - a `closed` ticket, or a `solved` one quiet longer than the workspace's
 *    reopen window, is left alone: a new ticket opens that names it
 *    (`related_ticket_id`), and each says so in a line;
 *  - otherwise the answer is added — a `solved` ticket reopens, with a line
 *    saying so — and from an address that is not the ticket's player it is
 *    still added, marked `sender_mismatch`.
 *
 * Opening a ticket and reopening one each spend from the sender's hourly
 * budget (`openBudget`). Past it a reply is added without reopening, and a
 * mail that would open a ticket is dropped (`rate_limited`): a sender opening
 * ten tickets an hour is a loop, not a person.
 */
export async function ingestInboundEmail(
  tx: TenantClient,
  tenant: TenantContext,
  services: InboundServices,
  email: InboundEmail,
  auditFor: (customerId: string) => AuditContext,
): Promise<InboundOutcome> {
  const messageId = email.messageId ?? null;
  if (messageId) {
    // `$executeRaw`: the lock function returns `void`, which `$queryRaw` cannot read back.
    await tx.$executeRaw`
      SELECT pg_advisory_xact_lock(hashtextextended(${`inbound_email:${tenant.licenseId}:${messageId}`}, 0))`;
    const seen = await ticketOfMessageId(tx, tenant, messageId);
    if (seen) {
      return {
        result: { status: 'created', ticket_id: seen, duplicate: true },
        push: null,
        filesKept: false,
      };
    }
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
  if (spam) return { result: { status: 'ignored', reason: 'spam' }, push: null, filesKept: false };

  const budget = async () => (services.openBudget ? services.openBudget(email.senderEmail) : true);
  const match = await matchTicket(tx, tenant, services.replyAddresses, email);
  const target = match ? await lockedReplyTarget(tx, match.ticketId) : null;

  if (target && email.automated) {
    // Kept so the team can read it ("out of office until Monday"), under its
    // Message-ID so a redelivery is recognised — and nothing else.
    const quoted = clipText(maskForWrite(text, 'customer').text.trim(), AUTOMATED_QUOTE_MAX);
    await services.messages.recordSystemNote(
      tx,
      tenant,
      target.ticket.id,
      `Automatic reply received from ${email.senderEmail} — the ticket was not reopened.${quoted ? `\n\n${quoted}` : ''}`,
      { emailMessageId: messageId, inReplyTo: email.inReplyTo ?? null },
    );
    return {
      result: { status: 'threaded', ticket_id: target.ticket.id, automated: true },
      push: null,
      filesKept: false,
    };
  }

  const customerId = await customerOf(tx, tenant, email);
  const message = {
    text,
    textFull: email.body?.full ?? null,
    html: email.body?.html ?? null,
    emailMessageId: messageId,
    inReplyTo: email.inReplyTo ?? null,
    attachments: email.attachments ?? [],
  };

  if (target) {
    const ticket = target.ticket;
    const senderMismatch = !target.playerEmails.some((address) =>
      sameAddress(address, email.senderEmail),
    );
    const lastActivity = ticket.lastMessageAt ?? ticket.createdAt;
    const stale =
      ticket.status === 'closed' ||
      (ticket.status === 'solved' &&
        Date.now() - lastActivity.getTime() > (await ticketReopenWindowDays(tx)) * DAY_MS);

    if (stale && (await budget())) {
      // A new request that follows on from the old one — in the mailbox it
      // came through, by the person who wrote it.
      const created = await services.tickets.createFromEmail(tx, tenant, {
        subject: maskedSubject,
        customerId,
        inboundAddressId: ticket.inboundAddressId ?? email.addressId,
        relatedTicketId: ticket.id,
      });
      const written = await services.messages.recordCustomerMessage(
        tx,
        tenant,
        auditFor(customerId),
        { ticketId: created.id, ...message },
      );
      const at = new Date(written.message.created_at);
      await services.messages.recordSystemNote(
        tx,
        tenant,
        created.id,
        `Follows on from ticket #${ticket.id} (${ticket.status}).`,
        { after: at },
      );
      await services.messages.recordSystemNote(
        tx,
        tenant,
        ticket.id,
        `The player wrote again; ticket #${created.id} was opened for it.`,
      );
      await noteRejected(tx, tenant, services, email, created.id, at);
      return {
        result: { status: 'created', ticket_id: created.id, related_ticket_id: ticket.id },
        push: written.push,
        filesKept: true,
      };
    }

    // Reopening spends from the budget; an ordinary turn (`pending` → `open`)
    // does not. Past the budget — or a stale ticket past it — the answer is
    // still kept, on the ticket it answers, and the status stays.
    const allowReopen = !stale && (ticket.status !== 'solved' || (await budget()));
    const written = await services.messages.recordCustomerMessage(
      tx,
      tenant,
      auditFor(customerId),
      {
        ticketId: ticket.id,
        ...message,
        authorCustomerId: customerId,
        senderMismatch,
        allowReopen,
      },
    );
    // The Message-ID lock above already answered a known mail, so this is a
    // belt-and-braces branch: a replay must not write its lines twice.
    if (written.replayed) {
      return {
        result: { status: 'threaded', ticket_id: written.message.ticket_id },
        push: null,
        filesKept: false,
      };
    }
    const at = new Date(written.message.created_at);
    if (written.reopened) {
      await services.messages.recordSystemNote(
        tx,
        tenant,
        ticket.id,
        'Reopened — the player answered by e-mail.',
        { after: at },
      );
    } else if (ticket.status === 'solved' || stale) {
      await services.messages.recordSystemNote(
        tx,
        tenant,
        ticket.id,
        'Not reopened: this sender opened or reopened too many tickets in the last hour.',
        { after: at },
      );
    }
    await noteRejected(tx, tenant, services, email, ticket.id, at);
    return {
      result: {
        status: 'threaded',
        ticket_id: ticket.id,
        ...(written.reopened ? { reopened: true as const } : {}),
        ...(senderMismatch ? { sender_mismatch: true as const } : {}),
      },
      push: written.push,
      filesKept: true,
    };
  }

  if (!(await budget())) {
    return { result: { status: 'ignored', reason: 'rate_limited' }, push: null, filesKept: false };
  }

  const ticket = await services.tickets.createFromEmail(tx, tenant, {
    // The masked subject (computed above) is what the ticket stores and what the
    // triage rules see (FR-MOD-08.9.5).
    subject: maskedSubject,
    customerId,
    inboundAddressId: email.addressId,
  });

  // The ticket's first message: what the player wrote, its files, and its
  // Message-ID — the key a redelivery, and the player's next answer, find this
  // ticket by.
  const written = await services.messages.recordCustomerMessage(tx, tenant, auditFor(customerId), {
    ticketId: ticket.id,
    ...message,
  });
  await noteRejected(
    tx,
    tenant,
    services,
    email,
    written.message.ticket_id,
    new Date(written.message.created_at),
  );
  return {
    result: { status: 'created', ticket_id: ticket.id },
    push: written.push,
    filesKept: true,
  };
}

/** The line naming the files that were not kept, under the message they came with. */
async function noteRejected(
  tx: TenantClient,
  tenant: TenantContext,
  services: InboundServices,
  email: InboundEmail,
  ticketId: string,
  after: Date,
): Promise<void> {
  if (!email.rejected || email.rejected.length === 0) return;
  // A file's name is the player's text, masked like the rest of it.
  const note = maskForWrite(rejectedAttachmentsNote(email.rejected), 'customer').text;
  await services.messages.recordSystemNote(tx, tenant, ticketId, note, { after });
}
