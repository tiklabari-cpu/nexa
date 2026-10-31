/**
 * What the composer knows about a conversation, as saved-reply variable values
 * (IN-06). Pure: each composer gathers its sources and hands them here, so the
 * chat and the ticket composer fill `{{customer.name}}` by one rule.
 *
 * The agent's name is the one players see — the public name when set (RL-06),
 * the account name otherwise — because a saved reply is text sent to a player.
 * A hidden e-mail or username (`customers.contact.view` off) is simply absent,
 * so the fallback phrase stands in for it rather than an empty gap.
 */
import { firstNameOf, type CannedValues } from '@siyahtus/types';

export interface CannedSources {
  customer?: { name?: string | null; username?: string | null; email?: string | null } | null;
  agent?: { name?: string | null; public_name?: string | null } | null;
  /** The code's chat id (the member's day). */
  chatId?: string | null;
  /** The code's thread id (one connection). */
  threadId?: string | null;
  companyName?: string | null;
}

export function cannedValuesOf(sources: CannedSources): CannedValues {
  const customerName = sources.customer?.name ?? null;
  const agentName = sources.agent?.public_name || sources.agent?.name || null;
  return {
    'customer.name': customerName,
    'customer.first_name': firstNameOf(customerName),
    'customer.username': sources.customer?.username ?? null,
    'customer.email': sources.customer?.email ?? null,
    'agent.name': agentName,
    'agent.first_name': firstNameOf(agentName),
    'chat.id': sources.chatId ?? null,
    'thread.id': sources.threadId ?? null,
    'company.name': sources.companyName ?? null,
  };
}
