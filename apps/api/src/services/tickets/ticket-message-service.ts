/**
 * A ticket's conversation (SiyahTuş analysis HD-01 · tm 356.2): an agent's
 * reply to the player, a note for the team, what the player wrote.
 *
 * Every rule a message carries is applied here, so no route can write one
 * without them:
 *
 *   - **Masked before it rests.** The text goes through `maskForWrite` under its
 *     author's policy (AI-26 · FR-MOD-08.9.5) before the insert — the same rule
 *     the chat write paths follow, so a card number typed into a reply is never
 *     stored, pushed or (tm 356.3) mailed in clear.
 *   - **The status follows the conversation.** A reply leaves the ticket
 *     `pending` — waiting on the player — unless the composer said "send and
 *     solve"; a note leaves it as it was; the player writing moves a `pending`
 *     or `solved` ticket back to `open`. Each change writes the same
 *     `ticket.status_changed` entry and stops the same resolution clock as
 *     `PATCH /tickets/{id}`.
 *   - **One request, one message.** The composer's `idempotency_key` is unique
 *     per licence in the database; a retry answers with what the first attempt
 *     stored, and writes, audits and announces nothing a second time.
 *   - **A merged ticket is history.** Writing on one is `409 ticket_merged`
 *     naming its primary; the primary's thread reads the merged tickets'
 *     messages beside its own. The player's own message on a merged ticket is
 *     not refused — they cannot know — it lands on the primary.
 *   - **An internal note never becomes e-mail.** It is written with no
 *     delivery status, and the database refuses to give it one later
 *     (`ticket_messages_note_not_mailed_check`). The mail path (tm 356.3)
 *     starts from a reply's `delivery_status`, so a note has nothing to start it.
 *
 * The mail path (tm 356.3). With ticket e-mail on (`TICKET_MAIL_OUTBOUND`,
 * K23) a reply is stored `queued`, under the `Message-ID` it will be sent with
 * and threaded on the newest message before it that has one — so the id is
 * durable before the mail exists, the player's answer can find its ticket by
 * it, and a resend is the same message rather than a second one. The write
 * returns a {@link TicketReplyOutbound}; the route hands it to
 * `app.backgroundMail` after the commit, and {@link TicketMessageService.recordDelivery}
 * writes how the send went. With the switch off the reply is stored
 * `suppressed` and nothing is returned to send.
 */
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import {
  INBOUND_EMAIL_TEXT_MAX,
  TICKET_MESSAGE_PAGE_SIZE,
  type PushAudience,
  type TicketComposerKind,
  type TicketMessageAttachment,
  type TicketMessageAuthorType,
  type TicketMessageCreatedPush,
  type TicketMessageDeliveryChangedPush,
  type TicketMessageDeliveryStatus,
  type TicketMessageKind,
  type TicketReplySetStatus,
} from '@siyahtus/types';
import { ApiError } from '../../lib/api-error.js';
import { clipText } from '../../lib/clip-text.js';
import { maskForWrite } from '../../lib/sensitive-mask.js';
import { isMessageId } from '../mail/mime.js';
import { UUID_RE, type TenantClient, type TenantContext } from '../../lib/tenant.js';
import { writeAuditEntry, type AuditContext } from '../audit/audit-log.js';
import { hasCapability, requireCapability } from '../auth/capability.js';
import type { Principal } from '../auth/principal.js';
import { evaluateSubject } from '../sla/sla-service.js';
import type { ObjectStore } from '../storage/object-store.js';
import { licenseOfKey } from '../storage/upload-url.js';
import {
  accountNames,
  loadVisible,
  resolveVisibility,
  stopResolutionClock,
  writeTicketChangeAudit,
  type TicketStatus,
} from './ticket-service.js';
import { refreshFirstResponseDue } from './ticket-sla.js';

/** One entry of a ticket's thread, as `GET /tickets/{id}/messages` returns it. */
export interface TicketMessageView {
  id: string;
  /** The ticket it was written on — a primary's thread carries its merged tickets' too. */
  ticket_id: string;
  kind: TicketMessageKind;
  author_type: TicketMessageAuthorType;
  author_id: string | null;
  author_name: string | null;
  body_text: string;
  /** The whole e-mail text when the quote and signature were cut from `body_text` (tm 357). */
  body_text_full: string | null;
  body_html: string | null;
  attachments: TicketMessageAttachment[];
  delivery_status: TicketMessageDeliveryStatus | null;
  /** Present, and true, when a player's message came from another address than theirs (tm 358). */
  sender_mismatch?: true;
  created_at: string;
}

/** What the composer sends, once the route has parsed it and resolved its files. */
export interface ComposerInput {
  kind: TicketComposerKind;
  text: string;
  attachments: TicketMessageAttachment[];
  setStatus?: TicketReplySetStatus;
  idempotencyKey: string;
}

