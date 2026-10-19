/**
 * The workspace's hand-over rules (tm 303.5 · AI-09, owner decision K9): the
 * "Devir kuralları" card of the hand-over settings.
 *
 * An ordered list — the first active rule that matches decides — headed by the
 * platform's locked compliance rules (G1–G5, G13, G15), greyed out, always on,
 * never moved. An admin adds rules (a topic, a procedure, a phrase, a risk flag
 * hand the conversation over themselves; "the AI could not solve it" and "the
 * player asked for a person" only say where it goes), turns them on and off,
 * edits and deletes them, and drags them into order — or moves them with the
 * buttons, for everyone the drag excludes. The three ready-made rules of K9
 * are offered, not installed: an active "deposit → finance" rule takes every
 * deposit question away from the AI's own procedure, so the admin chooses it.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactElement } from 'react';
import {
  HANDOFF_RULE_PHRASE_MAX,
  HANDOFF_RULE_TITLE_MAX,
  HANDOFF_RULE_TRIGGER_TYPES,
  HANDOFF_RULES_PER_AGENT_MAX,
  type HandoffRulePriority,
  type HandoffRuleTarget,
  type HandoffRuleTriggerType,
} from '@siyahtus/types';
import { EmptyState } from '../../components/EmptyState.js';
import { LoadError } from '../../components/LoadError.js';
import { Card, CardSkeleton } from '../../components/Page.js';
import { useApiClient } from '../../lib/auth-store.js';
import { useLocale, useTranslate, type TFunction } from '../../lib/i18n.js';
import {
  BLANK_RULE_DRAFT,
  RISK_FLAG_OPTIONS,
  TOPIC_OPTIONS,
  defaultTriggerValue,
  draftOfRule,
  exampleBody,
  exampleInstalled,
  handoffErrorKey,
  handoffRulesKey,
  reorderedIds,
  ruleBody,
  ruleDraftProblems,
  targetDraft,
  targetOfDraft,
  triggerTakesValue,
  type HandoffRule,
  type HandoffRuleList,
  type RuleDraft,
} from './handoff.js';
import {
  Select,
  TargetField,
  inputClass,
  smallButton,
  type TeamOption,
} from './ProcedureSections.js';
import type { AiAgent } from './types.js';

/** A skill a `procedure` rule can name. */
export interface HandoffSkillOption {
  id: string;
  name: string;
  mode?: string;
}

const PRIORITIES: readonly HandoffRulePriority[] = ['urgent', 'high', 'normal'];

function priorityLabel(t: TFunction, priority: HandoffRulePriority): string {
  return t(`playbook.handoff.rules.priority.${priority}`);
}

function targetText(
  t: TFunction,
  target: HandoffRuleTarget | null,
  teams: readonly TeamOption[],
): string {
  if (target === null) return t('playbook.handoff.rules.targetRoutes');
  if ('group_id' in target) {
    const team = teams.find((candidate) => candidate.id === target.group_id);
    return team ? team.name : t('playbook.procedure.targetUnknownTeam');
  }
  return t('playbook.handoff.rules.targetTopic', { topic: target.topic });
}

function triggerText(
  t: TFunction,
  trigger: HandoffRule['trigger'],
  skills: readonly HandoffSkillOption[],
): string {
  switch (trigger.type) {
    case 'topic':
      return t('playbook.handoff.rules.when.topic', {
        topic: t(`playbook.handoff.topic.${trigger.value}`),
      });
    case 'risk_flag':
      return t('playbook.handoff.rules.when.risk_flag', {
        flag: t(`inbox.risk.type.${trigger.value}`),
      });
    case 'procedure':
      return t('playbook.handoff.rules.when.procedure', {
        name:
          skills.find((skill) => skill.id === trigger.value)?.name ??
          t('playbook.handoff.rules.procedureUnknown'),
      });
    case 'phrase':
      return t('playbook.handoff.rules.when.phrase', { phrase: trigger.value });
    default:
      return t(`playbook.handoff.rules.when.${trigger.type}`);
  }
}

