/**
 * Campaigns — proactive, targeted messages (FR-MOD-03.3).
 *
 * A campaign is a trigger plus a message. When it is running, the trigger engine
 * evaluates the visitors on the site right now and delivers the message to the
 * ones that match — recording one `campaign_send` per visitor, which is both the
 * "don't send twice" guard and the source of the card's Displayed / Chats /
 * Conversion numbers (FR-MOD-03.3.3).
 *
 * The stored `status` (ongoing / scheduled / inactive) is a *cache* of a
 * function of the clock — the owner's on/off intent plus the schedule window,
 * asked at some past moment. Writing it is not enough on its own: nothing fires
 * when a start time arrives, so a campaign saved `scheduled` would sit there
 * claiming to be scheduled long after it began. `list` therefore re-resolves
 * every row it returns and heals the column behind it (`#healStatuses`), which
 * is what makes the status tabs — and anything else reading the column — tell
 * the truth without a scheduler in the deployment.
 *
 * The engine only ever reads and writes tenant-scoped tables inside the
 * caller's `withTenant` transaction, so a campaign in one workspace can never
 * fire at another's visitors — the property the integration test pins first.
 */
import type { Prisma } from '@prisma/client';
import type {
  Campaign,
  CampaignConditions,
  CampaignContent,
  CampaignStatus,
  CampaignStatusFilter,
} from '@nexa/types';
import { ApiError } from '../../lib/api-error.js';
import type { TenantClient, TenantContext } from '../../lib/tenant.js';
import {
  campaignPerformance,
  computeCampaignStatus,
  deriveActiveIntent,
  hasTrigger,
  matchesConditions,
  resolveCampaignStatus,
  visitorPageUrls,
} from './campaign-matching.js';

/** How recent a visit has to be for a visitor to count as "on the site now". */
const LIVE_WINDOW_MINUTES = 30;

/** The columns needed to build a DTO — sends included for the performance count. */
const CAMPAIGN_INCLUDE = {
  sends: { select: { engaged: true, converted: true } },
} satisfies Prisma.CampaignInclude;

type CampaignRow = Prisma.CampaignGetPayload<{ include: typeof CAMPAIGN_INCLUDE }>;

export interface CampaignInput {
  name: string;
  /** On/off intent; defaults to true — a new campaign is meant to run. */
  active?: boolean;
  conditions: CampaignConditions;
  content: CampaignContent;
  startsAt?: Date | null;
  endsAt?: Date | null;
  recurring?: boolean;
}

export interface CampaignPatch {
  name?: string;
  active?: boolean;
  conditions?: CampaignConditions;
  content?: CampaignContent;
  startsAt?: Date | null;
  endsAt?: Date | null;
  recurring?: boolean;
}

export class CampaignService {
  /**
   * Every campaign in the tenant, newest first, optionally narrowed by status
   * (FR-MOD-03.3.1).
   *
   * The status each row reports is re-resolved from its schedule here rather
   * than read off the column, and the filter is applied to that resolved value.
   * Both halves are needed and they are not the same fix: resolving keeps the
   * badge honest, and filtering afterwards is what puts a campaign whose start
   * time has arrived under **Ongoing** instead of leaving it in **Scheduled**.
   * Pushing the filter into SQL — the obvious optimisation — would hand back
   * precisely the rows the stored column mislabels, which is the defect.
   *
   * Reading the whole tenant's campaigns to filter in memory is affordable at
   * the size this table actually reaches: the trigger path measured a
   * 309-campaign workspace at 0.16 ms (tm 176.5), and the console already
   * fetched every row for its tab counts before this change.
   */
  async list(
    tx: TenantClient,
    tenant: TenantContext,
    options: { status: CampaignStatusFilter },
    now: Date = new Date(),
  ): Promise<{ items: Campaign[]; total: number }> {
    const rows = await tx.campaign.findMany({
      where: { licenseId: tenant.licenseId },
      orderBy: { createdAt: 'desc' },
      include: CAMPAIGN_INCLUDE,
    });
    const resolved = rows.map((row) => ({ row, status: resolveCampaignStatus(row, now) }));

    await this.#healStatuses(tx, tenant, resolved);

    const items = resolved
      .filter(({ status }) => options.status === 'all' || status === options.status)
      .map(({ row, status }) => this.#toDto(row, status));
    return { items, total: items.length };
  }

  /**
   * Write back the statuses this read found to be stale (tm 176.6).
   *
   * A write on a read path, deliberately. The response above is already correct
   * without it — it is built from the resolved value, never from the column —
   * so this exists for every *other* reader of `campaigns.status`: the
   * index-served `status IN (ongoing, scheduled)` filter on the visit-time
   * trigger path, a support query, the next feature. Leaving the column stale
   * would mean each of them has to remember to recompute, and forgetting is the
   * bug this task exists to close.
   *
   * Idempotent by compare-and-set: each update carries the status this read
   * saw. Two concurrent readers therefore cannot fight — the second matches no
   * rows and does nothing — and, more importantly, a reader cannot clobber an
   * owner who toggled the campaign in between: their write moves the status off
   * the value in the `where`, so this one silently loses, which is the correct
   * outcome for a housekeeping write racing a deliberate one.
   *
   * Nothing is written in the steady state: the first read that notices a
   * transition fixes it, and every read after that finds the column already
   * right. Ids are sorted so two of these statements always take row locks in
   * the same order.
   *
   * Not gated on the licence being writable. An expired trial is read-only for
   * the *owner's* changes (ADR-10); the fact that a campaign's start date has
   * passed is not a change anybody made, and refusing to record it would leave
   * the workspace looking at wrong labels for as long as the trial stays
   * expired. `GET` is outside the read-only gate for the same reason.
   */
  async #healStatuses(
    tx: TenantClient,
    tenant: TenantContext,
    resolved: ReadonlyArray<{ row: CampaignRow; status: CampaignStatus }>,
  ): Promise<void> {
    // Grouped by the transition, so a page of drifted campaigns costs one
    // statement per distinct (from → to) pair rather than one per row.
    const transitions = new Map<string, { from: string; to: CampaignStatus; ids: string[] }>();
    for (const { row, status } of resolved) {
      if (row.status === status) continue;
      const key = `${row.status}>${status}`;
      const group = transitions.get(key) ?? { from: row.status, to: status, ids: [] };
      group.ids.push(row.id);
      transitions.set(key, group);
    }

    for (const { from, to, ids } of transitions.values()) {
      await tx.campaign.updateMany({
        where: { licenseId: tenant.licenseId, id: { in: ids.sort() }, status: from },
        data: { status: to },
      });
    }
  }

