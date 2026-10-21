/**
 * One test scenario, written or edited (tm 314.5 · AI-19): who the player is,
 * what they say (scripted) or want and know (simulated), the moment the clock
 * is frozen at, what a tool step would have returned (AI-28), and what must
 * come out — the expectations the hard checks hold the run to.
 *
 * Scenario text is synthetic by rule: the editor says so, and the API masks it
 * (AI-26) before it is stored. The form is checked with the API's validator
 * before Save, and a refusal's `details.problems` lands under its field.
 */
import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useState, type ReactElement, type ReactNode } from 'react';
import {
  AI_TEST_MAX_TURNS_LIMIT,
  AI_TEST_SCENARIO_GOAL_MAX,
  AI_TEST_SCENARIO_MODES,
  AI_TEST_SCENARIO_NAME_MAX,
  AI_TEST_SCENARIO_TURNS_MAX,
  AI_TEST_TURN_TEXT_MAX,
  QUEUE_TOPIC_ROLES,
  RISK_FLAG_TYPES,
  SCENARIO_OUTCOMES,
  SCENARIO_PERSONAS,
  type AiTestProblem,
  type AiTestScenarioMode,
  type QueueTopicRole,
  type RiskFlagType,
  type ScenarioOutcome,
  type ScenarioPersona,
} from '@siyahtus/types';
import { Card, CardSkeleton } from '../../components/Page.js';
import { LoadError } from '../../components/LoadError.js';
import { errorMessageKey } from '../../lib/api-client.js';
import { useApiClient } from '../../lib/auth-store.js';
import { getLocale, useTranslate } from '../../lib/i18n.js';
import {
  problemAt,
  problemsOf,
  scenarioBody,
  scenarioFormOf,
  type KeyValueRow,
  type ScenarioForm,
  type TestScenario,
} from './ai-testing.js';
import type { Skill } from './types.js';

const button =
  'rounded-md border border-border px-3 py-1.5 text-sm text-content-secondary transition-colors hover:bg-surface-2 disabled:opacity-50';
const primaryButton =
  'rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-50';
const smallButton =
  'rounded-md border border-border px-2 py-1 text-2xs text-content-secondary hover:bg-surface-2 disabled:opacity-50';
const input = 'rounded-md border border-border bg-surface px-2 py-1.5 text-sm';

interface TeamOption {
  id: number;
  name: string;
}

