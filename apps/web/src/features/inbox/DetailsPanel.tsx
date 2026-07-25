import { useState, type ReactElement } from 'react';
import { useQuery } from '@tanstack/react-query';
import { StatusDot } from '../../components/StatusDot.js';
import { useApiClient } from '../../lib/auth-store.js';
import { useChatAction } from './useInbox.js';
import type { ChatDetail } from './types.js';

/**
 * Right-hand context panel: who this is, what the conversation is tagged with,
 * and the actions that change its state.
 *
 * Sections are collapsible because an agent working a queue wants the composer
 * as tall as possible, and this is the pane they give up first.
 */
export function DetailsPanel({
  chat,
  chatId,
  onCollapse,
}: {
  chat: ChatDetail;
  chatId: string;
  /** When present, the header shows a control that hides this panel (FR-MOD-01.3). */
  onCollapse?: () => void;
}): ReactElement {
  const [newTag, setNewTag] = useState('');
  const api = useApiClient();
  const actions = useChatAction(chatId);
  const tags = chat.thread?.tags ?? [];
  const visitedPages = chat.visitor?.visited_pages ?? [];
  const visitInfo = chat.visitor?.visit_info ?? null;

  // Suggest the curated library (FR-MOD-08.7.1) so a team applies agreed labels
  // rather than re-inventing a spelling per conversation. A free-typed tag still
  // works — the datalist is a hint, not a constraint — and the query failing
  // (e.g. an agent without a tag read scope) simply leaves it with no options.
  const library = useQuery({
    queryKey: ['tag-library'],
    queryFn: () => api.get<{ items: Array<{ name: string }> }>('/settings/tags'),
    staleTime: 60_000,
  });
  const suggestions = (library.data?.items ?? [])
    .map((item) => item.name)
    .filter((name) => !tags.includes(name));

  const addTag = (): void => {
    const value = newTag.trim();
    if (!value) return;
    actions.tag.mutate(value);
    setNewTag('');
  };

  return (
    <aside
      aria-label="Conversation details"
      className="flex w-details shrink-0 flex-col overflow-y-auto border-l border-border bg-surface"
    >
      <header className="flex h-topbar items-center justify-between border-b border-border px-4">
        <h2 className="text-sm font-semibold">Details</h2>
        {onCollapse && (
          <button
            type="button"
            onClick={onCollapse}
            aria-label="Collapse details panel"
            className="rounded-md p-1 text-content-tertiary hover:bg-surface-2 hover:text-content"
          >
            <span aria-hidden="true">⇥</span>
          </button>
        )}
      </header>

      <Section title="Conversation">
        <Row label="Status">
          <StatusDot
            tone={chat.active ? 'success' : 'neutral'}
            label={chat.active ? 'Active' : 'Archived'}
          />
        </Row>
        <Row label="Chat ID">
          <span className="font-mono text-2xs">{chat.id}</span>
        </Row>
        <Row label="Assignee">
          <span className="text-xs">{chat.thread?.assignee_id ? 'Assigned' : 'Unassigned'}</span>
        </Row>
        {chat.thread?.queue_position != null && (
          <Row label="Queue">
            <span className="tabular text-xs text-warning">#{chat.thread.queue_position}</span>
          </Row>
        )}
        <Row label="Started">
          <span className="text-xs">{new Date(chat.created_at).toLocaleString()}</span>
        </Row>
      </Section>

      <Section title="Tags">
        {tags.length === 0 ? (
          <p className="text-xs text-content-tertiary">No tags yet.</p>
        ) : (
          <ul className="flex flex-wrap gap-1.5">
            {tags.map((tag) => (
              <li key={tag}>
                <span className="inline-flex items-center gap-1 rounded-sm bg-inset px-2 py-0.5 text-2xs">
                  {tag}
                  <button
                    type="button"
                    aria-label={`Remove tag ${tag}`}
                    onClick={() => actions.untag.mutate(tag)}
                    className="text-content-tertiary hover:text-danger"
                  >
                    ×
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-2 flex gap-1.5">
          <label className="sr-only" htmlFor="new-tag">
            Add a tag
          </label>
          <input
            id="new-tag"
            list="tag-library"
            value={newTag}
            onChange={(event) => setNewTag(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                addTag();
              }
            }}
            placeholder="Add a tag…"
            maxLength={64}
            className="min-w-0 flex-1 rounded-sm border border-border bg-inset px-2 py-1 text-xs"
          />
          <datalist id="tag-library">
            {suggestions.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
          <button
            type="button"
            onClick={addTag}
            disabled={!newTag.trim()}
            className="rounded-sm border border-border px-2 py-1 text-xs disabled:opacity-50"
          >
            Add
          </button>
        </div>
      </Section>

      <Section title="Teams">
        {chat.access.group_ids.length === 0 ? (
          <p className="text-xs text-content-tertiary">Not routed to a team.</p>
        ) : (
          <p className="text-xs">{chat.access.group_ids.join(', ')}</p>
        )}
      </Section>

      {/* Where this visitor has been and on what — the context an agent reads
          before replying (FR-MOD-02.4). Both sections stay visible with an
          explicit empty state so a quiet panel never reads as a loading bug. */}
      <Section title="Visited pages">
        {visitedPages.length === 0 ? (
          <p className="text-xs text-content-tertiary">No pages recorded for this visitor.</p>
        ) : (
          <ol className="flex flex-col gap-1.5">
            {visitedPages.map((page, index) => (
              <li key={`${page.url}-${index}`} className="min-w-0">
                <a
                  href={page.url}
                  target="_blank"
                  rel="noreferrer"
                  title={page.url}
                  className="block truncate text-xs text-brand-600 hover:underline"
                >
                  {prettyPath(page.url)}
                </a>
                {page.at && (
                  <span className="text-2xs text-content-tertiary">
                    {new Date(page.at).toLocaleTimeString()}
                  </span>
                )}
              </li>
            ))}
          </ol>
        )}
      </Section>

      <Section title="Visit info">
        {visitInfo === null ? (
          <p className="text-xs text-content-tertiary">No visit information yet.</p>
        ) : (
          <>
            <Row label="Device">
              <span className="text-xs">{visitInfo.device ?? '—'}</span>
            </Row>
            <Row label="Referring">
              <span className="text-xs">{visitInfo.referrer ?? 'Direct'}</span>
            </Row>
            <Row label="Duration">
              <span className="tabular text-xs">{formatDuration(visitInfo.duration_seconds)}</span>
            </Row>
            <Row label="IP">
              <span className="font-mono text-2xs">{visitInfo.ip ?? '—'}</span>
            </Row>
          </>
        )}
      </Section>

      <div className="mt-auto border-t border-border p-3">
        {chat.active ? (
          <button
            type="button"
            onClick={() => actions.archive.mutate()}
            disabled={actions.archive.isPending}
            className="w-full rounded-md border border-border px-3 py-2 text-sm hover:bg-surface-2 disabled:opacity-50"
          >
            {actions.archive.isPending ? 'Archiving…' : 'Archive conversation'}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => actions.reopen.mutate()}
            disabled={actions.reopen.isPending}
            className="w-full rounded-md bg-brand-500 px-3 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50"
          >
            {actions.reopen.isPending ? 'Reopening…' : 'Reopen conversation'}
          </button>
        )}
      </div>
    </aside>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }): ReactElement {
  return (
    <details open className="border-b border-border">
      <summary className="cursor-pointer px-4 py-3 text-2xs font-semibold uppercase tracking-wide text-content-tertiary">
        {title}
      </summary>
      <div className="flex flex-col gap-2 px-4 pb-4">{children}</div>
    </details>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }): ReactElement {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs text-content-secondary">{label}</span>
      {children}
    </div>
  );
}

/** Show the path an agent scans for, not the full origin they already know. */
function prettyPath(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.search}` || '/';
  } catch {
    // Already a bare path, or something we cannot parse — show it verbatim.
    return url;
  }
}

/** "45s" · "3m 20s" · "1h 4m". A dash when the length is unknown. */
function formatDuration(seconds: number | null): string {
  if (seconds === null || seconds < 0) return '—';
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    const rest = seconds % 60;
    return rest ? `${minutes}m ${rest}s` : `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}
