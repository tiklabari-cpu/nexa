/**
 * The workspace detail's tabs (tm 389.9 · FR-ADMIN-08). Each tab fetches its own read when it is
 * opened; each failed read says so with a retry, inside its own card.
 *
 * The one write is the note (Notes tab): the operator types it, then says why in the shared
 * `ReasonDialog` — every platform mutation carries a reason into the audit chain. Only a role
 * holding `workspaces.support` sees the form; the server refuses the others either way.
 */
import { useState, type FormEvent, type ReactElement, type ReactNode } from 'react';
import { useInfiniteQuery, type UseQueryResult } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { LoadError } from '../../components/LoadError.js';
import { Card } from '../../components/Page.js';
import { ReasonDialog } from '../../components/ReasonDialog.js';
import { api, hasPermission, useAuth } from '../../lib/auth-store.js';
import { formatCount, formatDate, formatDateTime, formatMoney } from '../../lib/format.js';
import { useTranslate } from '../../lib/i18n.js';
import type {
  PlatformWorkspaceAiSummary,
  PlatformWorkspaceAuditList,
  PlatformWorkspaceBrandList,
  PlatformWorkspaceDetail,
  PlatformWorkspaceImpersonationList,
  PlatformWorkspaceInvoiceList,
  PlatformWorkspaceMemberList,
  PlatformWorkspaceSandbox,
  PlatformWorkspaceSubscription,
  PlatformWorkspaceUsage,
} from '../../lib/platform-types.js';
import { useAddNote, useWorkspaceNotes, useWorkspaceTab } from './queries.js';
import {
  Cell,
  DataTable,
  EmptyLine,
  Facts,
  FIELD_CLASS,
  LINK_CLASS,
  Loading,
  PRIMARY_BUTTON_CLASS,
  SECONDARY_BUTTON_CLASS,
} from './ui.js';

type Detail = PlatformWorkspaceDetail['workspace'];

/** A tab's read: loading, failed (with a retry), or its content. */
function Loaded<T>({
  query,
  children,
}: {
  query: UseQueryResult<T>;
  children: (data: T) => ReactNode;
}): ReactElement {
  const t = useTranslate();
  if (query.isError) {
    return (
      <Card>
        <LoadError
          title={t('workspaces.tab.loadError')}
          error={query.error}
          onRetry={() => void query.refetch()}
        />
      </Card>
    );
  }
  if (query.data === undefined) {
    return (
      <Card>
        <Loading label={t('workspaces.loading')} />
      </Card>
    );
  }
  return <>{children(query.data)}</>;
}

function SectionTitle({ children }: { children: string }): ReactElement {
  return <h2 className="border-b border-border px-4 py-2 text-sm font-semibold">{children}</h2>;
}

