import { useState, type ReactElement } from 'react';
import { useQuery } from '@tanstack/react-query';
import { StatusDot, type StatusTone } from '../../components/StatusDot.js';
import { Banner, Dropdown, Modal, Panel, PanelSection } from '../../components/ui/index.js';
import { ApiClientError, errorMessageKey } from '../../lib/api-client.js';
import { useApiClient, useAuth } from '../../lib/auth-store.js';
import { getLocale, useTranslate } from '../../lib/i18n.js';
import { formatDateTime } from '../../lib/format.js';
import { useChatAction } from './useInbox.js';
import { formatDuration, useLiveDurationSeconds } from './visitDuration.js';
import type { ChatDetail } from './types.js';
import { hasAnyScope, type AppChatData } from '@nexa/types';

/** Roles that may seize a chat from whoever holds it — mirrors the route's own gate. */
const SUPERVISOR_ROLES = new Set(['admin', 'viceowner', 'owner']);

/** Just enough of `GET /agents` to name an assignee and say whether they can take work. */
interface RosterAgent {
  id: string;
  name: string | null;
  routing_status: 'accepting_chats' | 'not_accepting_chats' | 'offline';
}

const ROUTING_TONE: Record<RosterAgent['routing_status'], StatusTone> = {
  accepting_chats: 'success',
  not_accepting_chats: 'warning',
  offline: 'neutral',
};

const ROUTING_KEY: Record<RosterAgent['routing_status'], string> = {
  accepting_chats: 'team.status.acceptingChats',
  not_accepting_chats: 'team.status.notAccepting',
  offline: 'team.status.offline',
};

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
  const scopes = useAuth((s) => s.agent?.scopes) ?? [];
  const t = useTranslate();
  // Takeover only makes sense on a chat still open to reassign (a closed one
  // answers 409 `chat_inactive`) and to a supervisor-ranked caller — the same
  // pair the route itself checks (chats.ts: roleAtLeast(role, 'admin')).
  const canTakeover = chat.active && role !== null && SUPERVISOR_ROLES.has(role);
  // Handing the chat to a named teammate is the consented move, so it asks for
  // what `POST /chats/{id}/transfer` asks for — write access to the chat — and
  // not for a rank. An ordinary agent holds `chats--access:rw` and may do it.
  //
  // `hasAnyScope` rather than `Array.includes`, for the reason 13.2-k found on
  // the Traffic board: an owner's set is `chats--all:rw` and holds no literal
  // narrower scope, so a membership test would disable the control for exactly
  // the people who run the queue. One expander keeps the control's answer and
  // the route's answer the same.
  const canAssign = chat.active && hasAnyScope(scopes, ['chats--all:rw', 'chats--access:rw']);
  const tags = chat.thread?.tags ?? [];
  const visitedPages = chat.visitor?.visited_pages ?? [];
  const visitInfo = chat.visitor?.visit_info ?? null;
  // The visit's length, running (`visitDuration.ts`) while the visit is open —
  // the PRD's "süre/ziyaret canlı". A closed visit keeps the server's figure.
  const liveDuration = useLiveDurationSeconds(
    visitInfo?.duration_seconds ?? null,
    visitInfo?.ongoing ?? false,
  );

  // The roster that turns an assignee id into a person (FR-MOD-02.4.1–.6): the
  // panel used to show the bare word "Assigned", which names nobody. Same query
  // key `['team', 'agents']` the takeover dialog and the Team page already use,
  // so this opens no second cache — and `GET /agents` returns only unsuspended
  // teammates, which is precisely the list you may hand a conversation to.
  const roster = useQuery({
    queryKey: ['team', 'agents'],
    queryFn: () => api.get<{ items: RosterAgent[] }>('/agents'),
    staleTime: 60_000,
  });
  const rosterItems = roster.data?.items ?? [];
  const assigneeId = chat.thread?.assignee_id ?? null;
  // A name when the roster can supply one. The fallback is the word this row
  // showed before it could name anybody, so a roster the caller may not read
  // (or one still in flight) degrades to the old panel rather than to a blank.
  const assigneeName = assigneeId
    ? (rosterItems.find((agent) => agent.id === assigneeId)?.name ??
      t('inbox.details.assignee.assigned'))
    : t('inbox.details.assignee.unassigned');

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
            <div className="flex min-w-0 items-center gap-2">
              {canAssign ? (
                <AssigneePicker
                  agents={rosterItems}
                  assigneeId={assigneeId}
                  assigneeName={assigneeName}
                  unavailable={roster.isError}
                  onPick={(agentId) => actions.assign.mutate(agentId)}
                />
              ) : (
                // Seeing who holds the conversation is part of reading it, so a
                // caller who may not reassign still gets the name — the section
                // is never hidden, only the control is.
                <span className="truncate text-xs">{assigneeName}</span>
              )}
              {canTakeover && (
                <button
                  type="button"
                  onClick={() => setTakeoverOpen(true)}
                  className="shrink-0 rounded-sm border border-border px-1.5 py-0.5 text-2xs hover:bg-surface-2"
                >
                  {t('inbox.details.takeover.cta')}
                </button>
              )}
            </div>
          </Row>
          {actions.assign.isError && (
            // The refusal, in the agent's language and specific to what was
            // refused. `transfer` answers with three distinct verdicts and they
            // need three distinct sentences: the chat closed under you
            // (`chat_inactive`), the teammate is offline (`group_unavailable`),
            // or you may not write to this chat at all. The optimistic name is
            // already back to what the server holds — `useChatAction.assign`
            // rolls the cache back — so this says why, it does not undo.
            <Banner tone="danger" className="mt-2">
              {t(assignErrorKey(actions.assign.error))}
            </Banner>
          )}
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
                <span className="tabular text-xs">{formatDuration(liveDuration)}</span>
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
          assigneeName={
            assigneeId
              ? (rosterItems.find((agent) => agent.id === assigneeId)?.name ??
                t('inbox.details.takeover.fallbackName'))
              : null
          }
          onClose={() => setTakeoverOpen(false)}
        />
      )}
    </>
  );
}

