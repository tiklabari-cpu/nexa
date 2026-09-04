/**
 * Audit log — the security trail's read-only screen (NFR-S12).
 *
 * The server already draws every real boundary: `audit_log--all:ro` +
 * `minimumRole: admin` gate the route (08.9.7-a), and RLS scopes every entry to
 * this workspace. The `audit_log--all:ro` check here is a courtesy, not the
 * security boundary — it saves a caller who cannot read the trail from firing a
 * request that would only come back 403, and keeps the Settings door (see
 * `SettingsPage.tsx`) from advertising a screen they cannot open.
 *
 * Filters (action, date range) and "load more" narrow the same base list the
 * API already supports (08.9.7-a/b) — this screen wires the controls to the
 * query string, additively, and keeps the selection in the URL so a filtered
 * view is a link an admin can share (FR-EK-B.1). Free-text search, CSV export
 * and a virtualized "load more" list stay out of scope (Enterprise / page size
 * too small to need it).
 *
 * Action codes (`auth.login`, `member.invited`, …) are the server's own event
 * names, shown verbatim in the filter and the table — like ticket status/
 * priority elsewhere (I18N-f/g), a raw identifier is data, not chrome, and
 * this screen has no per-action dictionary to translate 60-odd of them into.
 * Only the nine group labels above them are chrome, and those are translated.
 * The same rule covers metadata *keys* in the expanded row (`from`, `to`,
 * `mailbox`, `kind`): an open vocabulary written one `writeAuditEntry` call at
 * a time cannot be given a dictionary that stays true.
 *
 * ## What the expanded row shows, and why it is not a JSON dump (M-UI-e)
 *
 * The entry's `metadata` is the reason the trail is readable at all — a
 * `member.role_changed` row without `{from, to}` says only that *something*
 * changed — and until now it reached the browser and was thrown away. Three
 * decisions:
 *
 *   - **Every field is shown, none filtered.** The judgement about what a
 *     security event may keep was made at *write* time, per action, with the
 *     reasoning recorded beside each `writeAuditEntry` call: the verification
 *     mailbox is kept because an incident reviewer has to know who was asked to
 *     vouch for a domain, the card's last four is kept and the expiry is not,
 *     and `auth.ip_denied` deliberately stores no address at all. A second
 *     allowlist here could only subtract evidence somebody deliberately kept —
 *     and it would drift, silently hiding fields from actions added later.
 *   - **Rendered as labelled pairs, not raw JSON.** `{"from":"agent",…}` asks
 *     the reader to parse; a `<dl>` does not, and it is navigable by assistive
 *     technology. The screen also says out loud that the recorded detail is
 *     deliberately minimal, so a reviewer looking for a field that was never
 *     written stops looking rather than assuming the screen is hiding it.
 *   - **No copy-to-clipboard, no per-entry download.** The trail already has a
 *     sanctioned way out (`/audit-log/export`), behind its own scope and the
 *     Enterprise entitlement. A one-click "copy the whole record" on the
 *     ungated viewer would be a second export path with no gate of its own.
 *     Reading is not exporting.
 *
 * The detail is fetched by id (`GET /audit-log/:entryId`) rather than read out
 * of the row already in memory. That is what makes `?entry=<id>` a link worth
 * pasting into an incident ticket: it resolves after a reload, after the filter
 * moves, and past the list's 30-day window — none of which a row held in a
 * React Query page can do.
 */
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { Fragment } from 'react';
import type { ChangeEvent, ReactElement } from 'react';
import { Card, ErrorNotice, Page } from '../../components/Page.js';
import { EmptyState } from '../../components/EmptyState.js';
import { ListSkeleton } from '../../components/Skeleton.js';
import { VirtualTable } from '../../components/VirtualList.js';
import { useApiClient, useAuth } from '../../lib/auth-store.js';
import { formatDateTime } from '../../lib/format.js';
import { useTranslate, type TFunction } from '../../lib/i18n.js';

interface AuditLogEntry {
  id: string;
  action: string;
  actor_id: string | null;
  actor_type: 'agent' | 'bot' | 'customer' | 'system';
  target: string | null;
  metadata: Record<string, unknown>;
  ip: string | null;
  created_at: string;
}

interface AuditLogPageResponse {
  items: AuditLogEntry[];
  next_page_id?: string;
}

/**
 * What `GET /audit-log/:entryId` adds over a list row: the entry's gapless
 * position in the workspace's audit chain, or `null` on a row written before
 * the chain existed. The hashes that sit beside it in the table are not on this
 * surface at all — they are the evidentiary half of NFR-C6, sold behind
 * `audit_log--export:ro` and the Enterprise `siem_export` entitlement.
 */
