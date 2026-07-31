/**
 * Inbound email → ticket (FR-MOD-08.5.3).
 *
 * The asynchronous entry point into the inbox: a workspace forwards its support
 * mail to `<organization_id>@<inbound-domain>`, a provider parses each message
 * and calls the webhook, and this turns it into a ticket on the same core the
 * agent-facing routes write to (`TicketService`, Dilim 11).
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
}

export type InboundResult =
  | { status: 'created'; ticket_id: string }
  | { status: 'ignored'; reason: 'spam' };

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
 * The organization id carried by a forwarding address, or `null`.
 *
 * The address is `<organization_id>@<domain>`; the local part is the routing
 * key. The domain is not checked — the id is what maps to a workspace, and a
 * provider may rewrite the domain (subdomains, plus a display name) on the way
 * in. A `to` header with a display name or several recipients is tolerated by
 * pulling the address out and taking the first one.
 */
export function recipientOrganizationId(to: string): string | null {
  const first = to.split(',')[0] ?? '';
  const angle = /<([^>]+)>/.exec(first);
  const address = (angle ? (angle[1] ?? '') : first).trim();
  const localPart = address.split('@')[0]?.trim().toLowerCase();
  if (!localPart) return null;
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuid.test(localPart) ? localPart : null;
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
  const spamFilterOn = await isSpamFilterEnabled(tx, tenant.licenseId);
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
  });
  return { status: 'created', ticket_id: ticket.id };
}
