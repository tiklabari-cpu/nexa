/**
 * `/platform/v1/admins/*` — operator management (tm 389.4 · FR-ADMIN-03/04 ·
 * design.md §C admins).
 *
 *   GET  /admins                              admins.read
 *   GET  /admins/invites                      admins.read     pending invitations
 *   POST /admins/invites                      admins.manage   recentTotp — mailed, 72 h
 *   POST /admins/invites/{inviteId}/revoke    admins.manage
 *   GET  /admins/{adminId}                    admins.read
 *   POST /admins/{adminId}/role               admins.manage   recentTotp
 *   POST /admins/{adminId}/disable            admins.manage   recentTotp
 *   POST /admins/{adminId}/enable             admins.manage   recentTotp
 *   POST /admins/{adminId}/reset-two-factor   admins.manage   recentTotp
 *   POST /admins/{adminId}/revoke-sessions    admins.manage
 *
 * Operators are disabled, never deleted. The last active superadmin cannot be
 * disabled or moved to another role (409 `platform_last_superadmin`). Every
 * mutation takes a `reason` (3–500 characters), checked and recorded in the
 * platform audit chain by `plugins/platform-audit.ts` (tm 389.5) — the
 * handlers here only add what the entry cannot read off the path.
 *
 * Disabling an operator, changing their role and revoking their sessions end
 * their open impersonation sessions too (tm 430, `admin-directory.ts`): each
 * ended session is recorded as `impersonation.ended` on the platform chain
 * with the action's reason and in its workspace's trail without it, inside the
 * change's transaction — so these three routes write their own entry there
 * too, first — and the sockets its tokens opened close after the commit
 * (`principal_revoked`, tm 426).
 *
 * The list is not paged: operators are a handful of people, and a page
 * boundary in a list of eight is only a way to miss one.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { PLATFORM_ROLES } from '@siyahtus/types';
import type { PlatformEnv } from '../../config/platform-env.js';
import { ApiError } from '../../lib/api-error.js';
import { requestLocale } from '../../lib/request-locale.js';
import { UUID_RE } from '../../lib/tenant.js';
import { deliver, logUnsentMail } from '../../services/mail/delivery.js';
import type { Mailer } from '../../services/mail/mailer.js';
import { platformInvitationMail } from '../../services/mail/templates/messages.js';
import { PLATFORM_INVITE_TTL_HOURS } from '../../services/platform/admin-auth.js';
import type {
  OperatorChange,
  OperatorChangeRecorder,
} from '../../services/platform/admin-directory.js';
import type {
  PlatformAuditAction,
  PlatformAuditRouteConfig,
} from '../../services/platform/platform-audit.js';
import { RealtimePublisher } from '../../services/realtime/publisher.js';
import { parse } from './auth.js';

// `reason` is the audit plugin's: present and 3–500 characters before a
// handler runs, or 400 `platform_reason_required`.
const roleBody = z.object({ role: z.enum(PLATFORM_ROLES) });
const inviteBody = z.object({
  email: z.string().trim().toLowerCase().email().max(320),
  role: z.enum(PLATFORM_ROLES),
});

function onAdmin(action: PlatformAuditAction): PlatformAuditRouteConfig {
  return { action, target: 'admin', targetParam: 'adminId' };
}

function idParam(params: unknown, name: 'adminId' | 'inviteId'): string {
  const value = (params as Record<string, unknown>)[name];
  // An id that cannot exist is the same answer as one that does not.
  if (typeof value !== 'string' || !UUID_RE.test(value)) {
    throw ApiError.notFound(
      name === 'adminId' ? 'Operator not found.' : 'No pending invitation with that id.',
    );
  }
  return value;
}

export default async function platformAdminsRoutes(
  app: FastifyInstance,
  options: { platform: PlatformEnv; mailer: Mailer },
): Promise<void> {
  const admins = app.platformAdmins;
  const read = { platform: { permission: 'admins.read' as const } };
  const manage = (audit: PlatformAuditRouteConfig) => ({
    platform: { permission: 'admins.manage' as const, audit },
  });
  const manageFresh = (audit: PlatformAuditRouteConfig) => ({
    platform: { permission: 'admins.manage' as const, recentTotp: true, audit },
  });
  const publisher = new RealtimePublisher(app.redis, app.log);

  /**
   * A change's entries, inside its transaction: the route's own (`payload`
   * adds what the path cannot say), then one `impersonation.ended` for each
   * session the change ended — the action's reason on the platform chain, and
   * the session's workspace trail written with it.
   */
  function recorder(
    request: FastifyRequest,
    adminId: string,
    payload: (change: OperatorChange) => Record<string, unknown> = () => ({}),
  ): OperatorChangeRecorder {
    return async (tx, change) => {
      await app.platformAuditLog.record(
        request.platformAuditEntry({
          payload: { ...payload(change), impersonations_ended: change.impersonations.length },
        }),
        tx,
      );
      for (const ended of change.impersonations) {
        await app.platformAuditLog.record(
          request.platformAuditEntry({
            action: 'impersonation.ended',
            targetType: 'impersonation',
            targetId: ended.id,
            licenseId: ended.licenseId,
            payload: {
              mode: ended.mode,
              account_id: ended.accountId,
              end_reason: ended.endReason,
              opened_by: adminId,
            },
          }),
          tx,
        );
      }
    };
  }

  /** After the commit: the sockets the ended sessions' tokens opened close. Never throws. */
  const closeSockets = (change: OperatorChange) =>
    publisher.revokeTokens(change.impersonations.flatMap((ended) => ended.tokens));

  app.get('/admins', { config: read }, async () => ({ data: await admins.list() }));

  app.get('/admins/invites', { config: read }, async () => ({ data: await admins.listInvites() }));

  app.post(
    '/admins/invites',
    { config: manageFresh({ action: 'admin.invited', target: 'invite' }) },
    async (request, reply) => {
      const body = parse(inviteBody, request.body);
      const session = request.requirePlatformSession();
      const created = await admins.invite({
        email: body.email,
        role: body.role,
        invitedBy: session.adminId,
      });

      // The token travels in the fragment: it never reaches a server log, the
      // admin SPA reads it from `location.hash` and posts it to /auth/invite/accept.
      const acceptUrl = `${options.platform.adminOrigin}/invite#token=${created.token}`;
      const outcome = await deliver(options.mailer, {
        to: created.invite.email,
        licenseId: null,
        kind: 'platform_invitation',
        ...platformInvitationMail(
          { locale: requestLocale(request), appUrl: options.platform.adminOrigin },
          {
            url: acceptUrl,
            role: created.invite.role,
            inviterEmail: session.email,
            hours: PLATFORM_INVITE_TTL_HOURS,
          },
        ),
      });
      logUnsentMail(request.log, 'platform_invitation.mail', outcome);
      request.platformAudit!.targetId = created.invite.id;
      request.platformAudit!.payload = {
        email: created.invite.email,
        role: created.invite.role,
        mail: outcome.status === 'sent' ? 'sent' : 'failed',
      };

      return reply.status(201).send({
        invite: created.invite,
        mail: outcome.status === 'sent' ? 'sent' : 'failed',
        // Only when the mail did not go: the inviting superadmin hands the link
        // over another way. Never otherwise — a response is not where a
        // credential for somebody else should travel by default.
        ...(outcome.status === 'sent' ? {} : { accept_url: acceptUrl }),
      });
    },
  );

  app.post(
    '/admins/invites/:inviteId/revoke',
    {
      config: manage({ action: 'admin.invite_revoked', target: 'invite', targetParam: 'inviteId' }),
    },
    async (request, reply) => {
      await admins.revokeInvite(idParam(request.params, 'inviteId'));
      return reply.status(204).send();
    },
  );

  app.get('/admins/:adminId', { config: read }, async (request) =>
    admins.get(idParam(request.params, 'adminId')),
  );

  app.post(
    '/admins/:adminId/role',
    { config: manageFresh(onAdmin('admin.role_changed')) },
    async (request) => {
      const body = parse(roleBody, request.body);
      const adminId = idParam(request.params, 'adminId');
      const changed = await admins.setRole(
        adminId,
        body.role,
        recorder(request, adminId, (change) => ({ from: change.previousRole, to: body.role })),
      );
      await closeSockets(changed);
      return changed.admin;
    },
  );

  app.post(
    '/admins/:adminId/disable',
    { config: manageFresh(onAdmin('admin.disabled')) },
    async (request) => {
      const adminId = idParam(request.params, 'adminId');
      const changed = await admins.disable(adminId, recorder(request, adminId));
      await closeSockets(changed);
      return changed.admin;
    },
  );

  app.post(
    '/admins/:adminId/enable',
    { config: manageFresh(onAdmin('admin.enabled')) },
    async (request) => admins.enable(idParam(request.params, 'adminId')),
  );

  app.post(
    '/admins/:adminId/reset-two-factor',
    { config: manageFresh(onAdmin('admin.two_factor_reset')) },
    async (request) => admins.resetTwoFactor(idParam(request.params, 'adminId')),
  );

  app.post(
    '/admins/:adminId/revoke-sessions',
    { config: manage(onAdmin('admin.sessions_revoked')) },
    async (request) => {
      const adminId = idParam(request.params, 'adminId');
      const changed = await admins.revokeSessions(
        adminId,
        recorder(request, adminId, (change) => ({ ended: change.sessionsEnded })),
      );
      await closeSockets(changed);
      return { ended: changed.sessionsEnded };
    },
  );
}