interface AuditLogEntryDetail extends AuditLogEntry {
  chain_seq: number | null;
}

function actorLabel(t: TFunction, actorType: AuditLogEntry['actor_type']): string {
  return t(`audit.actor.${actorType}`);
}

/**
 * Mirrors `AUDIT_ACTIONS` (apps/api/src/services/audit/audit-log.ts), grouped
 * into the same families its comments name — there is no shared package to
 * import the vocabulary from, so this list is kept in step by hand. An action
 * added server-side and forgotten here is still filterable via a hand-built
 * link; it is only missing from the dropdown.
 */
const ACTION_GROUPS: ReadonlyArray<{ labelKey: string; actions: readonly string[] }> = [
  {
    labelKey: 'audit.group.authentication',
    actions: [
      'auth.login',
      'auth.login_failed',
      'auth.password_reset',
      'auth.ip_denied',
      // Grouped with the sign-in refusals because it is the same question —
      // "who was turned away at the door, and why" — even though the door in
      // this case is the region rather than the credential (NFR-C4).
      'security.region_rejected',
      // Same question again, one door along: a provisioning connector asked for
      // somebody outside the domains this workspace has verified (NFR-S11).
      'security.provisioning_domain_rejected',
    ],
  },
  {
    labelKey: 'audit.group.team',
    actions: [
      'member.invited',
      'member.invitation_revoked',
      'member.suspended',
      'member.unsuspended',
      'member.role_changed',
    ],
  },
  {
    labelKey: 'audit.group.settings',
    actions: [
      'settings.security_updated',
      'settings.routing_rule_created',
      'settings.routing_rule_updated',
      'settings.routing_rule_deleted',
      'settings.chat_timeout_updated',
      'settings.widget_updated',
      'settings.sales_tracker_updated',
      'settings.trusted_domain_added',
      'settings.trusted_domain_removed',
      'settings.ip_allowlist_added',
      'settings.ip_allowlist_removed',
    ],
  },
  {
    // Its own family rather than folded into Settings: these two record what a
    // workspace *committed to* and what that commitment refused, which is what
    // an auditor asks for by name (NFR-C4). Settings entries record a
    // configuration somebody can change back.
    labelKey: 'audit.group.compliance',
    actions: ['compliance.baa_signed', 'compliance.ai_region_blocked'],
  },
  { labelKey: 'audit.group.salesTracking', actions: ['sale.tracked'] },
  {
    labelKey: 'audit.group.billing',
    actions: ['billing.subscription_updated', 'billing.payment_method_updated'],
  },
  {
    labelKey: 'audit.group.webhooks',
    actions: ['webhook.created', 'webhook.deleted', 'webhook.delivery_exhausted'],
  },
  {
    labelKey: 'audit.group.tickets',
    actions: [
      'ticket.status_changed',
      'ticket.priority_changed',
      'ticket.merged',
      'ticket.unmerged',
      'ticket.follower_added',
      'ticket.follower_removed',
    ],
  },
  {
    labelKey: 'audit.group.credentials',
    actions: [
      'pat.created',
      'pat.revoked',
      'partner_app.created',
      'partner_app.updated',
      'partner_app.deleted',
      'partner_app.secret_rotated',
    ],
  },
  { labelKey: 'audit.group.data', actions: ['data.retention_pruned', 'data.deleted'] },
];

const ACTION_PARAM = 'action';
const DATE_FROM_PARAM = 'date_from';
const DATE_TO_PARAM = 'date_to';
/** Which entry is expanded. In the URL for the same reason the filters are. */
const ENTRY_PARAM = 'entry';

/**
 * How tall the expanded detail may grow before it scrolls inside its own cell.
 *
 * Not cosmetic: `VirtualTable` sizes its spacers as `rowHeight × count`, so an
 * in-flow detail row is height the window maths does not know about, and past
 * the expanded row the computed window drifts by that much. The virtualizer's
 * overscan is what absorbs it — six rows of slack, `6 × 52 = 312px` — so any
 * cap below that keeps the drift inside rows that are mounted anyway and the
 * seam never shows. 240 leaves a row and a half of margin. Only one entry is
 * ever expanded (the URL holds one id), so the error cannot accumulate.
 *
 * The alternative — teaching the virtualizer about one variable-height row — is
 * a change to a primitive four other screens share, for one screen's benefit.
 */
const DETAIL_MAX_HEIGHT = 240;

