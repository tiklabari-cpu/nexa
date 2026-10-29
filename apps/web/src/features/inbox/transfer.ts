/**
 * Handing a conversation off (IN-04) — the pure half: which teams can be
 * offered, what the dialog says about one, the sentence after a hand-off and
 * the one for a refusal. The dialog (`TransferDialog.tsx`) and the assignee
 * menu (`DetailsPanel.tsx`) both read it, so they never disagree about a
 * team.
 */
import { transferNoteRequired } from '@siyahtus/types';
import { ApiClientError, errorMessageKey } from '../../lib/api-client.js';
import { getLocale } from '../../lib/i18n.js';
import type { ChatTransferResult } from './types.js';

/** Query key of `GET /groups` — the Teams page's and the Details panel's. */
export const TEAMS_KEY = ['team', 'groups'] as const;

/** Just enough of `GET /groups` to offer a team as a hand-off target. */
export interface TransferTeam {
  id: number;
  name: string;
  topic_role?: string | null;
  /** Members accepting chats now (`Group.accepting_count`); absent from an older server. */
  accepting_count?: number;
  /** `lead`: they lead this team (RL-01); absent from a server older than tm 324.2. */
  agents?: Array<{ agent_id: string; lead?: boolean }>;
}

/**
 * The teams in the order the menu lists them — by name — each with whether it
 * can be chosen: a team nobody belongs to would hold the chat for nobody, and
 * the server refuses it (`group_unavailable`).
 */
export function transferTeams(
  teams: readonly TransferTeam[],
): Array<TransferTeam & { selectable: boolean }> {
  return [...teams]
    .sort((a, b) => a.name.localeCompare(b.name, getLocale()))
    .map((team) => ({ ...team, selectable: (team.agents?.length ?? 1) > 0 }));
}

/** Whether a person handing to this team must leave a note (IN-04-S2). */
export function teamNeedsNote(team: TransferTeam | undefined): boolean {
  return transferNoteRequired(team?.topic_role ?? null);
}

/** A sentence and its tone, for the notice a hand-off leaves on screen. */
export interface TransferNotice {
  key: string;
  params: Record<string, string>;
  tone: 'success' | 'warning';
}

/**
 * What to tell the agent once a hand-off went through: who has it now, or —
 * for a team with nobody free — that it waits in that team's queue (IN-04-S1).
 */
export function transferNotice(
  result: Pick<ChatTransferResult, 'outcome'>,
  target: { team: string } | { agent: string },
): TransferNotice {
  if ('agent' in target) {
    return { key: 'inbox.transfer.notice.agent', params: { name: target.agent }, tone: 'success' };
  }
  return result.outcome === 'queued'
    ? { key: 'inbox.transfer.notice.queued', params: { team: target.team }, tone: 'warning' }
    : { key: 'inbox.transfer.notice.team', params: { team: target.team }, tone: 'success' };
}

/**
 * The sentence for a refused hand-off. The server's types say what happened;
 * two of them mean something narrower here than the catalogue's general
 * sentence: `group_unavailable` is an offline teammate or a team with no
 * members, depending on what was picked, and `validation` from a team
 * hand-off is the missing note — the only field the dialog cannot stop
 * before sending when the team list is stale.
 */
export function transferErrorKey(error: unknown, kind: 'team' | 'agent'): string {
  if (error instanceof ApiClientError) {
    if (error.type === 'group_unavailable') {
      return kind === 'team' ? 'inbox.transfer.error.teamEmpty' : 'inbox.details.assign.offline';
    }
    if (error.type === 'group_not_found') return 'inbox.transfer.error.teamGone';
    if (error.type === 'chat_inactive') return 'inbox.transfer.error.closed';
    if (error.type === 'validation' && kind === 'team') return 'inbox.transfer.error.noteRequired';
  }
  return errorMessageKey(error);
}
