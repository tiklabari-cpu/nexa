/**
 * Who may take a chat over (RL-03 · tm 326) — the pure half, so the Details
 * panel's button and the "My team" row ask the same question the server does
 * (`ChatService.takeover`): the caller's `chats.takeover` capability from
 * `GET /auth/me`, and for `team` whether one of the chat's teams is a team they
 * lead (`GET /groups` `agents[].lead`). The server decides; this decides what
 * is drawn, so an Ekip Üyesi never sees a button that would answer 403.
 */
import { SUPERVISOR_ROLES } from './roles.js';
import type { TransferTeam } from './transfer.js';

/** The ids of the teams `accountId` leads, from `GET /groups`. */
export function ledTeamIds(teams: readonly TransferTeam[], accountId: string | null): number[] {
  if (accountId === null) return [];
  return teams
    .filter((team) => team.agents?.some((agent) => agent.agent_id === accountId && agent.lead))
    .map((team) => team.id);
}

export interface TakeoverCaller {
  role: string | null;
  accountId: string | null;
  /** `GET /auth/me` `capabilities`; absent from a server older than tm 325.2. */
  capabilities?: Readonly<Record<string, string>>;
}

/**
 * Whether `caller` may take over an open chat routed to `chatTeamIds`. A
 * server without the capability (older than tm 326) gated takeover on the
 * administrator role, and so does this.
 */
export function canTakeOver(
  caller: TakeoverCaller,
  chatTeamIds: readonly number[],
  teams: readonly TransferTeam[],
): boolean {
  const level = caller.capabilities?.['chats.takeover'];
  if (level === undefined) return caller.role !== null && SUPERVISOR_ROLES.has(caller.role);
  if (level === 'all') return true;
  if (level !== 'team') return false;
  const led = ledTeamIds(teams, caller.accountId);
  return chatTeamIds.some((id) => led.includes(id));
}
