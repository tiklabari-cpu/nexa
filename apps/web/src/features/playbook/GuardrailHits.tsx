/**
 * What the guardrails caught (tm 301.4 · AI-08): every rule a turn found
 * broken, newest first, with what the turn did about it.
 *
 * The log opens on the last 30 days (the API's default) and pages with "Load
 * more". A hit names its rule as the platform's `G3`, a workspace rule or a
 * forbidden phrase — read back through the catalogue and the two lists, so a
 * deleted rule still shows as itself rather than as an id. The evidence is
 * already masked at the source; the screen only quotes it. Admins read this
 * log, so nothing here needs the owner role.
 */
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useState, type ReactElement } from 'react';
import { Link } from 'react-router-dom';
import {
  GUARDRAIL_HIT_ACTIONS,
  readGuardrailHitRuleKey,
  type GuardrailHitAction,
} from '@siyahtus/types';
import { EmptyState } from '../../components/EmptyState.js';
import { LoadError } from '../../components/LoadError.js';
import { Card, CardSkeleton } from '../../components/Page.js';
import { useApiClient } from '../../lib/auth-store.js';
import { formatDateTime } from '../../lib/format.js';
import { useLocale, useTranslate, type TFunction } from '../../lib/i18n.js';
import { forbiddenPhrasesKey } from './ForbiddenPhrases.js';
import { guardrailRulesKey } from './GuardrailRules.js';
import { usePlatformGuardrails } from './PlatformGuardrailList.js';
import type { AiAgent, ForbiddenPhrase, GuardrailHitRecord, GuardrailRule } from './types.js';

const PAGE_SIZE = 25;

const ACTION_LABEL_KEYS: Record<GuardrailHitAction, string> = {
  handoff: 'playbook.guardrails.hits.action.handoff',
  crisis_text: 'playbook.guardrails.hits.action.crisis_text',
  rewrite: 'playbook.guardrails.hits.action.rewrite',
  safe_text: 'playbook.guardrails.hits.action.safe_text',
  prompt_block: 'playbook.guardrails.hits.action.prompt_block',
  warn: 'playbook.guardrails.hits.action.warn',
  evidence: 'playbook.guardrails.hits.action.evidence',
};

interface HitsPage {
  items: GuardrailHitRecord[];
  next_page_id?: string;
}

