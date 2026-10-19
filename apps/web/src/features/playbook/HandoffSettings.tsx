/**
 * The AI agent's hand-over settings (tm 303.5 · AI-09, owner decision K9):
 * Playbook › AI Agent › Behaviour › Hand-over. Four cards, one per thing an
 * admin decides:
 *
 *   - **when** the agent hands over on its own — the compliance triggers
 *     greyed out and locked, the others with their thresholds — and whether a
 *     conversation opens with the agent or with a person;
 *   - **what the player is told**, by reason, in the workspace's own words;
 *   - **where it goes** — the ordered rule list (`HandoffRules.tsx`);
 *   - **when it counts as solved** — the default "resolved" criteria (a
 *     procedure may carry its own, in the procedure editor).
 *
 * The first, second and last card share `GET|PUT …/handoff-settings`; each
 * saves only what it shows (the route merges the rest). A refetch landing
 * while an admin is typing never overwrites the edit: a card seeds its fields
 * from the server only until the first keystroke.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type ReactElement, type ReactNode } from 'react';
import {
  AI_STALL_TIMEOUT_SECONDS_MAX,
  AI_STALL_TIMEOUT_SECONDS_MIN,
  DEFAULT_HANDOFF_AFTER_HOURS_TEXT,
  DEFAULT_HANDOFF_MESSAGES,
  HANDOFF_MESSAGE_MAX,
  HANDOFF_MESSAGE_REASONS,
  HANDOFF_TRIGGER_BOUNDS,
  LOCKED_HANDOFF_REASONS,
  type Cond,
  type HandoffMessageReason,
} from '@siyahtus/types';
import { LoadError } from '../../components/LoadError.js';
import { Card, CardSkeleton } from '../../components/Page.js';
import { useApiClient } from '../../lib/auth-store.js';
import { useLocale, useTranslate } from '../../lib/i18n.js';
import { HandoffRules, type HandoffSkillOption } from './HandoffRules.js';
import {
  afterHoursChanged,
  handoffErrorKey,
  handoffSettingsKey,
  messagesChange,
  messagesFormOf,
  resolutionProblem,
  triggersBody,
  triggersFormChanged,
  triggersFormOf,
  triggersProblems,
  type HandoffSettings as Settings,
  type MessagesForm,
  type TriggersForm,
} from './handoff.js';
import { NumberInput, ResolutionCriteriaField, procedureProblemText } from './ProcedureSections.js';
import type { AiAgent } from './types.js';

const saveButton =
  'rounded-md border border-border px-3 py-1.5 text-sm text-content-secondary hover:bg-surface-2 disabled:opacity-50';

/** The hand-over cards of one customer-facing agent. */
export function HandoffSettings({
  agent,
  skills,
  canEdit,
}: {
  agent: AiAgent;
  skills: readonly HandoffSkillOption[];
  canEdit: boolean;
}): ReactElement {
  const t = useTranslate();
  return (
    <section
      aria-label={t('playbook.handoff.title')}
      data-testid="handoff-settings"
      className="flex flex-col gap-4"
    >
      <div>
        <h2 className="text-sm font-semibold">{t('playbook.handoff.title')}</h2>
        <p className="mt-0.5 text-2xs text-content-tertiary">{t('playbook.handoff.description')}</p>
      </div>
      <TriggersCard agent={agent} canEdit={canEdit} />
      <MessagesCard agent={agent} canEdit={canEdit} />
      <HandoffRules agent={agent} skills={skills} canEdit={canEdit} />
      <ResolutionCard agent={agent} canEdit={canEdit} />
    </section>
  );
}

/** The settings of the agent, shared by the cards that edit them. */
function useHandoffSettings(agent: AiAgent) {
  const api = useApiClient();
  const queryClient = useQueryClient();
  const settings = useQuery({
    queryKey: handoffSettingsKey(agent.id),
    queryFn: () => api.get<Settings>(`/ai-agents/${agent.id}/handoff-settings`),
  });
  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api.put<Settings>(`/ai-agents/${agent.id}/handoff-settings`, body),
    onSuccess: (saved) => queryClient.setQueryData(handoffSettingsKey(agent.id), saved),
  });
  return { settings, save };
}

