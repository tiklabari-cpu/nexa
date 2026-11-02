/**
 * "This channel needs reconnecting" (tm 380 · KN-01): what happens when the
 * provider refuses a live channel's credential — Meta's Graph error 190 on a
 * WhatsApp business token.
 *
 * Three things, once per lapse:
 *
 *   1. `channels.reconnect_required_at` is set — only where it was empty, in
 *      one statement, so two replies failing at once mark it once. Settings →
 *      Channels reads it as "reconnect needed", and the reply path refuses to
 *      send with a credential the provider already refused.
 *   2. An audit entry (`channel.reconnect_required`), written as the system's.
 *   3. An e-mail to the workspace's owners, vice-owners and admins
 *      (`channelReconnectMail`), after the commit and never fatal: the mark is
 *      what matters; a mail that does not go out is logged.
 *
 * A reconnect clears the mark (`ChannelService.storeWhatsAppLive`), so a
 * later lapse is a new one and mails again.
 */
import type { PrismaClient } from '@prisma/client';
import { withTenant, type TenantContext } from '../../lib/tenant.js';
import { writeAuditEntry } from '../audit/audit-log.js';
import { deliver } from '../mail/delivery.js';
import type { Mailer } from '../mail/mailer.js';
import { isMailLocale } from '../mail/templates/layout.js';
import { channelReconnectMail } from '../mail/templates/messages.js';

/** Who is told: the people who can reconnect a channel. */
export const CHANNEL_RECONNECT_NOTICE_ROLES = ['owner', 'viceowner', 'admin'] as const;

const CHANNEL_NAMES: Record<string, string> = {
  whatsapp: 'WhatsApp',
  telegram: 'Telegram',
  messenger: 'Facebook Messenger',
  instagram: 'Instagram',
};

export interface ReconnectNoticeOptions {
  /** Absent: the mark and the audit entry only (a test, a process without mail). */
  mailer?: Mailer;
  /** `WEB_APP_URL`, for the mail's button. */
  appUrl?: string;
  /** For a mail that could not go out. */
  log?: { warn: (obj: object, msg: string) => void };
  /** The audit chain's root (`AUDIT_CHAIN_SECRET`): the entry is chained like every other. */
  auditChainSecret: string;
}

/**
 * Mark `type`'s connected channel as needing a reconnect. Answers whether this
 * call is the one that marked it (and so the one that told the admins).
 */
export async function markChannelReconnectRequired(
  db: PrismaClient,
  tenant: TenantContext,
  type: string,
  options: ReconnectNoticeOptions,
): Promise<boolean> {
  const marked = await withTenant(db, tenant, async (tx) => {
    const { count } = await tx.channel.updateMany({
      where: { type, status: 'connected', reconnectRequiredAt: null },
      data: { reconnectRequiredAt: new Date() },
    });
    if (count === 0) return null;
    await writeAuditEntry(
      tx,
      {
        licenseId: tenant.licenseId,
        actorId: null,
        actorType: 'system',
        ip: null,
        chainSecret: options.auditChainSecret,
      },
      {
        action: 'channel.reconnect_required',
        target: `channel:${type}`,
        metadata: { type },
      },
    );
    const [members, organization] = await Promise.all([
      tx.agentMembership.findMany({
        where: {
          licenseId: tenant.licenseId,
          suspended: false,
          notifyEmail: true,
          role: { in: [...CHANNEL_RECONNECT_NOTICE_ROLES] },
        },
        orderBy: { createdAt: 'asc' },
        select: { locale: true, agent: { select: { email: true } } },
      }),
      tx.organization.findUnique({
        where: { id: tenant.organizationId },
        select: { name: true },
      }),
    ]);
    return { members, workspaceName: organization?.name ?? 'SiyahTuş' };
  });
  if (!marked) return false;

  if (options.mailer) {
    const channelName = CHANNEL_NAMES[type] ?? type;
    for (const member of marked.members) {
      const email = member.agent.email;
      if (!email) continue;
      const locale = isMailLocale(member.locale) ? member.locale : 'en';
      try {
        const outcome = await deliver(options.mailer, {
          to: email,
          licenseId: tenant.licenseId,
          ...channelReconnectMail(
            { locale, ...(options.appUrl ? { appUrl: options.appUrl } : {}) },
            {
              workspaceName: marked.workspaceName,
              channelName,
              channelsUrl: options.appUrl
                ? `${options.appUrl.replace(/\/+$/, '')}/app/settings/channels`
                : null,
            },
          ),
          kind: 'notification',
        });
        if (outcome.status !== 'sent') {
          options.log?.warn(
            { license_id: String(tenant.licenseId), channel_type: type },
            'channel reconnect notice not sent',
          );
        }
      } catch (error) {
        options.log?.warn(
          { err: error, license_id: String(tenant.licenseId), channel_type: type },
          'channel reconnect notice failed',
        );
      }
    }
  }
  return true;
}
