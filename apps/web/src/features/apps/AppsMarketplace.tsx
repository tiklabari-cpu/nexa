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
 *
 * The catalogue is 100+ cards (09.2 v2), so neither the grid nor the request may
 * be unbounded any more:
 *   - The cards are cut into fixed-height rows (`app-grid.ts`) and scrolled
 *     through the shared `VirtualList`, so only the rows inside the viewport plus
 *     an overscan are ever in the DOM (NFR-P4). The cards inside a row carry
 *     `role="listitem"`, one per app, and the row itself is presentational.
 *   - Pages are chained on `next_page_id`, accumulated into one list: reaching
 *     the last rendered row pulls the next page (the windowing already tells us
 *     the user scrolled that far), and a plain "Load more" button does the same
 *     thing for anyone not scrolling with a mouse (NFR-A11Y6).
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
  type RefObject,
} from 'react';
import { Link } from 'react-router-dom';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  APP_CATEGORIES,
  type AppCategory,
  type AppListItem,
  type AppListResponse,
  type AppOAuthStart,
} from '@nexa/types';
import { Card, CardSkeleton, ErrorNotice, Page, Section } from '../../components/Page.js';
import { EmptyState } from '../../components/EmptyState.js';
import { StatusDot } from '../../components/StatusDot.js';
import { VirtualList } from '../../components/VirtualList.js';
import { Modal } from '../../components/ui/index.js';
import { useApiClient } from '../../lib/auth-store.js';
import { useTranslate, type TFunction } from '../../lib/i18n.js';
import { chunkIntoRows, columnsForWidth } from './app-grid.js';

const APPS_KEY = ['settings', 'apps'] as const;

/** Where a channel-typed card sends you to set the channel up (09.2 cross-link). */
const CHANNELS_HREF = '/app/settings#section-channels';

/** The category chip's translation key, keyed by the catalogue's own category id. */
const CATEGORY_KEY: Record<AppListItem['category'], string> = {
  crm: 'apps.marketplace.category.crm',
  support: 'apps.marketplace.category.support',
  ecommerce: 'apps.marketplace.category.ecommerce',
  payments: 'apps.marketplace.category.payments',
  marketing: 'apps.marketplace.category.marketing',
  productivity: 'apps.marketplace.category.productivity',
  analytics: 'apps.marketplace.category.analytics',
  channels: 'apps.marketplace.category.channels',
};

/** "All" plus the catalogue's categories, in the fixed order the chip row shows them. */
type CategoryFilter = 'all' | AppCategory;
const CATEGORY_FILTERS: readonly CategoryFilter[] = ['all', ...APP_CATEGORIES];

/** The skeleton grid, and the shape a row of real cards keeps. */
const GRID_CLASS = 'grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3';

/**
 * Cards per request. The contract caps `limit` at 100; 50 keeps the first paint
 * off the whole catalogue while making the chain short (102 cards → 3 pages).
 */
const PAGE_SIZE = 50;

/**
 * Fixed row height (px) — the virtualizer's one hard requirement, since the
 * spacers above and below the window are `rowHeight × rows`. It covers the card
 * (icon + name + status, category chip, clamped description, action) plus the
 * `gap-3` gutter the row reserves below itself.
 */
const ROW_HEIGHT = 188;

/** The list request for one page of the current filters. */
function buildListUrl(query: string, category: CategoryFilter, pageId?: string): string {
  const params = new URLSearchParams();
  if (query) params.set('query', query);
  if (category !== 'all') params.set('category', category);
  params.set('limit', String(PAGE_SIZE));
  if (pageId) params.set('page_id', pageId);
  return `/settings/apps?${params.toString()}`;
}

/**
 * Measures the grid container and derives the column count from it — the same
 * `ResizeObserver`-or-nothing shape `VirtualList` uses to measure its viewport.
 * Before the first measurement (and where there is no layout engine at all) the
 * width reads 0 and `columnsForWidth` falls back to a single column.
 *
 * The measured box is the scroller's *outer* width, so a container sitting within
 * a scrollbar's width of a column boundary can fit one more column than
 * `auto-fill` would have: the cards then render a few px under their 260px
 * minimum, which `minmax(0, 1fr)` absorbs.
 */
function useGridColumns(): { containerRef: RefObject<HTMLDivElement>; columns: number } {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const measure = (): void => setWidth(el.clientWidth);
    measure();

    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return { containerRef, columns: columnsForWidth(width) };
}

