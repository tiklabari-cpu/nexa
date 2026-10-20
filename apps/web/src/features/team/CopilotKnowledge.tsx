/**
 * Copilot knowledge management (FR-MOD-04.2 · FR-MOD-12.2 · AI-14).
 *
 * Copilot answers to the agent, not the customer. Since the knowledge store
 * became one (tm 309), this screen is a filtered view of it: every source whose
 * audiences name Copilot — the ones the AI agent answers players from as well as
 * the ones added for agents only. The "Used by" column says which is which, and
 * a filter narrows the list to the agents-only sources, the part that never
 * reaches a player and the only part curated from here: a source the AI agent
 * also uses is edited, reviewed and deleted in Scenarios › Knowledge, where its
 * brands and owner live. Reading needs the bot read scope; adding or removing an
 * agents-only source needs write.
 */
import { useState, type ReactElement } from 'react';
import { KnowledgeRowMeta } from '../playbook/KnowledgeRowMeta.js';
import { audienceKindOf, isArticleSource } from '../playbook/knowledge-scope.js';
import { useKnowledgeScopeOptions } from '../playbook/KnowledgeScopeFields.js';
import type { KnowledgeSource } from '../playbook/types.js';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, ErrorNotice, Section } from '../../components/Page.js';
import { EmptyState } from '../../components/EmptyState.js';
import { useConfirm } from '../../components/ui/index.js';
import { ListSkeleton } from '../../components/Skeleton.js';
import { StatusDot, type StatusTone } from '../../components/StatusDot.js';
import { useApiClient, useAuth } from '../../lib/auth-store.js';
import { formatCount, formatDate } from '../../lib/format.js';
import { FieldError, required, useForm } from '../../lib/form.js';
import { enumLabel } from '../../lib/enum-label.js';
import { useTranslate } from '../../lib/i18n.js';

/** `copilot` — everything Copilot reads; `agents_only` — the part that is for agents alone. */
type CopilotView = 'copilot' | 'agents_only';

/**
 * The kinds an admin curates by hand here. A website source is crawled (with the
 * SSRF guard) from the Playbook — this surface stays on pasted text, so managing
 * Copilot's base never re-treads that boundary.
 */
const SOURCE_TYPES = [
  { value: 'article', labelKey: 'team.copilot.type.article' },
  { value: 'faq', labelKey: 'team.copilot.type.faq' },
  { value: 'file', labelKey: 'team.copilot.type.file' },
] as const;

const STATUS_TONE: Record<string, StatusTone> = {
  ready: 'success',
  indexing: 'info',
  empty: 'warning',
};

