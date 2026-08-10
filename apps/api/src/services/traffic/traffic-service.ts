/**
 * Real-time traffic — who is on the site right now (FR-MOD-03.1).
 *
 * This answers a different question from the customer directory. `GET /customers`
 * is the CRM: everyone who has ever written in. Traffic is the live board: people
 * with an open conversation, plus people whose most recent visit falls inside a
 * short window, merged into one row per person and sorted by how recently they
 * did anything.
 *
 * The column that carries the feature is **Chatting with** (FR-MOD-03.1.3): the
 * human agent or the AI persona the visitor is currently talking to. It is
 * resolved exactly the way the widget header resolves it (FR-MOD-11.3) — a human
 * assignee wins over the persona — so the supervisor's board and the visitor's
 * widget never disagree about who is answering.
 *
 * Read-only: every action a row offers (start / supervise / assign) is an
 * existing chat endpoint the UI calls separately. This service only reports.
 */
import type { TenantClient, TenantContext } from '../../lib/tenant.js';

export type TrafficActivity =
  | 'browsing'
  | 'queued'
  | 'waiting'
  | 'chatting'
  | 'supervised'
  | 'invited';

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

/** How recent a visit has to be for the visitor to count as "on the site now". */
const LIVE_WINDOW_MINUTES = 30;

export class TrafficService {
  async listLive(
    tx: TenantClient,
    tenant: TenantContext,
    options: { limit: number },
  ): Promise<{ items: TrafficVisitor[]; total: number }> {
    const liveSince = new Date(Date.now() - LIVE_WINDOW_MINUTES * 60_000);

    // 1. Active conversations, newest first. One row per customer — the newest
    //    chat wins, which is why the loop below skips a customer already seen.
    const chats = await tx.chat.findMany({
      where: {
        licenseId: tenant.licenseId,
        active: true,
        customer: { organizationId: tenant.organizationId },
      },
      orderBy: { createdAt: 'desc' },
      take: options.limit,
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
    const assigneeIds = [
      ...new Set(
        chats
          .map((chat) => chat.threads[0]?.assigneeId)
          .filter((id): id is string => typeof id === 'string'),
      ),
    ];
    const [assignees, persona] = await Promise.all([
      assigneeIds.length > 0
        ? tx.account.findMany({
            where: { id: { in: assigneeIds } },
            select: { id: true, name: true, avatarUrl: true },
          })
        : Promise.resolve([]),
      // `kind: 'copilot'` is the agent's assistant, not who the visitor talks
      // to. Oldest-first so the choice is stable when more than one exists.
      tx.aiAgent.findFirst({
        where: { active: true, kind: 'ai_agent' },
        orderBy: { createdAt: 'asc' },
        select: { name: true, avatarUrl: true },
      }),
    ]);
    const accountById = new Map(assignees.map((account) => [account.id, account]));

    const seen = new Set<string>();
    const rows: Array<{ sortAt: Date; visitor: TrafficVisitor }> = [];

    for (const chat of chats) {
      if (seen.has(chat.customerId)) continue;
      seen.add(chat.customerId);

      const thread = chat.threads[0];
      const lastEvent = thread?.events[0] ?? null;

      // Most-specific first, so a visitor lands in exactly one bucket: still in
      // the queue, or waiting on a reply, or otherwise mid-conversation.
      const activity: TrafficActivity =
        thread?.queuePosition != null
          ? 'queued'
          : lastEvent?.authorType === 'customer'
            ? 'waiting'
            : 'chatting';

      let respondent: TrafficRespondent | null = null;
      if (thread?.assigneeId) {
        const account = accountById.get(thread.assigneeId);
        if (account) {
          respondent = { kind: 'human', name: account.name, avatar_url: account.avatarUrl };
        }
      }
      // The persona answers first only when no human has the chat and it is not
      // still sitting unclaimed in the queue.
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

    // 2. Browsing visitors: a recent visit but no active conversation. Newest
    //    visit first so the JS de-dup keeps the current one per customer.
    const remaining = options.limit - rows.length;
    if (remaining > 0) {
      const visits = await tx.visit.findMany({
        where: {
          licenseId: tenant.licenseId,
          startedAt: { gte: liveSince },
          customer: {
            organizationId: tenant.organizationId,
            ...(seen.size > 0 ? { id: { notIn: [...seen] } } : {}),
          },
        },
        orderBy: { startedAt: 'desc' },
        // Over-fetch a little: several page views by one visitor collapse to a
        // single row, so `remaining` visits can be fewer than `remaining` rows.
        take: remaining * 4,
        select: {
          customerId: true,
          startedAt: true,
          customer: { select: { name: true, email: true } },
        },
      });

      for (const visit of visits) {
        if (rows.length >= options.limit) break;
        if (seen.has(visit.customerId)) continue;
        seen.add(visit.customerId);

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

    rows.sort((a, b) => b.sortAt.getTime() - a.sortAt.getTime());
    const items = rows.slice(0, options.limit).map((entry) => entry.visitor);
    return { items, total: items.length };
  }
}
