/**
 * Which row actions a live visitor offers (FR-MOD-03.1.3).
 *
 * Pure on purpose: whether **Start chat** / **Supervise** / **Assign to me** /
 * **Edit** apply to a given visitor is exactly the kind of state × permission
 * logic that is easy to get subtly wrong (an action offered on a browsing
 * visitor that has no chat to supervise, or offered to an agent who lacks the
 * scope to act), so it is decided here and tested in isolation rather than by
 * poking at the rendered table.
 *
 * Two dimensions decide each action:
 *   - the visitor's state — is there an active conversation to act on?
 *   - the caller's scopes — may they start/take a chat, watch one, edit a contact?
 *
 * An action that does not apply is returned `enabled: false` rather than
 * dropped, so the row's shape is stable and the button reads as "not right now"
 * (rapor-1 §MOD-03.1.3: "aksiyon pasif") instead of silently disappearing.
 */
import type { TrafficActivity } from './types.js';

export interface RowActionContext {
  /** May start a proactive chat and assign one to themselves (chat write). */
  canChatWrite: boolean;
  /** May open a conversation to observe it (chat read). */
  canChatRead: boolean;
  /** May open the contact record to edit it (customers write). */
  canEditCustomer: boolean;
}

export type RowActionId = 'start_chat' | 'supervise' | 'assign_to_me' | 'edit';

export interface RowAction {
  id: RowActionId;
  label: string;
  enabled: boolean;
}

export function visitorRowActions(
  visitor: { activity: TrafficActivity; chat_id: string | null },
  ctx: RowActionContext,
): RowAction[] {
  // The one fact the actions turn on: is there a live conversation to act on?
  const inConversation = visitor.chat_id !== null;

  return [
    // Proactive contact — only meaningful before a conversation exists.
    { id: 'start_chat', label: 'Start chat', enabled: !inConversation && ctx.canChatWrite },
    // Watch an ongoing conversation. A read, so it needs no write scope.
    { id: 'supervise', label: 'Supervise chat', enabled: inConversation && ctx.canChatRead },
    // Take the conversation over.
    { id: 'assign_to_me', label: 'Assign chat to me', enabled: inConversation && ctx.canChatWrite },
    // Edit the contact behind the row, whatever they are doing.
    { id: 'edit', label: 'Edit contact', enabled: ctx.canEditCustomer },
  ];
}