/** What the player wrote — the inbound e-mail path's input (HD-03, tm 358). */
export interface CustomerMessageInput {
  ticketId: string;
  /** What the player wrote this time — for e-mail, the reply above the quote. */
  text: string;
  /** The whole e-mail text, when something was cut from `text` (tm 357). */
  textFull?: string | null;
  /** Sanitised at intake; masked here like the text. */
  html?: string | null;
  emailMessageId?: string | null;
  inReplyTo?: string | null;
  attachments?: TicketMessageAttachment[];
  /**
   * Who wrote it — the sender's customer record (tm 358). Omitted, the
   * ticket's own customer: the opening message of a ticket the sender opened.
   */
  authorCustomerId?: string | null;
  /** The sender is not the ticket's player (HD-03): kept, and flagged for the console. */
  senderMismatch?: boolean;
  /**
   * Whether a `solved` ticket may go back to `open` (default true) — false when
   * the sender is past the hourly reopening limit, which keeps the message and
   * leaves the status. A `pending` ticket moves to `open` either way: that is
   * the conversation's ordinary turn, not a reopening.
   */
  allowReopen?: boolean;
}

/** The realtime notice to send once the transaction has committed. */
export interface TicketMessagePush {
  audience: PushAudience;
  payload: TicketMessageCreatedPush;
}

export interface WrittenTicketMessage {
  message: TicketMessageView;
  /** The key (or Message-ID) had been seen before: nothing was written, this is what was. */
  replayed: boolean;
  /** Null on a replay, and when the ticket has nobody to tell. */
  push: TicketMessagePush | null;
  /**
   * The e-mail to send once the transaction has committed — only for a reply
   * just stored `queued`. Never on a note, a replay or a `suppressed` reply.
   */
  outbound?: TicketReplyOutbound | null;
}

/** How this deployment mails ticket replies (tm 356.3). */
export interface TicketMailSettings {
  /** `TICKET_MAIL_OUTBOUND` (K23). Off, a reply is stored `suppressed`. */
  outbound: boolean;
  /** The right-hand side of the `Message-ID`s replies go out under. */
  messageIdDomain: string;
}

/** A queued reply's e-mail, as the route hands it to `app.backgroundMail`. */
export interface TicketReplyOutbound {
  /** The `ticket_messages` row whose `delivery_status` the send settles. */
  messageId: string;
  ticketId: string;
  ticketSubject: string;
  to: string;
  /** The reply as stored — masked. */
  body: string;
  agentName: string | null;
  workspaceName: string;
  emailMessageId: string;
  inReplyTo: string | null;
  references: string[];
}

/** The realtime notice of a reply's new `delivery_status`. */
export interface TicketDeliveryPush {
  audience: PushAudience;
  payload: TicketMessageDeliveryChangedPush;
}

/** The longest `References` a reply carries: the thread's first id and its newest. */
const REFERENCES_MAX = 10;

/** Opening a sensitive file a player e-mailed (RL-02 · tm 357 · HD-02). */
export const SENSITIVE_DOCUMENTS_CAPABILITY = 'customers.documents.view' as const;

export interface CustomerMessageResult extends WrittenTicketMessage {
  /** A `solved` ticket the player wrote to again — HD-03 says so in the thread. */
  reopened: boolean;
}

export interface TicketMessagePage {
  items: TicketMessageView[];
  nextPageId?: string;
}

/** A message row as the raw reads return it. */
interface MessageRow {
  id: string;
  ticketId: string;
  kind: string;
  authorType: string;
  authorId: string | null;
  bodyText: string;
  bodyTextFull: string | null;
  bodyHtml: string | null;
  attachments: unknown;
  deliveryStatus: string | null;
  senderMismatch: boolean;
  createdAt: Date;
}

/** Who writes, and under which masking policy. */
interface Author {
  type: 'agent' | 'bot';
  /** The account for an agent; a bot's message carries none (the contract says so). */
  id: string | null;
}

/**
 * Every column of a message, with `created_at` cut to the millisecond — the
 * precision the keyset cursor can carry (a JS `Date`). Ordering and comparing
 * on the same truncated value is what keeps a page boundary from repeating or
 * skipping a row written in the same millisecond as the cursor's.
 */
const MESSAGE_COLUMNS = Prisma.sql`
  id, ticket_id AS "ticketId", kind, author_type AS "authorType", author_id AS "authorId",
  body_text AS "bodyText", body_text_full AS "bodyTextFull", body_html AS "bodyHtml", attachments,
  delivery_status AS "deliveryStatus", sender_mismatch AS "senderMismatch",
  date_trunc('milliseconds', created_at) AS "createdAt"`;

export class TicketMessageService {
  readonly #mail: TicketMailSettings;

  /** Without settings ticket e-mail is off: every reply is stored `suppressed`. */
  constructor(mail: TicketMailSettings = { outbound: false, messageIdDomain: 'siyahtus.invalid' }) {
    this.#mail = mail;
  }

