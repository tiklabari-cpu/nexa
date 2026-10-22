/**
 * What a raised or cleared risk flag sets off once its transaction has
 * committed (tm 302.2 · AI-27, AI-27-S4):
 *
 *   - **a realtime push** (`risk_flag_raised` / `risk_flag_cleared`,
 *     `RiskFlagPush`) to the conversation's members — its teams and the
 *     agents in it — the supervisors (admin and up: the Team Lead and up of
 *     AI-27 until RL-03 bounds a Team Lead to their teams) and, for an urgent flag, the Responsible Gaming team;
 *   - **a webhook delivery** under the same names (`RiskFlagSignal`): the
 *     operator hears at once, and the account is theirs to act on;
 *   - **for an urgent flag raised** — self-harm, a suspected minor, a self-
 *     exclusion request — **a mail** to the supervisors, the Responsible Gaming
 *     team and the addresses the workspace chose (`risk_flag_settings`),
 *     honouring each member's e-mail switch (`notify_email`).
 *
 * None of it carries a word anyone wrote: no note, no evidence, no clear
 * reason, no quote of the player. Beside the request, never in its way: the
 * work runs on its own, every failure is logged, and `idle()` waits for what
 * is in flight — for a test, and for a server closing.
 */
import type { PrismaClient, RiskFlag } from '@prisma/client';
import { withTenant, type TenantContext } from '../../lib/tenant.js';
import { readDayBoundary } from '../chat/day-boundary.js';
import { deliver, isCapRefusal, mailFailureFields } from '../mail/delivery.js';
import type { Mailer } from '../mail/mailer.js';
import { isMailLocale, type MailLocale } from '../mail/templates/layout.js';
import { riskFlagUrgentMail } from '../mail/templates/messages.js';
import type { RealtimePublisher } from '../realtime/publisher.js';
import type { WorkspaceEventDispatcher } from '../webhooks/workspace-events.js';
import { readRiskFlagSettings, riskFlagPush, riskFlagSignal } from './risk-flags.js';

declare module 'fastify' {
  interface FastifyInstance {
    /** The server's risk flag announcer — `idle()` for a test that waits for a notice. */
    riskFlags: RiskFlagAnnouncer;
  }
}

/**
 * The roles that hear of every flag (AI-27's Team Lead and up). Admin and up
 * until RL-03: "every flag" is every team's, and a Team Lead (tm 324.1) sees
 * their own teams' conversations only.
 */
export const RISK_FLAG_SUPERVISOR_ROLES = ['owner', 'viceowner', 'admin'] as const;

export interface RiskFlagAnnouncerLogger {
  info(details: Record<string, unknown>, message: string): void;
  warn(details: Record<string, unknown>, message: string): void;
  error(details: Record<string, unknown>, message: string): void;
}

export interface RiskFlagAnnouncerOptions {
  mailer: Mailer | null;
  /** The realtime bus; null where nothing listens (a script). */
  publisher: RealtimePublisher | null;
  /** The webhook emitter; null where none is wired. */
  automations: WorkspaceEventDispatcher | null;
  /** The panel's address (`WEB_APP_URL`), for the mail's link to the conversation. */
  appUrl: string | null;
  logger: RiskFlagAnnouncerLogger;
}

/** One flag raised or cleared, as its transaction committed it. */
export interface RiskFlagChange {
  readonly kind: 'raised' | 'cleared';
  readonly flag: RiskFlag;
}

interface Audience {
  groupIds: number[];
  agentIds: string[];
}

interface MailRecipient {
  email: string;
  locale: MailLocale;
}

export class RiskFlagAnnouncer {
  readonly #db: PrismaClient;
  readonly #mailer: Mailer | null;
  readonly #publisher: RealtimePublisher | null;
  readonly #automations: WorkspaceEventDispatcher | null;
  readonly #appUrl: string | null;
  readonly #log: RiskFlagAnnouncerLogger;
  readonly #pending = new Set<Promise<unknown>>();

  constructor(db: PrismaClient, options: RiskFlagAnnouncerOptions) {
    this.#db = db;
    this.#mailer = options.mailer;
    this.#publisher = options.publisher;
    this.#automations = options.automations;
    this.#appUrl = options.appUrl;
    this.#log = options.logger;
  }

