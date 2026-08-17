/**
 * The Customers list — the CRM directory, mobile's read-only slice of it
 * (13.7-g KAPSAM: contacts only; the live-visitor board, campaigns and goals
 * the web app also shows under "Customers" are out of mobile's scope, §C-A28).
 *
 * Search and segment both restart the list at page one — the same request the
 * web `CustomersPage` makes, just without a `useSearchParams` deep link, which
 * has no mobile analogue yet. "Load more" appends with the API's keyset
 * cursor rather than an offset, so a page already on screen never shifts
 * under a reader while new conversations keep arriving.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { useCustomersApi } from './context';
import type { CustomersPage } from './api';
import type { CustomerSegment, CustomerSummary } from './types';
import { formatDate } from './format';
import { FONT_SIZE, RADIUS, SPACING } from '../../theme/tokens';
import { useTheme } from '../../theme/theme';

const SEGMENTS: Array<{ id: CustomerSegment; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'leads', label: 'Leads' },
  { id: 'recent', label: 'Last 30 days' },
  { id: 'banned', label: 'Banned' },
];

/** Typing a name should not fire a request per keystroke, each one counting
 * against the caller's rate limit — the same 250ms the web list debounces by. */
const SEARCH_DEBOUNCE_MS = 250;

export interface CustomerListScreenProps {
  onOpenCustomer: (customer: { customerId: string; title: string }) => void;
}

type ListStatus = 'loading' | 'ready' | 'error';

interface ListState {
  status: ListStatus;
  items: CustomerSummary[];
  total: number;
  nextPageId?: string;
  error: string | null;
}

const INITIAL_STATE: ListState = { status: 'loading', items: [], total: 0, error: null };

export function CustomerListScreen({ onOpenCustomer }: CustomerListScreenProps) {
  const { colors } = useTheme();
  const api = useCustomersApi();

  const [segment, setSegment] = useState<CustomerSegment>('all');
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [state, setState] = useState<ListState>(INITIAL_STATE);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  // The generation guard matters here specifically because two requests can be
  // in flight at once (segment tapped while a search is still debouncing); an
  // `AbortController` on unmount alone would let the stale one still win.
  const generation = useRef(0);

  useEffect(() => {
    const mine = ++generation.current;
    const controller = new AbortController();
    setState((prev) => ({ ...prev, status: 'loading', error: null }));

    api
      .listCustomers({ segment, query: debouncedQuery || undefined, signal: controller.signal })
      .then((page: CustomersPage) => {
        if (mine !== generation.current) return;
        setState({
          status: 'ready',
          items: page.items,
          total: page.total,
          nextPageId: page.next_page_id,
          error: null,
        });
      })
      .catch((error: unknown) => {
        if (mine !== generation.current || controller.signal.aborted) return;
        setState({
          status: 'error',
          items: [],
          total: 0,
          error: error instanceof Error ? error.message : 'Could not load customers.',
        });
      });

    return () => controller.abort();
  }, [api, segment, debouncedQuery]);

  const refresh = useCallback(() => {
    const mine = ++generation.current;
    setRefreshing(true);
    api
      .listCustomers({ segment, query: debouncedQuery || undefined })
      .then((page: CustomersPage) => {
        if (mine !== generation.current) return;
        setState({
          status: 'ready',
          items: page.items,
          total: page.total,
          nextPageId: page.next_page_id,
          error: null,
        });
      })
      .catch(() => {
        // A failed pull-to-refresh leaves the list as it was rather than
        // replacing something the reader can already see with an error screen.
      })
      .finally(() => {
        if (mine === generation.current) setRefreshing(false);
      });
  }, [api, segment, debouncedQuery]);

  const loadMore = useCallback(() => {
    if (state.status !== 'ready' || state.nextPageId === undefined || loadingMore) return;
    const mine = generation.current;
    setLoadingMore(true);
    api
      .listCustomers({ segment, query: debouncedQuery || undefined, pageId: state.nextPageId })
      .then((page: CustomersPage) => {
        if (mine !== generation.current) return;
        setState((prev) => ({
          ...prev,
          items: [...prev.items, ...page.items],
          total: page.total,
          nextPageId: page.next_page_id,
        }));
      })
      .catch(() => {
        // Leave the loaded page intact; the reader can scroll and try again.
      })
      .finally(() => setLoadingMore(false));
  }, [api, segment, debouncedQuery, state.status, state.nextPageId, loadingMore]);

  // While a new page-one request is in flight the previous list is still in
  // `state.items` (only cleared once the response lands) — shown here as `[]`
  // so a segment/search change swaps straight to the skeleton rather than
  // flashing the old segment's rows first.
  const displayItems = state.status === 'loading' ? [] : state.items;

  return (
    <View style={[styles.screen, { backgroundColor: colors.bgCanvas }]}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TextInput
          testID="customer-search"
          accessibilityLabel="Search customers"
          placeholder="Name, email or phone…"
          placeholderTextColor={colors.textTertiary}
          value={query}
          onChangeText={setQuery}
          autoCapitalize="none"
          autoCorrect={false}
          style={[
            styles.search,
            {
              color: colors.textPrimary,
              backgroundColor: colors.bgInset,
              borderColor: colors.border,
            },
          ]}
        />

        <FlatList
          horizontal
          showsHorizontalScrollIndicator={false}
          data={SEGMENTS}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.segments}
          renderItem={({ item }) => (
            <SegmentButton
              label={item.label}
              selected={segment === item.id}
              onPress={() => setSegment(item.id)}
              testID={`customer-segment-${item.id}`}
            />
          )}
        />
      </View>

      <FlatList
        testID="customer-list"
        data={displayItems}
        keyExtractor={(customer) => customer.id}
        contentContainerStyle={displayItems.length === 0 ? styles.emptyContainer : undefined}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={refresh}
            tintColor={colors.textTertiary}
          />
        }
        onEndReachedThreshold={0.5}
        onEndReached={loadMore}
        renderItem={({ item }) => (
          <CustomerRow
            customer={item}
            onPress={() => onOpenCustomer({ customerId: item.id, title: titleOf(item) })}
          />
        )}
        ListEmptyComponent={
          state.status === 'loading' ? (
            <ListSkeleton />
          ) : (
            <ListPlaceholder
              status={state.status}
              error={state.error}
              searched={debouncedQuery !== ''}
            />
          )
        }
        ListFooterComponent={
          loadingMore ? (
            <Text style={[styles.footer, { color: colors.textTertiary }]}>Loading more…</Text>
          ) : null
        }
      />
    </View>
  );
}