export function OverviewTab({ detail }: { detail: Detail }): ReactElement {
  const t = useTranslate();
  const { organization, license, owner, counts } = detail;
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <SectionTitle>{t('workspaces.overview.organization')}</SectionTitle>
        <Facts
          items={[
            { label: t('workspaces.overview.name'), value: organization.name },
            { label: t('workspaces.list.licence'), value: detail.license_id },
            { label: t('workspaces.list.region'), value: organization.region.toUpperCase() },
            { label: t('workspaces.overview.timezone'), value: organization.timezone },
            { label: t('workspaces.overview.sector'), value: organization.sector },
            { label: t('workspaces.overview.size'), value: organization.company_size },
            { label: t('workspaces.list.created'), value: formatDate(organization.created_at) },
          ]}
        />
      </Card>
      <Card>
        <SectionTitle>{t('workspaces.overview.licence')}</SectionTitle>
        <Facts
          items={[
            { label: t('workspaces.list.status'), value: t(`workspaces.status.${license.status}`) },
            { label: t('workspaces.list.plan'), value: t(`workspaces.plan.${license.plan}`) },
            {
              label: t('workspaces.overview.cycle'),
              value: t(`workspaces.cycle.${license.billing_cycle}`),
            },
            { label: t('workspaces.list.trialEnds'), value: formatDate(license.trial_ends_at) },
            {
              label: t('workspaces.overview.suspendedAt'),
              value: formatDateTime(license.suspended_at),
            },
            {
              label: t('workspaces.overview.purgeAt'),
              value: formatDate(license.purge_scheduled_at),
            },
            {
              label: t('workspaces.overview.onboarded'),
              value: formatDate(license.onboarding_completed_at),
            },
            {
              label: t('workspaces.overview.sandboxOf'),
              value: license.sandbox_of_license_id ? (
                <Link to={`/workspaces/${license.sandbox_of_license_id}`} className={LINK_CLASS}>
                  {license.sandbox_of_license_id}
                </Link>
              ) : null,
            },
          ]}
        />
      </Card>
      <Card>
        <SectionTitle>{t('workspaces.overview.owner')}</SectionTitle>
        {owner ? (
          <Facts
            items={[
              { label: t('workspaces.overview.name'), value: owner.name },
              { label: t('workspaces.members.email'), value: owner.email },
              {
                label: t('workspaces.overview.verified'),
                value: owner.email_verified_at
                  ? formatDate(owner.email_verified_at)
                  : t('workspaces.overview.notVerified'),
              },
            ]}
          />
        ) : (
          <EmptyLine>{t('workspaces.overview.noOwner')}</EmptyLine>
        )}
      </Card>
      <Card>
        <SectionTitle>{t('workspaces.overview.counts')}</SectionTitle>
        <Facts
          items={(['members', 'brands', 'customers', 'chats', 'tickets', 'ai_agents'] as const).map(
            (key) => ({
              label: t(`workspaces.counts.${key}`),
              value: formatCount(counts[key]),
            }),
          )}
        />
      </Card>
      <Card>
        <SectionTitle>{t('workspaces.overview.history')}</SectionTitle>
        <DataTable
          caption={t('workspaces.overview.history')}
          headers={[
            t('workspaces.history.event'),
            t('workspaces.history.at'),
            t('workspaces.history.reason'),
          ]}
        >
          {detail.status_history.map((entry, index) => (
            <tr key={`${entry.action}-${entry.at}-${index}`}>
              <Cell>{t(`workspaces.history.${entry.action}`)}</Cell>
              <Cell>{formatDateTime(entry.at)}</Cell>
              <Cell>{entry.reason}</Cell>
            </tr>
          ))}
        </DataTable>
      </Card>
    </div>
  );
}

export function MembersTab({ licenseId }: { licenseId: string }): ReactElement {
  const t = useTranslate();
  const query = useWorkspaceTab(licenseId, 'members', () =>
    api.get<PlatformWorkspaceMemberList>(`/workspaces/${licenseId}/members`),
  );
  return (
    <Loaded query={query}>
      {(data) => (
        <Card>
          {data.data.length === 0 ? (
            <EmptyLine>{t('workspaces.members.empty')}</EmptyLine>
          ) : (
            <DataTable
              caption={t('workspaces.tabs.members')}
              headers={[
                t('workspaces.overview.name'),
                t('workspaces.members.email'),
                t('workspaces.members.role'),
                t('workspaces.members.twoFactor'),
                t('workspaces.members.state'),
                t('workspaces.members.joined'),
                t('workspaces.members.lastSeen'),
              ]}
            >
              {data.data.map((member) => (
                <tr key={member.account_id}>
                  <Cell>{member.name}</Cell>
                  <Cell>{member.email}</Cell>
                  <Cell>{t(`workspaces.roles.${member.role}`)}</Cell>
                  <Cell>
                    {member.two_factor_enabled ? t('workspaces.yes') : t('workspaces.no')}
                  </Cell>
                  <Cell>
                    {member.suspended
                      ? t('workspaces.members.suspended')
                      : t('workspaces.members.active')}
                  </Cell>
                  <Cell>{formatDate(member.joined_at)}</Cell>
                  <Cell>{formatDateTime(member.last_seen_at)}</Cell>
                </tr>
              ))}
            </DataTable>
          )}
        </Card>
      )}
    </Loaded>
  );
}

