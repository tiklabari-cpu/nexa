/**
 * Copilot knowledge management (FR-MOD-04.2 · FR-MOD-12.2).
 *
 * Copilot answers to the agent, not the customer, and it draws on a knowledge
 * base kept deliberately apart from the customer-facing AI agent's (12.2). This
 * is where that base is curated from the Team screen: what an assist may quote
 * lives here, and nowhere a customer token can reach it — the server turns a
 * customer's request into a 404 before a handler runs. Reading needs the bot
 * read scope; adding or removing a source needs write.
 */
import { useState, type ReactElement } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, ErrorNotice, Section } from '../../components/Page.js';
import { EmptyState } from '../../components/EmptyState.js';
import { ListSkeleton } from '../../components/Skeleton.js';
import { StatusDot, type StatusTone } from '../../components/StatusDot.js';
import { useApiClient, useAuth } from '../../lib/auth-store.js';
import { formatCount, formatDate } from '../../lib/format.js';
import { FieldError, required, useForm } from '../../lib/form.js';
import { useTranslate } from '../../lib/i18n.js';

interface CopilotSource {
  id: string;
  name: string;
  type: string;
  status: string;
  source_url: string | null;
  chunk_count: number;
  updated_at: string;
}

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

  const sources = useQuery({
    queryKey: ['team', 'copilot-knowledge'],
    queryFn: () => api.get<{ items: CopilotSource[] }>('/copilot/knowledge'),
    enabled: canRead,
  });

  const invalidate = () => client.invalidateQueries({ queryKey: ['team', 'copilot-knowledge'] });

  const add = useMutation({
    mutationFn: (body: { name: string; type: string; content: string }) =>
      api.post<CopilotSource>('/copilot/knowledge', body),
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

  const items = sources.data?.items ?? [];

  return (
    <Section title={t('team.copilot.title')} description={t('team.copilot.description')}>
      <Card>
        {sources.error ? (
          <ErrorNotice message={t('team.copilot.loadError')} />
        ) : sources.isPending ? (
          <ListSkeleton rows={2} />
        ) : items.length === 0 ? (
          <EmptyState
            title={t('team.copilot.empty.title')}
            description={t(canEdit ? 'team.copilot.empty.canEdit' : 'team.copilot.empty.readOnly')}
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
                  <td className="px-4 py-2.5 font-medium">{source.name}</td>
                  <td className="px-4 py-2.5 capitalize text-content-secondary">{source.type}</td>
                  <td className="px-4 py-2.5">
                    <StatusDot
                      tone={STATUS_TONE[source.status] ?? 'neutral'}
                      label={source.status}
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
                      <button
                        type="button"
                        onClick={() => remove.mutate(source.id)}
                        disabled={remove.isPending}
                        className="text-xs text-danger underline disabled:opacity-40"
                      >
                        {t('team.copilot.deleteButton')}
                      </button>
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
