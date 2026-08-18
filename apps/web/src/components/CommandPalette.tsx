/**
 * Command palette (⌘K) — FR-MOD-01.1.3, NFR-A11Y6.
 *
 * One keystroke reaches everything: type to search customers, conversations and
 * tickets, or jump straight to a module. It is the keyboard user's answer to a
 * mouse user's rail — and the fast path for everyone once the product has more
 * screens than a rail can hold.
 *
 * Two things keep it honest. Searches are gated on the caller's scopes, so a
 * token that cannot read customers never fires a request that would 403 — the
 * palette shows only what its holder is allowed to find. And a record it points
 * at is opened by the target screen through a URL parameter, so the same deep
 * link works whether it comes from here, a bookmark, or a colleague's message.
 *
 * Actions (`actions.ts`) are held to that same rule: an entry is offered only to
 * a caller holding a scope its target endpoint accepts, and if none survive the
 * filter the heading goes with them, so nobody is shown a section naming powers
 * they do not have (NFR-S3, NFR-S5). That is a courtesy, not a boundary — the
 * endpoint refuses the request on its own either way, and it is the refusal that
 * protects anything.
 *
 * Choosing an action closes the palette immediately and lets the request finish
 * behind it (FR-EK-A.2): the palette is a launcher, and holding it open over a
 * spinner would trap the keyboard for the one interaction that exists to free
 * it. The catalogue entry shows its own optimistic result and rolls it back if
 * the server refuses; what the palette owes in that case is the part rollback
 * alone does not cover — saying so. A failed action therefore leaves an alert
 * behind, outliving the palette that launched it, because a change that silently
 * un-happened is worse than one that never appeared to happen at all.
 *
 * The fourth result — `ai` — is the opposite of a launcher: a query that does
 * not match an action, a destination or a record is not a dead end, it is a
 * question `POST /palette/ai-query` can answer (FR-MOD-01.1.3). Picking it
 * keeps the palette open and swaps the result list for the answer, because
 * closing over a pending request here would throw away the very thing the
 * agent asked for.
 */
import { useMutation, useQuery, type UseMutationResult } from '@tanstack/react-query';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
} from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiClientError, errorMessageKey } from '../lib/api-client.js';
import { useApiClient, useAuth, type CurrentAgent } from '../lib/auth-store.js';
import { useTranslate, type TFunction } from '../lib/i18n.js';
import { Banner } from './ui/index.js';
import { EmptyState } from './EmptyState.js';
import { Skeleton } from './Skeleton.js';
import type { CustomerSummary } from '../features/customers/types.js';
import type { ChatSummary, Ticket } from '../features/inbox/types.js';
import { NAV_DESTINATIONS, isNavVisible } from './navigation.js';
import { ACTIONS, type ActionDeps, type PaletteResult } from './actions.js';

const CUSTOMER_READ = ['customers:ro', 'customers:rw'];
const TICKET_READ = ['tickets--all:ro', 'tickets--access:ro', 'tickets--all:rw'];
const CHAT_READ = ['chats--all:ro', 'chats--access:ro'];
// Same scope the endpoint itself requires (`routes/command-palette.ts`) — the
// same courtesy the other groups get: an entry whose request would 403 is not
// offered at all.
const AI_QUERY_SCOPE = ['reports_read'];
/** One glyph for the whole group — an action is a switch, not a place. */
const ACTION_ICON = '⏻';
/** Echoes Copilot's own glyph — both surfaces are "ask the assistant". */
const AI_ICON = '✧';

interface PaletteAiAnswer {
  answer: string;
  kind: 'summary' | 'no_data' | 'not_understood';
  metric_source?: string;
}