  /**
   * A page of the thread, oldest first (`(created_at, id)` keyset).
   *
   * Visibility is the ticket's own: a ticket the caller may not read is the
   * same `404` `GET /tickets/{id}` gives. A primary's page interleaves the
   * messages of the tickets merged into it — a merge is the decision that they
   * are one conversation, taken by someone who could see both — while a merged
   * ticket's own thread reads only what was written on it.
   */
  async list(
    tx: TenantClient,
    principal: Principal,
    ticketId: string,
    options: { limit?: number; pageId?: string } = {},
  ): Promise<TicketMessagePage> {
    const limit = options.limit ?? TICKET_MESSAGE_PAGE_SIZE;
    const cursor = options.pageId === undefined ? null : decodeCursor(options.pageId);

    const visibility = await resolveVisibility(tx, principal, 'read');
    const ticket = await loadVisible(tx, visibility, ticketId);
    const ticketIds = [ticket.id];
    if (!ticket.mergedIntoId) {
      const merged = await tx.ticket.findMany({
        where: { mergedIntoId: ticket.id },
        select: { id: true },
      });
      ticketIds.push(...merged.map((row) => row.id));
    }

    const rows = await tx.$queryRaw<MessageRow[]>`
      SELECT ${MESSAGE_COLUMNS}
      FROM ticket_messages
      WHERE ticket_id = ANY(${ticketIds}::varchar[])
        ${
          cursor
            ? Prisma.sql`AND (date_trunc('milliseconds', created_at), id) > (${cursor.createdAt}::timestamptz, ${cursor.id}::uuid)`
            : Prisma.empty
        }
      ORDER BY date_trunc('milliseconds', created_at), id
      LIMIT ${limit + 1}
    `;

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const names = await authorNames(tx, page);
    const last = page.at(-1);
    // A sensitive file is listed for everyone who reads the thread — that a
    // document came is part of the conversation — but drawn locked for a role
    // that may not open it (tm 357), the answer the download would give.
    const mayOpen = hasCapability(principal, SENSITIVE_DOCUMENTS_CAPABILITY);
    return {
      items: page.map((row) => withLocks(toView(row, names), mayOpen)),
      ...(hasMore && last ? { nextPageId: encodeCursor(last) } : {}),
    };
  }

  /**
   * An agent's reply or note (`POST /tickets/{id}/messages`).
   *
   * The ticket row is locked first and every decision is taken on what the
   * lock returned: a merge, a status change or a second reply committing in
   * between would otherwise slip a message onto a ticket that had just been
   * merged, or stamp a first response twice. The lock also serialises two
   * attempts with the same key on the same ticket, so the second one reads the
   * first one's row rather than racing it.
   */
  async createFromComposer(
    tx: TenantClient,
    tenant: TenantContext,
    principal: Principal,
    audit: AuditContext,
    ticketId: string,
    input: ComposerInput,
  ): Promise<WrittenTicketMessage> {
    const visibility = await resolveVisibility(tx, principal, 'write');
    await lockTicket(tx, ticketId);
    const ticket = await loadVisible(tx, visibility, ticketId);
    const author = authorOf(principal);

    // Before the merge check on purpose: a retry of a reply that went through
    // must answer with that reply even if the ticket was merged since.
    const seen = await this.#replay(tx, tenant, input.idempotencyKey, ticket.id, author);
    if (seen) return { message: seen, replayed: true, push: null };

    if (ticket.mergedIntoId) {
      throw new ApiError('ticket_merged', 'This ticket was merged; write on its primary ticket.', {
        details: { primary_ticket_id: ticket.mergedIntoId },
      });
    }

    const kind: TicketMessageKind = input.kind === 'reply' ? 'agent_reply' : 'internal_note';
    // A reply is an e-mail to the player; with no address there is nobody to
    // send it to, and storing it would show the agent an answer nobody gets.
    // A note goes nowhere, so it needs no recipient.
    if (kind === 'agent_reply' && !ticket.customer?.email?.trim()) {
      throw new ApiError('ticket_no_recipient', 'The player left no e-mail address to reply to.');
    }

    const now = new Date();
    const id = randomUUID();
    const text = maskForWrite(input.text, author.type).text;
    // A note never gets this far into the mail path: no status, no Message-ID,
    // no thread — the CHECK would refuse any of them, and nothing is returned
    // to send. A reply is `queued` only when this deployment mails replies.
    const mails = kind === 'agent_reply' && this.#mail.outbound;
    const deliveryStatus: TicketMessageDeliveryStatus | null =
      kind === 'agent_reply' ? (mails ? 'queued' : 'suppressed') : null;
    const emailMessageId = mails ? `${randomUUID()}@${this.#mail.messageIdDomain}` : null;
    const thread = mails ? await threadOf(tx, ticket.id) : [];
    const inReplyTo = thread.at(-1) ?? null;

    const inserted = await tx.$queryRaw<Array<{ id: string }>>`
      INSERT INTO ticket_messages
        (id, license_id, ticket_id, kind, author_type, author_id, body_text,
         attachments, delivery_status, email_message_id, in_reply_to, idempotency_key, created_at)
      VALUES
        (${id}::uuid, ${tenant.licenseId}::bigint, ${ticket.id}, ${kind}, ${author.type},
         ${author.id}::uuid, ${text}, ${JSON.stringify(input.attachments)}::jsonb,
         ${deliveryStatus}, ${emailMessageId}, ${inReplyTo}, ${input.idempotencyKey},
         ${now}::timestamptz)
      ON CONFLICT (license_id, idempotency_key) DO NOTHING
      RETURNING id
    `;
    if (inserted.length === 0) {
      // The key was spent by a transaction this one waited on — on another
      // ticket, since this one is locked. A unique-violation error would have
      // aborted the transaction; `DO NOTHING` leaves it usable for the read.
      const raced = await this.#replay(tx, tenant, input.idempotencyKey, ticket.id, author);
      if (raced) return { message: raced, replayed: true, push: null };
      throw ApiError.internal('The message could not be stored.');
    }

    const nextStatus: TicketStatus | undefined =
      input.setStatus ?? (kind === 'agent_reply' ? 'pending' : undefined);
    const firstResponse = kind === 'agent_reply' && ticket.firstResponseAt === null;
    await tx.ticket.update({
      where: { id: ticket.id },
      data: {
        lastMessageAt: now,
        ...(kind === 'agent_reply'
          ? {
              lastAgentMessageAt: now,
              // Never moved once set — the lock is what makes reading it safe.
              // The first-response clock (HD-05) stops with it.
              ...(firstResponse ? { firstResponseAt: now, firstResponseDueAt: null } : {}),
            }
          : {}),
        ...(nextStatus !== undefined && nextStatus !== ticket.status ? { status: nextStatus } : {}),
      },
    });
    // Only an agent's reply stops the first-response clock — a note does not
    // (HD-05 · tm 360). Measured from the creation against the target of the
    // priority the ticket has now; a ticket opened from a chat is outside it.
    if (firstResponse && ticket.sourceChatId === null) {
      await evaluateSubject(tx, tenant, {
        subjectType: 'ticket',
        subjectId: ticket.id,
        target: 'first_response',
        startedAt: ticket.createdAt,
        stoppedAt: now,
        priority: ticket.priority,
      });
    }

    // The message, never its text (see `AUDIT_ACTIONS`).
    await writeAuditEntry(tx, audit, {
      action: kind === 'agent_reply' ? 'ticket.replied' : 'ticket.note_added',
      target: `ticket:${ticket.id}`,
      metadata: { message_id: id, attachments: input.attachments.length },
    });
    if (nextStatus !== undefined) {
      await writeTicketChangeAudit(tx, audit, ticket.id, ticket, { status: nextStatus });
      await stopResolutionClock(tx, tenant, ticket, nextStatus);
      // A note that solves an unanswered ticket stops its clock (and the
      // reverse resumes it); a reply has already stopped it for good.
      if (!firstResponse && nextStatus !== ticket.status) {
        await refreshFirstResponseDue(tx, tenant, { id: ticket.id });
      }
    }

    const names = author.id ? await accountNames(tx, [author.id]) : new Map<string, string>();
    const message: TicketMessageView = {
      id,
      ticket_id: ticket.id,
      kind,
      author_type: author.type,
      author_id: author.id,
      author_name: author.id ? (names.get(author.id) ?? null) : null,
      body_text: text,
      body_text_full: null,
      body_html: null,
      attachments: input.attachments,
      delivery_status: deliveryStatus,
      created_at: now.toISOString(),
    };
    const outbound: TicketReplyOutbound | null =
      mails && emailMessageId
        ? {
            messageId: id,
            ticketId: ticket.id,
            ticketSubject: ticket.subject,
            // Checked non-empty above, under the same lock.
            to: ticket.customer!.email!.trim(),
            body: text,
            agentName: message.author_name,
            workspaceName: await workspaceName(tx, tenant),
            emailMessageId,
            inReplyTo,
            references: referencesOf(thread),
          }
        : null;
    return { message, replayed: false, push: await pushFor(tx, ticket, message), outbound };
  }

