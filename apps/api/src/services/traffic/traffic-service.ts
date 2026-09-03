/**
 * Real-time traffic — who is on the site right now (FR-MOD-03.1).
 *
 * This answers a different question from the customer directory. `GET /customers`
 * is the CRM: everyone who has ever written in. Traffic is the live board: people
 * with an open conversation, people a campaign has just invited and who have not
 * answered yet, plus people whose most recent visit falls inside a short window,
 * merged into one row per person and sorted by how recently they did anything.
 *
 * The column that carries the feature is **Chatting with** (FR-MOD-03.1.3): the
 * human agent or the AI persona the visitor is currently talking to. It is
 * resolved exactly the way the widget header resolves it (FR-MOD-11.3) — a human
 * assignee wins over the persona — so the supervisor's board and the visitor's
 * widget never disagree about who is answering.
 *
 * Read-only: every action a row offers (start / supervise / assign) is an
 * existing chat endpoint the UI calls separately. This service only reports —
 * including on supervision, whose rows are written by `SupervisionService` and
 * only read back here to colour the funnel (FR-MOD-13.2).
 */
import type { TenantClient, TenantContext } from '../../lib/tenant.js';
import { visitorPageUrls } from '../campaigns/campaign-matching.js';
import { SupervisionService } from './supervision-service.js';

export const TRAFFIC_ACTIVITIES = [
  'browsing',
  'queued',
  'waiting',
  'chatting',
  'supervised',
  'invited',
] as const;

export type TrafficActivity = (typeof TRAFFIC_ACTIVITIES)[number];

/**
 * The states that only an open conversation can produce.
 *
 * `invited` comes from a campaign send and `browsing` from a visit, so asking
 * for neither of those is the same as asking for conversations only — which is
 * what lets a tab like "Queued" skip the two sources that cannot answer it.
 */
const CONVERSATION_ACTIVITIES: readonly TrafficActivity[] = [
  'queued',
  'waiting',
  'chatting',
  'supervised',
];

export interface TrafficRespondent {
  kind: 'human' | 'ai';
  name: string;
  avatar_url: string | null;
}

export interface TrafficVisitor {
  customer_id: string;
  name: string | null;
  email: string | null;
  activity: TrafficActivity;
  /** The active conversation, when there is one; null while browsing. */
  chat_id: string | null;
  chatting_with: TrafficRespondent | null;
  last_activity_at: string | null;
}

/**
 * "Match all filters" (FR-MOD-13.2), one optional condition per field.
 *
 * Every condition that is present must hold; an absent one restricts nothing.
 * That is the whole of the rule the PRD names — there is no "match any" mode,
 * and "Add filter" is nothing more than setting one more of these.
 *
 * A row that *cannot answer* a condition fails it, rather than being waved
 * through. `groupId` is a fact a conversation carries, and the two visit needles
 * are facts a visit carries: a browsing visitor has no team, so a team filter
 * excludes them. Waving them through instead would quietly turn AND into "AND,
 * except where I did not look", which is exactly the shape of filter bug that
 * shows a supervisor more people than they asked for.
 */
export interface TrafficFilters {
  /** Funnel states to keep. Absent means every state — the "All" tab. */
  activity?: readonly TrafficActivity[];
  /** Case-insensitive substring of any page URL on the visitor's live visit. */
  pageUrlContains?: string;
  /** Case-insensitive substring of the referrer on that same visit. */
  cameFromContains?: string;
  /** ISO 3166-1 alpha-2, matched case-insensitively. */
  countryCode?: string;
  isLead?: boolean;
  /** A team the conversation is routed to (`chat_access`). */
  groupId?: bigint;
}

export interface TrafficQuery extends TrafficFilters {
  limit: number;
  /** Opaque keyset cursor from a previous page's `next_page_id`. */
  pageId?: string;
}

/**
 * The board's cursor: the keyset boundary — the last row the previous page
 * returned, in the final merged order. A new arrival above it shifts nothing
 * below it, exactly like `mergeChatHead`'s `(created_at, id)` cursor for the
 * chat list; the property is what keeps a page stable while the board itself
 * keeps changing under the reader.
 *
 * Unlike a single-table list, `listLive` re-reads and re-merges all three
 * sources on every call rather than resuming a DB cursor — see `fetchWindow`
 * below for why that read is *not* sized off how many rows earlier pages
 * already returned.
 */
