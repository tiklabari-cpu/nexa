/**
 * The SLA sweep (FR-MOD-11.5 · 11.5-d): mark what is late *now*, and tell
 * someone.
 *
 * Requests can only judge a clock that stopped — an agent replied, a case was
 * closed. The clock that matters most is the one still running: a customer who
 * has been waiting two hours for a first reply is the breach an admin would
 * want to hear about, and no request will ever be made to notice it. That is
 * this job.
 *
 * Like the retention and chat-timeout sweeps there is no production scheduler
 * in this environment (a project boundary), so this is a script an operator (or
 * a host cron) runs. It reuses the same two guards:
 *
 *   1. **RLS is the cross-tenant guard.** Every read and every mark runs inside
 *      `withTenant`, so one workspace's sweep can neither see nor mark
 *      another's cases. The tenant list comes from the one SECURITY DEFINER
 *      enumerator, `retention_list_tenants()`, shared rather than duplicated.
 *   2. **The policy is the not-yet-late guard.** A workspace with no effective
 *      policy is skipped entirely — including one that has downgraded, because
 *      `readClock` applies the `sla` entitlement. Gating only the settings
 *      write would leave a downgraded workspace being measured and e-mailed
 *      about targets it no longer pays for, which is the same shape of leak
 *      `11.5-b` found in the SIEM sink.
 *
 * Idempotent by construction: a breach already marked is a duplicate the unique
 * key drops, and a notification already sent has a `notified_at`. Running it
 * twice in a row does nothing the second time.
 *
 * ## Why the candidate query is calendar time
 *
 * With business hours on, a case is late when its *open* minutes exceed the
 * target — which is never more than its calendar minutes. So "calendar elapsed
 * ≥ target" is a necessary condition, and the database can use it to hand back
 * a small set that JavaScript then judges properly. The alternative, teaching
 * SQL the workspace's rota, would put the calendar in two places.
 */
import { type PrismaClient } from '@prisma/client';
import type { SlaSubjectType, SlaTarget } from '@nexa/types';
import { type TenantContext, withTenant } from '../../lib/tenant.js';
import type { Mailer } from '../mail/mailer.js';
import { evaluate, readClock, type SlaClock } from './sla-service.js';

export interface TenantSweepResult {
  /** Stringified: a bigint cannot be JSON-serialised, and this report is JSON. */
  licenseId: string;
  organizationId: string;
  /** False when the workspace has no targets, or no longer holds `sla`. */
  measured: boolean;
  /** Breaches this pass was the first to notice. */
  marked: number;
  /** Breaches announced this pass, marked here or by an earlier request. */
  notified: number;
}

export interface SlaSweepReport {
  startedAt: string;
  finishedAt: string;
  tenants: TenantSweepResult[];
  totals: { tenants: number; marked: number; notified: number };
}

interface TenantRow {
  license_id: bigint;
  organization_id: string;
}

/** A case whose clock is still running, with everything needed to judge it. */
interface Candidate {
  subjectType: SlaSubjectType;
  subjectId: string;
  target: SlaTarget;
  startedAt: Date;
}

/**
 * How many pending breaches a single notification names before it stops listing
 * them and states the count instead.
 *
 * A workspace that has been down for a day can produce hundreds, and a mail
 * body listing every one is unreadable and unbounded. Truncating is honest as
 * long as the total is stated — which it is — and the rows themselves are the
 * record; the mail is only the alert.
 */
const NOTIFICATION_DETAIL_LIMIT = 20;

export class SlaSweeper {
  readonly #db: PrismaClient;
  readonly #mailer: Mailer;

  constructor(db: PrismaClient, mailer: Mailer) {
    this.#db = db;
    this.#mailer = mailer;
  }