  /**
   * "Try again" on a reply whose e-mail failed
   * (`POST /tickets/{id}/messages/{messageId}/resend`).
   *
   * The same message goes out again — same text, same `Message-ID`, threaded
   * on what came before it — to the address the player has now. Only a
   * `failed` reply moves, and the move is made under the ticket's lock, so two
   * presses send once: the second reads `queued` and is answered as it is. A
   * reply in any other state is answered as it is too; a `suppressed` one
   * stays so even after the switch is turned on, because mailing an answer
   * the agent wrote while ticket e-mail was off, at some later moment, is not
   * what "try again" asked for. With the switch off now, a failed reply
   * becomes `suppressed`.
   */
  async resend(
    tx: TenantClient,
    tenant: TenantContext,
    principal: Principal,
    ticketId: string,
    messageId: string,
  ): Promise<{
    message: TicketMessageView;
    outbound: TicketReplyOutbound | null;
    push: TicketDeliveryPush | null;
  }> {
    const visibility = await resolveVisibility(tx, principal, 'write');
    await lockTicket(tx, ticketId);
    const ticket = await loadVisible(tx, visibility, ticketId);
    const row = await tx.ticketMessage.findFirst({ where: { id: messageId, ticketId: ticket.id } });
    if (!row) throw ApiError.notFound('Message not found.');
    if (row.kind !== 'agent_reply') {
      throw ApiError.validation('message_id: only a reply is e-mailed; this one never was.');
    }
    const asIs = async () => ({
      message: toView(row, await authorNames(tx, [row])),
      outbound: null,
      push: null,
    });
    if (row.deliveryStatus !== 'failed') return asIs();

    const to = ticket.customer?.email?.trim();
    if (this.#mail.outbound && !to) {
      throw new ApiError('ticket_no_recipient', 'The player has no e-mail address any more.');
    }
    // Only a send gives `failed`, and only a queued reply is sent, so the id
    // it was sent under is there.
    const emailMessageId = row.emailMessageId;
    if (!emailMessageId) throw ApiError.internal('A failed reply has no Message-ID.');
    const next: TicketMessageDeliveryStatus = this.#mail.outbound ? 'queued' : 'suppressed';
    // Only from `failed`, as well as under the lock: should the row have moved
    // since it was read, the press is answered with where it stands now.
    const moved = await tx.ticketMessage.updateMany({
      where: { id: row.id, deliveryStatus: 'failed' },
      data: { deliveryStatus: next },
    });
    if (moved.count === 0) {
      const current = await tx.ticketMessage.findUniqueOrThrow({ where: { id: row.id } });
      return {
        message: toView(current, await authorNames(tx, [current])),
        outbound: null,
        push: null,
      };
    }
    const updated = { ...row, deliveryStatus: next };
    const message = toView(updated, await authorNames(tx, [updated]));
    const push = await deliveryPushFor(tx, ticket, row.id, next);
    if (next !== 'queued') return { message, outbound: null, push };

    const thread = await threadOf(tx, ticket.id, { before: row });
    return {
      message,
      push,
      outbound: {
        messageId: row.id,
        ticketId: ticket.id,
        ticketSubject: ticket.subject,
        to: to!,
        body: row.bodyText,
        agentName: message.author_name,
        workspaceName: await workspaceName(tx, tenant),
        emailMessageId,
        inReplyTo: row.inReplyTo,
        references: referencesOf(thread),
      },
    };
  }