export function GuardrailHits({ agent }: { agent: AiAgent }): ReactElement {
  const t = useTranslate();
  const { locale } = useLocale();
  const api = useApiClient();
  const [ruleKey, setRuleKey] = useState('');
  const [stage, setStage] = useState<'' | 'input' | 'output'>('');

  const catalogue = usePlatformGuardrails();
  // The same keys the two sections above read, so these are cache hits.
  const rules = useQuery({
    queryKey: guardrailRulesKey(agent.id),
    queryFn: () =>
      api.get<{ items: GuardrailRule[] }>(`/ai-guardrails/rules?ai_agent_id=${agent.id}`),
  });
  const phrases = useQuery({
    queryKey: forbiddenPhrasesKey(agent.id),
    queryFn: () =>
      api.get<{ items: ForbiddenPhrase[] }>(`/ai-guardrails/phrases?ai_agent_id=${agent.id}`),
  });

  const hits = useInfiniteQuery({
    queryKey: ['playbook', 'guardrails', 'hits', ruleKey, stage],
    queryFn: ({ pageParam }: { pageParam: string | undefined }) => {
      const query = new URLSearchParams({ limit: String(PAGE_SIZE) });
      if (ruleKey) query.set('rule_key', ruleKey);
      if (stage) query.set('stage', stage);
      if (pageParam) query.set('page_id', pageParam);
      return api.get<HitsPage>(`/ai-guardrails/hits?${query.toString()}`);
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.next_page_id,
  });

  const platformRules = catalogue.data?.rules ?? [];
  const workspaceRules = rules.data?.items ?? [];
  const workspacePhrases = phrases.data?.items ?? [];

  /** A hit's rule in words: "G3 · Self-harm", a rule's title, a phrase in quotes. */
  function ruleName(key: string): string {
    const rule = readGuardrailHitRuleKey(key);
    if (rule?.source === 'platform') {
      const found = platformRules.find((candidate) => candidate.id === rule.id);
      return found ? `${rule.id} · ${found.title[locale]}` : rule.id;
    }
    if (rule?.source === 'rule') {
      const found = workspaceRules.find((candidate) => candidate.id === rule.id);
      return found ? found.title : t('playbook.guardrails.hits.removedRule');
    }
    if (rule?.source === 'phrase') {
      const found = workspacePhrases.find((candidate) => candidate.id === rule.id);
      return found
        ? t('playbook.guardrails.hits.phraseName', { phrase: found.phrase })
        : t('playbook.guardrails.hits.removedPhrase');
    }
    return key;
  }

  const items = hits.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <Card>
      <div className="flex flex-col gap-3 p-4">
        <div>
          <h2 className="text-sm font-semibold">{t('playbook.guardrails.hits.title')}</h2>
          <p className="mt-0.5 text-2xs text-content-tertiary">
            {t('playbook.guardrails.hits.description')}
          </p>
        </div>

        <div className="flex flex-wrap gap-3">
          <div className="flex flex-col gap-1">
            <label htmlFor="guardrail-hits-rule" className="text-2xs text-content-secondary">
              {t('playbook.guardrails.hits.ruleFilter')}
            </label>
            <select
              id="guardrail-hits-rule"
              value={ruleKey}
              onChange={(event) => setRuleKey(event.target.value)}
              className="max-w-xs rounded-md border border-border bg-inset px-2 py-1.5 text-sm text-content outline-none"
            >
              <option value="">{t('playbook.guardrails.hits.allRules')}</option>
              {platformRules.map((rule) => (
                <option key={rule.id} value={rule.id}>
                  {ruleName(rule.id)}
                </option>
              ))}
              {workspaceRules.map((rule) => (
                <option key={rule.id} value={`rule:${rule.id}`}>
                  {rule.title}
                </option>
              ))}
              {workspacePhrases.map((phrase) => (
                <option key={phrase.id} value={`phrase:${phrase.id}`}>
                  {t('playbook.guardrails.hits.phraseName', { phrase: phrase.phrase })}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="guardrail-hits-stage" className="text-2xs text-content-secondary">
              {t('playbook.guardrails.hits.stageFilter')}
            </label>
            <select
              id="guardrail-hits-stage"
              value={stage}
              onChange={(event) => setStage(event.target.value as '' | 'input' | 'output')}
              className="rounded-md border border-border bg-inset px-2 py-1.5 text-sm text-content outline-none"
            >
              <option value="">{t('playbook.guardrails.hits.allStages')}</option>
              <option value="input">{t('playbook.guardrails.hits.stage.input')}</option>
              <option value="output">{t('playbook.guardrails.hits.stage.output')}</option>
            </select>
          </div>
        </div>

        {hits.isPending ? (
          <CardSkeleton rows={3} />
        ) : hits.isError ? (
          <LoadError
            compact
            title={t('playbook.guardrails.hits.loadFailed')}
            error={hits.error}
            onRetry={() => void hits.refetch()}
          />
        ) : items.length === 0 ? (
          <EmptyState
            title={t('playbook.guardrails.hits.emptyTitle')}
            description={t('playbook.guardrails.hits.emptyDescription')}
          />
        ) : (
          <>
            <ul role="list" className="divide-y divide-border rounded-md border border-border">
              {items.map((hit) => (
                <HitRow key={hit.id} hit={hit} ruleName={ruleName(hit.rule_key)} t={t} />
              ))}
            </ul>
            {hits.hasNextPage && (
              <button
                type="button"
                disabled={hits.isFetchingNextPage}
                onClick={() => void hits.fetchNextPage()}
                className="self-start rounded-md border border-border px-3 py-1.5 text-sm text-content-secondary hover:bg-surface-2 disabled:opacity-50"
              >
                {hits.isFetchingNextPage
                  ? t('playbook.guardrails.hits.loadingMore')
                  : t('playbook.guardrails.hits.loadMore')}
              </button>
            )}
            {hits.isFetchNextPageError && (
              <p role="alert" className="text-2xs text-danger">
                {t('playbook.guardrails.hits.loadMoreFailed')}
              </p>
            )}
          </>
        )}
      </div>
    </Card>
  );
}

function HitRow({
  hit,
  ruleName,
  t,
}: {
  hit: GuardrailHitRecord;
  ruleName: string;
  t: TFunction;
}): ReactElement {
  return (
    <li className="flex flex-col gap-1 p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-medium">{ruleName}</p>
        <time dateTime={hit.created_at} className="text-2xs text-content-tertiary">
          {formatDateTime(hit.created_at) ?? hit.created_at}
        </time>
      </div>
      <p className="text-2xs text-content-secondary">
        {t(`playbook.guardrails.hits.stage.${hit.stage}`)} ·{' '}
        {GUARDRAIL_HIT_ACTIONS.includes(hit.action_taken)
          ? t(ACTION_LABEL_KEYS[hit.action_taken])
          : hit.action_taken}
      </p>
      {hit.evidence && (
        <blockquote className="whitespace-pre-wrap border-l-2 border-border pl-2 text-sm text-content-secondary">
          {hit.evidence}
        </blockquote>
      )}
      <p className="text-2xs text-content-tertiary">
        {t('ids.thread.label')}: {hit.chat_id} ·{' '}
        <Link to={`/app/inbox?chat=${encodeURIComponent(hit.chat_id)}`} className="underline">
          {t('playbook.guardrails.hits.openChat')}
        </Link>
      </p>
    </li>
  );
}