export function CommandPalette(): ReactElement | null {
  const [open, setOpen] = useState(false);
  const [rawQuery, setRawQuery] = useState('');
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  // Survives the close, because the failure it reports usually arrives after it.
  // Holds the catalogue *key* rather than a finished sentence: the notice can
  // outlive a language switch, and a string frozen at throw time would sit there
  // in the language the agent has just left. `null` means the failure carried no
  // ADR-06 type to speak of, so only the generic line is shown.
  const [actionError, setActionError] = useState<{ messageKey: string | null } | null>(null);
  // The debounced query text once "Ask AI" is chosen — its presence is what
  // switches the list to the answer card. Cleared the moment the agent types
  // again, so editing the query always returns to search rather than leaving
  // a stale answer sitting over a new one it no longer belongs to.
  const [aiAsked, setAiAsked] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  const navigate = useNavigate();
  const api = useApiClient();
  const t = useTranslate();
  const aiAnswer = useMutation({
    mutationFn: (askedQuery: string) =>
      api.post<PaletteAiAnswer>('/palette/ai-query', { query: askedQuery }),
  });
  const scopes = useAuth((s) => s.agent?.scopes ?? []);
  const has = useCallback(
    (allowed: string[]) => allowed.some((scope) => scopes.includes(scope)),
    [scopes],
  );

  // Actions read live state to label themselves ("Stop" vs "Start Accepting
  // Chats"), so the store is subscribed to field by field: the whole `agent`
  // object changes identity on every unrelated write, and this list rebuilds on
  // every one of them if it depends on the object.
  const routingStatus = useAuth((s) => s.agent?.routing_status ?? null);
  const setRoutingStatus = useAuth((s) => s.setRoutingStatus);

  // The optimistic half: a local write with no request behind it, which is what
  // makes it usable as its own undo. Reading the store imperatively keeps this
  // callback stable — it must not change identity every time the very field it
  // writes changes, or the result list rebuilds mid-run.
  const applyRoutingStatus = useCallback((status: CurrentAgent['routing_status']): void => {
    const { agent } = useAuth.getState();
    if (!agent) return;
    useAuth.setState({ agent: { ...agent, routing_status: status } });
  }, []);

  const actionDeps = useMemo<ActionDeps>(
    () => ({
      agent: routingStatus ? { routing_status: routingStatus } : null,
      applyRoutingStatus,
      setRoutingStatus,
    }),
    [routingStatus, applyRoutingStatus, setRoutingStatus],
  );

  const close = useCallback(() => {
    setOpen(false);
    setRawQuery('');
    setQuery('');
    setActiveIndex(0);
    setAiAsked(null);
    aiAnswer.reset();
  }, [aiAnswer.reset]);

  // ⌘K / Ctrl-K opens it from anywhere. Remembering what had focus lets us hand
  // it back on close, so the keyboard user is returned to where they were.
  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && (event.key === 'k' || event.key === 'K')) {
        event.preventDefault();
        returnFocusRef.current = (document.activeElement as HTMLElement | null) ?? null;
        setOpen(true);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    if (open) {
      inputRef.current?.focus();
    } else if (returnFocusRef.current) {
      returnFocusRef.current.focus?.();
      returnFocusRef.current = null;
    }
  }, [open]);

  // Debounced so a query fires per pause, not per keystroke — each request
  // counts against the caller's rate limit, as the customer search learned.
  useEffect(() => {
    const timer = setTimeout(() => setQuery(rawQuery.trim()), 180);
    return () => clearTimeout(timer);
  }, [rawQuery]);

  const searching = open && query.length > 0;

  const customers = useQuery({
    queryKey: ['palette', 'customers', query],
    queryFn: () =>
      api.get<{ items: CustomerSummary[] }>(
        `/customers?query=${encodeURIComponent(query)}&limit=6`,
      ),
    enabled: searching && has(CUSTOMER_READ),
    retry: false,
    staleTime: 10_000,
  });

  const tickets = useQuery({
    queryKey: ['palette', 'tickets', query],
    queryFn: () =>
      api.get<{ items: Ticket[] }>(`/tickets?query=${encodeURIComponent(query)}&limit=6`),
    enabled: searching && has(TICKET_READ),
    retry: false,
    staleTime: 10_000,
  });

  // Chats have no free-text endpoint — the list is small and already loaded for
  // the inbox, so it is filtered here rather than adding a search path the
  // product does not otherwise need.
  const chats = useQuery({
    queryKey: ['palette', 'chats'],
    queryFn: () => api.get<{ items: ChatSummary[] }>('/chats?view=all&limit=50'),
    enabled: searching && has(CHAT_READ),
    retry: false,
    staleTime: 10_000,
  });

  const chatMatches = useMemo(() => {
    if (!searching) return [];
    const needle = query.toLowerCase();
    return (chats.data?.items ?? [])
      .filter(
        (chat) =>
          (chat.customer_name ?? '').toLowerCase().includes(needle) ||
          (chat.last_event?.text ?? '').toLowerCase().includes(needle) ||
          chat.id.toLowerCase().includes(needle),
      )
      .slice(0, 6);
  }, [chats.data, query, searching]);

  const commands = useMemo<PaletteResult[]>(() => {
    // Route filtering needs no network, so it tracks the raw input for an
    // instant response; only the record searches wait for the debounce.
    const routeNeedle = rawQuery.trim().toLowerCase();
    const list: PaletteResult[] = [];

    // Actions lead: "do it from here" is the reason to reach for the palette
    // over the rail, and the rail cannot offer it at all. Group members must
    // stay contiguous — the heading is drawn wherever the group changes.
    for (const action of ACTIONS) {
      // The gate. An action whose endpoint would answer 403 is not a result the
      // caller can use, so it is not a result — and since nothing is pushed, no
      // heading is drawn over the gap either. The scope set comes from the auth
      // store the searches above already gate on; no request asks what the
      // caller may do, because the token already says so.
      if (!has(action.requiredScope)) continue;

      const label = action.label(actionDeps);
      const matches =
        !routeNeedle ||
        label.toLowerCase().includes(routeNeedle) ||
        action.keywords.some((keyword) => keyword.includes(routeNeedle));
      if (!matches) continue;

      list.push({
        kind: 'action',
        id: `action:${action.id}`,
        group: t('palette.group.actions'),
        label,
        icon: ACTION_ICON,
        run: () => {
          // Close before the await, not after it: the request outlives this
          // overlay, and the entry has already painted its optimistic result,
          // so there is nothing left here worth looking at.
          close();
          setActionError(null);
          void action.run(actionDeps).catch((error: unknown) => {
            // The entry has undone its own guess by now. The screen is honest
            // again but silent about why it moved back, so say it out loud.
            setActionError({
              messageKey: error instanceof ApiClientError ? errorMessageKey(error) : null,
            });
          });
        },
      });
    }

    for (const dest of NAV_DESTINATIONS) {
      // Same courtesy as the actions loop above: a destination that only 403s
      // for this caller is not offered as a result.
      if (!isNavVisible(dest, scopes)) continue;
      const label = t(dest.labelKey);
      const matches =
        !routeNeedle ||
        label.toLowerCase().includes(routeNeedle) ||
        (dest.keywords ?? []).some((keyword) => keyword.includes(routeNeedle));
      if (!matches) continue;
      list.push({
        kind: 'nav',
        id: `route:${dest.to}`,
        group: t('palette.group.goTo'),
        label,
        icon: dest.icon,
        run: () => {
          navigate(dest.to);
          close();
        },
      });
    }

    if (searching) {
      for (const customer of customers.data?.items ?? []) {
        list.push({
          kind: 'content',
          id: `customer:${customer.id}`,
          group: t('palette.group.customers'),
          label: customer.name ?? customer.email ?? customer.phone ?? t('palette.unnamedVisitor'),
          sub: customer.email ?? customer.phone ?? undefined,
          icon: '◫',
          run: () => {
            navigate(`/app/customers?customer=${customer.id}`);
            close();
          },
        });
      }

      for (const chat of chatMatches) {
        list.push({
          kind: 'content',
          id: `chat:${chat.id}`,
          group: t('palette.group.conversations'),
          label: chat.customer_name ?? t('palette.visitor'),
          sub: chat.last_event?.text ?? chat.id,
          icon: '▤',
          run: () => {
            navigate(`/app/inbox?chat=${chat.id}`);
            close();
          },
        });
      }

      for (const ticket of tickets.data?.items ?? []) {
        list.push({
          kind: 'content',
          id: `ticket:${ticket.id}`,
          group: t('palette.group.tickets'),
          label: ticket.subject,
          sub: `#${ticket.id}${ticket.customer_name ? ` · ${ticket.customer_name}` : ''}`,
          icon: '▦',
          run: () => {
            navigate(`/app/inbox?ticket=${ticket.id}`);
            close();
          },
        });
      }
    }

    if (searching && list.length === 0 && has(AI_QUERY_SCOPE)) {
      // The palette's fourth result: nothing else matched, so offer to ask
      // instead of just saying so. `query` (debounced), not `rawQuery` — the
      // same text the customer/ticket/chat search above already waits for,
      // and exactly what this pushes into `/palette/ai-query` once chosen.
      list.push({
        kind: 'ai',
        id: 'ai:ask',
        group: t('palette.group.ai'),
        label: t('palette.ai.ask', { query }),
        icon: AI_ICON,
        run: () => {
          setAiAsked(query);
          aiAnswer.mutate(query);
        },
      });
    }

    return list;
  }, [
    rawQuery,
    searching,
    query,
    customers.data,
    chatMatches,
    tickets.data,
    navigate,
    close,
    t,
    has,
    scopes,
    actionDeps,
    aiAnswer.mutate,
  ]);

  // Any change to the result set puts the highlight back on the first row, so
  // Enter never fires a stale selection left over from the previous query.
  useEffect(() => {
    setActiveIndex(0);
  }, [commands]);

  // Keep the highlighted row in view as the arrow keys walk past the fold.
  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-index="${activeIndex}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  const onInputKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    // The answer card has replaced the result list; there is nothing left for
    // the arrow keys or Enter to act on until the agent types again.
    if (aiAsked !== null) return;
    // Wraps rather than clamping (NFR-A11Y6): the four result kinds share one
    // flat list, so the end of "Tickets" and the start of "Actions" are just
    // adjacent rows, not a wall — ArrowDown past the last one lands back on
    // the first, and ArrowUp past the first lands on the last. Group headings
    // are never in `commands` at all (they are drawn between rows at render
    // time), so they are structurally unreachable by either key.
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (commands.length > 0) {
        setActiveIndex((index) => (index + 1) % commands.length);
      }
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (commands.length > 0) {
        setActiveIndex((index) => (index - 1 + commands.length) % commands.length);
      }
    } else if (event.key === 'Enter') {
      event.preventDefault();
      commands[activeIndex]?.run();
    }
  };

  // Closed and nothing to report: the palette costs the page nothing until the
  // next ⌘K. A pending failure notice is the one reason to stay on screen.
  if (!open && !actionError) return null;

  const busy = searching && (customers.isFetching || tickets.isFetching || chats.isFetching);

  // Sits above the palette's own layer so a notice raised by one run is still
  // readable if the agent has already reopened the palette to try again.
  const failure = actionError && (
    <div className="fixed inset-x-0 bottom-4 z-[60] flex justify-center px-4">
      <Banner
        tone="danger"
        role="alert"
        title={t('palette.action.failed')}
        dismissible
        onDismiss={() => setActionError(null)}
        dismissLabel={t('palette.action.failedDismiss')}
        className="max-w-xl shadow-lg"
      >
        {actionError.messageKey ? t(actionError.messageKey) : t('palette.action.failedFallback')}
      </Banner>
    </div>
  );

  if (!open) return failure;

  return (
    <>
      <div
        className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 px-4 pt-[12vh]"
        // A mousedown on the backdrop dismisses; stopped on the panel so a drag
        // that ends outside does not count as a dismiss.
        onMouseDown={close}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-label={t('palette.label')}
          className="flex max-h-[70vh] w-full max-w-xl flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-lg"
          onMouseDown={(event) => event.stopPropagation()}
        >
          <div className="flex items-center gap-2 border-b border-border px-4">
            <span aria-hidden="true" className="text-content-tertiary">
              ⌕
            </span>
            <input
              ref={inputRef}
              type="text"
              role="combobox"
              aria-expanded="true"
              aria-controls="command-palette-list"
              aria-activedescendant={
                aiAsked === null && commands[activeIndex]
                  ? `command-option-${activeIndex}`
                  : undefined
              }
              aria-label={t('palette.search')}
              placeholder={t('palette.placeholder')}
              value={rawQuery}
              onChange={(event) => {
                setRawQuery(event.target.value);
                // Editing the query abandons whatever answer is on screen — a
                // stale answer left sitting under a new query would look like
                // it was already the answer to the new one.
                if (aiAsked !== null) setAiAsked(null);
              }}
              onKeyDown={onInputKeyDown}
              className="flex-1 bg-transparent py-3 text-sm outline-none placeholder:text-content-tertiary"
            />
            <kbd className="rounded border border-border px-1.5 py-0.5 text-2xs text-content-tertiary">
              Esc
            </kbd>
          </div>

          <ul
            id="command-palette-list"
            role="listbox"
            ref={listRef}
            className="overflow-y-auto py-1"
          >
            {aiAsked !== null ? (
              <li role="presentation" className="px-4 py-3">
                <AiAnswerCard mutation={aiAnswer} t={t} />
              </li>
            ) : commands.length === 0 ? (
              <li
                role="presentation"
                className="px-4 py-6 text-center text-sm text-content-secondary"
              >
                {busy ? t('palette.searching') : t('palette.noMatches')}
              </li>
            ) : (
              commands.map((command, index) => {
                const firstOfGroup = index === 0 || commands[index - 1]!.group !== command.group;
                return (
                  <li key={command.id} role="presentation">
                    {firstOfGroup && (
                      <p
                        role="presentation"
                        className="px-4 pb-1 pt-2 text-2xs font-medium uppercase tracking-wide text-content-tertiary"
                      >
                        {command.group}
                      </p>
                    )}
                    <button
                      type="button"
                      role="option"
                      id={`command-option-${index}`}
                      data-index={index}
                      aria-selected={index === activeIndex}
                      onMouseEnter={() => setActiveIndex(index)}
                      // The palette is closing on select, so the click must not
                      // also blur-then-refocus the input mid-teardown.
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={command.run}
                      className={`flex w-full items-center gap-3 px-4 py-2 text-left text-sm transition-colors ${
                        index === activeIndex
                          ? 'bg-brand-100 dark:bg-brand-950'
                          : 'hover:bg-surface-2'
                      }`}
                    >
                      <span aria-hidden="true" className="text-content-tertiary">
                        {command.icon}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{command.label}</span>
                        {command.sub && (
                          <span className="block truncate text-2xs text-content-tertiary">
                            {command.sub}
                          </span>
                        )}
                      </span>
                    </button>
                  </li>
                );
              })
            )}
          </ul>
        </div>
      </div>
      {failure}
    </>
  );
}