  /**
   * How a queued reply's send went, written after it settled — in a
   * transaction of its own, since the request's committed long before.
   *
   * Only `queued` moves: a status written by anything else since (a resend
   * already queued it again and its own send settles it) is not overwritten
   * by a slower, older outcome. Returns the realtime notice to publish, or
   * null when nothing changed.
   */
  async recordDelivery(
    tx: TenantClient,
    messageId: string,
    status: 'sent' | 'failed',
  ): Promise<TicketDeliveryPush | null> {
    const moved = await tx.$queryRaw<Array<{ ticketId: string }>>`
      UPDATE ticket_messages SET delivery_status = ${status}
      WHERE id = ${messageId}::uuid AND delivery_status = 'queued'
      RETURNING ticket_id AS "ticketId"
    `;
    const ticketId = moved[0]?.ticketId;
    if (!ticketId) return null;
    const ticket = await tx.ticket.findUnique({
      where: { id: ticketId },
      select: { id: true, assigneeId: true, groupId: true },
    });
    return ticket ? deliveryPushFor(tx, ticket, messageId, status) : null;
  }

  /**
   * What the player wrote, on the ticket it belongs to (the inbound e-mail
   * path, HD-03 · tm 358). No principal: like `createFromEmail`, the licence is
   * the surrounding `withTenant`'s and the author is the ticket's customer.
   *
   * A merged ticket's message lands on its primary. A `pending` or `solved`
   * ticket goes back to `open` — the player is waiting on the team again; a
   * `closed` or `spam` one is left as it is, because what to do with mail to a
   * closed ticket (a new, related one) is the caller's decision, taken before
   * this is called. A redelivered e-mail — the same Message-ID — is one
   * message. The author is the sender's own customer record when the caller
   * names one (tm 358: a reply address can be forwarded), the ticket's otherwise.
   */
  async recordCustomerMessage(
    tx: TenantClient,
    tenant: TenantContext,
    audit: AuditContext,
    input: CustomerMessageInput,
  ): Promise<CustomerMessageResult> {
    let ticket = await lockedTicket(tx, input.ticketId);
    if (ticket.mergedIntoId) ticket = await lockedTicket(tx, ticket.mergedIntoId);

    if (input.emailMessageId) {
      const seen = await findByMessageId(tx, tenant, input.emailMessageId);
      if (seen) return { message: seen, replayed: true, push: null, reopened: false };
    }

    const now = new Date();
    const id = randomUUID();
    // Masked, then clipped (tm 357): clipped first, a card number cut at the
    // limit would no longer pass the Luhn check and stay partly in clear.
    const text = clipText(maskForWrite(input.text, 'customer').text, INBOUND_EMAIL_TEXT_MAX);
    const textFull = input.textFull
      ? clipText(maskForWrite(input.textFull, 'customer').text, INBOUND_EMAIL_TEXT_MAX)
      : null;
    const html = maskForWrite(input.html ?? null, 'customer').text;
    const attachments = input.attachments ?? [];
    const authorId =
      input.authorCustomerId === undefined ? ticket.customerId : input.authorCustomerId;
    const senderMismatch = input.senderMismatch === true;

    // No conflict target: the one unique key a player's message can collide on
    // is its Message-ID (it carries no idempotency key).
    const inserted = await tx.$queryRaw<Array<{ id: string }>>`
      INSERT INTO ticket_messages
        (id, license_id, ticket_id, kind, author_type, author_id, body_text, body_text_full,
         body_html, attachments, email_message_id, in_reply_to, sender_mismatch, created_at)
      VALUES
        (${id}::uuid, ${tenant.licenseId}::bigint, ${ticket.id}, 'customer_message', 'customer',
         ${authorId}::uuid, ${text}, ${textFull}, ${html},
         ${JSON.stringify(attachments)}::jsonb, ${input.emailMessageId ?? null},
         ${input.inReplyTo ?? null}, ${senderMismatch}, ${now}::timestamptz)
      ON CONFLICT DO NOTHING
      RETURNING id
    `;
    if (inserted.length === 0) {
      const raced = input.emailMessageId
        ? await findByMessageId(tx, tenant, input.emailMessageId)
        : null;
      if (raced) return { message: raced, replayed: true, push: null, reopened: false };
      throw ApiError.internal('The message could not be stored.');
    }

    const reopened = ticket.status === 'solved' && input.allowReopen !== false;
    const reopen = ticket.status === 'pending' || reopened;
    await tx.ticket.update({
      where: { id: ticket.id },
      data: {
        lastMessageAt: now,
        lastCustomerMessageAt: now,
        ...(reopen ? { status: 'open' } : {}),
      },
    });
    if (reopen) {
      await writeTicketChangeAudit(tx, audit, ticket.id, ticket, { status: 'open' });
    }
    // A solved ticket nobody answered resumes its first-response clock from its
    // creation — reopening does not reset it (HD-05).
    if (reopened && ticket.firstResponseAt === null) {
      await refreshFirstResponseDue(tx, tenant, { id: ticket.id });
    }

    const customer = authorId
      ? await tx.customer.findUnique({ where: { id: authorId }, select: { name: true } })
      : null;
    const message: TicketMessageView = {
      id,
      ticket_id: ticket.id,
      kind: 'customer_message',
      author_type: 'customer',
      author_id: authorId,
      author_name: customer?.name ?? null,
      body_text: text,
      body_text_full: textFull,
      body_html: html,
      attachments,
      delivery_status: null,
      ...(senderMismatch ? { sender_mismatch: true as const } : {}),
      created_at: now.toISOString(),
    };
    return { message, replayed: false, push: await pushFor(tx, ticket, message), reopened };
  }