export function AppsMarketplace(): ReactElement {
  const api = useApiClient();
  const t = useTranslate();

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

  const apps = useInfiniteQuery({
    // The filter state is part of the cache key — otherwise a category switch
    // or a new search could show a stale, differently-filtered response. It also
    // resets the page chain: pages from one filter never accumulate onto another.
    queryKey: [...APPS_KEY, debounced, category],
    queryFn: ({ pageParam }: { pageParam: string | undefined }) =>
      api.get<AppListResponse>(buildListUrl(debounced, category, pageParam)),
    initialPageParam: undefined as string | undefined,
    // Absent on the last page, which is what ends the chain.
    getNextPageParam: (lastPage) => lastPage.next_page_id,
  });

  const items = apps.data?.pages.flatMap((page) => page.items) ?? [];
  const { containerRef, columns } = useGridColumns();
  const rows = chunkIntoRows(items, columns);

  const loadMore = useCallback((): void => {
    if (!apps.hasNextPage || apps.isFetchingNextPage) return;
    void apps.fetchNextPage();
  }, [apps.hasNextPage, apps.isFetchingNextPage, apps.fetchNextPage]);

  return (
    <Section title={t('apps.marketplace.title')} description={t('apps.marketplace.description')}>
      <label className="flex items-center gap-2">
        <span className="sr-only">{t('apps.marketplace.searchLabel')}</span>
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t('apps.marketplace.searchPlaceholder')}
          className="w-64 rounded-md border border-border bg-inset px-3 py-1.5 text-sm outline-none placeholder:text-content-tertiary"
        />
      </label>

      <div
        role="group"
        aria-label={t('apps.marketplace.filterByCategory')}
        className="flex flex-wrap gap-1"
      >
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
              {filter === 'all' ? t('apps.marketplace.category.all') : t(CATEGORY_KEY[filter])}
            </button>
          );
        })}
      </div>

      {/* The measured element is mounted for every state, not just the loaded
          list: the measurement runs once on mount, so a ref that only appears
          after the skeleton would never be measured and the grid would be stuck
          at one column. */}
      <div ref={containerRef} className="flex flex-col gap-3">
        {apps.error ? (
          <ErrorNotice message={t('apps.marketplace.loadError')} />
        ) : apps.isPending ? (
          <div className={GRID_CLASS}>
            {Array.from({ length: 8 }, (_, i) => (
              <CardSkeleton key={i} />
            ))}
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            title={
              hasActiveFilter
                ? t('apps.marketplace.empty.noMatchTitle')
                : t('apps.marketplace.empty.noneTitle')
            }
            description={
              hasActiveFilter
                ? t('apps.marketplace.empty.noMatchDescription')
                : t('apps.marketplace.empty.noneDescription')
            }
          />
        ) : (
          <VirtualList
            items={rows}
            rowHeight={ROW_HEIGHT}
            label={t('apps.marketplace.listLabel')}
            renderRow={(row, index) => (
              <AppCardRow
                key={row[0]?.id ?? index}
                row={row}
                columns={columns}
                t={t}
                // Infinite scroll: only the last row asks for more, and it only
                // mounts once the window reaches it.
                onReachEnd={index === rows.length - 1 ? loadMore : undefined}
              />
            )}
          />
        )}

        {apps.hasNextPage && (
          <div className="flex justify-center">
            <button
              type="button"
              onClick={loadMore}
              disabled={apps.isFetchingNextPage}
              className="rounded-md border border-border bg-inset px-3 py-1.5 text-sm font-medium text-content-secondary transition-colors hover:text-content disabled:opacity-60"
            >
              {apps.isFetchingNextPage
                ? t('apps.marketplace.loadingMore')
                : t('apps.marketplace.loadMore')}
            </button>
          </div>
        )}
      </div>
    </Section>
  );
}

/**
 * One virtualized row of cards.
 *
 * The row is `role="none"`: it exists to lay the cards out, so the cards inside
 * stay the scroller's own `listitem`s (one per app, not one per row of four).
 * Its height is pinned to `ROW_HEIGHT` — the grid stretches every card in the row
 * to fill it, which is also what keeps the virtualizer's spacer maths honest.
 *
 * `onReachEnd` fires on mount, which for the last row means the window has
 * scrolled to the bottom of the list: the virtualizer already did the work an
 * `IntersectionObserver` sentinel would have repeated.
 */
