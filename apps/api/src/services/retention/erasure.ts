/**
 * Right to erasure — a targeted, single-subject hard delete (GDPR Art. 17,
 * the second half of NFR-C8).
 *
 * The periodic sweep next door (`retention.ts`) answers "is this old?". This
 * answers "did this person ask?". They share the requirement line and nothing
 * else, which is why they are separate modules rather than a flag on one: the
 * sweep is deployment-driven, tenant-looping, batched and reversible in the
 * sense that it only ever removes what a policy already condemned; this is one
 * named person, at a moment somebody chose, with nothing older or newer about
 * it.
 *
 * ## What goes, and why the FKs are not left to decide
 *
 * Deleting the `customers` row cascades to almost everything that identifies
 * the subject — `chats` (and through them `threads` → `events`, thread tags,
 * ratings, chat access), `visits`, `channel_identities`, `campaign_sends`,
 * `goal_achievements` and `custom_field_values` are all `ON DELETE CASCADE`.
 *
 * Two relations are `ON DELETE SET NULL`, and they are the interesting ones:
 *
 *   - **`tickets`** — deleted explicitly, before the customer. Left to the FK
 *     the ticket would survive with a null `customer_id`, still carrying the
 *     subject's own words in its `subject` line and whatever their custom
 *     fields held. Calling that "erased" would be untrue, and the untruth would
 *     be invisible: the contact is gone from the directory, so nobody would go
 *     looking. This is the one place the FK's answer is wrong for this
 *     operation and has to be overridden.
 *   - **`tracked_sales`** — left to the FK, i.e. unlinked and kept. A sale is
 *     the workspace's own accounting record, not a statement about the person:
 *     the amount, the currency and the order id stay true after the pointer to
 *     the customer is dropped, and deleting them would quietly rewrite revenue
 *     figures an invoice was already based on. Art. 17(3) makes exactly this
 *     carve-out; the schema's `SET NULL` already implements it, so the right
 *     move is to say so rather than to change it.
 *
 * The **audit log** is untouched and gains one entry. Two reasons, both
 * load-bearing: it is append-only to the application role by design (NFR-S12),
 * and the entry naming this erasure is the only evidence left that the request
 * was honoured. It carries the customer's id and the counts — never a name, an
 * e-mail, a phone number or a line of any message. With the record deleted that
 * uuid identifies nobody; it is a receipt number.
 *
 * ## Why an active conversation refuses
 *
 * The sweep will only ever prune a thread that is `active = false` and closed.
 * This holds the same invariant, and not as a coincidence: a live conversation
 * has an agent and a visitor on two open sockets, both holding the chat this
 * would delete out from under them, and the resulting 404s would reach the
 * visitor as a broken widget rather than as anything anyone chose. Closing the
 * conversation first costs one click and makes the erasure a complete act
 * instead of a partial one racing the person typing into it.
 *
 * ## Isolation (NFR-S4)
 *
 * Every statement runs on the caller's tenant-scoped client, so `customers`'
 * organization policy is what decides whether the id names anything at all —
 * another workspace's customer is simply not there, and the route answers 404
 * rather than 403 so an id cannot be probed for existence (NFR-S5).
 */
import { ApiError } from '../../lib/api-error.js';
import type { TenantClient } from '../../lib/tenant.js';

export interface ErasureReceipt {
  customerId: string;
  erasedAt: Date;
  chats: number;
  threads: number;
  events: number;
  visits: number;
  tickets: number;
  channelIdentities: number;
}

/**
 * Erase one data subject.
 *
 * Counts first, then deletes, in one transaction the caller supplies — the
 * counts are the receipt, and a receipt gathered after the rows are gone would
 * be all zeroes. `now` is a parameter so the receipt's instant and the audit
 * entry the caller writes cannot drift apart.
 */
export async function eraseCustomer(
  tx: TenantClient,
  customerId: string,
  now: Date,
): Promise<ErasureReceipt> {
  const customer = await tx.customer.findFirst({
    where: { id: customerId },
    select: { id: true },
  });
  if (!customer) throw ApiError.notFound('Customer not found.');

  // `active` on the chat, not on the thread: a chat is what the widget and the
  // inbox hold open, and a chat can be active while its newest thread is
  // between messages. Checked before anything is counted so a refusal costs one
  // query.
  const active = await tx.chat.count({ where: { customerId, active: true } });
  if (active > 0) {
    throw new ApiError(
      'not_allowed',
      'This person is in a live conversation. Close it first — erasing a chat while an agent and a visitor are both in it would break the conversation for them mid-sentence.',
      { details: { reason: 'active_chat', active_chats: active } },
    );
  }

  const chatIds = (await tx.chat.findMany({ where: { customerId }, select: { id: true } })).map(
    (chat) => chat.id,
  );

  // Counted through the chats rather than joined from the customer, because
  // `threads` and `events` carry no `customer_id` — the subject reaches them
  // only through the conversation. An empty `chatIds` short-circuits rather
  // than issuing `IN ()`.
  const threads = chatIds.length
    ? await tx.thread.count({ where: { chatId: { in: chatIds } } })
    : 0;
  const events = chatIds.length
    ? await tx.event.count({ where: { thread: { chatId: { in: chatIds } } } })
    : 0;
  const visits = await tx.visit.count({ where: { customerId } });
  const channelIdentities = await tx.channelIdentity.count({ where: { customerId } });

  // Explicit, and before the customer — see this file's header. RLS scopes it
  // to the caller's licence, which is also the licence whose console is
  // answering the request.
  const tickets = (await tx.ticket.deleteMany({ where: { customerId } })).count;

  // The cascade does the rest. Deleting the customer row is the single
  // statement RLS confines; everything the FKs reach from it belongs to that
  // row by construction, so there is no second WHERE clause to get wrong.
  await tx.customer.delete({ where: { id: customerId } });

  return {
    customerId,
    erasedAt: now,
    chats: chatIds.length,
    threads,
    events,
    visits,
    tickets,
    channelIdentities,
  };
}
