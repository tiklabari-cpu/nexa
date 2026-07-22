import { useState, type ReactElement } from 'react';
import { StatusDot } from '../../components/StatusDot.js';
import { useChatAction } from './useInbox.js';
import type { ChatDetail } from './types.js';

/**
 * Right-hand context panel: who this is, what the conversation is tagged with,
 * and the actions that change its state.
 *
 * Sections are collapsible because an agent working a queue wants the composer
 * as tall as possible, and this is the pane they give up first.
 */
export function DetailsPanel({ chat, chatId }: { chat: ChatDetail; chatId: string }): ReactElement {
  const [newTag, setNewTag] = useState('');
  const actions = useChatAction(chatId);
  const tags = chat.thread?.tags ?? [];

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
      <header className="flex h-topbar items-center border-b border-border px-4">
        <h2 className="text-sm font-semibold">Details</h2>
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