export function BrandsTab({ licenseId }: { licenseId: string }): ReactElement {
  const t = useTranslate();
  const query = useWorkspaceTab(licenseId, 'brands', () =>
    api.get<PlatformWorkspaceBrandList>(`/workspaces/${licenseId}/brands`),
  );
  return (
    <Loaded query={query}>
      {(data) => (
        <Card>
          {data.data.length === 0 ? (
            <EmptyLine>{t('workspaces.brands.empty')}</EmptyLine>
          ) : (
            <DataTable
              caption={t('workspaces.tabs.brands')}
              headers={[
                t('workspaces.overview.name'),
                t('workspaces.brands.slug'),
                t('workspaces.brands.default'),
                t('workspaces.list.created'),
              ]}
            >
              {data.data.map((brand) => (
                <tr key={brand.id}>
                  <Cell>{brand.name}</Cell>
                  <Cell>{brand.slug}</Cell>
                  <Cell>{brand.is_default ? t('workspaces.yes') : t('workspaces.no')}</Cell>
                  <Cell>{formatDate(brand.created_at)}</Cell>
                </tr>
              ))}
            </DataTable>
          )}
        </Card>
      )}
    </Loaded>
  );
}

export function UsageTab({ licenseId }: { licenseId: string }): ReactElement {
  const t = useTranslate();
  const query = useWorkspaceTab(licenseId, 'usage', () =>
    api.get<PlatformWorkspaceUsage>(`/workspaces/${licenseId}/usage`),
  );
  return (
    <Loaded query={query}>
      {(data) => (
        <div className="flex flex-col gap-4">
          <Card>
            <SectionTitle>
              {t('workspaces.usage.current', { period: data.current.period })}
            </SectionTitle>
            <Facts
              items={[
                {
                  label: t('workspaces.usage.aiResolutions'),
                  value: t('workspaces.usage.ofIncluded', {
                    used: formatCount(data.current.ai_resolutions.used) ?? '0',
                    included: formatCount(data.current.ai_resolutions.included) ?? '0',
                  }),
                },
                {
                  label: t('workspaces.usage.apiCalls'),
                  value: t('workspaces.usage.ofIncluded', {
                    used: formatCount(data.current.api_calls.used) ?? '0',
                    included: formatCount(data.current.api_calls.included) ?? '0',
                  }),
                },
              ]}
            />
          </Card>
          <Card>
            <SectionTitle>{t('workspaces.usage.daily', { days: data.days })}</SectionTitle>
            <DataTable
              caption={t('workspaces.usage.daily', { days: data.days })}
              headers={[
                t('workspaces.usage.date'),
                t('workspaces.usage.llm'),
                t('workspaces.usage.embedding'),
              ]}
            >
              {[...data.ai_daily].reverse().map((day) => (
                <tr key={day.date}>
                  <Cell>{day.date}</Cell>
                  <Cell>{formatCount(day.llm)}</Cell>
                  <Cell>{formatCount(day.embedding)}</Cell>
                </tr>
              ))}
            </DataTable>
          </Card>
          <Card>
            <SectionTitle>{t('workspaces.usage.periods')}</SectionTitle>
            {data.periods.length === 0 ? (
              <EmptyLine>{t('workspaces.usage.noPeriods')}</EmptyLine>
            ) : (
              <DataTable
                caption={t('workspaces.usage.periods')}
                headers={[
                  t('workspaces.usage.period'),
                  t('workspaces.usage.metric'),
                  t('workspaces.usage.quantity'),
                  t('workspaces.usage.included'),
                ]}
              >
                {data.periods.map((row) => (
                  <tr key={`${row.period}-${row.metric}`}>
                    <Cell>{row.period}</Cell>
                    <Cell>{row.metric}</Cell>
                    <Cell>{formatCount(row.quantity)}</Cell>
                    <Cell>{formatCount(row.included)}</Cell>
                  </tr>
                ))}
              </DataTable>
            )}
          </Card>
        </div>
      )}
    </Loaded>
  );
}

