/**
 * Team → a single team's membership + priority (ADR-08 step 2).
 *
 * `PUT`/`DELETE /groups/{groupId}/agents/{agentId}` (`routes/agents.ts`) is the
 * whole surface: add is an upsert (so changing an existing member's priority
 * is the same call as adding them fresh), remove is a delete. Reads the same
 * `['team', 'groups']` cache `Teams.tsx` lists from rather than trusting the
 * `group` prop as handed in, so a priority change or a remove — each
 * invalidating that key — redraws the row it just touched instead of only the
 * card behind this dialog.
 */
import { useMemo, useState, type ReactElement } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { GROUP_PRIORITIES, type GroupPriority } from '@nexa/types';
import { Modal } from '../../components/ui/index.js';
import { errorMessageKey } from '../../lib/api-client.js';
import { useApiClient } from '../../lib/auth-store.js';
import { useTranslate } from '../../lib/i18n.js';
import type { Group } from './Teams.js';

interface AgentOption {
  id: string;
  name: string;
}

export function TeamMembers({
  group,
  agents,
  onClose,
}: {
  group: Group;
  agents: AgentOption[];
  onClose: () => void;
}): ReactElement {
  const t = useTranslate();
  const api = useApiClient();
  const queryClient = useQueryClient();

  const list = useQuery({
    queryKey: ['team', 'groups'],
    queryFn: () => api.get<{ items: Group[] }>('/groups'),
  });
  const current = list.data?.items.find((candidate) => candidate.id === group.id) ?? group;

  const byId = useMemo(() => new Map(agents.map((agent) => [agent.id, agent])), [agents]);
  const memberIds = useMemo(
    () => new Set(current.agents.map((member) => member.agent_id)),
    [current.agents],
  );
  const available = useMemo(
    () => agents.filter((agent) => !memberIds.has(agent.id)),
    [agents, memberIds],
  );

  const [pickedAgentId, setPickedAgentId] = useState('');
  const [pickedPriority, setPickedPriority] = useState<GroupPriority>('normal');
  const [error, setError] = useState<string | null>(null);

  const invalidate = (): Promise<void> =>
    queryClient.invalidateQueries({ queryKey: ['team', 'groups'] });

  const setMember = useMutation({
    mutationFn: ({ agentId, priority }: { agentId: string; priority: GroupPriority }) =>
      api.put<Group>(`/groups/${group.id}/agents/${agentId}`, { priority }),
    onSuccess: async () => {
      setError(null);
      await invalidate();
    },
    onError: (failure: unknown) => setError(t(errorMessageKey(failure))),
  });

  const removeMember = useMutation({
    mutationFn: (agentId: string) => api.delete(`/groups/${group.id}/agents/${agentId}`),
    onSuccess: async () => {
      setError(null);
      await invalidate();
    },
    onError: (failure: unknown) => setError(t(errorMessageKey(failure))),
  });

  function addMember(): void {
    if (!pickedAgentId) return;
    setMember.mutate(
      { agentId: pickedAgentId, priority: pickedPriority },
      { onSuccess: () => setPickedAgentId('') },
    );
  }

  return (
    <Modal
      onClose={onClose}
      title={t('team.teams.members.title', { name: current.name })}
      description={t('team.teams.members.description')}
      align="top"
    >
      {error && (
        <p role="alert" className="mb-3 text-sm text-danger">
          {error}
        </p>
      )}

      {current.agents.length === 0 ? (
        <p className="text-sm text-content-secondary">{t('team.teams.members.empty')}</p>
      ) : (
        <ul className="mb-4 divide-y divide-border">
          {current.agents.map((member) => {
            const name = byId.get(member.agent_id)?.name ?? t('team.page.formerTeammate');
            return (
              <li key={member.agent_id} className="flex items-center gap-2 py-2 text-sm">
                <span className="min-w-0 flex-1 truncate">{name}</span>
                <label className="flex items-center gap-1.5">
                  <select
                    aria-label={t('team.teams.members.priorityAriaLabel', { name })}
                    value={member.priority}
                    disabled={setMember.isPending}
                    onChange={(event) =>
                      setMember.mutate({
                        agentId: member.agent_id,
                        priority: event.target.value as GroupPriority,
                      })
                    }
                    className="rounded-md border border-border bg-inset px-2 py-1 text-xs"
                  >
                    {GROUP_PRIORITIES.map((priority) => (
                      <option key={priority} value={priority}>
                        {t(`team.priority.${priority}`)}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  onClick={() => removeMember.mutate(member.agent_id)}
                  disabled={removeMember.isPending}
                  aria-label={t('team.teams.members.removeAriaLabel', { name })}
                  className="text-xs text-danger underline disabled:opacity-40"
                >
                  {t('team.teams.members.removeButton')}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {available.length > 0 ? (
        <div className="flex flex-wrap items-end gap-2 border-t border-border pt-3">
          <label className="flex min-w-40 flex-1 flex-col gap-1">
            <span className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
              {t('team.teams.members.addLabel')}
            </span>
            <select
              aria-label={t('team.teams.members.addAgentAriaLabel')}
              value={pickedAgentId}
              onChange={(event) => setPickedAgentId(event.target.value)}
              className="rounded-md border border-border bg-inset px-2 py-1.5 text-sm"
            >
              <option value="" disabled>
                {t('team.teams.members.addLabel')}
              </option>
              {available.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.name}
                </option>
              ))}
            </select>
          </label>
          <select
            aria-label={t('team.teams.members.addPriorityAriaLabel')}
            value={pickedPriority}
            onChange={(event) => setPickedPriority(event.target.value as GroupPriority)}
            className="rounded-md border border-border bg-inset px-2 py-1.5 text-sm"
          >
            {GROUP_PRIORITIES.map((priority) => (
              <option key={priority} value={priority}>
                {t(`team.priority.${priority}`)}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={addMember}
            disabled={!pickedAgentId || setMember.isPending}
            className="rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          >
            {setMember.isPending
              ? t('team.teams.members.adding')
              : t('team.teams.members.addButton')}
          </button>
        </div>
      ) : (
        <p className="border-t border-border pt-3 text-2xs text-content-tertiary">
          {t('team.teams.members.noneToAdd')}
        </p>
      )}

      <div className="mt-4 flex justify-end">
        <button
          type="button"
          onClick={onClose}
          className="rounded-md border border-border px-3 py-1.5 text-sm"
        >
          {t('team.teams.members.close')}
        </button>
      </div>
    </Modal>
  );
}