function CardShell({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}): ReactElement {
  return (
    <Card>
      <div className="flex flex-col gap-3 p-4">
        <div>
          <h3 className="text-sm font-semibold">{title}</h3>
          <p className="mt-0.5 text-2xs text-content-tertiary">{description}</p>
        </div>
        {children}
      </div>
    </Card>
  );
}

function CardLoading({
  settings,
}: {
  settings: ReturnType<typeof useHandoffSettings>['settings'];
}): ReactElement | null {
  const t = useTranslate();
  if (settings.isPending) return <CardSkeleton rows={3} />;
  if (settings.isError) {
    return (
      <LoadError
        compact
        title={t('playbook.handoff.loadFailed')}
        error={settings.error}
        onRetry={() => void settings.refetch()}
      />
    );
  }
  return null;
}

// ---------------------------------------------------------------------------
// When the agent hands over.
// ---------------------------------------------------------------------------

function TriggersCard({ agent, canEdit }: { agent: AiAgent; canEdit: boolean }): ReactElement {
  const t = useTranslate();
  const { settings, save } = useHandoffSettings(agent);
  const [form, setForm] = useState<TriggersForm | null>(null);
  const [touched, setTouched] = useState(false);

  const data = settings.data;
  useEffect(() => {
    if (data && !touched) setForm(triggersFormOf(data));
  }, [data, touched]);

  const edit = (update: (current: TriggersForm) => TriggersForm) => {
    setTouched(true);
    setForm((current) => (current ? update(current) : current));
  };

  const problems = form ? triggersProblems(form) : [];
  const dirty = data !== undefined && form !== null && triggersFormChanged(form, data);
  const triggers = form?.triggers;
  const b = HANDOFF_TRIGGER_BOUNDS;

  return (
    <CardShell
      title={t('playbook.handoff.triggers.title')}
      description={t('playbook.handoff.triggers.description')}
    >
      <CardLoading settings={settings} />
      {form && triggers && (
        <form
          noValidate
          aria-label={t('playbook.handoff.triggers.title')}
          onSubmit={(event) => {
            event.preventDefault();
            if (dirty && problems.length === 0) {
              save.mutate(triggersBody(form), { onSuccess: () => setTouched(false) });
            }
          }}
          className="flex flex-col gap-4"
        >
          <fieldset className="flex flex-col gap-2">
            <legend className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
              {t('playbook.handoff.assignment.title')}
            </legend>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="radio"
                name="handoff-assignment"
                checked={form.assignmentMode === 'ai_first'}
                disabled={!canEdit}
                onChange={() => edit((f) => ({ ...f, assignmentMode: 'ai_first' }))}
              />
              <span>
                {t('playbook.handoff.assignment.aiFirst')}
                <span className="block text-2xs text-content-tertiary">
                  {t('playbook.handoff.assignment.aiFirstHint')}
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="radio"
                name="handoff-assignment"
                checked={form.assignmentMode === 'parallel'}
                disabled={!canEdit}
                onChange={() => edit((f) => ({ ...f, assignmentMode: 'parallel' }))}
              />
              <span>
                {t('playbook.handoff.assignment.parallel')}
                <span className="block text-2xs text-content-tertiary">
                  {t('playbook.handoff.assignment.parallelHint')}
                </span>
              </span>
            </label>
            {form.assignmentMode === 'ai_first' && (
              <NumberField
                id="handoff-stall"
                label={t('playbook.handoff.assignment.stall')}
                hint={t('playbook.handoff.count.hint', {
                  min: AI_STALL_TIMEOUT_SECONDS_MIN,
                  max: AI_STALL_TIMEOUT_SECONDS_MAX,
                })}
                value={form.stallSeconds}
                disabled={!canEdit}
                invalid={problems.includes('stallSeconds')}
                onChange={(stallSeconds) => edit((f) => ({ ...f, stallSeconds }))}
              />
            )}
          </fieldset>

          <section aria-label={t('playbook.handoff.locked.title')} className="flex flex-col gap-1">
            <h4 className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
              {t('playbook.handoff.locked.title')}
            </h4>
            <p className="text-2xs text-content-tertiary">{t('playbook.handoff.locked.hint')}</p>
            <ul className="flex flex-col gap-1 text-sm text-content-secondary">
              {LOCKED_HANDOFF_REASONS.map((reason) => (
                <li key={reason} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked
                    disabled
                    readOnly
                    aria-label={t(reasonKey(reason))}
                  />
                  <span>{t(reasonKey(reason))}</span>
                  <span className="text-2xs text-content-tertiary">
                    {t('playbook.handoff.locked.badge')}
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <fieldset className="flex flex-col gap-3">
            <legend className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
              {t('playbook.handoff.triggers.tunable')}
            </legend>

            <TriggerRow
              name={t(reasonKey('not_understood'))}
              hint={t('playbook.handoff.triggers.notUnderstoodHint')}
              enabled={triggers.not_understood.enabled}
              disabled={!canEdit}
              onEnabled={(enabled) =>
                edit((f) => ({
                  ...f,
                  triggers: {
                    ...f.triggers,
                    not_understood: { ...f.triggers.not_understood, enabled },
                  },
                }))
              }
            >
              <NumberField
                id="handoff-not-understood-turns"
                label={t('playbook.handoff.triggers.notUnderstoodTurns')}
                hint={t('playbook.handoff.count.hint', {
                  min: b.not_understood_turns.min,
                  max: b.not_understood_turns.max,
                })}
                value={triggers.not_understood.turns}
                disabled={!canEdit || !triggers.not_understood.enabled}
                invalid={problems.includes('notUnderstoodTurns')}
                onChange={(turns) =>
                  edit((f) => ({
                    ...f,
                    triggers: {
                      ...f.triggers,
                      not_understood: { ...f.triggers.not_understood, turns },
                    },
                  }))
                }
              />
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={triggers.not_understood.ask_first}
                  disabled={!canEdit || !triggers.not_understood.enabled}
                  onChange={(event) =>
                    edit((f) => ({
                      ...f,
                      triggers: {
                        ...f.triggers,
                        not_understood: {
                          ...f.triggers.not_understood,
                          ask_first: event.target.checked,
                        },
                      },
                    }))
                  }
                />
                {t('playbook.handoff.triggers.askFirst')}
              </label>
            </TriggerRow>

            <TriggerRow
              name={t(reasonKey('negative_sentiment'))}
              hint={t('playbook.handoff.triggers.negativeHint')}
              enabled={triggers.negative_sentiment.enabled}
              disabled={!canEdit}
              onEnabled={(enabled) =>
                edit((f) => ({
                  ...f,
                  triggers: {
                    ...f.triggers,
                    negative_sentiment: { ...f.triggers.negative_sentiment, enabled },
                  },
                }))
              }
            >
              <NumberField
                id="handoff-negative-consecutive"
                label={t('playbook.handoff.triggers.negativeConsecutive')}
                hint={t('playbook.handoff.count.hint', {
                  min: b.negative_sentiment_consecutive.min,
                  max: b.negative_sentiment_consecutive.max,
                })}
                value={triggers.negative_sentiment.consecutive}
                disabled={!canEdit || !triggers.negative_sentiment.enabled}
                invalid={problems.includes('negativeConsecutive')}
                onChange={(consecutive) =>
                  edit((f) => ({
                    ...f,
                    triggers: {
                      ...f.triggers,
                      negative_sentiment: { ...f.triggers.negative_sentiment, consecutive },
                    },
                  }))
                }
              />
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={triggers.negative_sentiment.ask_first}
                  disabled={!canEdit || !triggers.negative_sentiment.enabled}
                  onChange={(event) =>
                    edit((f) => ({
                      ...f,
                      triggers: {
                        ...f.triggers,
                        negative_sentiment: {
                          ...f.triggers.negative_sentiment,
                          ask_first: event.target.checked,
                        },
                      },
                    }))
                  }
                />
                {t('playbook.handoff.triggers.askFirst')}
              </label>
            </TriggerRow>

            <TriggerRow
              name={t(reasonKey('abuse'))}
              hint={t('playbook.handoff.triggers.abuseHint')}
              enabled
              locked
              disabled={!canEdit}
            >
              <NumberField
                id="handoff-abuse-warnings"
                label={t('playbook.handoff.triggers.abuseWarnings')}
                hint={t('playbook.handoff.count.hint', {
                  min: b.abuse_warnings.min,
                  max: b.abuse_warnings.max,
                })}
                value={triggers.abuse.warnings}
                disabled={!canEdit}
                invalid={problems.includes('abuseWarnings')}
                onChange={(warnings) =>
                  edit((f) => ({ ...f, triggers: { ...f.triggers, abuse: { warnings } } }))
                }
              />
            </TriggerRow>

            <TriggerRow
              name={t(reasonKey('loop_detected'))}
              hint={t('playbook.handoff.triggers.loopHint')}
              enabled={triggers.loop_detected.enabled}
              disabled={!canEdit}
              onEnabled={(enabled) =>
                edit((f) => ({ ...f, triggers: { ...f.triggers, loop_detected: { enabled } } }))
              }
            />

            <TriggerRow
              name={t(reasonKey('max_turns'))}
              hint={t('playbook.handoff.triggers.maxTurnsHint')}
              enabled={triggers.max_turns.enabled}
              disabled={!canEdit}
              onEnabled={(enabled) =>
                edit((f) => ({
                  ...f,
                  triggers: { ...f.triggers, max_turns: { ...f.triggers.max_turns, enabled } },
                }))
              }
            >
              <NumberField
                id="handoff-max-turns"
                label={t('playbook.handoff.triggers.maxTurnsTurns')}
                hint={t('playbook.handoff.count.hint', {
                  min: b.max_turns.min,
                  max: b.max_turns.max,
                })}
                value={triggers.max_turns.turns}
                disabled={!canEdit || !triggers.max_turns.enabled}
                invalid={problems.includes('maxTurns')}
                onChange={(turns) =>
                  edit((f) => ({
                    ...f,
                    triggers: { ...f.triggers, max_turns: { ...f.triggers.max_turns, turns } },
                  }))
                }
              />
            </TriggerRow>

            <TriggerRow
              name={t(reasonKey('repeat_same_day'))}
              hint={t('playbook.handoff.triggers.repeatHint')}
              enabled={triggers.repeat_same_day.enabled}
              disabled={!canEdit}
              onEnabled={(enabled) =>
                edit((f) => ({ ...f, triggers: { ...f.triggers, repeat_same_day: { enabled } } }))
              }
            />
          </fieldset>

          <SaveBar
            canEdit={canEdit}
            dirty={dirty}
            valid={problems.length === 0}
            pending={save.isPending}
            error={save.isError ? save.error : null}
            label={t('playbook.handoff.triggers.save')}
          />
        </form>
      )}
    </CardShell>
  );
}

function TriggerRow({
  name,
  hint,
  enabled,
  locked = false,
  disabled,
  onEnabled,
  children,
}: {
  name: string;
  hint: string;
  enabled: boolean;
  /** Always on: shown ticked and not switchable (the count below it still is). */
  locked?: boolean;
  disabled: boolean;
  onEnabled?: (enabled: boolean) => void;
  children?: ReactNode;
}): ReactElement {
  const t = useTranslate();
  return (
    <div className="flex flex-col gap-2 rounded-md border border-border p-3">
      <label className="flex items-center gap-2 text-sm font-medium">
        <input
          type="checkbox"
          checked={enabled}
          disabled={disabled || locked}
          onChange={(event) => onEnabled?.(event.target.checked)}
        />
        {name}
        {locked && (
          <span className="text-2xs font-normal text-content-tertiary">
            {t('playbook.handoff.locked.badge')}
          </span>
        )}
      </label>
      <p className="text-2xs text-content-tertiary">{hint}</p>
      {children && <div className="flex flex-wrap items-end gap-4">{children}</div>}
    </div>
  );
}

function NumberField({
  id,
  label,
  hint,
  value,
  disabled,
  invalid,
  onChange,
}: {
  id: string;
  label: string;
  hint: string;
  value: number;
  disabled: boolean;
  invalid: boolean;
  onChange: (value: number) => void;
}): ReactElement {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-2xs text-content-tertiary">
        {label}
      </label>
      <NumberInput
        id={id}
        value={value}
        disabled={disabled}
        describedBy={`${id}-hint`}
        onChange={onChange}
      />
      <span
        id={`${id}-hint`}
        className={`text-2xs ${invalid ? 'text-danger' : 'text-content-tertiary'}`}
      >
        {hint}
      </span>
    </div>
  );
}

function SaveBar({
  canEdit,
  dirty,
  valid,
  pending,
  error,
  label,
}: {
  canEdit: boolean;
  dirty: boolean;
  valid: boolean;
  pending: boolean;
  error: unknown;
  label: string;
}): ReactElement {
  const t = useTranslate();
  if (!canEdit) {
    return <p className="text-2xs text-content-tertiary">{t('playbook.handoff.readOnly')}</p>;
  }
  const problem = error ? resolutionProblem(error) : null;
  return (
    <div className="flex flex-wrap items-center gap-3">
      <button type="submit" disabled={!dirty || !valid || pending} className={saveButton}>
        {pending ? t('playbook.handoff.saving') : label}
      </button>
      {error !== null && (
        <span role="alert" className="text-2xs text-danger">
          {problem ? procedureProblemText(t, problem) : t(handoffErrorKey(error))}
        </span>
      )}
    </div>
  );
}

/** The catalogue key naming one hand-over reason. */
function reasonKey(reason: string): string {
  return `playbook.handoff.reason.${reason}`;
}

// ---------------------------------------------------------------------------
// What the player is told.
// ---------------------------------------------------------------------------

function MessagesCard({ agent, canEdit }: { agent: AiAgent; canEdit: boolean }): ReactElement {
  const t = useTranslate();
  const { locale } = useLocale();
  const { settings, save } = useHandoffSettings(agent);
  const [form, setForm] = useState<MessagesForm | null>(null);
  const [afterHours, setAfterHours] = useState('');
  const [touched, setTouched] = useState(false);

  const data = settings.data;
  useEffect(() => {
    if (!data || touched) return;
    setForm(messagesFormOf(data));
    setAfterHours(data.after_hours.text ?? '');
  }, [data, touched]);

  const change = data && form ? messagesChange(form, data) : {};
  const changed = Object.keys(change).length > 0;
  const afterChanged = data ? afterHoursChanged(afterHours, data) : false;
  const dirty = changed || afterChanged;
  const tooLong =
    afterHours.length > HANDOFF_MESSAGE_MAX ||
    (form !== null && Object.values(form).some((text) => text.length > HANDOFF_MESSAGE_MAX));

  return (
    <CardShell
      title={t('playbook.handoff.messages.title')}
      description={t('playbook.handoff.messages.description')}
    >
      <CardLoading settings={settings} />
      {form && (
        <form
          noValidate
          aria-label={t('playbook.handoff.messages.title')}
          onSubmit={(event) => {
            event.preventDefault();
            if (!dirty || tooLong) return;
            save.mutate(
              {
                ...(changed ? { messages: change } : {}),
                ...(afterChanged
                  ? { after_hours: { text: afterHours.trim() === '' ? null : afterHours.trim() } }
                  : {}),
              },
              { onSuccess: () => setTouched(false) },
            );
          }}
          className="flex flex-col gap-3"
        >
          <p className="text-2xs text-content-tertiary">
            {t('playbook.handoff.messages.guardrailNote')}
          </p>
          <ul className="flex flex-col gap-1">
            {HANDOFF_MESSAGE_REASONS.map((reason) => (
              <MessageRow
                key={reason}
                reason={reason}
                value={form[reason]}
                placeholder={DEFAULT_HANDOFF_MESSAGES[reason][locale]}
                disabled={!canEdit}
                onChange={(text) => {
                  setTouched(true);
                  setForm((current) => (current ? { ...current, [reason]: text } : current));
                }}
              />
            ))}
          </ul>

          <div className="flex flex-col gap-1">
            <label
              htmlFor="handoff-after-hours"
              className="text-2xs font-medium uppercase tracking-wide text-content-tertiary"
            >
              {t('playbook.handoff.messages.afterHours')}
            </label>
            <textarea
              id="handoff-after-hours"
              value={afterHours}
              rows={3}
              readOnly={!canEdit}
              aria-describedby="handoff-after-hours-hint"
              aria-invalid={afterHours.length > HANDOFF_MESSAGE_MAX ? true : undefined}
              placeholder={DEFAULT_HANDOFF_AFTER_HOURS_TEXT[locale]}
              onChange={(event) => {
                setTouched(true);
                setAfterHours(event.target.value);
              }}
              className="rounded-md border border-border bg-inset px-2 py-1.5 text-sm outline-none placeholder:text-content-tertiary"
            />
            <p id="handoff-after-hours-hint" className="text-2xs text-content-tertiary">
              {t('playbook.handoff.messages.afterHoursHint')}
            </p>
          </div>

          <SaveBar
            canEdit={canEdit}
            dirty={dirty}
            valid={!tooLong}
            pending={save.isPending}
            error={save.isError ? save.error : null}
            label={t('playbook.handoff.messages.save')}
          />
        </form>
      )}
    </CardShell>
  );
}

function MessageRow({
  reason,
  value,
  placeholder,
  disabled,
  onChange,
}: {
  reason: HandoffMessageReason;
  value: string;
  placeholder: string;
  disabled: boolean;
  onChange: (text: string) => void;
}): ReactElement {
  const t = useTranslate();
  const id = `handoff-message-${reason}`;
  const over = value.length > HANDOFF_MESSAGE_MAX;
  return (
    <li>
      <details className="rounded-md border border-border px-3 py-2">
        <summary className="flex cursor-pointer items-center gap-2 text-sm">
          <span>{t(reasonKey(reason))}</span>
          {value.trim() !== '' && (
            <span className="text-2xs text-content-tertiary">
              {t('playbook.handoff.messages.custom')}
            </span>
          )}
        </summary>
        <div className="mt-2 flex flex-col gap-1">
          <label htmlFor={id} className="sr-only">
            {t('playbook.handoff.messages.field', { reason: t(reasonKey(reason)) })}
          </label>
          <textarea
            id={id}
            value={value}
            rows={2}
            readOnly={disabled}
            placeholder={placeholder}
            aria-invalid={over ? true : undefined}
            aria-describedby={`${id}-counter`}
            onChange={(event) => onChange(event.target.value)}
            className="rounded-md border border-border bg-inset px-2 py-1.5 text-sm outline-none placeholder:text-content-tertiary"
          />
          <p
            id={`${id}-counter`}
            className={`text-2xs ${over ? 'text-danger' : 'text-content-tertiary'}`}
          >
            {t('playbook.guidance.counter', { count: value.length, max: HANDOFF_MESSAGE_MAX })}
          </p>
        </div>
      </details>
    </li>
  );
}

// ---------------------------------------------------------------------------
// When it counts as solved.
// ---------------------------------------------------------------------------

function ResolutionCard({ agent, canEdit }: { agent: AiAgent; canEdit: boolean }): ReactElement {
  const t = useTranslate();
  const { settings, save } = useHandoffSettings(agent);
  const [criteria, setCriteria] = useState<Cond | null>(null);
  const [touched, setTouched] = useState(false);

  const data = settings.data;
  useEffect(() => {
    if (data && !touched) setCriteria(data.resolution_criteria);
  }, [data, touched]);

  const dirty =
    data !== undefined &&
    JSON.stringify(criteria ?? null) !== JSON.stringify(data.resolution_criteria ?? null);

  return (
    <CardShell
      title={t('playbook.handoff.resolution.title')}
      description={t('playbook.handoff.resolution.description')}
    >
      <CardLoading settings={settings} />
      {data && (
        <form
          noValidate
          aria-label={t('playbook.handoff.resolution.title')}
          onSubmit={(event) => {
            event.preventDefault();
            if (dirty)
              save.mutate(
                { resolution_criteria: criteria },
                { onSuccess: () => setTouched(false) },
              );
          }}
          className="flex flex-col gap-3"
        >
          <ResolutionCriteriaField
            // Remounting on a fresh read drops the JSON box's own text.
            key={data.resolution_criteria === null ? 'platform' : 'custom'}
            idPrefix="handoff-resolution"
            scope="workspace"
            value={criteria}
            slots={[]}
            canEdit={canEdit}
            onChange={(next) => {
              setTouched(true);
              setCriteria(next ?? null);
            }}
          />
          <SaveBar
            canEdit={canEdit}
            dirty={dirty}
            valid
            pending={save.isPending}
            error={save.isError ? save.error : null}
            label={t('playbook.handoff.resolution.save')}
          />
        </form>
      )}
    </CardShell>
  );
}