export function SubscriptionTab({ licenseId }: { licenseId: string }): ReactElement {
  const t = useTranslate();
  const query = useWorkspaceTab(licenseId, 'subscription', () =>
    api.get<PlatformWorkspaceSubscription>(`/workspaces/${licenseId}/subscription`),
  );
  return (
    <Loaded query={query}>
      {(data) => (
        <Card>
          <Facts
            items={[
              { label: t('workspaces.list.plan'), value: t(`workspaces.plan.${data.plan}`) },
              { label: t('workspaces.list.status'), value: t(`workspaces.status.${data.status}`) },
              {
                label: t('workspaces.subscription.access'),
                value: t(`workspaces.access.${data.access}`),
              },
              {
                label: t('workspaces.overview.cycle'),
                value: t(`workspaces.cycle.${data.billing_cycle}`),
              },
              {
                label: t('workspaces.subscription.seats'),
                value: t('workspaces.subscription.seatsValue', {
                  seats: data.seats,
                  min: data.min_seats,
                }),
              },
              {
                label: t('workspaces.subscription.unitPrice'),
                value: formatMoney(data.unit_price_cents),
              },
              { label: t('workspaces.list.trialEnds'), value: formatDate(data.trial.ends_at) },
              {
                label: t('workspaces.subscription.estimate'),
                value: formatMoney(data.estimated_total_cents),
              },
            ]}
          />
        </Card>
      )}
    </Loaded>
  );
}

export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function InvoicesTab({ licenseId }: { licenseId: string }): ReactElement {
  const t = useTranslate();
  const [failed, setFailed] = useState<string | null>(null);
  const query = useWorkspaceTab(licenseId, 'invoices', () =>
    api.get<PlatformWorkspaceInvoiceList>(`/workspaces/${licenseId}/invoices`),
  );

  async function download(period: string): Promise<void> {
    setFailed(null);
    try {
      const blob = await api.getBlob(`/workspaces/${licenseId}/invoices/${period}/download`);
      saveBlob(blob, `invoice-${licenseId}-${period}.csv`);
    } catch {
      setFailed(period);
    }
  }

  return (
    <Loaded query={query}>
      {(data) => (
        <Card>
          {failed && (
            <p role="alert" className="px-4 pt-3 text-sm text-danger">
              {t('workspaces.invoices.downloadFailed', { period: failed })}
            </p>
          )}
          <DataTable
            caption={t('workspaces.tabs.invoices')}
            headers={[
              t('workspaces.invoices.number'),
              t('workspaces.usage.period'),
              t('workspaces.list.status'),
              t('workspaces.invoices.total'),
              t('workspaces.invoices.file'),
            ]}
          >
            {data.invoices.map((invoice) => (
              <tr key={invoice.period}>
                <Cell>{invoice.number}</Cell>
                <Cell>{invoice.period_label}</Cell>
                <Cell>{t(`workspaces.invoices.status.${invoice.status}`)}</Cell>
                <Cell>{formatMoney(invoice.total_cents)}</Cell>
                <Cell>
                  <button
                    type="button"
                    className={SECONDARY_BUTTON_CLASS}
                    onClick={() => void download(invoice.period)}
                    aria-label={t('workspaces.invoices.downloadNamed', {
                      period: invoice.period_label,
                    })}
                  >
                    {t('workspaces.invoices.download')}
                  </button>
                </Cell>
              </tr>
            ))}
          </DataTable>
        </Card>
      )}
    </Loaded>
  );
}

