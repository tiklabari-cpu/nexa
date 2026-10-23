/**
 * Direct lookup by number, e-mail or username — `GET /search` (ID-06 · tm 332).
 *
 * "Look at this number" has to open the conversation in a couple of seconds
 * whenever it happened. The palette used to match chats in the browser against
 * the fifty newest it had fetched; here the server looks the value up, so a
 * number from last month is found the same way as one from this morning.
 *
 * The value's shape picks the plan (`searchShape`, `@siyahtus/types`):
 *
 *   event    → the message, through its connection (the number carries it)
 *   short_id → the day (`chats.id`), the connection (`threads.id`) and the
 *              ticket with that number — a chance collision returns each —
 *              and then the text search, since a ten-character number is
 *              also a plausible username
 *   uuid     → the member
 *   email    → the members with exactly that address
 *   text     → members (exact username first, then the Contacts search) and
 *              tickets (the Tickets search)
 *
 * Two rules hold every result:
 *
 * - **Visibility is the record's own.** A conversation goes through
 *   `chatVisibilityFilter` in the query itself, a ticket through
 *   `TicketService.get`/`list`. A number the caller may not open produces no
 *   row — the same answer as a number that does not exist (ID-06-S1, NFR-S5),
 *   so the endpoint cannot be used to learn which numbers are real.
 * - **A masked caller searches no contact field.** Without
 *   `customers.contact.view` (RL-02-S2, tm 325.6) a member's e-mail and
 *   username are null on the row *and* never matched: a hit on a value the
 *   row does not show would still confirm it.
 *
 * Each kind is also gated on its own read scope, so a token that reads tickets
 * but not customers finds tickets and nothing else.
 */
import type { Prisma } from '@prisma/client';
import {
  hasAnyScope,
  parseEventId,
  searchShape,
  type SearchKind,
  type SearchMatchedOn,
  type SearchResult,
} from '@siyahtus/types';
import { ApiError } from '../../lib/api-error.js';
import type { TenantClient, TenantContext } from '../../lib/tenant.js';
import type { Principal } from '../auth/principal.js';
import { chatVisibilityFilter, hasChatScope, resolveVisibility } from '../chat/access.js';
import type { ChatVisibility } from '../chat/access.js';
import { CustomerService } from '../customers/customer-service.js';
import { seesPlayerContact } from '../customers/player-contact.js';
import { TicketService } from '../tickets/ticket-service.js';

export const CUSTOMER_READ_SCOPES = ['customers:ro', 'customers:rw'];
export const TICKET_READ_SCOPES = ['tickets--all:ro', 'tickets--access:ro', 'tickets--all:rw'];

const CONVERSATION_KINDS: readonly SearchKind[] = ['chat', 'connection', 'event'];

export interface SearchInput {
  query: string;
  kinds: ReadonlySet<SearchKind>;
  limit: number;
}

/**
 * The exact-username lookup — equality on the folded, generated column, the
 * one form of this search an index serves under row level security (`texteq`
 * is leakproof; `lower(btrim(…))` folds the parameter, not the column). The
 * plan is pinned by `search.test.ts` (EXPLAIN ANALYZE as `siyahtus_app`); a
 * prefix or `ILIKE` here would read the whole organization.
 */
export const EXACT_USERNAME_SQL = `SELECT id FROM customers
  WHERE organization_id = $1::uuid AND username_normalized = lower(btrim($2))
  ORDER BY last_activity_at DESC NULLS LAST, id DESC
  LIMIT $3`;

/**
 * The exact-address lookup. `citext` equality is not leakproof, so it reaches
 * the `(organization_id, email)` index on the organization and filters the
 * address — the cost `possibleMatches` and the inbound-mail lookup already pay.
 */
const EXACT_EMAIL_SQL = `SELECT id FROM customers
  WHERE organization_id = $1::uuid AND email = $2::citext
  ORDER BY last_activity_at DESC NULLS LAST, id DESC
  LIMIT $3`;

const CUSTOMER_SELECT = {
  id: true,
  name: true,
  email: true,
  username: true,
  phone: true,
  lastActivityAt: true,
} satisfies Prisma.CustomerSelect;

type CustomerRow = Prisma.CustomerGetPayload<{ select: typeof CUSTOMER_SELECT }>;

export class SearchService {
  readonly #customers = new CustomerService();
  readonly #tickets = new TicketService();