  /** Announce, without waiting. Never throws. */
  announce(tenant: TenantContext, changes: readonly RiskFlagChange[]): void {
    if (changes.length === 0) return;
    const work = this.announceNow(tenant, changes);
    this.#pending.add(work);
    void work.finally(() => this.#pending.delete(work));
  }

  /** Wait for every announcement in flight. */
  async idle(): Promise<void> {
    while (this.#pending.size > 0) await Promise.allSettled([...this.#pending]);
  }

  /** What `announce` starts, awaited. Never throws. */
  async announceNow(tenant: TenantContext, changes: readonly RiskFlagChange[]): Promise<void> {
    for (const change of changes) {
      try {
        await this.#announceOne(tenant, change);
      } catch (error) {
        this.#log.error(
          {
            err: error,
            event: 'risk_flag.announce_failed',
            license_id: tenant.licenseId.toString(),
            flag_id: change.flag.id,
          },
          'risk flag could not be announced',
        );
      }
    }
  }

  async #announceOne(tenant: TenantContext, change: RiskFlagChange): Promise<void> {
    const { flag, kind } = change;
    const urgent = kind === 'raised' && flag.severity === 'urgent';
    const plan = await withTenant(this.#db, tenant, async (tx) => {
      const settings = await readRiskFlagSettings(tx);
      const chat = flag.chatId
        ? await tx.chat.findUnique({
            where: { id: flag.chatId },
            select: {
              access: { select: { groupId: true } },
              users: { where: { userType: 'agent' }, select: { userId: true } },
            },
          })
        : null;
      const supervisors = await tx.agentMembership.findMany({
        where: {
          licenseId: tenant.licenseId,
          suspended: false,
          role: { in: [...RISK_FLAG_SUPERVISOR_ROLES] },
        },
        orderBy: { createdAt: 'asc' },
        select: {
          agentId: true,
          locale: true,
          notifyEmail: true,
          agent: { select: { email: true } },
        },
      });
      const team =
        urgent && settings.rgGroupId !== null
          ? await tx.agentMembership.findMany({
              where: {
                licenseId: tenant.licenseId,
                suspended: false,
                agent: { groupMemberships: { some: { groupId: settings.rgGroupId } } },
              },
              orderBy: { createdAt: 'asc' },
              select: {
                agentId: true,
                locale: true,
                notifyEmail: true,
                agent: { select: { email: true } },
              },
            })
          : [];
      const audience: Audience = {
        groupIds: [
          ...new Set([
            ...(chat?.access.map((row) => Number(row.groupId)) ?? []),
            ...(urgent && settings.rgGroupId !== null ? [Number(settings.rgGroupId)] : []),
          ]),
        ],
        agentIds: [
          ...new Set([
            ...(chat?.users.map((row) => row.userId) ?? []),
            ...supervisors.map((row) => row.agentId),
          ]),
        ],
      };
      if (!urgent) return { audience, mail: null };
      const recipients = new Map<string, MailRecipient>();
      for (const member of [...supervisors, ...team]) {
        const email = member.agent.email?.trim().toLowerCase();
        if (!member.notifyEmail || !email || recipients.has(email)) continue;
        recipients.set(email, {
          email,
          locale: isMailLocale(member.locale) ? member.locale : 'en',
        });
      }
      for (const address of settings.notifyEmails) {
        const email = address.trim().toLowerCase();
        if (email && !recipients.has(email)) recipients.set(email, { email, locale: 'tr' });
      }
      const [organization, boundary] = await Promise.all([
        tx.organization.findUnique({
          where: { id: tenant.organizationId },
          select: { name: true },
        }),
        readDayBoundary(tx),
      ]);
      return {
        audience,
        mail: {
          recipients: [...recipients.values()],
          workspaceName: organization?.name ?? 'SiyahTuş',
          timeZone: boundary.timezone,
        },
      };
    });

    const action = kind === 'raised' ? 'risk_flag_raised' : 'risk_flag_cleared';
    if (plan.audience.groupIds.length > 0 || plan.audience.agentIds.length > 0) {
      await this.#publisher?.publish(tenant, action, plan.audience, riskFlagPush(flag));
    }
    await this.#automations?.emit(tenant, action, riskFlagSignal(flag));

    let mailed = 0;
    if (plan.mail && this.#mailer) {
      for (const recipient of plan.mail.recipients) {
        const outcome = await deliver(this.#mailer, {
          to: recipient.email,
          licenseId: tenant.licenseId,
          ...riskFlagUrgentMail(
            { locale: recipient.locale, ...(this.#appUrl ? { appUrl: this.#appUrl } : {}) },
            {
              workspaceName: plan.mail.workspaceName,
              type: flag.type,
              chatId: flag.chatId,
              raisedBy: flag.raisedBy ? 'agent' : 'ai',
              raisedAt: flag.raisedAt,
              timeZone: plan.mail.timeZone,
              chatUrl:
                this.#appUrl && flag.chatId
                  ? `${this.#appUrl}/app/inbox?chat=${encodeURIComponent(flag.chatId)}`
                  : null,
            },
          ),
          kind: 'notification',
        });
        if (outcome.status === 'sent') mailed += 1;
        // A cap refusal was logged where it was decided (`mail-caps.ts`).
        else if (!isCapRefusal(outcome)) {
          this.#log.warn(
            {
              event: 'risk_flag.mail',
              license_id: tenant.licenseId.toString(),
              flag_id: flag.id,
              outcome: outcome.status,
              mail: mailFailureFields(outcome.error),
            },
            'urgent risk flag e-mail not confirmed as sent',
          );
        }
      }
    }

    this.#log.info(
      {
        event: `risk_flag.${kind}`,
        license_id: tenant.licenseId.toString(),
        flag_id: flag.id,
        chat_id: flag.chatId,
        risk_flag_type: flag.type,
        severity: flag.severity,
        ...(plan.mail ? { recipients: plan.mail.recipients.length, mailed } : {}),
      },
      kind === 'raised' ? 'risk flag raised' : 'risk flag cleared',
    );
  }
}
