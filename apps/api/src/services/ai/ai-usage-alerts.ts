/**
 * The AI usage alerts (tm 283.3 · SiyahTuş analysis AI-16, AI-16-S2): tell a
 * workspace's owner, and the recipients the owner chose, when today's AI
 * allowance is 80% used and when it is used up — before the evening the AI
 * goes quiet and nobody knows why.
 *
 * **Exactly once per workspace, UTC day, live meter and threshold.** Every
 * settle and every workspace-scope refusal is reported here by the budget
 * (`AiDailyBudget.observe`); this reads the counter, and for each threshold it
 * has reached it *claims* the notice with one `INSERT … ON CONFLICT DO
 * NOTHING` on `ai_usage_alerts`' unique key. Ten calls crossing 80% at once,
 * on as many API processes, land one row, and only the process that landed it
 * sends. The row is written before the notice goes out, so a notice that
 * fails to send is logged, not sent again: the owner gets at most one.
 *
 * **100% is also the first refusal.** A call reserves its estimate before the
 * provider is asked, so the cap can refuse with the counter a little short of
 * 100%; a refusal is the AI having stopped answering, which is what the 100%
 * notice says. When one observation reaches both thresholds, both are claimed
 * and only the 100% notice is sent — an "80% used" alongside "used up" says
 * nothing.
 *
 * **Live meters only.** A simulation's smaller allowance (`llm_test`,
 * `embedding_test`) running out is the test lab's own 429 (AI-19-S2), not a
 * reason to mail the owner. The deployment's cap is the operator's, and the
 * budget does not report it here at all.
 *
 * **Beside the call, never in its way.** The budget calls this without
 * waiting; the work runs on its own and every failure is logged. `idle()`
 * waits for what is in flight — for a test, and for a server closing.
 *
 * Notified: the workspace's owner, plus each chosen recipient who is still an
 * owner, vice-owner or admin of it and not suspended — the people who may read
 * the usage screen the notice points to. E-mail honours each member's e-mail
 * notification switch (`notify_email`), as the SLA digest does; the in-app
 * notice is a realtime push (`ai_usage_alert`) to the same people, and the
 * claimed row is what the usage screen lists as today's alerts. Numbers only:
 * no conversation, no text anybody wrote.
 */
import type { PrismaClient } from '@prisma/client';
import {
  aiUsageThresholdsReached,
  type AiLiveMeter,
  type AiUsageAlertPush,
  type AiUsageAlertThreshold,
} from '@siyahtus/types';
import { withTenant, type TenantContext } from '../../lib/tenant.js';
import { deliver, isCapRefusal, mailFailureFields } from '../mail/delivery.js';
import type { Mailer } from '../mail/mailer.js';
import { isMailLocale, type MailLocale } from '../mail/templates/layout.js';
import { aiUsageAlertMail } from '../mail/templates/messages.js';
import type { RealtimePublisher } from '../realtime/publisher.js';
import {
  nextUtcMidnight,
  type AiUsageObservation,
  type AiUsageObserver,
} from './ai-daily-budget.js';

declare module 'fastify' {
  interface FastifyInstance {
    /** The server's AI usage alerts — `idle()` for a test that waits for a notice. */
    aiUsageAlerts: AiUsageAlerts;
  }
}

/** The roles that may read the usage screen — and so may receive its alerts. */
export const AI_USAGE_ALERT_ROLES = ['owner', 'viceowner', 'admin'] as const;

export interface AiUsageAlertsLogger {
  info(details: Record<string, unknown>, message: string): void;
  warn(details: Record<string, unknown>, message: string): void;
  error(details: Record<string, unknown>, message: string): void;
}

export interface AiUsageAlertsOptions {
  mailer: Mailer;
  /** The realtime bus; null where nothing listens (a script). */
  publisher: RealtimePublisher | null;
  /** The panel's address (`WEB_APP_URL`), for the link to the usage screen. */
  appUrl: string | null;
  logger: AiUsageAlertsLogger;
}

