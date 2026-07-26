/**
 * Apps marketplace — FR-MOD-09.1.
 *
 * A grid of third-party integrations. A card is connected through the (mock)
 * OAuth flow: "Connect" opens a consent dialog listing the permissions the app
 * asks for, and "Authorize" runs the handshake (start → callback) and flips the
 * card to Connected (KK "Kart → izin/OAuth akışı"). A connected card shows the
 * account it linked and offers to disconnect. What a connected app *does* — its
 * data in a conversation — shows up in the Details pane, not here.
 *
 * The list drives itself entirely from `/settings/apps`: the status is read, not
 * decided here, so a card can never claim to be connected when it is not.
 */
import { useState, type ReactElement } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AppListItem, AppOAuthStart } from '@nexa/types';
import { Card, ErrorNotice, Page, Section } from '../../components/Page.js';
import { StatusDot } from '../../components/StatusDot.js';
import { Modal } from '../../components/ui/index.js';
import { useApiClient } from '../../lib/auth-store.js';

const APPS_KEY = ['settings', 'apps'] as const;

/** Human labels for the category chip. */
const CATEGORY_LABEL: Record<AppListItem['category'], string> = {
  crm: 'CRM',
  ecommerce: 'E-commerce',
  payments: 'Payments',
  marketing: 'Marketing',
  productivity: 'Productivity',
};

export function AppsMarketplace(): ReactElement {
  const api = useApiClient();
  const apps = useQuery({
    queryKey: APPS_KEY,
    queryFn: () => api.get<{ items: AppListItem[] }>('/settings/apps'),
  });

  return (
    <Section
      title="Marketplace"
      description="Connect the tools your team already uses. Connected apps show their data right inside a conversation."
    >
      {apps.error ? (
        <ErrorNotice message="Could not load the apps marketplace." />
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3">
          {(apps.data?.items ?? []).map((app) => (
            <AppCard key={app.id} app={app} />
          ))}
        </div>
      )}
    </Section>
  );
}

function AppCard({ app }: { app: AppListItem }): ReactElement {
  const api = useApiClient();
  const queryClient = useQueryClient();
  const [consenting, setConsenting] = useState(false);

  const invalidate = (): Promise<void> => queryClient.invalidateQueries({ queryKey: APPS_KEY });

  // The (mock) OAuth handshake: start returns a signed state, the callback
  // exchanges it — plus the code the provider "returns" — for a connection.
  const connect = useMutation({
    mutationFn: async () => {
      const start = await api.post<AppOAuthStart>(`/settings/apps/${app.id}/oauth/start`);
      return api.post<AppListItem>(`/settings/apps/${app.id}/oauth/callback`, {
        state: start.state,
        code: 'mock-auth-code',
      });
    },
    onSuccess: async () => {
      setConsenting(false);
      await invalidate();
    },
  });

  const disconnect = useMutation({
    mutationFn: () => api.delete<void>(`/settings/apps/${app.id}`),
    onSuccess: () => invalidate(),
  });

  return (
    <Card>
      <div data-testid={`app-${app.id}`} className="flex h-full flex-col gap-2 p-4">
        <div className="flex items-center gap-2">
          <span aria-hidden="true" className="text-xl">
            {app.icon}
          </span>
          <span className="min-w-0 flex-1 truncate text-sm font-medium">{app.name}</span>
          <StatusDot
            tone={app.installed ? 'success' : 'neutral'}
            label={app.installed ? 'Connected' : 'Not connected'}
          />
        </div>

        <span className="self-start rounded-sm bg-inset px-1.5 py-0.5 text-2xs text-content-secondary">
          {CATEGORY_LABEL[app.category]}
        </span>

        <p className="flex-1 text-2xs text-content-secondary">{app.description}</p>

        {app.installed ? (
          <div className="flex flex-col gap-1">
            {app.installation && (
              <code className="truncate text-2xs text-content-tertiary" title={app.installation.external_account}>
                {app.installation.external_account}
              </code>
            )}
            <button
              type="button"
              onClick={() => disconnect.mutate()}
              disabled={disconnect.isPending}
              className="self-start rounded-md border border-border px-2.5 py-1 text-2xs text-content-secondary transition-colors hover:bg-surface-2 disabled:opacity-50"
            >
              {disconnect.isPending ? 'Disconnecting…' : 'Disconnect'}
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConsenting(true)}
            className="self-start rounded-md bg-brand-500 px-2.5 py-1 text-2xs font-medium text-white transition-colors hover:bg-brand-600"
          >
            Connect
          </button>
        )}
      </div>

      {consenting && (
        <ConsentDialog
          app={app}
          pending={connect.isPending}
          failed={connect.isError}
          onAuthorize={() => connect.mutate()}
          onCancel={() => setConsenting(false)}
        />
      )}
    </Card>
  );
}

/**
 * The permission step of the OAuth flow: what the app is about to be allowed to
 * do, and an explicit Authorize. Nothing is connected until the user acts here.
 */
function ConsentDialog({
  app,
  pending,
  failed,
  onAuthorize,
  onCancel,
}: {
  app: AppListItem;
  pending: boolean;
  failed: boolean;
  onAuthorize: () => void;
  onCancel: () => void;
}): ReactElement {
  return (
    <Modal
      onClose={onCancel}
      title={`Connect ${app.name}`}
      description="This app is asking for the following permissions:"
      className="w-[26rem]"
    >
      <ul className="mt-1 flex flex-col gap-1.5">
        {app.scopes.map((scope) => (
          <li key={scope} className="flex items-center gap-2 text-xs">
            <span aria-hidden="true" className="text-success">
              ✓
            </span>
            <code className="text-2xs">{scope}</code>
          </li>
        ))}
      </ul>

      {failed && <ErrorNotice message="Could not connect the app. Try again." />}

      <div className="mt-4 flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-surface-2"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onAuthorize}
          disabled={pending}
          className="rounded-md bg-brand-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-600 disabled:opacity-50"
        >
          {pending ? 'Connecting…' : 'Authorize'}
        </button>
      </div>
    </Modal>
  );
}

/** The routed page: the marketplace under the standard module chrome. */
export function AppsMarketplacePage(): ReactElement {
  return (
    <Page title="Apps" description="Third-party integrations for your workspace.">
      <AppsMarketplace />
    </Page>
  );
}
