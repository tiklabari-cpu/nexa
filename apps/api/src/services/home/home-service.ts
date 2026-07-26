/**
 * Home dashboard (FR-MOD-13.1).
 *
 * Assembles the three sections of the Home screen from live data:
 *   - the activation checklist, each step "done" because the thing it asks for
 *     exists (a website, a teammate, widget customisation, a canned response, an
 *     AI Agent) — a computed state, never a stored to-do list that could lie;
 *   - the live counters — distinct visitors on the site now, open conversations,
 *     and teammates accepting chats;
 *   - the week-over-week performance summary.
 *
 * Read-only. Everything is scoped by RLS through the tenant client, so a missing
 * WHERE returns nothing rather than another tenant's rows; the explicit
 * `licenseId` filters on the raw counters are defence in depth, matching the
 * traffic board.
 *
 * The weekly `chats`/`resolved` are counted the same way the Reports overview
 * counts `chats`/`closed` for an equal window — threads created in the window,
 * and of those the ones no longer active — so the Home glance and the full
 * report a click away can never quote different figures. It deliberately does
 * not touch the manual/assisted/automated split (ADR-09): that lives once, in
 * the reports route, and the Home screen does not surface it.
 */
import { ACTIVATION_STEPS, type ActivationStepKey, type HomeDashboard } from '@nexa/types';
import type { TenantClient, TenantContext } from '../../lib/tenant.js';

/** How recent a visit has to be for the visitor to count as "on the site now". */
const LIVE_WINDOW_MINUTES = 30;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** Round to three decimals — the precision a satisfaction KPI ever shows. */
function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

interface WeeklyCounts {
  chats: number;
  resolved: number;
  good: number;
  bad: number;
}

export class HomeService {
  async getDashboard(
    tx: TenantClient,
    tenant: TenantContext,
    now: Date,
  ): Promise<HomeDashboard> {
    // Sequential, not Promise.all: withTenant runs in one interactive
    // transaction, and Prisma forbids concurrent queries on its client.
    const activation = await this.#activation(tx);
    const live = await this.#live(tx, tenant, now);
    const weekly = await this.#weekly(tx, tenant, now);
    return { activation, live, weekly };
  }

  /**
   * The activation checklist. Each step is derived, not stored: it is done
   * because the thing it asks for exists right now, so it can never drift from
   * the workspace's real state.
   */
  async #activation(tx: TenantClient): Promise<HomeDashboard['activation']> {
    const websites = await tx.website.count();
    const memberships = await tx.agentMembership.count();
    // A pending invite counts as "invited a teammate" even before they accept;
    // once accepted it shows as the second membership instead.
    const pendingInvites = await tx.invitation.count({ where: { acceptedAt: null } });
    const widgetSettings = await tx.widgetSettings.count();
    const canned = await tx.cannedResponse.count();
    const aiAgents = await tx.aiAgent.count({ where: { kind: 'ai_agent' } });

    const done: Record<ActivationStepKey, boolean> = {
      install_widget: websites > 0,
      invite_teammate: memberships > 1 || pendingInvites > 0,
      customize_widget: widgetSettings > 0,
      add_canned_response: canned > 0,
      set_up_ai_agent: aiAgents > 0,
    };

    const steps = ACTIVATION_STEPS.map((key) => ({ key, done: done[key] }));
    return {
      steps,
      completed: steps.filter((step) => step.done).length,
      total: steps.length,
    };
  }

  /** The live counters — who and what is active right now. */
  async #live(
    tx: TenantClient,
    tenant: TenantContext,
    now: Date,
  ): Promise<HomeDashboard['live']> {
    const liveSince = new Date(now.getTime() - LIVE_WINDOW_MINUTES * 60_000);

    // Distinct people on the site now: someone with an open chat, or someone
    // whose most recent visit falls inside the live window — the union, so a
    // long conversation with no fresh page view still counts, and a browser
    // with no chat still counts. `::int` so the count comes back as a number.
    const [visitorsRow] = await tx.$queryRaw<Array<{ n: number }>>`
      SELECT count(DISTINCT customer_id)::int AS n FROM (
        SELECT customer_id FROM chats
          WHERE license_id = ${tenant.licenseId} AND active = true
        UNION
        SELECT customer_id FROM visits
          WHERE license_id = ${tenant.licenseId} AND started_at >= ${liveSince}
      ) AS live_visitors
    `;

    const ongoingChats = await tx.chat.count({
      where: { licenseId: tenant.licenseId, active: true },
    });

    // Teammates set to accept chats — the same definition the widget uses to
    // tell a customer whether anyone is online (routes/customer.ts).
    const agentsOnline = await tx.agentMembership.count({
      where: { routingStatus: 'accepting_chats', suspended: false },
    });

    return {
      visitors_online: visitorsRow?.n ?? 0,
      ongoing_chats: ongoingChats,
      agents_online: agentsOnline,
    };
  }

  /** The last 7 days versus the 7 before, so each figure carries a delta. */
  async #weekly(
    tx: TenantClient,
    tenant: TenantContext,
    now: Date,
  ): Promise<HomeDashboard['weekly']> {
    const to = now;
    const from = new Date(now.getTime() - WEEK_MS);
    // The comparison window: the equal-length week immediately before, a
    // millisecond short of `from` so the two never share an instant.
    const prevTo = new Date(from.getTime() - 1);
    const prevFrom = new Date(from.getTime() - WEEK_MS);

    const current = await this.#weeklyCounts(tx, tenant.licenseId, from, to);
    const previous = await this.#weeklyCounts(tx, tenant.licenseId, prevFrom, prevTo);

    const rated = current.good + current.bad;
    const prevRated = previous.good + previous.bad;

    return {
      range: { from: from.toISOString(), to: to.toISOString() },
      chats: current.chats,
      resolved: current.resolved,
      satisfaction: {
        good: current.good,
        bad: current.bad,
        responses: rated,
        score: rated === 0 ? null : round3(current.good / rated),
      },
      previous: {
        range: { from: prevFrom.toISOString(), to: prevTo.toISOString() },
        chats: previous.chats,
        resolved: previous.resolved,
        satisfaction_score: prevRated === 0 ? null : round3(previous.good / prevRated),
      },
    };
  }

  /**
   * Headline counts for one window: conversations started, of those the ones now
   * resolved, and the good/bad rating tallies. `chats`/`resolved` match the
   * Reports overview's `chats`/`closed` for the same window by using the same
   * created-in-window basis — no second definition to drift.
   */
  async #weeklyCounts(
    tx: TenantClient,
    licenseId: bigint,
    from: Date,
    to: Date,
  ): Promise<WeeklyCounts> {
    const chats = await tx.thread.count({
      where: { licenseId, createdAt: { gte: from, lte: to } },
    });
    const resolved = await tx.thread.count({
      where: { licenseId, createdAt: { gte: from, lte: to }, active: false },
    });
    const good = await tx.rating.count({
      where: { licenseId, value: 'good', createdAt: { gte: from, lte: to } },
    });
    const bad = await tx.rating.count({
      where: { licenseId, value: 'bad', createdAt: { gte: from, lte: to } },
    });
    return { chats, resolved, good, bad };
  }
}