  /**
   * A line the product writes on a ticket (`kind: system`) — for the inbound
   * path, which files of the player's mail were not kept and why (tm 357), and
   * since tm 358 what a player's answer did to the ticket: reopened it, opened
   * a related one, arrived as an automatic reply.
   *
   * Written a millisecond after `after` when one is given, so it reads under
   * the message it is about rather than racing it for the same
   * `(created_at, id)` slot. Not masked: the product wrote it — but what it
   * quotes (a file's name, an auto-reply's text) the caller has masked. No push
   * of its own: it lands with the message whose push already sends the thread
   * to be re-read. An automatic reply kept as a line carries its Message-ID, so
   * a redelivery of it is recognised like any other mail.
   */
  async recordSystemNote(
    tx: TenantClient,
    tenant: TenantContext,
    ticketId: string,
    text: string,
    options: { after?: Date; emailMessageId?: string | null; inReplyTo?: string | null } = {},
  ): Promise<string> {
    const id = randomUUID();
    const at = options.after ? new Date(options.after.getTime() + 1) : new Date();
    await tx.$executeRaw`
      INSERT INTO ticket_messages
        (id, license_id, ticket_id, kind, author_type, body_text, email_message_id, in_reply_to,
         created_at)
      VALUES
        (${id}::uuid, ${tenant.licenseId}::bigint, ${ticketId}, 'system', 'system', ${text},
         ${options.emailMessageId ?? null}, ${options.inReplyTo ?? null}, ${at}::timestamptz)
    `;
    return id;
  }

  /**
   * The file `key` on message `messageId` of ticket `ticketId`, if this caller
   * may open it (`GET …/attachments/{key}` · tm 357 · HD-02).
   *
   * The ticket decides first, as for its thread: one the caller may not read is
   * `404`. Then the file has to be one of *this* message's — the key alone
   * proves nothing — still kept, and scanned clean. A sensitive file needs
   * `customers.documents.view` (`403` otherwise) and its opening is written to
   * the audit log, in this transaction: the entry names the ticket, the message
   * and the key, never the file's name, which can itself be personal data
   * ("kimlik_ali_veli.jpg").
   */
  async openAttachment(
    tx: TenantClient,
    principal: Principal,
    audit: AuditContext,
    ticketId: string,
    messageId: string,
    key: string,
  ): Promise<TicketMessageAttachment> {
    const visibility = await resolveVisibility(tx, principal, 'read');
    const ticket = await loadVisible(tx, visibility, ticketId);
    const row = UUID_RE.test(messageId)
      ? await tx.ticketMessage.findFirst({
          where: { id: messageId, ticketId: ticket.id },
          select: { attachments: true },
        })
      : null;
    const attachments = Array.isArray(row?.attachments)
      ? (row.attachments as unknown as TicketMessageAttachment[])
      : [];
    const file = attachments.find((entry) => entry.key === key);
    if (!file || file.purged || file.scan_status !== 'clean') {
      throw ApiError.notFound('Attachment not found.');
    }
    if (file.sensitive) {
      requireCapability(principal, SENSITIVE_DOCUMENTS_CAPABILITY);
      await writeAuditEntry(tx, audit, {
        action: 'ticket.attachment_opened',
        target: `ticket:${ticket.id}`,
        metadata: { message_id: messageId, key },
      });
    }
    return file;
  }

  /**
   * The message an idempotency key already stored, or null when the key is
   * fresh. The key is the composer's claim that two requests are one attempt,
   * so it has to be the *same* attempt: a key that comes back naming another
   * ticket or another author is a client bug, refused rather than answered with
   * somebody else's message.
   */
  async #replay(
    tx: TenantClient,
    tenant: TenantContext,
    key: string,
    ticketId: string,
    author: Author,
  ): Promise<TicketMessageView | null> {
    // Through the client rather than `MESSAGE_COLUMNS`: a `Date` read back is
    // already cut to the millisecond, and the row's field names are the same.
    const row = await tx.ticketMessage.findUnique({
      where: { licenseId_idempotencyKey: { licenseId: tenant.licenseId, idempotencyKey: key } },
    });
    if (!row) return null;
    if (row.ticketId !== ticketId || row.authorType !== author.type || row.authorId !== author.id) {
      throw ApiError.validation('idempotency_key: already used for a different message.');
    }
    return toView(row, await authorNames(tx, [row]));
  }
}

