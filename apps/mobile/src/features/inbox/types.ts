/**
 * Inbox shapes, taken from the contract rather than restated.
 *
 * The web app keeps hand-written interfaces for these (`apps/web/src/features/
 * inbox/types.ts`) — a duplicate that has to be edited whenever the schema
 * moves. §D96 put mobile in this monorepo precisely so it would not need a
 * second copy, so every type below is an alias into the generated contract: add
 * a field to `Event` in `openapi.yaml` and it appears here, rename one and
 * `pnpm -w typecheck` fails in the screen that reads it.
 */
import type { ContractQuery, ContractRequestBody, ContractResponseBody } from '../../lib/contract';

export type ChatSummary = ContractResponseBody<'/chats', 'get'>['items'][number];
export type ChatEvent = ContractResponseBody<'/chats/{chatId}/events', 'get'>['items'][number];
export type NewEvent = ContractRequestBody<'/chats/{chatId}/events', 'post'>;

/** `all` · `my` · `queued` · `unassigned` · `archived` · `ai` · `ai_solved`. */
export type InboxView = NonNullable<ContractQuery<'/chats', 'get'>['view']>;

/** `all` is a customer-facing reply; `agents` is an internal note. */
export type EventRecipients = NonNullable<NewEvent['recipients']>;

/**
 * An event the phone has shown but the server has not confirmed.
 *
 * Marked in `properties` rather than in a parallel list so the transcript
 * renders one array: a pending message that lived outside the transcript would
 * have to be merged at render time, which is where duplicate and out-of-order
 * bubbles come from.
 */
export const PENDING_PROPERTY = 'pending';

export function isPending(event: ChatEvent): boolean {
  return (event.properties as Record<string, unknown> | undefined)?.[PENDING_PROPERTY] === true;
}