/** The id `aria-controls` points at; also what makes the pair addressable. */
function detailRowId(entryId: string): string {
  return `audit-entry-detail-${entryId}`;
}

/**
 * One metadata value as text.
 *
 * Scalars print themselves; an array becomes a comma list (`fields`, `scopes`
 * and `recipients` are all arrays of short strings); anything else falls back
 * to compact JSON. Nothing in this codebase writes nested metadata — the
 * writer's own comment records that a `grep` finds no second `{` — so the last
 * branch is a floor, not a shape anyone should design around.
 */
function formatMetadataValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (Array.isArray(value)) {
    return value.length === 0 ? '—' : value.map(formatMetadataValue).join(', ');
  }
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/** A date input's `YYYY-MM-DD` value to the start/end instant of that UTC day. */
function startOfDay(value: string): string {
  return `${value}T00:00:00.000Z`;
}
function endOfDay(value: string): string {
  return `${value}T23:59:59.999Z`;
}

/**
 * Builds the request path from the current filters plus an optional page
 * cursor. Omitting every param entirely (rather than sending them empty)
 * keeps the default request identical to the pre-filter screen's — the server
 * default (last 30 days) only ever comes from the caller sending nothing.
 */
function buildQuery(
  action: string,
  dateFrom: string,
  dateTo: string,
  pageId: string | undefined,
): string {
  const params = new URLSearchParams();
  if (action) params.set('action', action);
  if (dateFrom) params.set('date_from', startOfDay(dateFrom));
  if (dateTo) params.set('date_to', endOfDay(dateTo));
  if (pageId) params.set('page_id', pageId);
  const query = params.toString();
  return query ? `/audit-log?${query}` : '/audit-log';
}