  async search(
    tx: TenantClient,
    tenant: TenantContext,
    principal: Principal,
    input: SearchInput,
  ): Promise<SearchResult[]> {
    const query = input.query.trim();
    const shape = searchShape(query);
    const wants = (kind: SearchKind): boolean => input.kinds.has(kind);

    // Agents and bots only — the route's principals; anything else finds nothing.
    if (principal.kind !== 'agent' && principal.kind !== 'bot') return [];
    const conversations = CONVERSATION_KINDS.some(wants) && hasChatScope(principal, 'read');
    const customers = wants('customer') && hasAnyScope(principal.scopes, CUSTOMER_READ_SCOPES);
    const tickets = wants('ticket') && hasAnyScope(principal.scopes, TICKET_READ_SCOPES);
    const contactVisible = seesPlayerContact(principal);

    const found = new ResultList(input.limit);

    // The team list is read only when a wanted conversation kind can match.
    const conversationLookup =
      shape === 'event'
        ? wants('event')
        : shape === 'short_id' && (wants('chat') || wants('connection'));
    if (conversations && conversationLookup) {
      const visibility = await resolveVisibility(tx, principal, 'read');
      if (shape === 'event' && wants('event')) {
        found.add(await findEvent(tx, visibility, query));
      }
      if (shape === 'short_id') {
        if (wants('chat')) found.add(await findDay(tx, visibility, query));
        if (wants('connection')) found.add(await findConnection(tx, visibility, query));
      }
    }

    if (tickets && shape === 'short_id') {
      found.add(await this.#ticketById(tx, principal, query));
    }

    if (customers && shape === 'uuid') {
      const row = await tx.customer.findFirst({
        where: { id: query, organizationId: tenant.organizationId },
        select: CUSTOMER_SELECT,
      });
      if (row) found.add(customerResult(row, 'customer_id', contactVisible));
    }

    if (customers && shape === 'email' && contactVisible) {
      for (const row of await customersByIds(
        tx,
        await idsOf(tx, EXACT_EMAIL_SQL, tenant.organizationId, query, input.limit),
      )) {
        found.add(customerResult(row, 'email', contactVisible));
      }
    }

    if (shape === 'text' || shape === 'short_id') {
      if (customers) {
        if (contactVisible) {
          for (const row of await customersByIds(
            tx,
            await idsOf(tx, EXACT_USERNAME_SQL, tenant.organizationId, query, input.limit),
          )) {
            found.add(customerResult(row, 'username', contactVisible));
          }
        }
        if (!found.full()) {
          const page = await this.#customers.list(tx, tenant, {
            query,
            segment: 'all',
            limit: input.limit,
            contactVisible,
          });
          for (const row of page.items) {
            found.add({
              kind: 'customer',
              customer_id: row.id,
              title: row.name ?? row.username ?? row.email,
              subtitle: row.email ?? row.phone,
              at: row.last_activity_at,
              matched_on: customerMatch(row, query),
            });
          }
        }
      }
      if (tickets && !found.full()) {
        const page = await this.#tickets.list(tx, tenant, principal, {
          view: 'all',
          query,
          limit: input.limit,
        });
        for (const ticket of page.items) {
          found.add({
            kind: 'ticket',
            ticket_id: ticket.id,
            ...(ticket.customer_id ? { customer_id: ticket.customer_id } : {}),
            title: ticket.subject,
            subtitle: ticket.customer_name,
            at: ticket.created_at,
            matched_on: ticketMatch(ticket, query),
          });
        }
      }
    }

    return found.items();
  }

  async #ticketById(
    tx: TenantClient,
    principal: Principal,
    id: string,
  ): Promise<SearchResult | null> {
    try {
      const ticket = await this.#tickets.get(tx, principal, id);
      return {
        kind: 'ticket',
        ticket_id: ticket.id,
        ...(ticket.customer_id ? { customer_id: ticket.customer_id } : {}),
        title: ticket.subject,
        subtitle: ticket.customer_name,
        at: ticket.created_at,
        matched_on: 'ticket_id',
      };
    } catch (error) {
      // Absent and not visible are one answer (`loadVisible`), and it is "no row".
      if (error instanceof ApiError && error.status === 404) return null;
      throw error;
    }
  }
}

/** Results in the order found, one per record, at most `limit`. */
class ResultList {
  readonly #seen = new Set<string>();
  readonly #items: SearchResult[] = [];

  constructor(readonly limit: number) {}

