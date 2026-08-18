import { useState, type ReactElement } from 'react';
import { useQuery } from '@tanstack/react-query';
import { StatusDot } from '../../components/StatusDot.js';
import { Banner, Modal, Panel, PanelSection } from '../../components/ui/index.js';
import { ApiClientError } from '../../lib/api-client.js';
import { useApiClient, useAuth } from '../../lib/auth-store.js';
import { getLocale, useTranslate } from '../../lib/i18n.js';
import { formatDateTime } from '../../lib/format.js';
import { useChatAction } from './useInbox.js';
import type { ChatDetail } from './types.js';
import type { AppChatData } from '@nexa/types';

/** Roles that may seize a chat from whoever holds it — mirrors the route's own gate. */
const SUPERVISOR_ROLES = new Set(['admin', 'viceowner', 'owner']);

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
  const [takeoverOpen, setTakeoverOpen] = useState(false);
  const api = useApiClient();
  const actions = useChatAction(chatId);
  const role = useAuth((s) => s.agent?.role ?? null);
  const t = useTranslate();
  // Takeover only makes sense on a chat still open to reassign (a closed one
  // answers 409 `chat_inactive`) and to a supervisor-ranked caller — the same
  // pair the route itself checks (chats.ts: roleAtLeast(role, 'admin')).
  const canTakeover = chat.active && role !== null && SUPERVISOR_ROLES.has(role);
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

  // Data from connected marketplace apps for this customer (FR-MOD-09.1). The
  // query failing (an agent without chat read scope, say) simply leaves the
  // section empty rather than blocking the panel.
  const apps = useQuery({
    queryKey: ['chat-apps', chatId],
    queryFn: () => api.get<{ items: AppChatData[] }>(`/chats/${chatId}/apps`),
    staleTime: 30_000,
  });
  const connectedApps = apps.data?.items ?? [];

  const addTag = (): void => {
    const value = newTag.trim();
    if (!value) return;
    actions.tag.mutate(value);
    setNewTag('');
  };

  return (
    <>
      <Panel
        label={t('inbox.details.panelLabel')}
        title={t('inbox.details.title')}
        className="w-details shrink-0 overflow-y-auto border-l border-border"
        onCollapse={onCollapse}
        collapseLabel={t('inbox.details.collapseLabel')}
      >
        <PanelSection title={t('inbox.details.section.conversation')}>
          <Row label={t('inbox.details.row.status')}>
            <StatusDot
              tone={chat.active ? 'success' : 'neutral'}
              label={
                chat.active ? t('inbox.details.status.active') : t('inbox.details.status.archived')
              }
            />
          </Row>
          <Row label={t('inbox.details.row.chatId')}>
            <span className="font-mono text-2xs">{chat.id}</span>
          </Row>
          <Row label={t('inbox.details.row.assignee')}>
            <div className="flex items-center gap-2">
              <span className="text-xs">
                {chat.thread?.assignee_id
                  ? t('inbox.details.assignee.assigned')
                  : t('inbox.details.assignee.unassigned')}
              </span>
              {canTakeover && (
                <button
                  type="button"
                  onClick={() => setTakeoverOpen(true)}
                  className="rounded-sm border border-border px-1.5 py-0.5 text-2xs hover:bg-surface-2"
                >
                  {t('inbox.details.takeover.cta')}
                </button>
              )}
            </div>
          </Row>
          {chat.thread?.queue_position != null && (
            <Row label={t('inbox.details.row.queue')}>
              <span className="tabular text-xs text-warning">#{chat.thread.queue_position}</span>
            </Row>
          )}
          <Row label={t('inbox.details.row.started')}>
            <span className="text-xs">{formatDateTime(chat.created_at)}</span>
          </Row>
        </PanelSection>

        <PanelSection title={t('inbox.details.section.tags')}>
          {tags.length === 0 ? (
            <p className="text-xs text-content-tertiary">{t('inbox.details.tags.empty')}</p>
          ) : (
            <ul className="flex flex-wrap gap-1.5">
              {tags.map((tag) => (
                <li key={tag}>
                  <span className="inline-flex items-center gap-1 rounded-sm bg-inset px-2 py-0.5 text-2xs">
                    {tag}
                    <button
                      type="button"
                      aria-label={t('inbox.details.tags.remove', { tag })}
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
              {t('inbox.details.tags.addLabel')}
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
              placeholder={t('inbox.details.tags.addPlaceholder')}
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
              {t('inbox.details.tags.addButton')}
            </button>
          </div>
        </PanelSection>

        <PanelSection title={t('inbox.details.section.teams')}>
          {chat.access.group_ids.length === 0 ? (
            <p className="text-xs text-content-tertiary">{t('inbox.details.teams.empty')}</p>
          ) : (
            <p className="text-xs">{chat.access.group_ids.join(', ')}</p>
          )}
        </PanelSection>

        {/* Data pulled from connected marketplace apps (FR-MOD-09.1): a CRM's
          lifecycle stage, a store's order count — the context an integration is
          connected to provide. Empty until an app is connected in Settings. */}
        <PanelSection title={t('inbox.details.section.apps')}>
          {connectedApps.length === 0 ? (
            <p className="text-xs text-content-tertiary">{t('inbox.details.apps.empty')}</p>
          ) : (
            <div className="flex flex-col gap-3">
              {connectedApps.map((app) => (
                <div key={app.app_id} data-testid={`chat-app-${app.app_id}`}>
                  <div className="mb-1 flex items-center gap-1.5 text-2xs font-medium text-content-secondary">
                    <span aria-hidden="true">{app.icon}</span>
                    <span className="truncate">{app.data_label}</span>
                  </div>
                  {app.fields.map((field) => (
                    <Row key={field.label} label={field.label}>
                      <span className="text-xs">{field.value}</span>
                    </Row>
                  ))}
                </div>
              ))}
            </div>
          )}
        </PanelSection>

        {/* Where this visitor has been and on what — the context an agent reads
          before replying (FR-MOD-02.4). Both sections stay visible with an
          explicit empty state so a quiet panel never reads as a loading bug. */}
        <PanelSection title={t('inbox.details.section.visitedPages')}>
          {visitedPages.length === 0 ? (
            <p className="text-xs text-content-tertiary">{t('inbox.details.visitedPages.empty')}</p>
          ) : (
            <ol className="flex flex-col gap-1.5">
              {visitedPages.map((page, index) => (
                <li key={`${page.url}-${index}`} className="min-w-0">
                  <a
                    href={page.url}
                    target="_blank"
                    rel="noreferrer"
                    title={page.url}
                    className="block truncate text-xs text-content-brand hover:underline"
                  >
                    {prettyPath(page.url)}
                  </a>
                  {page.at && (
                    <span className="text-2xs text-content-tertiary">
                      {new Date(page.at).toLocaleTimeString(getLocale())}
                    </span>
                  )}
                </li>
              ))}
            </ol>
          )}
        </PanelSection>

        <PanelSection title={t('inbox.details.section.visitInfo')}>
          {visitInfo === null ? (
            <p className="text-xs text-content-tertiary">{t('inbox.details.visitInfo.empty')}</p>
          ) : (
            <>
              <Row label={t('inbox.details.row.device')}>
                <span className="text-xs">{visitInfo.device ?? '—'}</span>
              </Row>
              <Row label={t('inbox.details.row.referring')}>
                <span className="text-xs">
                  {visitInfo.referrer ?? t('inbox.details.visitInfo.direct')}
                </span>
              </Row>
              <Row label={t('inbox.details.row.duration')}>
                <span className="tabular text-xs">
                  {formatDuration(visitInfo.duration_seconds)}
                </span>
              </Row>
              <Row label={t('inbox.details.row.ip')}>
                <span className="font-mono text-2xs">{visitInfo.ip ?? '—'}</span>
              </Row>
            </>
          )}
        </PanelSection>

        <div className="mt-auto border-t border-border p-3">
          {chat.active ? (
            <button
              type="button"
              onClick={() => actions.archive.mutate()}
              disabled={actions.archive.isPending}
              className="w-full rounded-md border border-border px-3 py-2 text-sm hover:bg-surface-2 disabled:opacity-50"
            >
              {actions.archive.isPending
                ? t('inbox.details.archive.pending')
                : t('inbox.details.archive.cta')}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => actions.reopen.mutate()}
              disabled={actions.reopen.isPending}
              className="w-full rounded-md bg-brand-500 px-3 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50"
            >
              {actions.reopen.isPending
                ? t('inbox.details.reopen.pending')
                : t('inbox.details.reopen.cta')}
            </button>
          )}
        </div>
      </Panel>

      {takeoverOpen && (
        <TakeoverModal
          chatId={chatId}
          assigneeId={chat.thread?.assignee_id ?? null}
          onClose={() => setTakeoverOpen(false)}
        />
      )}
    </>
  );
}

/**
 * The confirmation dialog for a supervisor takeover. Split out of
 * `DetailsPanel` so its own `useChatAction` mutation and agent-roster lookup
 * only run while the dialog is actually open.
 */
function TakeoverModal({
  chatId,
  assigneeId,
  onClose,
}: {
  chatId: string;
  assigneeId: string | null;
  onClose: () => void;
}): ReactElement {
  const api = useApiClient();
  const actions = useChatAction(chatId);
  const t = useTranslate();

  // Names the current holder in the confirmation copy — the same roster
  // `GET /agents` already serves every other assignee picker from (agents.ts:
  // "assignee pickers, routing UIs"). Skipped entirely on an unassigned chat.
  const agents = useQuery({
    queryKey: ['team', 'agents'],
    queryFn: () => api.get<{ items: Array<{ id: string; name: string | null }> }>('/agents'),
    enabled: assigneeId !== null,
    staleTime: 60_000,
  });
  const assigneeName = assigneeId
    ? (agents.data?.items.find((a) => a.id === assigneeId)?.name ??
      t('inbox.details.takeover.fallbackName'))
    : null;

  return (
    <Modal onClose={onClose} title={t('inbox.details.takeover.title')}>
      <p className="text-sm text-content-secondary">
        {assigneeName
          ? t('inbox.details.takeover.bodyAssigned', { name: assigneeName })
          : t('inbox.details.takeover.bodyUnassigned')}
      </p>

      {actions.takeover.isError && (
        <Banner tone="danger" className="mt-3">
          {/* The 403 vs 409 wording must stay distinct (see the failure-specific
              tests) — the catalogue's generic authorization/conflict buckets would
              collapse both into one sentence, so the server's own text is shown as-is. */}
          {actions.takeover.error instanceof ApiClientError
            ? // i18n-ignore: server text shown by design, see comment above.
              actions.takeover.error.message
            : t('inbox.details.takeover.errorGeneric')}
        </Banner>
      )}

      <div className="mt-4 flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className="rounded-md border border-border px-3 py-1.5 text-sm"
        >
          {t('inbox.details.takeover.cancel')}
        </button>
        <button
          type="button"
          onClick={() => actions.takeover.mutate(undefined, { onSuccess: onClose })}
          disabled={actions.takeover.isPending}
          className="rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
        >
          {actions.takeover.isPending
            ? t('inbox.details.takeover.pending')
            : t('inbox.details.takeover.cta')}
        </button>
      </div>
    </Modal>
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