/**
 * The AI result's answer, in place of the row it replaced — loading, then one
 * of the three `kind`s the endpoint can return. `no_data` and `not_understood`
 * both render through `EmptyState` (FR-EK-B.1): a topic with nothing to report
 * and a question the palette never learned to answer are both "nothing found
 * here", and the empty rectangle that reads as broken is exactly what that
 * component exists to replace. Their copy comes straight from `answer` rather
 * than a second, hand-written string — the endpoint already phrases the
 * no-data case and lists example topics for the not-understood one, and a
 * second copy invites the two to drift.
 */
function AiAnswerCard({
  mutation,
  t,
}: {
  mutation: UseMutationResult<PaletteAiAnswer, Error, string>;
  t: TFunction;
}): ReactElement {
  if (mutation.isPending) {
    return (
      <div aria-hidden="true" className="flex flex-col gap-2 py-1">
        <Skeleton width="55%" />
        <Skeleton width="90%" />
        <Skeleton width="35%" />
      </div>
    );
  }

  if (mutation.isError) {
    return (
      <p role="alert" className="text-2xs text-danger">
        {t('palette.ai.error')}
      </p>
    );
  }

  if (!mutation.data) return <></>;
  const { answer, kind, metric_source: metricSource } = mutation.data;

  if (kind === 'summary') {
    return (
      <div className="flex flex-col gap-1">
        <p className="text-sm">{answer}</p>
        {metricSource && (
          <p className="text-2xs text-content-tertiary">
            {t('palette.ai.source', { source: metricSource })}
          </p>
        )}
      </div>
    );
  }

  return (
    <EmptyState
      title={t(kind === 'no_data' ? 'palette.ai.noData.title' : 'palette.ai.notUnderstood.title')}
      description={answer}
    />
  );
}
