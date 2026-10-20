import { useState, type ReactElement } from 'react';
import { useQuery } from '@tanstack/react-query';
import { StatusDot } from '../../components/StatusDot.js';
import { Banner, Modal } from '../../components/ui/index.js';
import { useApiClient } from '../../lib/auth-store.js';
import { useTranslate } from '../../lib/i18n.js';
import {
  TEAMS_KEY,
  teamNeedsNote,
  transferErrorKey,
  transferNotice,
  transferTeams,
  type TransferNotice,
  type TransferTeam,
} from './transfer.js';
import { useChatAction } from './useInbox.js';

/** Just enough of `GET /agents` to offer a teammate (the Details panel's roster). */
interface RosterAgent {
  id: string;
  name: string | null;
  routing_status: 'accepting_chats' | 'not_accepting_chats' | 'offline';
}

/** The picked target, by section. */
type Choice = { kind: 'agent'; id: string } | { kind: 'team'; id: number };

/** The note's ceiling — the API's (`POST /chats/{id}/transfer`, `note` ≤ 500). */
const NOTE_MAX = 500;

/**
 * "Transfer…" (IN-04): hand the conversation to a teammate or a team, with a
 * note only agents read. Opened from the conversation header, and from the
 * assignee menu's team section with that team picked.
 *
 * A team's row says how many of its members are online right now — "Finance
 * · 2 online" — because that is what decides whether someone has the chat in
 * a moment or it waits in the team's queue; the server answers which it was
 * (`outcome`), and the notice says so. A team with no members cannot be
 * picked. A Responsible Gambling or Complaints team asks for the note
 * (IN-04-S2) — the person picking it up must not have to ask the player again.
 */
