# Task ID: 61

**Title:** 13.6-a — Omnichannel HelpDesk katmanı [MAX]

**Status:** done

**Dependencies:** None

**Priority:** low

**Description:** Chat↔ticket köprüsü + merge/priority/followers + audit. Başında bölünür. PRD 13.6 (Should).

**Details:**

13.6-a Omnichannel Ticketing / HelpDesk katmanı (merge/priority/followers). [MAX] ↑ PRD 13.6 (Should).
↑ GEREKÇE: ticket yaşam döngüsü + merge/unmerge veri bütünlüğü + audit. BAŞINDA BÖLÜNÜR (2+ pencere).
KAPSAM: chat↔ticket köprüsü; ticket yaşam döngüsü; merge/unmerge/followers/priority; birleşik (ayrı ürün değil).
KK (birebir): "Chat↔ticket köprüsü; ticket yaşam döngüsü; birleşik (ayrı ürün değil)". BAĞLAM: PLAN §4.4.14. Bağımlılık: ticketing (✅ Dilim 11).

**Test Strategy:**

integration: merge/unmerge invariant + audit. NOT: başında subtask'lara bölünmeli. DoD tam.

## Subtasks

### 61.1. Backend HelpDesk data-integrity layer — merge/unmerge + followers + priority + audit

**Status:** done  
**Dependencies:** None  

[MAX] core. Ticket lifecycle audit + chat↔ticket bridge exposure + merge/unmerge invariants (non-destructive pointer merge; no self/chain/cycle/cross-tenant; unmerge = perfect inverse) + followers add/remove + priority. Contract+types+migration+integration tests (merge/unmerge invariant + audit).

**Details:**

schema.prisma: add Ticket.priority (Int @default 0), Ticket.mergedIntoId (self-FK), TicketFollower(ticketId,accountId) model. Migration timestamped after 20260726150000. routes/tickets.ts: POST/DELETE /tickets/:id/merge, POST /tickets/:id/followers, DELETE /tickets/:id/followers/:accountId; priority via PATCH. ticket-service.ts: merge/unmerge/addFollower/removeFollower + audit emits (ticket.merged/unmerged/follower_added/follower_removed/priority_changed/status_changed) via writeAuditEntry in withTenant tx. AUDIT_ACTIONS += ticket.*. Contract: tickets.yaml paths + Ticket/TicketDetail schema fields (priority, followers, merged_into_id, merged_ticket_ids), regenerate, contract-parity green. Integration: merge/unmerge invariant + audit assertions in test/integration/tickets.test.ts (or tickets-helpdesk.test.ts).

### 61.2. Frontend HelpDesk surface — priority selector, followers, merge/unmerge actions in TicketPane

**Status:** done  
**Dependencies:** 61.1  

[XHIGH] follow-up. Wire the backend HelpDesk layer into apps/web: priority selector + followers add/remove + merge/unmerge action in TicketDetailPane; useTickets hooks; merged-child indication in the ticket list. Web unit tests + e2e smoke. Depends on 61.1.