function AppCardRow({
  row,
  columns,
  t,
  onReachEnd,
}: {
  row: AppListItem[];
  columns: number;
  t: TFunction;
  onReachEnd?: (() => void) | undefined;
}): ReactElement {
  useEffect(() => {
    onReachEnd?.();
  }, [onReachEnd]);

  return (
    <div
      role="none"
      className="grid gap-3 pb-3"
      style={{ height: ROW_HEIGHT, gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
    >
      {row.map((app) => (
        <div key={app.id} role="listitem" className="min-w-0">
          <AppCard app={app} t={t} />
        </div>
      ))}
    </div>
  );
}

/**
 * A card either connects here (a data app) or is set up in Channels (a
 * channel-typed app, 09.2). The split keeps the OAuth hooks off the channel
 * path, which has no connection of its own to manage.
 */
function AppCard({ app, t }: { app: AppListItem; t: TFunction }): ReactElement {
  return app.channel ? <ChannelAppCard app={app} t={t} /> : <DataAppCard app={app} t={t} />;
}

/**
 * A channel-typed integration (WhatsApp, Messenger, …): the marketplace lists it
 * for discovery but it is connected in Settings → Channels, so the card links
 * there instead of offering Connect (KK 09.2 "kanal-tipli olanlar Channels'ta
 * da yönetilir").
 */
function ChannelAppCard({ app, t }: { app: AppListItem; t: TFunction }): ReactElement {
  return (
    <Card className="h-full">
      <div data-testid={`app-${app.id}`} className="flex h-full flex-col gap-2 p-4">
        <div className="flex items-center gap-2">
          <span aria-hidden="true" className="text-xl">
            {app.icon}
          </span>
          <span className="min-w-0 flex-1 truncate text-sm font-medium">{app.name}</span>
          <StatusDot tone="info" label={t('apps.marketplace.card.inChannels')} />
        </div>

        <span className="self-start rounded-sm bg-inset px-1.5 py-0.5 text-2xs text-content-secondary">
          {t(CATEGORY_KEY[app.category])}
        </span>

        {/* Clamped: the row height is fixed, so a long description shortens
            rather than pushing the action out of its card. */}
        <p className="line-clamp-3 flex-1 text-2xs text-content-secondary">{app.description}</p>

        <Link
          to={CHANNELS_HREF}
          className="self-start rounded-md border border-border px-2.5 py-1 text-2xs text-content-secondary transition-colors hover:bg-surface-2"
        >
          {t('apps.marketplace.card.manageInChannels')}
        </Link>
      </div>
    </Card>
  );
}

function DataAppCard({ app, t }: { app: AppListItem; t: TFunction }): ReactElement {
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
    <Card className="h-full">
      <div data-testid={`app-${app.id}`} className="flex h-full flex-col gap-2 p-4">
        <div className="flex items-center gap-2">
          <span aria-hidden="true" className="text-xl">
            {app.icon}
          </span>
          <span className="min-w-0 flex-1 truncate text-sm font-medium">{app.name}</span>
          <StatusDot
            tone={app.installed ? 'success' : 'neutral'}
            label={
              app.installed
                ? t('apps.marketplace.card.connected')
                : t('apps.marketplace.card.notConnected')
            }
          />
        </div>

        <span className="self-start rounded-sm bg-inset px-1.5 py-0.5 text-2xs text-content-secondary">
          {t(CATEGORY_KEY[app.category])}
        </span>

        {/* Clamped: the row height is fixed, so a long description shortens
            rather than pushing the action out of its card. */}
        <p className="line-clamp-3 flex-1 text-2xs text-content-secondary">{app.description}</p>

        {app.installed ? (
          <div className="flex flex-col gap-1">
            {app.installation && (
              <code
                className="truncate text-2xs text-content-tertiary"
                title={app.installation.external_account}
              >
                {app.installation.external_account}
              </code>
            )}
            <button
              type="button"
              onClick={() => disconnect.mutate()}
              disabled={disconnect.isPending}
              className="self-start rounded-md border border-border px-2.5 py-1 text-2xs text-content-secondary transition-colors hover:bg-surface-2 disabled:opacity-50"
            >
              {disconnect.isPending
                ? t('apps.marketplace.card.disconnecting')
                : t('apps.marketplace.card.disconnect')}
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConsenting(true)}
            className="self-start rounded-md bg-brand-500 px-2.5 py-1 text-2xs font-medium text-white transition-colors hover:bg-brand-600"
          >
            {t('apps.marketplace.card.connect')}
          </button>
        )}
      </div>

      {consenting && (
        <ConsentDialog
          app={app}
          t={t}
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
  t,
  pending,
  failed,
  onAuthorize,
  onCancel,
}: {
  app: AppListItem;
  t: TFunction;
  pending: boolean;
  failed: boolean;
  onAuthorize: () => void;
  onCancel: () => void;
}): ReactElement {
  return (
    <Modal
      onClose={onCancel}
      title={t('apps.marketplace.consent.title', { name: app.name })}
      description={t('apps.marketplace.consent.description')}
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

      {failed && <ErrorNotice message={t('apps.marketplace.consent.error')} />}

      <div className="mt-4 flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-surface-2"
        >
          {t('apps.common.cancel')}
        </button>
        <button
          type="button"
          onClick={onAuthorize}
          disabled={pending}
          className="rounded-md bg-brand-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-600 disabled:opacity-50"
        >
          {pending
            ? t('apps.marketplace.consent.connecting')
            : t('apps.marketplace.consent.authorize')}
        </button>
      </div>
    </Modal>
  );
}

/** The routed page: the marketplace under the standard module chrome. */
export function AppsMarketplacePage(): ReactElement {
  const t = useTranslate();
  return (
    <Page
      title={t('apps.marketplace.page.title')}
      description={t('apps.marketplace.page.description')}
    >
      <AppsMarketplace />
    </Page>
  );
}