export function AuditLogPage(): ReactElement {
  const t = useTranslate();
  const api = useApiClient();
  const scopes = useAuth((s) => s.agent?.scopes ?? []);
  const canView = scopes.includes('audit_log--all:ro');

  const [searchParams, setSearchParams] = useSearchParams();
  const action = searchParams.get(ACTION_PARAM) ?? '';
  const dateFrom = searchParams.get(DATE_FROM_PARAM) ?? '';
  const dateTo = searchParams.get(DATE_TO_PARAM) ?? '';
  const expandedId = searchParams.get(ENTRY_PARAM) ?? '';

  // The URL is the single source of truth for filters (no mirrored local
  // state) — the same shape the Tickets grid's sort deep-link uses (02.7-a) —
  // so a shared link and a reload both land on the exact same query.
  function setFilter(param: string, value: string): void {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(param, value);
    else next.delete(param);
    setSearchParams(next, { replace: true });
  }

  const query = useInfiniteQuery({
    queryKey: ['audit-log', action, dateFrom, dateTo],
    queryFn: ({ pageParam }: { pageParam: string | undefined }) =>
      api.get<AuditLogPageResponse>(buildQuery(action, dateFrom, dateTo, pageParam)),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.next_page_id,
    enabled: canView,
  });

  const items = query.data?.pages.flatMap((page) => page.items) ?? [];

  // A linked entry that the current filter/page does not contain still has to
  // open — that is the whole point of addressing it by id. It gets the same
  // detail component, mounted above the table instead of inside it, and the
  // moment "load more" or a filter change brings its row into the list the
  // in-flow expansion takes over and this disappears.
  const linkedOutsideList = expandedId !== '' && !items.some((entry) => entry.id === expandedId);

  return (
    <Page
      title={t('audit.title')}
      description={t('audit.description')}
      actions={
        canView ? (
          <AuditFilters
            action={action}
            dateFrom={dateFrom}
            dateTo={dateTo}
            onAction={(value) => setFilter(ACTION_PARAM, value)}
            onDateFrom={(value) => setFilter(DATE_FROM_PARAM, value)}
            onDateTo={(value) => setFilter(DATE_TO_PARAM, value)}
          />
        ) : undefined
      }
    >
      {!canView ? (
        <EmptyState
          title={t('audit.notAvailable.title')}
          description={t('audit.notAvailable.description')}
        />
      ) : query.isError ? (
        <ErrorNotice message={t('audit.loadError')} />
      ) : (
        <>
          {linkedOutsideList && (
            <Card className="mb-4">
              <div className="p-4">
                <p className="mb-2 text-xs font-medium text-content-secondary">
                  {t('audit.detail.linkedEntry')}
                </p>
                <AuditEntryDetail entryId={expandedId} />
              </div>
            </Card>
          )}
          <Card>
            {query.isPending ? (
              <ListSkeleton />
            ) : items.length === 0 ? (
              <EmptyState
                title={t('audit.empty.title')}
                description={t('audit.empty.description')}
              />
            ) : (
              <>
                <VirtualTable
                  items={items}
                  rowHeight={52}
                  caption={t('audit.title')}
                  colSpan={6}
                  head={
                    <thead>
                      <tr className="border-b border-border text-left">
                        <th scope="col" className="px-2 py-2">
                          <span className="sr-only">{t('audit.column.detail')}</span>
                        </th>
                        <Th>{t('audit.column.time')}</Th>
                        <Th>{t('audit.column.action')}</Th>
                        <Th>{t('audit.column.actor')}</Th>
                        <Th>{t('audit.column.target')}</Th>
                        <Th>{t('audit.column.ip')}</Th>
                      </tr>
                    </thead>
                  }
                  renderRow={(entry) => {
                    const expanded = entry.id === expandedId;
                    return (
                      <Fragment key={entry.id}>
                        <tr className="border-b border-border last:border-0">
                          <td className="px-2 py-2.5 align-top">
                            <button
                              type="button"
                              aria-expanded={expanded}
                              // Only while the row exists: an `aria-controls`
                              // pointing at nothing is an assertion the DOM does
                              // not support, and axe rightly flags it.
                              {...(expanded ? { 'aria-controls': detailRowId(entry.id) } : {})}
                              onClick={() => setFilter(ENTRY_PARAM, expanded ? '' : entry.id)}
                              className="rounded-md px-1.5 py-0.5 text-content-tertiary transition-colors hover:bg-inset hover:text-content"
                            >
                              <span className="sr-only">
                                {t('audit.detail.toggleAriaLabel', {
                                  action: entry.action,
                                  time: formatDateTime(entry.created_at) ?? entry.created_at,
                                })}
                              </span>
                              <span aria-hidden="true">{expanded ? '▾' : '▸'}</span>
                            </button>
                          </td>
                          <td className="whitespace-nowrap px-4 py-2.5 text-content-secondary">
                            {formatDateTime(entry.created_at) ?? '—'}
                          </td>
                          <td className="px-4 py-2.5 font-mono text-2xs">{entry.action}</td>
                          <td className="px-4 py-2.5">
                            <span className="block">{actorLabel(t, entry.actor_type)}</span>
                            {entry.actor_id && (
                              <span className="block truncate font-mono text-2xs text-content-tertiary">
                                {entry.actor_id}
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-2.5 font-mono text-2xs text-content-secondary">
                            {entry.target ?? '—'}
                          </td>
                          <td className="px-4 py-2.5 font-mono text-2xs text-content-secondary">
                            {entry.ip ?? '—'}
                          </td>
                        </tr>
                        {expanded && (
                          <tr
                            id={detailRowId(entry.id)}
                            className="border-b border-border bg-inset"
                          >
                            <td colSpan={6} className="px-4 py-3">
                              <div
                                className="overflow-y-auto"
                                style={{ maxHeight: DETAIL_MAX_HEIGHT }}
                              >
                                <AuditEntryDetail entryId={entry.id} />
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  }}
                />
                {query.hasNextPage && (
                  <div className="flex justify-center border-t border-border p-3">
                    <button
                      type="button"
                      onClick={() => {
                        void query.fetchNextPage();
                      }}
                      disabled={query.isFetchingNextPage}
                      className="rounded-md border border-border bg-inset px-3 py-1.5 text-sm font-medium text-content-secondary transition-colors hover:text-content disabled:opacity-60"
                    >
                      {query.isFetchingNextPage ? t('audit.loading') : t('audit.loadMore')}
                    </button>
                  </div>
                )}
              </>
            )}
          </Card>
        </>
      )}
    </Page>
  );
}

/**
 * The expanded row's body: what the entry recorded, fetched by id.
 *
 * Fetched rather than read off the row it hangs under, because the same
 * component also serves a link to an entry that is *not* in the list — a
 * bookmark from an incident ticket, a row older than the list's 30-day window.
 * One code path, and the id in the URL is a real reference rather than an index
 * into whatever happens to be loaded.
 *
 * The pairs are the entry's own metadata keys, verbatim (see the module doc):
 * an open vocabulary written one `writeAuditEntry` call at a time has no
 * dictionary that could stay true. Nothing is filtered out — the decision about
 * what a security event may keep was made at write time, and taking a second
 * bite here could only remove evidence somebody deliberately kept.
 */
function AuditEntryDetail({ entryId }: { entryId: string }): ReactElement {
  const t = useTranslate();
  const api = useApiClient();

  const query = useQuery({
    queryKey: ['audit-log', 'entry', entryId],
    queryFn: () => api.get<AuditLogEntryDetail>(`/audit-log/${entryId}`),
  });

  if (query.isPending) {
    return <p className="text-xs text-content-tertiary">{t('audit.loading')}</p>;
  }
  if (query.isError || !query.data) {
    return <ErrorNotice message={t('audit.detail.loadError')} />;
  }

  const entry = query.data;
  const fields = Object.entries(entry.metadata ?? {});

  return (
    <div className="space-y-3">
      <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-[max-content_1fr]">
        <DetailField label={t('audit.detail.entryId')} value={entry.id} mono />
        <DetailField
          label={t('audit.detail.chainPosition')}
          // `null` is a fact about the row, not a missing value: it predates the
          // workspace's chain and cannot be back-computed, so it is said rather
          // than shown as an empty cell. The hashes that would let somebody
          // *verify* the position are deliberately not on this surface.
          value={
            entry.chain_seq === null ? t('audit.detail.chainUnavailable') : `#${entry.chain_seq}`
          }
        />
      </dl>

      <div>
        <p className="mb-1 text-xs font-medium text-content-secondary">
          {t('audit.detail.recordedDetail')}
        </p>
        {fields.length === 0 ? (
          <p className="text-xs text-content-tertiary">{t('audit.detail.noMetadata')}</p>
        ) : (
          <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-[max-content_1fr]">
            {fields.map(([key, value]) => (
              <DetailField key={key} label={key} value={formatMetadataValue(value)} mono />
            ))}
          </dl>
        )}
      </div>

      {/* Said out loud so a reviewer who cannot find a field stops looking for
          it here: it was never written, rather than being withheld now. */}
      <p className="text-2xs text-content-tertiary">{t('audit.detail.minimalNote')}</p>
    </div>
  );
}

/** One `<dt>`/`<dd>` pair. Wrapped in a `<div>`, which a `<dl>` permits. */
function DetailField({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}): ReactElement {
  return (
    <div className="contents">
      <dt className="text-xs text-content-tertiary">{label}</dt>
      <dd className={`text-xs text-content${mono ? ' break-all font-mono' : ''}`}>{value}</dd>
    </div>
  );
}

/** Action + date range controls, in the page header (the `ReportsPage` range-control shape). */
function AuditFilters({
  action,
  dateFrom,
  dateTo,
  onAction,
  onDateFrom,
  onDateTo,
}: {
  action: string;
  dateFrom: string;
  dateTo: string;
  onAction: (value: string) => void;
  onDateFrom: (value: string) => void;
  onDateTo: (value: string) => void;
}): ReactElement {
  const t = useTranslate();
  return (
    <div className="flex flex-wrap items-center gap-3">
      <label className="flex items-center gap-2 text-xs text-content-secondary">
        <span className="sr-only">{t('audit.filterByActionAriaLabel')}</span>
        <select
          value={action}
          onChange={(event: ChangeEvent<HTMLSelectElement>) => onAction(event.target.value)}
          className="rounded-md border border-border bg-inset px-2 py-1.5 text-sm text-content outline-none"
        >
          <option value="">{t('audit.allActions')}</option>
          {ACTION_GROUPS.map((group) => (
            <optgroup key={group.labelKey} label={t(group.labelKey)}>
              {group.actions.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>
      <div className="flex items-center gap-1 text-xs text-content-secondary">
        <label className="flex items-center gap-1">
          <span className="sr-only">{t('audit.fromDateAriaLabel')}</span>
          <input
            type="date"
            value={dateFrom}
            max={dateTo || undefined}
            onChange={(event: ChangeEvent<HTMLInputElement>) => onDateFrom(event.target.value)}
            className="rounded-md border border-border bg-inset px-2 py-1 text-content"
          />
        </label>
        <span aria-hidden="true">→</span>
        <label className="flex items-center gap-1">
          <span className="sr-only">{t('audit.toDateAriaLabel')}</span>
          <input
            type="date"
            value={dateTo}
            min={dateFrom || undefined}
            onChange={(event: ChangeEvent<HTMLInputElement>) => onDateTo(event.target.value)}
            className="rounded-md border border-border bg-inset px-2 py-1 text-content"
          />
        </label>
      </div>
    </div>
  );
}

function Th({ children }: { children: string }): ReactElement {
  return (
    <th scope="col" className="px-4 py-2 text-xs font-medium text-content-secondary">
      {children}
    </th>
  );
}