export function HandoffRules({
  agent,
  skills,
  canEdit,
}: {
  agent: AiAgent;
  skills: readonly HandoffSkillOption[];
  canEdit: boolean;
}): ReactElement {
  const t = useTranslate();
  const { locale } = useLocale();
  const api = useApiClient();
  const queryClient = useQueryClient();
  // `null` is closed; `'new'` a blank form; a rule is edited in place.
  const [editing, setEditing] = useState<HandoffRule | 'new' | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [announcement, setAnnouncement] = useState('');

  const base = `/ai-agents/${agent.id}/handoff-rules`;
  const list = useQuery({
    queryKey: handoffRulesKey(agent.id),
    queryFn: () => api.get<HandoffRuleList>(base),
  });
  const teams = useQuery({
    queryKey: ['playbook', 'teams'],
    queryFn: () => api.get<{ items: TeamOption[] }>('/groups'),
    staleTime: 60_000,
  });
  const teamItems = teams.data?.items ?? [];
  const procedures = skills.filter((skill) => skill.mode === 'procedure');

  const refresh = () => void queryClient.invalidateQueries({ queryKey: handoffRulesKey(agent.id) });

  const toggle = useMutation({
    mutationFn: (rule: HandoffRule) =>
      api.patch<HandoffRule>(`${base}/${rule.id}`, { active: !rule.active }),
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: (rule: HandoffRule) => api.delete(`${base}/${rule.id}`),
    onSuccess: refresh,
  });
  const reorder = useMutation({
    mutationFn: (ids: string[]) => api.put<HandoffRuleList>(`${base}/order`, { rule_ids: ids }),
    onSuccess: (saved) => queryClient.setQueryData(handoffRulesKey(agent.id), saved),
  });
  const addExample = useMutation({
    mutationFn: (body: ReturnType<typeof exampleBody>) => api.post<HandoffRule>(base, body),
    onSuccess: refresh,
  });

  const items = list.data?.items ?? [];
  const examples = (list.data?.examples ?? []).filter(
    (example) => !exampleInstalled(example, items),
  );
  const failure = toggle.error ?? remove.error ?? reorder.error ?? addExample.error;

  function move(from: number, to: number): void {
    const rule = items[from];
    const clamped = Math.max(0, Math.min(to, items.length - 1));
    if (!canEdit || !rule || clamped === from || reorder.isPending) return;
    setAnnouncement(
      t('playbook.handoff.rules.moveAnnouncement', {
        title: rule.title,
        position: clamped + 1,
        total: items.length,
      }),
    );
    reorder.mutate(reorderedIds(items, from, clamped));
  }

  return (
    <Card>
      <div className="flex flex-col gap-3 p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold">{t('playbook.handoff.rules.title')}</h3>
            <p className="mt-0.5 text-2xs text-content-tertiary">
              {t('playbook.handoff.rules.description')}
            </p>
          </div>
          {canEdit && editing === null && items.length < HANDOFF_RULES_PER_AGENT_MAX && (
            <button
              type="button"
              onClick={() => setEditing('new')}
              className="shrink-0 rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-600"
            >
              {t('playbook.handoff.rules.new')}
            </button>
          )}
        </div>

        {list.isPending ? (
          <CardSkeleton rows={3} />
        ) : list.isError ? (
          <LoadError
            compact
            title={t('playbook.handoff.rules.loadFailed')}
            error={list.error}
            onRetry={() => void list.refetch()}
          />
        ) : (
          <>
            {editing !== null && (
              <RuleForm
                key={editing === 'new' ? 'new' : editing.id}
                agentId={agent.id}
                rule={editing === 'new' ? null : editing}
                teams={teamItems}
                procedures={procedures}
                onClose={() => setEditing(null)}
                onSaved={() => {
                  setEditing(null);
                  refresh();
                }}
              />
            )}

            <ul
              aria-label={t('playbook.handoff.rules.lockedTitle')}
              className="flex flex-col gap-1.5"
            >
              {list.data.locked.map((rule) => (
                <li
                  key={rule.id}
                  data-testid={`handoff-locked-${rule.id}`}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-content-tertiary"
                >
                  <span aria-hidden="true">🔒</span>
                  <span className="font-medium text-content-secondary">
                    {rule.id} · {rule.title[locale]}
                  </span>
                  <span className="text-2xs">
                    {rule.reason === null
                      ? t('playbook.handoff.rules.blocksOnly')
                      : `${targetText(t, rule.target, teamItems)} · ${priorityLabel(t, rule.priority)}`}
                  </span>
                  <span className="ml-auto text-2xs">{t('playbook.handoff.locked.badge')}</span>
                </li>
              ))}
            </ul>

            {items.length === 0 ? (
              <EmptyState
                title={t('playbook.handoff.rules.emptyTitle')}
                description={t('playbook.handoff.rules.emptyDescription')}
              />
            ) : (
              <ol
                aria-label={t('playbook.handoff.rules.listLabel')}
                className="flex flex-col gap-1.5"
              >
                {items.map((rule, index) => (
                  <li
                    key={rule.id}
                    data-testid={`handoff-rule-${rule.id}`}
                    onDragOver={(event) => {
                      if (canEdit && dragIndex !== null) event.preventDefault();
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      if (dragIndex !== null) move(dragIndex, index);
                      setDragIndex(null);
                    }}
                    className={`flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-border px-3 py-2 ${
                      dragIndex === index ? 'opacity-50' : ''
                    } ${rule.active ? '' : 'text-content-tertiary'}`}
                  >
                    {canEdit && (
                      // Only the handle drags, not the row: a draggable row would
                      // turn selecting its text into a drag.
                      <span
                        draggable
                        onDragStart={() => setDragIndex(index)}
                        onDragEnd={() => setDragIndex(null)}
                        aria-hidden="true"
                        className="cursor-grab select-none text-content-tertiary"
                      >
                        ⠿
                      </span>
                    )}
                    <span className="text-2xs tabular-nums text-content-tertiary">{index + 1}</span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{rule.title}</p>
                      <p className="truncate text-2xs text-content-tertiary">
                        {triggerText(t, rule.trigger, skills)} →{' '}
                        {targetText(t, rule.target, teamItems)} · {priorityLabel(t, rule.priority)}
                      </p>
                    </div>
                    <label className="flex items-center gap-1.5 text-2xs">
                      <input
                        type="checkbox"
                        checked={rule.active}
                        disabled={!canEdit || toggle.isPending}
                        aria-label={t('playbook.handoff.rules.activeLabel', { title: rule.title })}
                        onChange={() => toggle.mutate(rule)}
                      />
                      {t('playbook.handoff.rules.active')}
                    </label>
                    {canEdit && (
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          disabled={index === 0 || reorder.isPending}
                          aria-label={t('playbook.handoff.rules.moveUp', { title: rule.title })}
                          onClick={() => move(index, index - 1)}
                          className={smallButton}
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          disabled={index === items.length - 1 || reorder.isPending}
                          aria-label={t('playbook.handoff.rules.moveDown', { title: rule.title })}
                          onClick={() => move(index, index + 1)}
                          className={smallButton}
                        >
                          ↓
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditing(rule)}
                          aria-label={t('playbook.handoff.rules.edit', { title: rule.title })}
                          className={smallButton}
                        >
                          {t('playbook.handoff.rules.editShort')}
                        </button>
                        <button
                          type="button"
                          disabled={remove.isPending}
                          onClick={() => {
                            if (
                              window.confirm(
                                t('playbook.handoff.rules.deleteConfirm', { title: rule.title }),
                              )
                            ) {
                              remove.mutate(rule);
                            }
                          }}
                          aria-label={t('playbook.handoff.rules.delete', { title: rule.title })}
                          className={`${smallButton} hover:text-danger`}
                        >
                          {t('playbook.handoff.rules.deleteShort')}
                        </button>
                      </div>
                    )}
                  </li>
                ))}
              </ol>
            )}
            <p role="status" className="sr-only">
              {announcement}
            </p>

            {failure && (
              <p role="alert" className="text-2xs text-danger">
                {t(handoffErrorKey(failure))}
              </p>
            )}

            {canEdit && examples.length > 0 && (
              <section
                aria-label={t('playbook.handoff.rules.examplesTitle')}
                className="flex flex-col gap-1.5"
              >
                <h4 className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
                  {t('playbook.handoff.rules.examplesTitle')}
                </h4>
                <p className="text-2xs text-content-tertiary">
                  {t('playbook.handoff.rules.examplesHint')}
                </p>
                <ul className="flex flex-col gap-1.5">
                  {examples.map((example) => (
                    <li
                      key={example.key}
                      className="flex flex-wrap items-center gap-3 rounded-md border border-dashed border-border px-3 py-2 text-sm"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">{example.title[locale]}</p>
                        <p className="truncate text-2xs text-content-tertiary">
                          {triggerText(t, example.trigger, skills)} →{' '}
                          {targetText(t, example.target, teamItems)} ·{' '}
                          {priorityLabel(t, example.priority)}
                        </p>
                      </div>
                      <button
                        type="button"
                        disabled={addExample.isPending}
                        aria-label={t('playbook.handoff.rules.addExample', {
                          title: example.title[locale],
                        })}
                        onClick={() => addExample.mutate(exampleBody(example, locale))}
                        className={smallButton}
                      >
                        {t('playbook.handoff.rules.addExampleShort')}
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {!canEdit && (
              <p className="text-2xs text-content-tertiary">{t('playbook.handoff.readOnly')}</p>
            )}
          </>
        )}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// The form.
// ---------------------------------------------------------------------------

function RuleForm({
  agentId,
  rule,
  teams,
  procedures,
  onClose,
  onSaved,
}: {
  agentId: string;
  rule: HandoffRule | null;
  teams: readonly TeamOption[];
  procedures: readonly HandoffSkillOption[];
  onClose: () => void;
  onSaved: () => void;
}): ReactElement {
  const t = useTranslate();
  const api = useApiClient();
  const [draft, setDraft] = useState<RuleDraft>(() =>
    rule ? draftOfRule(rule) : BLANK_RULE_DRAFT,
  );
  const [showProblems, setShowProblems] = useState(false);
  const problems = ruleDraftProblems(draft);

  const save = useMutation({
    mutationFn: () =>
      rule
        ? api.patch<HandoffRule>(`/ai-agents/${agentId}/handoff-rules/${rule.id}`, ruleBody(draft))
        : api.post<HandoffRule>(`/ai-agents/${agentId}/handoff-rules`, ruleBody(draft)),
    onSuccess: onSaved,
  });

  const set = (patch: Partial<RuleDraft>) => setDraft((current) => ({ ...current, ...patch }));
  const idPrefix = rule ? `handoff-rule-${rule.id}` : 'handoff-rule-new';
  const heading = rule ? t('playbook.handoff.rules.formEdit') : t('playbook.handoff.rules.formNew');

  return (
    <form
      noValidate
      aria-label={heading}
      onSubmit={(event) => {
        event.preventDefault();
        if (problems.length > 0) setShowProblems(true);
        else save.mutate();
      }}
      className="flex flex-col gap-3 rounded-md border border-border p-3"
    >
      <h4 className="text-sm font-semibold">{heading}</h4>

      <label htmlFor={`${idPrefix}-title`} className="flex flex-col gap-1">
        <span className="text-2xs text-content-tertiary">
          {t('playbook.handoff.rules.fieldTitle')}
        </span>
        <input
          id={`${idPrefix}-title`}
          value={draft.title}
          maxLength={HANDOFF_RULE_TITLE_MAX * 2}
          onChange={(event) => set({ title: event.target.value })}
          className={`w-full max-w-md ${inputClass}`}
        />
      </label>

      <div className="flex flex-wrap items-end gap-3">
        <Select<HandoffRuleTriggerType>
          id={`${idPrefix}-trigger`}
          label={t('playbook.handoff.rules.fieldTrigger')}
          value={draft.triggerType}
          disabled={false}
          options={HANDOFF_RULE_TRIGGER_TYPES.map(
            (type) => [type, t(`playbook.handoff.rules.type.${type}`)] as const,
          )}
          onChange={(triggerType) =>
            set({ triggerType, triggerValue: defaultTriggerValue(triggerType) })
          }
          className="w-64"
        />

        {draft.triggerType === 'topic' && (
          <Select
            id={`${idPrefix}-value`}
            label={t('playbook.handoff.rules.fieldTopic')}
            value={draft.triggerValue}
            disabled={false}
            options={TOPIC_OPTIONS.map(
              (topic) => [topic, t(`playbook.handoff.topic.${topic}`)] as const,
            )}
            onChange={(triggerValue) => set({ triggerValue })}
          />
        )}
        {draft.triggerType === 'risk_flag' && (
          <Select
            id={`${idPrefix}-value`}
            label={t('playbook.handoff.rules.fieldRiskFlag')}
            value={draft.triggerValue}
            disabled={false}
            options={RISK_FLAG_OPTIONS.map((flag) => [flag, t(`inbox.risk.type.${flag}`)] as const)}
            onChange={(triggerValue) => set({ triggerValue })}
          />
        )}
        {draft.triggerType === 'procedure' && (
          <Select
            id={`${idPrefix}-value`}
            label={t('playbook.handoff.rules.fieldProcedure')}
            value={draft.triggerValue}
            disabled={false}
            options={[
              ['', t('playbook.handoff.rules.choose')] as const,
              ...procedures.map((skill) => [skill.id, skill.name] as const),
              // A procedure the list no longer has stays selectable.
              ...(draft.triggerValue !== '' &&
              !procedures.some((skill) => skill.id === draft.triggerValue)
                ? ([[draft.triggerValue, t('playbook.handoff.rules.procedureUnknown')]] as const)
                : []),
            ]}
            onChange={(triggerValue) => set({ triggerValue })}
          />
        )}
        {draft.triggerType === 'phrase' && (
          <div className="flex flex-col gap-1">
            {/* Sibling label, not a wrapper: the hint would fold into the field's name. */}
            <label htmlFor={`${idPrefix}-value`} className="text-2xs text-content-tertiary">
              {t('playbook.handoff.rules.fieldPhrase')}
            </label>
            <input
              id={`${idPrefix}-value`}
              value={draft.triggerValue}
              maxLength={HANDOFF_RULE_PHRASE_MAX * 2}
              aria-describedby={`${idPrefix}-phrase-hint`}
              onChange={(event) => set({ triggerValue: event.target.value })}
              className={`w-72 ${inputClass}`}
            />
            <span id={`${idPrefix}-phrase-hint`} className="text-2xs text-content-tertiary">
              {t('playbook.handoff.rules.phraseHint')}
            </span>
          </div>
        )}
      </div>
      {!triggerTakesValue(draft.triggerType) && (
        <p className="text-2xs text-content-tertiary">
          {t(`playbook.handoff.rules.routingHint.${draft.triggerType}`)}
        </p>
      )}

      <TargetField
        id={`${idPrefix}-target`}
        target={targetOfDraft(draft) ?? undefined}
        teams={teams}
        canEdit
        onChange={(target) => set(targetDraft(target === undefined ? null : target))}
      />

      <Select<HandoffRulePriority>
        id={`${idPrefix}-priority`}
        label={t('playbook.handoff.rules.fieldPriority')}
        value={draft.priority}
        disabled={false}
        options={PRIORITIES.map((priority) => [priority, priorityLabel(t, priority)] as const)}
        onChange={(priority) => set({ priority })}
        className="w-40"
      />

      {showProblems && problems.length > 0 && (
        <ul role="alert" className="flex flex-col gap-0.5 text-2xs text-danger">
          {problems.map((key) => (
            <li key={key}>{t(key)}</li>
          ))}
        </ul>
      )}
      {save.isError && (
        <p role="alert" className="text-2xs text-danger">
          {t(handoffErrorKey(save.error))}
        </p>
      )}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={save.isPending}
          className="rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-50"
        >
          {save.isPending ? t('playbook.handoff.saving') : t('playbook.handoff.rules.save')}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md border border-border px-3 py-1.5 text-sm text-content-secondary hover:bg-surface-2"
        >
          {t('playbook.handoff.rules.cancel')}
        </button>
      </div>
    </form>
  );
}
