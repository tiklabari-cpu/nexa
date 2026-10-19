/**
 * The phrases the AI's replies must not carry (tm 301.4 · AI-08): "kesin",
 * "garanti" — matched exactly, as a whole word or by a pattern, in one language
 * or every language, blocking the reply or only recording it.
 *
 * A pattern runs on text a player can steer, in the one process every workspace
 * shares, so the API holds it to a small dialect. The editor asks the very same
 * function the API asks (`forbiddenPhraseProblem`) before the owner saves, and
 * says why in place; the server's refusal (a duplicate, a limit) still lands
 * through the same sentence list.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactElement } from 'react';
import {
  FORBIDDEN_PHRASE_ACTIONS,
  FORBIDDEN_PHRASE_LANG,
  FORBIDDEN_PHRASE_MATCHES,
  FORBIDDEN_PHRASE_MAX,
  FORBIDDEN_PHRASE_REGEX_MAX,
  FORBIDDEN_PHRASES_PER_AGENT_MAX,
  forbiddenPhraseProblem,
  type ForbiddenPhraseAction,
  type ForbiddenPhraseMatch,
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
import type { AiAgent, ForbiddenPhrase } from './types.js';

export const forbiddenPhrasesKey = (agentId: string) =>
  ['playbook', 'guardrails', 'phrases', agentId] as const;

const MATCH_LABEL_KEYS: Record<ForbiddenPhraseMatch, string> = {
  exact: 'playbook.guardrails.phrases.match.exact',
  word: 'playbook.guardrails.phrases.match.word',
  regex: 'playbook.guardrails.phrases.match.regex',
};

const ACTION_LABEL_KEYS: Record<ForbiddenPhraseAction, string> = {
  block: 'playbook.guardrails.phrases.action.block',
  warn: 'playbook.guardrails.phrases.action.warn',
};

interface Draft {
  phrase: string;
  match: ForbiddenPhraseMatch;
  lang: string;
  action: ForbiddenPhraseAction;
  scope: ScopeDraft;
  active: boolean;
}

const NEW_DRAFT: Draft = {
  phrase: '',
  match: 'word',
  lang: '',
  action: 'block',
  scope: NEW_SCOPE_DRAFT,
  active: true,
};

export function ForbiddenPhrases({
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
  const [editing, setEditing] = useState<ForbiddenPhrase | 'new' | null>(null);

  const phrases = useQuery({
    queryKey: forbiddenPhrasesKey(agent.id),
    queryFn: () =>
      api.get<{ items: ForbiddenPhrase[] }>(`/ai-guardrails/phrases?ai_agent_id=${agent.id}`),
  });
  const refresh = () =>
    void queryClient.invalidateQueries({ queryKey: forbiddenPhrasesKey(agent.id) });

  const toggle = useMutation({
    mutationFn: (phrase: ForbiddenPhrase) =>
      api.patch<ForbiddenPhrase>(`/ai-guardrails/phrases/${phrase.id}`, {
        active: !phrase.active,
      }),
    onSuccess: refresh,
  });

  const items = phrases.data?.items ?? [];
  const atLimit = items.length >= FORBIDDEN_PHRASES_PER_AGENT_MAX;

  return (
    <Card>
      <div className="flex flex-col gap-3 p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">{t('playbook.guardrails.phrases.title')}</h2>
            <p className="mt-0.5 text-2xs text-content-tertiary">
              {t('playbook.guardrails.phrases.description')}
            </p>
          </div>
          {canWrite && editing === null && (
            <button
              type="button"
              disabled={atLimit}
              title={
                atLimit
                  ? t('playbook.guardrails.phrases.problem.forbidden_phrases_limit')
                  : undefined
              }
              onClick={() => setEditing('new')}
              className="shrink-0 rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-50"
            >
              {t('playbook.guardrails.phrases.new')}
            </button>
          )}
        </div>

        {editing !== null && (
          <PhraseEditor
            key={editing === 'new' ? 'new' : editing.id}
            agent={agent}
            phrase={editing === 'new' ? null : editing}
            skills={skills}
            onClose={() => setEditing(null)}
            onSaved={() => {
              setEditing(null);
              refresh();
            }}
          />
        )}

        {phrases.isPending ? (
          <CardSkeleton rows={2} />
        ) : phrases.isError ? (
          <LoadError
            compact
            title={t('playbook.guardrails.phrases.loadFailed')}
            error={phrases.error}
            onRetry={() => void phrases.refetch()}
          />
        ) : items.length === 0 ? (
          editing === null && (
            <EmptyState
              title={t('playbook.guardrails.phrases.emptyTitle')}
              description={t('playbook.guardrails.phrases.emptyDescription')}
            />
          )
        ) : (
          <>
            {toggle.isError && <ErrorNotice message={t(guardrailErrorKey(toggle.error))} />}
            <ul role="list" className="divide-y divide-border rounded-md border border-border">
              {items.map((phrase) => (
                <PhraseRow
                  key={phrase.id}
                  phrase={phrase}
                  skills={skills}
                  canWrite={canWrite}
                  busy={toggle.isPending}
                  onToggle={() => toggle.mutate(phrase)}
                  onEdit={() => setEditing(phrase)}
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

function PhraseRow({
  phrase,
  skills,
  canWrite,
  busy,
  onToggle,
  onEdit,
  onDeleted,
}: {
  phrase: ForbiddenPhrase;
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
    mutationFn: () => api.delete(`/ai-guardrails/phrases/${phrase.id}`),
    onSuccess: () => {
      setConfirming(false);
      onDeleted();
    },
  });

  return (
    <li className="flex flex-col gap-1.5 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className={`min-w-0 ${phrase.active ? '' : 'opacity-60'}`}>
          <p className="break-words font-mono text-sm font-medium">{phrase.phrase}</p>
          <p className="mt-1 text-2xs text-content-tertiary">
            {t(MATCH_LABEL_KEYS[phrase.match])} · {t(ACTION_LABEL_KEYS[phrase.action])} ·{' '}
            {phrase.lang
              ? t('playbook.guardrails.phrases.langValue', { lang: phrase.lang })
              : t('playbook.guardrails.phrases.langAll')}{' '}
            · {scopeLabel(phrase.scope, skills, t)}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            role="switch"
            aria-checked={phrase.active}
            aria-label={t('playbook.guardrails.phrases.activeLabel', { phrase: phrase.phrase })}
            disabled={!canWrite || busy}
            onClick={onToggle}
            className={`rounded-full border px-3 py-1 text-2xs transition-colors disabled:opacity-60 ${
              phrase.active
                ? 'border-brand-500 bg-brand-100 text-brand-700 dark:bg-brand-950 dark:text-content'
                : 'border-border text-content-secondary hover:bg-surface-2'
            }`}
          >
            {phrase.active ? t('playbook.guidance.on') : t('playbook.guidance.off')}
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
                  {t('playbook.guardrails.phrases.confirmDelete', { phrase: phrase.phrase })}
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
                  aria-label={t('playbook.guardrails.phrases.editLabel', {
                    phrase: phrase.phrase,
                  })}
                  onClick={onEdit}
                  className="rounded-md border border-border px-2 py-1 text-2xs text-content-secondary hover:bg-surface-2"
                >
                  {t('playbook.guidance.edit')}
                </button>
                <button
                  type="button"
                  aria-label={t('playbook.guardrails.phrases.deleteLabel', {
                    phrase: phrase.phrase,
                  })}
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

function PhraseEditor({
  agent,
  phrase,
  skills,
  onClose,
  onSaved,
}: {
  agent: AiAgent;
  phrase: ForbiddenPhrase | null;
  skills: readonly GuidanceSkillOption[];
  onClose: () => void;
  onSaved: () => void;
}): ReactElement {
  const t = useTranslate();
  const api = useApiClient();
  const [draft, setDraft] = useState<Draft>(
    phrase
      ? {
          phrase: phrase.phrase,
          match: phrase.match,
          lang: phrase.lang ?? '',
          action: phrase.action,
          scope: scopeDraftOf(phrase.scope),
          active: phrase.active,
        }
      : NEW_DRAFT,
  );
  const patch = (changes: Partial<Draft>) => setDraft((previous) => ({ ...previous, ...changes }));

  const text = draft.phrase.trim();
  const lang = draft.lang.trim().toLowerCase();
  const max = draft.match === 'regex' ? FORBIDDEN_PHRASE_REGEX_MAX : FORBIDDEN_PHRASE_MAX;
  const langBad = lang !== '' && !FORBIDDEN_PHRASE_LANG.test(lang);
  // The API's own check, so what is refused here is what it would refuse.
  const problem = text === '' ? null : forbiddenPhraseProblem(text, draft.match);
  const tooLong = text.length > max;
  const valid =
    text !== '' && !tooLong && problem === null && !langBad && !scopeIsEmpty(draft.scope);

  const save = useMutation({
    mutationFn: () => {
      const payload = {
        phrase: text,
        match: draft.match,
        lang: lang === '' ? null : lang,
        scope: scopeOfDraft(draft.scope, phrase ? phrase.scope : null),
        action: draft.action,
        active: draft.active,
      };
      return phrase
        ? api.patch<ForbiddenPhrase>(`/ai-guardrails/phrases/${phrase.id}`, payload)
        : api.post<ForbiddenPhrase>('/ai-guardrails/phrases', {
            ai_agent_id: agent.id,
            ...payload,
          });
    },
    onSuccess: onSaved,
  });

  const heading = phrase
    ? t('playbook.guardrails.phrases.editorEdit')
    : t('playbook.guardrails.phrases.editorNew');

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

      <div className="flex flex-col gap-1">
        <label
          htmlFor="guardrail-phrase-text"
          className="text-2xs font-medium uppercase tracking-wide text-content-tertiary"
        >
          {t('playbook.guardrails.phrases.phraseField')}
        </label>
        <input
          id="guardrail-phrase-text"
          value={draft.phrase}
          onChange={(event) => patch({ phrase: event.target.value })}
          aria-describedby="guardrail-phrase-hint"
          aria-invalid={problem !== null || tooLong ? true : undefined}
          placeholder={t('playbook.guardrails.phrases.phrasePlaceholder')}
          className="rounded-md border border-border bg-inset px-2 py-1.5 font-mono text-sm outline-none placeholder:text-content-tertiary"
        />
        <p
          id="guardrail-phrase-hint"
          className={`text-2xs ${problem !== null || tooLong ? 'text-danger' : 'text-content-tertiary'}`}
        >
          {problem !== null
            ? t(`playbook.guardrails.phrases.problem.${problem.reason}`)
            : tooLong
              ? t('playbook.guardrails.phrases.problem.forbidden_phrase_too_long')
              : t('playbook.guardrails.phrases.phraseHint')}
        </p>
      </div>

      <div className="flex flex-wrap gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor="guardrail-phrase-match" className="text-2xs text-content-secondary">
            {t('playbook.guardrails.phrases.matchField')}
          </label>
          <select
            id="guardrail-phrase-match"
            value={draft.match}
            onChange={(event) => patch({ match: event.target.value as ForbiddenPhraseMatch })}
            className="rounded-md border border-border bg-inset px-2 py-1.5 text-sm text-content outline-none"
          >
            {FORBIDDEN_PHRASE_MATCHES.map((value) => (
              <option key={value} value={value}>
                {t(MATCH_LABEL_KEYS[value])}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="guardrail-phrase-action" className="text-2xs text-content-secondary">
            {t('playbook.guardrails.phrases.actionField')}
          </label>
          <select
            id="guardrail-phrase-action"
            value={draft.action}
            onChange={(event) => patch({ action: event.target.value as ForbiddenPhraseAction })}
            className="rounded-md border border-border bg-inset px-2 py-1.5 text-sm text-content outline-none"
          >
            {FORBIDDEN_PHRASE_ACTIONS.map((value) => (
              <option key={value} value={value}>
                {t(ACTION_LABEL_KEYS[value])}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="guardrail-phrase-lang" className="text-2xs text-content-secondary">
            {t('playbook.guardrails.phrases.langField')}
          </label>
          <input
            id="guardrail-phrase-lang"
            value={draft.lang}
            maxLength={2}
            onChange={(event) => patch({ lang: event.target.value })}
            aria-describedby="guardrail-phrase-lang-hint"
            aria-invalid={langBad ? true : undefined}
            placeholder="tr"
            className="w-20 rounded-md border border-border bg-inset px-2 py-1.5 text-sm outline-none placeholder:text-content-tertiary"
          />
        </div>
      </div>
      <p
        id="guardrail-phrase-lang-hint"
        className={`-mt-1 text-2xs ${langBad ? 'text-danger' : 'text-content-tertiary'}`}
      >
        {t('playbook.guardrails.phrases.langHint')}
      </p>

      <ScopeFields
        name="guardrail-phrase-scope"
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
        {t('playbook.guardrails.phrases.activeField')}
      </label>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={!valid || save.isPending}
          className="rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-50"
        >
          {save.isPending ? t('playbook.guidance.saving') : t('playbook.guardrails.phrases.save')}
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
