/**
 * The AI agent's behaviour rules (tm 299.2 · AI-07).
 *
 * A rule is one plain sentence the workspace writes for its AI — "Ask the
 * method, the amount and the time before suggesting a fix." — with a category,
 * a scope (every conversation, or the turns of some procedures), a priority and
 * an on/off switch. The list is grouped by category because that is how an
 * admin thinks about it ("what have we said about sensitive topics?"); inside a
 * group the most binding rule (priority 1) reads first, as the turn will.
 *
 * Saving never waits on the conflict check, but it does not skip it either:
 * Save runs `POST /ai-guidance/check` first and, when the draft contradicts,
 * repeats or is too vague against the agent's other rules, shows that and asks
 * once more ("Save anyway") — a warning, not a block. The one refusal is a
 * `locked` answer: a rule that tells the AI to ask for a password, make a bonus
 * mandatory or switch off a platform rule would not be applied and the API
 * refuses it, so the editor stops there and says which rule it runs into.
 *
 * Brand scope is shown, not authored: a brand-scoped rule written over the API
 * keeps its scope through an edit, but the turn does not know its brand yet
 * (tm 309), so the editor offers no way to make a new one.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactElement } from 'react';
import {
  DEFAULT_GUIDANCE_PRIORITY,
  GUIDANCE_BODY_MAX,
  GUIDANCE_CATEGORIES,
  GUIDANCE_PRIORITY_MAX,
  GUIDANCE_PRIORITY_MIN,
  GUIDANCE_TITLE_MAX,
  GUIDANCE_TURN_CHARS_MAX,
  GUIDANCE_TURN_RULES_MAX,
  readGuidanceScope,
  type GuidanceCategory,
  type GuidanceScope,
} from '@siyahtus/types';
import { EmptyState } from '../../components/EmptyState.js';
import { LoadError } from '../../components/LoadError.js';
import { Card, CardSkeleton, ErrorNotice } from '../../components/Page.js';
import { errorMessageKey } from '../../lib/api-client.js';
import { useApiClient } from '../../lib/auth-store.js';
import { useTranslate } from '../../lib/i18n.js';
import type { AiAgent, GuidanceCheck, GuidanceRule } from './types.js';

const CATEGORY_LABEL_KEYS: Record<GuidanceCategory, string> = {
  communication: 'playbook.guidance.category.communication',
  clarification: 'playbook.guidance.category.clarification',
  sensitive: 'playbook.guidance.category.sensitive',
  prohibition: 'playbook.guidance.category.prohibition',
  other: 'playbook.guidance.category.other',
};

const LOCKED_LABEL_KEYS: Record<NonNullable<GuidanceCheck['locked']>['locked_rule'], string> = {
  credentials: 'playbook.guidance.locked.credentials',
  mandatory_bonus: 'playbook.guidance.locked.mandatory_bonus',
  disable_locked: 'playbook.guidance.locked.disable_locked',
};

/** The skills a rule can be scoped to — id and name are all the editor needs. */
export interface GuidanceSkillOption {
  id: string;
  name: string;
}

type ScopeMode = 'all' | 'skills' | 'brands';

interface Draft {
  title: string;
  body: string;
  category: GuidanceCategory;
  scopeMode: ScopeMode;
  skillIds: string[];
  priority: string;
  active: boolean;
}

const NEW_DRAFT: Draft = {
  title: '',
  body: '',
  category: 'communication',
  scopeMode: 'all',
  skillIds: [],
  priority: String(DEFAULT_GUIDANCE_PRIORITY),
  active: true,
};

function draftOf(rule: GuidanceRule): Draft {
  const scope = readGuidanceScope(rule.scope);
  return {
    title: rule.title,
    body: rule.body,
    category: rule.category,
    scopeMode:
      scope && 'skill_ids' in scope ? 'skills' : scope && 'brand_ids' in scope ? 'brands' : 'all',
    skillIds: scope && 'skill_ids' in scope ? scope.skill_ids : [],
    priority: String(rule.priority),
    active: rule.active,
  };
}

/** The scope a draft stands for; a brand scope is carried over from the rule as it was. */
function scopeOf(draft: Draft, original: GuidanceRule | null): GuidanceScope {
  if (draft.scopeMode === 'skills') return { skill_ids: draft.skillIds };
  if (draft.scopeMode === 'brands') {
    const kept = original ? readGuidanceScope(original.scope) : null;
    if (kept && 'brand_ids' in kept) return kept;
  }
  return { all: true };
}