  add(result: SearchResult | null): void {
    if (!result || this.full()) return;
    const key = `${result.kind}:${result.event_id ?? result.thread_id ?? result.chat_id ?? result.ticket_id ?? result.customer_id}`;
    if (this.#seen.has(key)) return;
    this.#seen.add(key);
    this.#items.push(result);
  }

  full(): boolean {
    return this.#items.length >= this.limit;
  }

  items(): SearchResult[] {
    return this.#items;
  }
}

async function findDay(
  tx: TenantClient,
  visibility: ChatVisibility,
  id: string,
): Promise<SearchResult | null> {
  const chat = await tx.chat.findFirst({
    where: { id, ...chatVisibilityFilter(visibility) },
    select: { id: true, createdAt: true, customer: { select: { name: true } } },
  });
  if (!chat) return null;
  return {
    kind: 'chat',
    chat_id: chat.id,
    title: chat.customer.name,
    subtitle: null,
    at: chat.createdAt.toISOString(),
    matched_on: 'chat_id',
  };
}

async function visibleConnection(
  tx: TenantClient,
  visibility: ChatVisibility,
  id: string,
): Promise<{ id: string; chatId: string; createdAt: Date; name: string | null } | null> {
  const thread = await tx.thread.findFirst({
    where: { id, chat: chatVisibilityFilter(visibility) },
    select: {
      id: true,
      chatId: true,
      createdAt: true,
      chat: { select: { customer: { select: { name: true } } } },
    },
  });
  if (!thread) return null;
  return {
    id: thread.id,
    chatId: thread.chatId,
    createdAt: thread.createdAt,
    name: thread.chat.customer.name,
  };
}

async function findConnection(
  tx: TenantClient,
  visibility: ChatVisibility,
  id: string,
): Promise<SearchResult | null> {
  const thread = await visibleConnection(tx, visibility, id);
  if (!thread) return null;
  return {
    kind: 'connection',
    chat_id: thread.chatId,
    thread_id: thread.id,
    title: thread.name,
    subtitle: null,
    at: thread.createdAt.toISOString(),
    matched_on: 'thread_id',
  };
}

/**
 * The message, found through its connection: the number starts with the
 * connection's, so visibility is decided before the event table is touched,
 * and the event read is one connection's rows (`(thread_id, created_at)`).
 */
async function findEvent(
  tx: TenantClient,
  visibility: ChatVisibility,
  eventId: string,
): Promise<SearchResult | null> {
  const parsed = parseEventId(eventId);
  if (!parsed) return null;
  const thread = await visibleConnection(tx, visibility, parsed.threadId);
  if (!thread) return null;
  const event = await tx.event.findFirst({
    where: { id: eventId, threadId: thread.id },
    select: { createdAt: true },
  });
  if (!event) return null;
  return {
    kind: 'event',
    chat_id: thread.chatId,
    thread_id: thread.id,
    event_id: eventId,
    title: thread.name,
    subtitle: null,
    at: event.createdAt.toISOString(),
    matched_on: 'event_id',
  };
}

async function idsOf(
  tx: TenantClient,
  sql: string,
  organizationId: string,
  value: string,
  limit: number,
): Promise<string[]> {
  const rows = await tx.$queryRawUnsafe<Array<{ id: string }>>(sql, organizationId, value, limit);
  return rows.map((row) => row.id);
}

async function customersByIds(tx: TenantClient, ids: string[]): Promise<CustomerRow[]> {
  if (ids.length === 0) return [];
  const rows = await tx.customer.findMany({ where: { id: { in: ids } }, select: CUSTOMER_SELECT });
  const byId = new Map(rows.map((row) => [row.id, row]));
  return ids.flatMap((id) => byId.get(id) ?? []);
}

function customerResult(
  row: CustomerRow,
  matchedOn: SearchMatchedOn,
  contactVisible: boolean,
): SearchResult {
  const email = contactVisible ? row.email : null;
  const username = contactVisible ? row.username : null;
  return {
    kind: 'customer',
    customer_id: row.id,
    title: row.name ?? username ?? email,
    subtitle: email ?? row.phone,
    at: row.lastActivityAt?.toISOString() ?? null,
    matched_on: matchedOn,
  };
}

/**
 * Which field a Contacts-search row matched. Informational — the database
 * decided the match (`CustomerService#where`); this only names it, so the
 * folding here can be the plain one. The row's contact fields are already
 * null for a masked caller, so they are never named for one.
 */
function customerMatch(
  row: { name: string | null; username: string | null; email: string | null; phone: string | null },
  query: string,
): SearchMatchedOn {
  const needle = query.toLowerCase();
  if (row.username?.trim().toLowerCase().startsWith(needle)) return 'username';
  if (row.name?.toLowerCase().includes(needle)) return 'name';
  if (row.email?.toLowerCase().includes(needle)) return 'email';
  if (row.phone?.includes(query)) return 'phone';
  // The database folds a few letters JavaScript does not (Turkish İ); a name
  // matched that way lands here.
  return 'name';
}

function ticketMatch(
  ticket: { subject: string; customer_name: string | null; customer_email: string | null },
  query: string,
): SearchMatchedOn {
  const needle = query.toLowerCase();
  if (ticket.subject.toLowerCase().includes(needle)) return 'subject';
  if (ticket.customer_name?.toLowerCase().includes(needle)) return 'name';
  if (ticket.customer_email?.toLowerCase().includes(needle)) return 'email';
  return 'username';
}