export function CopilotKnowledge(): ReactElement {
  const t = useTranslate();
  const api = useApiClient();
  const client = useQueryClient();
  const scopes = useAuth((s) => s.agent?.scopes ?? []);
  const canRead = scopes.includes('agents-bot--all:ro') || scopes.includes('agents-bot--all:rw');
  const canEdit = scopes.includes('agents-bot--all:rw');

  const [type, setType] = useState<string>('article');
  const [view, setView] = useState<CopilotView>('copilot');
  const { brands } = useKnowledgeScopeOptions(canRead);
  const { confirm, dialog } = useConfirm();

  const sources = useQuery({
    queryKey: ['team', 'copilot-knowledge'],
    queryFn: () => api.get<{ items: KnowledgeSource[] }>('/knowledge-sources?audience=copilot'),
    enabled: canRead,
  });

  const invalidate = () => client.invalidateQueries({ queryKey: ['team', 'copilot-knowledge'] });
  // A source the AI agent also uses is the Playbook's to change; only the
  // agents-only ones (never a KB article's) are added and removed from here.
  const curatedHere = (source: KnowledgeSource): boolean =>
    audienceKindOf(source) === 'agents_only' && !isArticleSource(source);

  const add = useMutation({
    mutationFn: (body: { name: string; type: string; content: string }) =>
      api.post<KnowledgeSource>('/copilot/knowledge', body),
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/copilot/knowledge/${id}`),
    onSuccess: invalidate,
  });

  const form = useForm({
    initial: { name: '', content: '' },
    validators: {
      name: required(t('team.copilot.add.nameRequiredError')),
      content: required(t('team.copilot.add.contentRequiredError')),
    },
    onSubmit: async (values, { reset, setSubmitError }) => {
      try {
        await add.mutateAsync({ name: values.name.trim(), type, content: values.content.trim() });
        setType('article');
        reset();
      } catch {
        // A static, deliberately generic message (team.copilot.add.error) —
        // unchanged from before this screen used the shared primitive.
        setSubmitError(t('team.copilot.add.error'));
      }
    },
  });
  const nameError = form.errorFor('name');
  const contentError = form.errorFor('content');

  // Without the read scope there is nothing to show and nothing was fetched —
  // say so plainly rather than render an empty base as if it were curated.
  if (!canRead) {
    return (
      <Section title={t('team.copilot.title')} description={t('team.copilot.shortDescription')}>
        <Card>
          <EmptyState
            title={t('team.copilot.noAccess.title')}
            description={t('team.copilot.noAccess.description')}
          />
        </Card>
      </Section>
    );
  }

  const all = sources.data?.items ?? [];
  const items = view === 'agents_only' ? all.filter(curatedHere) : all;
  const brandNames = new Map(brands.map((brand) => [brand.id, brand.name ?? brand.id]));

  return (
    <Section title={t('team.copilot.title')} description={t('team.copilot.description')}>
      <Card>
        {all.length > 0 && (
          <div className="flex items-center gap-2 border-b border-border px-4 py-2">
            <label htmlFor="copilot-view" className="text-2xs text-content-tertiary">
              {t('team.copilot.view.label')}
            </label>
            <select
              id="copilot-view"
              value={view}
              onChange={(event) => setView(event.target.value as CopilotView)}
              className="rounded-md border border-border bg-inset px-2 py-1 text-xs text-content outline-none"
            >
              <option value="copilot">{t('team.copilot.view.all')}</option>
              <option value="agents_only">{t('team.copilot.view.agentsOnly')}</option>
            </select>
          </div>
        )}
        {sources.error ? (
          <ErrorNotice message={t('team.copilot.loadError')} />
        ) : sources.isPending ? (
          <ListSkeleton rows={2} />
        ) : items.length === 0 ? (
          <EmptyState
            title={t(all.length > 0 ? 'team.copilot.view.noneTitle' : 'team.copilot.empty.title')}
            description={t(
              all.length > 0
                ? 'team.copilot.view.noneDescription'
                : canEdit
                  ? 'team.copilot.empty.canEdit'
                  : 'team.copilot.empty.readOnly',
            )}
          />
        ) : (
          <table className="w-full text-sm">
            <caption className="sr-only">{t('team.copilot.table.caption')}</caption>
            <thead>
              <tr className="border-b border-border text-left">
                <Th>{t('team.page.table.name')}</Th>
                <Th>{t('team.copilot.table.type')}</Th>
                <Th>{t('team.page.botTable.status')}</Th>
                <Th align="right">{t('team.copilot.table.chunks')}</Th>
                <Th>{t('team.copilot.table.updated')}</Th>
                {canEdit && <Th align="right">{t('team.page.table.manage')}</Th>}
              </tr>
            </thead>
            <tbody>
              {items.map((source) => (
                <tr key={source.id} className="border-b border-border last:border-0">
                  <td className="px-4 py-2.5 font-medium">
                    {source.name}
                    <KnowledgeRowMeta source={source} brandNames={brandNames} />
                  </td>
                  <td className="px-4 py-2.5 text-content-secondary">
                    {enumLabel(t, 'team.copilot.type', source.type)}
                  </td>
                  <td className="px-4 py-2.5">
                    <StatusDot
                      tone={STATUS_TONE[source.status] ?? 'neutral'}
                      label={enumLabel(t, 'team.copilot.status', source.status)}
                    />
                  </td>
                  <td className="tabular px-4 py-2.5 text-right text-content-secondary">
                    {formatCount(source.chunk_count)}
                  </td>
                  <td className="px-4 py-2.5 text-2xs text-content-tertiary">
                    {formatDate(source.updated_at) ?? '—'}
                  </td>
                  {canEdit && (
                    <td className="px-4 py-2.5 text-right">
                      {!curatedHere(source) ? (
                        <span className="text-2xs text-content-tertiary">
                          {t('team.copilot.managedInPlaybook')}
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() =>
                            confirm({
                              title: t('team.copilot.deleteConfirm.title', { name: source.name }),
                              description: t('team.copilot.deleteConfirm.description'),
                              failureTitle: t('ui.writeError.delete', { name: source.name }),
                              onConfirm: () => remove.mutateAsync(source.id),
                            })
                          }
                          disabled={remove.isPending}
                          // Every row says "Delete"; the name tells them apart (WCAG 2.4.6).
                          aria-label={t('team.copilot.deleteAriaLabel', { name: source.name })}
                          className="text-xs text-danger underline disabled:opacity-40"
                        >
                          {t('team.copilot.deleteButton')}
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {canEdit && (
          <form className="border-t border-border p-4" onSubmit={form.handleSubmit} noValidate>
            <h3 className="mb-3 text-sm font-medium">{t('team.copilot.add.title')}</h3>
            {form.submitError && (
              <p role="alert" className="mb-3 text-sm text-danger">
                {form.submitError}
              </p>
            )}

            <div className="flex flex-col gap-3 sm:flex-row">
              <div className="min-w-0 flex-1">
                <label
                  htmlFor="copilot-source-name"
                  className="mb-1 block text-2xs font-medium text-content-secondary"
                >
                  {t('team.page.table.name')}
                </label>
                <input
                  id="copilot-source-name"
                  value={form.values.name}
                  onChange={(event) => form.setValue('name', event.target.value)}
                  onBlur={() => form.blur('name')}
                  aria-invalid={nameError ? true : undefined}
                  aria-describedby={nameError ? 'copilot-source-name-error' : undefined}
                  className="w-full rounded-md border border-border bg-inset px-3 py-2 text-sm"
                />
                <FieldError id="copilot-source-name-error" message={nameError} />
              </div>
              <div>
                <label
                  htmlFor="copilot-source-type"
                  className="mb-1 block text-2xs font-medium text-content-secondary"
                >
                  {t('team.copilot.table.type')}
                </label>
                <select
                  id="copilot-source-type"
                  value={type}
                  onChange={(event) => setType(event.target.value)}
                  className="w-full rounded-md border border-border bg-inset px-2 py-2 text-sm sm:w-auto"
                >
                  {SOURCE_TYPES.map((option) => (
                    <option key={option.value} value={option.value}>
                      {t(option.labelKey)}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <label
              htmlFor="copilot-source-content"
              className="mb-1 mt-3 block text-2xs font-medium text-content-secondary"
            >
              {t('team.copilot.add.contentLabel')}
            </label>
            <textarea
              id="copilot-source-content"
              rows={3}
              value={form.values.content}
              onChange={(event) => form.setValue('content', event.target.value)}
              onBlur={() => form.blur('content')}
              aria-invalid={contentError ? true : undefined}
              aria-describedby={contentError ? 'copilot-source-content-error' : undefined}
              className="mb-1 w-full rounded-md border border-border bg-inset px-3 py-2 text-sm"
            />
            <FieldError id="copilot-source-content-error" message={contentError} />

            <div className="mt-3 flex justify-end">
              <button
                type="submit"
                disabled={!form.canSubmit}
                className="rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
              >
                {form.isSubmitting
                  ? t('team.copilot.add.submitting')
                  : t('team.copilot.add.submit')}
              </button>
            </div>
          </form>
        )}
      </Card>
      {dialog}
    </Section>
  );
}

function Th({
  children,
  align = 'left',
}: {
  children: string;
  align?: 'left' | 'right';
}): ReactElement {
  return (
    <th
      scope="col"
      className={`px-4 py-2 text-xs font-medium text-content-secondary ${
        align === 'right' ? 'text-right' : ''
      }`}
    >
      {children}
    </th>
  );
}
