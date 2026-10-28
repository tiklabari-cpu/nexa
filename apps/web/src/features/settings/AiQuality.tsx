/**
 * Settings › AI kalite (tm 319.3 · SiyahTuş analysis AI-24): how the QA queue
 * fills and what a review scores.
 *
 *   - **Sampling** — the daily random share of the AI's closed connections
 *     (1–20 %, 5 by default; the mandatory categories are queued whatever it
 *     is), whether the model pre-scores what is queued, and the conflict
 *     check: a reviewer who took the conversation over may not review it.
 *   - **Rubric** — the criteria a review scores. Saving writes a new version;
 *     the reviews already queued keep the version they were queued with. The
 *     platform's critical criteria (compliance rules kept, handed over at the
 *     right time) stay critical and keep their type — only their weight is
 *     the workspace's — and a workspace's own criterion is never locked.
 *
 * Read with the AI's scopes; changed by an administrator (the routes check
 * both — this screen only decides what is drawn).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useState, type ReactElement } from 'react';
import {
  QA_CRITERION_LABEL_MAX,
  QA_CRITERION_WEIGHT_MAX,
  QA_RUBRIC_CRITERIA_MAX,
  qaRubricProblem,
  type QaCriterionType,
  type QaRubricCriterion,
} from '@siyahtus/types';
import { Card, ErrorNotice, Section } from '../../components/Page.js';
import { SettingsForm } from '../../components/settings/SettingsForm.js';
import { useSettingsLeaveGuard } from '../../components/settings/FormSaveBar.js';
import { Banner } from '../../components/ui/index.js';
import { errorMessageKey } from '../../lib/api-client.js';
import { useApiClient } from '../../lib/auth-store.js';
import { formatDateTime } from '../../lib/format.js';
import { useTranslate } from '../../lib/i18n.js';
import {
  PLATFORM_CRITERION_KEYS,
  criterionLabel,
  qaKeys,
  type QaRubric,
  type QaSettings,
} from '../reports/qa/qa.js';

const field =
  'rounded-md border border-border bg-inset px-2 py-1.5 text-sm outline-none disabled:opacity-50';
const button =
  'rounded-md border border-border px-3 py-1.5 text-sm text-content-secondary transition-colors hover:bg-surface-2 disabled:opacity-50';
const primaryButton =
  'rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-50';

interface SamplingDraft {
  sample_percent: string;
  prescore_enabled: boolean;
  conflict_check: boolean;
}

export function AiQuality({ canEdit }: { canEdit: boolean }): ReactElement {
  const t = useTranslate();
  return (
    <Section
      id="section-ai-quality"
      title={t('settings.aiQuality.title')}
      description={t('settings.aiQuality.description')}
    >
      <SamplingCard canEdit={canEdit} />
      <RubricCard canEdit={canEdit} />
    </Section>
  );
}

function SamplingCard({ canEdit }: { canEdit: boolean }): ReactElement {
  const t = useTranslate();
  const api = useApiClient();
  const queryClient = useQueryClient();
  const percentId = useId();
  const settings = useQuery({
    queryKey: qaKeys.settings,
    queryFn: () => api.get<QaSettings>('/qa/settings'),
  });

  if (settings.error) return <ErrorNotice message={t('settings.aiQuality.loadError')} />;
  if (settings.isPending) {
    return (
      <Card>
        <p className="p-4 text-sm text-content-secondary">{t('settings.loading')}</p>
      </Card>
    );
  }
  const saved = settings.data;
  const percentOk = (raw: string): boolean => {
    const value = Number(raw);
    return (
      Number.isInteger(value) &&
      value >= saved.sample_percent_min &&
      value <= saved.sample_percent_max
    );
  };

  const fields = (
    values: SamplingDraft,
    set?: <K extends keyof SamplingDraft>(key: K, value: SamplingDraft[K]) => void,
  ): ReactElement => (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex flex-col gap-1">
        <label
          htmlFor={percentId}
          className="text-2xs font-medium uppercase tracking-wide text-content-tertiary"
        >
          {t('settings.aiQuality.samplePercent')}
        </label>
        <input
          id={percentId}
          type="number"
          inputMode="numeric"
          min={saved.sample_percent_min}
          max={saved.sample_percent_max}
          value={values.sample_percent}
          disabled={!set}
          onChange={(event) => set?.('sample_percent', event.target.value)}
          className={`${field} w-24`}
        />
        <p className="text-2xs text-content-tertiary">
          {t('settings.aiQuality.samplePercentHint', {
            min: String(saved.sample_percent_min),
            max: String(saved.sample_percent_max),
          })}
        </p>
        {!percentOk(values.sample_percent) && (
          <p className="text-2xs text-danger">
            {t('settings.aiQuality.samplePercentError', {
              min: String(saved.sample_percent_min),
              max: String(saved.sample_percent_max),
            })}
          </p>
        )}
      </div>
      <div className="flex flex-col gap-0.5">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={values.prescore_enabled}
            disabled={!set}
            onChange={(event) => set?.('prescore_enabled', event.target.checked)}
          />
          {t('settings.aiQuality.prescore')}
        </label>
        <p className="pl-6 text-2xs text-content-tertiary">
          {t('settings.aiQuality.prescoreHint')}
        </p>
      </div>
      <div className="flex flex-col gap-0.5">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={values.conflict_check}
            disabled={!set}
            onChange={(event) => set?.('conflict_check', event.target.checked)}
          />
          {t('settings.aiQuality.conflictCheck')}
        </label>
        <p className="pl-6 text-2xs text-content-tertiary">
          {t('settings.aiQuality.conflictCheckHint')}
        </p>
      </div>
    </div>
  );

  const values: SamplingDraft = {
    sample_percent: String(saved.sample_percent),
    prescore_enabled: saved.prescore_enabled,
    conflict_check: saved.conflict_check,
  };
  return (
    <Card>
      <p className="border-b border-border px-4 py-2.5 text-sm font-semibold">
        {t('settings.aiQuality.samplingTitle')}
      </p>
      {canEdit ? (
        <SettingsForm<SamplingDraft>
          saved={values}
          label={t('settings.aiQuality.samplingTitle')}
          isValid={(draft) => percentOk(draft.sample_percent)}
          onSave={async (draft) => {
            const data = await api.put<QaSettings>('/qa/settings', {
              sample_percent: Number(draft.sample_percent),
              prescore_enabled: draft.prescore_enabled,
              conflict_check: draft.conflict_check,
            });
            queryClient.setQueryData(qaKeys.settings, data);
          }}
        >
          {(form) => fields(form.values, form.setValue)}
        </SettingsForm>
      ) : (
        fields(values)
      )}
    </Card>
  );
}

/** A rubric line being edited; a new one has no key until it is named. */
interface DraftCriterion extends QaRubricCriterion {
  /** Added in this edit — its key follows its label. */
  fresh: boolean;
  /** The row's React key: a fresh row has no criterion key yet. */
  uid: string;
}

