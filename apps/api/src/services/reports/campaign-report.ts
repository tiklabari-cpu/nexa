/**
 * The campaign report (EN-05 · tm 354): displayed, clicks, chats, conversion and
 * suppressed per campaign and per day, counted from `campaign_sends`.
 *
 * One aggregation behind both surfaces — `GET /reports/campaigns` and the
 * `campaigns` export group — so the screen and the download cannot quote
 * different figures (ADR-09, the rule `report-csv.ts` keeps for every group).
 *
 * Each send belongs to the UTC day it was written, the day the visitor matched,
 * and carries its later outcome with it. A day's row is therefore a cohort, and
 * the funnel inside it is nested the way the campaign card's is
 * (`campaignPerformance`): `chats`, `clicks` and `conversion` are counted among
 * *delivered* sends only, so none of them can exceed `displayed`; `suppressed`
 * is the sends a risk flag held back, which are never delivered.
 *
 * Archived campaigns stay in the numbers — that is the point of archiving
 * rather than deleting. Their rows are listed when they have sends in the
 * window, or when the caller names them.
 */
import { Prisma } from '@prisma/client';
import type {
  CampaignReportCounts,
  CampaignReportDayRow,
  CampaignReportRow,
} from '@siyahtus/types';
import type { TenantClient } from '../../lib/tenant.js';
import type { CsvCell } from '../../routes/reports-export.js';

/** Most campaigns one request may name. */
export const CAMPAIGN_REPORT_FILTER_MAX = 50;

interface DayRaw {
  date: string;
  campaign_id: string;
  displayed: bigint;
  clicks: bigint;
  chats: bigint;
  conversion: bigint;
  suppressed: bigint;
}

function counts(raw: Omit<DayRaw, 'date' | 'campaign_id'>): CampaignReportCounts {
  return {
    displayed: Number(raw.displayed),
    clicks: Number(raw.clicks),
    chats: Number(raw.chats),
    conversion: Number(raw.conversion),
    suppressed: Number(raw.suppressed),
  };
}

function add(total: CampaignReportCounts, row: CampaignReportCounts): void {
  total.displayed += row.displayed;
  total.clicks += row.clicks;
  total.chats += row.chats;
  total.conversion += row.conversion;
  total.suppressed += row.suppressed;
}

function zero(): CampaignReportCounts {
  return { displayed: 0, clicks: 0, chats: 0, conversion: 0, suppressed: 0 };
}

/** The sends in the window grouped by day and campaign, oldest day first. */
async function sendsByDay(
  tx: TenantClient,
  licenseId: bigint,
  from: Date,
  to: Date,
  campaignIds: readonly string[] | undefined,
): Promise<DayRaw[]> {
  // The id filter is a fragment, not a `${...} IS NULL OR` pair: a NULL-typed
  // parameter would make the planner blind to the `(license_id, campaign_id)`
  // index it can otherwise use.
  const only =
    campaignIds && campaignIds.length > 0
      ? Prisma.sql`AND s.campaign_id = ANY(${[...campaignIds]}::uuid[])`
      : Prisma.empty;
  return tx.$queryRaw<DayRaw[]>`
    SELECT to_char(s.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS date,
           s.campaign_id::text AS campaign_id,
           count(*) FILTER (WHERE s.delivered_at IS NOT NULL) AS displayed,
           count(*) FILTER (WHERE s.delivered_at IS NOT NULL AND s.clicked_at IS NOT NULL) AS clicks,
           count(*) FILTER (WHERE s.delivered_at IS NOT NULL AND s.engaged) AS chats,
           count(*) FILTER (WHERE s.delivered_at IS NOT NULL AND s.converted) AS conversion,
           count(*) FILTER (WHERE s.suppressed_at IS NOT NULL) AS suppressed
    FROM campaign_sends s
    WHERE s.license_id = ${licenseId}
      AND s.created_at >= ${from} AND s.created_at <= ${to}
      ${only}
    GROUP BY 1, 2
    ORDER BY 1 ASC, 2 ASC
  `;
}