function SegmentButton({
  label,
  selected,
  onPress,
  testID,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  testID: string;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected }}
      testID={testID}
      onPress={onPress}
      style={[
        styles.segment,
        { backgroundColor: selected ? colors.brand100 : 'transparent', borderColor: colors.border },
      ]}
    >
      <Text
        style={[styles.segmentLabel, { color: selected ? colors.brandText : colors.textSecondary }]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function CustomerRow({ customer, onPress }: { customer: CustomerSummary; onPress: () => void }) {
  const { colors } = useTheme();
  const title = titleOf(customer);
  const contact = customer.email ?? customer.phone ?? 'No contact details';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${contact}`}
      testID={`customer-row-${customer.id}`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        {
          backgroundColor: pressed ? colors.bgSurface2 : colors.bgSurface,
          borderBottomColor: colors.border,
        },
      ]}
    >
      <View style={styles.rowHeader}>
        <Text numberOfLines={1} style={[styles.name, { color: colors.textPrimary }]}>
          {title}
        </Text>
        {customer.is_lead && <Badge label="Lead" tone={colors.info} />}
        {customer.banned && <Badge label="Banned" tone={colors.danger} />}
      </View>
      <Text numberOfLines={1} style={[styles.contact, { color: colors.textTertiary }]}>
        {contact}
      </Text>
      <View style={styles.rowFooter}>
        <Text style={[styles.meta, { color: colors.textSecondary }]}>
          {formatCount(customer.chats_count)} {customer.chats_count === 1 ? 'chat' : 'chats'}
        </Text>
        <Text style={[styles.meta, { color: colors.textTertiary }]}>
          {formatDate(customer.last_activity_at) ?? 'Never active'}
        </Text>
      </View>
    </Pressable>
  );
}

function Badge({ label, tone }: { label: string; tone: string }) {
  return (
    <View style={[styles.badge, { backgroundColor: `${tone}1a` }]}>
      <Text style={[styles.badgeText, { color: tone }]}>{label}</Text>
    </View>
  );
}

/**
 * The empty list is three different situations wearing one shape: still
 * loading, nothing to show, or a request that failed — same reasoning as the
 * inbox's `ListPlaceholder`, spelled out separately because "no customers" and
 * "nobody matches that search" are different facts an agent needs told apart.
 */
function ListPlaceholder({
  status,
  error,
  searched,
}: {
  status: ListStatus;
  error: string | null;
  searched: boolean;
}) {
  const { colors } = useTheme();

  const message =
    status === 'error'
      ? (error ?? 'Could not load customers.')
      : searched
        ? 'Nobody matches that search.'
        : 'No customers yet.';

  return (
    <View style={styles.placeholder} testID="customer-list-placeholder">
      <Text
        style={[
          styles.placeholderText,
          { color: status === 'error' ? colors.danger : colors.textSecondary },
        ]}
      >
        {message}
      </Text>
    </View>
  );
}

/** Row-shaped placeholder while the first page loads, so the screen does not
 * flash a blank rectangle in the moment before data arrives. */
function ListSkeleton() {
  const { colors } = useTheme();
  return (
    <View
      testID="customer-list-skeleton"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {Array.from({ length: 6 }, (_, index) => (
        <View key={index} style={[styles.skeletonRow, { borderBottomColor: colors.border }]}>
          <View style={[styles.skeletonBar, { width: '45%', backgroundColor: colors.bgInset }]} />
          <View style={[styles.skeletonBar, { width: '70%', backgroundColor: colors.bgInset }]} />
        </View>
      ))}
    </View>
  );
}

function titleOf(customer: CustomerSummary): string {
  return customer.name ?? 'Unnamed visitor';
}

function formatCount(value: number): string {
  return new Intl.NumberFormat().format(value);
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: SPACING[4],
    paddingTop: SPACING[3],
    paddingBottom: SPACING[2],
    gap: SPACING[2],
  },
  search: {
    height: SPACING[10],
    borderWidth: 1,
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACING[3],
    fontSize: FONT_SIZE.sm.size,
  },
  segments: { gap: SPACING[2] },
  segment: {
    paddingHorizontal: SPACING[3],
    paddingVertical: SPACING[1],
    borderRadius: RADIUS.lg,
    borderWidth: 1,
  },
  segmentLabel: {
    fontSize: FONT_SIZE.xs.size,
    lineHeight: FONT_SIZE.xs.lineHeight,
    fontWeight: '600',
  },
  emptyContainer: { flexGrow: 1 },
  row: {
    paddingVertical: SPACING[3],
    paddingHorizontal: SPACING[4],
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: SPACING[1],
  },
  rowHeader: { flexDirection: 'row', alignItems: 'center', gap: SPACING[2] },
  name: {
    flex: 1,
    fontSize: FONT_SIZE.base.size,
    lineHeight: FONT_SIZE.base.lineHeight,
    fontWeight: '600',
  },
  contact: { fontSize: FONT_SIZE['2xs'].size, lineHeight: FONT_SIZE['2xs'].lineHeight },
  rowFooter: { flexDirection: 'row', gap: SPACING[3] },
  meta: {
    fontSize: FONT_SIZE.xs.size,
    lineHeight: FONT_SIZE.xs.lineHeight,
    fontWeight: FONT_SIZE.xs.weight,
  },
  badge: {
    paddingHorizontal: SPACING[2],
    paddingVertical: 2,
    borderRadius: RADIUS.sm,
  },
  badgeText: {
    fontSize: FONT_SIZE['2xs'].size,
    lineHeight: FONT_SIZE['2xs'].lineHeight,
    fontWeight: '600',
  },
  placeholder: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: SPACING[6] },
  placeholderText: {
    fontSize: FONT_SIZE.sm.size,
    lineHeight: FONT_SIZE.sm.lineHeight,
    fontWeight: FONT_SIZE.sm.weight,
    textAlign: 'center',
  },
  footer: {
    textAlign: 'center',
    paddingVertical: SPACING[3],
    fontSize: FONT_SIZE.xs.size,
    lineHeight: FONT_SIZE.xs.lineHeight,
  },
  skeletonRow: {
    paddingVertical: SPACING[3],
    paddingHorizontal: SPACING[4],
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: SPACING[2],
  },
  skeletonBar: { height: 10, borderRadius: RADIUS.sm },
});