function priorityOf(draft: Draft): number | null {
  const value = Number(draft.priority);
  return Number.isInteger(value) && value >= GUIDANCE_PRIORITY_MIN && value <= GUIDANCE_PRIORITY_MAX
    ? value
    : null;
}

function hasWarnings(check: GuidanceCheck): boolean {
  return check.conflicts.length > 0 || check.duplicates.length > 0 || check.vague.length > 0;
}

export function GuidanceRules({
  agent,
  skills,
  canEdit,
}: {
  agent: AiAgent;
  skills: readonly GuidanceSkillOption[];
  canEdit: boolean;
}): ReactElement {
  const t = useTranslate();
  const api = useApiClient();
  const queryClient = useQueryClient();
  // `null` is closed; `'new'` a blank editor; a rule is edited in place.
  const [editing, setEditing] = useState<GuidanceRule | 'new' | null>(null);

  const rules = useQuery({
    queryKey: ['playbook', 'guidance', agent.id],
    queryFn: () => api.get<{ items: GuidanceRule[] }>(`/ai-guidance?ai_agent_id=${agent.id}`),
  });

  const refresh = () =>
    void queryClient.invalidateQueries({ queryKey: ['playbook', 'guidance', agent.id] });

  const toggle = useMutation({
    mutationFn: (rule: GuidanceRule) =>
      api.patch<GuidanceRule>(`/ai-guidance/${rule.id}`, { active: !rule.active }),
    onSuccess: refresh,
  });

  const items = rules.data?.items ?? [];
  const activeCount = items.filter((rule) => rule.active).length;

  return (
    <Card>
      <div className="flex flex-col gap-3 p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">{t('playbook.guidance.title')}</h2>
            <p className="mt-0.5 text-2xs text-content-tertiary">
              {t('playbook.guidance.description', {
                rules: GUIDANCE_TURN_RULES_MAX,
                chars: GUIDANCE_TURN_CHARS_MAX,
              })}
            </p>
          </div>
          {canEdit && editing === null && (
            <button
              type="button"
              onClick={() => setEditing('new')}
              className="shrink-0 rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-600"
            >
              {t('playbook.guidance.new')}
            </button>
          )}
        </div>

        {editing !== null && (
          <RuleEditor
            // A different rule is a different draft; reopening must not carry the last one over.
            key={editing === 'new' ? 'new' : editing.id}
            agent={agent}
            rule={editing === 'new' ? null : editing}
            others={items}
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
            title={t('playbook.guidance.loadFailed')}
            error={rules.error}
            onRetry={() => void rules.refetch()}
          />
        ) : items.length === 0 ? (
          editing === null && (
            <EmptyState
              title={t('playbook.guidance.emptyTitle')}
              description={t('playbook.guidance.emptyDescription')}
            />
          )
        ) : (
          <>
            <p className="text-2xs text-content-secondary">
              {t('playbook.guidance.activeCount', { count: activeCount })}
            </p>
            {toggle.isError && <ErrorNotice message={t(errorMessageKey(toggle.error))} />}
            {GUIDANCE_CATEGORIES.map((category) => {
              const inCategory = items.filter((rule) => rule.category === category);
              if (inCategory.length === 0) return null;
              return (
                <section key={category} aria-labelledby={`guidance-group-${category}`}>
                  <h3
                    id={`guidance-group-${category}`}
                    className="mb-1 text-2xs font-medium uppercase tracking-wide text-content-tertiary"
                  >
                    {t(CATEGORY_LABEL_KEYS[category])}
                  </h3>
                  <ul
                    role="list"
                    className="divide-y divide-border rounded-md border border-border"
                  >
                    {inCategory.map((rule) => (
                      <RuleRow
                        key={rule.id}
                        rule={rule}
                        skills={skills}
                        canEdit={canEdit}
                        busy={toggle.isPending}
                        onToggle={() => toggle.mutate(rule)}
                        onEdit={() => setEditing(rule)}
                        onDeleted={refresh}
                      />
                    ))}
                  </ul>
                </section>
              );
            })}
          </>
        )}
      </div>
    </Card>
  );
}