/** What one observation decided: the thresholds this process claimed, and the notice it sent. */
export interface AiUsageAlertOutcome {
  claimed: AiUsageAlertThreshold[];
  /** The threshold announced (the highest claimed), or null when nothing was claimed. */
  announced: AiUsageAlertThreshold | null;
}

/** Claims remembered per process, so a capped workspace's every message does not write. */
const MAX_REMEMBERED = 10_000;

function isLiveMeter(meter: string): meter is AiLiveMeter {
  return meter === 'llm' || meter === 'embedding';
}

/** `yyyymmdd` → `yyyy-mm-dd`. */
export function isoDay(day: string): string {
  return `${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6, 8)}`;
}

export class AiUsageAlerts implements AiUsageObserver {
  readonly #db: PrismaClient;
  readonly #mailer: Mailer;
  readonly #publisher: RealtimePublisher | null;
  readonly #appUrl: string | null;
  readonly #log: AiUsageAlertsLogger;
  readonly #pending = new Set<Promise<unknown>>();
  /** `license:day:meter:threshold` this process has seen claimed — by itself or another. */
  readonly #known = new Set<string>();

  constructor(db: PrismaClient, options: AiUsageAlertsOptions) {
    this.#db = db;
    this.#mailer = options.mailer;
    this.#publisher = options.publisher;
    this.#appUrl = options.appUrl;
    this.#log = options.logger;
  }

  settled(observation: AiUsageObservation): void {
    this.#track(this.evaluate(observation, false));
  }

  refused(observation: AiUsageObservation): void {
    this.#track(this.evaluate(observation, true));
  }

