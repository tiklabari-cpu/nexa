/**
 * One workspace, tab by tab (tm 389.9 · FR-ADMIN-08): Overview, Members, Brands, Usage,
 * Subscription, Invoices, Audit, Sandbox, Notes, Impersonation and AI. The tab is the last
 * segment of the address (`/workspaces/42/members`), so a tab can be linked to and the back
 * button walks between them.
 *
 * Counts, states and identities only — never a message, a player or a knowledge article
 * (requirements §2). The Audit tab is the workspace's own trail (`GET /audit/workspaces/{id}`),
 * so it shows only for a role that reads audit trails.
 *
 * The header's "Actions" menu (tm 389.10 · FR-ADMIN-09) acts on the workspace; a suspension or
 * a scheduled deletion shows as a banner above the tabs, with the deletion's countdown.
 */
import { useState, type ReactElement } from 'react';
import { NavLink, useParams } from 'react-router-dom';
import { LoadError } from '../../components/LoadError.js';
import { NotFoundPage } from '../../components/NotFoundPage.js';
import { Card, Page } from '../../components/Page.js';
import { Banner } from '../../components/ui/Banner.js';
import { ApiClientError } from '../../lib/api-client.js';
import { hasPermission, useAuth } from '../../lib/auth-store.js';
import { useTranslate } from '../../lib/i18n.js';
import { ImpersonateButton } from '../support/Impersonation.js';
import { useWorkspace } from './queries.js';
import {
  WorkspaceActionDialog,
  WorkspaceActionsMenu,
  WorkspaceStateBanners,
  type ActionNotice,
  type WorkspaceActionKey,
} from './WorkspaceActions.js';
import {
  AiTab,
  AuditTab,
  BrandsTab,
  ImpersonationsTab,
  InvoicesTab,
  MembersTab,
  NotesTab,
  OverviewTab,
  SandboxTab,
  SubscriptionTab,
  UsageTab,
} from './WorkspaceTabs.js';
import { Loading } from './ui.js';

export const WORKSPACE_TABS = [
  'overview',
  'members',
  'brands',
  'usage',
  'subscription',
  'invoices',
  'audit',
  'sandbox',
  'notes',
  'impersonations',
  'ai',
] as const;
export type WorkspaceTab = (typeof WORKSPACE_TABS)[number];

export function WorkspaceDetailPage(): ReactElement {
  const t = useTranslate();
  const params = useParams();
  const licenseId = params['licenseId'] ?? '';
  const me = useAuth((s) => s.me);
  const tabs = WORKSPACE_TABS.filter((tab) => tab !== 'audit' || hasPermission(me, 'audit.read'));
  const requested = params['*'] || 'overview';
  const tab = (tabs as readonly string[]).includes(requested) ? (requested as WorkspaceTab) : null;
  const query = useWorkspace(licenseId);
  const [action, setAction] = useState<WorkspaceActionKey | null>(null);
  const [notice, setNotice] = useState<ActionNotice | null>(null);
  const select = (next: WorkspaceActionKey) => {
    setNotice(null);
    setAction(next);
  };

  if (tab === null) return <NotFoundPage />;

  if (query.isError) {
    const notFound = query.error instanceof ApiClientError && query.error.status === 404;
    return (
      <Page title={t('nav.workspaces')}>
        <Card>
          {notFound ? (
            <div className="p-6">
              <h2 className="text-sm font-semibold">{t('workspaces.detail.notFound.title')}</h2>
              <p className="mt-1 text-sm text-content-secondary">
                {t('workspaces.detail.notFound.body', { id: licenseId })}
              </p>
            </div>
          ) : (
            <LoadError
              title={t('workspaces.detail.loadError')}
              error={query.error}
              onRetry={() => void query.refetch()}
            />
          )}
        </Card>
      </Page>
    );
  }

  const workspace = query.data?.workspace;
  return (
    <Page
      title={workspace?.organization.name ?? t('nav.workspaces')}
      description={t('workspaces.detail.description', { id: licenseId })}
      actions={
        workspace ? (
          <div className="flex items-center gap-2">
            {/* "Enter as the customer" (tm 389.15): read-only unless a superadmin asks. */}
            <ImpersonateButton workspace={workspace} />
            <WorkspaceActionsMenu workspace={workspace} onSelect={select} />
          </div>
        ) : null
      }
    >
      {workspace && <WorkspaceStateBanners workspace={workspace} onSelect={select} />}
      {notice && (
        <Banner tone={notice.tone} role="status" dismissible onDismiss={() => setNotice(null)}>
          {notice.message}
        </Banner>
      )}
      {workspace && action && (
        <WorkspaceActionDialog
          action={action}
          workspace={workspace}
          onClose={() => setAction(null)}
          onNotice={setNotice}
        />
      )}
      <nav aria-label={t('workspaces.tabs.label')}>
        <ul className="flex flex-wrap gap-1 border-b border-border">
          {tabs.map((name) => (
            <li key={name}>
              <NavLink
                to={`/workspaces/${licenseId}${name === 'overview' ? '' : `/${name}`}`}
                end
                className={({ isActive }) =>
                  `-mb-px inline-block border-b-2 px-3 py-2 text-sm ${
                    isActive
                      ? 'border-brand-600 font-medium text-content'
                      : 'border-transparent text-content-secondary hover:text-content'
                  }`
                }
              >
                {t(`workspaces.tabs.${name}`)}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
      <section aria-label={t(`workspaces.tabs.${tab}`)}>
        {workspace ? (
          <TabBody tab={tab} licenseId={licenseId} detail={workspace} />
        ) : (
          <Card>
            <Loading label={t('workspaces.loading')} />
          </Card>
        )}
      </section>
    </Page>
  );
}

function TabBody({
  tab,
  licenseId,
  detail,
}: {
  tab: WorkspaceTab;
  licenseId: string;
  detail: NonNullable<ReturnType<typeof useWorkspace>['data']>['workspace'];
}): ReactElement {
  switch (tab) {
    case 'overview':
      return <OverviewTab detail={detail} />;
    case 'members':
      return <MembersTab licenseId={licenseId} />;
    case 'brands':
      return <BrandsTab licenseId={licenseId} />;
    case 'usage':
      return <UsageTab licenseId={licenseId} />;
    case 'subscription':
      return <SubscriptionTab licenseId={licenseId} />;
    case 'invoices':
      return <InvoicesTab licenseId={licenseId} />;
    case 'audit':
      return <AuditTab licenseId={licenseId} />;
    case 'sandbox':
      return <SandboxTab licenseId={licenseId} />;
    case 'notes':
      return <NotesTab licenseId={licenseId} />;
    case 'impersonations':
      return <ImpersonationsTab licenseId={licenseId} />;
    case 'ai':
      return <AiTab licenseId={licenseId} />;
  }
}
