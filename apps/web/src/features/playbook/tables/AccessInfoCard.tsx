/**
 * The "Erişim bilgisi" card (tm 310.5 · K13): what the AI may say when a player
 * cannot reach the site or asks for its current address.
 *
 * It says only what the workspace entered here, from one of three places — a
 * fixed link (said as written), a row of the knowledge base, or an address
 * fetched when asked (cached briefly, its last answer kept for when the fetch
 * fails; with neither, the AI hands over rather than guess). The note on the
 * card is the contract of the feature: this information is entered by the
 * workspace, which is responsible for it, and the AI has no source of its own.
 *
 * One setting per brand and one for every brand; a brand's own beats the
 * every-brand one. The server replaces a scope's setting whole, so the form
 * always sends all of it, and shows every refused field at once.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type ReactElement } from 'react';
import {
  AI_ACCESS_INFO_CACHE_SECONDS,
  AI_ACCESS_INFO_SOURCE_TYPES,
  type AiAccessInfoRow,
  type AiAccessInfoSourceType,
} from '@siyahtus/types';
import { Card } from '../../../components/Page.js';
import { Banner } from '../../../components/ui/Banner.js';
import { LoadError } from '../../../components/LoadError.js';
import { ApiClientError, errorMessageKey } from '../../../lib/api-client.js';
import { useApiClient } from '../../../lib/auth-store.js';
import { FieldError } from '../../../lib/form.js';
import { formatDateTime } from '../../../lib/format.js';
import { useTranslate } from '../../../lib/i18n.js';
import { useKnowledgeScopeOptions } from '../KnowledgeScopeFields.js';
import type { KnowledgeSource } from '../types.js';
import { problemsOf, type LocalProblem } from './table-form.js';

const INPUT =
  'rounded-md border border-border bg-inset px-2 py-1.5 text-sm text-content outline-none disabled:opacity-60';
const LABEL = 'text-2xs font-medium uppercase tracking-wide text-content-tertiary';
const EVERY_BRAND = '';

interface FormState {
  sourceType: AiAccessInfoSourceType;
  kbSourceId: string;
  url: string;
  cacheSeconds: string;
  fixedText: string;
}

function stateOf(row: AiAccessInfoRow | null): FormState {
  return {
    sourceType: row?.source_type ?? 'fixed_link',
    kbSourceId: row?.kb_source_id ?? '',
    url: row?.url ?? '',
    cacheSeconds: String(row?.cache_seconds ?? AI_ACCESS_INFO_CACHE_SECONDS.default),
    fixedText: row?.fixed_text ?? '',
  };
}

export function AccessInfoCard({ canEdit }: { canEdit: boolean }): ReactElement {
  const t = useTranslate();
  const api = useApiClient();
  const queryClient = useQueryClient();
  const { brands } = useKnowledgeScopeOptions();
  const [scope, setScope] = useState<string>(EVERY_BRAND);
  const [form, setForm] = useState<FormState>(stateOf(null));
  const [problems, setProblems] = useState<LocalProblem[]>([]);
  const [saved, setSaved] = useState(false);

  const settings = useQuery({
    queryKey: ['ai-access-info'],
    queryFn: () => api.get<{ items: AiAccessInfoRow[] }>('/ai-access-info'),
  });
  const sources = useQuery({
    queryKey: ['playbook', 'knowledge-store'],
    queryFn: () => api.get<{ items: KnowledgeSource[] }>('/knowledge-sources?audience=all'),
  });

  const current =
    settings.data?.items.find((row) => (row.brand_id ?? EVERY_BRAND) === scope) ?? null;

  // The form follows the chosen scope, and a saved setting reloaded under it.
  useEffect(() => {
    setForm(stateOf(current));
    setProblems([]);
    setSaved(false);
  }, [current?.id, current?.updated_at, scope]);

  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api.put<AiAccessInfoRow>('/ai-access-info', body),
    onSuccess: () => {
      setSaved(true);
      setProblems([]);
      void queryClient.invalidateQueries({ queryKey: ['ai-access-info'] });
    },
    onError: (error) => {
      setSaved(false);
      if (error instanceof ApiClientError) setProblems(problemsOf(error.details));
    },
  });

  function submit(): void {
    const seconds = Number(form.cacheSeconds);
    if (!Number.isInteger(seconds)) {
      setProblems([{ field: 'cache_seconds', code: 'invalid' }]);
      return;
    }
    setProblems([]);
    save.mutate({
      brand_id: scope === EVERY_BRAND ? null : scope,
      source_type: form.sourceType,
      kb_source_id: form.sourceType === 'kb_row' && form.kbSourceId !== '' ? form.kbSourceId : null,
      url: form.sourceType === 'kb_row' || form.url.trim() === '' ? null : form.url.trim(),
      cache_seconds: seconds,
      fixed_text:
        form.sourceType === 'fixed_link' && form.fixedText.trim() !== ''
          ? form.fixedText.trim()
          : null,
    });
  }

  const problemFor = (field: string): string | null => {
    const found = problems.find((problem) => problem.field === field);
    return found ? t(`playbook.tables.problem.${found.code}`) : null;
  };
  const refusal =
    save.error && !(save.error instanceof ApiClientError && problems.length > 0)
      ? t(errorMessageKey(save.error))
      : null;

  if (settings.isError) {
    return (
      <LoadError
        title={t('playbook.tables.access.loadError')}
        error={settings.error}
        onRetry={() => void settings.refetch()}
      />
    );
  }

  return (
    <Card>
      <section aria-labelledby="access-info-title" className="flex flex-col gap-3">
        <div>
          <h3 id="access-info-title" className="text-sm font-semibold text-content">
            {t('playbook.tables.access.title')}
          </h3>
          <p className="mt-1 text-2xs text-content-tertiary">
            {t('playbook.tables.access.description')}
          </p>
        </div>
        <Banner tone="info">{t('playbook.tables.access.tenantNote')}</Banner>

        <form
          aria-label={t('playbook.tables.access.title')}
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
          className="flex flex-col gap-3"
        >
          <div className="flex flex-col gap-1">
            <label htmlFor="access-info-scope" className={LABEL}>
              {t('playbook.tables.access.scope')}
            </label>
            <select
              id="access-info-scope"
              value={scope}
              onChange={(event) => setScope(event.target.value)}
              className={INPUT}
            >
              <option value={EVERY_BRAND}>{t('playbook.tables.access.everyBrand')}</option>
              {brands.map((brand) => (
                <option key={brand.id} value={brand.id}>
                  {brand.name ?? brand.id}
                </option>
              ))}
            </select>
            <FieldError message={problemFor('brand_id')} />
            {current === null && settings.isSuccess && (
              <p className="text-2xs text-content-tertiary">{t('playbook.tables.access.none')}</p>
            )}
          </div>

          <fieldset className="flex flex-col gap-1" disabled={!canEdit}>
            <legend className={LABEL}>{t('playbook.tables.access.sourceType')}</legend>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {AI_ACCESS_INFO_SOURCE_TYPES.map((type) => (
                <label key={type} className="flex items-center gap-1.5 text-sm">
                  <input
                    type="radio"
                    name="access-info-source-type"
                    checked={form.sourceType === type}
                    onChange={() => setForm((state) => ({ ...state, sourceType: type }))}
                  />
                  {t(`playbook.tables.access.type.${type}`)}
                </label>
              ))}
            </div>
            <p className="text-2xs text-content-tertiary">
              {t(`playbook.tables.access.typeHelp.${form.sourceType}`)}
            </p>
          </fieldset>

          {form.sourceType === 'kb_row' ? (
            <div className="flex flex-col gap-1">
              <label htmlFor="access-info-source" className={LABEL}>
                {t('playbook.tables.access.kbSource')}
              </label>
              <select
                id="access-info-source"
                value={form.kbSourceId}
                disabled={!canEdit}
                onChange={(event) =>
                  setForm((state) => ({ ...state, kbSourceId: event.target.value }))
                }
                className={INPUT}
              >
                <option value="">{t('playbook.tables.form.none')}</option>
                {(sources.data?.items ?? []).map((source) => (
                  <option key={source.id} value={source.id}>
                    {source.name}
                  </option>
                ))}
              </select>
              <FieldError message={problemFor('kb_source_id')} />
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              <label htmlFor="access-info-url" className={LABEL}>
                {t(
                  form.sourceType === 'fixed_link'
                    ? 'playbook.tables.access.link'
                    : 'playbook.tables.access.address',
                )}
              </label>
              <input
                id="access-info-url"
                type="text"
                inputMode="url"
                value={form.url}
                disabled={!canEdit}
                aria-describedby={problemFor('url') ? 'access-info-url-error' : undefined}
                onChange={(event) => setForm((state) => ({ ...state, url: event.target.value }))}
                className={INPUT}
              />
              <FieldError id="access-info-url-error" message={problemFor('url')} />
            </div>
          )}

          {form.sourceType === 'fixed_link' && (
            <div className="flex flex-col gap-1">
              <label htmlFor="access-info-text" className={LABEL}>
                {t('playbook.tables.access.fixedText')}
              </label>
              <textarea
                id="access-info-text"
                rows={2}
                value={form.fixedText}
                disabled={!canEdit}
                onChange={(event) =>
                  setForm((state) => ({ ...state, fixedText: event.target.value }))
                }
                className={INPUT}
              />
              <FieldError message={problemFor('fixed_text')} />
            </div>
          )}

          {form.sourceType === 'dynamic_url' && (
            <div className="flex flex-col gap-1">
              <label htmlFor="access-info-cache" className={LABEL}>
                {t('playbook.tables.access.cacheSeconds')}
              </label>
              <input
                id="access-info-cache"
                type="text"
                inputMode="numeric"
                value={form.cacheSeconds}
                disabled={!canEdit}
                onChange={(event) =>
                  setForm((state) => ({ ...state, cacheSeconds: event.target.value }))
                }
                className={INPUT}
              />
              <p className="text-2xs text-content-tertiary">
                {t('playbook.tables.access.cacheHelp', {
                  min: AI_ACCESS_INFO_CACHE_SECONDS.min,
                  max: AI_ACCESS_INFO_CACHE_SECONDS.max,
                })}
              </p>
              <FieldError message={problemFor('cache_seconds')} />
              {current?.source_type === 'dynamic_url' && (
                <p className="text-2xs text-content-secondary">
                  {current.last_value
                    ? t('playbook.tables.access.lastValue', {
                        value: current.last_value,
                        at: formatDateTime(current.last_fetched_at) ?? '',
                      })
                    : t('playbook.tables.access.noLastValue')}
                </p>
              )}
            </div>
          )}

          {refusal && <Banner tone="danger">{refusal}</Banner>}
          {saved && <Banner tone="success">{t('playbook.tables.access.saved')}</Banner>}

          {canEdit && (
            <button
              type="submit"
              disabled={save.isPending}
              className="self-start rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-60"
            >
              {save.isPending ? t('playbook.tables.form.saving') : t('playbook.tables.form.save')}
            </button>
          )}
        </form>
      </section>
    </Card>
  );
}
