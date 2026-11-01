/**
 * The summary-e-mail sweep (RP-05 · tm 372): at 08:00 company time, mail each
 * member who has the daily summary on yesterday's figures — and on Mondays the
 * weekly one last week's — exactly once.
 *
 * It rides the `scheduled_reports` job (one extra step after the reports, same
 * minute-long interval) rather than adding a job name: the lock, the `/health`
 * row and the `SCHEDULE_*` key of a job are a contract three other things are
 * written against, and "mail the figures that are due" is the same job as
 * "mail the scheduled report that is due".
 *
 * Idempotency is the scheduled-report sweeper's, per member instead of per
 * definition:
 *
 *   1. **The period is deterministic** — `dueDigestPeriod` derives the key
 *      from the covered local day (or week), never from the moment of the run.
 *   2. **The claim precedes the side effect.** A `digest_deliveries` row is
 *      INSERTed before anything is computed or mailed; `UNIQUE (license_id,
 *      agent_id, period_key)` turns two sweeps — a retry, an overlapping run,
 *      two instances — into one winner and a P2002 for the other, which skips
 *      silently. The claim commits on its own: one that rolled back with a
 *      failed delivery would release the period and mail it twice.
 *   3. **RLS is the cross-tenant guard.** Every read and write runs in
 *      `withTenant`; the tenant list is the shared SECURITY DEFINER enumerator.
 *
 * A failed delivery keeps its row as `failed` (the period is consumed, not
 * retried — a mail that "failed" may have arrived). The one refusal that is
 * not a failure is the workspace's daily mail cap: nothing went out, so the row
 * is marked `DIGEST_CAP_DEFERRED` and the next sweep takes it back while the
 * summary is still due.
 *
 * **Who gets what.** A member is a recipient when their switch is on (their
 * own, or their role's workspace default), their e-mail channel is on
 * (`notify_email`: a summary is mail, and "no e-mail" means none), they are
 * neither suspended nor awaiting approval, and they joined before the summary
 * was due. What they receive follows their report reach (RL-02 `reports.view`):
 * `all` the workspace's figures, `team` the figures of the teams they lead (a
 * lead of no team gets nothing, not the workspace), `none` nothing. The figures
 * are computed once per distinct reach — the workspace once, each distinct set
 * of led teams once — and handed to every recipient of that reach.
 */
import { Prisma, type PrismaClient } from '@prisma/client';
import {
  capabilitiesForRole,
  effectiveDigestSwitch,
  type DigestFrequency,
  type CapabilityValue,
} from '@siyahtus/types';
import { type TenantContext, withTenant, withTenantRead } from '../../lib/tenant.js';
import { readPermissionMatrix } from '../auth/permission-matrix.js';
import { deliver, isCapRefusal } from '../mail/delivery.js';
import type { Mailer } from '../mail/mailer.js';
import { isMailLocale, type MailLocale } from '../mail/templates/layout.js';
import { digestMail } from '../mail/templates/messages.js';
import type { ThreadFilter } from '../reports/report-filter.js';
import { readDigestRoles, type DigestRoles } from './digest-settings.js';
import { digestComparison, type DigestComparison } from './digest-figures.js';
import { dueDigestPeriod, type DigestPeriod } from './digest-period.js';

/** How much of a failure's message is kept on the row (the history reads it back). */
const ERROR_MAX_LENGTH = 500;

/** At most this many team ids ride in the Reports link. */
const LINK_TEAMS_MAX = 20;

/**
 * The error a delivery carries while the workspace's daily mail cap holds it
 * back: nothing went out, so the next sweep re-claims the period. The text is the
 * marker; it must not change.
 */
export const DIGEST_CAP_DEFERRED =
  "Today's email limit was reached before this summary went out; the next sweep sends it.";

export interface DigestDeliveryResult {
  /** The recipient's account id — never an address. */
  agentId: string;
  frequency: DigestFrequency;
  periodKey: string;
  /** `skipped` never reaches the table: the period was already taken. */
  status: 'delivered' | 'skipped' | 'failed' | 'deferred';
  error: string | null;
}