export function AuditTab({ licenseId }: { licenseId: string }): ReactElement {
  const t = useTranslate();
  const query = useInfiniteQuery({
    queryKey: ['workspaces', licenseId, 'audit'],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      api.get<PlatformWorkspaceAuditList>(
        `/audit/workspaces/${licenseId}${pageParam ? `?page_id=${encodeURIComponent(pageParam)}` : ''}`,
      ),
    getNextPageParam: (last) => last.next_page_id ?? null,
  });
  if (query.isError) {
    return (
      <Card>
        <LoadError
          title={t('workspaces.tab.loadError')}
          error={query.error}
          onRetry={() => void query.refetch()}
        />
      </Card>
    );
  }
  if (!query.data) {
    return (
      <Card>
        <Loading label={t('workspaces.loading')} />
      </Card>
    );
  }
  const items = query.data.pages.flatMap((page) => page.items);
  return (
    <Card>
      <p className="px-4 pt-3 text-xs text-content-secondary">{t('workspaces.audit.window')}</p>
      {items.length === 0 ? (
        <EmptyLine>{t('workspaces.audit.empty')}</EmptyLine>
      ) : (
        <DataTable
          caption={t('workspaces.tabs.audit')}
          headers={[
            t('workspaces.history.at'),
            t('workspaces.audit.action'),
            t('workspaces.audit.actor'),
            t('workspaces.audit.target'),
          ]}
        >
          {items.map((item) => (
            <tr key={item.id}>
              <Cell>{formatDateTime(item.created_at)}</Cell>
              <Cell>
                <code className="text-xs">{item.action}</code>
              </Cell>
              <Cell>{t(`workspaces.audit.actorType.${item.actor_type}`)}</Cell>
              <Cell>{item.target}</Cell>
            </tr>
          ))}
        </DataTable>
      )}
      {query.hasNextPage && (
        <div className="border-t border-border p-3 text-center">
          <button
            type="button"
            className={SECONDARY_BUTTON_CLASS}
            disabled={query.isFetchingNextPage}
            onClick={() => void query.fetchNextPage()}
          >
            {t('workspaces.list.more')}
          </button>
        </div>
      )}
    </Card>
  );
}

export function SandboxTab({ licenseId }: { licenseId: string }): ReactElement {
  const t = useTranslate();
  const query = useWorkspaceTab(licenseId, 'sandbox', () =>
    api.get<PlatformWorkspaceSandbox>(`/workspaces/${licenseId}/sandbox`),
  );
  return (
    <Loaded query={query}>
      {(data) => (
        <Card>
          {data.is_sandbox && data.sandbox_of_license_id ? (
            <p className="p-4 text-sm">
              {t('workspaces.sandbox.isSandbox')}{' '}
              <Link to={`/workspaces/${data.sandbox_of_license_id}`} className={LINK_CLASS}>
                {data.sandbox_of_license_id}
              </Link>
            </p>
          ) : data.sandbox ? (
            <Facts
              items={[
                {
                  label: t('workspaces.list.licence'),
                  value: (
                    <Link to={`/workspaces/${data.sandbox.license_id}`} className={LINK_CLASS}>
                      {data.sandbox.license_id}
                    </Link>
                  ),
                },
                { label: t('workspaces.list.created'), value: formatDate(data.sandbox.created_at) },
                {
                  label: t('workspaces.sandbox.resetAt'),
                  value:
                    formatDateTime(data.sandbox.reset_at) ?? t('workspaces.sandbox.neverReset'),
                },
              ]}
            />
          ) : (
            <EmptyLine>{t('workspaces.sandbox.none')}</EmptyLine>
          )}
        </Card>
      )}
    </Loaded>
  );
}

