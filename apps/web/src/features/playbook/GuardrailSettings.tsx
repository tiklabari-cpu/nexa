/**
 * The guardrail texts of the AI agent (tm 301.4 · AI-08): the crisis text G3
 * sends a player at risk before it hands over, the complaint procedure G15
 * gives, and the switch for the judge call that reads risky drafts.
 *
 * The crisis text is the one thing standing between the agent and going live:
 * `PATCH /ai-agents/{id}` answers 409 until the owner has approved it, and an
 * approval is of the text as it stands — editing it withdraws the approval
 * (the server does that), so the screen says so before the save, not after.
 * The platform may suggest a text for the workspace's country; it is a draft to
 * start from, never sent unapproved.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type ReactElement } from 'react';
import { GUARDRAIL_TEXT_MAX } from '@siyahtus/types';
import { LoadError } from '../../components/LoadError.js';
import { Card, CardSkeleton } from '../../components/Page.js';
import { useApiClient } from '../../lib/auth-store.js';
import { formatDateTime } from '../../lib/format.js';
import { useTranslate } from '../../lib/i18n.js';
import { guardrailErrorKey } from './guardrails.js';
import type { AiAgent, GuardrailSettings as Settings } from './types.js';

export const guardrailSettingsKey = (agentId: string) =>
  ['playbook', 'guardrails', 'settings', agentId] as const;

export function GuardrailSettings({
  agent,
  canWrite,
}: {
  agent: AiAgent;
  canWrite: boolean;
}): ReactElement {
  const t = useTranslate();
  const api = useApiClient();
  const queryClient = useQueryClient();

  const settings = useQuery({
    queryKey: guardrailSettingsKey(agent.id),
    queryFn: () => api.get<Settings>(`/ai-guardrails/settings?ai_agent_id=${agent.id}`),
  });

  const [crisis, setCrisis] = useState('');
  const [complaint, setComplaint] = useState('');
  const [judge, setJudge] = useState(false);
  // True once the fields hold an edit in progress: a refetch landing mid-edit
  // must not overwrite what the owner just typed.
  const [touched, setTouched] = useState(false);

  const data = settings.data;
  useEffect(() => {
    if (!data || touched) return;
    setCrisis(data.crisis_text ?? '');
    setComplaint(data.complaint_text ?? '');
    setJudge(data.judge_enabled);
  }, [data, touched]);

  const save = useMutation({
    mutationFn: (approve: boolean | null) =>
      api.put<Settings>('/ai-guardrails/settings', {
        ai_agent_id: agent.id,
        crisis_text: crisis.trim() === '' ? null : crisis.trim(),
        complaint_text: complaint.trim() === '' ? null : complaint.trim(),
        judge_enabled: judge,
        ...(approve === null ? {} : { approve_crisis_text: approve }),
      }),
    onSuccess: (saved) => {
      queryClient.setQueryData(guardrailSettingsKey(agent.id), saved);
      setTouched(false);
      // The agent's switch reads the same gate; its card is stale until refetched.
      void queryClient.invalidateQueries({ queryKey: ['playbook', 'ai-agents'] });
    },
  });

  const crisisChanged = (data?.crisis_text ?? '') !== crisis.trim();
  const dirty =
    data !== undefined &&
    (crisisChanged ||
      (data.complaint_text ?? '') !== complaint.trim() ||
      data.judge_enabled !== judge);
  const overCrisis = crisis.length > GUARDRAIL_TEXT_MAX;
  const overComplaint = complaint.length > GUARDRAIL_TEXT_MAX;
  const valid = !overCrisis && !overComplaint;
  const hasCrisis = crisis.trim() !== '';
  // What the stored row says about approval holds for the text as stored; a
  // changed text is unapproved until it is saved with the approval.
  const approved = data?.crisis_text_approved === true && !crisisChanged;

  return (
    <Card>
      <div className="flex flex-col gap-3 p-4">
        <div>
          <h2 className="text-sm font-semibold">{t('playbook.guardrails.settings.title')}</h2>
          <p className="mt-0.5 text-2xs text-content-tertiary">
            {t('playbook.guardrails.settings.description')}
          </p>
        </div>

        {settings.isPending ? (
          <CardSkeleton rows={3} />
        ) : settings.isError ? (
          <LoadError
            compact
            title={t('playbook.guardrails.settings.loadFailed')}
            error={settings.error}
            onRetry={() => void settings.refetch()}
          />
        ) : (
          <form
            noValidate
            aria-label={t('playbook.guardrails.settings.title')}
            onSubmit={(event) => {
              event.preventDefault();
              if (valid && dirty) save.mutate(null);
            }}
            className="flex flex-col gap-3"
          >
            {!agent.active && data?.setup_problem && (
              <p role="alert" className="rounded-md bg-surface-2 px-3 py-2 text-2xs text-warning">
                {t(`playbook.guardrails.settings.problem.${data.setup_problem}`)}
              </p>
            )}

            <div className="flex flex-col gap-1">
              <label
                htmlFor="guardrail-crisis"
                className="text-2xs font-medium uppercase tracking-wide text-content-tertiary"
              >
                {t('playbook.guardrails.settings.crisisField')}
              </label>
              <textarea
                id="guardrail-crisis"
                value={crisis}
                rows={4}
                readOnly={!canWrite}
                onChange={(event) => {
                  setCrisis(event.target.value);
                  setTouched(true);
                }}
                aria-describedby="guardrail-crisis-hint guardrail-crisis-counter"
                aria-invalid={overCrisis ? true : undefined}
                placeholder={t('playbook.guardrails.settings.crisisPlaceholder')}
                className="rounded-md border border-border bg-inset px-2 py-1.5 text-sm outline-none placeholder:text-content-tertiary"
              />
              <p id="guardrail-crisis-hint" className="text-2xs text-content-tertiary">
                {t('playbook.guardrails.settings.crisisHint')}
              </p>
              <p
                id="guardrail-crisis-counter"
                className={`text-2xs ${overCrisis ? 'text-danger' : 'text-content-tertiary'}`}
              >
                {t('playbook.guidance.counter', {
                  count: crisis.length,
                  max: GUARDRAIL_TEXT_MAX,
                })}
              </p>
              {canWrite && data?.crisis_text_draft && crisis.trim() !== data.crisis_text_draft && (
                <div className="flex flex-col gap-1 rounded-md border border-border p-2">
                  <p className="text-2xs font-medium text-content-secondary">
                    {t('playbook.guardrails.settings.draftTitle')}
                  </p>
                  <p className="whitespace-pre-wrap text-sm text-content-secondary">
                    {data.crisis_text_draft}
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setCrisis(data.crisis_text_draft ?? '');
                      setTouched(true);
                    }}
                    className="self-start rounded-md border border-border px-2 py-1 text-2xs text-content-secondary hover:bg-surface-2"
                  >
                    {t('playbook.guardrails.settings.useDraft')}
                  </button>
                </div>
              )}
              <p
                role="status"
                className={`text-2xs ${approved ? 'text-success' : 'text-content-secondary'}`}
              >
                {approved
                  ? t('playbook.guardrails.settings.approved', {
                      date: formatDateTime(data?.approved_at) ?? '',
                    })
                  : hasCrisis
                    ? t('playbook.guardrails.settings.notApproved')
                    : t('playbook.guardrails.settings.noCrisisText')}
              </p>
            </div>

            <div className="flex flex-col gap-1">
              <label
                htmlFor="guardrail-complaint"
                className="text-2xs font-medium uppercase tracking-wide text-content-tertiary"
              >
                {t('playbook.guardrails.settings.complaintField')}
              </label>
              <textarea
                id="guardrail-complaint"
                value={complaint}
                rows={3}
                readOnly={!canWrite}
                onChange={(event) => {
                  setComplaint(event.target.value);
                  setTouched(true);
                }}
                aria-describedby="guardrail-complaint-hint"
                aria-invalid={overComplaint ? true : undefined}
                placeholder={t('playbook.guardrails.settings.complaintPlaceholder')}
                className="rounded-md border border-border bg-inset px-2 py-1.5 text-sm outline-none placeholder:text-content-tertiary"
              />
              <p id="guardrail-complaint-hint" className="text-2xs text-content-tertiary">
                {t('playbook.guardrails.settings.complaintHint')}
              </p>
            </div>

            <div className="flex flex-col gap-1">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={judge}
                  disabled={!canWrite}
                  aria-describedby="guardrail-judge-hint"
                  onChange={(event) => {
                    setJudge(event.target.checked);
                    setTouched(true);
                  }}
                />
                {t('playbook.guardrails.settings.judgeField')}
              </label>
              <p id="guardrail-judge-hint" className="ml-6 text-2xs text-content-tertiary">
                {t('playbook.guardrails.settings.judgeHint')}
              </p>
            </div>

            {canWrite ? (
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="submit"
                  disabled={!dirty || !valid || save.isPending}
                  className="rounded-md border border-border px-3 py-1.5 text-sm text-content-secondary hover:bg-surface-2 disabled:opacity-50"
                >
                  {save.isPending
                    ? t('playbook.guardrails.settings.saving')
                    : t('playbook.guardrails.settings.save')}
                </button>
                {hasCrisis && !approved && (
                  <button
                    type="button"
                    disabled={!valid || save.isPending}
                    onClick={() => save.mutate(true)}
                    className="rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-50"
                  >
                    {t('playbook.guardrails.settings.saveApprove')}
                  </button>
                )}
                {approved && !dirty && (
                  <button
                    type="button"
                    disabled={save.isPending}
                    onClick={() => save.mutate(false)}
                    className="rounded-md border border-border px-3 py-1.5 text-sm text-content-secondary hover:bg-surface-2 disabled:opacity-50"
                  >
                    {t('playbook.guardrails.settings.withdraw')}
                  </button>
                )}
                {save.isError && (
                  <span role="alert" className="text-2xs text-danger">
                    {t(guardrailErrorKey(save.error))}
                  </span>
                )}
              </div>
            ) : (
              <p className="text-2xs text-content-tertiary">{t('playbook.guardrails.ownerOnly')}</p>
            )}
          </form>
        )}
      </div>
    </Card>
  );
}
