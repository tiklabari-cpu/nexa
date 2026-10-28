/**
 * The scheduled AI configuration publication (tm 316.6 · SiyahTuş analysis
 * AI-20-S4 · ADR-14b `docs/adr/ai-config-versioning.md` §2.10 (5)). The
 * scheduler's `ai_scheduled_publish` job.
 *
 * An approval with `publish_at` leaves the version `approved` with its
 * `scheduled_at`; this pass publishes every such version whose time has come,
 * each in a transaction of its own through {@link publishVersion} — the same
 * publication an immediate approval makes, with everything the approval
 * checked checked again at the moment it goes out. One that no longer holds
 * (the approver can no longer publish it, the compliance pack moved on, the
 * base was published over) is rejected with the system's reason and its
 * submitter and approver are mailed; one withdrawn or rejected in the meantime
 * is simply no longer due.
 *
 * Locking, twice over: the scheduler's interval lock keeps two API processes
 * from running the same pass, and the publication itself takes the agent's
 * row `FOR UPDATE` and reads the version's status after it — so a pass that
 * overlaps another (or a person rejecting the version at that moment) finds
 * it published or rejected and leaves it. A version is never published twice.
 *
 * After each commit the publication is announced (`ai_config_published`, the
 * Inbox band and the version bar); the run time needs no announcement — it
 * reads the agent's pointer on every turn (`config-cache.ts`).
 *
 * Like the other sweeps the workspace list comes from
 * `retention_list_tenants()` and every read and write runs inside
 * `withTenant`: one workspace's versions are never seen by another's pass.
 */
import type { AiConfigVersion, PrismaClient } from '@prisma/client';
import { aiConfigVersionLabel } from '@siyahtus/types';
import type { FastifyBaseLogger } from 'fastify';
import { ApiError } from '../../lib/api-error.js';
import { withTenant, type TenantContext } from '../../lib/tenant.js';
import { deliver, isCapRefusal } from '../mail/delivery.js';
import type { Mailer } from '../mail/mailer.js';
import { isMailLocale, type MailLocale } from '../mail/templates/layout.js';
import { aiConfigScheduleRefusedMail } from '../mail/templates/messages.js';
import type { RealtimePublisher } from '../realtime/publisher.js';
import { announceAiConfigPublished } from './config-cache.js';
import { systemConfigAuthor } from './config-history.js';
import { publishVersion, type PublishOutcome, type PublishRefusal } from './config-versions.js';

/** The job's name: the AI-21 record's actor and the scheduler's lock. */
export const AI_SCHEDULED_PUBLISH_JOB = 'ai_scheduled_publish';

export interface TenantScheduledPublishResult {
  licenseId: string;
  /** Approved versions whose time had come when the pass looked. */
  due: number;
  published: number;
  /** Rejected by the system at their time — the approval, the pack or the base. */
  refused: number;
  /** Withdrawn, rejected or published by someone else since the pass looked. */
  skipped: number;
  /** A publication that threw; left `approved` for the next pass. */
  failed: number;
  mailed: number;
}

export interface ScheduledPublishReport {
  startedAt: string;
  finishedAt: string;
  tenants: TenantScheduledPublishResult[];
  totals: {
    tenants: number;
    due: number;
    published: number;
    refused: number;
    skipped: number;
    failed: number;
    mailed: number;
  };
}

interface TenantRow {
  license_id: bigint;
  organization_id: string;
}

export interface ScheduledPublisherOptions {
  auditChainSecret: string;
  /** The Inbox band's push; omitted (tests, a CLI), the publication is seen on the next read. */
  publisher?: RealtimePublisher | null;
  /** For the refusal mail; omitted, nobody is mailed. */
  mailer?: Mailer | null;
  appUrl?: string | null;
  logger?: FastifyBaseLogger;
}

export class ScheduledAiConfigPublisher {
  readonly #db: PrismaClient;
  readonly #options: ScheduledPublisherOptions;

  constructor(db: PrismaClient, options: ScheduledPublisherOptions) {
    this.#db = db;
    this.#options = options;
  }