export function NotesTab({ licenseId }: { licenseId: string }): ReactElement {
  const t = useTranslate();
  const me = useAuth((s) => s.me);
  const canWrite = hasPermission(me, 'workspaces.support');
  const query = useWorkspaceNotes(licenseId);
  const addNote = useAddNote(licenseId);
  const [draft, setDraft] = useState('');
  const [confirming, setConfirming] = useState(false);
  const notes = query.data?.pages.flatMap((page) => page.data) ?? [];

  function submit(event: FormEvent): void {
    event.preventDefault();
    if (draft.trim()) setConfirming(true);
  }

  return (
    <div className="flex flex-col gap-4">
      {canWrite && (
        <Card>
          <form onSubmit={submit} className="flex flex-col gap-2 p-4">
            <label htmlFor="workspace-note" className="text-sm font-medium">
              {t('workspaces.notes.new')}
            </label>
            <textarea
              id="workspace-note"
              value={draft}
              maxLength={4000}
              rows={3}
              onChange={(event) => setDraft(event.target.value)}
              className={FIELD_CLASS}
              aria-describedby="workspace-note-hint"
            />
            <p id="workspace-note-hint" className="text-xs text-content-secondary">
              {t('workspaces.notes.hint')}
            </p>
            <div>
              <button type="submit" className={PRIMARY_BUTTON_CLASS} disabled={!draft.trim()}>
                {t('workspaces.notes.add')}
              </button>
            </div>
          </form>
        </Card>
      )}
      {confirming && (
        <ReasonDialog
          title={t('workspaces.notes.reasonTitle')}
          description={t('workspaces.notes.reasonBody')}
          confirmLabel={t('workspaces.notes.add')}
          onConfirm={({ reason }) => addNote.mutateAsync({ body: draft.trim(), reason })}
          onDone={() => {
            setConfirming(false);
            setDraft('');
          }}
          onCancel={() => setConfirming(false)}
        />
      )}
      <Card>
        {query.isError ? (
          <LoadError
            title={t('workspaces.tab.loadError')}
            error={query.error}
            onRetry={() => void query.refetch()}
          />
        ) : !query.data ? (
          <Loading label={t('workspaces.loading')} />
        ) : notes.length === 0 ? (
          <EmptyLine>{t('workspaces.notes.empty')}</EmptyLine>
        ) : (
          <ul className="divide-y divide-border">
            {notes.map((note) => (
              <li key={note.id} className="p-4">
                <p className="whitespace-pre-wrap text-sm">{note.body}</p>
                <p className="mt-1 text-xs text-content-secondary">
                  {t('workspaces.notes.byline', {
                    who: note.admin_email ?? note.admin_id,
                    when: formatDateTime(note.created_at) ?? '',
                  })}
                </p>
              </li>
            ))}
          </ul>
        )}
        {query.hasNextPage && (
          <div className="border-t border-border p-3 text-center">
            <button
              type="button"
              className={SECONDARY_BUTTON_CLASS}
              disabled={query.isFetchingNextPage}
              onClick={() => void query.fetchNextPage()}
            >
              {t('workspaces.list.more')}
            </button>
          </div>
        )}
      </Card>
    </div>
  );
}

export function ImpersonationsTab({ licenseId }: { licenseId: string }): ReactElement {
  const t = useTranslate();
  const query = useWorkspaceTab(licenseId, 'impersonations', () =>
    api.get<PlatformWorkspaceImpersonationList>(`/workspaces/${licenseId}/impersonations`),
  );
  return (
    <Loaded query={query}>
      {(data) => (
        <Card>
          {data.data.length === 0 ? (
            <EmptyLine>{t('workspaces.impersonations.empty')}</EmptyLine>
          ) : (
            <DataTable
              caption={t('workspaces.tabs.impersonations')}
              headers={[
                t('workspaces.impersonations.operator'),
                t('workspaces.impersonations.mode'),
                t('workspaces.impersonations.started'),
                t('workspaces.impersonations.ended'),
                t('workspaces.impersonations.endReason'),
              ]}
            >
              {data.data.map((row) => (
                <tr key={row.id}>
                  <Cell>{row.admin_email ?? row.admin_id}</Cell>
                  <Cell>{t(`workspaces.impersonations.modes.${row.mode}`)}</Cell>
                  <Cell>{formatDateTime(row.started_at)}</Cell>
                  <Cell>
                    {formatDateTime(row.ended_at) ?? t('workspaces.impersonations.ongoing')}
                  </Cell>
                  <Cell>{row.end_reason}</Cell>
                </tr>
              ))}
            </DataTable>
          )}
        </Card>
      )}
    </Loaded>
  );
}