export interface TenantDigestResult {
  licenseId: string;
  deliveries: DigestDeliveryResult[];
  delivered: number;
  skipped: number;
  failed: number;
  deferred: number;
}

export interface DigestSweepReport {
  startedAt: string;
  finishedAt: string;
  tenants: TenantDigestResult[];
  totals: { tenants: number; delivered: number; skipped: number; failed: number; deferred: number };
}

interface TenantRow {
  license_id: bigint;
  organization_id: string;
}

/** One member who might receive a summary, as the sweep reads them. */
interface Candidate {
  agentId: string;
  email: string;
  role: string;
  locale: MailLocale;
  createdAt: Date;
  /** The member's reach, once resolved: `null` = the workspace, else the teams they lead. */
  teams: bigint[] | null;
}

/** What one tenant's sweep reads once, for every frequency. */
interface TenantContextData {
  workspaceName: string;
  timeZone: string;
  digestRoles: DigestRoles;
  members: Array<{
    agentId: string;
    email: string;
    role: string;
    locale: string | null;
    createdAt: Date;
    notifyDigestDaily: boolean | null;
    notifyDigestWeekly: boolean | null;
  }>;
  reportsView: Map<string, CapabilityValue>;
  ledTeams: Map<string, bigint[]>;
}

export class DigestSweeper {
  readonly #db: PrismaClient;
  readonly #readDb: PrismaClient;
  readonly #mailer: Mailer;
  readonly #appUrl: string | undefined;

  /**
   * `readDb` is the read path (M-SCALE-c) the figures are computed on — the
   * replica when one is configured. The claim and its resolution stay on `db`:
   * the point of INSERTing the row first is that the database serialises the
   * race, and a claim read back from a lagging replica could let two sweeps
   * both believe they won.
   */
  constructor(
    db: PrismaClient,
    mailer: Mailer,
    options: { readDb?: PrismaClient; appUrl?: string } = {},
  ) {
    this.#db = db;
    this.#readDb = options.readDb ?? db;
    this.#mailer = mailer;
    this.#appUrl = options.appUrl;
  }