  /** Wait for every observation in flight. */
  async idle(): Promise<void> {
    while (this.#pending.size > 0) await Promise.allSettled([...this.#pending]);
  }

  /**
   * Decide and send, awaited — what `settled`/`refused` start without waiting.
   * `refused`: the cap turned a call away, which is 100% whatever the counter
   * reads. Never throws.
   */
  async evaluate(observation: AiUsageObservation, refused: boolean): Promise<AiUsageAlertOutcome> {
    const none: AiUsageAlertOutcome = { claimed: [], announced: null };
    const { tenant, meter, day, cap } = observation;
    if (!isLiveMeter(meter)) return none;
    const key = (threshold: number): string => `${tenant.licenseId}:${day}:${meter}:${threshold}`;
    // Nothing left to claim today on this meter — the common case for a
    // workspace that has already been told, and for every refused message after.
    if (this.#known.has(key(100)) && (refused || this.#known.has(key(80)))) return none;

    try {
      const outcome = await withTenant(this.#db, tenant, async (tx) => {
        const row = await tx.aiDailyUsage.findFirst({
          where: { licenseId: tenant.licenseId, day, meter },
          select: { used: true },
        });
        const used = Number(row?.used ?? 0n);
        const reached = new Set<AiUsageAlertThreshold>(aiUsageThresholdsReached(used, cap));
        if (refused) reached.add(100);
        const claimed: AiUsageAlertThreshold[] = [];
        for (const threshold of [...reached].sort((a, b) => a - b)) {
          if (this.#known.has(key(threshold))) continue;
          const landed = await tx.$queryRaw<Array<{ id: string }>>`
            INSERT INTO ai_usage_alerts (id, license_id, day, meter, threshold, used, cap)
            VALUES (gen_random_uuid(), ${tenant.licenseId}, ${day}, ${meter},
                    ${threshold}::smallint, ${BigInt(used)}, ${BigInt(cap)})
            ON CONFLICT (license_id, day, meter, threshold) DO NOTHING
            RETURNING id`;
          if (landed.length > 0) claimed.push(threshold);
        }
        return { used, reached: [...reached], claimed };
      });
      for (const threshold of outcome.reached) this.#remember(key(threshold));
      const announced = outcome.claimed.length > 0 ? Math.max(...outcome.claimed) : null;
      if (announced === 80 || announced === 100) {
        await this.#announce(tenant, {
          meter,
          threshold: announced,
          day: isoDay(day),
          used: outcome.used,
          cap,
        });
      }
      return {
        claimed: outcome.claimed,
        announced: announced === 80 || announced === 100 ? announced : null,
      };
    } catch (error) {
      this.#log.error(
        {
          err: error,
          event: 'ai.usage_alert_failed',
          license_id: tenant.licenseId.toString(),
          meter,
        },
        'AI usage alert could not be decided; the next call tries again',
      );
      return none;
    }
  }

  async #announce(tenant: TenantContext, alert: AiUsageAlertPush): Promise<void> {
    const { recipients, workspaceName } = await this.#recipients(tenant);
    const resetsAt = nextUtcMidnight(new Date(`${alert.day}T00:00:00Z`));
    let mailed = 0;
    for (const recipient of recipients) {
      if (!recipient.notifyEmail || !recipient.email) continue;
      const outcome = await deliver(this.#mailer, {
        to: recipient.email,
        licenseId: tenant.licenseId,
        ...aiUsageAlertMail(
          { locale: recipient.locale, ...(this.#appUrl ? { appUrl: this.#appUrl } : {}) },
          {
            workspaceName,
            meter: alert.meter,
            threshold: alert.threshold,
            used: alert.used,
            cap: alert.cap,
            resetsAt,
            usageUrl: this.#appUrl ? `${this.#appUrl}/app/settings/ai-usage` : null,
          },
        ),
        kind: 'notification',
      });
      if (outcome.status === 'sent') mailed += 1;
      // A cap refusal was logged where it was decided (`mail-caps.ts`).
      else if (!isCapRefusal(outcome)) {
        this.#log.warn(
          {
            event: 'ai.usage_alert_mail',
            license_id: tenant.licenseId.toString(),
            outcome: outcome.status,
            mail: mailFailureFields(outcome.error),
          },
          'AI usage alert e-mail not confirmed as sent',
        );
      }
    }
    if (recipients.length > 0) {
      await this.#publisher?.publish(
        tenant,
        'ai_usage_alert',
        { agentIds: recipients.map((recipient) => recipient.accountId) },
        alert,
      );
    }
    this.#log.info(
      {
        event: 'ai.usage_alert',
        license_id: tenant.licenseId.toString(),
        meter: alert.meter,
        threshold: alert.threshold,
        recipients: recipients.length,
        mailed,
      },
      'AI usage alert sent',
    );
  }

  /** The owner and the chosen recipients still entitled to the usage screen. */
  async #recipients(tenant: TenantContext): Promise<{
    recipients: Array<{
      accountId: string;
      email: string | null;
      locale: MailLocale;
      notifyEmail: boolean;
    }>;
    workspaceName: string;
  }> {
    return withTenant(this.#db, tenant, async (tx) => {
      const chosen = await tx.aiUsageAlertRecipient.findMany({
        where: { licenseId: tenant.licenseId },
        select: { accountId: true },
      });
      const [members, organization] = await Promise.all([
        tx.agentMembership.findMany({
          where: {
            licenseId: tenant.licenseId,
            suspended: false,
            OR: [
              { role: 'owner' },
              {
                role: { in: [...AI_USAGE_ALERT_ROLES] },
                agentId: { in: chosen.map((row) => row.accountId) },
              },
            ],
          },
          orderBy: { createdAt: 'asc' },
          select: {
            agentId: true,
            locale: true,
            notifyEmail: true,
            agent: { select: { email: true } },
          },
        }),
        tx.organization.findUnique({
          where: { id: tenant.organizationId },
          select: { name: true },
        }),
      ]);
      return {
        recipients: members.map((member) => ({
          accountId: member.agentId,
          email: member.agent.email,
          locale: isMailLocale(member.locale) ? member.locale : 'en',
          notifyEmail: member.notifyEmail,
        })),
        workspaceName: organization?.name ?? 'SiyahTuş',
      };
    });
  }

  #remember(key: string): void {
    if (this.#known.size >= MAX_REMEMBERED) this.#known.clear();
    this.#known.add(key);
  }

  #track(work: Promise<unknown>): void {
    this.#pending.add(work);
    void work.finally(() => this.#pending.delete(work));
  }
}
