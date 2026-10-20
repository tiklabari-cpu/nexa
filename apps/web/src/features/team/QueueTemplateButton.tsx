/**
 * "iGaming kuyruk şablonunu kur" (AU-01 · K14 · tm 305.4) — the Team › Teams
 * action that sets up the six topic queues: Finance, KYC / Risk, Bonus,
 * Responsible Gambling, Technical, Complaints, plus the "Responsible gambling
 * training" skill the Responsible Gambling team requires.
 *
 * A deliberate action, not a migration (AU-01): it opens on a preview of what
 * `GET /routing/queues` says is served and what would be created, and nothing
 * is written until the manager confirms. Topics a team already serves are left
 * alone, so it is safe to run again; the teams it makes are ordinary teams
 * afterwards — renamed, given members, edited like any other (K14). Members
 * of Responsible Gambling need the training skill first (tm 305.3's 409), so
 * the preview says where it is given.
 */
import { useState, type ReactElement } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { QUEUE_TOPIC_ROLES, RESPONSIBLE_GAMBLING_ROLE, type QueueTopicRole } from '@siyahtus/types';
import { Modal } from '../../components/ui/index.js';
import { errorMessageKey } from '../../lib/api-client.js';
import { useApiClient } from '../../lib/auth-store.js';
import { translate, useTranslate } from '../../lib/i18n.js';
import { applyQueueTemplate, missingTopics, type RoutingQueue } from './teamQueue.js';

/** The skill's name in both console languages — any of them is recognised. */
const TRAINING_NAME_KEY = 'team.queueTemplate.trainingName';

export function QueueTemplateButton(): ReactElement {
  const t = useTranslate();
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-content-secondary hover:bg-surface-2"
      >
        {t('team.queueTemplate.button')}
      </button>
      {open && <QueueTemplateDialog onClose={() => setOpen(false)} />}
    </>
  );
}

/** The team the template makes for each topic, named in the console's language. */
function templateTeamNames(name: (role: QueueTopicRole) => string): Record<QueueTopicRole, string> {
  const names = {} as Record<QueueTopicRole, string>;
  for (const role of QUEUE_TOPIC_ROLES) names[role] = name(role);
  return names;
}

function QueueTemplateDialog({ onClose }: { onClose: () => void }): ReactElement {
  const t = useTranslate();
  const api = useApiClient();
  const queryClient = useQueryClient();

  const queues = useQuery({
    queryKey: ['routing', 'queues'],
    queryFn: () => api.get<{ items: RoutingQueue[] }>('/routing/queues'),
  });
  const missing = missingTopics(queues.data?.items ?? []);
  const byRole = new Map((queues.data?.items ?? []).map((queue) => [queue.topic_role, queue]));

  const teamName = (role: QueueTopicRole): string => t(`team.queueTemplate.teamName.${role}`);

  const apply = useMutation({
    mutationFn: () =>
      applyQueueTemplate(api, {
        teams: templateTeamNames(teamName),
        // The console's own spelling first (that is the one created), then
        // the other language's, so a skill made from either console is found.
        training: [
          t(TRAINING_NAME_KEY),
          translate('en', TRAINING_NAME_KEY),
          translate('tr', TRAINING_NAME_KEY),
        ],
      }),
    // Refreshed whether it finished or stopped part-way: what was made is
    // made, and the preview must show it before anyone runs it again.
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ['routing', 'queues'] }),
        queryClient.invalidateQueries({ queryKey: ['team', 'groups'] }),
        queryClient.invalidateQueries({ queryKey: ['settings', 'expertise'] }),
      ]),
    onSuccess: () => onClose(),
  });

  return (
    <Modal
      onClose={onClose}
      title={t('team.queueTemplate.title')}
      description={t('team.queueTemplate.description')}
    >
      <div className="flex flex-col gap-3">
        {apply.isError && (
          <p role="alert" className="text-sm text-danger">
            {t('team.queueTemplate.failed', { reason: t(errorMessageKey(apply.error)) })}
          </p>
        )}

        {queues.isPending ? (
          <p className="text-sm text-content-tertiary">{t('team.queueTemplate.loading')}</p>
        ) : queues.isError ? (
          <p role="alert" className="text-sm text-danger">
            {t(errorMessageKey(queues.error))}
          </p>
        ) : (
          <>
            <ul className="divide-y divide-border rounded-md border border-border">
              {QUEUE_TOPIC_ROLES.map((role) => {
                const served = byRole.get(role);
                return (
                  <li key={role} className="flex items-center justify-between gap-3 px-3 py-2">
                    <span className="text-sm font-medium">{t(`team.queue.role.${role}`)}</span>
                    <span className="text-right text-xs text-content-secondary">
                      {served?.group_id != null
                        ? t('team.queueTemplate.served', { team: served.group_name ?? '' })
                        : t('team.queueTemplate.willCreate', { team: teamName(role) })}
                    </span>
                  </li>
                );
              })}
            </ul>
            {missing.length === 0 ? (
              <p className="text-sm text-content-secondary">{t('team.queueTemplate.allServed')}</p>
            ) : (
              missing.includes(RESPONSIBLE_GAMBLING_ROLE) && (
                <p className="text-xs text-content-tertiary">
                  {t('team.queueTemplate.trainingNote', { skill: t(TRAINING_NAME_KEY) })}
                </p>
              )
            )}
          </>
        )}

        <div className="mt-1 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-content-secondary hover:bg-surface-2"
          >
            {t('team.queueTemplate.cancel')}
          </button>
          <button
            type="button"
            onClick={() => apply.mutate()}
            disabled={queues.isPending || queues.isError || missing.length === 0 || apply.isPending}
            className="rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {apply.isPending
              ? t('team.queueTemplate.applying')
              : t('team.queueTemplate.apply', { count: missing.length })}
          </button>
        </div>
      </div>
    </Modal>
  );
}