/**
 * Resolve the composer's `attachment_keys` to the files they name — before the
 * transaction opens, because the store may be a bucket across the network and
 * nothing about a file needs a row lock held while it answers.
 *
 * The rule `assertUploadedAttachment` holds for a chat event, for the same
 * reason: a key must be one of this licence's own uploads and its bytes must
 * be there — a grant is permission to upload, not permission to claim. One
 * message for every refusal, so probing another workspace's keys learns
 * nothing. A stored file has already passed the virus scan (`PUT /uploads`
 * scans before it writes), so it is `clean`. Its name is its key: the upload
 * drops the original filename on purpose (`buildKey`).
 */
export async function resolveAttachments(
  store: ObjectStore,
  licenseId: bigint,
  keys: readonly string[],
): Promise<TicketMessageAttachment[]> {
  const refuse = (): never => {
    throw ApiError.validation(
      'attachment_keys: every key must be a file this workspace uploaded through /uploads.',
    );
  };
  if (keys.some((key) => licenseOfKey(key) !== licenseId)) refuse();
  const files = await Promise.all(keys.map((key) => store.stat(key)));
  return keys.map((key, index) => {
    const file = files[index] ?? refuse();
    return {
      key,
      name: key,
      size: file.sizeBytes,
      mime: file.contentType,
      scan_status: 'clean',
      sensitive: false,
    };
  });
}

function authorOf(principal: Principal): Author {
  if (principal.kind === 'agent') return { type: 'agent', id: principal.accountId };
  if (principal.kind === 'bot') return { type: 'bot', id: null };
  // `resolveVisibility` refuses every other principal before this is reached.
  throw ApiError.authorization('Only agents and bots write on tickets.');
}