  async run(options: { now?: Date } = {}): Promise<SlaSweepReport> {
    const now = options.now ?? new Date();
    const startedAt = now.toISOString();

    const results: TenantSweepResult[] = [];
    for (const tenant of await this.#listTenants()) {
      results.push(await this.#sweepTenant(tenant, now));
    }

    return {
      startedAt,
      finishedAt: new Date().toISOString(),
      tenants: results,
      totals: {
        tenants: results.length,
        marked: results.reduce((sum, r) => sum + r.marked, 0),
        notified: results.reduce((sum, r) => sum + r.notified, 0),
      },
    };
  }

  /**
   * Cross-tenant read via the shared SECURITY DEFINER enumerator — the only
   * place the job steps outside a single-tenant context, and it reads nothing
   * but the two ids the loop needs.
   */
  async #listTenants(): Promise<TenantRow[]> {
    return this.#db.$queryRaw<TenantRow[]>`
      SELECT license_id, organization_id FROM retention_list_tenants()`;
  }

  async #sweepTenant(tenant: TenantRow, now: Date): Promise<TenantSweepResult> {
    const context: TenantContext = {
      licenseId: tenant.license_id,
      organizationId: tenant.organization_id,
    };
    const base = {
      licenseId: tenant.license_id.toString(),
      organizationId: tenant.organization_id,
    };

    const clock = await withTenant(this.#db, context, (tx) => readClock(tx, context, now));
    if (!clock) return { ...base, measured: false, marked: 0, notified: 0 };

    const marked = await this.#markOverdue(context, clock, now);
    const notified = await this.#notify(context, now);
    return { ...base, measured: true, marked, notified };
  }

  /** Judge every still-running clock that could possibly be late, and mark the ones that are. */
  async #markOverdue(context: TenantContext, clock: SlaClock, now: Date): Promise<number> {
    const candidates = await this.#candidates(context, clock, now);
    if (candidates.length === 0) return 0;

    return withTenant(this.#db, context, async (tx) => {
      let marked = 0;
      for (const candidate of candidates) {
        const wrote = await evaluate(tx, context, clock, { ...candidate, stoppedAt: now });
        if (wrote) marked += 1;
      }
      return marked;
    });
  }

  /**
   * Cases whose calendar age already reaches the target — the superset business
   * hours can only shrink.
   *
   * Threads are read for both clocks and tickets only for resolution, which is
   * the asymmetry `ticket-service.ts` explains: nothing in this repo records an
   * agent *replying* to a ticket, so a ticket has no first-response clock to
   * run. Merged tickets are excluded for the same reason they never appear in a
   * list — they stopped being separate work.
   */
  async #candidates(context: TenantContext, clock: SlaClock, now: Date): Promise<Candidate[]> {
    const { firstResponseMinutes, resolutionMinutes } = clock.policy;

    return withTenant(this.#db, context, async (tx) => {
      const found: Candidate[] = [];

      if (firstResponseMinutes !== null) {
        const cutoff = new Date(now.getTime() - firstResponseMinutes * 60_000);
        const rows = await tx.thread.findMany({
          where: { active: true, firstResponseAt: null, createdAt: { lt: cutoff } },
          select: { id: true, createdAt: true },
        });
        for (const row of rows) {
          found.push({
            subjectType: 'thread',
            subjectId: row.id,
            target: 'first_response',
            startedAt: row.createdAt,
          });
        }
      }

      if (resolutionMinutes !== null) {
        const cutoff = new Date(now.getTime() - resolutionMinutes * 60_000);
        const threads = await tx.thread.findMany({
          where: { active: true, createdAt: { lt: cutoff } },
          select: { id: true, createdAt: true },
        });
        for (const row of threads) {
          found.push({
            subjectType: 'thread',
            subjectId: row.id,
            target: 'resolution',
            startedAt: row.createdAt,
          });
        }

        const tickets = await tx.ticket.findMany({
          where: {
            status: { in: ['open', 'pending'] },
            mergedIntoId: null,
            createdAt: { lt: cutoff },
          },
          select: { id: true, createdAt: true },
        });
        for (const row of tickets) {
          found.push({
            subjectType: 'ticket',
            subjectId: row.id,
            target: 'resolution',
            startedAt: row.createdAt,
          });
        }
      }

      return found;
    });
  }

  /**
   * Announce every breach that has not been announced, whoever marked it.
   *
   * One message per tenant per pass rather than one per breach: an outage
   * produces hundreds at once, and a mailbox with hundreds of near-identical
   * alerts is a mailbox nobody reads. `notified_at` is stamped *after* the send
   * succeeds — a crash between the two re-sends an alert on the next pass,
   * which is the harmless direction; the other order loses it silently.
   */
  async #notify(context: TenantContext, now: Date): Promise<number> {
    const pending = await withTenant(this.#db, context, (tx) =>
      tx.slaBreach.findMany({
        where: { notifiedAt: null },
        orderBy: { detectedAt: 'asc' },
        select: {
          id: true,
          subjectType: true,
          subjectId: true,
          target: true,
          targetMinutes: true,
          elapsedMinutes: true,
        },
      }),
    );
    if (pending.length === 0) return 0;

    const recipient = await this.#recipient(context);
    // Nobody to tell is not a reason to keep re-finding the same rows every
    // pass; the breaches are recorded either way and Reports (11.5-e) shows
    // them. Marking them announced keeps the sweep's report honest about what
    // is outstanding.
    if (recipient) {
      await this.#mailer.send({
        to: recipient,
        subject: `Nexa: ${pending.length} SLA target${pending.length === 1 ? '' : 's'} missed`,
        body: renderBreachDigest(pending),
        kind: 'notification',
      });
    }

    await withTenant(this.#db, context, (tx) =>
      tx.slaBreach.updateMany({
        where: { id: { in: pending.map((row) => row.id) } },
        data: { notifiedAt: now },
      }),
    );
    return pending.length;
  }

  /**
   * Who hears about it: the workspace owner.
   *
   * Not the assignee. A first-response breach usually has no assignee at all —
   * that *is* the breach — and the two subject types would need two different
   * lookups to find one. The owner is the accountable party for a promise the
   * workspace made, and is guaranteed to exist. A workspace whose owner has
   * opted out of e-mail (`notify_email`) is respected: a per-user channel
   * preference means the same thing here as it does in the inbox.
   */
  async #recipient(context: TenantContext): Promise<string | null> {
    return withTenant(this.#db, context, async (tx) => {
      const membership = await tx.agentMembership.findFirst({
        where: { role: 'owner', suspended: false, notifyEmail: true },
        orderBy: { createdAt: 'asc' },
        select: { agent: { select: { email: true } } },
      });
      return membership?.agent.email ?? null;
    });
  }
}

interface PendingBreach {
  subjectType: string;
  subjectId: string;
  target: string;
  targetMinutes: number;
  elapsedMinutes: number;
}

/** The alert body — plain text, because that is what a mock mailbox is read as. */
export function renderBreachDigest(breaches: readonly PendingBreach[]): string {
  const shown = breaches.slice(0, NOTIFICATION_DETAIL_LIMIT);
  const lines = shown.map(
    (breach) =>
      `- ${breach.subjectType} ${breach.subjectId}: ${label(breach.target)} target ` +
      `${breach.targetMinutes} min, elapsed ${breach.elapsedMinutes} min`,
  );
  if (breaches.length > shown.length) {
    lines.push(`- ...and ${breaches.length - shown.length} more`);
  }
  return [
    `${breaches.length} SLA target${breaches.length === 1 ? ' was' : 's were'} missed:`,
    '',
    ...lines,
    '',
    'Nexa measures and marks SLA targets; it does not re-route or re-prioritise',
    'the conversations behind them.',
  ].join('\n');
}

function label(target: string): string {
  return target === 'first_response' ? 'first response' : 'resolution';
}