interface Cursor {
  sortAt: string;
  customerId: string;
}

function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

/** A malformed cursor is treated as no cursor — a stale bookmark starts over. */
function decodeCursor(pageId: string | undefined): Cursor | null {
  if (!pageId) return null;
  try {
    const parsed = JSON.parse(Buffer.from(pageId, 'base64url').toString('utf8')) as Cursor;
    return typeof parsed?.sortAt === 'string' && typeof parsed?.customerId === 'string'
      ? parsed
      : null;
  } catch {
    return null;
  }
}

/**
 * Whether `entry` sits strictly after `cursor` in the board's own order
 * (`sortAt` desc, `customer_id` desc breaking a tie) — the predicate that
 * turns "the top `fetchWindow` rows" into "the rows the next page owns".
 */
function isBeyondCursor(entry: { sortAt: Date; visitor: TrafficVisitor }, cursor: Cursor): boolean {
  const cursorTime = new Date(cursor.sortAt).getTime();
  const entryTime = entry.sortAt.getTime();
  if (entryTime !== cursorTime) return entryTime < cursorTime;
  return entry.visitor.customer_id.localeCompare(cursor.customerId) < 0;
}

/** How recent a visit has to be for the visitor to count as "on the site now". */
const LIVE_WINDOW_MINUTES = 30;

/**
 * How much more than a page of rows each source reads.
 *
 * `DEDUP` is the headroom the board has always used where several source rows
 * collapse into one visitor (page views, repeat invitations). `FILTER` is the
 * headroom a JS-side condition needs on top, because those rows are dropped
 * *after* the read — with no headroom, `activity=browsing` would read a page of
 * conversations and return nothing. The product is capped so no combination of
 * filters can turn one page into an unbounded scan (NFR-P2).
 */
const DEDUP_HEADROOM = 4;
const FILTER_HEADROOM = 4;
const MAX_SOURCE_ROWS = 500;

/** The two visit facts the filters ask about. Absent = the visitor has no live visit. */
interface VisitEvidence {
  cameFrom: string | null;
  pages: unknown;
}

/**
 * A live visit, with its filterable facts attached only when something asks for
 * them. `evidence: null` means "not read on this path" — never "no referrer".
 */
interface LiveVisit {
  customerId: string;
  startedAt: Date;
  customer: { name: string | null; email: string | null };
  evidence: VisitEvidence | null;
}

/** Customer-column conditions, pushed into SQL because they are indexed columns. */
interface CustomerFilter {
  organizationId: string;
  countryCode?: { equals: string; mode: 'insensitive' };
  isLead?: boolean;
}

function sourceTake(rows: number, opts: { dedup: boolean; filtered: boolean }): number {
  const factor = (opts.dedup ? DEDUP_HEADROOM : 1) * (opts.filtered ? FILTER_HEADROOM : 1);
  return Math.min(rows * factor, MAX_SOURCE_ROWS);
}

function includesFold(haystack: string | null | undefined, needle: string): boolean {
  return typeof haystack === 'string' && haystack.toLowerCase().includes(needle);
}

export class TrafficService {
  constructor(private readonly supervisions: SupervisionService = new SupervisionService()) {}