/** `lower_snake_case` out of whatever a person typed, Turkish letters folded. */
export function criterionKeyOf(label: string, taken: ReadonlySet<string>): string {
  const base =
    label
      .toLocaleLowerCase('tr')
      .replaceAll('ı', 'i')
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .replace(/^(?=[0-9])/, 'c_')
      .slice(0, 36) || 'criterion';
  let key = base;
  for (let n = 2; taken.has(key); n += 1) key = `${base}_${n}`;
  return key;
}

function RubricCard({ canEdit }: { canEdit: boolean }): ReactElement {
  const t = useTranslate();
  const api = useApiClient();
  const rubric = useQuery({
    queryKey: qaKeys.rubric,
    queryFn: () => api.get<QaRubric>('/qa/rubric'),
  });

  if (rubric.error) return <ErrorNotice message={t('settings.aiQuality.rubric.loadError')} />;
  if (rubric.isPending) {
    return (
      <Card>
        <p className="p-4 text-sm text-content-secondary">{t('settings.loading')}</p>
      </Card>
    );
  }
  return <RubricEditor key={rubric.data.id} rubric={rubric.data} canEdit={canEdit} />;
}

function RubricEditor({ rubric, canEdit }: { rubric: QaRubric; canEdit: boolean }): ReactElement {
  const t = useTranslate();
  const api = useApiClient();
  const queryClient = useQueryClient();
  const initial = (): DraftCriterion[] =>
    rubric.criteria.map((criterion) => ({ ...criterion, fresh: false, uid: criterion.key }));
  const [rows, setRows] = useState<DraftCriterion[]>(initial);
  const [done, setDone] = useState(false);

  const body = (): QaRubricCriterion[] => {
    const taken = new Set(rows.filter((row) => !row.fresh).map((row) => row.key));
    return rows.map(({ fresh, uid: _uid, ...criterion }) => {
      if (!fresh) return { ...criterion, label: criterion.label.trim() };
      const key = criterionKeyOf(criterion.label, taken);
      taken.add(key);
      return { ...criterion, key, label: criterion.label.trim() };
    });
  };
  const dirty = JSON.stringify(body()) !== JSON.stringify(rubric.criteria);
  const problem = dirty ? qaRubricProblem(body()) : null;
  const save = useMutation({
    mutationFn: () => api.put<QaRubric>('/qa/rubric', { criteria: body() }),
    onSuccess: (data) => {
      queryClient.setQueryData(qaKeys.rubric, data);
      setDone(true);
    },
  });
  useSettingsLeaveGuard(dirty, save.isPending);

  const change = (index: number, next: Partial<DraftCriterion>): void => {
    setDone(false);
    save.reset();
    setRows((current) => current.map((row, at) => (at === index ? { ...row, ...next } : row)));
  };

  return (
    <Card>
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border px-4 py-2.5">
        <p className="text-sm font-semibold">{t('settings.aiQuality.rubric.title')}</p>
        <span className="text-2xs text-content-tertiary">
          {t('settings.aiQuality.rubric.version', {
            version: String(rubric.version),
            at: formatDateTime(rubric.created_at) ?? '—',
          })}
        </span>
      </div>
      <form
        aria-label={t('settings.aiQuality.rubric.title')}
        className="flex flex-col gap-3 p-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (!dirty || problem) return;
          save.mutate();
        }}
      >
        <p className="text-2xs text-content-tertiary">{t('settings.aiQuality.rubric.hint')}</p>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <caption className="sr-only">{t('settings.aiQuality.rubric.title')}</caption>
            <thead className="text-2xs uppercase tracking-wide text-content-tertiary">
              <tr>
                <th scope="col" className="py-1 pr-2 font-medium">
                  {t('settings.aiQuality.rubric.criterion')}
                </th>
                <th scope="col" className="py-1 pr-2 font-medium">
                  {t('settings.aiQuality.rubric.type')}
                </th>
                <th scope="col" className="py-1 pr-2 font-medium">
                  {t('settings.aiQuality.rubric.weight')}
                </th>
                <th scope="col" className="py-1 pr-2 font-medium">
                  {t('settings.aiQuality.rubric.critical')}
                </th>
                <th scope="col" className="py-1 font-medium">
                  <span className="sr-only">{t('settings.aiQuality.rubric.actions')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => {
                const platform = PLATFORM_CRITERION_KEYS.has(row.key) && !row.fresh;
                const name = platform ? criterionLabel(t, row) : row.label;
                const editable = canEdit && !row.locked;
                return (
                  <tr key={row.uid} className="border-t border-border">
                    <td className="py-1.5 pr-2">
                      {platform || !canEdit ? (
                        <span>
                          {name}
                          {row.locked && (
                            <span className="ml-1.5 rounded-sm bg-surface-2 px-1 text-2xs text-content-secondary">
                              {t('settings.aiQuality.rubric.locked')}
                            </span>
                          )}
                        </span>
                      ) : (
                        <input
                          aria-label={t('settings.aiQuality.rubric.labelFor', {
                            n: String(index + 1),
                          })}
                          value={row.label}
                          maxLength={QA_CRITERION_LABEL_MAX}
                          onChange={(event) => change(index, { label: event.target.value })}
                          className={`${field} w-full min-w-40`}
                        />
                      )}
                    </td>
                    <td className="py-1.5 pr-2">
                      <select
                        aria-label={t('settings.aiQuality.rubric.typeFor', { criterion: name })}
                        value={row.type}
                        disabled={!editable}
                        onChange={(event) =>
                          change(index, { type: event.target.value as QaCriterionType })
                        }
                        className={field}
                      >
                        <option value="pass_fail">{t('settings.aiQuality.rubric.passFail')}</option>
                        <option value="score_1_5">
                          {t('settings.aiQuality.rubric.oneToFive')}
                        </option>
                      </select>
                    </td>
                    <td className="py-1.5 pr-2">
                      <input
                        type="number"
                        aria-label={t('settings.aiQuality.rubric.weightFor', { criterion: name })}
                        min={1}
                        max={QA_CRITERION_WEIGHT_MAX}
                        value={row.weight}
                        disabled={!canEdit}
                        onChange={(event) => change(index, { weight: Number(event.target.value) })}
                        className={`${field} w-16`}
                      />
                    </td>
                    <td className="py-1.5 pr-2">
                      <input
                        type="checkbox"
                        aria-label={t('settings.aiQuality.rubric.criticalFor', { criterion: name })}
                        checked={row.critical}
                        disabled={!editable}
                        onChange={(event) => change(index, { critical: event.target.checked })}
                      />
                    </td>
                    <td className="py-1.5 text-right">
                      {editable && (
                        <button
                          type="button"
                          className="text-2xs text-content-secondary underline hover:text-content"
                          aria-label={t('settings.aiQuality.rubric.removeFor', { criterion: name })}
                          onClick={() => {
                            setDone(false);
                            setRows((current) => current.filter((_, at) => at !== index));
                          }}
                        >
                          {t('settings.aiQuality.rubric.remove')}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {problem && (
          <p className="text-2xs text-danger" role="alert">
            {t('settings.aiQuality.rubric.invalid')}
          </p>
        )}
        {save.error && <Banner tone="danger">{t(errorMessageKey(save.error))}</Banner>}

        {canEdit && (
          <div className="flex flex-wrap items-center justify-end gap-2">
            {done && !dirty && (
              <span className="mr-auto text-2xs text-success" role="status">
                {t('settings.aiQuality.rubric.saved')}
              </span>
            )}
            <button
              type="button"
              className={button}
              disabled={rows.length >= QA_RUBRIC_CRITERIA_MAX}
              onClick={() => {
                setDone(false);
                setRows((current) => [
                  ...current,
                  {
                    key: '',
                    label: '',
                    type: 'pass_fail',
                    weight: 1,
                    critical: false,
                    locked: false,
                    fresh: true,
                    uid: `new-${Date.now()}-${current.length}`,
                  },
                ]);
              }}
            >
              {t('settings.aiQuality.rubric.add')}
            </button>
            <button
              type="button"
              className={button}
              disabled={!dirty || save.isPending}
              onClick={() => {
                setRows(initial());
                save.reset();
              }}
            >
              {t('settings.aiQuality.rubric.discard')}
            </button>
            <button
              type="submit"
              className={primaryButton}
              disabled={!dirty || problem !== null || save.isPending}
            >
              {t('settings.aiQuality.rubric.save')}
            </button>
          </div>
        )}
      </form>
    </Card>
  );
}
