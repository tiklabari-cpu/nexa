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
  { value: 'article', label: 'Article' },
  { value: 'faq', label: 'FAQ' },
  { value: 'file', label: 'File' },
] as const;

const STATUS_TONE: Record<string, StatusTone> = {
  ready: 'success',
  indexing: 'info',
  empty: 'warning',
};

export function CopilotKnowledge(): ReactElement {
  const api = useApiClient();
  const client = useQueryClient();
  const scopes = useAuth((s) => s.agent?.scopes ?? []);
  const canRead = scopes.includes('agents-bot--all:ro') || scopes.includes('agents-bot--all:rw');
  const canEdit = scopes.includes('agents-bot--all:rw');

  const [name, setName] = useState('');
  const [type, setType] = useState<string>('article');
  const [content, setContent] = useState('');

  const sources = useQuery({
    queryKey: ['team', 'copilot-knowledge'],
    queryFn: () => api.get<{ items: CopilotSource[] }>('/copilot/knowledge'),
    enabled: canRead,
  });

  const invalidate = () => client.invalidateQueries({ queryKey: ['team', 'copilot-knowledge'] });

  const add = useMutation({
    mutationFn: (body: { name: string; type: string; content: string }) =>
      api.post<CopilotSource>('/copilot/knowledge', body),
    onSuccess: async () => {
      await invalidate();
      setName('');
      setContent('');
      setType('article');
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/copilot/knowledge/${id}`),
    onSuccess: invalidate,
  });

  // Without the read scope there is nothing to show and nothing was fetched —
  // say so plainly rather than render an empty base as if it were curated.
  if (!canRead) {
    return (
      <Section
        title="Copilot knowledge"
        description="What Copilot may quote when it assists an agent (FR-MOD-12.2)."
      >
        <Card>
          <EmptyState
            title="No access to Copilot knowledge"
            description="Managing the Copilot knowledge base needs the AI agent permission. Ask an owner to grant it."
          />
        </Card>
      </Section>
    );
  }

  const items = sources.data?.items ?? [];
  const trimmedName = name.trim();
  const trimmedContent = content.trim();
  const canAdd = canEdit && trimmedName.length > 0 && trimmedContent.length > 0 && !add.isPending;

  return (
    <Section
      title="Copilot knowledge"
      description="What Copilot may quote when it assists an agent. Kept apart from the customer-facing AI agent's knowledge, and never shown to a customer (FR-MOD-12.2)."
    >
      <Card>
        {sources.error ? (
          <ErrorNotice message="Could not load the Copilot knowledge base. Check that the API is reachable." />
        ) : sources.isPending ? (
          <ListSkeleton rows={2} />
        ) : items.length === 0 ? (
          <EmptyState
            title="No Copilot sources yet"
            description={
              canEdit
                ? 'Add an article or FAQ below so Copilot can draw on it while assisting.'
                : 'An admin has not added any Copilot knowledge yet.'
            }
          />
        ) : (
          <table className="w-full text-sm">
            <caption className="sr-only">Copilot knowledge sources</caption>
            <thead>
              <tr className="border-b border-border text-left">
                <Th>Name</Th>
                <Th>Type</Th>
                <Th>Status</Th>
                <Th align="right">Chunks</Th>
                <Th>Updated</Th>
                {canEdit && <Th align="right">Manage</Th>}
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
                        Delete
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {canEdit && (
          <form
            className="border-t border-border p-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (!canAdd) return;
              add.mutate({ name: trimmedName, type, content: trimmedContent });
            }}
          >
            <h3 className="mb-3 text-sm font-medium">Add a source</h3>
            {add.isError && (
              <p role="alert" className="mb-3 text-sm text-danger">
                Could not add that source. Check the name and content and try again.
              </p>
            )}

            <div className="flex flex-col gap-3 sm:flex-row">
              <div className="min-w-0 flex-1">
                <label
                  htmlFor="copilot-source-name"
                  className="mb-1 block text-2xs font-medium text-content-secondary"
                >
                  Name
                </label>
                <input
                  id="copilot-source-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  className="w-full rounded-md border border-border bg-inset px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label
                  htmlFor="copilot-source-type"
                  className="mb-1 block text-2xs font-medium text-content-secondary"
                >
                  Type
                </label>
                <select
                  id="copilot-source-type"
                  value={type}
                  onChange={(event) => setType(event.target.value)}
                  className="w-full rounded-md border border-border bg-inset px-2 py-2 text-sm sm:w-auto"
                >
                  {SOURCE_TYPES.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <label
              htmlFor="copilot-source-content"
              className="mb-1 mt-3 block text-2xs font-medium text-content-secondary"
            >
              Content
            </label>
            <textarea
              id="copilot-source-content"
              rows={3}
              value={content}
              onChange={(event) => setContent(event.target.value)}
              className="mb-3 w-full rounded-md border border-border bg-inset px-3 py-2 text-sm"
            />

            <div className="flex justify-end">
              <button
                type="submit"
                disabled={!canAdd}
                className="rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
              >
                {add.isPending ? 'Adding…' : 'Add source'}
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