/** `SELECT … FOR UPDATE` on the ticket — absent (or another tenant's) locks nothing. */
async function lockTicket(tx: TenantClient, ticketId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM tickets WHERE id = ${ticketId} FOR UPDATE`;
}

/** The ticket, locked and read fresh, for the paths with no principal to resolve. */
async function lockedTicket(tx: TenantClient, ticketId: string) {
  await lockTicket(tx, ticketId);
  const ticket = await tx.ticket.findUnique({ where: { id: ticketId } });
  if (!ticket) throw ApiError.notFound('Ticket not found.');
  return ticket;
}

/**
 * The ticket a player's answer belongs on, locked (the inbound path, tm 358):
 * `ticketId`'s primary when it was merged — one hop, a merge refuses chains —
 * with the address of each player it could be from. Null when the ticket is
 * not this licence's (RLS) or no longer there. Locked first, so the status the
 * caller decides on is the one the write will find.
 */
export async function lockedReplyTarget(tx: TenantClient, ticketId: string) {
  const read = async (id: string) => {
    await lockTicket(tx, id);
    return tx.ticket.findUnique({
      where: { id },
      include: { customer: { select: { email: true } } },
    });
  };
  const matched = await read(ticketId);
  if (!matched) return null;
  const primary = matched.mergedIntoId ? await read(matched.mergedIntoId) : matched;
  if (!primary) return null;
  return {
    ticket: primary,
    /** Who writes on it as its player: the primary's, and the merged ticket's it was found by. */
    playerEmails: [primary.customer?.email, matched.customer?.email].filter(
      (email): email is string => Boolean(email?.trim()),
    ),
  };
}

async function findByMessageId(
  tx: TenantClient,
  tenant: TenantContext,
  emailMessageId: string,
): Promise<TicketMessageView | null> {
  const row = await tx.ticketMessage.findUnique({
    where: { licenseId_emailMessageId: { licenseId: tenant.licenseId, emailMessageId } },
  });
  return row ? toView(row, await authorNames(tx, [row])) : null;
}

/**
 * Who hears of a new message: the ticket's assignee, its followers and its
 * team — the people already working it. Null when that is nobody, which the
 * publisher would refuse anyway.
 */
async function pushFor(
  tx: TenantClient,
  ticket: PushTicket,
  message: TicketMessageView,
): Promise<TicketMessagePush | null> {
  const audience = await audienceOf(tx, ticket);
  if (!audience) return null;
  return {
    audience,
    payload: {
      ticket_id: ticket.id,
      message_id: message.id,
      kind: message.kind,
      author_type: message.author_type,
      author_id: message.author_id,
      created_at: message.created_at,
    },
  };
}

/** A reply's new delivery status, to the same people as its creation. */
async function deliveryPushFor(
  tx: TenantClient,
  ticket: PushTicket,
  messageId: string,
  status: TicketMessageDeliveryStatus,
): Promise<TicketDeliveryPush | null> {
  const audience = await audienceOf(tx, ticket);
  if (!audience) return null;
  return {
    audience,
    payload: { ticket_id: ticket.id, message_id: messageId, delivery_status: status },
  };
}

type PushTicket = { id: string; assigneeId: string | null; groupId: bigint | null };

async function audienceOf(tx: TenantClient, ticket: PushTicket): Promise<PushAudience | null> {
  const followers = await tx.ticketFollower.findMany({
    where: { ticketId: ticket.id },
    select: { accountId: true },
  });
  const agentIds = [
    ...new Set(
      [ticket.assigneeId, ...followers.map((row) => row.accountId)].filter(
        (id): id is string => id !== null,
      ),
    ),
  ];
  const audience: PushAudience = {
    ...(agentIds.length > 0 ? { agentIds } : {}),
    ...(ticket.groupId !== null ? { groupIds: [Number(ticket.groupId)] } : {}),
  };
  return audience.agentIds || audience.groupIds ? audience : null;
}

/**
 * The `Message-ID`s a reply threads on, oldest first: every message of the
 * ticket — and of the tickets merged into it, which are the same conversation
 * — that went out or came in by e-mail, up to `before` when a resend rebuilds
 * the thread its reply first went out on. Without brackets; an id a header
 * could not carry (a player's mail server wrote it) is skipped rather than
 * threaded on.
 */
async function threadOf(
  tx: TenantClient,
  ticketId: string,
  options: { before?: { id: string; createdAt: Date } } = {},
): Promise<string[]> {
  const before = options.before;
  const rows = await tx.$queryRaw<Array<{ emailMessageId: string }>>`
    SELECT email_message_id AS "emailMessageId"
    FROM ticket_messages
    WHERE ticket_id IN (SELECT ${ticketId} UNION SELECT id FROM tickets WHERE merged_into_id = ${ticketId})
      AND email_message_id IS NOT NULL
      ${
        before
          ? Prisma.sql`AND (date_trunc('milliseconds', created_at), id) < (${before.createdAt}::timestamptz, ${before.id}::uuid)`
          : Prisma.empty
      }
    ORDER BY date_trunc('milliseconds', created_at), id
  `;
  // An inbound id may have been kept as the header wrote it, brackets and all.
  return rows.map((row) => row.emailMessageId.trim().replace(/^<(.*)>$/, '$1')).filter(isMessageId);
}

/** `References` for a thread: all of it, or its first id and its newest when it is long. */
function referencesOf(thread: readonly string[]): string[] {
  if (thread.length <= REFERENCES_MAX) return [...thread];
  return [thread[0]!, ...thread.slice(-(REFERENCES_MAX - 1))];
}

/** The name a reply is sent under — the workspace's, as the ticket notice signs. */
async function workspaceName(tx: TenantClient, tenant: TenantContext): Promise<string> {
  const organization = await tx.organization.findUnique({
    where: { id: tenant.organizationId },
    select: { name: true },
  });
  return organization?.name ?? 'SiyahTuş';
}

/** The agents' and players' names for a page, two queries whatever its length. */
async function authorNames(tx: TenantClient, rows: MessageRow[]): Promise<Map<string, string>> {
  const agents = rows.filter((row) => row.authorType === 'agent').map((row) => row.authorId);
  const customers = [
    ...new Set(
      rows
        .filter((row) => row.authorType === 'customer' && row.authorId !== null)
        .map((row) => row.authorId as string),
    ),
  ];
  const [agentNames, customerRows] = await Promise.all([
    accountNames(tx, agents),
    customers.length > 0
      ? tx.customer.findMany({ where: { id: { in: customers } }, select: { id: true, name: true } })
      : Promise.resolve([]),
  ]);
  for (const customer of customerRows) {
    if (customer.name) agentNames.set(customer.id, customer.name);
  }
  return agentNames;
}

/** `message` with its sensitive files marked `locked` when the caller may not open them. */
function withLocks(message: TicketMessageView, mayOpen: boolean): TicketMessageView {
  if (mayOpen || !message.attachments.some((file) => file.sensitive)) return message;
  return {
    ...message,
    attachments: message.attachments.map((file) =>
      file.sensitive ? { ...file, locked: true } : file,
    ),
  };
}

function toView(row: MessageRow, names: Map<string, string>): TicketMessageView {
  return {
    id: row.id,
    ticket_id: row.ticketId,
    kind: row.kind as TicketMessageKind,
    author_type: row.authorType as TicketMessageAuthorType,
    author_id: row.authorId,
    author_name: row.authorId ? (names.get(row.authorId) ?? null) : null,
    body_text: row.bodyText,
    body_text_full: row.bodyTextFull,
    body_html: row.bodyHtml,
    attachments: Array.isArray(row.attachments)
      ? (row.attachments as TicketMessageAttachment[])
      : [],
    delivery_status: row.deliveryStatus as TicketMessageDeliveryStatus | null,
    ...(row.senderMismatch ? { sender_mismatch: true as const } : {}),
    created_at: row.createdAt.toISOString(),
  };
}

interface Cursor {
  createdAt: Date;
  id: string;
}

/** `<epoch ms>.<id>`, base64url — opaque to the client, checked on the way back. */
function encodeCursor(row: MessageRow): string {
  return Buffer.from(`${row.createdAt.getTime()}.${row.id}`, 'utf8').toString('base64url');
}

function decodeCursor(pageId: string): Cursor {
  const decoded = Buffer.from(pageId, 'base64url').toString('utf8');
  const match = /^(\d{1,15})\.(.+)$/.exec(decoded);
  const createdAt = match ? new Date(Number(match[1])) : null;
  if (!match || !createdAt || Number.isNaN(createdAt.getTime()) || !UUID_RE.test(match[2]!)) {
    throw ApiError.validation('page_id: not a page this endpoint issued.');
  }
  return { createdAt, id: match[2]! };
}