function scopeLabel(
  rule: GuidanceRule,
  skills: readonly GuidanceSkillOption[],
  t: ReturnType<typeof useTranslate>,
): string {
  const scope = readGuidanceScope(rule.scope);
  if (scope && 'skill_ids' in scope) {
    const names = scope.skill_ids.map(
      (id) =>
        skills.find((skill) => skill.id === id)?.name ?? t('playbook.guidance.scopeUnknownSkill'),
    );
    return t('playbook.guidance.scopeSkills', { names: names.join(', ') });
  }
  if (scope && 'brand_ids' in scope) {
    return t('playbook.guidance.scopeBrands', { count: scope.brand_ids.length });
  }
  return t('playbook.guidance.scopeAll');
}

function RuleRow({
  rule,
  skills,
  canEdit,
  busy,
  onToggle,
  onEdit,
  onDeleted,
}: {
  rule: GuidanceRule;
  skills: readonly GuidanceSkillOption[];
  canEdit: boolean;
  busy: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onDeleted: () => void;
}): ReactElement {
  const t = useTranslate();
  const api = useApiClient();
  const [confirming, setConfirming] = useState(false);

  const remove = useMutation({
    mutationFn: () => api.delete(`/ai-guidance/${rule.id}`),
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
            {scopeLabel(rule, skills, t)} ·{' '}
            {t('playbook.guidance.priorityValue', { priority: rule.priority })}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            role="switch"
            aria-checked={rule.active}
            aria-label={t('playbook.guidance.activeLabel', { title: rule.title })}
            disabled={!canEdit || busy}
            onClick={onToggle}
            className={`rounded-full border px-3 py-1 text-2xs transition-colors disabled:opacity-60 ${
              rule.active
                ? 'border-brand-500 bg-brand-100 text-brand-700 dark:bg-brand-950 dark:text-content'
                : 'border-border text-content-secondary hover:bg-surface-2'
            }`}
          >
            {rule.active ? t('playbook.guidance.on') : t('playbook.guidance.off')}
          </button>
          {canEdit &&
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
                  aria-label={t('playbook.guidance.editLabel', { title: rule.title })}
                  onClick={onEdit}
                  className="rounded-md border border-border px-2 py-1 text-2xs text-content-secondary hover:bg-surface-2"
                >
                  {t('playbook.guidance.edit')}
                </button>
                <button
                  type="button"
                  aria-label={t('playbook.guidance.deleteLabel', { title: rule.title })}
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
          {t(errorMessageKey(remove.error))}
        </p>
      )}
    </li>
  );
}