/** The window's totals alone — what the benchmark block compares against. */
export async function campaignsBenchmark(
  tx: TenantClient,
  licenseId: bigint,
  window: { from: Date; to: Date },
  campaignIds?: readonly string[],
): Promise<Record<string, unknown>> {
  const total = zero();
  for (const row of await sendsByDay(tx, licenseId, window.from, window.to, campaignIds)) {
    add(total, counts(row));
  }
  // Spread: an interface has no index signature, a literal does.
  return { ...total };
}

export async function campaignReport(
  tx: TenantClient,
  licenseId: bigint,
  from: Date,
  to: Date,
  campaignIds?: readonly string[],
): Promise<{
  totals: CampaignReportCounts;
  campaigns: CampaignReportRow[];
  by_day: CampaignReportDayRow[];
}> {
  const filtered = campaignIds !== undefined && campaignIds.length > 0;
  const days = await sendsByDay(tx, licenseId, from, to, campaignIds);

  // Every campaign of the workspace, archived or not: a name is all that is
  // wanted from the archived ones, and a tenant's campaign table is small
  // (the list reads all of it too).
  const campaigns = await tx.campaign.findMany({
    where: {
      licenseId,
      ...(filtered ? { id: { in: [...campaignIds] } } : {}),
    },
    select: { id: true, name: true, archivedAt: true },
  });
  const named = new Map(campaigns.map((campaign) => [campaign.id, campaign]));

  const perCampaign = new Map<string, CampaignReportCounts>();
  const byDay: CampaignReportDayRow[] = [];
  for (const day of days) {
    const campaign = named.get(day.campaign_id);
    // A send of a campaign that is not in scope (cannot happen with RLS and the
    // same filter in both reads) is not reported rather than reported unnamed.
    if (!campaign) continue;
    const figures = counts(day);
    byDay.push({ date: day.date, campaign_id: campaign.id, name: campaign.name, ...figures });
    const sum = perCampaign.get(campaign.id) ?? zero();
    add(sum, figures);
    perCampaign.set(campaign.id, sum);
  }
  byDay.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      a.name.localeCompare(b.name) ||
      a.campaign_id.localeCompare(b.campaign_id),
  );

  const rows: CampaignReportRow[] = [];
  const totals = zero();
  for (const campaign of campaigns) {
    const figures = perCampaign.get(campaign.id);
    // Archived and idle: nothing to say, unless the caller asked for it by id.
    if (!figures && campaign.archivedAt && !filtered) continue;
    const row = figures ?? zero();
    add(totals, row);
    rows.push({
      campaign_id: campaign.id,
      name: campaign.name,
      archived: campaign.archivedAt !== null,
      ...row,
    });
  }
  rows.sort(
    (a, b) =>
      b.displayed - a.displayed ||
      a.name.localeCompare(b.name) ||
      a.campaign_id.localeCompare(b.campaign_id),
  );
  return { totals, campaigns: rows, by_day: byDay };
}

export const CAMPAIGN_CSV_HEADERS = [
  'section',
  'date',
  'campaign_id',
  'name',
  'displayed',
  'clicks',
  'chats',
  'conversion',
  'suppressed',
];

function csvFigures(row: CampaignReportCounts): CsvCell[] {
  return [row.displayed, row.clicks, row.chats, row.conversion, row.suppressed];
}

/**
 * The export table: a `total` row, a `campaign` row per campaign and a `day`
 * row per day and campaign — long format like the Goals export, so the three
 * sections carry the same figures the JSON report's `totals`, `campaigns` and
 * `by_day` do. A campaign's name is user-written free text, the field
 * `toCsv`'s formula-injection guard exists for.
 */
export async function campaignReportCsv(
  tx: TenantClient,
  licenseId: bigint,
  from: Date,
  to: Date,
  campaignIds?: readonly string[],
): Promise<{ headers: string[]; rows: CsvCell[][] }> {
  const report = await campaignReport(tx, licenseId, from, to, campaignIds);
  return {
    headers: CAMPAIGN_CSV_HEADERS,
    rows: [
      ['total', null, null, null, ...csvFigures(report.totals)],
      ...report.campaigns.map((row): CsvCell[] => [
        'campaign',
        null,
        row.campaign_id,
        row.name,
        ...csvFigures(row),
      ]),
      ...report.by_day.map((row): CsvCell[] => [
        'day',
        row.date,
        row.campaign_id,
        row.name,
        ...csvFigures(row),
      ]),
    ],
  };
}