  async run(options: { now?: Date; signal?: AbortSignal } = {}): Promise<ScheduledPublishReport> {
    const startedAt = new Date().toISOString();
    const tenants = await this.#db.$queryRaw<TenantRow[]>`
      SELECT license_id, organization_id FROM retention_list_tenants()`;
    const results: TenantScheduledPublishResult[] = [];
    for (const tenant of tenants) {
      if (options.signal?.aborted) break;
      const result = await this.#publishTenant(tenant, options.now, options.signal);
      if (result) results.push(result);
    }
    const sum = (pick: (r: TenantScheduledPublishResult) => number) =>
      results.reduce((total, r) => total + pick(r), 0);
    return {
      startedAt,
      finishedAt: new Date().toISOString(),
      tenants: results,
      totals: {
        tenants: tenants.length,
        due: sum((r) => r.due),
        published: sum((r) => r.published),
        refused: sum((r) => r.refused),
        skipped: sum((r) => r.skipped),
        failed: sum((r) => r.failed),
        mailed: sum((r) => r.mailed),
      },
    };
  }

  /** A workspace's due versions, each published in its own transaction; null when none is due. */
  async #publishTenant(
    tenant: TenantRow,
    at: Date | undefined,
    signal: AbortSignal | undefined,
  ): Promise<TenantScheduledPublishResult | null> {
    const context: TenantContext = {
      licenseId: tenant.license_id,
      organizationId: tenant.organization_id,
    };
    const listedAt = at ?? new Date();
    const due = await withTenant(
      this.#db,
      context,
      (tx) =>
        tx.aiConfigVersion.findMany({
          where: { status: 'approved', scheduledAt: { lte: listedAt } },
          orderBy: { scheduledAt: 'asc' },
          select: { id: true },
        }),
      { readOnly: true },
    );
    if (due.length === 0) return null;

    const result: TenantScheduledPublishResult = {
      licenseId: tenant.license_id.toString(),
      due: due.length,
      published: 0,
      refused: 0,
      skipped: 0,
      failed: 0,
      mailed: 0,
    };
    const author = systemConfigAuthor(
      tenant.license_id,
      this.#options.auditChainSecret,
      AI_SCHEDULED_PUBLISH_JOB,
    );
    for (const { id } of due) {
      if (signal?.aborted) break;
      let outcome: PublishOutcome;
      try {
        outcome = await withTenant(this.#db, context, (tx) =>
          publishVersion(tx, author, { versionId: id, now: at ?? new Date() }),
        );
      } catch (error) {
        if (isNoLongerDue(error)) {
          result.skipped += 1;
          continue;
        }
        result.failed += 1;
        this.#options.logger?.warn(
          { err: error, event: 'ai.config_schedule_failed', version_id: id },
          'scheduled AI configuration publication failed; retried next pass',
        );
        continue;
      }
      if (outcome.kind === 'published') {
        result.published += 1;
        if (this.#options.publisher) {
          await announceAiConfigPublished(this.#options.publisher, context, outcome.version);
        }
      } else if (outcome.kind === 'rejected') {
        result.refused += 1;
        result.mailed += await this.#mailRefusal(context, outcome.version, outcome.reason);
      }
    }
    return result;
  }

  /** The submitter and the approver, told why their version did not go out. */
  async #mailRefusal(
    context: TenantContext,
    version: AiConfigVersion,
    reason: PublishRefusal,
  ): Promise<number> {
    const mailer = this.#options.mailer;
    if (!mailer) return 0;
    // The approver is read from the version as it was approved: the refusal
    // left `reviewed_by` as it was.
    const people = [version.submittedBy, version.reviewedBy].filter(
      (id): id is string => id !== null,
    );
    if (people.length === 0) return 0;
    const { recipients, workspaceName, agentName } = await withTenant(
      this.#db,
      context,
      async (tx) => {
        const [members, organization, agent] = await Promise.all([
          tx.agentMembership.findMany({
            where: {
              licenseId: context.licenseId,
              agentId: { in: [...new Set(people)] },
              suspended: false,
              notifyEmail: true,
            },
            select: { locale: true, agent: { select: { email: true } } },
          }),
          tx.organization.findUnique({
            where: { id: context.organizationId },
            select: { name: true },
          }),
          tx.aiAgent.findFirst({ where: { id: version.aiAgentId }, select: { name: true } }),
        ]);
        const recipients: Array<{ email: string; locale: MailLocale }> = [];
        for (const member of members) {
          const email = member.agent.email;
          if (email)
            recipients.push({ email, locale: isMailLocale(member.locale) ? member.locale : 'en' });
        }
        return {
          recipients,
          workspaceName: organization?.name ?? 'SiyahTuş',
          agentName: agent?.name ?? 'AI',
        };
      },
      { readOnly: true },
    );

    const appUrl = this.#options.appUrl ?? null;
    let mailed = 0;
    for (const recipient of recipients) {
      const outcome = await deliver(mailer, {
        to: recipient.email,
        licenseId: context.licenseId,
        ...aiConfigScheduleRefusedMail(
          { locale: recipient.locale, ...(appUrl ? { appUrl } : {}) },
          {
            workspaceName,
            agentName,
            label: aiConfigVersionLabel(version),
            reason,
            versionsUrl: appUrl
              ? `${appUrl}/app/playbook?view=versions&version=${version.id}`
              : null,
          },
        ),
        kind: 'notification',
      });
      if (outcome.status === 'sent') mailed += 1;
      else if (!isCapRefusal(outcome)) {
        this.#options.logger?.warn(
          { event: 'ai.config_schedule_mail_failed', version_id: version.id },
          'scheduled publication refusal mail not sent',
        );
      }
    }
    return mailed;
  }
}

/** `409 not_open`: withdrawn, rejected, published by an overlapping pass, or not yet due. */
function isNoLongerDue(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    ((error.type === 'ai_config_version_state' && error.details?.['reason'] === 'not_open') ||
      error.type === 'not_found')
  );
}
