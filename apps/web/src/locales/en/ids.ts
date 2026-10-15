import type { Messages } from '../merge.js';

/**
 * Identifier names (ID-01, K1 = A — docs/adr/conversation-day-ids.md).
 *
 * The owner's "Thread ID" is the code's `chat_id` (the member's day) and the
 * owner's "Chat ID" is the code's `thread_id` (one connection). The two terms
 * stay English in every locale (ID-01-S1) with a short hint beside them, so
 * the `label` values are identical in `en` and `tr`; only the hints translate.
 *
 * This file is the only place the panel's source spells "Thread ID" / "Chat ID"
 * — `ids-glossary.test.ts` greps for it. A screen asks for `ids.<name>.label` /
 * `.hint`; `@siyahtus/types` `ID_GLOSSARY` names which key belongs to which
 * kind of number.
 */
export const ids: Messages = {
  'ids.thread.label': 'Thread ID',
  'ids.thread.hint': "The member's conversation group for today",
  'ids.chat.label': 'Chat ID',
  'ids.chat.hint': 'This connection',
  'ids.event.label': 'Message ID',
  'ids.event.hint': 'One message — starts with the Chat ID it belongs to',
  'ids.customer.label': 'Member ID',
  'ids.customer.hint': "The member's own number — technical, not for sharing",
  'ids.request.label': 'Request ID',
  'ids.request.hint': 'One server request — shown in error messages and logs',
  'ids.ticket.label': 'Ticket ID',
  'ids.ticket.hint': 'One ticket',
  'ids.aiDecision.label': 'AI decision ID',
  'ids.aiDecision.hint': 'One decision of the AI Agent',
};