export function ScenarioEditor({
  agentId,
  scenarioId,
  skills,
  canEdit,
  onClose,
  onSaved,
}: {
  agentId: string;
  /** `null` — a new scenario. */
  scenarioId: string | null;
  skills: readonly Pick<Skill, 'id' | 'name'>[];
  canEdit: boolean;
  onClose: () => void;
  onSaved: (scenario: TestScenario) => void;
}): ReactElement {
  const t = useTranslate();
  const api = useApiClient();
  const [form, setForm] = useState<ScenarioForm | null>(() =>
    scenarioId === null ? scenarioFormOf(null, getLocale() === 'en' ? 'en' : 'tr') : null,
  );
  const [problems, setProblems] = useState<AiTestProblem[]>([]);

  const existing = useQuery({
    queryKey: ['playbook', 'ai-testing', 'scenario', scenarioId],
    queryFn: () => api.get<TestScenario>(`/ai/test-scenarios/${scenarioId}`),
    enabled: scenarioId !== null,
    // The form is seeded once; a refetch must not overwrite what is being typed.
    staleTime: Infinity,
  });
  const teams = useQuery({
    queryKey: ['playbook', 'teams'],
    queryFn: () => api.get<{ items: TeamOption[] }>('/groups'),
    staleTime: 60_000,
  });

  useEffect(() => {
    if (existing.data && form === null) setForm(scenarioFormOf(existing.data));
  }, [existing.data, form]);

  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      scenarioId === null
        ? api.post<TestScenario>('/ai/test-scenarios', { ai_agent_id: agentId, ...body })
        : api.patch<TestScenario>(`/ai/test-scenarios/${scenarioId}`, body),
    onSuccess: (scenario) => onSaved(scenario),
    onError: (error) => setProblems(problemsOf(error)),
  });

  const title =
    scenarioId === null ? t('playbook.test.editor.newTitle') : t('playbook.test.editor.editTitle');

  if (form === null) {
    return (
      <section aria-label={title} className="flex flex-col gap-3">
        {existing.isError ? (
          <Card>
            <LoadError
              compact
              title={t('playbook.test.editor.loadFailed')}
              error={existing.error}
              onRetry={() => void existing.refetch()}
            />
          </Card>
        ) : (
          <CardSkeleton rows={5} />
        )}
      </section>
    );
  }

  const set = <K extends keyof ScenarioForm>(key: K, value: ScenarioForm[K]) =>
    setForm((current) => (current ? { ...current, [key]: value } : current));
  const problem = (field: string) => problemAt(problems, field);
  const handoff = form.outcome === 'handoff';

  const submit = () => {
    const { body, problems: found } = scenarioBody(form);
    setProblems(found);
    if (found.length === 0) save.mutate(body);
  };

  return (
    <section aria-label={title} data-testid="scenario-editor" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start gap-3">
        <h2 className="min-w-0 flex-1 text-sm font-semibold">{title}</h2>
        <button type="button" className={button} onClick={onClose}>
          {t('playbook.test.actions.back')}
        </button>
      </div>

      <p role="note" className="rounded-md border border-warning px-3 py-2 text-2xs text-warning">
        {t('playbook.test.editor.syntheticWarning')}
      </p>

      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <fieldset disabled={!canEdit || save.isPending} className="flex flex-col gap-4">
          <Card>
            <div className="grid grid-cols-1 gap-3 p-4 md:grid-cols-2">
              <Field label={t('playbook.test.editor.name')} problem={problem('name')}>
                <input
                  value={form.name}
                  maxLength={AI_TEST_SCENARIO_NAME_MAX}
                  onChange={(event) => set('name', event.target.value)}
                  className={input}
                />
              </Field>
              <Field label={t('playbook.test.editor.mode')} problem={problem('mode')}>
                <select
                  value={form.mode}
                  onChange={(event) => set('mode', event.target.value as AiTestScenarioMode)}
                  className={input}
                >
                  {AI_TEST_SCENARIO_MODES.map((mode) => (
                    <option key={mode} value={mode}>
                      {t(`playbook.test.mode.${mode}`)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t('playbook.test.editor.persona')} problem={problem('persona')}>
                <select
                  value={form.persona}
                  onChange={(event) => set('persona', event.target.value as ScenarioPersona)}
                  className={input}
                >
                  {SCENARIO_PERSONAS.map((persona) => (
                    <option key={persona} value={persona}>
                      {t(`playbook.test.persona.${persona}`)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t('playbook.test.editor.language')} problem={problem('language')}>
                <input
                  value={form.language}
                  maxLength={2}
                  onChange={(event) => set('language', event.target.value.toLowerCase())}
                  className={input}
                />
              </Field>
              <Field
                label={t('playbook.test.editor.simulatedNow')}
                hint={t('playbook.test.editor.simulatedNowHint')}
                problem={problem('simulated_now')}
              >
                <input
                  type="datetime-local"
                  value={form.simulatedNow}
                  onChange={(event) => set('simulatedNow', event.target.value)}
                  className={input}
                />
              </Field>
              <label className="flex items-center gap-2 self-end text-xs">
                <input
                  type="checkbox"
                  checked={form.active}
                  onChange={(event) => set('active', event.target.checked)}
                />
                {t('playbook.test.editor.active')}
              </label>
            </div>
          </Card>

          <Card>
            <div className="flex flex-col gap-3 p-4">
              <h3 className="text-sm font-semibold">{t('playbook.test.editor.playerTitle')}</h3>
              <p className="text-2xs text-content-tertiary">
                {form.mode === 'scripted'
                  ? t('playbook.test.editor.scriptedHint')
                  : t('playbook.test.editor.simulatedHint')}
              </p>
              <Field label={t('playbook.test.editor.goal')} problem={problem('goal')}>
                <textarea
                  value={form.goal}
                  rows={2}
                  maxLength={AI_TEST_SCENARIO_GOAL_MAX}
                  onChange={(event) => set('goal', event.target.value)}
                  className={input}
                />
              </Field>
              <div className="flex flex-col gap-2">
                {form.turns.map((turn, index) => (
                  <div key={index} className="flex items-start gap-2">
                    <Field
                      label={t('playbook.test.editor.turn', { n: index + 1 })}
                      problem={problem(`turns[${index}]`)}
                    >
                      <textarea
                        value={turn}
                        rows={2}
                        maxLength={AI_TEST_TURN_TEXT_MAX}
                        onChange={(event) =>
                          set(
                            'turns',
                            form.turns.map((line, i) => (i === index ? event.target.value : line)),
                          )
                        }
                        className={input}
                      />
                    </Field>
                    <button
                      type="button"
                      className={`${smallButton} mt-5`}
                      aria-label={t('playbook.test.editor.removeTurn', { n: index + 1 })}
                      onClick={() =>
                        set(
                          'turns',
                          form.turns.filter((_, i) => i !== index),
                        )
                      }
                    >
                      ×
                    </button>
                  </div>
                ))}
                {problem('turns') && !form.turns.some((_, i) => problem(`turns[${i}]`)) && (
                  <ProblemText code={problem('turns')!} />
                )}
                <button
                  type="button"
                  className={`${smallButton} self-start`}
                  disabled={form.turns.length >= AI_TEST_SCENARIO_TURNS_MAX}
                  onClick={() => set('turns', [...form.turns, ''])}
                >
                  {t('playbook.test.editor.addTurn')}
                </button>
              </div>
              <KeyValueRows
                legend={t('playbook.test.editor.facts')}
                hint={t('playbook.test.editor.factsHint')}
                rows={form.facts}
                problem={problem('facts')}
                onChange={(rows) => set('facts', rows)}
              />
            </div>
          </Card>

          <Card>
            <div className="flex flex-col gap-3 p-4">
              <h3 className="text-sm font-semibold">{t('playbook.test.editor.expectTitle')}</h3>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <Field
                  label={t('playbook.test.editor.outcome')}
                  problem={problem('expectations.outcome')}
                >
                  <select
                    value={form.outcome}
                    onChange={(event) => set('outcome', event.target.value as ScenarioOutcome)}
                    className={input}
                  >
                    {SCENARIO_OUTCOMES.map((outcome) => (
                      <option key={outcome} value={outcome}>
                        {t(`playbook.test.outcome.${outcome}`)}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field
                  label={t('playbook.test.editor.maxTurns')}
                  problem={problem('expectations.max_turns')}
                >
                  <input
                    type="number"
                    min={1}
                    max={AI_TEST_MAX_TURNS_LIMIT}
                    value={form.maxTurns}
                    onChange={(event) => set('maxTurns', event.target.value)}
                    className={input}
                  />
                </Field>
                {handoff && (
                  <Field
                    label={t('playbook.test.editor.team')}
                    problem={problem('expectations.team_id')}
                  >
                    <select
                      value={form.teamId}
                      onChange={(event) => set('teamId', event.target.value)}
                      className={input}
                    >
                      <option value="">{t('playbook.test.editor.anyTeam')}</option>
                      {(teams.data?.items ?? []).map((team) => (
                        <option key={team.id} value={String(team.id)}>
                          {team.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                )}
                {handoff && (
                  <Field
                    label={t('playbook.test.editor.topic')}
                    problem={problem('expectations.topic')}
                  >
                    <select
                      value={form.topic}
                      onChange={(event) => set('topic', event.target.value as QueueTopicRole | '')}
                      className={input}
                    >
                      <option value="">{t('playbook.test.editor.anyTopic')}</option>
                      {QUEUE_TOPIC_ROLES.map((topic) => (
                        <option key={topic} value={topic}>
                          {t(`team.queue.role.${topic}`)}
                        </option>
                      ))}
                    </select>
                  </Field>
                )}
                {handoff && (
                  <Field
                    label={t('playbook.test.editor.reasonCode')}
                    problem={problem('expectations.reason_code')}
                  >
                    <input
                      value={form.reasonCode}
                      onChange={(event) => set('reasonCode', event.target.value)}
                      className={input}
                    />
                  </Field>
                )}
                <Field
                  label={t('playbook.test.editor.procedure')}
                  problem={problem('expectations.procedure_id')}
                >
                  <select
                    value={form.procedureId}
                    onChange={(event) => set('procedureId', event.target.value)}
                    className={input}
                  >
                    <option value="">{t('playbook.test.editor.anyProcedure')}</option>
                    {skills.map((skill) => (
                      <option key={skill.id} value={skill.id}>
                        {skill.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field
                  label={t('playbook.test.editor.requiredSlots')}
                  hint={t('playbook.test.editor.onePerLine')}
                  problem={problem('expectations.required_slots')}
                >
                  <textarea
                    value={form.requiredSlots}
                    rows={3}
                    onChange={(event) => set('requiredSlots', event.target.value)}
                    className={input}
                  />
                </Field>
                <Field
                  label={t('playbook.test.editor.forbiddenPhrases')}
                  hint={t('playbook.test.editor.onePerLine')}
                  problem={problem('expectations.forbidden_phrases')}
                >
                  <textarea
                    value={form.forbiddenPhrases}
                    rows={3}
                    onChange={(event) => set('forbiddenPhrases', event.target.value)}
                    className={input}
                  />
                </Field>
                <Field
                  label={t('playbook.test.editor.expectLanguage')}
                  hint={t('playbook.test.editor.expectLanguageHint')}
                  problem={problem('expectations.language')}
                >
                  <input
                    value={form.expectLanguage}
                    maxLength={2}
                    onChange={(event) => set('expectLanguage', event.target.value.toLowerCase())}
                    className={input}
                  />
                </Field>
              </div>
              <KeyValueRows
                legend={t('playbook.test.editor.values')}
                hint={t('playbook.test.editor.valuesHint')}
                rows={form.values}
                problem={problem('expectations.values')}
                onChange={(rows) => set('values', rows)}
              />
              <FlagChoices
                legend={t('playbook.test.editor.mustFlags')}
                chosen={form.mustFlags}
                problem={problem('expectations.must_flags')}
                onChange={(flags) => set('mustFlags', flags)}
              />
              <FlagChoices
                legend={t('playbook.test.editor.mustNotFlags')}
                chosen={form.mustNotFlags}
                problem={problem('expectations.must_not_flags')}
                onChange={(flags) => set('mustNotFlags', flags)}
              />
            </div>
          </Card>

          <Card>
            <details className="p-4">
              <summary className="cursor-pointer text-xs font-medium">
                {t('playbook.test.editor.advanced')}
              </summary>
              <div className="mt-3">
                <Field
                  label={t('playbook.test.editor.toolOutputs')}
                  hint={t('playbook.test.editor.toolOutputsHint')}
                  problem={problem('tool_outputs')}
                >
                  <textarea
                    value={form.toolOutputs}
                    rows={5}
                    spellCheck={false}
                    onChange={(event) => set('toolOutputs', event.target.value)}
                    className={`${input} font-mono text-xs`}
                  />
                </Field>
              </div>
            </details>
          </Card>

          {problems.length > 0 && (
            <p role="alert" className="text-2xs text-danger">
              {t('playbook.test.editor.problems', { count: problems.length })}
            </p>
          )}
          {save.isError && problemsOf(save.error).length === 0 && (
            <p role="alert" className="text-2xs text-danger">
              {t(errorMessageKey(save.error))}
            </p>
          )}

          {canEdit && (
            <div className="flex items-center gap-2">
              <button type="submit" className={primaryButton}>
                {save.isPending ? t('playbook.test.editor.saving') : t('playbook.test.editor.save')}
              </button>
              <button type="button" className={button} onClick={onClose}>
                {t('playbook.test.editor.cancel')}
              </button>
            </div>
          )}
        </fieldset>
      </form>
    </section>
  );
}

function ProblemText({ code }: { code: string }): ReactElement {
  const t = useTranslate();
  return <span className="text-2xs text-danger">{t(`playbook.test.problem.${code}`)}</span>;
}

function Field({
  label,
  hint,
  problem,
  children,
}: {
  label: string;
  hint?: string;
  problem: string | null;
  children: ReactNode;
}): ReactElement {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1">
      <label className="flex flex-col gap-1 text-xs">
        {label}
        {children}
      </label>
      {hint && <span className="text-2xs text-content-tertiary">{hint}</span>}
      {problem && <ProblemText code={problem} />}
    </div>
  );
}

function KeyValueRows({
  legend,
  hint,
  rows,
  problem,
  onChange,
}: {
  legend: string;
  hint: string;
  rows: KeyValueRow[];
  problem: string | null;
  onChange: (rows: KeyValueRow[]) => void;
}): ReactElement {
  const t = useTranslate();
  const update = (index: number, patch: Partial<KeyValueRow>) =>
    onChange(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-xs font-medium">{legend}</legend>
      <span className="text-2xs text-content-tertiary">{hint}</span>
      {rows.map((row, index) => (
        <div key={index} className="flex items-center gap-2">
          <input
            aria-label={t('playbook.test.editor.key', { legend, n: index + 1 })}
            value={row.key}
            onChange={(event) => update(index, { key: event.target.value })}
            className={`${input} w-40`}
          />
          <input
            aria-label={t('playbook.test.editor.value', { legend, n: index + 1 })}
            value={row.value}
            onChange={(event) => update(index, { value: event.target.value })}
            className={`${input} min-w-0 flex-1`}
          />
          <button
            type="button"
            className={smallButton}
            aria-label={t('playbook.test.editor.removeRow', { legend, n: index + 1 })}
            onClick={() => onChange(rows.filter((_, i) => i !== index))}
          >
            ×
          </button>
        </div>
      ))}
      {problem && <ProblemText code={problem} />}
      <button
        type="button"
        className={`${smallButton} self-start`}
        onClick={() => onChange([...rows, { key: '', value: '' }])}
      >
        {t('playbook.test.editor.addRow')}
      </button>
    </fieldset>
  );
}

function FlagChoices({
  legend,
  chosen,
  problem,
  onChange,
}: {
  legend: string;
  chosen: RiskFlagType[];
  problem: string | null;
  onChange: (flags: RiskFlagType[]) => void;
}): ReactElement {
  const t = useTranslate();
  return (
    <fieldset className="flex flex-col gap-1">
      <legend className="text-xs font-medium">{legend}</legend>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {RISK_FLAG_TYPES.map((flag) => (
          <label key={flag} className="flex items-center gap-1.5 text-2xs">
            <input
              type="checkbox"
              checked={chosen.includes(flag)}
              onChange={(event) =>
                onChange(
                  event.target.checked ? [...chosen, flag] : chosen.filter((f) => f !== flag),
                )
              }
            />
            {t(`inbox.risk.type.${flag}`)}
          </label>
        ))}
      </div>
      {problem && <ProblemText code={problem} />}
    </fieldset>
  );
}
