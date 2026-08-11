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
import { useEffect, useState, type ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { APP_CATEGORIES, type AppCategory, type AppListItem, type AppListResponse, type AppOAuthStart } from '@nexa/types';
import { Card, CardSkeleton, ErrorNotice, Page, Section } from '../../components/Page.js';
import { EmptyState } from '../../components/EmptyState.js';
import { StatusDot } from '../../components/StatusDot.js';
import { Modal } from '../../components/ui/index.js';
import { useApiClient } from '../../lib/auth-store.js';

const APPS_KEY = ['settings', 'apps'] as const;

/** Where a channel-typed card sends you to set the channel up (09.2 cross-link). */
const CHANNELS_HREF = '/app/settings#section-channels';

/** Human labels for the category chip. */
const CATEGORY_LABEL: Record<AppListItem['category'], string> = {
  crm: 'CRM',
  support: 'Support',
  ecommerce: 'E-commerce',
  payments: 'Payments',
  marketing: 'Marketing',
  productivity: 'Productivity',
  analytics: 'Analytics',
  channels: 'Channels',
};

/** "All" plus the catalogue's categories, in the fixed order the chip row shows them. */
type CategoryFilter = 'all' | AppCategory;
const CATEGORY_FILTERS: readonly CategoryFilter[] = ['all', ...APP_CATEGORIES];

const GRID_CLASS = 'grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3';

export function AppsMarketplace(): ReactElement {
  const api = useApiClient();

  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [category, setCategory] = useState<CategoryFilter>('all');

  // Debounced so typing a name does not fire a request per keystroke, each one
  // counting against the caller's rate limit (CustomersPage pattern).
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(search.trim()), 250);
    return () => clearTimeout(timer);
  }, [search]);

  const hasActiveFilter = debounced !== '' || category !== 'all';

  const apps = useQuery({
    // The filter state is part of the cache key — otherwise a category switch
    // or a new search could show a stale, differently-filtered response.
    queryKey: [...APPS_KEY, debounced, category],
    queryFn: () => {
      const params = new URLSearchParams();
      if (debounced) params.set('query', debounced);
      if (category !== 'all') params.set('category', category);
      const qs = params.toString();
      return api.get<AppListResponse>(`/settings/apps${qs ? `?${qs}` : ''}`);
    },
  });

  const items = apps.data?.items ?? [];

  return (
    <Section
      title="Marketplace"
      description="Connect the tools your team already uses. Connected apps show their data right inside a conversation."
    >
      <label className="flex items-center gap-2">
        <span className="sr-only">Search apps</span>
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search apps…"
          className="w-64 rounded-md border border-border bg-inset px-3 py-1.5 text-sm outline-none placeholder:text-content-tertiary"
        />
      </label>

      <div role="group" aria-label="Filter by category" className="flex flex-wrap gap-1">
        {CATEGORY_FILTERS.map((filter) => {
          const active = category === filter;
          return (
            <button
              key={filter}
              type="button"
              aria-pressed={active}
              onClick={() => setCategory(filter)}
              className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
                active
                  ? 'bg-brand-100 font-medium text-brand-700 dark:bg-brand-950 dark:text-content'
                  : 'text-content-secondary hover:bg-surface-2'
              }`}
            >
              {filter === 'all' ? 'All' : CATEGORY_LABEL[filter]}
            </button>
          );
        })}
      </div>

      {apps.error ? (
        <ErrorNotice message="Could not load the apps marketplace." />
      ) : apps.isPending ? (
        <div className={GRID_CLASS}>
          {Array.from({ length: 8 }, (_, i) => (
            <CardSkeleton key={i} />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          title={hasActiveFilter ? 'No apps match' : 'No apps yet'}
          description={
            hasActiveFilter
              ? 'Try a shorter search, or a different category.'
              : 'Connect the tools your team already uses from the marketplace.'
          }
        />
      ) : (
        <div className={GRID_CLASS}>
          {items.map((app) => (
            <AppCard key={app.id} app={app} />
          ))}
        </div>
      )}
    </Section>
  );
}

/**
 * A card either connects here (a data app) or is set up in Channels (a
 * channel-typed app, 09.2). The split keeps the OAuth hooks off the channel
 * path, which has no connection of its own to manage.
 */
function AppCard({ app }: { app: AppListItem }): ReactElement {
  return app.channel ? <ChannelAppCard app={app} /> : <DataAppCard app={app} />;
}

/**
 * A channel-typed integration (WhatsApp, Messenger, …): the marketplace lists it
 * for discovery but it is connected in Settings → Channels, so the card links
 * there instead of offering Connect (KK 09.2 "kanal-tipli olanlar Channels'ta
 * da yönetilir").
 */
function ChannelAppCard({ app }: { app: AppListItem }): ReactElement {
  return (
    <Card>
      <div data-testid={`app-${app.id}`} className="flex h-full flex-col gap-2 p-4">
        <div className="flex items-center gap-2">
          <span aria-hidden="true" className="text-xl">
            {app.icon}
          </span>
          <span className="min-w-0 flex-1 truncate text-sm font-medium">{app.name}</span>
          <StatusDot tone="info" label="In Channels" />
        </div>

        <span className="self-start rounded-sm bg-inset px-1.5 py-0.5 text-2xs text-content-secondary">
          {CATEGORY_LABEL[app.category]}
        </span>

        <p className="flex-1 text-2xs text-content-secondary">{app.description}</p>

        <Link
          to={CHANNELS_HREF}
          className="self-start rounded-md border border-border px-2.5 py-1 text-2xs text-content-secondary transition-colors hover:bg-surface-2"
        >
          Manage in Channels
        </Link>
      </div>
    </Card>
  );
}

function DataAppCard({ app }: { app: AppListItem }): ReactElement {
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
