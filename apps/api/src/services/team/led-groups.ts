/**
 * The teams a person leads (RL-01 · `group_agents.is_lead`), for what leading
 * adds to them (RL-03 · tm 326): taking over a chat routed to one of their
 * teams, and the inbox's "My team" view.
 *
 * Read from the database on each request, as the membership list in
 * `chat/access.ts` is: making someone a lead, or no longer one, must take
 * effect on their next click rather than when their session next rotates.
 * Leading is per team, and a person may lead several. A lead is also a member
 * of the team they lead (one `group_agents` row carries both), so what a lead
 * may see is what any member sees; this only says which of those teams are
 * theirs to run.
 */
import type { TenantClient } from '../../lib/tenant.js';

export async function ledGroupIds(tx: TenantClient, accountId: string): Promise<bigint[]> {
  const rows = await tx.groupAgent.findMany({
    where: { agentId: accountId, isLead: true },
    select: { groupId: true },
    orderBy: { groupId: 'asc' },
  });
  return rows.map((row) => row.groupId);
}