  /** `now` is injected so a test can sweep the same instant twice and prove the second pass sends nothing. */
  async run(options: { now?: Date } = {}): Promise<DigestSweepReport> {
    const now = options.now ?? new Date();
    const startedAt = now.toISOString();
    const tenants = await this.#listTenants();
    const results: TenantDigestResult[] = [];
    for (const tenant of tenants) {
      results.push(await this.#sweepTenant(tenant, now));
    }
    const sum = (key: 'delivered' | 'skipped' | 'failed' | 'deferred'): number =>
      results.reduce((total, r) => total + r[key], 0);
    return {
      startedAt,
      finishedAt: new Date().toISOString(),
      tenants: results,
      totals: {
        tenants: results.length,
        delivered: sum('delivered'),
        skipped: sum('skipped'),
        failed: sum('failed'),
        deferred: sum('deferred'),
      },
    };
  }

  async #listTenants(): Promise<TenantRow[]> {
    return this.#db.$queryRaw<TenantRow[]>`
      SELECT license_id, organization_id FROM retention_list_tenants()`;
  }

  async #sweepTenant(tenant: TenantRow, now: Date): Promise<TenantDigestResult> {
    const context: TenantContext = {
      licenseId: tenant.license_id,
      organizationId: tenant.organization_id,
    };
    const deliveries: DigestDeliveryResult[] = [];

    // Cheap first: a minute-long sweep must cost little once everything is out.
    // Which frequencies are due at all in this workspace's clock?
    const data = await this.#readTenant(context);
    for (const frequency of ['daily', 'weekly'] as const) {
      const period = dueDigestPeriod(frequency, now, data.timeZone);
      if (period === null) continue;
      deliveries.push(...(await this.#sweepFrequency(context, data, period)));
    }

    const count = (status: DigestDeliveryResult['status']): number =>
      deliveries.filter((d) => d.status === status).length;
    return {
      licenseId: tenant.license_id.toString(),
      deliveries,
      delivered: count('delivered'),
      skipped: count('skipped'),
      failed: count('failed'),
      deferred: count('deferred'),
    };
  }

  /** Everything about the tenant the frequencies share, read once. */
  async #readTenant(context: TenantContext): Promise<TenantContextData> {
    return withTenantRead(this.#readDb, context, async (tx) => {
      const organization = await tx.organization.findUnique({
        where: { id: context.organizationId },
        select: { name: true, timezone: true },
      });
      const digestRoles = await readDigestRoles(tx, context.licenseId);
      const members = await tx.agentMembership.findMany({
        where: {
          licenseId: context.licenseId,
          suspended: false,
          awaitingApproval: false,
          // A summary is mail: a member who switched e-mail off gets none.
          notifyEmail: true,
        },
        select: {
          agentId: true,
          role: true,
          locale: true,
          createdAt: true,
          notifyDigestDaily: true,
          notifyDigestWeekly: true,
          agent: { select: { email: true } },
        },
        orderBy: { agentId: 'asc' },
      });
      const matrix = await readPermissionMatrix(tx, context.licenseId);
      const reportsView = new Map<string, CapabilityValue>();
      for (const role of new Set(members.map((m) => m.role))) {
        reportsView.set(role, capabilitiesForRole(role, matrix.overrides)['reports.view']);
      }
      const leaders = await tx.groupAgent.findMany({
        where: { licenseId: context.licenseId, isLead: true },
        select: { agentId: true, groupId: true },
        orderBy: [{ agentId: 'asc' }, { groupId: 'asc' }],
      });
      const ledTeams = new Map<string, bigint[]>();
      for (const row of leaders) {
        ledTeams.set(row.agentId, [...(ledTeams.get(row.agentId) ?? []), row.groupId]);
      }
      return {
        workspaceName: organization?.name ?? 'SiyahTuş',
        timeZone: organization?.timezone ?? 'UTC',
        digestRoles,
        members: members.map((m) => ({
          agentId: m.agentId,
          email: m.agent.email,
          role: m.role,
          locale: m.locale,
          createdAt: m.createdAt,
          notifyDigestDaily: m.notifyDigestDaily,
          notifyDigestWeekly: m.notifyDigestWeekly,
        })),
        reportsView,
        ledTeams,
      };
    });
  }

  /** The members this summary is due for: switch on, reach known, joined in time. */
  #candidates(data: TenantContextData, period: DigestPeriod): Candidate[] {
    const out: Candidate[] = [];
    for (const member of data.members) {
      const own =
        period.frequency === 'daily' ? member.notifyDigestDaily : member.notifyDigestWeekly;
      if (!effectiveDigestSwitch(own, member.role, period.frequency, data.digestRoles)) continue;
      // A summary for a period that was over before they joined is not theirs.
      if (member.createdAt.getTime() > period.dueAt.getTime()) continue;
      const view = data.reportsView.get(member.role) ?? 'none';
      let teams: bigint[] | null;
      if (view === 'all') {
        teams = null;
      } else if (view === 'team') {
        teams = data.ledTeams.get(member.agentId) ?? [];
        // A lead of no team has no figures to read: nothing, never the workspace.
        if (teams.length === 0) continue;
      } else {
        continue;
      }
      out.push({
        agentId: member.agentId,
        email: member.email,
        role: member.role,
        locale: isMailLocale(member.locale) ? member.locale : 'en',
        createdAt: member.createdAt,
        teams,
      });
    }
    return out;
  }

  async #sweepFrequency(
    context: TenantContext,
    data: TenantContextData,
    period: DigestPeriod,
  ): Promise<DigestDeliveryResult[]> {
    const candidates = this.#candidates(data, period);
    if (candidates.length === 0) return [];

    // Rows already taken are not candidates — this is what keeps the per-minute
    // sweep cheap. The INSERT below is still the guard; this is only a filter.
    const taken = await withTenantRead(this.#readDb, context, (tx) =>
      tx.digestDelivery.findMany({
        where: {
          licenseId: context.licenseId,
          periodKey: period.periodKey,
          agentId: { in: candidates.map((c) => c.agentId) },
        },
        select: { agentId: true, status: true, error: true },
      }),
    );
    const settled = new Set(
      taken.filter((row) => !(row.status === 'failed' && row.error === DIGEST_CAP_DEFERRED)),
    );
    const settledAgents = new Set([...settled].map((row) => row.agentId));

    const results: DigestDeliveryResult[] = [];
    const claimed: Array<{ candidate: Candidate; deliveryId: string }> = [];
    for (const candidate of candidates) {
      const base = {
        agentId: candidate.agentId,
        frequency: period.frequency,
        periodKey: period.periodKey,
      };
      if (settledAgents.has(candidate.agentId)) continue;
      const deliveryId = await this.#claim(context, candidate.agentId, period);
      if (deliveryId === null) {
        results.push({ ...base, status: 'skipped', error: null });
      } else {
        claimed.push({ candidate, deliveryId });
      }
    }
    if (claimed.length === 0) return results;

    // The figures, once per distinct reach — the workspace once, each distinct
    // set of led teams once — over the winners only.
    const figuresByReach = new Map<string, DigestComparison | Error>();
    for (const { candidate } of claimed) {
      const key = reachKey(candidate.teams);
      if (figuresByReach.has(key)) continue;
      try {
        figuresByReach.set(key, await this.#figures(context, period, candidate.teams));
      } catch (error) {
        figuresByReach.set(key, error instanceof Error ? error : new Error(String(error)));
      }
    }

    let capped = false;
    for (const { candidate, deliveryId } of claimed) {
      const base = {
        agentId: candidate.agentId,
        frequency: period.frequency,
        periodKey: period.periodKey,
      };
      if (capped) {
        // The cap answered for the workspace: every later send would be refused too.
        await this.#resolve(context, deliveryId, { status: 'failed', error: DIGEST_CAP_DEFERRED });
        results.push({ ...base, status: 'deferred', error: DIGEST_CAP_DEFERRED });
        continue;
      }
      const figures = figuresByReach.get(reachKey(candidate.teams));
      if (figures === undefined || figures instanceof Error) {
        const message = sanitiseError(figures);
        await this.#resolve(context, deliveryId, { status: 'failed', error: message });
        results.push({ ...base, status: 'failed', error: message });
        continue;
      }

      const mail = digestMail(
        { locale: candidate.locale, ...(this.#appUrl ? { appUrl: this.#appUrl } : {}) },
        {
          workspaceName: data.workspaceName,
          frequency: period.frequency,
          periodLabel: period.label,
          scope: candidate.teams === null ? 'workspace' : 'teams',
          current: figures.current,
          previous: figures.previous,
          ...(this.#appUrl ? { reportsUrl: reportsUrl(this.#appUrl, candidate.teams) } : {}),
        },
      );
      const outcome = await deliver(this.#mailer, {
        to: candidate.email,
        licenseId: context.licenseId,
        ...mail,
        kind: 'digest',
      });
      if (outcome.status === 'sent' || outcome.status === 'unconfirmed') {
        // `unconfirmed` may well have arrived and must not be sent again: it is
        // recorded as sent, the consumed period being the safe reading.
        await this.#resolve(context, deliveryId, { status: 'sent', error: null });
        results.push({ ...base, status: 'delivered', error: null });
      } else if (isCapRefusal(outcome)) {
        capped = true;
        await this.#resolve(context, deliveryId, { status: 'failed', error: DIGEST_CAP_DEFERRED });
        results.push({ ...base, status: 'deferred', error: DIGEST_CAP_DEFERRED });
      } else {
        const message = sanitiseError(outcome.error);
        await this.#resolve(context, deliveryId, { status: 'failed', error: message });
        results.push({ ...base, status: 'failed', error: message });
      }
    }
    return results;
  }

  /** The period and the one before it, under the reach's report filter. */
  async #figures(
    context: TenantContext,
    period: DigestPeriod,
    teams: bigint[] | null,
  ): Promise<DigestComparison> {
    const filter: ThreadFilter | null = teams === null ? null : { groupIds: teams };
    return withTenantRead(this.#readDb, context, (tx) =>
      digestComparison(tx, context.licenseId, period, filter),
    );
  }

  /**
   * Take the period for this member, or discover it is already taken. The INSERT
   * is the test — a find-then-create would let two sweeps both read "no row" and
   * both mail. Commits on its own (see the header). A period the daily cap
   * deferred is taken back by one conditional UPDATE, which the database
   * serialises like the INSERT.
   */
  async #claim(
    context: TenantContext,
    agentId: string,
    period: DigestPeriod,
  ): Promise<string | null> {
    try {
      const row = await withTenant(this.#db, context, (tx) =>
        tx.digestDelivery.create({
          data: {
            licenseId: context.licenseId,
            agentId,
            frequency: period.frequency,
            periodKey: period.periodKey,
            periodFrom: period.from,
            periodTo: period.to,
            status: 'pending',
          },
          select: { id: true },
        }),
      );
      return row.id;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return this.#reclaimDeferred(context, agentId, period);
      }
      throw error;
    }
  }

  async #reclaimDeferred(
    context: TenantContext,
    agentId: string,
    period: DigestPeriod,
  ): Promise<string | null> {
    return withTenant(this.#db, context, async (tx) => {
      const { count } = await tx.digestDelivery.updateMany({
        where: {
          licenseId: context.licenseId,
          agentId,
          periodKey: period.periodKey,
          status: 'failed',
          error: DIGEST_CAP_DEFERRED,
        },
        data: { status: 'pending', error: null },
      });
      if (count === 0) return null;
      const row = await tx.digestDelivery.findUnique({
        where: {
          licenseId_agentId_periodKey: {
            licenseId: context.licenseId,
            agentId,
            periodKey: period.periodKey,
          },
        },
        select: { id: true },
      });
      return row?.id ?? null;
    });
  }

  async #resolve(
    context: TenantContext,
    deliveryId: string,
    outcome: { status: 'sent' | 'failed'; error: string | null },
  ): Promise<void> {
    await withTenant(this.#db, context, (tx) =>
      tx.digestDelivery.updateMany({
        where: { id: deliveryId, licenseId: context.licenseId },
        data: {
          status: outcome.status,
          error: outcome.error,
          sentAt: outcome.status === 'sent' ? new Date() : null,
        },
      }),
    );
  }
}

/** A stable key for a reach: the workspace, or the sorted team ids. */
function reachKey(teams: bigint[] | null): string {
  return teams === null ? 'workspace' : [...teams].map(String).sort().join(',');
}

/** The Reports screen; a team lead's link names their teams by id, nothing else. */
function reportsUrl(appUrl: string, teams: bigint[] | null): string {
  const base = `${appUrl.replace(/\/+$/, '')}/app/reports`;
  if (teams === null) return base;
  const query = teams
    .slice(0, LINK_TEAMS_MAX)
    .map((id) => `group_id=${id.toString()}`)
    .join('&');
  return `${base}?${query}`;
}

/** A failure as one bounded line (whitespace collapsed, length capped). */
function sanitiseError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const collapsed = raw.replace(/\s+/g, ' ').trim();
  const message = collapsed === '' ? 'Delivery failed.' : collapsed;
  return message.length > ERROR_MAX_LENGTH ? `${message.slice(0, ERROR_MAX_LENGTH - 1)}…` : message;
}
