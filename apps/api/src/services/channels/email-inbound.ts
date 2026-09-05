/**
 * Inbound email → ticket (FR-MOD-08.5.3).
 *
 * The asynchronous entry point into the inbox: a workspace forwards its support
 * mail to one of its addresses — `<organization_id>@<inbound-domain>`, or a
 * labelled `<organization_id>+support@<inbound-domain>` — a provider parses each
 * message and calls the webhook, and this turns it into a ticket on the same
 * core the agent-facing routes write to (`TicketService`, Dilim 11).
 *
 * Two rules the tests pin down, because both are easy to get wrong and silent
 * when wrong:
 *
 *  - A sender who already exists as a customer is reused, not duplicated. Email
 *    is the natural key here; a second record would split one person's history
 *    across two rows the directory then shows as strangers.
 *  - A workspace with the spam filter on (the default) drops a message the
 *    provider flagged, rather than filling the queue with it. The filter is a
 *    per-workspace setting, so this reads it live inside the tenant.
 *
 * The recipient address is resolved to a tenant *before* this runs; everything
 * here is already inside that tenant's `withTenant`, so RLS confines every read
 * and write to the licence the address pointed at.
 */
import type { TenantClient, TenantContext } from '../../lib/tenant.js';
import { maskCardNumbers } from '../../lib/cc-mask.js';
import { evaluateSpam, isSpamFilterEnabled } from '../security/spam-filter.js';
import type { TicketService } from '../tickets/ticket-service.js';

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
}

export type InboundResult =
  { status: 'created'; ticket_id: string } | { status: 'ignored'; reason: 'spam' };

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

export async function ingestInboundEmail(
  tx: TenantClient,
  tenant: TenantContext,
  tickets: TicketService,
  email: InboundEmail,
): Promise<InboundResult> {
  // Mask a card number in the subject once (FR-MOD-08.9.5), up front — the same
  // value is what the spam classifier sees and what the ticket stores, so, as on
  // the widget path, no raw PAN is ever handed to the classifier.
  const maskedSubject = maskCardNumbers(email.subject);

  // The spam gate is the same engine the widget screens through (FR-MOD-08.9.3),
  // so the decision lives in one place rather than being reimplemented per
  // channel. The provider's own verdict is honoured, and the subject is run
  // through the deterministic content classifier as well — a message the
  // provider passed but whose subject is a content-spam flood is still dropped.
  // No row means the schema default, which is *on*, so an unconfigured workspace
  // still drops flagged spam rather than accepting it.
  const spamFilterOn = await isSpamFilterEnabled(tx);
  if (
    evaluateSpam({ filterEnabled: spamFilterOn, text: maskedSubject, providerFlagged: email.spam })
      .spam
  ) {
    return { status: 'ignored', reason: 'spam' };
  }

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

  const ticket = await tickets.createFromEmail(tx, tenant, {
    // The masked subject (computed above) is what the ticket stores and what the
    // triage rules see (FR-MOD-08.9.5).
    subject: maskedSubject,
    customerId,
    inboundAddressId: email.addressId,
  });
  return { status: 'created', ticket_id: ticket.id };
}