export function AiTab({ licenseId }: { licenseId: string }): ReactElement {
  const t = useTranslate();
  const query = useWorkspaceTab(licenseId, 'ai-summary', () =>
    api.get<PlatformWorkspaceAiSummary>(`/workspaces/${licenseId}/ai-summary`),
  );
  return (
    <Loaded query={query}>
      {(data) => {
        // A section whose source has not shipped is "not available yet", never a zero.
        const count = (status: string, value: number): string =>
          status === 'not_installed'
            ? t('workspaces.ai.notInstalled')
            : (formatCount(value) ?? '0');
        const rules = Object.entries(data.guardrail_hits.by_rule).sort(
          (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
        );
        const run = data.compliance_pack.last_run;
        return (
          <>
            <Card>
              <p className="px-4 pt-4 text-xs text-content-secondary">{t('workspaces.ai.intro')}</p>
              <Facts
                items={[
                  { label: t('workspaces.ai.total'), value: formatCount(data.ai_agents.total) },
                  { label: t('workspaces.ai.active'), value: formatCount(data.ai_agents.active) },
                  {
                    label: t('workspaces.ai.guidanceTotal'),
                    value: count(data.guidance_rules.status, data.guidance_rules.total),
                  },
                  {
                    label: t('workspaces.ai.guidanceActive'),
                    value: count(data.guidance_rules.status, data.guidance_rules.active),
                  },
                  {
                    label: t('workspaces.ai.configChanges'),
                    value: count(data.config_changes.status, data.config_changes.last_30_days),
                  },
                  {
                    label: t('workspaces.ai.hits'),
                    value: count(data.guardrail_hits.status, data.guardrail_hits.last_30_days),
                  },
                  {
                    label: t('workspaces.ai.qaReviewed'),
                    value: count(data.qa.status, data.qa.reviewed_30_days),
                  },
                  {
                    label: t('workspaces.ai.qaAwaiting'),
                    value: count(data.qa.status, data.qa.awaiting_review),
                  },
                ]}
              />
              <p className="px-4 pb-4 text-sm">
                <span className="text-content-secondary">{t('workspaces.ai.compliance')}: </span>
                {run === null
                  ? t('workspaces.ai.compliance.none')
                  : t('workspaces.ai.compliance.line', {
                      version: run.version,
                      passed:
                        run.passed === null
                          ? t('workspaces.ai.compliance.unknown')
                          : (formatCount(run.passed) ?? '0'),
                      failed:
                        run.failed === null
                          ? t('workspaces.ai.compliance.unknown')
                          : (formatCount(run.failed) ?? '0'),
                      status: run.run_status,
                    })}
              </p>
            </Card>
            <Card>
              <h3 className="px-4 pt-4 text-sm font-semibold">
                {t('workspaces.ai.hitsByRule.heading')}
              </h3>
              {rules.length === 0 ? (
                <EmptyLine>{t('workspaces.ai.hitsByRule.none')}</EmptyLine>
              ) : (
                <DataTable
                  caption={t('workspaces.ai.hitsByRule.caption')}
                  headers={[
                    t('workspaces.ai.hitsByRule.rule'),
                    t('workspaces.ai.hitsByRule.count'),
                  ]}
                >
                  {rules.map(([rule, hits]) => (
                    <tr key={rule}>
                      <Cell>
                        {rule === 'workspace_rule' || rule === 'forbidden_phrase'
                          ? t(`workspaces.ai.hitsByRule.${rule}`)
                          : rule}
                      </Cell>
                      <Cell>{formatCount(hits)}</Cell>
                    </tr>
                  ))}
                </DataTable>
              )}
            </Card>
          </>
        );
      }}
    </Loaded>
  );
}