function RuleEditor({
  agent,
  rule,
  others,
  skills,
  onClose,
  onSaved,
}: {
  agent: AiAgent;
  rule: GuidanceRule | null;
  others: readonly GuidanceRule[];
  skills: readonly GuidanceSkillOption[];
  onClose: () => void;
  onSaved: () => void;
}): ReactElement {
  const t = useTranslate();
  const api = useApiClient();
  const [draft, setDraft] = useState<Draft>(rule ? draftOf(rule) : NEW_DRAFT);
  // The check last run and the draft it was run for: a changed draft makes it stale.
  const [checked, setChecked] = useState<{ result: GuidanceCheck; for: string } | null>(null);

  const patch = (changes: Partial<Draft>) => setDraft((previous) => ({ ...previous, ...changes }));
  const priority = priorityOf(draft);
  const scope = scopeOf(draft, rule);
  const fingerprint = JSON.stringify([draft.title, draft.body, draft.category, scope]);
  const fresh = checked !== null && checked.for === fingerprint ? checked.result : null;

  const body = draft.body.trim();
  const title = draft.title.trim();
  const scopeEmpty = draft.scopeMode === 'skills' && draft.skillIds.length === 0;
  const valid =
    title !== '' &&
    body !== '' &&
    body.length <= GUIDANCE_BODY_MAX &&
    priority !== null &&
    !scopeEmpty;

  const check = useMutation({
    mutationFn: () =>
      api.post<GuidanceCheck>('/ai-guidance/check', {
        ai_agent_id: agent.id,
        ...(rule ? { rule_id: rule.id } : {}),
        title,
        body,
        category: draft.category,
        scope,
      }),
  });

  const save = useMutation({
    mutationFn: () => {
      const payload = {
        title,
        body,
        category: draft.category,
        scope,
        priority,
        active: draft.active,
      };
      return rule
        ? api.patch<GuidanceRule>(`/ai-guidance/${rule.id}`, payload)
        : api.post<GuidanceRule>('/ai-guidance', { ai_agent_id: agent.id, ...payload });
    },
    onSuccess: onSaved,
  });

  /** Runs the check; resolves to the answer, or null when the check itself could not answer. */
  async function runCheck(): Promise<GuidanceCheck | null> {
    try {
      const result = await check.mutateAsync();
      setChecked({ result, for: fingerprint });
      return result;
    } catch {
      // A check that cannot answer never stands between a person and their rule.
      return null;
    }
  }

  async function submit(): Promise<void> {
    if (!valid) return;
    // A check already shown for this very draft is the "Save anyway" click.
    const result = fresh ?? (await runCheck());
    if (result?.locked) return;
    if (result && hasWarnings(result) && fresh === null) return;
    save.mutate();
  }

  const titleOf = (id: string) => others.find((other) => other.id === id)?.title ?? id;
  const busy = check.isPending || save.isPending;
  const overLimit = draft.body.length > GUIDANCE_BODY_MAX;

  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
      aria-label={rule ? t('playbook.guidance.editorEdit') : t('playbook.guidance.editorNew')}
      className="flex flex-col gap-3 rounded-md border border-border bg-surface-2 p-3"
    >
      <h3 className="text-sm font-semibold">
        {rule ? t('playbook.guidance.editorEdit') : t('playbook.guidance.editorNew')}
      </h3>

      <label htmlFor="guidance-title" className="flex flex-col gap-1">
        <span className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
          {t('playbook.guidance.titleField')}
        </span>
        <input
          id="guidance-title"
          value={draft.title}
          maxLength={GUIDANCE_TITLE_MAX}
          onChange={(event) => patch({ title: event.target.value })}
          className="rounded-md border border-border bg-inset px-2 py-1.5 text-sm outline-none"
        />
      </label>

      <div className="flex flex-col gap-1">
        <label
          htmlFor="guidance-body"
          className="text-2xs font-medium uppercase tracking-wide text-content-tertiary"
        >
          {t('playbook.guidance.bodyField')}
        </label>
        <textarea
          id="guidance-body"
          value={draft.body}
          rows={3}
          onChange={(event) => patch({ body: event.target.value })}
          aria-describedby="guidance-body-counter"
          aria-invalid={overLimit ? true : undefined}
          placeholder={t('playbook.guidance.bodyPlaceholder')}
          className="rounded-md border border-border bg-inset px-2 py-1.5 text-sm outline-none placeholder:text-content-tertiary"
        />
        <p
          id="guidance-body-counter"
          className={`text-2xs ${overLimit ? 'text-danger' : 'text-content-tertiary'}`}
        >
          {t('playbook.guidance.counter', { count: draft.body.length, max: GUIDANCE_BODY_MAX })}
        </p>
      </div>

      <div className="flex flex-wrap gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor="guidance-category" className="text-2xs text-content-secondary">
            {t('playbook.guidance.categoryField')}
          </label>
          <select
            id="guidance-category"
            value={draft.category}
            onChange={(event) => patch({ category: event.target.value as GuidanceCategory })}
            className="rounded-md border border-border bg-inset px-2 py-1.5 text-sm text-content outline-none"
          >
            {GUIDANCE_CATEGORIES.map((value) => (
              <option key={value} value={value}>
                {t(CATEGORY_LABEL_KEYS[value])}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="guidance-priority" className="text-2xs text-content-secondary">
            {t('playbook.guidance.priorityField')}
          </label>
          <input
            id="guidance-priority"
            type="number"
            min={GUIDANCE_PRIORITY_MIN}
            max={GUIDANCE_PRIORITY_MAX}
            value={draft.priority}
            onChange={(event) => patch({ priority: event.target.value })}
            aria-invalid={priority === null ? true : undefined}
            className="w-24 rounded-md border border-border bg-inset px-2 py-1.5 text-sm outline-none"
          />
        </div>
      </div>
      <p className="-mt-1 text-2xs text-content-tertiary">{t('playbook.guidance.priorityHint')}</p>

      <fieldset className="flex flex-col gap-1.5">
        <legend className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
          {t('playbook.guidance.scopeField')}
        </legend>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="radio"
            name="guidance-scope"
            checked={draft.scopeMode === 'all'}
            onChange={() => patch({ scopeMode: 'all' })}
          />
          {t('playbook.guidance.scopeAll')}
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="radio"
            name="guidance-scope"
            checked={draft.scopeMode === 'skills'}
            disabled={skills.length === 0}
            onChange={() => patch({ scopeMode: 'skills' })}
          />
          {t('playbook.guidance.scopeSome')}
        </label>
        {draft.scopeMode === 'skills' && (
          <ul role="list" className="ml-6 flex flex-col gap-1">
            {skills.map((skill) => (
              <li key={skill.id}>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={draft.skillIds.includes(skill.id)}
                    onChange={(event) =>
                      patch({
                        skillIds: event.target.checked
                          ? [...draft.skillIds, skill.id]
                          : draft.skillIds.filter((id) => id !== skill.id),
                      })
                    }
                  />
                  {skill.name}
                </label>
              </li>
            ))}
          </ul>
        )}
        {draft.scopeMode === 'brands' && (
          <p className="ml-6 text-2xs text-content-tertiary">
            {t('playbook.guidance.scopeBrandsKept')}
          </p>
        )}
        {scopeEmpty && (
          <p role="alert" className="ml-6 text-2xs text-danger">
            {t('playbook.guidance.scopeEmpty')}
          </p>
        )}
      </fieldset>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={draft.active}
          onChange={(event) => patch({ active: event.target.checked })}
        />
        {t('playbook.guidance.activeField')}
      </label>

      <CheckPanel result={fresh} titleOf={titleOf} />

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={!valid || busy}
          className="rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-50"
        >
          {save.isPending
            ? t('playbook.guidance.saving')
            : fresh && hasWarnings(fresh) && !fresh.locked
              ? t('playbook.guidance.saveAnyway')
              : t('playbook.guidance.save')}
        </button>
        <button
          type="button"
          disabled={!valid || busy}
          onClick={() => void runCheck()}
          className="rounded-md border border-border px-3 py-1.5 text-sm text-content-secondary hover:bg-surface disabled:opacity-50"
        >
          {check.isPending ? t('playbook.guidance.checking') : t('playbook.guidance.check')}
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
            {t(errorMessageKey(save.error))}
          </span>
        )}
      </div>
    </form>
  );
}

