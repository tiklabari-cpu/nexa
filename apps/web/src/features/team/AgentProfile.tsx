/**
 * The teammate profile panel (FR-MOD-04.3.4).
 *
 * The PRD names a panel with seven things on it — avatar, name, role, last
 * seen, email, concurrent chats limit, Manage profile, Chatting teams — and the
 * roster had grown four of them as table columns instead. Columns are the wrong
 * shape for this: a table answers "how does the team look", a profile answers
 * "who is this person and what are they carrying", and the second question has
 * no room in a row that must stay scannable. So the row's name opens this.
 *
 * Only one field here is not a fact being displayed. The **concurrent chats
 * limit** is editable, and it is the acceptance criterion's one measurable
 * sentence — "limit yönlendirmeyi besler" — because `RoutingService` reads that
 * exact column (`HAVING COUNT(t.id) < m.concurrent_chats_limit`). Lowering it
 * takes effect on the next assignment. The control is hidden, not disabled, for
 * a viewer the server would refuse: an ordinary agent has no business seeing an
 * affordance to restaff a colleague.
 *
 * **"Manage profile" is a link only for yourself.** For your own account it
 * goes to Settings, where the things a person changes about themself live. For
 * someone else there is no such surface and inventing one would be a second
 * place to edit a teammate — the management this panel offers over another
 * person *is* the limit field above it, and it appears under exactly the same
 * permission. An unauthorised viewer gets neither, which is the rule the
 * requirement states.
 *
 * "Chatting teams" is read from the `['team', 'groups']` query the page already
 * holds (`Teams.tsx` shares the key), not from a new per-agent endpoint: the
 * team list already carries its members, so asking again would be a request for
 * something the client is holding.
 */
import { useState, type ChangeEvent, type ReactElement } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Modal } from '../../components/ui/index.js';
import { useApiClient } from '../../lib/auth-store.js';
import { formatDateTime } from '../../lib/format.js';
import { useTranslate } from '../../lib/i18n.js';
import type { Group } from './Teams.js';

/** The bounds `PUT /agents/{agentId}/chat-limit` enforces, mirrored so a value
 *  the server would refuse never leaves the browser. */
const MIN_CHAT_LIMIT = 1;
const MAX_CHAT_LIMIT = 50;

export interface ProfileAgent {
  id: string;
  name: string;
  email: string;
  role: string;
  concurrent_chats_limit: number;
  last_seen_at?: string | null;
}

interface AgentProfileProps {
  agent: ProfileAgent;
  /** Every team on the licence; the ones this agent is in are picked out here. */
  teams: Group[];
  /** This is the signed-in person's own row. */
  isSelf: boolean;
  /** The caller may restaff this teammate — the server's own gate
   *  (`agents--all:rw` + admin rank + the privilege ceiling), mirrored. */
  canEdit: boolean;
}

export function AgentProfile({ agent, teams, isSelf, canEdit }: AgentProfileProps): ReactElement {
  const t = useTranslate();
  const api = useApiClient();
  const client = useQueryClient();

  const [open, setOpen] = useState(false);
  const [limit, setLimit] = useState(String(agent.concurrent_chats_limit));
  const [invalid, setInvalid] = useState(false);

  const save = useMutation({
    mutationFn: (value: number) =>
      api.put(`/agents/${agent.id}/chat-limit`, { concurrent_chats_limit: value }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['team', 'agents'] });
      setOpen(false);
    },
  });

  function openPanel(): void {
    // Re-seeded on every open so a cancelled edit never persists as a stale
    // number the next opener would save by accident.
    setLimit(String(agent.concurrent_chats_limit));
    setInvalid(false);
    save.reset();
    setOpen(true);
  }

  function submit(): void {
    const value = Number(limit);
    if (!Number.isInteger(value) || value < MIN_CHAT_LIMIT || value > MAX_CHAT_LIMIT) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    save.mutate(value);
  }

  const memberOf = teams.filter((team) =>
    team.agents.some((member) => member.agent_id === agent.id),
  );

  return (
    <>
      <button
        type="button"
        onClick={openPanel}
        aria-label={t('team.profile.openAriaLabel', { name: agent.name })}
        className="truncate text-left font-medium hover:underline"
      >
        {agent.name}
      </button>

      {open && (
        <Modal
          onClose={() => setOpen(false)}
          title={t('team.profile.title', { name: agent.name })}
          description={t('team.profile.description')}
        >
          <dl className="space-y-3 text-sm">
            <Field label={t('team.profile.role')}>{t(`team.role.${agent.role}`)}</Field>
            <Field label={t('team.profile.email')}>{agent.email}</Field>
            <Field label={t('team.profile.lastSeen')}>
              {/* A person who has never been stamped reads as "Never" rather
                  than as a blank cell — the difference between "we do not know"
                  and "we forgot to render it" matters to whoever is deciding
                  whether an account is still in use. */}
              {formatDateTime(agent.last_seen_at) ?? t('team.profile.neverSeen')}
            </Field>
            <Field label={t('team.profile.chattingTeams')}>
              {memberOf.length === 0 ? (
                <span className="text-content-tertiary">{t('team.profile.noTeams')}</span>
              ) : (
                <ul className="flex flex-wrap gap-1.5">
                  {memberOf.map((team) => (
                    <li
                      key={team.id}
                      className="rounded-full border border-border px-2 py-0.5 text-xs"
                    >
                      {team.name}
                    </li>
                  ))}
                </ul>
              )}
            </Field>

            <div>
              <dt className="text-xs text-content-secondary">{t('team.profile.chatLimit')}</dt>
              <dd className="mt-1">
                {canEdit ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="flex items-center gap-2">
                      <span className="sr-only">{t('team.profile.chatLimit')}</span>
                      <input
                        type="number"
                        min={MIN_CHAT_LIMIT}
                        max={MAX_CHAT_LIMIT}
                        step={1}
                        value={limit}
                        onChange={(event: ChangeEvent<HTMLInputElement>) =>
                          setLimit(event.target.value)
                        }
                        className="w-20 rounded-md border border-border bg-inset px-2 py-1.5 text-sm outline-none"
                      />
                    </label>
                    <button
                      type="button"
                      onClick={submit}
                      disabled={save.isPending}
                      className="rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
                    >
                      {save.isPending ? t('team.profile.saving') : t('team.profile.save')}
                    </button>
                  </div>
                ) : (
                  <span className="tabular">{agent.concurrent_chats_limit}</span>
                )}
                <p className="mt-1 text-xs text-content-tertiary">
                  {t('team.profile.chatLimitHint')}
                </p>
              </dd>
            </div>
          </dl>

          {invalid && (
            <p role="alert" className="mt-3 text-sm text-danger">
              {t('team.profile.chatLimitError')}
            </p>
          )}
          {save.isError && (
            <p role="alert" className="mt-3 text-sm text-danger">
              {t('team.profile.saveError')}
            </p>
          )}

          <div className="mt-4 flex items-center justify-between gap-2">
            {isSelf ? (
              <Link
                to="/app/settings"
                onClick={() => setOpen(false)}
                className="text-sm text-content-brand underline"
              >
                {t('team.profile.manageProfile')}
              </Link>
            ) : (
              <span />
            )}
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-md border border-border px-3 py-1.5 text-sm"
            >
              {t('team.profile.close')}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

/** One label/value pair in the panel's definition list. */
function Field({ label, children }: { label: string; children: ReactElement | string }) {
  return (
    <div>
      <dt className="text-xs text-content-secondary">{label}</dt>
      <dd className="mt-0.5">{children}</dd>
    </div>
  );
}
