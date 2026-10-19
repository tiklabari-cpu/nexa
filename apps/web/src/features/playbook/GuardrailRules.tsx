/**
 * The workspace's own compliance rules (tm 301.4 · AI-08): extra lines for the
 * prompt's second layer, each able to block a draft or force a hand-over.
 *
 * They are stricter than the platform's, never looser: a rule that would switch
 * a locked one off, ask for a password or make a bonus mandatory is refused by
 * the API (403 `guardrail_platform_locked`) and the editor says so in place. The
 * owner writes; an admin reads the list without the buttons.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactElement } from 'react';
import {
  GUARDRAIL_CATEGORIES,
  GUARDRAIL_RULE_ACTIONS,
  GUARDRAIL_RULE_BODY_MAX,
  GUARDRAIL_RULE_TITLE_MAX,
  GUARDRAIL_RULES_PER_AGENT_MAX,
  type GuardrailCategory,
  type GuardrailRuleAction,
} from '@siyahtus/types';
import { EmptyState } from '../../components/EmptyState.js';
import { LoadError } from '../../components/LoadError.js';
import { Card, CardSkeleton, ErrorNotice } from '../../components/Page.js';
import { useApiClient } from '../../lib/auth-store.js';
import { useTranslate } from '../../lib/i18n.js';
import type { GuidanceSkillOption } from './GuidanceRules.js';
import { ScopeFields, scopeLabel } from './GuardrailScope.js';
import {
  guardrailErrorKey,
  scopeDraftOf,
  scopeIsEmpty,
  scopeOfDraft,
  NEW_SCOPE_DRAFT,
  type ScopeDraft,
} from './guardrails.js';
import { CATEGORY_LABEL_KEYS } from './PlatformGuardrailList.js';
import type { AiAgent, GuardrailRule } from './types.js';

export const guardrailRulesKey = (agentId: string) =>
  ['playbook', 'guardrails', 'rules', agentId] as const;

const ACTION_LABEL_KEYS: Record<GuardrailRuleAction, string> = {
  prompt_only: 'playbook.guardrails.rules.action.prompt_only',
  block_output: 'playbook.guardrails.rules.action.block_output',
  force_handoff: 'playbook.guardrails.rules.action.force_handoff',
};

const ACTION_HINT_KEYS: Record<GuardrailRuleAction, string> = {
  prompt_only: 'playbook.guardrails.rules.actionHint.prompt_only',
  block_output: 'playbook.guardrails.rules.actionHint.block_output',
  force_handoff: 'playbook.guardrails.rules.actionHint.force_handoff',
};

interface Draft {
  title: string;
  body: string;
  category: GuardrailCategory;
  action: GuardrailRuleAction;
  scope: ScopeDraft;
  active: boolean;
}

const NEW_DRAFT: Draft = {
  title: '',
  body: '',
  category: 'responsible_gaming',
  action: 'prompt_only',
  scope: NEW_SCOPE_DRAFT,
  active: true,
};

export function GuardrailRules({
  agent,
  skills,
  canWrite,
}: {
  agent: AiAgent;
  skills: readonly GuidanceSkillOption[];
  canWrite: boolean;
}): ReactElement {
  const t = useTranslate();
  const api = useApiClient();
  const queryClient = useQueryClient();
  // `null` is closed; `'new'` a blank editor; a rule is edited in place.
  const [editing, setEditing] = useState<GuardrailRule | 'new' | null>(null);

  const rules = useQuery({
    queryKey: guardrailRulesKey(agent.id),
    queryFn: () =>
      api.get<{ items: GuardrailRule[] }>(`/ai-guardrails/rules?ai_agent_id=${agent.id}`),
  });
  const refresh = () =>
    void queryClient.invalidateQueries({ queryKey: guardrailRulesKey(agent.id) });

  const toggle = useMutation({
    mutationFn: (rule: GuardrailRule) =>
      api.patch<GuardrailRule>(`/ai-guardrails/rules/${rule.id}`, { active: !rule.active }),
    onSuccess: refresh,
  });

  const items = rules.data?.items ?? [];
  const atLimit = items.length >= GUARDRAIL_RULES_PER_AGENT_MAX;

  return (
    <Card>
      <div className="flex flex-col gap-3 p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">{t('playbook.guardrails.rules.title')}</h2>
            <p className="mt-0.5 text-2xs text-content-tertiary">
              {t('playbook.guardrails.rules.description')}
            </p>
          </div>
          {canWrite && editing === null && (
            <button
              type="button"
              disabled={atLimit}
              title={atLimit ? t('playbook.guardrails.rules.limit') : undefined}
              onClick={() => setEditing('new')}
              className="shrink-0 rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-50"
            >
              {t('playbook.guardrails.rules.new')}
            </button>
          )}
        </div>

        {editing !== null && (
          <RuleEditor
            key={editing === 'new' ? 'new' : editing.id}
            agent={agent}
            rule={editing === 'new' ? null : editing}
            skills={skills}
            onClose={() => setEditing(null)}
            onSaved={() => {
              setEditing(null);
              refresh();
            }}
          />
        )}

        {rules.isPending ? (
          <CardSkeleton rows={2} />
        ) : rules.isError ? (
          <LoadError
            compact
            title={t('playbook.guardrails.rules.loadFailed')}
            error={rules.error}
            onRetry={() => void rules.refetch()}
          />
        ) : items.length === 0 ? (
          editing === null && (
            <EmptyState
              title={t('playbook.guardrails.rules.emptyTitle')}
              description={t('playbook.guardrails.rules.emptyDescription')}
            />
          )
        ) : (
          <>
            {toggle.isError && <ErrorNotice message={t(guardrailErrorKey(toggle.error))} />}
            <ul role="list" className="divide-y divide-border rounded-md border border-border">
              {items.map((rule) => (
                <RuleRow
                  key={rule.id}
                  rule={rule}
                  skills={skills}
                  canWrite={canWrite}
                  busy={toggle.isPending}
                  onToggle={() => toggle.mutate(rule)}
                  onEdit={() => setEditing(rule)}
                  onDeleted={refresh}
                />
              ))}
            </ul>
          </>
        )}
      </div>
    </Card>
  );
}

function RuleRow({
  rule,
  skills,
  canWrite,
  busy,
  onToggle,
  onEdit,
  onDeleted,
}: {
  rule: GuardrailRule;
  skills: readonly GuidanceSkillOption[];
  canWrite: boolean;
  busy: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onDeleted: () => void;
}): ReactElement {
  const t = useTranslate();
  const api = useApiClient();
  const [confirming, setConfirming] = useState(false);

  const remove = useMutation({
    mutationFn: () => api.delete(`/ai-guardrails/rules/${rule.id}`),
    onSuccess: () => {
      setConfirming(false);
      onDeleted();
    },
  });

  return (
    <li className="flex flex-col gap-1.5 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className={`min-w-0 ${rule.active ? '' : 'opacity-60'}`}>
          <p className="text-sm font-medium">{rule.title}</p>
          <p className="mt-0.5 whitespace-pre-wrap text-sm text-content-secondary">{rule.body}</p>
          <p className="mt-1 text-2xs text-content-tertiary">
            {t(CATEGORY_LABEL_KEYS[rule.category])} · {t(ACTION_LABEL_KEYS[rule.action])} ·{' '}
            {scopeLabel(rule.scope, skills, t)}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            role="switch"
            aria-checked={rule.active}
            aria-label={t('playbook.guardrails.rules.activeLabel', { title: rule.title })}
            disabled={!canWrite || busy}
            onClick={onToggle}
            className={`rounded-full border px-3 py-1 text-2xs transition-colors disabled:opacity-60 ${
              rule.active
                ? 'border-brand-500 bg-brand-100 text-brand-700 dark:bg-brand-950 dark:text-content'
                : 'border-border text-content-secondary hover:bg-surface-2'
            }`}
          >
            {rule.active ? t('playbook.guidance.on') : t('playbook.guidance.off')}
          </button>
          {canWrite &&
            (confirming ? (
              <>
                <button
                  type="button"
                  disabled={remove.isPending}
                  onClick={() => remove.mutate()}
                  className="rounded-md bg-danger px-2 py-1 text-2xs font-medium text-white disabled:opacity-60"
                >
                  {t('playbook.guidance.confirmDelete', { title: rule.title })}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirming(false)}
                  className="rounded-md border border-border px-2 py-1 text-2xs text-content-secondary hover:bg-surface-2"
                >
                  {t('playbook.guidance.cancel')}
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  aria-label={t('playbook.guardrails.rules.editLabel', { title: rule.title })}
                  onClick={onEdit}
                  className="rounded-md border border-border px-2 py-1 text-2xs text-content-secondary hover:bg-surface-2"
                >
                  {t('playbook.guidance.edit')}
                </button>
                <button
                  type="button"
                  aria-label={t('playbook.guardrails.rules.deleteLabel', { title: rule.title })}
                  onClick={() => setConfirming(true)}
                  className="rounded-md border border-border px-2 py-1 text-2xs text-danger hover:bg-surface-2"
                >
                  {t('playbook.guidance.delete')}
                </button>
              </>
            ))}
        </div>
      </div>
      {remove.isError && (
        <p role="alert" className="text-2xs text-danger">
          {t(guardrailErrorKey(remove.error))}
        </p>
      )}
    </li>
  );
}

function RuleEditor({
  agent,
  rule,
  skills,
  onClose,
  onSaved,
}: {
  agent: AiAgent;
  rule: GuardrailRule | null;
  skills: readonly GuidanceSkillOption[];
  onClose: () => void;
  onSaved: () => void;
}): ReactElement {
  const t = useTranslate();
  const api = useApiClient();
  const [draft, setDraft] = useState<Draft>(
    rule
      ? {
          title: rule.title,
          body: rule.body,
          category: rule.category,
          action: rule.action,
          scope: scopeDraftOf(rule.scope),
          active: rule.active,
        }
      : NEW_DRAFT,
  );
  const patch = (changes: Partial<Draft>) => setDraft((previous) => ({ ...previous, ...changes }));

  const title = draft.title.trim();
  const body = draft.body.trim();
  const overLimit = draft.body.length > GUARDRAIL_RULE_BODY_MAX;
  const valid = title !== '' && body !== '' && !overLimit && !scopeIsEmpty(draft.scope);

  const save = useMutation({
    mutationFn: () => {
      const payload = {
        title,
        body,
        category: draft.category,
        action: draft.action,
        scope: scopeOfDraft(draft.scope, rule ? rule.scope : null),
        active: draft.active,
      };
      return rule
        ? api.patch<GuardrailRule>(`/ai-guardrails/rules/${rule.id}`, payload)
        : api.post<GuardrailRule>('/ai-guardrails/rules', { ai_agent_id: agent.id, ...payload });
    },
    onSuccess: onSaved,
  });

  const heading = rule
    ? t('playbook.guardrails.rules.editorEdit')
    : t('playbook.guardrails.rules.editorNew');

  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (valid) save.mutate();
      }}
      aria-label={heading}
      className="flex flex-col gap-3 rounded-md border border-border bg-surface-2 p-3"
    >
      <h3 className="text-sm font-semibold">{heading}</h3>

      <label htmlFor="guardrail-rule-title" className="flex flex-col gap-1">
        <span className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
          {t('playbook.guidance.titleField')}
        </span>
        <input
          id="guardrail-rule-title"
          value={draft.title}
          maxLength={GUARDRAIL_RULE_TITLE_MAX}
          onChange={(event) => patch({ title: event.target.value })}
          className="rounded-md border border-border bg-inset px-2 py-1.5 text-sm outline-none"
        />
      </label>

      <div className="flex flex-col gap-1">
        <label
          htmlFor="guardrail-rule-body"
          className="text-2xs font-medium uppercase tracking-wide text-content-tertiary"
        >
          {t('playbook.guidance.bodyField')}
        </label>
        <textarea
          id="guardrail-rule-body"
          value={draft.body}
          rows={3}
          onChange={(event) => patch({ body: event.target.value })}
          aria-describedby="guardrail-rule-counter"
          aria-invalid={overLimit ? true : undefined}
          placeholder={t('playbook.guardrails.rules.bodyPlaceholder')}
          className="rounded-md border border-border bg-inset px-2 py-1.5 text-sm outline-none placeholder:text-content-tertiary"
        />
        <p
          id="guardrail-rule-counter"
          className={`text-2xs ${overLimit ? 'text-danger' : 'text-content-tertiary'}`}
        >
          {t('playbook.guidance.counter', {
            count: draft.body.length,
            max: GUARDRAIL_RULE_BODY_MAX,
          })}
        </p>
      </div>

      <div className="flex flex-wrap gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor="guardrail-rule-category" className="text-2xs text-content-secondary">
            {t('playbook.guidance.categoryField')}
          </label>
          <select
            id="guardrail-rule-category"
            value={draft.category}
            onChange={(event) => patch({ category: event.target.value as GuardrailCategory })}
            className="rounded-md border border-border bg-inset px-2 py-1.5 text-sm text-content outline-none"
          >
            {GUARDRAIL_CATEGORIES.map((value) => (
              <option key={value} value={value}>
                {t(CATEGORY_LABEL_KEYS[value])}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="guardrail-rule-action" className="text-2xs text-content-secondary">
            {t('playbook.guardrails.rules.actionField')}
          </label>
          <select
            id="guardrail-rule-action"
            value={draft.action}
            aria-describedby="guardrail-rule-action-hint"
            onChange={(event) => patch({ action: event.target.value as GuardrailRuleAction })}
            className="rounded-md border border-border bg-inset px-2 py-1.5 text-sm text-content outline-none"
          >
            {GUARDRAIL_RULE_ACTIONS.map((value) => (
              <option key={value} value={value}>
                {t(ACTION_LABEL_KEYS[value])}
              </option>
            ))}
          </select>
        </div>
      </div>
      <p id="guardrail-rule-action-hint" className="-mt-1 text-2xs text-content-tertiary">
        {t(ACTION_HINT_KEYS[draft.action])}
      </p>

      <ScopeFields
        name="guardrail-rule-scope"
        draft={draft.scope}
        skills={skills}
        onChange={(scope) => patch({ scope })}
      />

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={draft.active}
          onChange={(event) => patch({ active: event.target.checked })}
        />
        {t('playbook.guidance.activeField')}
      </label>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={!valid || save.isPending}
          className="rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-50"
        >
          {save.isPending ? t('playbook.guidance.saving') : t('playbook.guidance.save')}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md px-3 py-1.5 text-sm text-content-secondary hover:bg-surface"
        >
          {t('playbook.guidance.cancel')}
        </button>
        {save.isError && (
          <span role="alert" className="text-2xs text-danger">
            {t(guardrailErrorKey(save.error))}
          </span>
        )}
      </div>
    </form>
  );
}
