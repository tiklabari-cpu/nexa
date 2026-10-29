import { useState, type ReactElement } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { CopyId } from '../../components/CopyId.js';
import { RatingBadge, RatingComment } from '../../components/RatingBadge.js';
import { StatusDot, type StatusTone } from '../../components/StatusDot.js';
import { Banner, Dropdown, Modal, Panel, PanelSection } from '../../components/ui/index.js';
import { ApiClientError, errorMessageKey } from '../../lib/api-client.js';
import { useApiClient, useAuth } from '../../lib/auth-store.js';
import { useDeployment } from '../../lib/deployment.js';
import { liveDataApps } from '../../lib/live-apps.js';
import { getLocale, useTranslate, type TFunction } from '../../lib/i18n.js';
import { formatDateTime, formatDay, formatTime } from '../../lib/format.js';
import {
  matchedOnLabel,
  possibleMatchesKey,
  type PossibleMatchList,
} from '../customers/MemberIdentity.js';
import { RiskSection } from '../risk/RiskSection.js';
import { AiHandoffSection, JUDGE_SCOPES } from './AiHandoffCard.js';
import { PlayerCard } from './PlayerCard.js';
import { canTakeOver } from './takeover.js';
import { TransferDialog } from './TransferDialog.js';
import { TEAMS_KEY, transferTeams, type TransferNotice, type TransferTeam } from './transfer.js';
import { useChatAction } from './useInbox.js';
import { formatDuration, useLiveDurationSeconds } from './visitDuration.js';
import type { ChatDetail } from './types.js';
import { hasAnyScope, type AppChatData } from '@siyahtus/types';

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
  onOpenChat,
  onOpenTimeline,
  onTransferred,
}: {
  chat: ChatDetail;
  chatId: string;
  /** When present, the header shows a control that hides this panel (FR-MOD-01.3). */
  onCollapse?: () => void;
  /**
   * Move the console to another chat — where a Reopen landed when it was not
   * this one (an earlier day's conversation continues under today's, ID-02-S6).
   */
  onOpenChat?: (chatId: string) => void;
  /** Open this day's timeline page (ID-09 · tm 334.2); absent where the panel has no router. */
  onOpenTimeline?: () => void;
  /** After a hand-off (IN-04): the notice to show, and whether the chat left the caller's sight. */
  onTransferred?: (outcome: { notice: TransferNotice; left: boolean }) => void;
}): ReactElement {
  const [newTag, setNewTag] = useState('');
  const [takeoverOpen, setTakeoverOpen] = useState(false);
  // The team the hand-off dialog opens with, picked in the assignee menu (IN-04).
  const [transferTeamId, setTransferTeamId] = useState<number | null>(null);
  const api = useApiClient();
  const actions = useChatAction(chatId);
  const role = useAuth((s) => s.agent?.role ?? null);
  const accountId = useAuth((s) => s.agent?.account_id ?? null);
  const capabilities = useAuth((s) => s.agent?.capabilities);
  const scopes = useAuth((s) => s.agent?.scopes) ?? [];
  const t = useTranslate();
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

  // The teams the chat is routed to, by name: `access.group_ids` carries bare
  // numbers, and "1" says nothing to the agent reading it. Same query key
  // `['team', 'groups']` the Teams page and the settings lists use, so this
  // opens no second request. While the list is in flight each team reads "…"
  // rather than its number; a team the list does not hold (deleted, or the
  // read failed) reads "Team #id". Sorted by name, not by the order or
  // priority the ids arrive in.
  const teamsQuery = useQuery({
    queryKey: TEAMS_KEY,
    queryFn: () => api.get<{ items: TransferTeam[] }>('/groups'),
    staleTime: 60_000,
  });
  // Takeover only makes sense on a chat still open to reassign (a closed one
  // answers 409 `chat_inactive`) and to a caller whose `chats.takeover` reaches
  // it — every chat, or one of a team they lead (RL-03) — the question
  // `ChatService.takeover` itself asks (`takeover.ts`).
  const canTakeover =
    chat.active &&
    canTakeOver(
      { role, accountId, ...(capabilities ? { capabilities } : {}) },
      chat.access.group_ids,
      teamsQuery.data?.items ?? [],
    );
  const knownTeams = new Map((teamsQuery.data?.items ?? []).map((team) => [team.id, team.name]));
  const teamName = (id: number): string =>
    teamsQuery.isPending ? '…' : (knownTeams.get(id) ?? t('inbox.details.teams.unknown', { id }));
  const teamNames = (() => {
    if (teamsQuery.isPending) return chat.access.group_ids.map(() => '…');
    return chat.access.group_ids.map(teamName).sort((a, b) => a.localeCompare(b, getLocale()));
  })();

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
  //
  // The public pilot has no marketplace (tm 257.18): the section is not drawn
  // and the read is not made — the API answers it with an empty list anyway.
  // Live cards are the exception (tm 263): their data is the provider's own,
  // so with any switched on the section is back, showing only them.
  const deployment = useDeployment();
  const showApps = !deployment.pilot_mode || liveDataApps(deployment).length > 0;
  const apps = useQuery({
    queryKey: ['chat-apps', chatId],
    queryFn: () => api.get<{ items: AppChatData[] }>(`/chats/${chatId}/apps`),
    staleTime: 30_000,
    enabled: showApps,
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
        {/* What the AI left the person taking over, first (AI-10 · tm 304.2). */}
        {chat.latest_ai_handoff && (
          <AiHandoffSection
            card={chat.latest_ai_handoff}
            chatId={chatId}
            canJudge={hasAnyScope(scopes, JUDGE_SCOPES)}
          />
        )}

        {/* Who the player is, earlier today and the 90 days before (IN-02 · tm 331.2). */}
        <PlayerCard
          chatId={chatId}
          customerId={chat.customer_id}
          recognizedDevice={chat.latest_ai_handoff?.player.recognized_device === true}
        />

        <PanelSection title={t('inbox.details.section.conversation')}>
          <Row label={t('inbox.details.row.status')}>
            <StatusDot
              tone={chat.active ? 'success' : 'neutral'}
              label={
                chat.active ? t('inbox.details.status.active') : t('inbox.details.status.archived')
              }
            />
          </Row>
          {/* The code's `chat_id` is the day container, named by the ids catalogue (ID-01, K1 = A). */}
          <Row label={t('ids.thread.label')} hint={t('ids.thread.hint')}>
            <CopyId kind="thread" value={chat.id} showLabel={false} className="text-2xs" />
          </Row>
          <Row label={t('inbox.details.row.assignee')}>
            <div className="flex min-w-0 items-center gap-2">
              {canAssign ? (
                <AssigneePicker
                  agents={rosterItems}
                  teams={transferTeams(teamsQuery.data?.items ?? [])}
                  assigneeId={assigneeId}
                  assigneeName={assigneeName}
                  unavailable={roster.isError}
                  onPick={(agentId) => actions.assign.mutate(agentId)}
                  onPickTeam={setTransferTeamId}
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
          {/* The player's verdict on this connection (AR-03 · WG-11), as soon as it is given —
              `chat_rated` re-reads the chat. Absent when unrated or not the caller's to see. */}
          {chat.thread?.rating && (
            <Row label={t('archive.facts.rating')}>
              <span className="flex flex-col items-end gap-0.5">
                <RatingBadge
                  value={chat.thread.rating.value}
                  hasComment={chat.thread.rating.has_comment}
                />
                {chat.thread.rating.comment && (
                  <RatingComment comment={chat.thread.rating.comment} />
                )}
              </span>
            </Row>
          )}
          {/* Everything that happened in the day on one page (ID-09 · tm 334.2). Here rather than in
              the thread header: a labelled action there costs the visitor's name its room at 1280 px. */}
          {onOpenTimeline && capabilities?.['timeline.view'] !== 'none' && (
            <button
              type="button"
              onClick={onOpenTimeline}
              className="mt-2 text-left text-xs text-content-brand underline underline-offset-2"
            >
              {t('inbox.thread.timeline')}
            </button>
          )}
        </PanelSection>

        {/* What the conversation and the player are flagged for (AI-27 · tm 302.3). */}
        <RiskSection
          chatId={chatId}
          customerId={chat.customer_id}
          canFlag={hasAnyScope(scopes, ['chats--all:rw', 'chats--access:rw'])}
        />

        {/* The member's day, connection by connection (ID-02 · tm 286.4). A
          chat with no `local_day` is not a day and lists only its newest
          connection, which the header already names — so it has no section. */}
        {chat.local_day && (chat.connections?.length ?? 0) > 0 && (
          <PanelSection
            title={
              chat.active
                ? t('inbox.details.section.connectionsToday')
                : t('inbox.details.section.connectionsOn', {
                    day: formatDay(chat.local_day) ?? chat.local_day,
                  })
            }
          >
            <ol className="flex flex-col gap-2" aria-label={t('ids.chat.label')}>
              {chat.connections!.map((connection) => (
                <li key={connection.id} className="flex flex-col gap-0.5 text-xs">
                  <span className="flex items-center gap-2">
                    <CopyId
                      kind="chat"
                      value={connection.id}
                      showLabel={false}
                      className="text-2xs"
                    />
                    <span className="tabular text-content-secondary">
                      {formatTime(connection.created_at)}
                    </span>
                    <StatusDot
                      tone={connection.active ? 'success' : 'neutral'}
                      label={
                        connection.active
                          ? t('inbox.details.connections.open')
                          : t('inbox.details.connections.closed')
                      }
                    />
                  </span>
                  <span className="text-2xs text-content-tertiary">
                    {[
                      connection.opened_via
                        ? t(`inbox.details.connections.via.${connection.opened_via}`)
                        : null,
                      connection.group_id === null ? null : teamName(connection.group_id),
                    ]
                      .filter((part): part is string => part !== null)
                      .join(' · ')}
                  </span>
                </li>
              ))}
            </ol>
          </PanelSection>
        )}

        <PossibleMatchesSection customerId={chat.customer_id} />

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
            <p className="text-xs">{teamNames.join(', ')}</p>
          )}
        </PanelSection>

        {/* Data pulled from connected marketplace apps (FR-MOD-09.1): a CRM's
          lifecycle stage, a store's order count — the context an integration is
          connected to provide. Empty until an app is connected in Settings. */}
        {showApps && (
          <PanelSection title={t('inbox.details.section.apps')}>
            {connectedApps.length === 0 ? (
              <p className="text-xs text-content-tertiary">{t('inbox.details.apps.empty')}</p>
            ) : (
              <div className="flex flex-col gap-3">
                {connectedApps.map((app) => (
                  <div key={app.app_id} data-testid={`chat-app-${app.app_id}`}>
                    <div className="mb-1 flex items-center gap-1.5 text-2xs font-medium text-content-secondary">
                      <span aria-hidden="true">{app.icon}</span>
                      <span className="min-w-0 flex-1 truncate">{app.data_label}</span>
                      {/* Live data is the provider's; demo data is sample data,
                          and the agent must be able to tell (tm 263). */}
                      <span
                        className={`shrink-0 rounded-sm px-1 text-2xs ${
                          app.live ? 'bg-success/10 text-success' : 'bg-inset text-content-tertiary'
                        }`}
                      >
                        {app.live ? t('inbox.details.apps.live') : t('inbox.details.apps.demo')}
                      </span>
                    </div>
                    {app.unavailable ? (
                      <p className="text-xs text-content-tertiary">
                        {t('inbox.details.apps.unavailable', { name: app.app_name })}
                      </p>
                    ) : app.live && app.fields.length === 0 ? (
                      <p className="text-xs text-content-tertiary">
                        {t('inbox.details.apps.noRecord')}
                      </p>
                    ) : (
                      app.fields.map((field) => (
                        <Row key={field.label} label={field.label}>
                          <span className="text-xs">{field.value}</span>
                        </Row>
                      ))
                    )}
                  </div>
                ))}
              </div>
            )}
          </PanelSection>
        )}

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
              <Row label={t('inbox.details.row.location')}>
                <span className="text-xs">{visitLocation(visitInfo)}</span>
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
              onClick={() =>
                actions.reopen.mutate(undefined, {
                  // An earlier day's conversation continues under the member's
                  // chat for today (ID-02-S6): follow it there.
                  onSuccess: (resumed) => {
                    if (resumed.id !== chatId) onOpenChat?.(resumed.id);
                  },
                })
              }
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

      {transferTeamId !== null && (
        <TransferDialog
          chatId={chatId}
          assigneeId={assigneeId}
          initialTeamId={transferTeamId}
          onClose={() => setTransferTeamId(null)}
          onTransferred={onTransferred}
        />
      )}

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
 *
 * Two sections (IN-04): **Teammate** hands it to one person at once; **Team**
 * opens the hand-off dialog with that team picked — a team hand-off takes a
 * note, and may need one. Each team says how many of its members are online,
 * which is what decides whether someone has it in a moment or it waits in the
 * team's queue. A team with no members is listed but cannot be picked.
 */
function AssigneePicker({
  agents,
  teams,
  assigneeId,
  assigneeName,
  unavailable,
  onPick,
  onPickTeam,
}: {
  agents: RosterAgent[];
  teams: Array<TransferTeam & { selectable: boolean }>;
  assigneeId: string | null;
  assigneeName: string;
  /** The roster call failed — offer no list rather than an empty one. */
  unavailable: boolean;
  onPick: (agentId: string) => void;
  onPickTeam: (groupId: number) => void;
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
      panelClassName="right-0 mt-1 max-h-80 w-60 overflow-y-auto p-1"
    >
      {({ close }) => (
        <>
          <p className="px-2 pb-0.5 pt-1 text-2xs font-medium uppercase text-content-tertiary">
            {t('inbox.transfer.section.teammates')}
          </p>
          {unavailable ? (
            <p className="px-2 py-1.5 text-2xs text-content-tertiary">
              {t('inbox.details.assign.unavailable')}
            </p>
          ) : agents.length === 0 ? (
            <p className="px-2 py-1.5 text-2xs text-content-tertiary">
              {t('inbox.details.assign.empty')}
            </p>
          ) : (
            <TeammateList agents={agents} assigneeId={assigneeId} onPick={onPick} close={close} />
          )}
          {teams.length > 0 && (
            <>
              <p className="mt-1 border-t border-border px-2 pb-0.5 pt-1.5 text-2xs font-medium uppercase text-content-tertiary">
                {t('inbox.transfer.section.teams')}
              </p>
              <ul>
                {teams.map((team) => (
                  <li key={team.id}>
                    <button
                      type="button"
                      disabled={!team.selectable}
                      onClick={() => {
                        close(true);
                        onPickTeam(team.id);
                      }}
                      className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs hover:bg-surface-2 disabled:cursor-default disabled:opacity-60"
                    >
                      <span className="min-w-0 flex-1 truncate">{team.name}</span>
                      <span className="shrink-0 tabular text-2xs text-content-tertiary">
                        {team.selectable
                          ? t('inbox.transfer.online', { count: team.accepting_count ?? 0 })
                          : t('inbox.transfer.noMembers')}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </Dropdown>
  );
}

/** The menu's teammates: picking one hands the chat over at once. */
function TeammateList({
  agents,
  assigneeId,
  onPick,
  close,
}: {
  agents: RosterAgent[];
  assigneeId: string | null;
  onPick: (agentId: string) => void;
  close: (restoreFocus?: boolean) => void;
}): ReactElement {
  const t = useTranslate();
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
 * The sentence for a refused takeover, from the error TYPE: a 403 says who may
 * do it, a 409 says someone beat you to it, and anything else goes through the
 * ADR-06 catalogue. A value that is not an API error at all is the generic line.
 */
function takeoverErrorMessage(error: unknown, t: TFunction): string {
  if (!(error instanceof ApiClientError)) return t('inbox.details.takeover.errorGeneric');
  if (error.type === 'authorization') return t('inbox.details.takeover.errorForbidden');
  if (error.type === 'takeover_conflict') return t('inbox.details.takeover.errorConflict');
  return t(errorMessageKey(error));
}

/**
 * The confirmation dialog for a supervisor takeover. Split out of
 * `DetailsPanel` so its own `useChatAction` mutation only runs while the
 * dialog is actually open; the assignee's name comes from the panel, which
 * needs the roster for its own picker and so has already asked for it. The
 * "My team" row opens the same dialog (`TeamRowActions.tsx`, RL-03).
 */
export function TakeoverModal({
  chatId,
  assigneeName,
  onClose,
  onTaken,
}: {
  chatId: string;
  /** The current holder's name, or null when the chat is unassigned. */
  assigneeName: string | null;
  onClose: () => void;
  /** After the chat became the caller's — the row opens it. */
  onTaken?: () => void;
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
              tests), and says more than the catalogue's general sentence for the
              type — so the dialog words each from the error TYPE, in the console's
              language, instead of printing the server's English. */}
          {takeoverErrorMessage(actions.takeover.error, t)}
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
          onClick={() =>
            actions.takeover.mutate(undefined, {
              onSuccess: () => {
                onClose();
                onTaken?.();
              },
            })
          }
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

/**
 * Other records this visitor may be (ID-03 · K4 · tm 287.4) — the same
 * pre-chat username or e-mail as someone this workspace already knows. Shown
 * while the agent is talking to them, because that is when "are you the Mira
 * who wrote last week?" can be asked; unverified, because anyone can type a
 * name. Linking is done on the customer's profile, where the confirmation and
 * the undo live — this only points there. Absent when there is nothing to
 * show, when the workspace turned matches off, or when the caller may not read
 * customers.
 */
function PossibleMatchesSection({ customerId }: { customerId: string }): ReactElement | null {
  const api = useApiClient();
  const t = useTranslate();
  const matches = useQuery({
    queryKey: possibleMatchesKey(customerId),
    queryFn: () => api.get<PossibleMatchList>(`/customers/${customerId}/possible-matches`),
    staleTime: 60_000,
  });
  const items = matches.data?.enabled === true ? matches.data.items : [];
  if (items.length === 0) return null;

  return (
    <PanelSection
      title={`${t('customers.identity.matches.heading')} (${t('customers.identity.matches.unverified')})`}
    >
      <p className="text-2xs text-content-tertiary">{t('inbox.details.possibleMatches.hint')}</p>
      <ul className="flex flex-col gap-2">
        {items.map(({ customer, matched_on, linked }) => (
          <li key={customer.id} className="flex flex-col gap-0.5 text-xs">
            <Link
              to={`/app/customers?customer=${encodeURIComponent(customer.id)}`}
              className="truncate text-content-brand underline underline-offset-2"
            >
              {customer.name ?? t('customers.detail.unnamedVisitor')}
            </Link>
            <span className="text-2xs text-content-tertiary">
              {[
                ...matched_on.map((field) => t(matchedOnLabel(field))),
                ...(linked ? [t('customers.identity.matches.linked')] : []),
              ].join(' · ')}
            </span>
          </li>
        ))}
      </ul>
    </PanelSection>
  );
}

function Row({
  label,
  hint,
  children,
}: {
  label: string;
  /** A one-line "what is this" shown as the label's tooltip. */
  hint?: string;
  children: React.ReactNode;
}): ReactElement {
  return (
    <div className="flex items-center justify-between gap-3">
      <span title={hint} className="text-xs text-content-secondary">
        {label}
      </span>
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

/** "Istanbul, TR", "TR", or "—" — country and city only, never a map (tm 330). */
function visitLocation(info: { country_code: string | null; city: string | null }): string {
  const parts = [info.city, info.country_code].filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join(', ') : '—';
}