/** What the conflict check found for the draft on screen; nothing before one has run. */
function CheckPanel({
  result,
  titleOf,
}: {
  result: GuidanceCheck | null;
  titleOf: (ruleId: string) => string;
}): ReactElement | null {
  const t = useTranslate();
  if (result === null) return null;
  const clean = !result.locked && !hasWarnings(result);

  return (
    <section
      aria-label={t('playbook.guidance.checkTitle')}
      className="flex flex-col gap-1.5 rounded-md border border-border bg-surface p-3 text-sm"
    >
      <h4 className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
        {t('playbook.guidance.checkTitle')}
      </h4>
      {result.locked && (
        <div role="alert" className="text-danger">
          <p className="font-medium">{t(LOCKED_LABEL_KEYS[result.locked.locked_rule])}</p>
          <p className="text-2xs">{result.locked.explanation}</p>
          <p className="text-2xs">{t('playbook.guidance.lockedHint')}</p>
        </div>
      )}
      {result.conflicts.length > 0 && (
        <div>
          <p className="font-medium">{t('playbook.guidance.conflicts')}</p>
          <ul role="list" className="list-disc pl-5 text-content-secondary">
            {result.conflicts.map((conflict) => (
              <li key={`${conflict.rule_id}-${conflict.explanation}`}>
                <span className="font-medium">{titleOf(conflict.rule_id)}</span>:{' '}
                {conflict.explanation}
              </li>
            ))}
          </ul>
        </div>
      )}
      {result.duplicates.length > 0 && (
        <div>
          <p className="font-medium">{t('playbook.guidance.duplicates')}</p>
          <ul role="list" className="list-disc pl-5 text-content-secondary">
            {result.duplicates.map((duplicate) => (
              <li key={`${duplicate.rule_id}-${duplicate.explanation}`}>
                <span className="font-medium">{titleOf(duplicate.rule_id)}</span>:{' '}
                {duplicate.explanation}
              </li>
            ))}
          </ul>
        </div>
      )}
      {result.vague.length > 0 && (
        <div>
          <p className="font-medium">{t('playbook.guidance.vague')}</p>
          <ul role="list" className="list-disc pl-5 text-content-secondary">
            {result.vague.map((item) => (
              <li key={item.explanation}>{item.explanation}</li>
            ))}
          </ul>
        </div>
      )}
      {clean && (
        <p className="text-content-secondary">
          {t('playbook.guidance.checkClean', { count: result.compared })}
        </p>
      )}
      {!clean && !result.locked && (
        <p className="text-2xs text-content-tertiary">{t('playbook.guidance.warningsHint')}</p>
      )}
    </section>
  );
}