  /**
   * Create a campaign and, if it is running now, fire it at the matching live
   * visitors. Trigger and message are both required (FR-MOD-03.3.2): a campaign
   * that could not target or say anything is rejected rather than saved inert.
   */
  async create(
    tx: TenantClient,
    tenant: TenantContext,
    input: CampaignInput,
    now: Date = new Date(),
  ): Promise<{ campaign: Campaign; sent: number }> {
    const name = input.name.trim();
    if (!name) throw ApiError.validation('name: a campaign needs a name.');
    if (!hasTrigger(input.conditions)) {
      throw ApiError.validation('conditions: a campaign needs a trigger.');
    }
    const message = input.content.message?.trim();
    if (!message) throw ApiError.validation('content: a campaign needs a message.');

    const startsAt = input.startsAt ?? null;
    const endsAt = input.endsAt ?? null;
    this.#assertWindow(startsAt, endsAt);

    const status = computeCampaignStatus({ active: input.active ?? true, startsAt, endsAt }, now);
    const created = await tx.campaign.create({
      data: {
        licenseId: tenant.licenseId,
        name,
        status,
        conditions: input.conditions as Prisma.InputJsonValue,
        content: { message } satisfies CampaignContent as Prisma.InputJsonValue,
        startsAt,
        endsAt,
        recurring: input.recurring ?? false,
      },
      select: { id: true },
    });

    const sent = await this.#fireIfRunning(tx, tenant, created.id, input.conditions, status, now);
    return { campaign: await this.#reload(tx, tenant, created.id), sent };
  }

  /**
   * Edit a campaign or toggle it active (FR-MOD-03.3.3). Only the keys supplied
   * change. Activating one that is running fires it at matching visitors, exactly
   * as create does; the unique (campaign, customer) pair makes that idempotent,
   * so an edit-and-save never double-sends to someone already reached.
   */
  async update(
    tx: TenantClient,
    tenant: TenantContext,
    id: string,
    patch: CampaignPatch,
    now: Date = new Date(),
  ): Promise<{ campaign: Campaign; sent: number }> {
    const existing = await tx.campaign.findFirst({
      where: { id, licenseId: tenant.licenseId },
      select: { status: true, conditions: true, content: true, startsAt: true, endsAt: true },
    });
    if (!existing) throw ApiError.notFound('Campaign not found.');

    // An edit that does not touch the toggle keeps the intent already stored.
    // Derived rather than read as `status !== 'inactive'`, because since tm
    // 176.6 a read heals a finished campaign's column to `inactive` — under the
    // simpler reading, extending its end date would then derive "off" and the
    // edit would save nothing. `deriveActiveIntent` documents that inference and
    // what it costs.
    const resultingActive =
      patch.active ?? deriveActiveIntent({ status: existing.status, endsAt: existing.endsAt }, now);
    const startsAt = patch.startsAt !== undefined ? patch.startsAt : existing.startsAt;
    const endsAt = patch.endsAt !== undefined ? patch.endsAt : existing.endsAt;
    this.#assertWindow(startsAt, endsAt);

    const resultingConditions = (patch.conditions ??
      (existing.conditions as CampaignConditions)) as CampaignConditions;
    const resultingMessage =
      patch.content?.message !== undefined
        ? patch.content.message?.trim()
        : (existing.content as CampaignContent | null)?.message;

    // A campaign that stays (or becomes) active must still be able to target and
    // speak — an edit cannot strip that out from under a running campaign.
    if (resultingActive) {
      if (!hasTrigger(resultingConditions)) {
        throw ApiError.validation('conditions: an active campaign needs a trigger.');
      }
      if (!resultingMessage) {
        throw ApiError.validation('content: an active campaign needs a message.');
      }
    }

    const status = computeCampaignStatus({ active: resultingActive, startsAt, endsAt }, now);
    const data: Prisma.CampaignUpdateInput = { status };
    if (patch.name !== undefined) {
      const name = patch.name.trim();
      if (!name) throw ApiError.validation('name: a campaign needs a name.');
      data.name = name;
    }
    if (patch.conditions !== undefined) data.conditions = patch.conditions as Prisma.InputJsonValue;
    if (patch.content !== undefined) {
      data.content = {
        message: resultingMessage,
      } satisfies CampaignContent as Prisma.InputJsonValue;
    }
    if (patch.startsAt !== undefined) data.startsAt = patch.startsAt;
    if (patch.endsAt !== undefined) data.endsAt = patch.endsAt;
    if (patch.recurring !== undefined) data.recurring = patch.recurring;

    await tx.campaign.update({ where: { id }, data });

    const sent = await this.#fireIfRunning(tx, tenant, id, resultingConditions, status, now);
    return { campaign: await this.#reload(tx, tenant, id), sent };
  }

  /** A closed schedule window (`ends_at <= starts_at`) is a 400, not a DB 500. */
  #assertWindow(startsAt: Date | null, endsAt: Date | null): void {
    if (startsAt && endsAt && endsAt.getTime() <= startsAt.getTime()) {
      throw ApiError.validation('ends_at: must be after starts_at.');
    }
  }

  /**
   * The trigger engine (FR-MOD-03.3.2). Only fires while the campaign is actually
   * running; a scheduled or inactive one records nothing. Returns how many fresh
   * sends were written.
   */
  async #fireIfRunning(
    tx: TenantClient,
    tenant: TenantContext,
    campaignId: string,
    conditions: CampaignConditions,
    status: CampaignStatus,
    now: Date,
  ): Promise<number> {
    if (status !== 'ongoing') return 0;

    const liveSince = new Date(now.getTime() - LIVE_WINDOW_MINUTES * 60_000);
    // Live visitors: recent visits in this tenant. The org filter mirrors the
    // traffic board and, with RLS on `license_id`, is what makes cross-tenant
    // firing impossible.
    const visits = await tx.visit.findMany({
      where: {
        licenseId: tenant.licenseId,
        startedAt: { gte: liveSince },
        customer: { organizationId: tenant.organizationId },
      },
      orderBy: { startedAt: 'desc' },
      select: { customerId: true, pages: true },
    });

    // One evaluation per customer — the newest visit wins, matching the board.
    const seen = new Set<string>();
    const matched: string[] = [];
    for (const visit of visits) {
      if (seen.has(visit.customerId)) continue;
      seen.add(visit.customerId);
      if (matchesConditions(conditions, visitorPageUrls(visit.pages))) {
        matched.push(visit.customerId);
      }
    }
    if (matched.length === 0) return 0;

    const result = await tx.campaignSend.createMany({
      data: matched.map((customerId) => ({
        licenseId: tenant.licenseId,
        campaignId,
        customerId,
      })),
      // A re-fire (activate, or edit-and-save) must not send twice to the same
      // visitor; the unique (campaign, customer) pair turns that into a no-op.
      skipDuplicates: true,
    });
    return result.count;
  }

  async #reload(tx: TenantClient, tenant: TenantContext, id: string): Promise<Campaign> {
    const row = await tx.campaign.findFirst({
      where: { id, licenseId: tenant.licenseId },
      include: CAMPAIGN_INCLUDE,
    });
    if (!row) throw ApiError.notFound('Campaign not found.');
    return this.#toDto(row);
  }

  /**
   * `status` is passed in rather than taken from the row so the list can report
   * what it resolved even if the healing write lost a race — the answer the
   * caller gets never depends on a housekeeping statement having landed. The
   * write paths pass nothing: they reloaded the row they had just written.
   */
  #toDto(row: CampaignRow, status: CampaignStatus = row.status as CampaignStatus): Campaign {
    return {
      id: row.id,
      name: row.name,
      status,
      conditions: (row.conditions ?? {}) as CampaignConditions,
      content: (row.content ?? {}) as CampaignContent,
      starts_at: row.startsAt ? row.startsAt.toISOString() : null,
      ends_at: row.endsAt ? row.endsAt.toISOString() : null,
      recurring: row.recurring,
      created_at: row.createdAt.toISOString(),
      performance: campaignPerformance(row.sends),
    };
  }
}