/**
 * The assignee, and the menu that changes it (FR-MOD-02.4.1–.6).
 *
 * The name is the trigger, so the row reads as a value first and a control
 * second: an agent scanning the panel wants to know *who*, and only sometimes
 * wants to change it. Picking saves immediately — the PRD asks this row to save
 * on selection, and a Save button next to a one-field menu is a step that only
 * ever gets in the way.
 *
 * Offline teammates stay in the list rather than being filtered out or greyed:
 * `routing_status` here is up to a minute old, so hiding them would sometimes
 * hide somebody who is in fact back, and the server has the current answer
 * anyway (it refuses with `group_unavailable`, which the panel words). The dot
 * says who is likely to answer; the refusal is authoritative.
 */
function AssigneePicker({
  agents,
  assigneeId,
  assigneeName,
  unavailable,
  onPick,
}: {
  agents: RosterAgent[];
  assigneeId: string | null;
  assigneeName: string;
  /** The roster call failed — offer no list rather than an empty one. */
  unavailable: boolean;
  onPick: (agentId: string) => void;
}): ReactElement {
  const t = useTranslate();

  return (
    <Dropdown
      label={t('inbox.details.assign.label')}
      className="min-w-0"
      trigger={
        <span className="flex items-center gap-1 truncate rounded-sm border border-border px-1.5 py-0.5 text-xs hover:bg-surface-2">
          <span className="truncate">{assigneeName}</span>
          <span aria-hidden="true" className="text-content-tertiary">
            ▾
          </span>
        </span>
      }
      panelClassName="right-0 mt-1 max-h-64 w-56 overflow-y-auto p-1"
    >
      {({ close }) => {
        if (unavailable) {
          return (
            <p className="px-2 py-1.5 text-2xs text-content-tertiary">
              {t('inbox.details.assign.unavailable')}
            </p>
          );
        }
        if (agents.length === 0) {
          return (
            <p className="px-2 py-1.5 text-2xs text-content-tertiary">
              {t('inbox.details.assign.empty')}
            </p>
          );
        }
        return (
          <ul>
            {agents.map((agent) => {
              const current = agent.id === assigneeId;
              return (
                <li key={agent.id}>
                  <button
                    type="button"
                    // The one already holding it is not a choice — picking them
                    // would write a hand-off event that moved nothing.
                    disabled={current}
                    aria-current={current ? 'true' : undefined}
                    onClick={() => {
                      close(true);
                      onPick(agent.id);
                    }}
                    className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs hover:bg-surface-2 disabled:cursor-default disabled:opacity-60"
                  >
                    <span aria-hidden="true" className="w-3 shrink-0 text-content-tertiary">
                      {current ? '✓' : ''}
                    </span>
                    <span className="min-w-0 flex-1 truncate">
                      {agent.name ?? t('inbox.details.takeover.fallbackName')}
                    </span>
                    {/* Glyph *and* word, never colour alone (NFR-A11Y2): who is
                        likely to pick this up is the whole reason to read the list. */}
                    <StatusDot
                      tone={ROUTING_TONE[agent.routing_status]}
                      label={t(ROUTING_KEY[agent.routing_status])}
                    />
                  </button>
                </li>
              );
            })}
          </ul>
        );
      }}
    </Dropdown>
  );
}

/**
 * The sentence for a refused hand-off.
 *
 * Through the ADR-06 catalogue rather than `error.message`, so a Turkish
 * console answers in Turkish (NFR-I18N2) — with one override. `transfer` raises
 * `group_unavailable` for an offline *teammate* as well as an unavailable team,
 * and the shared sentence for that type says "team", which would name the wrong
 * subject in the one place this panel can hit it.
 */
function assignErrorKey(error: unknown): string {
  if (error instanceof ApiClientError && error.type === 'group_unavailable') {
    return 'inbox.details.assign.offline';
  }
  return errorMessageKey(error);
}

/**
 * The confirmation dialog for a supervisor takeover. Split out of
 * `DetailsPanel` so its own `useChatAction` mutation only runs while the
 * dialog is actually open; the assignee's name comes from the panel, which
 * needs the roster for its own picker and so has already asked for it.
 */
function TakeoverModal({
  chatId,
  assigneeName,
  onClose,
}: {
  chatId: string;
  /** The current holder's name, or null when the chat is unassigned. */
  assigneeName: string | null;
  onClose: () => void;
}): ReactElement {
  const actions = useChatAction(chatId);
  const t = useTranslate();

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