  async listLive(
    tx: TenantClient,
    tenant: TenantContext,
    options: TrafficQuery,
  ): Promise<{ items: TrafficVisitor[]; total: number; nextPageId?: string }> {
    const { limit } = options;
    const cursor = decodeCursor(options.pageId);
    // How deep the merged, sorted board has to be materialised to answer this
    // page. Every page — not just a later one — reads each source up to its
    // own hard ceiling (`sourceTake` already clamps at `MAX_SOURCE_ROWS`)
    // rather than a window sized off `limit`: `total` (below) is a count over
    // this same materialised window, so a page-1-only shortcut would make the
    // first page of every tab under-report until the caller had paged deep
    // enough to outgrow it — exactly the "loaded window mistaken for the real
    // total" bug `total` exists to not have (13.2 M-COUNT-d). A window sized
    // for "one page past the cursor" would also come up short the moment
    // enough new rows land above the boundary between one request and the
    // next, silently truncating a page that still has rows to give. The board
    // is small and live (a 30-minute window, already capped at
    // `MAX_SOURCE_ROWS` per source) — reading it in full on every page costs
    // nothing a first-page filter could not already cost (NFR-P2 measured:
    // `apps/e2e/tests/traffic.spec.ts`'s filtered-board budget).
    const fetchWindow = MAX_SOURCE_ROWS;
    const liveSince = new Date(Date.now() - LIVE_WINDOW_MINUTES * 60_000);

    // A team id reaches the query only once it is known to be one of the
    // caller's own. RLS on `groups` already makes a foreign team invisible, so
    // this check *is* the tenant gate rather than a hint about one; running it
    // first also means a foreign id can never be handed to `chat_access`, which
    // has no license column of its own to be filtered by (NFR-S4).
    //
    // A miss answers with an empty board, not a 404. An id that is not ours and
    // an id of ours that nobody is chatting from have to look identical, or the
    // parameter becomes a way to count another license's teams (NFR-S5) — the
    // same rule `customers.ts` and `supervision-service.ts` follow.
    if (options.groupId !== undefined) {
      const group = await tx.group.findFirst({
        where: { licenseId: tenant.licenseId, id: options.groupId },
        select: { id: true },
      });
      if (!group) return { items: [], total: 0 };
    }

    const wanted = options.activity;
    const wants = (activity: TrafficActivity): boolean =>
      wanted === undefined || wanted.includes(activity);

    // Only a conversation carries a team, so a team filter rules the other two
    // sources out entirely rather than merely narrowing them.
    const conversationsOnly = options.groupId !== undefined;
    const wantsConversation = CONVERSATION_ACTIVITIES.some(wants);
    const wantsInvited = wants('invited') && !conversationsOnly;
    const wantsBrowsing = wants('browsing') && !conversationsOnly;

    const pageNeedle = options.pageUrlContains?.toLowerCase();
    const cameFromNeedle = options.cameFromContains?.toLowerCase();
    const needsVisit = pageNeedle !== undefined || cameFromNeedle !== undefined;
    // Anything that drops a row after it has been read — as opposed to in the
    // WHERE clause — is what the extra read headroom is for.
    const filtered = wanted !== undefined || needsVisit;

    const customerFilter: CustomerFilter = {
      organizationId: tenant.organizationId,
      ...(options.countryCode !== undefined
        ? { countryCode: { equals: options.countryCode, mode: 'insensitive' as const } }
        : {}),
      ...(options.isLead !== undefined ? { isLead: options.isLead } : {}),
    };

    // Visit evidence, read up front when — and only when — a visit condition is
    // in play. A conversation row has to answer that condition too: filtering
    // only the browsing bucket would make `activity=chatting&page_url_contains=…`
    // a combination that can never match anybody, however many chatting visitors
    // are sitting on that page. Hoisting the read the board already does for its
    // third source, instead of adding a fourth one, is what keeps the query
    // count where it was (NFR-P2) — step 3 below reuses these very rows.
    const liveVisits = needsVisit
      ? await this.#readVisits(tx, {
          licenseId: tenant.licenseId,
          liveSince,
          customer: customerFilter,
          exclude: new Set<string>(),
          take: sourceTake(fetchWindow, { dedup: true, filtered }),
          withEvidence: true,
        })
      : null;

    // Newest visit per customer — the list is already ordered, so the first one
    // seen is the current one.
    const evidenceByCustomer = new Map<string, VisitEvidence>();
    for (const visit of liveVisits ?? []) {
      if (visit.evidence && !evidenceByCustomer.has(visit.customerId)) {
        evidenceByCustomer.set(visit.customerId, visit.evidence);
      }
    }

    /** Does this visitor's live visit satisfy the visit conditions? No visit = no. */
    const matchesVisit = (customerId: string): boolean => {
      if (!needsVisit) return true;
      const evidence = evidenceByCustomer.get(customerId);
      if (!evidence) return false;
      if (pageNeedle !== undefined) {
        const urls = visitorPageUrls(evidence.pages);
        if (!urls.some((url) => includesFold(url, pageNeedle))) return false;
      }
      if (cameFromNeedle !== undefined && !includesFold(evidence.cameFrom, cameFromNeedle)) {
        return false;
      }
      return true;
    };

    // 1. Active conversations, newest first. One row per customer — the newest
    //    chat wins, which is why the loop below skips a customer already seen.
    //
    //    Read even when no conversation state is wanted: this is where the
    //    board learns who is mid-conversation, and without it the same person
    //    would come back from the visits source labelled `browsing`.
    const chats = await tx.chat.findMany({
      where: {
        licenseId: tenant.licenseId,
        active: true,
        customer: customerFilter,
        ...(options.groupId !== undefined
          ? { access: { some: { groupId: options.groupId } } }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: sourceTake(fetchWindow, { dedup: false, filtered }),
      select: {
        id: true,
        customerId: true,
        createdAt: true,
        customer: { select: { name: true, email: true } },
        threads: {
          where: { active: true },
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: {
            assigneeId: true,
            queuePosition: true,
            createdAt: true,
            events: {
              orderBy: { createdAt: 'desc' },
              take: 1,
              select: { authorType: true, createdAt: true },
            },
          },
        },
      },
    });

    // Resolve the responders in bulk: the human assignees named on the live
    // threads, and the single active AI persona that answers when no human is.
    // All three are skipped when no conversation row can survive the filter —
    // they only ever decorate a conversation row.
    const assigneeIds = wantsConversation
      ? [
          ...new Set(
            chats
              .map((chat) => chat.threads[0]?.assigneeId)
              .filter((id): id is string => typeof id === 'string'),
          ),
        ]
      : [];
    const [assignees, persona, watched] = await Promise.all([
      assigneeIds.length > 0
        ? tx.account.findMany({
            where: { id: { in: assigneeIds } },
            select: { id: true, name: true, avatarUrl: true },
          })
        : Promise.resolve([]),
      // `kind: 'copilot'` is the agent's assistant, not who the visitor talks
      // to. Oldest-first so the choice is stable when more than one exists.
      wantsConversation
        ? tx.aiAgent.findFirst({
            where: { active: true, kind: 'ai_agent' },
            orderBy: { createdAt: 'asc' },
            select: { name: true, avatarUrl: true },
          })
        : Promise.resolve(null),
      // Who is being watched right now (13.2-d writes these rows). One indexed
      // read for the whole page, alongside the other two rather than after
      // them, because a query per visitor is the shape NFR-P2 rules out. Every
      // fetched chat id goes in, not just the ones that survive the de-dup
      // below: the list is already bounded by `limit`, and pre-scanning it to
      // shave a few ids off a single `IN` would cost more than it saves.
      this.supervisions.liveByChat(
        tx,
        tenant.licenseId,
        wantsConversation ? chats.map((chat) => chat.id) : [],
      ),
    ]);
    const accountById = new Map(assignees.map((account) => [account.id, account]));

    const seen = new Set<string>();
    const rows: Array<{ sortAt: Date; visitor: TrafficVisitor }> = [];

    for (const chat of chats) {
      if (seen.has(chat.customerId)) continue;
      // Claimed here, before any filter has had its say. A conversation the
      // caller filtered out is still a conversation: letting that customer fall
      // through to the invited or browsing source would not narrow the board,
      // it would relabel them.
      seen.add(chat.customerId);
      if (!wantsConversation || rows.length >= fetchWindow) continue;

      const thread = chat.threads[0];
      const lastEvent = thread?.events[0] ?? null;

      // Most-specific first, so a visitor lands in exactly one bucket: still in
      // the queue, or watched by a supervisor, or waiting on a reply, or
      // otherwise mid-conversation.
      //
      // The two ends of that order are the decisions (the PRD names the states
      // but not their precedence — recorded as an assumption in PLAN §C):
      //
      //   queued > supervised — a queued conversation belongs to nobody yet,
      //     and "nobody has picked this up" is the fact the board exists to
      //     surface. Someone reading over the queue's shoulder does not change
      //     that it is still unanswered, so a watcher must not hide it from the
      //     one bucket a supervisor is scanning for.
      //   supervised > waiting/chatting — those two are the ordinary state of
      //     every live conversation and are re-derivable from the transcript at
      //     a glance; being watched is the rare fact, visible nowhere else on
      //     the row. Ranking it lower would mean the state could exist in the
      //     dictionary and never once be produced for a chat that has events.
      const activity: TrafficActivity =
        thread?.queuePosition != null
          ? 'queued'
          : watched.has(chat.id)
            ? 'supervised'
            : lastEvent?.authorType === 'customer'
              ? 'waiting'
              : 'chatting';

      if (!wants(activity) || !matchesVisit(chat.customerId)) continue;

      let respondent: TrafficRespondent | null = null;
      if (thread?.assigneeId) {
        const account = accountById.get(thread.assigneeId);
        if (account) {
          respondent = { kind: 'human', name: account.name, avatar_url: account.avatarUrl };
        }
      }
      // The persona answers first only when no human has the chat and it is not
      // still sitting unclaimed in the queue. A supervisor is not a respondent —
      // watching is not answering — so `supervised` deliberately falls through
      // here and the column keeps naming whoever the visitor is actually
      // talking to. (Naming the watcher too is a separate field, not this one.)
      if (!respondent && activity !== 'queued' && persona) {
        respondent = { kind: 'ai', name: persona.name, avatar_url: persona.avatarUrl };
      }

      const sortAt = lastEvent?.createdAt ?? thread?.createdAt ?? chat.createdAt;
      rows.push({
        sortAt,
        visitor: {
          customer_id: chat.customerId,
          name: chat.customer.name,
          email: chat.customer.email,
          activity,
          chat_id: chat.id,
          chatting_with: respondent,
          last_activity_at: sortAt.toISOString(),
        },
      });
    }

    // 2. Invited visitors: a campaign fired at them inside the live window and
    //    they have not answered yet (FR-MOD-03.3.2 writes the row; `engaged`
    //    flips the moment they reply). This sits above browsing on purpose —
    //    a pending invitation is the more specific thing to know about someone
    //    who is not in a conversation. An active chat still wins: the loop
    //    above already claimed those customers, so `seen` keeps them out.
    //
    //    Read whenever a browsing row could still be produced, even if no
    //    invited row can: this is where the board learns who has a pending
    //    invitation, and skipping it would hand the same person back from the
    //    visits source as `browsing` — filtering a bucket out would *move*
    //    people into another one instead of removing them.
    let remaining = fetchWindow - rows.length;
    if ((wantsInvited || wantsBrowsing) && remaining > 0) {
      const sends = await tx.campaignSend.findMany({
        where: {
          licenseId: tenant.licenseId,
          engaged: false,
          createdAt: { gte: liveSince },
          customer: {
            ...customerFilter,
            ...(seen.size > 0 ? { id: { notIn: [...seen] } } : {}),
          },
        },
        orderBy: { createdAt: 'desc' },
        // Over-fetch for the same reason as visits below: two campaigns can
        // invite the same visitor, and those collapse to a single row.
        take: sourceTake(remaining, { dedup: true, filtered }),
        select: {
          customerId: true,
          createdAt: true,
          customer: { select: { name: true, email: true } },
        },
      });

      for (const send of sends) {
        if (rows.length >= fetchWindow) break;
        if (seen.has(send.customerId)) continue;
        // Claimed before any filter has had its say, for the reason above: an
        // invitation that fails the filter must not reappear as `browsing`.
        seen.add(send.customerId);
        if (!wantsInvited || !matchesVisit(send.customerId)) continue;

        rows.push({
          sortAt: send.createdAt,
          visitor: {
            customer_id: send.customerId,
            name: send.customer.name,
            email: send.customer.email,
            activity: 'invited',
            chat_id: null,
            chatting_with: null,
            last_activity_at: send.createdAt.toISOString(),
          },
        });
      }
    }

    // 3. Browsing visitors: a recent visit but no active conversation. Newest
    //    visit first so the JS de-dup keeps the current one per customer.
    remaining = fetchWindow - rows.length;
    if (wantsBrowsing && remaining > 0) {
      const visits =
        liveVisits ??
        (await this.#readVisits(tx, {
          licenseId: tenant.licenseId,
          liveSince,
          customer: customerFilter,
          exclude: seen,
          // Over-fetch a little: several page views by one visitor collapse to
          // a single row, so `remaining` visits can be fewer than `remaining`
          // rows.
          take: sourceTake(remaining, { dedup: true, filtered }),
          withEvidence: false,
        }));

      for (const visit of visits) {
        if (rows.length >= fetchWindow) break;
        if (seen.has(visit.customerId)) continue;
        seen.add(visit.customerId);
        if (!matchesVisit(visit.customerId)) continue;

        rows.push({
          sortAt: visit.startedAt,
          visitor: {
            customer_id: visit.customerId,
            name: visit.customer.name,
            email: visit.customer.email,
            activity: 'browsing',
            chat_id: null,
            chatting_with: null,
            last_activity_at: visit.startedAt.toISOString(),
          },
        });
      }
    }

    // `customer_id` breaks a tie deterministically — two rows sharing a
    // millisecond would otherwise fall back to source-then-DB order, which
    // `isBeyondCursor` below has no way to reproduce from a cursor alone.
    rows.sort((a, b) => {
      const diff = b.sortAt.getTime() - a.sortAt.getTime();
      return diff !== 0 ? diff : b.visitor.customer_id.localeCompare(a.visitor.customer_id);
    });

    // Everything materialised above is the top `fetchWindow` of the board;
    // the boundary cursor (when present) is what carves this particular page
    // out of it, rather than a raw slice — a new arrival above the boundary
    // must not shift rows that already went out on an earlier page.
    const windowRows = rows.slice(0, fetchWindow);
    const pageRows = cursor
      ? windowRows.filter((entry) => isBeyondCursor(entry, cursor))
      : windowRows;
    const page = pageRows.slice(0, limit);
    const items = page.map((entry) => entry.visitor);
    const last = page.at(-1);

    return {
      items,
      // The whole board matching this query (activity + every other filter),
      // not just the page handed back — `pageRows`, before the `limit` slice.
      // Bounded by `fetchWindow`/`MAX_SOURCE_ROWS`, the same cap the board's
      // three sources have always been read under; a board deeper than that
      // reports the cap rather than an exact count past it, same trade-off
      // the cap itself already makes for the rows a caller can page through.
      total: pageRows.length,
      ...(pageRows.length > limit && last
        ? {
            nextPageId: encodeCursor({
              sortAt: last.sortAt.toISOString(),
              customerId: last.visitor.customer_id,
            }),
          }
        : {}),
    };
  }

  /**
   * Live visits, newest first.
   *
   * Two shapes of the same read rather than one with a computed `select`: the
   * `pages` JSONB is the largest column on the row and the board does not need
   * it unless a page condition was asked for, so the default path must not pay
   * for it. Both shapes come back as `LiveVisit`, and `evidence: null` on the
   * lean one is honest — it says "not read", and nothing consults it, because
   * `matchesVisit` short-circuits when no visit condition is set.
   */
  async #readVisits(
    tx: TenantClient,
    args: {
      licenseId: bigint;
      liveSince: Date;
      customer: CustomerFilter;
      exclude: Set<string>;
      take: number;
      withEvidence: boolean;
    },
  ): Promise<LiveVisit[]> {
    const where = {
      licenseId: args.licenseId,
      startedAt: { gte: args.liveSince },
      customer: {
        ...args.customer,
        ...(args.exclude.size > 0 ? { id: { notIn: [...args.exclude] } } : {}),
      },
    };
    const common = { where, orderBy: { startedAt: 'desc' as const }, take: args.take };

    if (!args.withEvidence) {
      const lean = await tx.visit.findMany({
        ...common,
        select: {
          customerId: true,
          startedAt: true,
          customer: { select: { name: true, email: true } },
        },
      });
      return lean.map((visit) => ({ ...visit, evidence: null }));
    }

    const full = await tx.visit.findMany({
      ...common,
      select: {
        customerId: true,
        startedAt: true,
        cameFrom: true,
        pages: true,
        customer: { select: { name: true, email: true } },
      },
    });
    return full.map(({ cameFrom, pages, ...visit }) => ({
      ...visit,
      evidence: { cameFrom, pages },
    }));
  }
}