export function TransferDialog({
  chatId,
  assigneeId,
  initialTeamId = null,
  onClose,
  onTransferred,
}: {
  chatId: string;
  assigneeId: string | null;
  /** Pre-picked team — the assignee menu's team section opens the dialog with it. */
  initialTeamId?: number | null;
  onClose: () => void;
  /** After the hand-off: the notice, and whether the caller can still open the chat. */
  onTransferred?: (outcome: { notice: TransferNotice; left: boolean }) => void;
}): ReactElement {
  const t = useTranslate();
  const api = useApiClient();
  const actions = useChatAction(chatId);
  const [choice, setChoice] = useState<Choice | null>(
    initialTeamId === null ? null : { kind: 'team', id: initialTeamId },
  );
  const [note, setNote] = useState('');

  const roster = useQuery({
    queryKey: ['team', 'agents'],
    queryFn: () => api.get<{ items: RosterAgent[] }>('/agents'),
    staleTime: 60_000,
  });
  // Who is online moves by the minute: read again if what is cached is older
  // than a few seconds, so "· 2 online" is the number as the dialog opens.
  const teamsQuery = useQuery({
    queryKey: TEAMS_KEY,
    queryFn: () => api.get<{ items: TransferTeam[] }>('/groups'),
    staleTime: 10_000,
  });
  const teams = transferTeams(teamsQuery.data?.items ?? []);
  const agents = roster.data?.items ?? [];

  const pickedTeam =
    choice?.kind === 'team' ? teams.find((team) => team.id === choice.id) : undefined;
  const pickedAgent =
    choice?.kind === 'agent' ? agents.find((agent) => agent.id === choice.id) : undefined;
  const needsNote = teamNeedsNote(pickedTeam);
  const trimmed = note.trim();
  const canSubmit =
    choice !== null && !(needsNote && trimmed.length === 0) && !actions.transfer.isPending;

  const submit = (): void => {
    if (!choice || !canSubmit) return;
    const target =
      choice.kind === 'team'
        ? { group_id: choice.id, ...(trimmed ? { note: trimmed } : {}) }
        : { agent_id: choice.id, ...(trimmed ? { note: trimmed } : {}) };
    actions.transfer.mutate(target, {
      onSuccess: (result) => {
        const notice = transferNotice(
          result,
          choice.kind === 'team'
            ? { team: pickedTeam?.name ?? t('inbox.details.teams.unknown', { id: choice.id }) }
            : { agent: pickedAgent?.name ?? t('inbox.details.takeover.fallbackName') },
        );
        onTransferred?.({ notice, left: !result.visible_to_caller });
        onClose();
      },
    });
  };

  return (
    <Modal onClose={onClose} title={t('inbox.transfer.title')} align="top" className="w-[28rem]">
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <fieldset className="flex flex-col gap-1">
          <legend className="mb-1 text-xs font-medium text-content-secondary">
            {t('inbox.transfer.section.teams')}
          </legend>
          {teamsQuery.isError ? (
            <p className="text-2xs text-content-tertiary">{t('inbox.transfer.teamsUnavailable')}</p>
          ) : teams.length === 0 ? (
            <p className="text-2xs text-content-tertiary">{t('inbox.transfer.noTeams')}</p>
          ) : (
            <ul className="flex max-h-48 flex-col gap-0.5 overflow-y-auto">
              {teams.map((team) => (
                <li key={team.id}>
                  <label
                    className={`flex items-center gap-2 rounded-sm px-2 py-1.5 text-xs ${
                      team.selectable ? 'cursor-pointer hover:bg-surface-2' : 'opacity-60'
                    }`}
                  >
                    <input
                      type="radio"
                      name="transfer-target"
                      checked={choice?.kind === 'team' && choice.id === team.id}
                      disabled={!team.selectable}
                      onChange={() => setChoice({ kind: 'team', id: team.id })}
                    />
                    <span className="min-w-0 flex-1 truncate">{team.name}</span>
                    <span className="shrink-0 tabular text-2xs text-content-tertiary">
                      {team.selectable
                        ? t('inbox.transfer.online', { count: team.accepting_count ?? 0 })
                        : t('inbox.transfer.noMembers')}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </fieldset>

        <fieldset className="flex flex-col gap-1">
          <legend className="mb-1 text-xs font-medium text-content-secondary">
            {t('inbox.transfer.section.teammates')}
          </legend>
          {roster.isError ? (
            <p className="text-2xs text-content-tertiary">
              {t('inbox.details.assign.unavailable')}
            </p>
          ) : (
            <ul className="flex max-h-40 flex-col gap-0.5 overflow-y-auto">
              {agents.map((agent) => {
                const current = agent.id === assigneeId;
                return (
                  <li key={agent.id}>
                    <label
                      className={`flex items-center gap-2 rounded-sm px-2 py-1.5 text-xs ${
                        current ? 'opacity-60' : 'cursor-pointer hover:bg-surface-2'
                      }`}
                    >
                      <input
                        type="radio"
                        name="transfer-target"
                        checked={choice?.kind === 'agent' && choice.id === agent.id}
                        disabled={current}
                        onChange={() => setChoice({ kind: 'agent', id: agent.id })}
                      />
                      <span className="min-w-0 flex-1 truncate">
                        {agent.name ?? t('inbox.details.takeover.fallbackName')}
                      </span>
                      <StatusDot
                        tone={
                          agent.routing_status === 'accepting_chats'
                            ? 'success'
                            : agent.routing_status === 'offline'
                              ? 'neutral'
                              : 'warning'
                        }
                        label={t(
                          agent.routing_status === 'accepting_chats'
                            ? 'team.status.acceptingChats'
                            : agent.routing_status === 'offline'
                              ? 'team.status.offline'
                              : 'team.status.notAccepting',
                        )}
                      />
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </fieldset>

        {pickedTeam && pickedTeam.selectable && (pickedTeam.accepting_count ?? 1) === 0 && (
          <Banner tone="warning">{t('inbox.transfer.willQueue', { team: pickedTeam.name })}</Banner>
        )}

        <div className="flex flex-col gap-1">
          <label htmlFor="transfer-note" className="text-xs font-medium text-content-secondary">
            {needsNote ? t('inbox.transfer.noteRequiredLabel') : t('inbox.transfer.noteLabel')}
          </label>
          <textarea
            id="transfer-note"
            value={note}
            rows={3}
            maxLength={NOTE_MAX}
            required={needsNote}
            aria-describedby="transfer-note-hint"
            onChange={(event) => setNote(event.target.value)}
            className="rounded-sm border border-border bg-inset px-2 py-1.5 text-xs"
          />
          <p id="transfer-note-hint" className="text-2xs text-content-tertiary">
            {needsNote ? t('inbox.transfer.noteRequiredHint') : t('inbox.transfer.noteHint')}
          </p>
        </div>

        {actions.transfer.isError && (
          <Banner tone="danger">
            {t(transferErrorKey(actions.transfer.error, choice?.kind ?? 'team'))}
          </Banner>
        )}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-border px-3 py-1.5 text-sm"
          >
            {t('inbox.transfer.cancel')}
          </button>
          <button
            type="submit"
            disabled={!canSubmit}
            className="rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
          >
            {actions.transfer.isPending ? t('inbox.transfer.pending') : t('inbox.transfer.submit')}
          </button>
        </div>
      </form>
    </Modal>
  );
}
